/**
 * Checking for, and applying, an update from the plugin's own repository.
 *
 * The plugin cannot hot-swap itself: the host half is already imported and the
 * browser bundle was snapshotted when DSH booted. So "update" means *replace the
 * files on disk*, verified and reversible, and say plainly that a full restart
 * is what makes it real.
 *
 * Safety is the whole design here:
 *
 * - nothing runs unless the tree is a clean git checkout of the plugin itself,
 *   so a rollback (`git reset --hard <old>`) can never destroy someone's edits;
 * - a pull is `--ff-only` — never a merge, never a rebase, never a conflict;
 * - every file the host and the browser half need is syntax-checked after the
 *   pull, and a single failure resets the tree to the commit it started from;
 * - one update at a time, every subprocess and every request has a deadline, and
 *   nothing in this module throws: it answers with a code.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

/**
 * Where the published metadata can be read.
 *
 * Networks differ: some block `raw.githubusercontent.com` while `github.com` works,
 * some do the opposite, some only allow the API host. Each is tried in turn, so a
 * check does not fail merely because the first host is unreachable.
 *
 * @param {string} repo
 * @param {string} branch
 * @returns {string[]}
 */
export function manifestUrls(repo, branch) {
  return [
    `https://raw.githubusercontent.com/${repo}/${branch}/package.json`,
    `https://github.com/${repo}/raw/${branch}/package.json`,
    `https://api.github.com/repos/${repo}/contents/package.json?ref=${branch}`,
  ];
}

/**
 * Where the release tarball can be downloaded.
 *
 * @param {string} repo
 * @param {string} branch
 * @returns {string[]}
 */
export function archiveUrls(repo, branch) {
  return [
    `https://codeload.github.com/${repo}/tar.gz/refs/heads/${branch}`,
    `https://github.com/${repo}/archive/refs/heads/${branch}.tar.gz`,
  ];
}

/**
 * Whether a git failure is really "the network would not let me", which is the one
 * case where switching transports can help.
 *
 * @param {unknown} detail
 * @returns {boolean}
 */
export function isNetworkFailure(detail) {
  const text = String(detail ?? '');
  return /unable to access|could not resolve|couldn't resolve|timed out|timeout|connection (was )?(refused|reset|aborted)|temporary failure|network is unreachable|proxy/i.test(
    text,
  );
}

/** The package root: this file lives in `lib/host/`. */
export const PACKAGE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** Where to look when the checkout has no usable remote. */
const FALLBACK_REPO = 'Lsy1949/dsh-session-delete';
/**
 * Deadline for one network request. Short on purpose: a check that hangs is
 * worse than a check that fails, because the GUI can only say "checking".
 */
const FETCH_TIMEOUT_MS = 8_000;
/** Deadline for one git invocation. */
const GIT_TIMEOUT_MS = 10_000;
/** Deadline for downloading the release archive. */
const ARCHIVE_TIMEOUT_MS = 60_000;
/** Refuse an archive bigger than this; the whole plugin is a few hundred KB. */
const ARCHIVE_LIMIT_BYTES = 20 * 1024 * 1024;
/** The repository this plugin is published from, when the checkout cannot say. */
export const REPO_SLUG = FALLBACK_REPO;

/**
 * @typedef {{ code: number, stdout: string, stderr: string, timedOut: boolean }} RunResult
 * @typedef {(argv: string[], options: { cwd: string, timeoutMs: number }) => Promise<RunResult>} Runner
 * @typedef {(url: string, timeoutMs: number) => Promise<string>} Fetcher
 */

/**
 * Run a program without a shell, with a deadline and captured output.
 *
 * @type {Runner}
 */
export async function runProcess(argv, options) {
  return await new Promise((resolve) => {
    /** @type {any} */
    let child;
    let settled = false;
    let timedOut = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child?.kill();
      } catch {
        /* the process may already be gone */
      }
      finish({ code: -1, stdout: '', stderr: 'timeout', timedOut: true });
    }, options.timeoutMs);
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      clearTimeout(timer);
      resolve({ code: -1, stdout: '', stderr: String(error?.message ?? error), timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      if (stdout.length < 64 * 1024) stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 64 * 1024) stderr += String(chunk);
    });
    child.on('error', (error) => finish({ code: -1, stdout, stderr: String(error?.message ?? error), timedOut }));
    child.on('close', (code) => finish({ code: typeof code === 'number' ? code : -1, stdout, stderr, timedOut }));
  });
}

