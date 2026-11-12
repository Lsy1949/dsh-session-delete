/**
 * Handing a path to the desktop's file manager.
 *
 * The plugin owns no window and cannot open one from the browser half, so the
 * host does it: the renderer names a *known* target (`log`, `config`, `trash`)
 * and this module resolves it to a path the plugin already owns. No caller
 * supplies a path, which is what keeps this from becoming a general purpose
 * "run this" endpoint.
 *
 * `DSH_SESSION_DELETE_NO_OPEN=1` disables launching entirely — a test or a
 * headless deployment must never pop a window.
 */
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stateDirOf } from './paths.js';

/** Targets a caller may ask for, resolved to plugin-owned paths. */
const TARGETS = new Set(['log', 'config', 'trash']);

/**
 * Resolve one named target against the plugin's own directories.
 *
 * @param {string} target
 * @param {{ dshHome: string, trashDir: string }} env
 * @returns {{ ok: true, path: string } | { ok: false, code: string }}
 */
export function resolveTarget(target, env) {
  if (typeof target !== 'string' || TARGETS.has(target) === false) return { ok: false, code: 'unknown-target' };
  const stateDir = stateDirOf(env.dshHome);
  if (target === 'log') return { ok: true, path: join(stateDir, 'operations.log') };
  if (target === 'config') return { ok: true, path: join(stateDir, 'config.json') };
  return { ok: true, path: env.trashDir };
}

/**
 * Whether this build may launch a file manager at all.
 * @returns {boolean}
 */
export function canLaunch() {
  return process.env.DSH_SESSION_DELETE_NO_OPEN !== '1';
}

/**
 * Open `targetPath` in the platform's file manager, selecting it when it is a
 * file and opening it when it is a directory.
 *
 * @param {string} targetPath
 * @returns {{ opened: boolean, path: string, command: string[] }}
 */
export function revealPath(targetPath) {
  let path = targetPath;
  let isDirectory = false;
  try {
    isDirectory = statSync(path).isDirectory();
  } catch {
    /* nothing there yet: fall back to the folder that should hold it */
    path = dirname(path);
  }

  /** @type {string[]} */
  let argv;
  if (process.platform === 'win32') {
    argv = isDirectory ? ['explorer.exe', path] : ['explorer.exe', `/select,${path}`];
  } else if (process.platform === 'darwin') {
    argv = isDirectory ? ['open', path] : ['open', '-R', path];
  } else {
    argv = ['xdg-open', dirname(path)];
  }

  if (canLaunch() === false) return { opened: false, path, command: argv };

  try {
    const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore' });
    child.on('error', () => {
      /* a missing opener is not worth failing the request over */
    });
    child.unref();
    return { opened: true, path, command: argv };
  } catch {
    return { opened: false, path, command: argv };
  }
}
