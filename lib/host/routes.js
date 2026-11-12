/**
 * The route table: one same-origin POST endpoint per operation.
 *
 * Route naming follows the plugin id (`/dsh-session-delete/...`) so a route
 * collision with another plugin is impossible, and every answer is JSON with
 * either `{ ok: true, ... }` or `{ ok: false, code }` — the browser half never
 * has to guess what a status code meant.
 */
import { isAbsolute } from 'node:path';
import {
  emptyTrash,
  panelState,
  purgeItems,
  resolveEnv,
  restoreItem,
  restoreItems,
  retireSession,
  retireSessions,
  scanOrphans,
  trashOrphans,
  trashSession,
  trashWorkspace,
} from './actions.js';
import { messageOf, postRoute, sendJson } from './http.js';
import { defaultTrashDir, expandHome, resolveDshHome, resolveTrashDir, stateDirOf } from './paths.js';
import { pickFolder } from './picker.js';
import { appendOperation, clearOperations, readOperations, readSettings, runWithRequest, writeSettings } from './settings.js';
import { resolveTarget, revealPath } from './reveal.js';
import { migrateItems, trashStats } from './trash.js';
import { REPO_SLUG, updater } from './update.js';
import { UnavailableError } from './store.js';

/**
 * Run the automatic check (and, when enabled, the automatic pull) once after
 * the app has booted. Never throws: a failed check leaves the panel saying why.
 *
 * @param {import('./store.js').Store} store
 * @param {{ trashDir?: string }} mountConfig
 * @returns {() => Promise<void>}
 */
export function scheduleAutoUpdate(store, mountConfig) {
  let started = false;
  return async () => {
    if (started) return;
    started = true;
    try {
      const env = await resolveEnv(store, mountConfig);
      if (env.settings.autoUpdateCheck !== true) return;
      updateState = { phase: 'checking', error: null, result: null };
      let checked = (await withDeadline(updater.check(), CHECK_DEADLINE_MS)) ?? { ok: false, code: 'timeout' };
      /* Boot is exactly when a network is least reliable. A failed check is retried
         twice, quietly, before the panel is left saying it could not ask. */
      for (const waitMs of [60_000, 180_000]) {
        if (checked.ok === true || (checked.code !== 'offline' && checked.code !== 'timeout')) break;
        const later = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(true), waitMs);
          if (typeof timer.unref === 'function') timer.unref();
        });
        if (later !== true) break;
        checked = (await withDeadline(updater.check(), CHECK_DEADLINE_MS)) ?? { ok: false, code: 'timeout' };
      }
      updateState = { phase: checked.ok === true ? 'ready' : 'failed', error: checked.ok === true ? null : String(checked.detail ?? checked.code ?? ''), result: checked };
      if (env.settings.autoUpdatePull !== true) return;
      if (checked.ok !== true || checked.newer !== true || checked.updateBlocked !== '') return;
      updateState = { phase: 'updating', error: null, result: checked };
      const applied = await updater.apply();
      updateState = { phase: applied.ok === true ? 'ready' : 'failed', error: applied.ok === true ? null : String(applied.code ?? ''), result: applied };
      await appendOperation(env.dshHome, {
        op: applied.ok === true ? 'update.apply' : 'update.apply.failed',
        from: applied.from,
        to: applied.to,
        code: applied.code,
        changed: applied.changed,
        problems: applied.problems,
      });
    } catch (error) {
      updateState = { phase: 'failed', error: String(error?.message ?? error), result: null };
    }
  };
}

/** Host API generation; the browser half refuses to talk to a different one. */
export const API_VERSION = 3;
/** URL prefix for every route this plugin owns. */
export const ROUTE_PREFIX = '/dsh-session-delete';

/**
 * What the GUI shows about updating: the last check, the phase of a running
 * update, and why it failed. In memory only — a restart re-checks.
 */
let updateState = { phase: 'idle', error: null, result: null };

/**
 * The update block of `/state`.
 *
 * @param {{ settings?: any }} env
 * @returns {Promise<Record<string, unknown>>}
 */
async function updateView(env) {
  let local = '0.0.0';
  try {
    local = (await updater.localPackage()).version;
  } catch {
    local = '0.0.0';
  }
  const settings = env.settings ?? {};
  return {
    local,
    ...(updater.lastCheck === null ? {} : updater.lastCheck),
    phase: updateState.phase,
    error: updateState.error,
    result: updateState.result,
    canUpdate: updater.lastCheck !== null && updater.lastCheck.newer === true,
    autoCheck: settings.autoUpdateCheck === true,
    autoPull: settings.autoUpdatePull === true,
    root: updater.root,
    /* Where to send someone who has to update by hand. */
    repo: updater.lastCheck === null ? REPO_SLUG : updater.lastCheck.repo,
    repoUrl: `https://github.com/${updater.lastCheck === null ? REPO_SLUG : updater.lastCheck.repo}`,
  };
}

