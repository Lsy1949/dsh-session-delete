/**
 * Recovering a session's title from its own log.
 *
 * Titles are not part of the session header; DSH stores each accepted title as
 * a `session/title` event inside the log, and the latest one wins. That is why a
 * trashed record can still be labelled properly: the log travels into the trash
 * with the rest of the session, so the name is recoverable from the artifact
 * itself — no title service, no LLM call, no network.
 *
 * A DSH log is a sequence of independent zstd frames, one per appended batch.
 * Only the beginning of the file is read: titles are accepted in the first
 * frames, right after the first user message, and a multi-megabyte log must not
 * be decompressed to render a list row.
 */
import { open } from 'node:fs/promises';
import zlib from 'node:zlib';

/** Zstandard frame magic, used to split the file into frames. */
const FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
/** How much of a log is read at most. */
const MAX_READ_BYTES = 8 * 1024 * 1024;
/** Recovered titles, keyed by artifact identity, so a panel reload is free. */
const cache = new Map();

/**
 * @returns {((buffer: Buffer) => Buffer) | null}
 */
function decompressor() {
  const fn = typeof zlib.zstdDecompressSync === 'function' ? zlib.zstdDecompressSync : undefined;
  return typeof fn === 'function' ? fn : null;
}

/**
 * The `session/title` value carried by one decompressed chunk.
 *
 * @param {string} text
 * @param {string} current
 * @returns {string}
 */
function latestTitle(text, current) {
  if (text.indexOf('"session/title"') < 0) return current;
  let found = current;
  for (const line of text.split('\n')) {
    if (line.indexOf('"session/title"') < 0) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed === null || typeof parsed !== 'object') continue;
      if (parsed.type !== 'session/title') continue;
      const data = parsed.data;
      if (data === null || typeof data !== 'object') continue;
      if (typeof data.title !== 'string' || data.title.trim() === '') continue;
      found = data.title;
    } catch {
      /* a damaged line is skipped, never repaired */
    }
  }
  return found;
}

/**
 * Read the newest accepted title out of a stored session log.
 *
 * @param {string} logPath
 * @returns {Promise<string>} the title, or an empty string when the log carries
 *   none (or cannot be read in this build).
 */
export async function readSessionTitle(logPath) {
  const decompress = decompressor();
  if (decompress === null) return '';
  if (typeof logPath !== 'string' || logPath === '') return '';

  let handle;
  try {
    handle = await open(logPath, 'r');
    const info = await handle.stat();
    if (info.size === 0) return '';
    const key = `${logPath}:${String(info.size)}:${String(info.mtimeMs)}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const length = Math.min(info.size, MAX_READ_BYTES);
    const head = Buffer.alloc(length);
    await handle.read(head, 0, length, 0);

    /** @type {Array<number>} */
    const starts = [];
    let at = head.indexOf(FRAME_MAGIC);
    while (at !== -1) {
      starts.push(at);
      at = head.indexOf(FRAME_MAGIC, at + FRAME_MAGIC.length);
    }
    if (starts.length === 0) return '';

    let title = '';
    for (let index = 0; index < starts.length; index += 1) {
      const start = starts[index];
      const end = index + 1 < starts.length ? starts[index + 1] : length;
      /* The final frame may be cut by the read window; skip it rather than
         pretend its partial payload means something. */
      if (index + 1 === starts.length && length < info.size) break;
      let text = '';
      try {
        text = decompress(head.subarray(start, end)).toString('utf8');
      } catch {
        continue;
      }
      title = latestTitle(text, title);
    }

    if (cache.size > 500) cache.clear();
    cache.set(key, title);
    return title;
  } catch {
    return '';
  } finally {
    try {
      await handle?.close();
    } catch {
      /* nothing left to close */
    }
  }
}
