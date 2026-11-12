/**
 * The operations: move to trash, restore, empty, and read the panel's state.
 *
 * Two invariants drive every function here.
 *
 * 1. **Nothing is destroyed except by "empty".** A record is moved, and a move
 *    that cannot finish is rolled back so the session store is left exactly as
 *    it was.
 * 2. **A path from a manifest is untrusted.** Restore and empty only touch
 *    paths that are inside the trash directory or that look like a session
 *    directory, and a restore never overwrites an existing record.
 */
import { mkdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { exists, isInside, looksLikeSessionDir, resolveTrashDir } from './paths.js';
import { appendOperation, readSettings } from './settings.js';
import { readSessionTitle } from './title.js';
import { readItem, readItems, sizeOf, sizeOfItem, stampOf, trashStats, writeManifest, movePath } from './trash.js';

/**
 * A user-facing label from an untrusted string: whitespace collapsed, control
 * characters dropped, length capped. Empty in, empty out.
 *
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
export function cleanTitle(value, max = 120) {
  if (typeof value !== 'string') return '';
  let flat = value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  /* A provider may hand back a quoted title ("…" / “…”): the quotes are its
     formatting, not part of the name. */
  for (const [open, close] of [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['「', '」'],
    ['《', '》'],
  ]) {
    if (flat.length > 1 && flat.startsWith(open) && flat.endsWith(close)) {
      flat = flat.slice(1, -1).trim();
      break;
    }
  }
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Everything an operation needs, resolved once per request.
 *
 * @typedef {object} Env
 * @property {string} dshHome
 * @property {string} sessionRoot
 * @property {import('./settings.js').PluginSettings} settings
 * @property {{ dir: string, source: string }} trash
 * @property {string} configured   the setting as the user typed it
 */

/**
 * @param {import('./store.js').Store} store
 * @param {{ trashDir?: string }} mountConfig
 * @returns {Promise<Env>}
 */
export async function resolveEnv(store, mountConfig) {
  store.require('sessionPersistence');
  const dshHome = store.home;
  const settings = await readSettings(dshHome);
  const trash = resolveTrashDir({
    dshHome,
    candidates: [
      { value: settings.trashDir, source: 'settings' },
      { value: mountConfig.trashDir, source: 'config' },
    ],
    sessionRoots: [store.sessionRoot],
  });
  return { dshHome, sessionRoot: store.sessionRoot, settings, trash, configured: settings.trashDir };
}

/**
 * The workspace a session currently belongs to, if any.
 *
 * @param {import('./store.js').Store} store
 * @param {string} sessionId
 * @returns {{ id: string, title: string } | null}
 */
function workspaceOfSession(store, sessionId) {
  const registry = store.registry;
  if (registry === undefined || typeof registry.list !== 'function') return null;
  try {
    for (const workspace of registry.list()) {
      if (Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(sessionId)) {
        return { id: String(workspace.id), title: typeof workspace.title === 'string' ? workspace.title : '' };
      }
    }
  } catch {
    /* an unreadable registry is not a reason to refuse the move */
  }
  return null;
}

/**
 * One session's storage facts, or the reason there is nothing to move.
 *
 * @param {import('./store.js').Store} store
 * @param {string} sessionId
 * @returns {Promise<{ ok: true, row: import('./store.js').StoredSession, dir: string } | { ok: false, code: string, detail?: string }>}
 */
async function locateSession(store, sessionId) {
  if (store.isRunning(sessionId)) return { ok: false, code: 'live' };
  /* The store finds the artifact: header facts from `stat()`, the directory by
     reading the store. A directory that is already gone is a missing session,
     not a failed move. */
  const row = await store.locate(sessionId).catch((error) => {
    if (error !== null && error !== undefined && error.code === 'ambiguous') return null;
    throw error;
  });
  if (row === null) return { ok: false, code: 'ambiguous' };
  if (row === undefined) return { ok: false, code: 'missing' };
  if (!looksLikeSessionDir(row.dir)) return { ok: false, code: 'bad-path', detail: row.dir };
  if (!(await exists(row.dir))) return { ok: false, code: 'missing' };
  return { ok: true, row, dir: row.dir };
}

/**
 * Move one session into the trash.
 *
 * The session is archived first when it is not archived already: the sidebar
 * hides archived rows, and the official archive call is what makes the GUI
 * refresh. Restoring undoes exactly that flag and nothing else.
 *
 * @param {import('./store.js').Store} store
 * @param {Env} env
 * @param {string} sessionId
 * @returns {Promise<{ ok: true, trashId: string } | { ok: false, code: string, detail?: string }>}
 */
export async function trashSession(store, env, sessionId, title) {
  const located = await locateSession(store, sessionId);
  if (located.ok !== true) return located;

  const workspace = workspaceOfSession(store, sessionId);
  /* The GUI knows the row's label and sends it; a caller that does not is served
     by the log itself, which carries every accepted title as an event. */
  let label = cleanTitle(title);
  if (label === '' && located.row.logFile !== '') {
    label = cleanTitle(await readSessionTitle(join(located.dir, located.row.logFile)));
  }
  const archivedByUs = !new Set(store.registry?.archivedSessionIds ?? []).has(sessionId);
  if (archivedByUs) {
    try {
      await store.registry?.archiveSession?.(sessionId);
    } catch {
      /* archiving is a convenience for the sidebar, never a precondition */
    }
  }

  const trashId = `${stampOf(new Date())}-${sessionId}`;
  const itemDir = join(env.trash.dir, 'items', trashId);
  const payloadDir = join(itemDir, 'session');
  /* Measured once, while the bytes are still where they are: the panel then never
     has to walk the trash to answer "how big is this?". */
  const sizeBytes = await sizeOf(located.dir);
  const manifest = {
    kind: 'session',
    trashId,
    sessionId,
    sessionTitle: label,
    originalPath: located.dir,
    logFile: located.row.logFile,
    cwd: located.row.cwd,
    workspaceId: workspace === null ? null : workspace.id,
    workspaceTitle: workspace === null ? null : workspace.title,
    archivedByUs,
    trashedAt: new Date().toISOString(),
    sizeBytes,
  };

  try {
    await writeManifest(itemDir, manifest);
    await movePath(located.dir, payloadDir);
  } catch (error) {
    await rollbackMove(itemDir, payloadDir, located.dir, archivedByUs ? sessionId : undefined, store);
    const code = error?.code === 'busy' ? 'busy' : 'move-failed';
    await appendOperation(env.dshHome, {
      op: 'session.trash.failed',
      sessionId,
      code,
      detail: String(error?.message ?? error),
    });
    return { ok: false, code, detail: String(error?.message ?? error) };
  }

  await appendOperation(env.dshHome, {
    op: 'session.trash',
    sessionId,
    sessionTitle: label === '' ? undefined : label,
    trashId,
    cwd: manifest.cwd,
    archivedByUs,
  });
  return { ok: true, trashId };
}

/**
 * A session the store still lists but whose log directory is gone.
 *
 * Nothing can be moved, so the only honest action is to archive it away: the
 * row leaves the sidebar, DSH keeps it in its own archive, and no trash item is
 * invented for data that does not exist.
 *
 * @param {import('./store.js').Store} store
 * @param {Env} env
 * @param {string} sessionId
 * @param {unknown} title
 * @returns {Promise<Record<string, unknown>>}
 */
export async function retireSession(store, env, sessionId, title) {
  const located = await locateSession(store, sessionId);
  /* A directory that still exists belongs in the trash, not in the archive. */
  if (located.ok === true) return { ok: false, code: 'present' };
  if (located.code !== 'missing') return located;
  const registry = store.registry;
  if (registry === undefined || typeof registry.archiveSession !== 'function') {
    return { ok: false, code: 'unavailable', missing: ['workspaceRegistry'] };
  }
  const again = new Set(registry.archivedSessionIds ?? []).has(sessionId);
  try {
    await registry.archiveSession(sessionId);
  } catch (error) {
    return { ok: false, code: 'retire-failed', detail: String(error?.message ?? error) };
  }
  const label = cleanTitle(title);
  await appendOperation(env.dshHome, {
    op: 'session.retire',
    sessionId,
    sessionTitle: label === '' ? undefined : label,
    reason: 'no-directory',
    alreadyArchived: again,
  });
  return { ok: true, retired: true, alreadyArchived: again };
}

/**
 * Restore several records in one request.
 *
 * A selection offers deletion, so it must offer the safe direction too — one
 * click to put every ticked record back instead of N dialogs.
 *
 * @param {import('./store.js').Store} store
 * @param {Env} env
 * @param {Array<string>} trashIds
 * @returns {Promise<{ ok: boolean, code?: string, restored: number, failed: Array<{ trashId: string, code: string }> }>}
 */
export async function restoreItems(store, env, trashIds) {
  const ids = (Array.isArray(trashIds) ? trashIds : []).filter((id) => typeof id === 'string' && id !== '');
  if (ids.length === 0) return { ok: false, code: 'bad-args', restored: 0, failed: [] };
  /** @type {Array<{ trashId: string, code: string }>} */
  const failed = [];
  let restored = 0;
  for (const trashId of ids) {
    const outcome = await restoreItem(store, env, trashId);
    if (outcome.ok === true) restored += 1;
    else failed.push({ trashId, code: String(outcome.code ?? 'failed') });
  }
  /* All of them failing means the request failed; some succeeding is a partial
     success, and the GUI reports both numbers. */
  if (restored === 0) return { ok: false, code: failed[0]?.code ?? 'restore-failed', restored, failed };
  return { ok: true, restored, failed };
}

/**
 * Archive several ghost rows in one go.
 *
 * @param {import('./store.js').Store} store
 * @param {Env} env
 * @param {Array<string>} sessionIds
 * @returns {Promise<Record<string, unknown>>}
 */
export async function retireSessions(store, env, sessionIds) {
  const ids = (Array.isArray(sessionIds) ? sessionIds : []).filter((id) => typeof id === 'string' && id !== '');
  if (ids.length === 0) return { ok: false, code: 'bad-args' };
  /** @type {Array<{ sessionId: string, code: string }>} */
  const failed = [];
  let retired = 0;
  for (const sessionId of ids) {
    const outcome = await retireSession(store, env, sessionId, '');
    if (outcome.ok === true) retired += 1;
    else failed.push({ sessionId, code: String(outcome.code ?? 'failed') });
  }
  return { ok: true, retired, failed };
}

/**
 * Undo a half-finished move: put the directory back and drop the item.
 *
 * @param {string} itemDir
 * @param {string} payloadDir
 * @param {string} originalPath
 * @param {string | undefined} unarchiveId
 * @param {import('./store.js').Store} store
 * @returns {Promise<void>}
 */
async function rollbackMove(itemDir, payloadDir, originalPath, unarchiveId, store) {
  try {
    if (!(await exists(originalPath)) && (await exists(payloadDir))) await movePath(payloadDir, originalPath);
  } catch {
    /* the report already says the move failed */
  }
  try {
    await rm(itemDir, { recursive: true, force: true });
  } catch {
    /* a leftover empty item directory is harmless and visible in the panel */
  }
  if (unarchiveId !== undefined) {
    try {
      await store.registry?.unarchiveSession?.(unarchiveId);
    } catch {
      /* leaving the row hidden is recoverable; losing the record is not */
    }
  }
}

/**
 * Move every session of one workspace into a single trash item.
 *
 * The workspace registration is removed only when no session stayed behind, so
 * a live session can never turn into an orphan.
 *
 * @param {import('./store.js').Store} store
 * @param {Env} env
 * @param {string} workspaceId
 * @returns {Promise<{ ok: boolean, code?: string, trashed: number, live: Array<string>, missing: Array<string>, failed: Array<{ id: string, code: string, detail?: string }>, workspaceRemoved: boolean, trashId?: string }>}
 */
export async function trashWorkspace(store, env, workspaceId) {
  const registry = store.registry;
  const workspace = registry !== undefined && typeof registry.get === 'function' ? registry.get(workspaceId) : undefined;
  if (workspace === undefined) {
    return { ok: false, code: 'unknown-workspace', trashed: 0, live: [], missing: [], failed: [], workspaceRemoved: false };
  }

  const archived = new Set(registry.archivedSessionIds ?? []);
  const trashId = `${stampOf(new Date())}-workspace-${workspaceId}`;
  const itemDir = join(env.trash.dir, 'items', trashId);
  const sessionsDir = join(itemDir, 'sessions');
  /** @type {Array<import('./trash.js').TrashedSession>} */
  const moved = [];
  /** @type {Array<string>} */
  const live = [];
  /** @type {Array<string>} */
  const missing = [];
  /** @type {Array<{ id: string, code: string, detail?: string }>} */
  const failed = [];

  for (const sessionId of [...workspace.sessionIds]) {
    const located = await locateSession(store, sessionId);
    if (located.ok !== true) {
      if (located.code === 'live') live.push(sessionId);
      else if (located.code === 'missing') missing.push(sessionId);
      else failed.push({ id: sessionId, code: located.code, detail: located.detail });
      continue;
    }
    const archivedByUs = !archived.has(sessionId);
    if (archivedByUs) {
      try {
        await registry.archiveSession(sessionId);
      } catch {
        /* see trashSession: hiding the row is a convenience */
      }
    }
    try {
      await mkdir(sessionsDir, { recursive: true });
      await movePath(located.dir, join(sessionsDir, sessionId));
      moved.push({
        sessionId,
        originalPath: located.dir,
        logFile: located.row.logFile,
        cwd: located.row.cwd,
        archivedByUs,
      });
    } catch (error) {
      if (archivedByUs) {
        try {
          await registry.unarchiveSession(sessionId);
        } catch {
          /* nothing else to undo */
        }
      }
      failed.push({ id: sessionId, code: error?.code === 'busy' ? 'busy' : 'move-failed', detail: String(error?.message ?? error) });
    }
  }

  if (moved.length === 0) {
    try {
      await rm(itemDir, { recursive: true, force: true });
    } catch {
      /* nothing was written when no session moved */
    }
    return { ok: false, code: live.length > 0 ? 'live' : 'nothing-moved', trashed: 0, live, missing, failed, workspaceRemoved: false };
  }

  const manifest = {
    kind: 'workspace',
    trashId,
    workspaceId,
    /* Recorded once, so the panel never walks the trash to size it. */
    sizeBytes: await sizeOf(itemDir),
    workspaceTitle: cleanTitle(workspace.title),
    path: typeof workspace.path === 'string' && workspace.path !== '' ? workspace.path : moved[0].cwd,
    sessions: moved,
    order: Array.isArray(workspace.sessionIds) ? [...workspace.sessionIds] : [],
    trashedAt: new Date().toISOString(),
  };
  try {
    await writeManifest(itemDir, manifest);
  } catch (error) {
    return { ok: false, code: 'manifest-failed', trashed: 0, live, missing, failed, workspaceRemoved: false };
  }

  const remaining = workspace.sessionIds.length - moved.length - missing.length;
  let workspaceRemoved = false;
  if (remaining <= 0) {
    try {
      workspaceRemoved = (await registry.delete(workspaceId)) === true;
    } catch {
      workspaceRemoved = false;
    }
  }
  await appendOperation(env.dshHome, {
    op: 'workspace.trash',
    workspaceId,
    workspaceTitle: manifest.workspaceTitle,
    trashed: moved.length,
    live: live.length,
    failed: failed.length,
    workspaceRemoved,
  });
  return { ok: true, trashed: moved.length, live, missing, failed, workspaceRemoved, trashId };
}

/**
 * Restore one trash item.
 *
 * @param {import('./store.js').Store} store
 * @param {Env} env
 * @param {string} trashId
 * @returns {Promise<{ ok: boolean, code?: string, kind?: string, detail?: string, sessions?: number, workspaceId?: string, sessionId?: string }>}
 */
export async function restoreItem(store, env, trashId) {
  const item = await readItem(env.trash.dir, trashId);
  if (item === undefined) return { ok: false, code: 'unknown-item' };
  if (!isInside(item.dir, env.trash.dir)) return { ok: false, code: 'unsafe-path', detail: item.dir };
  const result = item.kind === 'workspace' ? await restoreWorkspace(store, item) : await restoreSession(store, item);
  await appendOperation(env.dshHome, {
    op: result.ok ? 'restore' : 'restore.failed',
    trashId,
    kind: item.kind,
    sessionId: item.sessionId ?? undefined,
    sessionTitle: cleanTitle(item.sessionTitle) || undefined,
    workspaceId: item.workspaceId ?? undefined,
    workspaceTitle: cleanTitle(item.workspaceTitle) || undefined,
    sessions: typeof result.sessions === 'number' ? result.sessions : undefined,
    code: result.ok ? undefined : result.code,
  });
  return result;
}

/**
 * @param {import('./store.js').Store} store
 * @param {import('./trash.js').TrashItem} item
 * @returns {Promise<{ ok: boolean, code?: string, kind: string, detail?: string, sessionId?: string }>}
 */
async function restoreSession(store, item) {
  if (!looksLikeSessionDir(item.originalPath)) return { ok: false, code: 'unsafe-path', detail: item.originalPath };
  if (!(await exists(item.payloadDir))) return { ok: false, code: 'payload-missing' };
  if (await exists(item.originalPath)) return { ok: false, code: 'exists', detail: item.originalPath };
  try {
    await mkdir(dirname(item.originalPath), { recursive: true });
    await movePath(item.payloadDir, item.originalPath);
  } catch (error) {
    return { ok: false, code: 'restore-failed', detail: String(error?.message ?? error) };
  }
  if (item.archivedByUs === true) {
    try {
      await store.registry?.unarchiveSession?.(item.sessionId);
    } catch {
      /* the record is back on disk; a still-hidden row is a restart away */
    }
  }
  try {
    const workspace = typeof item.workspaceId === 'string' ? store.registry?.get?.(item.workspaceId) : undefined;
    if (workspace !== undefined && !workspace.sessionIds.includes(item.sessionId)) {
      await workspace.attachSession(item.sessionId);
    }
  } catch {
    /* the workspace is gone: the session still exists and reattaches on restart */
  }
  await rm(item.dir, { recursive: true, force: true }).catch(() => {});
  return { ok: true, kind: 'session', sessionId: item.sessionId };
}

/**
 * @param {import('./store.js').Store} store
 * @param {import('./trash.js').TrashItem} item
 * @returns {Promise<{ ok: boolean, code?: string, kind: string, detail?: string, sessions?: number, workspaceId?: string }>}
 */
async function restoreWorkspace(store, item) {
  /** @type {Array<{ entry: import('./trash.js').TrashedSession, payload: string }>} */
  const restored = [];
  const entries = Array.isArray(item.sessions) ? item.sessions : [];

  for (const entry of entries) {
    if (typeof entry.originalPath !== 'string' || !looksLikeSessionDir(entry.originalPath)) {
      await undoRestore(restored);
      return { ok: false, code: 'unsafe-path', detail: String(entry.originalPath) };
    }
    const payload = join(item.dir, 'sessions', String(entry.sessionId));
    if (!(await exists(payload))) continue;
    if (await exists(entry.originalPath)) {
      await undoRestore(restored);
      return { ok: false, code: 'exists', detail: entry.originalPath };
    }
    try {
      await mkdir(dirname(entry.originalPath), { recursive: true });
      await movePath(payload, entry.originalPath);
      restored.push({ entry, payload });
    } catch (error) {
      await undoRestore(restored);
      return { ok: false, code: 'restore-failed', detail: String(error?.message ?? error) };
    }
  }

  let workspace;
  try {
    workspace = await store.registry?.create?.(item.path, item.workspaceTitle === '' ? undefined : item.workspaceTitle);
  } catch (error) {
    await undoRestore(restored);
    return { ok: false, code: 'workspace-create-failed', detail: String(error?.message ?? error) };
  }

  for (const { entry } of restored) {
    if (entry.archivedByUs === true) {
      try {
        await store.registry?.unarchiveSession?.(entry.sessionId);
      } catch {
        /* as above: visible on the next start */
      }
    }
    try {
      if (workspace !== undefined && !workspace.sessionIds.includes(entry.sessionId)) {
        await workspace.attachSession(entry.sessionId);
      }
    } catch {
      /* attachment is best effort; the log directory is what matters */
    }
  }
  await applyOriginalOrder(workspace, item.order);

  await rm(item.dir, { recursive: true, force: true }).catch(() => {});
  return { ok: true, kind: 'workspace', sessions: restored.length, workspaceId: item.workspaceId };
}

/**
 * Put the restored sessions back in their original order.
 *
 * `attachSession` prepends, so attaching in reverse order leaves the ids in the
 * order they were recorded. Sessions that were never moved (a live one, say)
 * keep their relative order behind the restored block.
 *
 * @param {any} workspace
 * @param {unknown} order
 * @returns {Promise<void>}
 */
async function applyOriginalOrder(workspace, order) {
  if (workspace === undefined || !Array.isArray(workspace.sessionIds)) return;
  if (!Array.isArray(order) || order.length < 2) return;
  const present = new Set(workspace.sessionIds);
  const desired = order.filter((id) => typeof id === 'string' && present.has(id));
  if (desired.length < 2) return;
  try {
    for (const id of desired) await workspace.detachSession(id);
    for (const id of [...desired].reverse()) await workspace.attachSession(id);
  } catch {
    /* order is cosmetic; the records themselves are already back */
  }
}

/**
 * Put back the sessions a failed workspace restore had already moved.
 *
 * @param {Array<{ entry: import('./trash.js').TrashedSession, payload: string }>} restored
 * @returns {Promise<void>}
 */
async function undoRestore(restored) {
  for (const { entry, payload } of restored) {
    try {
      await movePath(entry.originalPath, payload);
    } catch {
      /* rollback is best effort and is never reported as success */
    }
  }
}

/**
 * Permanently delete every item in the trash.
 *
 * @param {import('./store.js').Store} store
 * @param {Env} env
 * @returns {Promise<{ ok: true, removed: number, failed: Array<{ trashId: string, code: string }> }>}
 */
export async function emptyTrash(store, env) {
  const outcome = await removeItems(store, env, await readItems(env.trash.dir), 'trash.empty');
  /* `ok` is part of the answer every route gives; without it the GUI reads a
     successful empty as a failure with no reason. */
  return { ok: true, ...outcome };
}

/**
 * Permanently delete the items a user picked, leaving the rest alone.
 *
 * The panel used to offer only "empty", which forces an all-or-nothing choice;
 * a trash that can restore one row and destroy another needs a per-row delete.
 *
 * @param {import('./store.js').Store} store
 * @param {Env} env
 * @param {Array<string>} trashIds
 * @returns {Promise<{ ok: boolean, code?: string, removed: number, failed: Array<{ trashId: string, code: string }> }>}
 */
export async function purgeItems(store, env, trashIds) {
  const wanted = new Set((Array.isArray(trashIds) ? trashIds : []).filter((id) => typeof id === 'string' && id !== ''));
  if (wanted.size === 0) return { ok: false, code: 'bad-args', removed: 0, failed: [] };
  const items = (await readItems(env.trash.dir)).filter((item) => wanted.has(item.trashId));
  if (items.length === 0) return { ok: false, code: 'unknown-item', removed: 0, failed: [] };
  const outcome = await removeItems(store, env, items, 'trash.purge');
  return { ok: true, ...outcome };
}

/**
 * Delete the given items from the trash and forget the archive flags they set.
 *
 * @param {import('./store.js').Store} store
 * @param {Env} env
 * @param {Array<import('./trash.js').TrashItem>} items
 * @param {string} op
 * @returns {Promise<{ removed: number, failed: Array<{ trashId: string, code: string }>, titles: Array<string> }>}
 */
async function removeItems(store, env, items, op) {
  let removed = 0;
  /** @type {Array<{ trashId: string, code: string }>} */
  const failed = [];
  /** @type {Array<string>} */
  const titles = [];
  for (const item of items) {
    if (!isInside(item.dir, env.trash.dir)) {
      failed.push({ trashId: item.trashId, code: 'unsafe-path' });
      continue;
    }
    try {
      await rm(item.dir, { recursive: true, force: true });
      removed += 1;
    } catch {
      failed.push({ trashId: item.trashId, code: 'rm-failed' });
      continue;
    }
    const label = cleanTitle(item.kind === 'workspace' ? item.workspaceTitle : item.sessionTitle);
    if (label !== '') titles.push(label);
    /* Deliberately *no* unarchive here. The archive flag is what keeps the row
       out of the sidebar; clearing it after deleting the data would put back a
       row whose log no longer exists, and opening it fails with ENOENT. The
       flag is left alone, so the row stays hidden — permanently. */
  }
  await appendOperation(env.dshHome, {
    op,
    removed,
    failed: failed.length,
    titles: titles.slice(0, 20),
  });
  return { removed, failed, titles };
}

/**
 * @param {import('./trash.js').TrashItem} item
 * @returns {Array<string>}
 */
function archivedSessionIdsOf(item) {
  if (item.kind === 'workspace') {
    return (Array.isArray(item.sessions) ? item.sessions : [])
      .filter((entry) => entry.archivedByUs === true)
      .map((entry) => String(entry.sessionId));
  }
  return item.archivedByUs === true ? [String(item.sessionId)] : [];
}

/**
 * Everything the sidebar panel renders: what is in the trash, and which
 * workspaces could be moved wholesale.
 *
 * @param {import('./store.js').Store} store
 * @param {Env} env
 * @returns {Promise<object>}
 */
export async function panelState(store, env) {
  const items = await readItems(env.trash.dir);
  /** @type {Array<object>} */
  const entries = [];
  for (const item of items) {
    const workspaceItem = item.kind === 'workspace';
    let recorded = workspaceItem ? cleanTitle(item.workspaceTitle) : cleanTitle(item.sessionTitle);
    /* Items trashed before names were recorded still carry their log, and the
       log carries the title. Recovering it here means the panel is readable
       without restoring anything first. */
    if (recorded === '' && workspaceItem === false) {
      recorded = cleanTitle(await readSessionTitle(join(item.payloadDir, String(item.logFile || 'session.v4.jsonl.zstd'))));
    }
    const label = recorded || basename(String((workspaceItem ? item.path : item.cwd) || '')) || String(item.workspaceId ?? item.sessionId ?? '');
    entries.push({
      kind: item.kind,
      trashId: item.trashId,
      title: label,
      /* Whether `title` is the name the GUI showed, or only the folder it came
         from (an item trashed before names were recorded). */
      titleSource: recorded === '' ? 'folder' : 'name',
      sessionId: workspaceItem ? null : item.sessionId,
      cwd: workspaceItem ? String(item.path || '') : String(item.cwd || ''),
      workspaceId: item.workspaceId ?? null,
      /* What the sidebar groups under: the workspace name and its folder. */
      workspacePath: workspaceItem ? String(item.path || '') : workspacePathOf(store, item.workspaceId),
      workspaceTitle: cleanTitle(item.workspaceTitle) || null,
      sessionCount: workspaceItem && Array.isArray(item.sessions) ? item.sessions.length : 1,
      trashedAt: item.trashedAt,
      sizeBytes: await sizeOfItem(item),
    });
  }
  return {
    trashDir: env.trash.dir,
    trashSource: env.trash.source,
    configuredTrashDir: env.configured,
    stats: await trashStats(env.trash.dir),
    items: entries,
    workspaces: listWorkspaces(store),
    ghosts: await findGhosts(store),
  };
}

/**
 * The folder a workspace points at, for the panel's grouping.
 *
 * @param {import('./store.js').Store} store
 * @param {unknown} workspaceId
 * @returns {string}
 */
function workspacePathOf(store, workspaceId) {
  if (typeof workspaceId !== 'string' || workspaceId === '') return '';
  const registry = store.registry;
  if (registry === undefined || typeof registry.get !== 'function') return '';
  try {
    const workspace = registry.get(workspaceId);
    return workspace === undefined || workspace === null ? '' : String(workspace.path || '');
  } catch {
    return '';
  }
}

/**
 * Rows the GUI lists but the disk no longer backs: a session id the store (or a
 * workspace) still names, with no `sessions/<group>/<id>` directory anywhere.
 *
 * They cannot be trashed — there is nothing to move — and leaving them alone
 * means clicking one fails with ENOENT. The panel offers to archive them.
 *
 * @param {import('./store.js').Store} store
 * @returns {Promise<Array<{ sessionId: string }>>}
 */
/**
 * Every session id the application still knows about: the durable store's rows
 * plus every id a workspace claims.
 *
 * @param {import('./store.js').Store} store
 * @returns {Promise<Set<string>>}
 */
export async function knownSessionIds(store) {
  const known = new Set();
  const listed = store.persistence;
  if (listed !== undefined && typeof listed.list === 'function') {
    try {
      const rows = await listed.list();
      for (const row of Array.isArray(rows) ? rows : []) {
        const id = row?.header?.id ?? row?.id;
        if (typeof id === 'string' && id !== '') known.add(id);
      }
    } catch {
      /* a list that refuses tells us nothing; the registry may still */
    }
  }
  const registry = store.registry;
  if (registry !== undefined && typeof registry.list === 'function') {
    try {
      for (const workspace of registry.list()) {
        for (const id of Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []) {
          if (typeof id === 'string' && id !== '') known.add(id);
        }
      }
    } catch {
      /* the same */
    }
  }
  return known;
}

/**
 * Rows the GUI shows whose log directory is gone: the inverse question, and the
 * one that produces an empty row in the sidebar.
 *
 * @param {import('./store.js').Store} store
 * @returns {Promise<Array<{ sessionId: string }>>}
 */
export async function findGhosts(store) {
  const known = await knownSessionIds(store);
  const registry = store.registry;
  if (known.size === 0) return [];
  const archived = new Set(registry?.archivedSessionIds ?? []);
  const present = await store.listSessionDirNames();
  if (present.size === 0) return [];
  return [...known]
    .filter((id) => present.has(id) === false && archived.has(id) === false)
    .sort()
    .slice(0, 100)
    .map((sessionId) => ({ sessionId }));
}

/**
 * Session directories on disk that the application no longer lists.
 *
 * Deleting a session in DSH can leave its directory behind (a failed write, a
 * crash, a session removed from another profile). Nothing in the GUI shows
 * those: they are invisible rows that still take space. This scan is the only
 * way to see them, and the result is a list the user can move to the trash like
 * any other record — restorable, because the directory is moved, not deleted.
 *
 * @param {import('./store.js').Store} store
 * @param {Env} env
 * @returns {Promise<{ ok: true, scanned: number, listed: number, items: Array<object> }>}
 */
export async function scanOrphans(store, env) {
  const known = await knownSessionIds(store);
  const dirs = (await store.listSessionDirs()).sort((left, right) => left.sessionId.localeCompare(right.sessionId));

  /* Records already waiting in the trash are not "lost folders" any more. */
  const inTrash = new Set();
  for (const item of await readItems(env.trash.dir)) {
    if (typeof item.sessionId === 'string') inTrash.add(item.sessionId);
  }

  /** @type {Array<object>} */
  const candidates = [];
  for (const entry of dirs) {
    if (known.has(entry.sessionId)) continue;
    if (inTrash.has(entry.sessionId)) continue;
    let snapshot;
    try {
      snapshot = await stat(entry.dir);
    } catch {
      continue;
    }
    const candidate = {
      sessionId: entry.sessionId,
      dir: entry.dir,
      group: entry.group,
      logFile: '',
      title: '',
      sizeBytes: 0,
      modifiedAt: snapshot.mtime.toISOString(),
    };
    /* A folder is a leftover session when it carries a session log. A bare
       directory with no log and no `session-` name is somebody else's business
       and is left alone. */
    const logFile = await store.findLogFile(entry.dir);
    if (logFile === '' && entry.sessionId.startsWith('session-') !== true) continue;
    candidate.logFile = logFile;
    candidates.push(candidate);
  }

  /* Newest first, then cap `before` measuring: a size walks the whole folder, and a
     store with thousands of leftovers must not turn one click into a minute. */
  candidates.sort((left, right) => String(right.modifiedAt).localeCompare(String(left.modifiedAt)));
  const items = candidates.slice(0, 200);
  for (const item of items) {
    item.title = item.logFile === '' ? '' : cleanTitle(await readSessionTitle(join(item.dir, item.logFile)));
    item.sizeBytes = await sizeOf(item.dir);
  }

  return { ok: true, scanned: dirs.length, listed: known.size, items };
}

/**
 * Move orphaned directories into the trash.
 *
 * Same protections as the ordinary move: a session the app still lists is
 * refused (that is not an orphan any more), a running session is refused, an
 * ambiguous or vanished directory is refused, and a move that fails is rolled
 * back. There is no row to archive, so the archive flag is left alone — the
 * record is already gone from the sidebar.
 *
 * @param {import('./store.js').Store} store
 * @param {Env} env
 * @param {Array<string>} sessionIds
 * @returns {Promise<{ ok: boolean, code?: string, trashed: number, failed: Array<{ sessionId: string, code: string }> }>}
 */
export async function trashOrphans(store, env, sessionIds) {
  const ids = [...new Set((Array.isArray(sessionIds) ? sessionIds : []).filter((id) => typeof id === 'string' && id !== ''))];
  if (ids.length === 0) return { ok: false, code: 'bad-args', trashed: 0, failed: [] };

  const known = await knownSessionIds(store);
  /** @type {Array<{ sessionId: string, code: string }>} */
  const failed = [];
  let trashed = 0;

  for (const sessionId of ids) {
    /* Re-checked per id: the app may have re-listed it since the scan. */
    if (known.has(sessionId)) {
      failed.push({ sessionId, code: 'still-listed' });
      continue;
    }
    if (store.isRunning(sessionId)) {
      failed.push({ sessionId, code: 'live' });
      continue;
    }
    const dirs = await store.findSessionDirectories(sessionId);
    if (dirs.length === 0) {
      failed.push({ sessionId, code: 'missing' });
      continue;
    }
    if (dirs.length > 1) {
      failed.push({ sessionId, code: 'ambiguous' });
      continue;
    }
    const dir = dirs[0];
    if (!looksLikeSessionDir(dir)) {
      failed.push({ sessionId, code: 'not-a-session' });
      continue;
    }

    const logFile = await store.findLogFile(dir);
    const label = logFile === '' ? '' : cleanTitle(await readSessionTitle(join(dir, logFile)));
    const trashId = `${stampOf(new Date())}-${sessionId}`;
    const itemDir = join(env.trash.dir, 'items', trashId);
    const payloadDir = join(itemDir, 'session');
    const sizeBytes = await sizeOf(dir);
    const manifest = {
      kind: 'session',
      trashId,
      sessionId,
      sessionTitle: label,
      originalPath: dir,
      logFile,
      cwd: '',
      workspaceId: null,
      workspaceTitle: null,
      /* Nothing to hide in the sidebar: the row was already gone. */
      archivedByUs: false,
      orphan: true,
      trashedAt: new Date().toISOString(),
      sizeBytes,
    };

    try {
      await writeManifest(itemDir, manifest);
      await movePath(dir, payloadDir);
      trashed += 1;
      await appendOperation(env.dshHome, {
        op: 'session.orphan.trash',
        sessionId,
        trashId,
        dir,
        sizeBytes,
      });
    } catch (error) {
      await rollbackMove(itemDir, payloadDir, dir, undefined, store);
      const code = error?.code === 'busy' ? 'busy' : 'move-failed';
      failed.push({ sessionId, code });
      await appendOperation(env.dshHome, {
        op: 'session.orphan.trash.failed',
        sessionId,
        code,
        detail: String(error?.message ?? error),
      });
    }
  }

  if (trashed === 0) return { ok: false, code: failed[0]?.code ?? 'failed', trashed, failed };
  return { ok: true, trashed, failed };
}

/**
 * Workspaces that still hold sessions, for the panel's "move a whole
 * workspace" section.
 *
 * @param {import('./store.js').Store} store
 * @returns {Array<{ id: string, title: string, path: string, sessionCount: number }>}
 */
export function listWorkspaces(store) {
  const registry = store.registry;
  if (registry === undefined || typeof registry.list !== 'function') return [];
  try {
    return registry.list().map((workspace) => ({
      id: String(workspace.id),
      title: typeof workspace.title === 'string' ? workspace.title : '',
      path: typeof workspace.path === 'string' ? workspace.path : '',
      sessionCount: Array.isArray(workspace.sessionIds) ? workspace.sessionIds.length : 0,
    }));
  } catch {
    return [];
  }
}
