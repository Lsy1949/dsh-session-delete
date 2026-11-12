/**
 * Adapter over the DSH services the trash needs.
 *
 * The plugin never assumes a service is mounted: `apply()` cannot block boot on
 * a service nobody provides (that would leave the loader entry pending and drag
 * the whole plugin tree). Instead every operation asks for what it needs at the
 * moment it runs and reports `unavailable` when the answer is no.
 *
 * One DSH detail drives the shape of this file: `sessionPersistence.list()` and
 * `stat()` describe a session's header, revision and size, but — in the build
 * this plugin targets — they do not hand out the log's path. The documented
 * store layout is `<DSH home>/sessions/<group>/<session>/<log>`, so the artifact
 * is found by looking for a directory named after the session id inside the
 * store. Nothing is guessed about group names; the directory is discovered.
 */
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { exists, looksLikeSessionDir, resolveDshHome } from './paths.js';

/** Words a session object may use to say it is busy right now. */
const RUNNING_WORDS = /running|busy|working|streaming|active/i;

/**
 * Look for a positive "a turn is running" signal on a session object.
 *
 * The session registry is not documented field by field, so this reads the
 * handful of shapes it may plausibly use and answers false when it sees
 * nothing it recognises — an idle session must stay trashable.
 *
 * @param {any} session
 * @returns {boolean}
 */
function looksRunning(session) {
  for (const key of ['status', 'state', 'activity']) {
    const value = session[key];
    if (typeof value === 'string' && RUNNING_WORDS.test(value)) return true;
    if (value !== null && value !== undefined && typeof value === 'object') {
      if (typeof value.status === 'string' && RUNNING_WORDS.test(value.status)) return true;
    }
  }
  for (const key of ['running', 'busy', 'streaming']) {
    if (session[key] === true) return true;
  }
  const turn = session.turn;
  if (turn !== null && turn !== undefined && typeof turn === 'object' && turn.active === true) return true;
  return false;
}

/** @typedef {{ id: string, dir: string, logFile: string, cwd: string }} StoredSession */

/**
 * Read a service from the client-supplied context.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string} name
 * @returns {any}
 */