/**
 * Fetch a small text resource with a deadline.
 *
 * @type {Fetcher}
 */
export async function fetchText(url, timeoutMs) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'text/plain, application/json', 'user-agent': 'dsh-session-delete' },
  });
  if (response.ok !== true) throw new Error(`http ${response.status}`);
  return await response.text();
}

/**
 * Split a version into comparable numbers. Anything unparsable is `0`, which is
 * exactly what "this checkout is older than anything published" should mean.
 *
 * @param {unknown} value
 * @returns {number[]}
 */
export function versionParts(value) {
  if (typeof value !== 'string') return [0, 0, 0];
  const parts = value
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .slice(0, 3)
    .map((piece) => {
      const digits = /^\d+/.exec(piece);
      return digits === null ? 0 : Number(digits[0]);
    });
  while (parts.length < 3) parts.push(0);
  return parts;
}

/**
 * Whether `remote` is a later release than `local`.
 *
 * @param {string} local
 * @param {string} remote
 * @returns {boolean}
 */
export function isNewer(local, remote) {
  const left = versionParts(local);
  const right = versionParts(remote);
  for (let index = 0; index < 3; index += 1) {
    if (right[index] > left[index]) return true;
    if (right[index] < left[index]) return false;
  }
  return false;
}

/**
 * `owner/repo` from a git URL, or the known repository.
 *
 * @param {string} url
 * @returns {string}
 */
export function repoOf(url) {
  const trimmed = String(url ?? '').trim();
  const match = /github\.com[/:]([^/]+)\/([^/\s]+?)(?:\.git)?$/.exec(trimmed);
  if (match === null) return FALLBACK_REPO;
  return `${match[1]}/${match[2]}`;
}

/**
 * Download a release archive.
 *
 * The git-free update path exists because plenty of people have no `git` at all:
 * they installed this from a URL and got a copy. GitHub serves the same tree as a
 * tarball, so the update needs nothing but HTTPS.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @param {number} limit
 * @returns {Promise<Buffer>}
 */