/** Longest a check may hold the GUI before it answers "timeout". */
const CHECK_DEADLINE_MS = 15_000;

/**
 * Resolve with `null` when the work outlives its deadline. The work itself is
 * not cancelled — the transports have their own timeouts — but nobody waits on
 * it past the deadline.
 *
 * @template T
 * @param {Promise<T>} work
 * @param {number} ms
 * @returns {Promise<T | null>}
 */
async function withDeadline(work, ms) {
  return await Promise.race([
    work.catch(() => null),
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);
}

/** The settings block both `/state` and `/settings/set` answer with. */
export async function settingsView(store, env) {
  return {
    apiVersion: API_VERSION,
    trashDir: env.trash.dir,
    trashSource: env.trash.source,
    configuredTrashDir: env.configured,
    defaultTrashDir: defaultTrashDir(env.dshHome),
    dshHome: env.dshHome,
    stats: await trashStats(env.trash.dir),
  };
}

/**
 * A summary of an answer, small enough for one log line: scalars survive,
 * arrays collapse to their length, long strings are trimmed.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function summarize(value) {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' && value.length > 200 ? `${value.slice(0, 200)}…` : value;
  }
  if (Array.isArray(value)) {
    return { count: value.length, sample: value.slice(0, 5).map((entry) => summarize(entry)) };
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'client') continue;
    if (Array.isArray(entry)) {
      out[key] = { count: entry.length };
      continue;
    }
    out[key] = summarize(entry);
  }
  return out;
}

/**
 * One request, with everything a person debugging later will want: an id to
 * correlate the domain lines it produced, who asked, what was asked, what
 * came back, how long it took, and the stack if it threw.
 *
 * @param {any} res
 * @param {{ route: string, started: number, failure: unknown, body: any }} info
 * @returns {Record<string, unknown>}
 */
function requestRecord(res, info) {
  const answer = res.__dsdAnswer === undefined ? null : res.__dsdAnswer;
  const payload = answer === null ? {} : answer.value;
  const op = `request.${info.route.replace(`${ROUTE_PREFIX}/`, '').replace(/\//g, '.')}`;
  /** @type {Record<string, unknown>} */
  const record = {
    kind: 'request',
    op,
    ok: answer !== null && payload.ok === true,
    status: answer === null ? 0 : answer.status,
    code: payload.code,
    durationMs: Date.now() - info.started,
    args: summarize(info.body),
    result: answer === null ? null : summarize(payload),
  };
  if (info.failure !== null && info.failure !== undefined) {
    const failure = /** @type {any} */ (info.failure);
    record.error = {
      message: String(failure?.message ?? failure),
      stack: String(failure?.stack ?? ''),
    };
  }
  return record;
}

/**
 * Reads that happen on every page load would drown the file; the domain
 * lines they produce stay.
 *
 * @param {string} op
 * @returns {boolean}
 */
function isChatty(op) {
  return op === 'request.client.report' || op === 'request.log.read';
}

/**
 * Map a domain outcome onto an HTTP status.
 * @param {string | undefined} code
 * @returns {number}
 */
function statusOf(code) {
  if (code === 'live') return 409;
  if (code === 'ambiguous') return 409;
  if (code === 'busy') return 409;
  if (code === 'dirty' || code === 'not-git' || code === 'confirm-required') return 409;
  if (code === 'present' || code === 'still-listed') return 409;
  if (code === 'not-a-session') return 400;
  if (code === 'up-to-date') return 409;
  if (code === 'disabled') return 503;
  if (code === 'exists') return 409;
  if (code === 'unknown-item' || code === 'missing' || code === 'unknown-workspace') return 404;
  if (code === 'unavailable') return 503;
  if (code === 'bad-args' || code === 'not-absolute' || code === 'confirm-required' || code === 'bad-body') return 400;
  return 500;
}

/**
 * Build every handler for one mounted plugin instance.
 *
 * @param {import('./store.js').Store} store
 * @param {{ trashDir?: string }} mountConfig
 * @param {(code: string) => void} report
 * @returns {Map<string, (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>>}
 */
export function buildRoutes(store, mountConfig, report) {
  /**
   * The last thing the browser half said about itself. It lives in memory only:
   * it answers "did the client bundle run, and which slot did it fail to
   * reach?" — a question the web boot audit cannot answer.
   * @type {object | null}
   */
  let clientReport = null;

  /**
   * @param {(body: object, env: object, res: object) => Promise<void>} handler
   * @returns {any}
   */
  const route = (handler) =>
    postRoute(async (body, req, res) => {
      const started = Date.now();
      const routePath = String(req?.url ?? '');
      const context = {
        reqId: `req-${started.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        route: routePath,
        method: String(req?.method ?? ''),
        origin: String(req?.headers?.origin ?? ''),
        userAgent: String(req?.headers?.['user-agent'] ?? ''),
        remote: String(req?.socket?.remoteAddress ?? ''),
      };
      await runWithRequest(context, async () => {
        /** @type {any} */
        let failure = null;
        /** @type {any} */
        let env = null;
        try {
          env = await resolveEnv(store, mountConfig);
          await handler(body, env, res);
        } catch (error) {
          if (error instanceof UnavailableError) {
            sendJson(res, 503, { ok: false, code: 'unavailable', missing: error.missing });
          } else {
            failure = error;
            throw error;
          }
        } finally {
          const record = requestRecord(res, { route: routePath, started, failure, body });
          const op = String(record.op);
          if (isChatty(op) === false) {
            await appendOperation(env === null ? resolveDshHome() : env.dshHome, record);
          }
        }
      });
    }, report);

  /** @type {Map<string, any>} */
  const routes = new Map();

  routes.set(
    `${ROUTE_PREFIX}/client/report`,
    postRoute(async (body, _req, res) => {
      clientReport = {
        phase: typeof body.phase === 'string' ? body.phase : 'unknown',
        registered: typeof body.registered === 'string' ? body.registered : '',
        failures: typeof body.failures === 'string' ? body.failures : '',
        locale: typeof body.locale === 'string' ? body.locale : '',
        patched: body.patched === true,
        error: typeof body.error === 'string' ? body.error : '',
        at: typeof body.at === 'string' ? body.at : new Date().toISOString(),
        receivedAt: new Date().toISOString(),
      };
      sendJson(res, 200, { ok: true });
    }, report),
  );

  routes.set(
    `${ROUTE_PREFIX}/state`,
    route(async (_body, env, res) => {
      const panel = await panelState(store, env);
      sendJson(res, 200, {
        ok: true,
        ...(await settingsView(store, env)),
        ...panel,
        apiVersion: API_VERSION,
        update: await updateView(env),
        client: clientReport,
      });
    }),
  );

  routes.set(
    `${ROUTE_PREFIX}/session/move`,
    route(async (body, env, res) => {
      if (typeof body.sessionId !== 'string' || body.sessionId === '') {
        sendJson(res, 400, { ok: false, code: 'bad-args' });
        return;
      }
      const result = await trashSession(store, env, body.sessionId, body.title);
      sendJson(res, result.ok ? 200 : statusOf(result.code), { apiVersion: API_VERSION, ...result });
    }),
  );

  /* The other direction: directories on disk that the app no longer lists. */
  routes.set(
    `${ROUTE_PREFIX}/scan`,
    route(async (_body, env, res) => {
      const result = await scanOrphans(store, env);
      sendJson(res, 200, { apiVersion: API_VERSION, ...result });
    }),
  );

  routes.set(
    `${ROUTE_PREFIX}/scan/trash`,
    route(async (body, env, res) => {
      if (!Array.isArray(body.sessionIds)) {
        sendJson(res, 400, { ok: false, code: 'bad-args' });
        return;
      }
      const result = await trashOrphans(store, env, body.sessionIds);
      sendJson(res, result.ok === true ? 200 : statusOf(String(result.code)), { apiVersion: API_VERSION, ...result });
    }),
  );

  /* A ghost row: the store still lists it, the log directory is gone. */
  routes.set(
    `${ROUTE_PREFIX}/session/retire`,
    route(async (body, env, res) => {
      if (Array.isArray(body.sessionIds)) {
        const batch = await retireSessions(store, env, body.sessionIds);
        sendJson(res, batch.ok === true ? 200 : statusOf(String(batch.code)), { apiVersion: API_VERSION, ...batch });
        return;
      }
      if (typeof body.sessionId !== 'string' || body.sessionId === '') {
        sendJson(res, 400, { ok: false, code: 'bad-args' });
        return;
      }
      const result = await retireSession(store, env, body.sessionId, body.title);
      sendJson(res, result.ok === true ? 200 : statusOf(String(result.code)), { apiVersion: API_VERSION, ...result });
    }),
  );

  routes.set(
    `${ROUTE_PREFIX}/workspace/move`,
    route(async (body, env, res) => {
      if (typeof body.workspaceId !== 'string' || body.workspaceId === '') {
        sendJson(res, 400, { ok: false, code: 'bad-args' });
        return;
      }
      const result = await trashWorkspace(store, env, body.workspaceId);
      sendJson(res, result.ok ? 200 : statusOf(result.code), { apiVersion: API_VERSION, ...result });
    }),
  );

  routes.set(
    `${ROUTE_PREFIX}/item/restore`,
    route(async (body, env, res) => {
      if (Array.isArray(body.trashIds)) {
        const batch = await restoreItems(store, env, body.trashIds);
        sendJson(res, batch.ok === true ? 200 : statusOf(String(batch.code)), { apiVersion: API_VERSION, ...batch });
        return;
      }
      if (typeof body.trashId !== 'string' || body.trashId === '') {
        sendJson(res, 400, { ok: false, code: 'bad-args' });
        return;
      }
      const result = await restoreItem(store, env, body.trashId);
      sendJson(res, result.ok ? 200 : statusOf(result.code), { apiVersion: API_VERSION, ...result });
    }),
  );

  routes.set(
    `${ROUTE_PREFIX}/empty`,
    route(async (body, env, res) => {
      if (body.confirm !== true) {
        sendJson(res, 400, { ok: false, code: 'confirm-required' });
        return;
      }
      const result = await emptyTrash(store, env);
      sendJson(res, 200, { apiVersion: API_VERSION, ...result });
    }),
  );

  routes.set(
    `${ROUTE_PREFIX}/item/remove`,
    route(async (body, env, res) => {
      const ids = Array.isArray(body.trashIds) ? body.trashIds : typeof body.trashId === 'string' ? [body.trashId] : [];
      if (ids.length === 0) {
        sendJson(res, 400, { ok: false, code: 'bad-args' });
        return;
      }
      const result = await purgeItems(store, env, ids);
      sendJson(res, result.ok ? 200 : statusOf(result.code), { apiVersion: API_VERSION, ...result });
    }),
  );

  routes.set(
    `${ROUTE_PREFIX}/update/check`,
    route(async (_body, env, res) => {
      updateState = { phase: 'checking', error: null, result: updateState.result };
      /* A check that never returns would leave the panel saying "checking"
         forever; a deadline turns that into an answer a person can act on. */
      const checked = await withDeadline(updater.check(), CHECK_DEADLINE_MS);
      const result = checked === null ? { ok: false, code: 'timeout' } : checked;
      updateState = { phase: result.ok === true ? 'ready' : 'failed', error: result.ok === true ? null : String(result.detail ?? result.code ?? ''), result };
      sendJson(res, 200, { apiVersion: API_VERSION, ...result, update: await updateView(env) });
    }),
  );

  routes.set(
    `${ROUTE_PREFIX}/update/apply`,
    route(async (body, env, res) => {
      if (body.confirm !== true) {
        sendJson(res, 400, { ok: false, code: 'confirm-required' });
        return;
      }
      updateState = { phase: 'updating', error: null, result: updateState.result };
      /* The pre-update copy of the tree lives next to the plugin's own state, so
         a rollback survives even a restart. */
      const result = await updater.apply({ backupRoot: stateDirOf(env.dshHome) });
      updateState = { phase: result.ok === true ? 'ready' : 'failed', error: result.ok === true ? null : String(result.code ?? ''), result };
      sendJson(res, result.ok === true ? 200 : statusOf(String(result.code)), { apiVersion: API_VERSION, ...result, update: await updateView(env) });
    }),
  );

  routes.set(
    `${ROUTE_PREFIX}/settings/set`,
    route(async (body, env, res) => {
      /* The update toggles are independent of the folder, so a request
         carrying only those must not be treated as a bad folder. */
      const wantsUpdateToggle =
        typeof body.autoUpdateCheck === 'boolean' || typeof body.autoUpdatePull === 'boolean';
      if (typeof body.trashDir !== 'string') {
        if (wantsUpdateToggle) {
          const patch = {};
          if (typeof body.autoUpdateCheck === 'boolean') patch.autoUpdateCheck = body.autoUpdateCheck;
          if (typeof body.autoUpdatePull === 'boolean') patch.autoUpdatePull = body.autoUpdatePull;
          await writeSettings(env.dshHome, patch);
          await appendOperation(env.dshHome, {
            op: 'settings.update',
            autoUpdateCheck: patch.autoUpdateCheck,
            autoUpdatePull: patch.autoUpdatePull,
          });
          sendJson(res, 200, { ok: true, apiVersion: API_VERSION, ...(await settingsView(store, env)) });
          return;
        }
        sendJson(res, 400, { ok: false, code: 'bad-args' });
        return;
      }
      const raw = body.trashDir.trim();
      if (raw !== '' && !isAbsolute(expandHome(raw))) {
        sendJson(res, 400, { ok: false, code: 'not-absolute', detail: raw });
        return;
      }
      /* Resolve the target first: an overlap with the session store is refused
         before anything moves. */
      let target;
      try {
        target =
          raw === ''
            ? { dir: defaultTrashDir(env.dshHome), source: 'default' }
            : resolveTrashDir({
                dshHome: env.dshHome,
                candidates: [{ value: raw, source: 'settings' }],
                sessionRoots: [env.sessionRoot],
              });
      } catch (error) {
        /* An unusable folder is the user's typo, not a server fault. */
        sendJson(res, 400, { ok: false, code: 'trash-dir', detail: messageOf(error) });
        return;
      }
      const migrate = body.migrate !== false;
      let migrated = 0;
      if (migrate) {
        const outcome = await migrateItems(env.trash.dir, target.dir);
        if (outcome.ok !== true) {
          sendJson(res, 409, { ok: false, code: outcome.code, detail: outcome.detail });
          return;
        }
        migrated = outcome.migrated;
      }
      await writeSettings(env.dshHome, { trashDir: raw });
      await appendOperation(env.dshHome, {
        op: 'settings.set',
        trashDir: raw,
        effective: target.dir,
        previous: env.trash.dir,
        migrated,
      });
      const settings = await readSettings(env.dshHome);
      sendJson(res, 200, {
        ok: true,
        apiVersion: API_VERSION,
        trashDir: target.dir,
        trashSource: target.source,
        configuredTrashDir: settings.trashDir,
        migrated,
        previous: env.trash.dir,
      });
    }),
  );

  /* The GUI cannot open a native dialog; the host does it for the folder field. */
  routes.set(
    `${ROUTE_PREFIX}/pick-dir`,
    route(async (body, env, res) => {
      const start = typeof body.start === 'string' && body.start !== '' ? expandHome(body.start) : env.trash.dir;
      const picked = await pickFolder({ start, title: '垃圾桶目录' });
      if (picked.ok !== true) {
        sendJson(res, 200, { ok: false, code: picked.code, detail: picked.detail });
        return;
      }
      sendJson(res, 200, { ok: true, path: picked.path, via: picked.via });
    }),
  );

  routes.set(
    `${ROUTE_PREFIX}/reveal`,
    route(async (body, env, res) => {
      /* An orphan's directory is not one of the plugin's own paths, so it is
         resolved from the session id by scanning the store — never from a path
         the caller sends. */
      if (body.target === 'orphan') {
        if (typeof body.sessionId !== 'string' || body.sessionId === '') {
          sendJson(res, 400, { ok: false, code: 'bad-args' });
          return;
        }
        const dirs = await store.findSessionDirectories(body.sessionId);
        if (dirs.length === 0) {
          sendJson(res, 404, { ok: false, code: 'missing' });
          return;
        }
        const outcome = revealPath(dirs[0]);
        sendJson(res, 200, { ok: true, target: 'orphan', path: outcome.path, opened: outcome.opened });
        return;
      }
      const resolved = resolveTarget(body.target, { dshHome: env.dshHome, trashDir: env.trash.dir });
      if (resolved.ok !== true) {
        sendJson(res, 400, { ok: false, code: resolved.code });
        return;
      }
      const outcome = revealPath(resolved.path);
      sendJson(res, 200, { ok: true, target: body.target, path: outcome.path, opened: outcome.opened });
    }),
  );

  routes.set(
    `${ROUTE_PREFIX}/log/read`,
    route(async (body, env, res) => {
      const limit = typeof body.limit === 'number' && body.limit > 0 ? body.limit : 100;
      const log = await readOperations(env.dshHome, limit);
      sendJson(res, 200, { ok: true, apiVersion: API_VERSION, ...log });
    }),
  );

  routes.set(
    `${ROUTE_PREFIX}/log/clear`,
    route(async (_body, env, res) => {
      const cleared = await clearOperations(env.dshHome);
      sendJson(res, 200, { ok: true, apiVersion: API_VERSION, ...cleared });
    }),
  );

  return routes;
}
