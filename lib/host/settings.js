/**
 * This plugin's own state: the one setting the UI can change, and the
 * human-readable operation log.
 *
 * Both live under `<DSH home>/dsh-session-delete/`, never inside the session
 * store. Every write here is best-effort except the setting itself: a failed
 * log line must not fail the operation it is describing.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { hostname, release, userInfo } from 'node:os';
import { join } from 'node:path';
import { stateDirOf } from './paths.js';

/** Settings file name inside the state directory. */
const SETTINGS_FILE = 'config.json';
/** Operation log file name inside the state directory. */
const LOG_FILE = 'operations.log';
/** Rotate the log once it grows past this size. */
const LOG_ROTATE_BYTES = 1024 * 1024;
/** Longest string kept in a log field; a stack or a title can be enormous. */
const LOG_FIELD_LIMIT = 2000;
/** Largest number of log entries the UI can ask for. */
export const LOG_READ_LIMIT = 500;

/**
 * @typedef {object} PluginSettings
 * @property {string} trashDir empty string means "use the default directory"
 * @property {boolean} autoUpdateCheck ask the repository for a newer version in the background
 * @property {boolean} autoUpdatePull pull and verify it without being asked
 */

/** Defaults for a file that does not exist yet. */
const DEFAULT_SETTINGS = { trashDir: '', autoUpdateCheck: true, autoUpdatePull: false };

/**
 * Read the settings file. A missing or damaged file is the default settings,
 * not an error: the GUI must still open.
 *
 * @param {string} dshHome
 * @returns {Promise<PluginSettings>}
 */
export async function readSettings(dshHome) {
  try {
    const parsed = JSON.parse(await readFile(join(stateDirOf(dshHome), SETTINGS_FILE), 'utf8'));
    if (parsed === null || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS };
    return {
      trashDir: typeof parsed.trashDir === 'string' ? parsed.trashDir : '',
      autoUpdateCheck:
        typeof parsed.autoUpdateCheck === 'boolean' ? parsed.autoUpdateCheck : DEFAULT_SETTINGS.autoUpdateCheck,
      autoUpdatePull:
        typeof parsed.autoUpdatePull === 'boolean' ? parsed.autoUpdatePull : DEFAULT_SETTINGS.autoUpdatePull,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Merge and rewrite the settings file atomically.
 *
 * @param {string} dshHome
 * @param {Partial<PluginSettings>} patch
 * @returns {Promise<PluginSettings>}
 */
export async function writeSettings(dshHome, patch) {
  const dir = stateDirOf(dshHome);
  const next = { ...(await readSettings(dshHome)), ...patch };
  await mkdir(dir, { recursive: true });
  const target = join(dir, SETTINGS_FILE);
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await rename(temp, target);
  return next;
}

/**
 * The request a log line belongs to, without threading a parameter through
 * every caller in between.
 */
const requestContext = new AsyncLocalStorage();

/**
 * Run `work` with the current request visible to `appendOperation`.
 *
 * @template T
 * @param {Record<string, any>} context
 * @param {() => T} work
 * @returns {T}
 */
export function runWithRequest(context, work) {
  return requestContext.run(context, work);
}

/**
 * The request being served, if any.
 * @returns {Record<string, any> | null}
 */
export function currentRequest() {
  const store = requestContext.getStore();
  return store === undefined ? null : store;
}

/**
 * Who was using the app when a line was written.
 * @returns {{ osUser: string, host: string, platform: string, release: string, pid: number }}
 */
export function actorSnapshot() {
  let osUser = '';
  try {
    osUser = userInfo().username;
  } catch {
    osUser = String(process.env.USERNAME ?? process.env.USER ?? '');
  }
  let host = '';
  try {
    host = hostname();
  } catch {
    host = '';
  }
  let osRelease = '';
  try {
    osRelease = release();
  } catch {
    osRelease = '';
  }
  return { osUser, host, platform: process.platform, release: osRelease, pid: process.pid };
}

/**
 * Cap one value so a stack trace or a long title cannot bloat the file.
 * @param {unknown} value
 * @returns {unknown}
 */
function capped(value) {
  if (typeof value === 'string' && value.length > LOG_FIELD_LIMIT) {
    return `${value.slice(0, LOG_FIELD_LIMIT)}…`;
  }
  return value;
}

/**
 * Append one record to the log. Failures are swallowed on purpose: a log
 * line must never fail the operation it describes.
 *
 * Every record carries what a person debugging asks for first — when, who,
 * which request, what was asked, what came back — so one line explains
 * itself without reproducing the session.
 *
 * @param {string} dshHome
 * @param {Record<string, unknown>} entry
 * @returns {Promise<void>}
 */
export async function appendOperation(dshHome, entry) {
  try {
    const dir = stateDirOf(dshHome);
    await mkdir(dir, { recursive: true });
    const file = join(dir, LOG_FILE);
    try {
      if ((await stat(file)).size > LOG_ROTATE_BYTES) await rename(file, `${file}.1`);
    } catch {
      /* no file yet, or rotation was refused: either way, append */
    }
    const at = new Date();
    const request = currentRequest();
    /** @type {Record<string, unknown>} */
    const record = {
      at: at.toISOString(),
      atMs: at.getTime(),
      actor: actorSnapshot(),
      ...(request === null
        ? {}
        : {
            reqId: request.reqId,
            request: {
              route: request.route,
              method: request.method,
              origin: request.origin,
              userAgent: request.userAgent,
              remote: request.remote,
            },
          }),
      ...entry,
    };
    for (const key of Object.keys(record)) record[key] = capped(record[key]);
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    /* the operation itself already succeeded or failed on its own terms */
  }
}

/**
 * Read the newest log entries.
 *
 * @param {string} dshHome
 * @param {number} [limit]
 * @returns {Promise<{ file: string, total: number, entries: Array<Record<string, unknown>> }>}
 */
export async function readOperations(dshHome, limit = 100) {
  const file = join(stateDirOf(dshHome), LOG_FILE);
  const capped = Math.max(1, Math.min(LOG_READ_LIMIT, Math.floor(limit)));
  let raw = '';
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return { file, total: 0, entries: [] };
  }
  const lines = raw.split('\n').filter((line) => line.trim() !== '');
  /** @type {Array<Record<string, unknown>>} */
  const entries = [];
  for (const line of lines.slice(-capped).reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) entries.push(parsed);
    } catch {
      /* a damaged line is skipped, never repaired */
    }
  }
  return { file, total: lines.length, entries };
}

/**
 * Delete the operation log and record that it happened.
 *
 * @param {string} dshHome
 * @returns {Promise<{ removed: number, file: string }>}
 */
export async function clearOperations(dshHome) {
  const file = join(stateDirOf(dshHome), LOG_FILE);
  const { total } = await readOperations(dshHome, LOG_READ_LIMIT);
  await rm(file, { force: true });
  await appendOperation(dshHome, { op: 'log.clear', removed: total });
  return { removed: total, file };
}
