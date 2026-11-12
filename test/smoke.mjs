/**
 * Host-half smoke test: real directories, fake DSH services.
 *
 * Run with `node test/smoke.mjs`. Everything happens in a temp directory that
 * is removed afterwards; no DSH data is touched.
 */
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import zlib from 'node:zlib';
import { dirname } from 'node:path';
import { join } from 'node:path';
import assert from 'node:assert/strict';

import plugin, { normalizeConfig } from '../index.js';
import { cleanTitle } from '../lib/host/actions.js';
import { moveErrorCode } from '../lib/host/trash.js';
import { gzipSync } from 'node:zlib';
import { pickerArgv, pickFolder } from '../lib/host/picker.js';
import { createUpdater, isNetworkFailure, isNewer, repoOf, versionParts } from '../lib/host/update.js';

let checks = 0;
function check(name, condition, detail) {
  checks += 1;
  if (!condition) {
    console.error(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`);
    process.exitCode = 1;
    return;
  }
  console.log(`ok   ${name}`);
}

/* ---------------------------------------------------------------- fixtures */

const here = dirname(fileURLToPath(import.meta.url));
const home = await mkdtemp(join(tmpdir(), 'dsd-smoke-'));
const sessionsRoot = join(home, 'sessions');
const groupDir = join(sessionsRoot, 'C-Users-Test-project');
const sessionA = { id: 'session-a', dir: join(groupDir, 'session-a') };
const sessionB = { id: 'session-b', dir: join(groupDir, 'session-b') };
const sessionRetained = { id: 'session-retained', dir: join(groupDir, 'session-retained') };
const workspace = { id: 'ws-1', title: 'Project', path: 'C:\\Users\\Test\\project', sessionIds: ['session-a', 'session-b'] };

for (const session of [sessionA, sessionB, sessionRetained]) {
  await mkdir(session.dir, { recursive: true });
  await writeFile(join(session.dir, 'session.v4.jsonl.zstd'), 'log-line\n', 'utf8');
}

process.env.DSH_HOME = home;

/**
 * A stand-in for the three DSH services the plugin talks to.
 * @returns {any}
 */
function fakeServices() {
  const archived = new Set();
  const workspaces = new Map([[workspace.id, { ...workspace, sessionIds: [...workspace.sessionIds] }]]);
  const stored = [
    { header: { id: sessionA.id, cwd: workspace.path }, location: { path: join(sessionA.dir, 'session.v4.jsonl.zstd') } },
    { header: { id: sessionB.id, cwd: workspace.path }, location: { path: join(sessionB.dir, 'session.v4.jsonl.zstd') } },
    { header: { id: sessionRetained.id, cwd: workspace.path }, location: { path: join(sessionRetained.dir, 'session.v4.jsonl.zstd') } },
    /* Listed by the store, absent from disk: ghost rows. */
    { header: { id: 'session-ghost', cwd: workspace.path }, location: { path: join(groupDir, 'session-ghost', 'session.v4.jsonl.zstd') } },
    { header: { id: 'session-ghost2', cwd: workspace.path }, location: { path: join(groupDir, 'session-ghost2', 'session.v4.jsonl.zstd') } },
  ];
  const live = new Set();
  const retainedIdle = new Set();

  const entity = (row) => ({
    id: row.id,
    title: row.title,
    path: row.path,
    get sessionIds() {
      return row.sessionIds;
    },
    async attachSession(id) {
      if (!row.sessionIds.includes(id)) row.sessionIds.push(id);
    },
    async detachSession(id) {
      row.sessionIds = row.sessionIds.filter((value) => value !== id);
    },
  });

  return {
    /* DSH keeps every session it has loaded; only a running turn is a reason
       to refuse. `retainedIdle` models the rows the sidebar has projected. */
    sessions: {
      get: (id) => {
        if (live.has(id)) {
          return { id, status: 'running' };
        }
        if (retainedIdle.has(id)) {
          return { id, status: 'idle' };
        }
        return undefined;
      },
    },
    sessionPersistence: {
      list: async () => stored,
      /* The shipped backend describes a session but hands out no path, which is
         exactly why the store scans for the directory. */
      stat: async (id) => {
        const row = stored.find((candidate) => candidate.header.id === id);
        return row === undefined ? undefined : { header: row.header, revision: 'rev-1', sizeBytes: 9 };
      },
    },
    workspaceRegistry: {
      get archivedSessionIds() {
        return [...archived];
      },
      list: () => [...workspaces.values()].map(entity),
      get: (id) => (workspaces.has(id) ? entity(workspaces.get(id)) : undefined),
      async archiveSession(id) {
        archived.add(id);
      },
      async unarchiveSession(id) {
        archived.delete(id);
      },
      async delete(id) {
        return workspaces.delete(id);
      },
      async create(path, title) {
        const row = { id: 'ws-restored', title: title ?? '', path, sessionIds: [] };
        workspaces.set(row.id, row);
        return entity(row);
      },
    },
    /** Test hooks: which sessions look live, which we archived, which exist. */
    __live: live,
    __archived: archived,
    __idle: retainedIdle,
    __archived: archived,
    __workspaces: workspaces,
  };
}

/**
 * Boot the plugin against a fake context and capture its routes.
 * @param {any} services
 * @param {object} [config]
 */
function boot(services, config) {
  const routes = new Map();
  const ctx = {
    get: (name) => services[name],
    effect: (factory) => factory(),
    inject: (names, callback) => names.forEach(() => callback(ctx)),
    webServer: {
      register: ({ path, handler }) => {
        routes.set(path, handler);
        return () => routes.delete(path);
      },
    },
  };
  plugin.apply(ctx, config);
  services.__ctx = ctx;
  return routes;
}

/**
 * @param {Map<string, Function>} routes
 * @param {string} path
 * @param {object} [body]
 * @param {{ origin?: string, host?: string, method?: string }} [options]
 */
async function call(routes, path, body, options) {
  const handler = routes.get(path);
  assert.ok(handler !== undefined, `route ${path} is registered`);
  const payload = JSON.stringify(body === undefined ? {} : body);
  const req = {
    url: path,
    socket: { remoteAddress: '127.0.0.1' },
    method: options?.method ?? 'POST',
    headers: {
      host: options?.host ?? '127.0.0.1:8080',
      origin: options?.origin ?? 'http://127.0.0.1:8080',
      'user-agent': 'smoke-test',
    },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload, 'utf8');
    },
  };
  const res = {
    statusCode: 0,
    body: '',
    setHeader() {},
    writeHead(status) {
      this.statusCode = status;
    },
    end(chunk) {
      this.body = chunk ?? '';
    },
  };
  await handler(req, res);
  return { status: res.statusCode, body: res.body === '' ? null : JSON.parse(res.body) };
}

/* ------------------------------------------------------------------- tests */

const services = fakeServices();
const routes = boot(services, {});

check('every documented route is registered', routes.size === 17, [...routes.keys()].join(', '));
check('config normalization rejects junk', normalizeConfig('nope').trashDir === '' && normalizeConfig({ trashDir: '  ' }).trashDir === '');
check('a quoted title loses its quotes', cleanTitle('  "论文截图"  ') === '论文截图', cleanTitle('  "论文截图"  '));
check('a locked record reads as busy, not as a copy fallback', moveErrorCode({ code: 'EPERM' }) === 'busy' && moveErrorCode({ code: 'EBUSY' }) === 'busy' && moveErrorCode({ code: 'EACCES' }) === 'busy');
check('a cross-volume move still falls back to copy', moveErrorCode({ code: 'EXDEV' }) === 'copy' && moveErrorCode({ code: 'ENOTSUP' }) === 'copy');
check('an unknown failure is left alone', moveErrorCode({ code: 'ENOENT' }) === undefined && moveErrorCode(undefined) === undefined);
check('a quoted title keeps inner punctuation', cleanTitle('“a · b”') === 'a · b', cleanTitle('“a · b”'));
check('a long title is capped', cleanTitle('x'.repeat(200)).length === 120, String(cleanTitle('x'.repeat(200)).length));

const state0 = await call(routes, '/dsh-session-delete/state');
check('state answers ok', state0.status === 200 && state0.body.ok === true, JSON.stringify(state0.body));
check('trash starts empty', Array.isArray(state0.body.items) && state0.body.items.length === 0);
check('state lists the workspace', state0.body.workspaces.length === 1 && state0.body.workspaces[0].sessionCount === 2);
check('trash dir defaults under DSH home', state0.body.trashDir === join(home, 'trash', 'sessions'), state0.body.trashDir);

const clientReport = await call(routes, '/dsh-session-delete/client/report', {
  phase: 'client.applied',
  registered: 'main,settings.section',
  failures: '',
  locale: 'zh',
});
check('the browser half can report what it registered', clientReport.status === 200 && clientReport.body.ok === true);
const stateWithReport = await call(routes, '/dsh-session-delete/state');
check(
  'the report is visible to whoever reads the state',
  stateWithReport.body.client !== null && stateWithReport.body.client.phase === 'client.applied',
  JSON.stringify(stateWithReport.body.client),
);

const crossOrigin = await call(routes, '/dsh-session-delete/state', {}, { origin: 'http://evil.example' });
check('cross-origin requests are refused', crossOrigin.status === 403 && crossOrigin.body.code === 'cross-origin');

const wrongMethod = await call(routes, '/dsh-session-delete/state', {}, { method: 'GET' });
check('non-POST requests are refused', wrongMethod.status === 405);

const moved = await call(routes, '/dsh-session-delete/session/move', { sessionId: 'session-a', title: '  仓颉编译器实验截图  ' });
check('session moves to the trash', moved.status === 200 && moved.body.ok === true, JSON.stringify(moved.body));
check('the log directory left the session store', !existsSync(sessionA.dir));
check('the sidebar row was archived for us', services.__archived.has('session-a'));
check('an item directory with a manifest exists', existsSync(join(state0.body.trashDir, 'items', moved.body.trashId, 'manifest.json')));

const again = await call(routes, '/dsh-session-delete/session/move', { sessionId: 'session-a' });
check('moving a session twice answers 404', again.status === 404, JSON.stringify(again.body));

services.__idle.add('session-retained');
const retainedMove = await call(routes, '/dsh-session-delete/session/move', { sessionId: 'session-retained', title: '已加载但空闲的会话' });
check(
  'a session the sidebar has loaded but is not running can still be trashed',
  retainedMove.status === 200 && retainedMove.body.ok === true,
  JSON.stringify(retainedMove.body),
);
const retainedRestore = await call(routes, '/dsh-session-delete/item/restore', { trashId: retainedMove.body.trashId });
check('that move can be undone again', retainedRestore.status === 200, JSON.stringify(retainedRestore.body));
services.__idle.delete('session-retained');

services.__live.add('session-b');
const liveDenied = await call(routes, '/dsh-session-delete/session/move', { sessionId: 'session-b' });
check('a live session is refused', liveDenied.status === 409 && liveDenied.body.code === 'live', JSON.stringify(liveDenied.body));
services.__live.delete('session-b');

const state1 = await call(routes, '/dsh-session-delete/state');
check('the trash lists the moved session', state1.body.items.length === 1 && state1.body.items[0].kind === 'session');
check('the item remembers its workspace', state1.body.items[0].workspaceId === 'ws-1');
check(
  'the panel shows the name the GUI showed, not the id',
  state1.body.items[0].title === '仓颉编译器实验截图' && state1.body.items[0].sessionId === 'session-a',
  JSON.stringify({ title: state1.body.items[0].title, id: state1.body.items[0].sessionId }),
);
check('a recorded name is marked as such', state1.body.items[0].titleSource === 'name', String(state1.body.items[0].titleSource));
check(
  'every trashed session reports the workspace it came from',
  state1.body.items.every((item) => typeof item.workspacePath === 'string' && typeof item.workspaceTitle !== 'undefined'),
  JSON.stringify(state1.body.items.map((item) => [item.workspaceId, item.workspacePath])),
);

const restored = await call(routes, '/dsh-session-delete/item/restore', { trashId: moved.body.trashId });
check(
  'restore puts the session back',
  restored.status === 200 && existsSync(join(sessionA.dir, 'session.v4.jsonl.zstd')),
  JSON.stringify(restored.body),
);
check('restore undoes our archive flag', !services.__archived.has('session-a'));

const state2 = await call(routes, '/dsh-session-delete/state');
check('the trash is empty again', state2.body.items.length === 0);

const wholeWorkspace = await call(routes, '/dsh-session-delete/workspace/move', { workspaceId: 'ws-1' });
check('a whole workspace moves as one item', wholeWorkspace.status === 200 && wholeWorkspace.body.trashed === 2, JSON.stringify(wholeWorkspace.body));
check('both log directories left the store', !existsSync(sessionA.dir) && !existsSync(sessionB.dir));
check('the workspace registration was removed', wholeWorkspace.body.workspaceRemoved === true);

const restoredWorkspace = await call(routes, '/dsh-session-delete/item/restore', { trashId: wholeWorkspace.body.trashId });
check(
  'the workspace restore reports sessions',
  restoredWorkspace.status === 200 && restoredWorkspace.body.sessions === 2,
  JSON.stringify(restoredWorkspace.body),
);
check('both log directories are back', existsSync(sessionA.dir) && existsSync(sessionB.dir));

const settings = await call(routes, '/dsh-session-delete/settings/set', { trashDir: '', migrate: true });
check('the default trash directory is accepted', settings.status === 200 && settings.body.ok === true, JSON.stringify(settings.body));

const relative = await call(routes, '/dsh-session-delete/settings/set', { trashDir: 'relative/path' });
check('a relative trash directory is refused', relative.status === 400 && relative.body.code === 'not-absolute');

const overlap = await call(routes, '/dsh-session-delete/settings/set', { trashDir: join(sessionsRoot, 'trash') });
check('a trash directory inside the session store is refused', overlap.status === 400 && overlap.body.code === 'trash-dir', JSON.stringify(overlap.body));

const moved2 = await call(routes, '/dsh-session-delete/session/move', { sessionId: 'session-b' });
check('a second session can be moved', moved2.status === 200, JSON.stringify(moved2.body));
const untitled = await call(routes, '/dsh-session-delete/state');
const untitledItem = untitled.body.items.find((entry) => entry.sessionId === 'session-b');
check(
  'a session moved without a title falls back to its folder name',
  untitledItem !== undefined && untitledItem.title === 'project' && untitledItem.titleSource === 'folder',
  JSON.stringify(untitledItem),
);
check('empty requires confirmation', (await call(routes, '/dsh-session-delete/empty', {})).status === 400);
const emptied = await call(routes, '/dsh-session-delete/empty', { confirm: true });
check('empty removes the items', emptied.status === 200 && emptied.body.removed >= 1, JSON.stringify(emptied.body));
check('empty is permanent', !existsSync(join(state0.body.trashDir, 'items', moved2.body.trashId)));
check(
  'empty keeps the archive flag, so no phantom row comes back',
  services.__archived.has('session-b'),
  JSON.stringify([...services.__archived]),
);

const log = await call(routes, '/dsh-session-delete/log/read', { limit: 50 });
check('the operation log recorded the moves', log.status === 200 && log.body.total > 0 && log.body.entries.length > 0);
const moveEntry = log.body.entries.find((entry) => entry.op === 'session.trash' && entry.sessionId === 'session-a');
check(
  'the log entry carries the name the row showed',
  moveEntry !== undefined && moveEntry.sessionTitle === '仓颉编译器实验截图',
  JSON.stringify(moveEntry),
);
check('the log names its file for the detail view', typeof log.body.file === 'string' && log.body.file.endsWith('operations.log'), String(log.body.file));
const requestRecord0 = log.body.entries.find((entry) => entry.kind === 'request');
check(
  'every request is written down with who, when and what',
  requestRecord0 !== undefined &&
    typeof requestRecord0.reqId === 'string' &&
    requestRecord0.reqId.startsWith('req-') &&
    typeof requestRecord0.atMs === 'number' &&
    typeof requestRecord0.durationMs === 'number' &&
    typeof requestRecord0.actor === 'object' &&
    typeof requestRecord0.actor.platform === 'string' &&
    typeof requestRecord0.request === 'object' &&
    String(requestRecord0.request.route).indexOf('/dsh-session-delete/') === 0,
  JSON.stringify(requestRecord0),
);
check(
  'the request record says what came back',
  typeof requestRecord0.result === 'object' && requestRecord0.result !== null,
  JSON.stringify(requestRecord0.result),
);
check(
  'a domain line carries the same request id',
  moveEntry.reqId !== undefined && String(moveEntry.reqId).startsWith('req-') && typeof moveEntry.atMs === 'number',
  JSON.stringify({ reqId: moveEntry.reqId, atMs: moveEntry.atMs }),
);
const failedRequest = log.body.entries.find((entry) => entry.kind === 'request' && entry.ok === false && entry.code !== undefined);
check(
  'a refused request records the code it answered with',
  failedRequest !== undefined && typeof failedRequest.status === 'number' && failedRequest.status >= 400,
  JSON.stringify(failedRequest),
);
process.env.DSH_SESSION_DELETE_NO_OPEN = '1';
const revealed = await call(routes, '/dsh-session-delete/reveal', { target: 'log' });
check(
  'the log file can be handed to the file manager',
  revealed.status === 200 && revealed.body.ok === true && revealed.body.opened === false && String(revealed.body.path).endsWith('operations.log'),
  JSON.stringify(revealed.body),
);
const revealedTrash = await call(routes, '/dsh-session-delete/reveal', { target: 'trash' });
check('the trash folder can be opened too', revealedTrash.status === 200 && revealedTrash.body.path === state0.body.trashDir, JSON.stringify(revealedTrash.body));
const badTarget = await call(routes, '/dsh-session-delete/reveal', { target: '../../etc' });
check('an arbitrary path is refused', badTarget.status === 400 && badTarget.body.code === 'unknown-target', JSON.stringify(badTarget.body));

process.env.DSH_SESSION_DELETE_NO_PICKER = '1';
const pickBlocked = await call(routes, '/dsh-session-delete/pick-dir', {});
check(
  'the folder picker can be unavailable without breaking the route',
  pickBlocked.status === 200 && pickBlocked.body.ok === false && pickBlocked.body.code === 'unsupported',
  JSON.stringify(pickBlocked.body),
);

process.env.DSH_SESSION_DELETE_NO_UPDATE = '1';
const updateBlock = await call(routes, '/dsh-session-delete/state');
check(
  'the state carries the update block',
  updateBlock.body.update !== undefined && typeof updateBlock.body.update.local === 'string' && updateBlock.body.update.autoCheck === true,
  JSON.stringify(updateBlock.body.update),
);
check(
  'automatic pulling is off by default',
  updateBlock.body.update.autoPull === false,
  String(updateBlock.body.update.autoPull),
);
const updateCheck = await call(routes, '/dsh-session-delete/update/check');
check(
  'a check can be disabled outright',
  updateCheck.status === 200 && updateCheck.body.ok === false && updateCheck.body.code === 'disabled',
  JSON.stringify(updateCheck.body),
);
const updateNoConfirm = await call(routes, '/dsh-session-delete/update/apply', {});
check(
  'an update without confirmation is refused',
  updateNoConfirm.status === 400 && updateNoConfirm.body.code === 'confirm-required',
  JSON.stringify(updateNoConfirm.body),
);

const emptyAnswer = await call(routes, '/dsh-session-delete/empty', { confirm: true });
check(
  'emptying the trash answers ok, not just a count',
  emptyAnswer.status === 200 && emptyAnswer.body.ok === true,
  JSON.stringify(emptyAnswer.body),
);
check('and it reports what it removed', typeof emptyAnswer.body.removed === 'number', JSON.stringify(emptyAnswer.body));

const cleared = await call(routes, '/dsh-session-delete/log/clear');
check('the log can be cleared', cleared.status === 200 && cleared.body.ok === true);

const noServices = fakeServices();
delete noServices.sessionPersistence;
const bareRoutes = boot(noServices, {});
const unavailable = await call(bareRoutes, '/dsh-session-delete/state');
check(
  'a missing service answers 503 instead of crashing',
  unavailable.status === 503 && unavailable.body.code === 'unavailable',
  JSON.stringify(unavailable.body),
);

/* ------------------------------------------------------------- teardown */

const stateDir = join(home, 'dsh-session-delete');
if (existsSync(stateDir)) check('state directory stays inside DSH home', (await readdir(stateDir)).length > 0);
await rm(home, { recursive: true, force: true });

/* ------------------------------------------- recovering a name from the log */

/**
 * Write a session log the way DSH does: independent zstd frames, one per batch,
 * each decompressing to JSON lines. The title lives in a `session/title` event.
 *
 * @param {string} dir
 * @param {{ id: string, titles: string[] }} spec
 */
async function writeZstdSessionLog(dir, spec) {
  await mkdir(dir, { recursive: true });
  const frames = [
    JSON.stringify({ type: 'session', version: 4, id: spec.id, createdAt: 1, cwd: 'C:\\Users\\Test\\project' }),
    ...spec.titles.map((title, index) =>
      JSON.stringify({
        type: 'session/title',
        seq: index,
        time: index,
        data: { title, messageSeqs: [0], source: { kind: 'fallback' } },
      }),
    ),
  ];
  const parts = frames.map((line) => zlib.zstdCompressSync(Buffer.from(`${line}\n`, 'utf8')));
  await writeFile(join(dir, 'session.v4.jsonl.zstd'), Buffer.concat(parts));
}

const recoveredDir = join(groupDir, 'session-recovered');
await writeZstdSessionLog(recoveredDir, { id: 'session-recovered', titles: ['第一条占位标题', '日志里的名字'] });
const lateTitleDir = join(groupDir, 'session-late-title');
await writeZstdSessionLog(lateTitleDir, { id: 'session-late-title', titles: ['日志里的名字2'] });

const naming = boot(fakeServices(), {});
const recovered = await call(naming, '/dsh-session-delete/session/move', { sessionId: 'session-recovered' });
check('a session with no client title is named from its log', recovered.status === 200, JSON.stringify(recovered.body));
const namedState = await call(naming, '/dsh-session-delete/state');
const recoveredItem = namedState.body.items.find((entry) => entry.sessionId === 'session-recovered');
check(
  'the log title wins over the first fallback title',
  recoveredItem !== undefined && recoveredItem.title === '日志里的名字' && recoveredItem.titleSource === 'name',
  JSON.stringify(recoveredItem),
);

const withClient = await call(naming, '/dsh-session-delete/session/move', { sessionId: 'session-late-title', title: '客户端给的名字' });
check('a client-supplied title is used as given', withClient.status === 200, JSON.stringify(withClient.body));
const itemManifestPath = join(namedState.body.trashDir, 'items', withClient.body.trashId, 'manifest.json');
const itemManifest = JSON.parse(await readFile(itemManifestPath, 'utf8'));
check('the manifest stores the client title', itemManifest.sessionTitle === '客户端给的名字', String(itemManifest.sessionTitle));

/* An item trashed before names were recorded: no field, but the log still has it. */
delete itemManifest.sessionTitle;
await writeFile(itemManifestPath, `${JSON.stringify(itemManifest, null, 2)}
`, 'utf8');
const backfilled = await call(naming, '/dsh-session-delete/state');
const backfilledItem = backfilled.body.items.find((entry) => entry.sessionId === 'session-late-title');
check(
  'an item with no stored name is named from the log it carries',
  backfilledItem !== undefined && backfilledItem.title === '日志里的名字2' && backfilledItem.titleSource === 'name',
  JSON.stringify(backfilledItem),
);

/* ------------------------------------------------ deleting one item at a time */

const purged = await call(naming, '/dsh-session-delete/item/remove', { trashIds: [recoveredItem.trashId] });
check('one item can be deleted on its own', purged.status === 200 && purged.body.removed === 1, JSON.stringify(purged.body));
const afterPurge = await call(naming, '/dsh-session-delete/state');
check(
  'the other item survives a single deletion',
  afterPurge.body.items.length === 1 && afterPurge.body.items[0].sessionId === 'session-late-title',
  JSON.stringify(afterPurge.body.items.map((item) => item.sessionId)),
);
const purgeUnknown = await call(naming, '/dsh-session-delete/item/remove', { trashIds: ['no-such-item'] });
check('deleting an unknown item answers 404', purgeUnknown.status === 404 && purgeUnknown.body.code === 'unknown-item', JSON.stringify(purgeUnknown.body));
const purgeNothing = await call(naming, '/dsh-session-delete/item/remove', {});
check('deleting nothing answers 400', purgeNothing.status === 400 && purgeNothing.body.code === 'bad-args', JSON.stringify(purgeNothing.body));
const purgeLog = await call(naming, '/dsh-session-delete/log/read', { limit: 20 });
const purgeEntry = purgeLog.body.entries.find((entry) => entry.op === 'trash.purge');
check(
  'the log names what was deleted',
  purgeEntry !== undefined && Array.isArray(purgeEntry.titles) && purgeEntry.titles[0] === '日志里的名字',
  JSON.stringify(purgeEntry),
);

/* ----------------------------------------- finding a session without a path */

/* The shipped backend describes a session but never hands out a log path, so
   the store must find the directory by reading the tree. These fixtures use a
   group name nobody could compute (escaped CJK, the real on-disk spelling) and
   a session id without the usual `session-` prefix. */
const weirdGroup = join(sessionsRoot, '--C-Users-Test-~65B0~5EFA~6587~4EF6-5939--');
const weirdDir = join(weirdGroup, 'session-weird');
await mkdir(weirdDir, { recursive: true });
await writeFile(join(weirdDir, 'session.v4.jsonl.zstd'), 'x\n', 'utf8');

const dupA = join(groupDir, 'session-dup');
const dupB = join(weirdGroup, 'session-dup');
for (const dir of [dupA, dupB]) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'session.v4.jsonl.zstd'), 'x\n', 'utf8');
}

const listOnly = join(groupDir, 'session-list-only');
await mkdir(listOnly, { recursive: true });
await writeFile(join(listOnly, 'session.v4.jsonl.zstd'), 'x\n', 'utf8');

/** A backend that keeps artifacts but reports no `location`. */
function descriptiveServices() {
  const services = fakeServices();
  services.sessionPersistence = {
    /* The store names these; only some of them have a directory on disk. */
    list: async () => [
      { header: { id: 'session-ghost' } },
      { header: { id: 'session-ghost2' } },
      { header: { id: 'session-present' } },
    ],
    stat: async (id) => ({ header: { id, cwd: 'C:\\Users\\Test\\project' }, revision: 'rev-1', sizeBytes: 3 }),
  };
  return services;
}

const discoveryServices = descriptiveServices();
const discovered = boot(discoveryServices, {});
const movedWeird = await call(discovered, '/dsh-session-delete/session/move', { sessionId: 'session-weird' });
check('a session under an uncomputable group name is found', movedWeird.status === 200, JSON.stringify(movedWeird.body));
check('the discovered directory really moved', !existsSync(weirdDir));

const duplicated = await call(discovered, '/dsh-session-delete/session/move', { sessionId: 'session-dup' });
check(
  'an id that lives in two groups is refused, not guessed',
  duplicated.status === 409 && duplicated.body.code === 'ambiguous',
  JSON.stringify(duplicated.body),
);
check('neither duplicate moved', existsSync(dupA) && existsSync(dupB));

const listOnlyServices = fakeServices();
listOnlyServices.sessionPersistence = { list: async () => [] };
const bareDiscovery = boot(listOnlyServices, {});
const movedListOnly = await call(bareDiscovery, '/dsh-session-delete/session/move', { sessionId: 'session-list-only' });
check(
  'a backend with no stat() still lets the store find the session',
  movedListOnly.status === 200,
  JSON.stringify(movedListOnly.body),
);
check('that directory moved too', !existsSync(listOnly));

const presentDir = join(sessionsRoot, 'C-Users-Test-project', 'session-present');
await mkdir(presentDir, { recursive: true });
await writeFile(join(presentDir, 'session.v4.jsonl.zstd'), 'x\n', 'utf8');

/* Bulk restore: a selection must be able to go back, not only away. */
const bulkDirA = join(sessionsRoot, 'C-Users-Test-project', 'session-bulk-1');
const bulkDirB = join(sessionsRoot, 'C-Users-Test-project', 'session-bulk-2');
await mkdir(bulkDirA, { recursive: true });
await mkdir(bulkDirB, { recursive: true });
await writeFile(join(bulkDirA, 'session.v4.jsonl.zstd'), 'abc\n', 'utf8');
await writeFile(join(bulkDirB, 'session.v4.jsonl.zstd'), 'abcd\n', 'utf8');
const bulkMoveA = await call(routes, '/dsh-session-delete/session/move', { sessionId: 'session-bulk-1', title: '批量甲' });
const bulkMoveB = await call(routes, '/dsh-session-delete/session/move', { sessionId: 'session-bulk-2', title: '批量乙' });
const bulkState = await call(routes, '/dsh-session-delete/state');
const bulkIds = [bulkMoveA.body.trashId, bulkMoveB.body.trashId];
const bulkSize = bulkState.body.items.filter((item) => bulkIds.includes(item.trashId)).map((item) => item.sizeBytes);
check(
  'a trashed record remembers its size',
  bulkSize.length === 2 && bulkSize.every((size) => typeof size === 'number' && size > 0),
  JSON.stringify(bulkSize),
);
const bulkRestore = await call(routes, '/dsh-session-delete/item/restore', { trashIds: bulkIds });
check(
  'a selection can be restored in one request',
  bulkRestore.status === 200 && bulkRestore.body.ok === true && bulkRestore.body.restored === 2,
  JSON.stringify(bulkRestore.body),
);
check(
  'and both directories are back',
  existsSync(bulkDirA) && existsSync(bulkDirB),
  JSON.stringify([existsSync(bulkDirA), existsSync(bulkDirB)]),
);
const partialMove = await call(routes, '/dsh-session-delete/session/move', { sessionId: 'session-bulk-1', title: '批量丙' });
const partialRestore = await call(routes, '/dsh-session-delete/item/restore', {
  trashIds: [partialMove.body.trashId, 'no-such-item'],
});
check(
  'a partly impossible restore reports both numbers',
  partialRestore.status === 200 && partialRestore.body.ok === true && partialRestore.body.restored === 1 &&
    Array.isArray(partialRestore.body.failed) && partialRestore.body.failed.length === 1,
  JSON.stringify(partialRestore.body),
);
const allFail = await call(routes, '/dsh-session-delete/item/restore', { trashIds: ['nope-1', 'nope-2'] });
check(
  'a restore that cannot do anything fails with a code',
  allFail.status === 404 && allFail.body.ok === false && allFail.body.code === 'unknown-item',
  JSON.stringify(allFail.body),
);

const ghostState = await call(discovered, '/dsh-session-delete/state');
const ghostIds = (ghostState.body.ghosts ?? []).map((entry) => entry.sessionId);
check(
  'the panel names the rows with no directory behind them',
  ghostIds.includes('session-ghost2') && ghostIds.includes('session-present') === false,
  JSON.stringify(ghostIds),
);

const ghostMove = await call(discovered, '/dsh-session-delete/session/move', { sessionId: 'session-ghost' });
check(
  'a session whose directory is gone cannot be moved',
  ghostMove.status === 404 && ghostMove.body.code === 'missing',
  JSON.stringify(ghostMove.body),
);
const ghostRetire = await call(discovered, '/dsh-session-delete/session/retire', { sessionId: 'session-ghost', title: '幽灵会话' });
check(
  'a ghost row can be archived instead',
  ghostRetire.status === 200 && ghostRetire.body.ok === true && ghostRetire.body.retired === true,
  JSON.stringify(ghostRetire.body),
);
check(
  'archiving the ghost row really reaches the registry',
  discoveryServices.__archived.has('session-ghost'),
  JSON.stringify([...discoveryServices.__archived]),
);
const retireTwice = await call(discovered, '/dsh-session-delete/session/retire', { sessionId: 'session-ghost' });
check(
  'archiving twice is harmless and says it was already archived',
  retireTwice.status === 200 && retireTwice.body.alreadyArchived === true,
  JSON.stringify(retireTwice.body),
);
const retireExisting = await call(discovered, '/dsh-session-delete/session/retire', { sessionId: 'session-present' });
check(
  'a session that still has a directory is not retired',
  retireExisting.status === 409 && retireExisting.body.code === 'present',
  JSON.stringify(retireExisting.body),
);
const retireNothing = await call(discovered, '/dsh-session-delete/session/retire', {});
check(
  'retiring nothing answers 400',
  retireNothing.status === 400 && retireNothing.body.code === 'bad-args',
  JSON.stringify(retireNothing.body),
);
const bulkRetire = await call(discovered, '/dsh-session-delete/session/retire', { sessionIds: ['session-ghost2'] });
check(
  'ghost rows can be archived in one request',
  bulkRetire.status === 200 && bulkRetire.body.retired === 1,
  JSON.stringify(bulkRetire.body),
);
const afterBulk = await call(discovered, '/dsh-session-delete/state');
check(
  'an archived ghost leaves the list',
  (afterBulk.body.ghosts ?? []).every((entry) => entry.sessionId !== 'session-ghost2'),
  JSON.stringify((afterBulk.body.ghosts ?? []).map((entry) => entry.sessionId)),
);

const ghostLog = await call(discovered, '/dsh-session-delete/log/read', { limit: 50 });
const retireEntry = ghostLog.body.entries.find((entry) => entry.op === 'session.retire' && entry.sessionTitle === '幽灵会话');
check(
  'the archive decision is written down',
  retireEntry !== undefined && retireEntry.reason === 'no-directory' && retireEntry.sessionTitle === '幽灵会话',
  JSON.stringify(retireEntry),
);

const unknown = await call(discovered, '/dsh-session-delete/session/move', { sessionId: 'no-such-session' });
check('an unknown id answers 404', unknown.status === 404 && unknown.body.code === 'missing', JSON.stringify(unknown.body));

/* ---------------------------------------------------------------- updates */

/**
 * Build a GitHub-shaped tarball: entries under one top directory, ustar headers,
 * gzipped — the shape `codeload` serves.
 *
 * @param {Record<string, string>} files paths inside the archive, without the top dir
 * @returns {Buffer}
 */
function makeTarball(files) {
  /** @type {Buffer[]} */
  const blocks = [];
  const push = (name, content) => {
    const data = Buffer.from(content, 'utf8');
    const header = Buffer.alloc(512, 0);
    header.write(name, 0, 100, 'utf8');
    header.write('0000644' + String.fromCharCode(0), 100, 8, 'utf8');
    header.write('0000000' + String.fromCharCode(0), 108, 8, 'utf8');
    header.write('0000000' + String.fromCharCode(0), 116, 8, 'utf8');
    header.write(data.length.toString(8).padStart(11, '0') + String.fromCharCode(0), 124, 12, 'utf8');
    header.write('00000000000' + String.fromCharCode(0), 136, 12, 'utf8');
    header.write('0', 156, 1, 'utf8');
    header.write('ustar', 257, 6, 'utf8');
    header.write('00', 263, 2, 'utf8');
    header.fill(32, 148, 156);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(sum.toString(8).padStart(6, '0') + String.fromCharCode(0) + ' ', 148, 8, 'utf8');
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512, 0));
  };
  for (const [name, content] of Object.entries(files)) push('dsh-session-delete-abc1234/' + name, content);
  blocks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(blocks));
}

/** The files of one plugin release, as an archive would carry them. */
function releaseFiles(version, options = {}) {
  return {
    'package.json': JSON.stringify({
      name: 'dsh-session-delete',
      version,
      main: 'index.js',
      exports: { './client': './client.js' },
      dsh: { manifestVersion: 1 },
      engines: { dsh: options.enginesDsh ?? '>=0.2.1-rc.2 <0.3.0' },
    }),
    'index.js': 'export const apply = () => {};\n',
    'client.js':
      options.brokenClient === true
        ? 'this is not javascript at all(\n'
        : 'window.__ModuleLoader__.load({ id: "dsh-session-delete", factory() {} });\n',
    'lib/host/plugin.js': 'export {};\n',
  };
}

/** A throwaway checkout that the fake git mutates. */
async function updateFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsd-update-'));
  if (options.withoutGit !== true) await mkdir(join(root, '.git'), { recursive: true });
  await mkdir(join(root, 'lib', 'host'), { recursive: true });
  const pkg = { name: 'dsh-session-delete', version: '2.2.0', main: 'index.js', exports: { './client': './client.js' }, dsh: { manifestVersion: 1 }, engines: { dsh: '>=0.2.1-rc.2 <0.3.0' } };
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  await writeFile(join(root, 'index.js'), 'export const apply = () => {};\n', 'utf8');
  await writeFile(join(root, 'client.js'), 'window.__ModuleLoader__.load({ id: "dsh-session-delete", factory() {} });\n', 'utf8');
  await writeFile(join(root, 'lib', 'host', 'plugin.js'), 'export {};\n', 'utf8');
  return root;
}

/**
 * A git that answers from a script instead of a repository. A pull rewrites the
 * checkout, so verification has something real to check.
 */
function fakeGit(root, options) {
  const calls = [];
  const okResult = (stdout) => ({ code: 0, stdout, stderr: '', timedOut: false });
  const git = async (line) => {
    calls.push(line);
    if (line === 'rev-parse --is-inside-work-tree') return okResult(options.git === false ? 'false' : 'true');
    if (line === 'remote get-url origin') return okResult('https://github.com/Lsy1949/dsh-session-delete.git');
    if (line === 'symbolic-ref --short HEAD') return okResult('main');
    if (line === 'rev-parse HEAD') return okResult(options.git === false ? '' : 'abcdef1234567890');
    if (line.indexOf('status --porcelain') === 0) return okResult(options.dirty === true ? ' M client.js\n' : '');
    if (line.indexOf('fetch --quiet') === 0) {
      return options.fetchFails === true
        ? { code: 1, stdout: '', stderr: 'no network', timedOut: false }
        : okResult('');
    }
    if (line.indexOf('show origin/main:package.json') === 0) {
      return okResult(JSON.stringify({ version: options.remoteVersion ?? '2.3.0', engines: { dsh: options.remoteEngines ?? '>=0.2.1-rc.2 <0.3.0' } }));
    }
    if (line.indexOf('pull --ff-only') === 0) {
      if (options.pullFailsNetwork === true) {
        return { code: 1, stdout: '', stderr: "fatal: unable to access 'https://github.com/Lsy1949/dsh-session-delete.git/': Failed to connect to github.com port 443", timedOut: false };
      }
      if (options.pullFails === true) return { code: 1, stdout: '', stderr: 'not possible to fast-forward', timedOut: false };
      const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      pkg.version = options.pullVersion ?? '2.3.0';
      await writeFile(join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
      if (options.pullBreaksClient === true) {
        await writeFile(join(root, 'client.js'), 'this is not javascript at all(\n', 'utf8');
      }
      return okResult('');
    }
    if (line.indexOf('reset --hard') === 0) {
      const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      pkg.version = '2.2.0';
      await writeFile(join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
      await writeFile(join(root, 'client.js'), 'window.__ModuleLoader__.load({ id: "dsh-session-delete", factory() {} });\n', 'utf8');
      return okResult('');
    }
    if (line.indexOf('diff --name-only') === 0) return okResult('package.json\nclient.js\n');
    return { code: 1, stdout: '', stderr: 'unexpected: ' + line, timedOut: false };
  };
  const run = async (argv) => {
    if (argv.length === 2 && argv[1] === '--version') {
      /* The resolver probes the binary before using it; `noBinary` models a
         checkout whose git cannot be run from the app's environment. */
      return options.noBinary === true
        ? { code: -1, stdout: '', stderr: 'ENOENT', timedOut: false }
        : okResult('git version 2.42.0');
    }
    if (argv[0] !== 'git') {
      if (argv[1] === '--check') {
        const target = argv[2];
        const source = await readFile(target, 'utf8').catch(() => '');
        const broken = options.pullBreaksClient === true && target.endsWith('client.js') && source.indexOf('not javascript') >= 0;
        return broken ? { code: 1, stdout: '', stderr: 'SyntaxError', timedOut: false } : okResult('');
      }
      return okResult('');
    }
    return await git(argv.slice(1).join(' '));
  };
  /* The raw manifest the updater reads first; served from the same options. */
  const fetchText = async () =>
    JSON.stringify({
      version: options.remoteVersion ?? '2.3.0',
      engines: { dsh: options.remoteEngines ?? '>=0.2.1-rc.2 <0.3.0' },
    });

  const fetchBytes = async () =>
    makeTarball(releaseFiles(options.pullVersion ?? '2.3.0', { brokenClient: options.pullBreaksClient === true }));

  return { run, calls, fetchText, fetchBytes };
}

delete process.env.DSH_SESSION_DELETE_NO_UPDATE;
check('versions compare numerically', isNewer('2.2.0', '2.3.0') === true && isNewer('2.10.0', '2.9.0') === false && isNewer('2.2.0', '2.2.0') === false);
check(
  'a git failure caused by the network is recognised as such',
  isNetworkFailure("fatal: unable to access 'https://github.com/x.git/': Failed to connect") === true &&
    isNetworkFailure('Recv failure: Connection was aborted') === true &&
    isNetworkFailure('not possible to fast-forward') === false,
  JSON.stringify([isNetworkFailure('Failed to connect'), isNetworkFailure('not possible to fast-forward')]),
);
check('a version with a suffix still parses', versionParts('v2.3.1-beta.2').join('.') === '2.3.1', versionParts('v2.3.1-beta.2').join('.'));
check('a git url yields owner/repo', repoOf('https://github.com/Lsy1949/dsh-session-delete.git') === 'Lsy1949/dsh-session-delete' && repoOf('git@github.com:a/b.git') === 'a/b');

{
  const root = await updateFixture();
  const git = fakeGit(root, {});
  const updater = createUpdater({ root, run: git.run, fetchText: git.fetchText, fetchBytes: git.fetchBytes });
  const result = await updater.check();
  check('a newer version is detected from git', result.ok === true && result.newer === true && result.remote === '2.3.0', JSON.stringify(result));
  check('the check reads the raw manifest, which needs no git at all', result.source === 'http', String(result.source));
  check(
    'and therefore never runs a git fetch',
    git.calls.every((line) => line.indexOf('fetch') < 0),
    git.calls.join(' | '),
  );
  check('the check reports whether the DSH range changed', result.enginesChanged === false, JSON.stringify(result));
  const applied = await updater.apply();
  check('applying an update moves the checkout forward', applied.ok === true && applied.from === '2.2.0' && applied.to === '2.3.0', JSON.stringify(applied));
  check('the applied update reports a restart is required', applied.restartRequired === true, JSON.stringify(applied));
  await rm(root, { recursive: true, force: true });
}

{
  const root = await updateFixture();
  const git = fakeGit(root, { dirty: true });
  const updater = createUpdater({ root, run: git.run, fetchText: git.fetchText, fetchBytes: git.fetchBytes });
  const applied = await updater.apply();
  check('a dirty worktree is never pulled', applied.ok === false && applied.code === 'dirty', JSON.stringify(applied));
  check('a refused update never runs git pull', git.calls.every((line) => line.indexOf('pull') < 0), git.calls.join(' | '));
  await rm(root, { recursive: true, force: true });
}

{
  const root = await updateFixture();
  const git = fakeGit(root, { pullBreaksClient: true });
  const updater = createUpdater({ root, run: git.run, fetchText: git.fetchText, fetchBytes: git.fetchBytes });
  const applied = await updater.apply();
  check('a pull that breaks the bundle is rolled back', applied.ok === false && applied.code === 'rolled-back', JSON.stringify(applied));
  check('the rollback names what was wrong', Array.isArray(applied.problems) && applied.problems.length > 0, JSON.stringify(applied.problems));
  const restored = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  check('the tree is back on the old version', restored.version === '2.2.0', restored.version);
  check('a rollback actually ran git reset', git.calls.some((line) => line.indexOf('reset --hard') === 0), git.calls.join(' | '));
  await rm(root, { recursive: true, force: true });
}

{
  const root = await updateFixture({ withoutGit: true });
  const git = fakeGit(root, { git: false });
  const updater = createUpdater({ root, run: git.run, fetchText: git.fetchText, fetchBytes: git.fetchBytes });
  const result = await updater.check();
  check(
    'an install that is not a checkout can still check for a new version',
    result.ok === true && result.newer === true && result.installKind === 'copy',
    JSON.stringify(result),
  );
  check(
    'and a copy is offered the update, because HTTPS needs no git',
    result.canUpdate === true && result.updateBlocked === '',
    JSON.stringify({ canUpdate: result.canUpdate, updateBlocked: result.updateBlocked }),
  );
  const overHttp = await updater.apply();
  check(
    'a copy can update itself over HTTPS, without git',
    overHttp.ok === true && overHttp.via === 'http' && overHttp.to === '2.3.0',
    JSON.stringify(overHttp),
  );
  check(
    'and the new version is on disk',
    JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version === '2.3.0',
    'version did not change',
  );
  await rm(root, { recursive: true, force: true });
}

{
  const root = await updateFixture();
  const git = fakeGit(root, { pullFails: true });
  const updater = createUpdater({ root, run: git.run, fetchText: git.fetchText, fetchBytes: git.fetchBytes });
  const applied = await updater.apply();
  check('a diverged branch is put back and reported', applied.ok === false && applied.code === 'pull-failed', JSON.stringify(applied));
  check('the failed pull still resets', git.calls.some((line) => line.indexOf('reset --hard') === 0), git.calls.join(' | '));
  await rm(root, { recursive: true, force: true });
}

{
  const root = await updateFixture();
  const git = fakeGit(root, { remoteEngines: '>=0.3.0 <0.4.0' });
  const updater = createUpdater({ root, run: git.run, fetchText: git.fetchText, fetchBytes: git.fetchBytes });
  const result = await updater.check();
  check('a changed DSH range is flagged by the check', result.enginesChanged === true && result.newer === true, JSON.stringify(result));
  const applied = await updater.apply();
  check('an update that changes the DSH range is refused before pulling', applied.ok === false && applied.code === 'engines-changed' && applied.localEngines !== applied.remoteEngines, JSON.stringify(applied));
  check('the refused range change never runs git pull', git.calls.every((line) => line.indexOf('pull') < 0), git.calls.join(' | '));
  const untouched = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  check('the refused update leaves the checkout alone', untouched.version === '2.2.0', untouched.version);
  await rm(root, { recursive: true, force: true });
}

{
  const root = await updateFixture();
  const git = fakeGit(root, { remoteVersion: '2.2.0' });
  const updater = createUpdater({ root, run: git.run, fetchText: git.fetchText, fetchBytes: git.fetchBytes });
  const result = await updater.check();
  check('an up-to-date checkout says so', result.ok === true && result.newer === false && result.canUpdate === false, JSON.stringify(result));
  await rm(root, { recursive: true, force: true });
}

{
  const root = await updateFixture();
  const git = fakeGit(root, { remoteVersion: '2.4.0' });
  const asked = [];
  const updater = createUpdater({
    root,
    run: git.run,
    fetchText: async (url) => {
      asked.push(url);
      throw new Error('no route to this host');
    },
  });
  const result = await updater.check();
  check('a raw host that refuses falls back to the checkout', result.ok === true && result.source === 'git' && result.remote === '2.4.0', JSON.stringify(result));
  check(
    'and it tries every manifest host before giving up',
    asked.length === 3 &&
      asked[0].includes('raw.githubusercontent.com') &&
      asked[1].includes('github.com') &&
      asked[2].includes('api.github.com'),
    JSON.stringify(asked),
  );
}

{
  /* The network this was written on: raw.githubusercontent.com blocked while
     github.com answers. The second host must carry the check. */
  const root = await updateFixture({ withoutGit: true });
  const git = fakeGit(root, { remoteVersion: '2.5.0' });
  const tried = [];
  const updater = createUpdater({
    root,
    run: git.run,
    fetchText: async (url) => {
      tried.push(url);
      if (url.includes('raw.githubusercontent.com')) throw new Error('blocked');
      return JSON.stringify({ version: '2.5.0', engines: { dsh: '>=0.2.1-rc.2 <0.3.0' } });
    },
    fetchBytes: git.fetchBytes,
  });
  const result = await updater.check();
  check(
    'a blocked raw host does not fail the check',
    result.ok === true && result.remote === '2.5.0' && result.source === 'http',
    JSON.stringify({ ok: result.ok, remote: result.remote, source: result.source }),
  );
  check('the second manifest host is the one that answered', tried.length === 2 && tried[1].includes('github.com'), JSON.stringify(tried));
  await rm(root, { recursive: true, force: true });
}

{
  const root = await updateFixture();
  const git = fakeGit(root, { fetchFails: true });
  const updater = createUpdater({
    root,
    run: git.run,
    fetchText: async () => { throw new Error('fetch failed'); },
  });
  const result = await updater.check();
  check('a machine with no network is told so', result.ok === false && result.code === 'offline', JSON.stringify(result));
  check('the offline answer keeps the reason', String(result.detail).length > 0, String(result.detail));
  check(
    'an offline answer still says which kind of install this is',
    result.installKind === 'git' && result.gitAvailable === true && result.local === '2.2.0',
    JSON.stringify({ installKind: result.installKind, gitAvailable: result.gitAvailable, local: result.local }),
  );
  check('and it does not claim an update is possible', result.canUpdate === false, String(result.canUpdate));
  await rm(root, { recursive: true, force: true });
}

{
  const root = await updateFixture();
  const git = fakeGit(root, { noBinary: true });
  const updater = createUpdater({ root, run: git.run, fetchText: git.fetchText, fetchBytes: git.fetchBytes });
  const result = await updater.check();
  check(
    'a checkout whose git cannot run is still reported as a checkout',
    result.ok === true && result.installKind === 'git' && result.gitAvailable === false,
    JSON.stringify({ installKind: result.installKind, gitAvailable: result.gitAvailable }),
  );
  check(
    'and a checkout without git is still offered the update',
    result.canUpdate === true && result.gitAvailable === false,
    JSON.stringify({ canUpdate: result.canUpdate, gitAvailable: result.gitAvailable }),
  );
  const overHttp = await updater.apply();
  check(
    'a checkout with no working git also updates over HTTPS',
    overHttp.ok === true && overHttp.via === 'http' && overHttp.to === '2.3.0',
    JSON.stringify(overHttp),
  );
  await rm(root, { recursive: true, force: true });
}

process.env.DSH_SESSION_DELETE_NO_UPDATE = '1';
{
  const root = await updateFixture();
  const git = fakeGit(root, {});
  const updater = createUpdater({ root, run: git.run, fetchText: git.fetchText, fetchBytes: git.fetchBytes });
  const result = await updater.check();
  check('the kill switch disables checking', result.ok === false && result.code === 'disabled', JSON.stringify(result));
  await rm(root, { recursive: true, force: true });
}

delete process.env.DSH_SESSION_DELETE_NO_UPDATE;
{
  /* A copy, so the HTTPS path runs: the staged tree is checked *before* anything
     lands, which is the whole point of staging it. */
  const root = await updateFixture({ withoutGit: true });
  const git = fakeGit(root, { remoteVersion: '2.3.0', pullVersion: '2.3.0', pullBreaksClient: true });
  const updater = createUpdater({ root, run: git.run, fetchText: git.fetchText, fetchBytes: git.fetchBytes });
  const applied = await updater.apply({ backupRoot: root + '-backups' });
  check(
    'a release that does not parse is refused before it lands',
    applied.ok === false && applied.code === 'verify-failed',
    JSON.stringify(applied),
  );
  check(
    'and the tree still runs the old version',
    JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version === '2.2.0',
    'version changed anyway',
  );
  await rm(root, { recursive: true, force: true });
  await rm(root + '-backups', { recursive: true, force: true });
}

delete process.env.DSH_SESSION_DELETE_NO_UPDATE;
{
  const root = await updateFixture();
  const escaping = makeTarball({
    ...releaseFiles('2.3.0'),
    '../escape.txt': 'this must never be written',
    'lib/host/../../escape2.txt': 'nor this',
  });
  const git = fakeGit(root, { remoteVersion: '2.3.0', pullVersion: '2.3.0' });
  const updater = createUpdater({
    root,
    run: git.run,
    fetchText: git.fetchText,
    fetchBytes: async () => escaping,
  });
  const applied = await updater.apply({ backupRoot: root + '-backups' });
  check('an archive with escaping paths still installs the safe files', applied.ok === true, JSON.stringify(applied));
  check(
    'and nothing was written outside the package',
    existsSync(join(dirname(root), 'escape.txt')) === false && existsSync(join(root, 'escape2.txt')) === false,
    'a path escaped the package',
  );
  await rm(root, { recursive: true, force: true });
  await rm(root + '-backups', { recursive: true, force: true });
}

{
  /* A checkout whose `git pull` cannot reach the remote still updates: the tarball
     needs nothing but HTTPS. */
  const root = await updateFixture();
  const git = fakeGit(root, { remoteVersion: '2.3.0', pullVersion: '2.3.0', pullFailsNetwork: true });
  const updater = createUpdater({ root, run: git.run, fetchText: git.fetchText, fetchBytes: git.fetchBytes });
  const applied = await updater.apply({ backupRoot: root + '-backups' });
  check(
    'a checkout whose git cannot reach the remote falls back to HTTPS',
    applied.ok === true && applied.via === 'http' && applied.to === '2.3.0',
    JSON.stringify(applied),
  );
  check('and it remembers why git was not used', String(applied.gitError ?? '').includes('unable to access'), String(applied.gitError));
  check(
    'the fallback really wrote the new version',
    JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version === '2.3.0',
    'version did not change',
  );
  await rm(root, { recursive: true, force: true });
  await rm(root + '-backups', { recursive: true, force: true });
}

/* ------------------------------------------------------------ orphan scan */

{
  const scanDir = join(sessionsRoot, 'C-Users-Test-project', 'session-orphan1');
  await writeZstdSessionLog(scanDir, { id: 'session-orphan1', titles: ['遗留会话'] });

  const scanned = await call(routes, '/dsh-session-delete/scan', {});
  check('the scan answers', scanned.status === 200 && scanned.body.ok === true, JSON.stringify(scanned.body));
  check(
    'a directory with no row behind it is found',
    Array.isArray(scanned.body.items) && scanned.body.items.some((item) => item.sessionId === 'session-orphan1'),
    JSON.stringify(scanned.body.items?.map((item) => item.sessionId)),
  );
  check(
    'the scan names it from the log it still has',
    scanned.body.items.some((item) => item.sessionId === 'session-orphan1' && item.title === '遗留会话'),
    JSON.stringify(scanned.body.items?.find((item) => item.sessionId === 'session-orphan1')),
  );
  check(
    'a listed session is not reported as an orphan',
    scanned.body.items.every((item) => item.sessionId !== 'session-a'),
    JSON.stringify(scanned.body.items?.map((item) => item.sessionId)),
  );

  const movedOut = await call(routes, '/dsh-session-delete/scan/trash', { sessionIds: ['session-orphan1'] });
  check(
    'an orphan can be moved into the trash',
    movedOut.status === 200 && movedOut.body.ok === true && movedOut.body.trashed === 1,
    JSON.stringify(movedOut.body),
  );
  check('and its directory left the store', existsSync(scanDir) === false, String(existsSync(scanDir)));

  const afterTrash = await call(routes, '/dsh-session-delete/state', {});
  const orphanItem = afterTrash.body.items.find((item) => item.sessionId === 'session-orphan1');
  check(
    'it appears in the trash, still named',
    orphanItem !== undefined && orphanItem.title === '遗留会话',
    JSON.stringify(afterTrash.body.items?.map((item) => item.title)),
  );

  const scannedAgain = await call(routes, '/dsh-session-delete/scan', {});
  check(
    'the scan does not report what is already in the trash',
    scannedAgain.body.items.every((item) => item.sessionId !== 'session-orphan1'),
    JSON.stringify(scannedAgain.body.items?.map((item) => item.sessionId)),
  );

  const restored = await call(routes, '/dsh-session-delete/item/restore', { trashId: orphanItem.trashId });
  check('an orphan can be put back', restored.status === 200 && restored.body.ok === true, JSON.stringify(restored.body));
  check('and the directory is back where it was', existsSync(scanDir) === true, String(existsSync(scanDir)));

  /* An older DSH stored sessions under a bare uuid; those leftovers count too. */
  const legacyDir = join(sessionsRoot, 'C-Users-Test-project', '02f30286-1f0f-4025-be5c-3c2d6cbf30c5');
  await writeZstdSessionLog(legacyDir, { id: '02f30286-1f0f-4025-be5c-3c2d6cbf30c5', titles: ['旧格式会话'] });
  /* A folder with neither a session log nor a session id is somebody else's. */
  const strayDir = join(sessionsRoot, 'C-Users-Test-project', 'not-a-session');
  await mkdir(strayDir, { recursive: true });
  await writeFile(join(strayDir, 'notes.txt'), 'x', 'utf8');

  const legacyScan = await call(routes, '/dsh-session-delete/scan', {});
  check(
    'a session stored under a bare uuid is found by its log',
    legacyScan.body.items.some((item) => item.sessionId === '02f30286-1f0f-4025-be5c-3c2d6cbf30c5' && item.title === '旧格式会话'),
    JSON.stringify(legacyScan.body.items?.map((item) => [item.sessionId, item.title])),
  );
  check(
    'a folder that is not a session is left alone',
    legacyScan.body.items.every((item) => item.sessionId !== 'not-a-session'),
    JSON.stringify(legacyScan.body.items?.map((item) => item.sessionId)),
  );
  const legacyMoved = await call(routes, '/dsh-session-delete/scan/trash', { sessionIds: ['02f30286-1f0f-4025-be5c-3c2d6cbf30c5'] });
  check(
    'and it can be moved to the trash like any other',
    legacyMoved.status === 200 && legacyMoved.body.trashed === 1,
    JSON.stringify(legacyMoved.body),
  );
  const legacyRestored = await call(routes, '/dsh-session-delete/state', {});
  const legacyItem = legacyRestored.body.items.find((item) => item.sessionId === '02f30286-1f0f-4025-be5c-3c2d6cbf30c5');
  await call(routes, '/dsh-session-delete/item/restore', { trashId: legacyItem.trashId });
  check('restored back under its uuid directory', existsSync(legacyDir) === true, String(existsSync(legacyDir)));
  await rm(strayDir, { recursive: true, force: true });

  const refuseListed = await call(routes, '/dsh-session-delete/scan/trash', { sessionIds: ['session-a'] });
  check(
    'a session the app still lists is refused by the orphan route',
    refuseListed.status === 409 && refuseListed.body.ok === false && refuseListed.body.code === 'still-listed',
    JSON.stringify(refuseListed.body),
  );

  const revealOrphan = await call(routes, '/dsh-session-delete/reveal', { target: 'orphan', sessionId: 'session-orphan1' });
  check(
    'an orphan directory can be opened by id',
    revealOrphan.status === 200 && revealOrphan.body.ok === true && String(revealOrphan.body.path).includes('session-orphan1'),
    JSON.stringify(revealOrphan.body),
  );
  const revealUnknown = await call(routes, '/dsh-session-delete/reveal', { target: 'orphan', sessionId: 'session-nope' });
  check(
    'an unknown id is refused, not guessed',
    revealUnknown.status === 404 && revealUnknown.body.code === 'missing',
    JSON.stringify(revealUnknown.body),
  );
}

/* ---------------------------------------------------------------- picker */

delete process.env.DSH_SESSION_DELETE_NO_PICKER;

{
  const notElectron = async () => {
    throw new Error('electron is not available');
  };
  const picked = await pickFolder({
    start: 'C:\\Users',
    run: async () => ({ code: 0, stdout: 'D:\\dsh-trash\n', stderr: '', timedOut: false }),
    loadElectron: notElectron,
  });
  check('a folder picked in the desktop dialog comes back trimmed', picked.ok === true && picked.path === 'D:\\dsh-trash', JSON.stringify(picked));

  const cancelled = await pickFolder({
    run: async () => ({ code: 1, stdout: '', stderr: '', timedOut: false }),
    loadElectron: notElectron,
  });
  check('closing the dialog without a choice is a cancellation', cancelled.ok === false && cancelled.code === 'cancelled', JSON.stringify(cancelled));

  const timedOut = await pickFolder({
    run: async () => ({ code: -1, stdout: '', stderr: 'timeout', timedOut: true }),
    loadElectron: notElectron,
  });
  check('a dialog that never answers fails cleanly', timedOut.ok === false && timedOut.code === 'picker-failed', JSON.stringify(timedOut));

  const viaElectron = await pickFolder({
    run: async () => ({ code: 1, stdout: '', stderr: '', timedOut: false }),
    loadElectron: async () => ({
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['E:\\trash'] }) },
      BrowserWindow: { getFocusedWindow: () => null },
    }),
  });
  check('the app dialog is preferred when it exists', viaElectron.ok === true && viaElectron.via === 'electron' && viaElectron.path === 'E:\\trash', JSON.stringify(viaElectron));

  const closedElectron = await pickFolder({
    run: async () => ({ code: 1, stdout: '', stderr: '', timedOut: false }),
    loadElectron: async () => ({
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      BrowserWindow: { getFocusedWindow: () => null },
    }),
  });
  check('cancelling the app dialog cancels', closedElectron.ok === false && closedElectron.code === 'cancelled', JSON.stringify(closedElectron));
}

check('the windows dialog asks for a folder, not a file', String(pickerArgv('win32', 'C:\\Users', 'x').join(' ')).indexOf('FolderBrowserDialog') > 0, String(pickerArgv('win32', 'C:\\Users', 'x').join(' ')));
check('the apple dialog chooses a folder', pickerArgv('darwin', '', 'x')[2].indexOf('choose folder') > 0, String(pickerArgv('darwin', '', 'x')[2]));
check('the linux dialog asks zenity for a directory', pickerArgv('linux', '', 'x').includes('--directory'), JSON.stringify(pickerArgv('linux', '', 'x')));

process.env.DSH_SESSION_DELETE_NO_PICKER = '1';
{
  const blocked = await pickFolder({ run: async () => ({ code: 0, stdout: '/tmp', stderr: '', timedOut: false }) });
  check('the kill switch disables the picker', blocked.ok === false && blocked.code === 'unsupported', JSON.stringify(blocked));
}

/* -------------------------------------------------------------- manifest */

const manifest = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8'));
check('the manifest names the package', manifest.name === 'dsh-session-delete');
check('the manifest declares the DSH format version', manifest.dsh?.manifestVersion === 1);
check('the manifest points at a bundle patch', manifest.dsh?.bundle?.patch === './cordis.patch.yml');
check('the manifest declares a web client half', manifest.dsh?.client?.platform === 'web');
check('the client half is exported', manifest.exports?.['./client'] === './client.js');
check('the host half is the package main', manifest.main === 'index.js');
check('the published files include both halves', [
  'index.js',
  'client.js',
  'cordis.patch.yml',
].every((file) => manifest.files.includes(file)));
check('the manifest declares a compatible DSH range', typeof manifest.engines?.dsh === 'string' && manifest.engines.dsh.includes('0.2.1'));

console.log(`\n${checks} checks, ${process.exitCode === 1 ? 'FAILURES' : 'all passed'}`);
