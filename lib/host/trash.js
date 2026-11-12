/**
 * The trash directory on disk.
 *
 * Layout (one directory per trashed record, so a half-finished move is one
 * directory to throw away):
 *
 *   <trashDir>/items/<trashId>/manifest.json      what this item is, and where it came from
 *   <trashDir>/items/<trashId>/session/           one trashed session (its log directory)
 *   <trashDir>/items/<trashId>/sessions/<id>/     a trashed workspace, one directory per session
 */
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { exists, isInside } from './paths.js';

/** Manifest format this build writes and reads. */
export const TRASH_FORMAT = 2;

/**
 * @typedef {object} TrashedSession
 * @property {string} sessionId
 * @property {string} originalPath
 * @property {string} logFile
 * @property {string} cwd
 * @property {boolean} archivedByUs
 *
 * @typedef {object} TrashItem
 * @property {number} version
 * @property {'session' | 'workspace'} kind
 * @property {string} trashId
 * @property {string} trashedAt
 * @property {string} dir       the item directory on disk
 * @property {string} payloadDir the directory holding the moved records
 */

/**
 * Timestamp prefix that keeps trash ids sortable by hand.
 * @param {Date} date
 * @returns {string}
 */
export function stampOf(date) {
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    '-',
    pad(date.getMilliseconds(), 3),
  ].join('');
}

/**
 * Move a directory without ever overwriting the target.
 *
 * A rename is atomic but only works inside one volume; across volumes (EXDEV,
 * or ENOTSUP for a filesystem that cannot rename) it degrades to copy-then-
 * delete, which is why every caller treats a partially moved item as rollback
 * material rather than as success.
 *
 * EPERM / EACCES / EBUSY are *not* degraded: on Windows they are what an open
 * file handle looks like, and copying a log that a running turn is still
 * writing would produce a truncated record. They surface as `busy` instead.
 *
 * @param {string} from
 * @param {string} to
 * @returns {Promise<'rename' | 'copy'>}
 */
/**
 * Why a rename failed, in the vocabulary the routes answer with.
 *
 * Windows reports an open file handle as EPERM/EACCES/EBUSY; those must not
 * fall through to the copy fallback, because copying a log a running turn is
 * still writing produces a truncated record.
 *
 * @param {unknown} error
 * @returns {'busy' | 'copy' | undefined}
 */
export function moveErrorCode(error) {
  const code = error === null || error === undefined ? undefined : error.code;
  if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') return 'busy';
  if (code === 'EXDEV' || code === 'ENOTSUP') return 'copy';
  return undefined;
}

export async function movePath(from, to) {
  if (await exists(to)) throw new Error(`target already exists: ${to}`);
  try {
    await rename(from, to);
    return 'rename';
  } catch (error) {
    const verdict = moveErrorCode(error);
    if (verdict === 'busy') {
      const busy = new Error(`the record is in use: ${from}`);
      // @ts-expect-error - code carries the domain answer to the caller
      busy.code = 'busy';
      throw busy;
    }
    if (verdict !== 'copy') throw error;
    await cp(from, to, { recursive: true, force: false, errorOnExist: true });
    await rm(from, { recursive: true, force: true });
    return 'copy';
  }
}

/**
 * Recursive byte size, used only for display; unreadable entries count as 0.
 * @param {string} path
 * @returns {Promise<number>}
 */
export async function sizeOf(path) {
  let total = 0;
  const stack = [path];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        try {
          total += (await stat(full)).size;
        } catch {
          /* an unreadable file is not worth failing the listing over */
        }
      }
    }
  }
  return total;
}

/**
 * Read every item in the trash, newest first.
 *
 * Items are skipped rather than repaired when the manifest is unreadable or
 * written by a newer format: half-understanding a manifest is how a restorable
 * record becomes an unrecoverable one.
 *
 * @param {string} trashDir
 * @returns {Promise<Array<TrashItem>>}
 */
