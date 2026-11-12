/**
 * Where DSH keeps its data, and how this plugin decides where the trash lives.
 *
 * A DSH session log lives at `<DSH home>/sessions/<group>/<session>/<file>`;
 * the session store's own API is the only authority on that path, so nothing
 * here guesses: `sessionsRootOf()` is applied to a path the store reported.
 */
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { stat } from 'node:fs/promises';

/** Env var the desktop host also honours. */
const HOME_ENV = 'DSH_HOME';
/** Directory holding this plugin's own state (settings + operation log). */
const STATE_DIR_NAME = 'dsh-session-delete';

/**
 * Expand a leading `~` to the user's home directory.
 * @param {string} value
 * @returns {string}
 */
export function expandHome(value) {
  const text = String(value);
  if (text === '~') return homedir();
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2));
  return text;
}

/**
 * Whether `child` is `parent` or inside it. Used to refuse any path a manifest
 * could use to move or delete files outside the trash directory.
 * @param {string} child
 * @param {string} parent
 * @returns {boolean}
 */
export function isInside(child, parent) {
  const inner = resolve(child);
  const outer = resolve(parent);
  if (inner === outer) return true;
  return inner.startsWith(outer.endsWith(sep) ? outer : `${outer}${sep}`);
}

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
export async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The session store root a session-log path belongs to.
 *
 * @param {string} logPath `<home>/sessions/<group>/<session>/<file>`
 * @returns {string} `<home>/sessions`
 */
export function sessionsRootOf(logPath) {
  return dirname(dirname(dirname(logPath)));
}

/**
 * Whether a directory has the `<...>/sessions/<group>/<session>` shape. Only
 * such directories are ever moved or restored.
 *
 * @param {string} sessionDir
 * @returns {boolean}
 */
export function looksLikeSessionDir(sessionDir) {
  return basename(dirname(dirname(sessionDir))) === 'sessions';
}

/**
 * Resolve the DSH home directory: `DSH_HOME` when the host sets it, `~/.dsh`
 * otherwise (which is where the desktop application keeps its data).
 *
 * @returns {string}
 */
export function resolveDshHome() {
  const fromEnv = process.env[HOME_ENV];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return resolve(expandHome(fromEnv.trim()));
  return join(homedir(), '.dsh');
}

/**
 * This plugin's own state directory.
 * @param {string} dshHome
 * @returns {string}
 */
export function stateDirOf(dshHome) {
  return join(dshHome, STATE_DIR_NAME);
}

/**
 * The trash directory the plugin falls back to when nothing is configured.
 * @param {string} dshHome
 * @returns {string}
 */
export function defaultTrashDir(dshHome) {
  return join(dshHome, 'trash', 'sessions');
}

/**
 * Resolve the effective trash directory and say where the answer came from.
 *
 * Precedence is the caller's candidate order: the setting saved from the UI,
 * then the mount row's `config.trashDir`, then the default under DSH home. A
 * configured directory must be absolute and must not overlap the session store,
 * because "move to trash" would otherwise shuffle files back into the store it
 * is supposed to leave, and "empty trash" could delete live records.
 *
 * @param {object} options
 * @param {string} options.dshHome
 * @param {Array<{ value: unknown, source: string }>} options.candidates
 * @param {Array<string>} options.sessionRoots
 * @returns {{ dir: string, source: string }}
 */
export function resolveTrashDir({ dshHome, candidates, sessionRoots }) {
  for (const candidate of candidates) {
    if (typeof candidate.value !== 'string' || candidate.value.trim() === '') continue;
    const expanded = expandHome(candidate.value.trim());
    if (!isAbsolute(expanded)) throw new Error(`trashDir must be an absolute path: ${candidate.value}`);
    const dir = resolve(expanded);
    for (const root of sessionRoots) {
      if (typeof root !== 'string' || root === '') continue;
      if (isInside(dir, root) || isInside(root, dir)) {
        throw new Error(`trashDir must not overlap the session store: ${dir} vs ${root}`);
      }
    }
    return { dir, source: candidate.source };
  }
  return { dir: defaultTrashDir(dshHome), source: 'default' };
}