export function serviceOf(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Thrown when an operation needs a service this DSH build does not mount.
 */
export class UnavailableError extends Error {
  /**
   * @param {Array<string>} missing
   */
  constructor(missing) {
    super(`service unavailable: ${missing.join(', ')}`);
    this.name = 'UnavailableError';
    this.code = 'unavailable';
    this.missing = missing;
  }
}

/**
 * Thrown when one session id resolves to more than one directory.
 */
export class AmbiguousSessionError extends Error {
  /**
   * @param {string} sessionId
   * @param {Array<string>} dirs
   */
  constructor(sessionId, dirs) {
    super(`session ${sessionId} matches ${String(dirs.length)} directories`);
    this.name = 'AmbiguousSessionError';
    this.code = 'ambiguous';
    this.sessionId = sessionId;
    this.dirs = dirs;
  }
}

/**
 * The three DSH services the trash works with.
 */
export class Store {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
  }

  /** @returns {any} the live-session registry (`sessions`) */
  get sessions() {
    return serviceOf(this.ctx, 'sessions');
  }

  /** @returns {any} the durable session log store (`sessionPersistence`) */
  get persistence() {
    return serviceOf(this.ctx, 'sessionPersistence');
  }

  /** @returns {any} the workspace registry (`workspaceRegistry`) */
  get registry() {
    return serviceOf(this.ctx, 'workspaceRegistry');
  }

  /**
   * @param {Array<string>} names
   * @throws {UnavailableError}
   */
  require(...names) {
    const missing = names.filter((name) => this.#read(name) === undefined);
    if (missing.length > 0) throw new UnavailableError(missing);
  }

  /**
   * @param {string} name
   * @returns {any}
   */
  #read(name) {
    if (name === 'sessions') return this.sessions;
    if (name === 'sessionPersistence') return this.persistence;
    if (name === 'workspaceRegistry') return this.registry;
    return serviceOf(this.ctx, name);
  }

  /** @returns {string} the DSH home directory */
  get home() {
    return resolveDshHome();
  }

  /** @returns {string} `<DSH home>/sessions`, the documented store root */
  get sessionRoot() {
    return join(this.home, 'sessions');
  }

  /**
   * Whether a turn is running in this session *right now*.
   *
   * Being present in the session registry is not the same thing: DSH keeps
   * sessions it has loaded (the sidebar retains every row it projects), and
   * refusing those would make most of the list impossible to trash. Only a
   * positive 'running' signal counts, and a file the OS itself will not move
   * is caught by `movePath` separately.
   *
   * @param {string} sessionId
   * @returns {boolean}
   */
  isRunning(sessionId) {
    const sessions = this.sessions;
    if (sessions === undefined || typeof sessions.get !== 'function') return false;
    let session;
    try {
      session = sessions.get(sessionId);
    } catch {
      return false;
    }
    if (session === undefined || session === null) return false;
    return looksRunning(session);
  }

  /**
   * Where one stored session keeps its log directory.
   *
   * `stat()` supplies the header (its `cwd` is worth recording in the trash
   * item) and, on a backend that hands one out, the artifact location. When the
   * backend says nothing about paths, the store is searched for the session's
   * own directory — a lookup, not a guess: the group name is read, never built.
   *
   * @param {string} sessionId
   * @returns {Promise<StoredSession | undefined>}
   */
  async locate(sessionId) {
    const persistence = this.persistence;
    let cwd = '';
    /** @type {string | undefined} */
    let dir;

    if (persistence !== undefined && typeof persistence.stat === 'function') {
      try {
        const snapshot = await persistence.stat(sessionId);
        if (snapshot !== undefined && snapshot !== null) {
          const header = snapshot.header;
          if (header !== null && typeof header === 'object' && typeof header.cwd === 'string') cwd = header.cwd;
          const location = snapshot.location;
          if (location !== null && location !== undefined && typeof location.path === 'string' && location.path !== '') {
            dir = dirname(location.path);
          }
        }
      } catch {
        /* an unreadable or migrated header is not fatal: the store scan decides */
      }
    }

    if (dir === undefined) {
      const candidates = await this.findSessionDirectories(sessionId);
      /* Two directories for one id means the store is inconsistent; moving
         either one would be a guess, so refuse instead. */
      if (candidates.length > 1) throw new AmbiguousSessionError(sessionId, candidates);
      dir = candidates[0];
    }
    if (dir === undefined) return undefined;
    if (!looksLikeSessionDir(dir)) return undefined;

    return { id: sessionId, dir, logFile: await this.findLogFile(dir), cwd };
  }

  /**
   * The names of every session directory in the store, scanned once.
   *
   * Used to answer "which rows the GUI shows have no directory behind them?",
   * which is one pass over the group directories instead of one stat per id.
   *
   * @returns {Promise<Set<string>>}
   */
  async listSessionDirNames() {
    const names = new Set();
    let groups;
    try {
      groups = await readdir(this.sessionRoot, { withFileTypes: true });
    } catch {
      return names;
    }
    for (const group of groups) {
      if (group.isDirectory() !== true) continue;
      let children;
      try {
        children = await readdir(join(this.sessionRoot, group.name), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of children) {
        if (child.isDirectory()) names.add(child.name);
      }
    }
    return names;
  }

  /**
   * Every `<root>/<group>/<sessionId>` directory, with the group it lives in.
   *
   * The inverse of `listSessionDirNames`: that answers "which rows have no
   * directory?", this answers "which directories have no row?" — a session the
   * GUI no longer lists whose files are still on disk.
   *
   * @returns {Promise<Array<{ sessionId: string, dir: string, group: string }>>}
   */
  async listSessionDirs() {
    /** @type {Array<{ sessionId: string, dir: string, group: string }>} */
    const found = [];
    let groups;
    try {
      groups = await readdir(this.sessionRoot, { withFileTypes: true });
    } catch {
      return found;
    }
    for (const group of groups) {
      if (group.isDirectory() !== true) continue;
      let children;
      try {
        children = await readdir(join(this.sessionRoot, group.name), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of children) {
        if (child.isDirectory() !== true) continue;
        /* No name filter: an older DSH stored sessions under a bare uuid, and
           those leftovers are exactly what this scan is for. What counts as a
           session is decided by its contents, not by its name. */
        found.push({
          sessionId: child.name,
          dir: join(this.sessionRoot, group.name, child.name),
          group: group.name,
        });
      }
    }
    return found;
  }

  /**
   * Every `<root>/<group>/<sessionId>` directory in the store, one level down.
   *
   * @param {string} sessionId
   * @returns {Promise<Array<string>>}
   */
  async findSessionDirectories(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return [];
    let groups;
    try {
      groups = await readdir(this.sessionRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    /** @type {Array<string>} */
    const found = [];
    for (const group of groups) {
      if (group.isDirectory() === false) continue;
      const candidate = join(this.sessionRoot, group.name, sessionId);
      if (await exists(candidate)) found.push(candidate);
    }
    return found;
  }

  /**
   * The log file name inside a session directory, for the trash manifest.
   * @param {string} dir
   * @returns {Promise<string>}
   */
  async findLogFile(dir) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) if (entry.isFile() && entry.name.startsWith('session.')) return entry.name;
    } catch {
      /* the manifest simply records no file name */
    }
    return '';
  }
}