export async function readItems(trashDir) {
  const itemsDir = join(trashDir, 'items');
  let names;
  try {
    names = await readdir(itemsDir);
  } catch {
    return [];
  }
  /** @type {Array<TrashItem>} */
  const items = [];
  for (const name of names) {
    const dir = join(itemsDir, name);
    try {
      const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
      if (manifest === null || typeof manifest !== 'object') continue;
      if (manifest.version !== TRASH_FORMAT) continue;
      if (typeof manifest.trashId !== 'string' || manifest.trashId !== name) continue;
      if (typeof manifest.trashedAt !== 'string') continue;
      if (manifest.kind === 'workspace') {
        if (!Array.isArray(manifest.sessions) || typeof manifest.path !== 'string') continue;
        items.push({ ...manifest, dir, payloadDir: dir });
        continue;
      }
      if (manifest.kind !== 'session') continue;
      if (typeof manifest.sessionId !== 'string' || typeof manifest.originalPath !== 'string') continue;
      items.push({ ...manifest, dir, payloadDir: join(dir, 'session') });
    } catch {
      /* not one of ours, or damaged: leave it alone */
    }
  }
  return items.sort((left, right) => String(right.trashedAt).localeCompare(String(left.trashedAt)));
}

/**
 * @param {string} trashDir
 * @param {string} trashId
 * @returns {Promise<TrashItem | undefined>}
 */
export async function readItem(trashDir, trashId) {
  for (const item of await readItems(trashDir)) if (item.trashId === trashId) return item;
  return undefined;
}

/**
 * Write one item's manifest.
 * @param {string} dir
 * @param {object} manifest
 * @returns {Promise<void>}
 */
export async function writeManifest(dir, manifest) {
  await mkdir(dir, { recursive: true });
  const target = join(dir, 'manifest.json');
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ ...manifest, version: TRASH_FORMAT }, null, 2)}\n`, 'utf8');
  await rename(temp, target);
}

/**
 * Move every item of one trash directory into another, all or nothing.
 *
 * @param {string} fromDir
 * @param {string} toDir
 * @returns {Promise<{ ok: true, migrated: number } | { ok: false, code: string, detail: string }>}
 */
export async function migrateItems(fromDir, toDir) {
  if (resolve(fromDir) === resolve(toDir)) return { ok: true, migrated: 0 };
  const items = await readItems(fromDir);
  if (items.length === 0) return { ok: true, migrated: 0 };
  await mkdir(join(toDir, 'items'), { recursive: true });
  /** @type {Array<{ from: string, to: string }>} */
  const moved = [];
  for (const item of items) {
    if (!isInside(item.dir, fromDir)) return { ok: false, code: 'unsafe-path', detail: item.dir };
    const target = join(toDir, 'items', basename(item.dir));
    try {
      await movePath(item.dir, target);
      moved.push({ from: target, to: item.dir });
    } catch (error) {
      for (const undo of moved) {
        try {
          await movePath(undo.from, undo.to);
        } catch {
          /* rollback is best effort; the report already says the migration failed */
        }
      }
      return { ok: false, code: 'migrate-failed', detail: String(error?.message ?? error) };
    }
  }
  return { ok: true, migrated: moved.length };
}

/**
 * Item count and total size of one trash directory.
 * @param {string} trashDir
 * @returns {Promise<{ items: number, bytes: number }>}
 */
export async function trashStats(trashDir) {
  const items = await readItems(trashDir);
  let bytes = 0;
  for (const item of items) bytes += await sizeOfItem(item);
  return { items: items.length, bytes };
}

/**
 * The size of one item, from its manifest when it was recorded there.
 *
 * Every panel refresh used to walk the whole payload of every item. The size is
 * now written once, when the record is created; only items trashed by an older
 * build (or whose manifest lost the field) are measured again.
 *
 * @param {TrashItem} item
 * @returns {Promise<number>}
 */
export async function sizeOfItem(item) {
  if (typeof item.sizeBytes === 'number' && Number.isFinite(item.sizeBytes) && item.sizeBytes >= 0) {
    return item.sizeBytes;
  }
  return await sizeOf(item.payloadDir);
}