export async function fetchArchive(url, timeoutMs, limit) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'dsh-session-delete' },
    redirect: 'follow',
  });
  if (response.ok !== true) throw new Error(`http ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > limit) throw new Error('archive too large');
  return buffer;
}

/**
 * Read a POSIX tar buffer into entries.
 *
 * @param {Buffer} buffer
 * @returns {Array<{ path: string, data: Buffer, directory?: boolean }>}
 */
export function readTar(buffer) {
  /** @type {Array<{ path: string, data: Buffer, directory?: boolean }>} */
  const entries = [];
  let offset = 0;
  const field = (start, length) =>
    buffer
      .subarray(start, start + length)
      .toString('utf8')
      .replace(/\u0000[\s\S]*$/, '');
  while (offset + 512 <= buffer.length) {
    const block = buffer.subarray(offset, offset + 512);
    if (block.every((byte) => byte === 0)) break;
    const name = field(offset, 100);
    const prefix = field(offset + 345, 155);
    const path = prefix === '' ? name : `${prefix}/${name}`;
    const size = parseInt(field(offset + 124, 12).trim(), 8) || 0;
    const type = String.fromCharCode(buffer[offset + 156] || 48);
    const bodyStart = offset + 512;
    if (bodyStart + size > buffer.length) break;
    const data = buffer.subarray(bodyStart, bodyStart + size);
    if (type === '5') entries.push({ path, data: Buffer.alloc(0), directory: true });
    else if (type === '0' || type === '\u0000' || type === '7') entries.push({ path, data });
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

/**
 * Gunzip and unpack a GitHub tarball, dropping the archive's own top directory and
 * every path that could escape the target.
 *
 * @param {Buffer} archive
 * @returns {Array<{ path: string, data: Buffer, directory?: boolean }>}
 */
export function unpackArchive(archive) {
  const tar = gunzipSync(archive, { finishFlush: 2 /* Z_SYNC_FLUSH */ });
  /** @type {Array<{ path: string, data: Buffer, directory?: boolean }>} */
  const files = [];
  for (const entry of readTar(tar)) {
    const segments = entry.path.split('/').filter((part) => part !== '' && part !== '.');
    if (segments.length < 2) continue;
    if (segments.includes('..')) continue;
    if (/^[a-zA-Z]:$/.test(segments[0])) continue;
    files.push({ path: segments.slice(1).join('/'), data: entry.data, directory: entry.directory === true });
  }
  return files;
}

/**
 * Build an updater. Every side effect is injected, so the whole state machine —
 * including the rollback — is testable without a network or a repository.
 *
 * @param {{ run?: Runner, fetchText?: Fetcher, root?: string, now?: () => number }} [options]
 */
export function createUpdater(options = {}) {
  const run = options.run ?? runProcess;
  const fetchRemote = options.fetchText ?? fetchText;
  const fetchBytes = options.fetchBytes ?? fetchArchive;
  const root = options.root ?? PACKAGE_ROOT;
  const now = options.now ?? (() => Date.now());

  /** One update at a time; the second caller is told to wait. */
  let inFlight = false;
  /** @type {{ local: string, remote: string, newer: boolean, repo: string, branch: string, source: string, checkedAt: number } | null} */
  let lastCheck = null;

  /** The resolved git executable, cached for this process. */
  /** @type {string | null | undefined} */
  let gitCommand;

  /** @param {string[]} argv @param {number} [timeoutMs] */
  const git = (argv, timeoutMs = GIT_TIMEOUT_MS) =>
    run([typeof gitCommand === 'string' && gitCommand !== '' ? gitCommand : 'git', ...argv], { cwd: root, timeoutMs });

  /** The version this checkout carries right now. */
  async function localPackage() {
    const parsed = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    return {
      version: typeof parsed?.version === 'string' ? parsed.version : '0.0.0',
      name: typeof parsed?.name === 'string' ? parsed.name : '',
      manifestVersion: parsed?.dsh?.manifestVersion,
      enginesDsh: typeof parsed?.engines?.dsh === 'string' ? parsed.engines.dsh : '',
      main: parsed?.main,
      client: parsed?.exports?.['./client'],
    };
  }

  /**
   * The branch to compare against, the repository, and (when this install is a
   * checkout) the head commit.
   *
   * Not being a checkout is not an error: most people installed this from the URL
   * and got a copy without `.git`. They can still *check* for a new version — they
   * just cannot be pulled into shape by us, so they get instructions instead.
   *
   * @returns {Promise<{ git: boolean, head: string, repo: string, remoteUrl: string, branch: string }>}
   */
  /** Where the worktree is, if this install sits inside one. */
  async function findWorktree() {
    let current = root;
    for (let depth = 0; depth < 8; depth += 1) {
      if (existsSync(join(current, '.git'))) return current;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  /**
   * The git executable, resolved once.
   *
   * Being inside a checkout and having a usable `git` are two different facts: an
   * app started from a launcher may not carry the PATH a terminal has, and saying
   * "this is not a checkout" in that case sends people looking for the wrong
   * problem. `DSH_SESSION_DELETE_GIT` overrides the search.
   *
   * @returns {Promise<string | null>}
   */
  async function resolveGitCommand() {
    if (gitCommand !== undefined) return gitCommand;
    /** @type {string[]} */
    const candidates = [];
    const fromEnv = process.env.DSH_SESSION_DELETE_GIT;
    if (typeof fromEnv === 'string' && fromEnv.trim() !== '') candidates.push(fromEnv.trim());
    candidates.push('git');
    if (process.platform === 'win32') {
      candidates.push(
        'D:\\Git\\cmd\\git.exe',
        'C:\\Program Files\\Git\\cmd\\git.exe',
        'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
        `${String(process.env.LOCALAPPDATA ?? '')}\\Programs\\Git\\cmd\\git.exe`,
      );
    } else {
      candidates.push('/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git');
    }
    for (const candidate of candidates) {
      if (candidate === '') continue;
      if (candidate !== 'git' && existsSync(candidate) === false) continue;
      const probe = await run([candidate, '--version'], { cwd: root, timeoutMs: 5_000 });
      if (probe.code === 0) {
        gitCommand = candidate;
        return gitCommand;
      }
    }
    gitCommand = null;
    return null;
  }

  /**
   * The branch to compare against, the repository, and (when this install is a
   * checkout) the head commit.
   *
   * Being a checkout is decided by the presence of `.git` — not by whether a git
   * binary answers, because those are different failures with different fixes.
   *
   * @returns {Promise<{ git: boolean, gitAvailable: boolean, worktree: string, head: string, repo: string, remoteUrl: string, branch: string }>}
   */
  async function repoState() {
    const worktree = await findWorktree();
    if (worktree === null) {
      return { git: false, gitAvailable: false, worktree: '', head: '', repo: FALLBACK_REPO, remoteUrl: '', branch: 'main' };
    }
    const command = await resolveGitCommand();
    if (command === null) {
      /* A checkout whose git cannot be reached is still a checkout. */
      return { git: true, gitAvailable: false, worktree, head: '', repo: FALLBACK_REPO, remoteUrl: '', branch: 'main' };
    }
    /** @param {string[]} argv @param {number} timeoutMs */
    const inTree = (argv, timeoutMs) => run([command, ...argv], { cwd: worktree, timeoutMs });
    const head = await inTree(['rev-parse', 'HEAD'], 5_000);
    const remote = await inTree(['remote', 'get-url', 'origin'], 5_000);
    let branch = '';
    const symbolic = await inTree(['symbolic-ref', '--short', 'HEAD'], 5_000);
    if (symbolic.code === 0 && symbolic.stdout.trim() !== '') branch = symbolic.stdout.trim();
    return {
      git: true,
      gitAvailable: true,
      worktree,
      head: head.code === 0 ? head.stdout.trim() : '',
      repo: repoOf(remote.code === 0 ? remote.stdout : ''),
      remoteUrl: remote.code === 0 ? remote.stdout.trim() : '',
      branch: branch === '' ? 'main' : branch,
    };
  }

  /**
   * Ask the remote what it publishes: the branch's `package.json`, read over
   * git first, over raw HTTPS as the fallback for a checkout that cannot reach
   * its remote. Both the check and the pull guard share this one reader, so
   * both answer from the same manifest. Throws only when both transports fail.
   *
   * @param {string} branch
   * @param {string} repo
   * @returns {Promise<{ version: string, enginesDsh: string, source: string }>}
   */
  async function remoteManifest(branch, repo, gitAvailable) {
    /* Raw HTTPS first: it needs no repository, no credentials and no fetch, so it
       answers in a second and works for an install that has no `.git` at all.
       The raw file has no engine info beyond what it carries, which is enough. */
    let httpDetail = '';
    for (const rawUrl of manifestUrls(repo, branch)) {
      try {
        const text = await fetchRemote(rawUrl, FETCH_TIMEOUT_MS);
        const parsed = JSON.parse(text);
        /* The API host wraps the file in base64. */
        const manifest =
          typeof parsed?.version === 'string'
            ? parsed
            : typeof parsed?.content === 'string'
              ? JSON.parse(Buffer.from(parsed.content, 'base64').toString('utf8'))
              : null;
        if (manifest === null || typeof manifest.version !== 'string') {
          throw new Error('remote package.json has no version');
        }
        return {
          version: manifest.version,
          enginesDsh: typeof manifest?.engines?.dsh === 'string' ? manifest.engines.dsh : '',
          source: 'http',
        };
      } catch (error) {
        httpDetail = String(error?.message ?? error);
      }
    }
    if (gitAvailable !== true) {
      const offline = new Error(httpDetail);
      // @ts-expect-error - the caller answers with a code
      offline.code = 'offline';
      throw offline;
    }

    const fetched = await git(['fetch', '--quiet', '--prune', 'origin'], GIT_TIMEOUT_MS);
    const gitDetail = fetched.code === 0 ? '' : fetched.stderr.trim().split('\n').pop();
    if (fetched.code === 0) {
      const shown = await git(['show', `origin/${branch}:package.json`], 20_000);
      if (shown.code === 0) {
        try {
          const parsed = JSON.parse(shown.stdout);
          if (typeof parsed?.version === 'string') {
            return {
              version: parsed.version,
              enginesDsh: typeof parsed?.engines?.dsh === 'string' ? parsed.engines.dsh : '',
              source: 'git',
            };
          }
        } catch {
          /* fall through to the raw file */
        }
      }
    }
    /* Both transports failed: that is a network problem, not a bad version. */
    const offline = new Error(gitDetail === '' ? httpDetail : `${gitDetail}; ${httpDetail}`);
    // @ts-expect-error - the caller answers with a code
    offline.code = 'offline';
    throw offline;
  }

  /** Is the worktree clean enough that a reset could never lose work? */
  async function isClean() {
    const status = await git(['status', '--porcelain', '--untracked-files=no'], 20_000);
    return status.code === 0 && status.stdout.trim() === '';
  }

  /**
   * Everything the two halves need must still be loadable. A pull that breaks
   * the bundle is worse than an old version, so this is the gate.
   */
  async function verify(dir = root) {
    /** @type {string[]} */
    const problems = [];
    let pkg;
    try {
      pkg = await localPackage();
    } catch (error) {
      return { ok: false, problems: [`package.json unreadable: ${String(error?.message ?? error)}`] };
    }
    if (pkg.name !== 'dsh-session-delete') problems.push('package.json name changed');
    if (pkg.manifestVersion !== 1) problems.push('dsh.manifestVersion is not 1');
    if (pkg.main !== 'index.js') problems.push('main is not index.js');
    if (pkg.client !== './client.js') problems.push('exports["./client"] is not ./client.js');

    /** @type {string[]} */
    const files = ['index.js', 'client.js'];
    try {
      for (const name of await readdir(join(dir, 'lib', 'host'))) {
        if (name.endsWith('.js')) files.push(join('lib', 'host', name));
      }
    } catch {
      problems.push('lib/host missing');
    }

    for (const relative of files) {
      const absolute = join(dir, relative);
      const checked = await run([process.execPath, '--check', absolute], { cwd: dir, timeoutMs: 20_000 });
      if (checked.code !== 0) {
        problems.push(`${relative} does not parse: ${checked.stderr.split('\n')[0] ?? ''}`.trim());
      }
    }

    try {
      const client = await readFile(join(dir, 'client.js'), 'utf8');
      if (client.includes('__ModuleLoader__') === false) problems.push('client.js no longer registers with the module loader');
    } catch {
      problems.push('client.js unreadable');
    }

    return { ok: problems.length === 0, problems };
  }

  /**
   * Look for a newer version. Never throws.
   *
   * @returns {Promise<Record<string, unknown>>}
   */
  async function check() {
    if (process.env.DSH_SESSION_DELETE_NO_UPDATE === '1') {
      return { ok: false, code: 'disabled' };
    }
    /** @type {Record<string, unknown>} */
    let facts = {};
    try {
      const local = await localPackage();
      const state = await repoState();
      facts = {
        local: local.version,
        installKind: state.git ? 'git' : 'copy',
        gitAvailable: state.gitAvailable === true,
        worktree: state.worktree,
        repo: state.repo,
        branch: state.branch,
      };
      const remote = await remoteManifest(state.branch, state.repo, state.git);
      const enginesChanged = (remote.enginesDsh || '') !== (local.enginesDsh || '');
      lastCheck = {
        local: local.version,
        remote: remote.version,
        newer: isNewer(local.version, remote.version),
        enginesDsh: remote.enginesDsh,
        enginesChanged,
        repo: state.repo,
        branch: state.branch,
        source: remote.source,
        checkedAt: now(),
        installKind: state.git ? 'git' : 'copy',
        gitAvailable: state.gitAvailable === true,
        worktree: state.worktree,
      };
      return {
        ok: true,
        ...lastCheck,
        head: state.head,
        remotes: state.remoteUrl,
        /* Every install can update: a checkout pulls, a copy downloads the
           published tarball over HTTPS. The only blocker left is a checkout with
           uncommitted edits, where a pull could not be clean. */
        canUpdate: lastCheck.newer === true,
        ...(state.git === true && state.gitAvailable === true ? await cleanliness() : { updateBlocked: '' }),
      };
    } catch (error) {
      const code = error?.code === 'offline' ? 'offline' : 'check-failed';
      return {
        ok: false,
        code,
        detail: String(error?.message ?? error),
        canUpdate: false,
        ...facts,
        ...(lastCheck === null ? {} : lastCheck),
      };
    }
  }

  /** Whether a pull would be refused, without doing one. */
  async function cleanliness() {
    try {
      const clean = await isClean();
      return clean ? { updateBlocked: '' } : { updateBlocked: 'dirty' };
    } catch {
      return { updateBlocked: 'dirty' };
    }
  }

  /**
   * Pull, verify, and roll back if verification fails. Never throws.
   *
   * @param {{ allowDirty?: boolean }} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  /** Files and folders a checkout carries that must never travel. */
  const NEVER_COPY = new Set(['.git', 'node_modules', '.pnpm']);

  /**
   * Copy one tree over another, skipping the parts that belong to the checkout or
   * to the package manager.
   *
   * @param {string} from
   * @param {string} to
   */
  async function overlayTree(from, to) {
    await cp(from, to, {
      recursive: true,
      force: true,
      filter: (source) => {
        const name = source.split(/[\\/]/).pop() ?? '';
        return NEVER_COPY.has(name) === false;
      },
    });
  }

  /**
   * Keep a copy of the live tree before touching it, so a failed install can be
   * undone in the same request.
   *
   * @param {string | undefined} backupRoot
   * @returns {Promise<string>}
   */
  async function backupTree(backupRoot) {
    const base = typeof backupRoot === 'string' && backupRoot !== '' ? backupRoot : tmpdir();
    const target = join(base, 'update-backup', `${stamp()}-${await versionOrUnknown()}`);
    await mkdir(dirname(target), { recursive: true });
    await overlayTree(root, target);
    return target;
  }

  /** @returns {Promise<string>} */
  async function versionOrUnknown() {
    try {
      return (await localPackage()).version;
    } catch {
      return 'unknown';
    }
  }

  /** A filesystem-safe stamp for a backup folder name. */
  function stamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  /**
   * Put a backup back over the live tree, dropping the files the failed attempt
   * added first so nothing from the new version survives the rollback.
   *
   * @param {string} backup
   * @param {Array<{ path: string }>} written
   */
  async function restoreTree(backup, written) {
    for (const file of written) {
      try {
        await rm(join(root, file.path), { force: true });
      } catch {
        /* a file that never landed is fine */
      }
    }
    await overlayTree(backup, root);
  }

  /** The git path: what this plugin has always done, kept for checkouts. */
  async function applyWithGit(before, state) {
    if ((await isClean()) !== true) return { ok: false, code: 'dirty', local: before.version };
    const pulled = await git(['pull', '--ff-only', '--no-rebase', 'origin', state.branch], GIT_TIMEOUT_MS);
    if (pulled.code !== 0) {
      /* A diverged branch is not an emergency: put the tree back and say so. */
      await git(['reset', '--hard', state.head], GIT_TIMEOUT_MS);
      return { ok: false, code: 'pull-failed', detail: pulled.stderr.trim().slice(0, 500) };
    }
    const after = await localPackage();
    const verdict = await verify();
    if (verdict.ok !== true) {
      const reset = await git(['reset', '--hard', state.head], GIT_TIMEOUT_MS);
      return {
        ok: false,
        code: 'rolled-back',
        from: before.version,
        to: after.version,
        problems: verdict.problems,
        rolledBack: reset.code === 0,
      };
    }
    const head = await git(['rev-parse', 'HEAD'], 10_000);
    const changed = await git(['diff', '--name-only', state.head, 'HEAD'], 20_000);
    return {
      ok: true,
      via: 'git',
      from: before.version,
      to: after.version,
      restartRequired: isNewer(before.version, after.version),
      head: head.code === 0 ? head.stdout.trim() : '',
      previousHead: state.head,
      changed: changed.code === 0 ? changed.stdout.split('\n').filter((line) => line.trim() !== '').length : 0,
    };
  }

  /**
   * The git-free path: download the published tarball, check it, keep a backup of
   * what is there, overlay it, check again, undo if anything went wrong.
   *
   * Plenty of installs have no `.git` — `dsh plugin add <url>` copies the tree —
   * and some machines have no `git` at all. HTTPS is the only requirement here.
   */
  async function applyWithArchive(before, state, options) {
    let archive = null;
    let downloadDetail = '';
    for (const url of archiveUrls(state.repo, state.branch)) {
      try {
        archive = await fetchBytes(url, ARCHIVE_TIMEOUT_MS, ARCHIVE_LIMIT_BYTES);
        break;
      } catch (error) {
        downloadDetail = String(error?.message ?? error);
      }
    }
    if (archive === null) return { ok: false, code: 'offline', detail: downloadDetail };
    let files;
    try {
      files = unpackArchive(archive);
    } catch (error) {
      return { ok: false, code: 'archive-invalid', detail: String(error?.message ?? error) };
    }
    if (files.length === 0) return { ok: false, code: 'archive-empty' };

    const stage = await mkdtemp(join(tmpdir(), 'dsd-stage-'));
    try {
      for (const file of files) {
        const target = join(stage, file.path);
        if (file.directory === true) {
          await mkdir(target, { recursive: true });
          continue;
        }
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.data);
      }
      const staged = await verify(stage);
      if (staged.ok !== true) return { ok: false, code: 'verify-failed', problems: staged.problems };

      const backup = await backupTree(options.backupRoot);
      try {
        await overlayTree(stage, root);
      } catch (error) {
        await restoreTree(backup, files);
        return { ok: false, code: 'install-failed', detail: String(error?.message ?? error) };
      }
      const after = await localPackage();
      const live = await verify();
      if (live.ok !== true) {
        await restoreTree(backup, files);
        return {
          ok: false,
          code: 'rolled-back',
          from: before.version,
          to: after.version,
          problems: live.problems,
          rolledBack: true,
          backup,
        };
      }
      return {
        ok: true,
        via: 'http',
        from: before.version,
        to: after.version,
        restartRequired: isNewer(before.version, after.version),
        changed: files.filter((file) => file.directory !== true).length,
        backup,
      };
    } finally {
      try {
        await rm(stage, { recursive: true, force: true });
      } catch {
        /* a leftover temp directory is not worth failing the update over */
      }
    }
  }

  /**
   * Update the install: git when this is a checkout with a working git, HTTPS
   * tarball otherwise. Verify, and roll back on any failure. Never throws.
   *
   * @param {{ backupRoot?: string }} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async function apply(options = {}) {
    if (process.env.DSH_SESSION_DELETE_NO_UPDATE === '1') {
      return { ok: false, code: 'disabled' };
    }
    if (inFlight) return { ok: false, code: 'busy' };
    inFlight = true;
    try {
      const before = await localPackage();
      const state = await repoState();

      /* The update must stay on the same DSH compatibility line, and it must be
       * read from the same manifest the check reads. A branch that now targets a
       * different `engines.dsh` is a deliberate move, not an update: refuse before
       * touching the tree and let the user switch branches. */
      let remote;
      try {
        remote = await remoteManifest(state.branch, state.repo, state.git === true && state.gitAvailable === true);
      } catch (error) {
        return { ok: false, code: 'offline', detail: String(error?.message ?? error) };
      }
      if (remote.enginesDsh !== (before.enginesDsh || '')) {
        return {
          ok: false,
          code: 'engines-changed',
          local: before.version,
          localEngines: before.enginesDsh || '',
          remoteEngines: remote.enginesDsh,
        };
      }
      if (isNewer(before.version, remote.version) !== true) {
        return { ok: false, code: 'up-to-date', local: before.version, remote: remote.version };
      }

      if (state.git === true && state.gitAvailable === true) {
        const outcome = await applyWithGit(before, state);
        /* A checkout whose `git pull` cannot reach the remote (a proxy that only
           serves HTTPS, a blocked git transport) is not out of options: the tarball
           needs nothing but HTTPS, so try that before giving up. */
        if (outcome.ok !== true && outcome.code === 'pull-failed' && isNetworkFailure(outcome.detail)) {
          const fallback = await applyWithArchive(before, state, options);
          return { repo: state.repo, ...fallback, gitError: String(outcome.detail ?? '') };
        }
        return { repo: state.repo, ...outcome };
      }
      const outcome = await applyWithArchive(before, state, options);
      return { repo: state.repo, ...outcome };
    } catch (error) {
      return { ok: false, code: 'update-failed', detail: String(error?.message ?? error) };
    } finally {
      inFlight = false;
    }
  }

  return {
    root,
    check,
    apply,
    verify,
    localPackage,
    /** What the last check found, if any. */
    get lastCheck() {
      return lastCheck;
    },
    /** Test seam: forget the memoised check. */
    reset() {
      lastCheck = null;
      inFlight = false;
    },
  };
}

/** The one updater the routes use. */
export const updater = createUpdater();
