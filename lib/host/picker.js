/**
 * Asking the desktop for a folder.
 *
 * The browser half cannot open a native dialog — a plugin bundle has no handle on
 * the application's window — so the host opens one. Three transports, best first:
 *
 * 1. Electron's own `dialog.showOpenDialog` when the host runs inside the desktop
 *    app: properly parented, modal, remembers the last folder;
 * 2. the platform's file manager dialog as a subprocess (PowerShell's
 *    `FolderBrowserDialog` on Windows, `osascript` on macOS, `zenity` on Linux) for
 *    a host running under plain `node`;
 * 3. nothing, in which case the caller is told `unsupported` and the GUI falls
 *    back to a text field it already knows how to use.
 *
 * Nothing here throws: a picker that cannot open is a code, not a crash, and
 * `DSH_SESSION_DELETE_NO_PICKER=1` disables it outright for tests and headless
 * deployments.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/** How long a person gets to choose a folder before we give up. */
const PICK_TIMEOUT_MS = 180_000;

/**
 * @typedef {{ code: number, stdout: string, stderr: string, timedOut: boolean }} RunResult
 * @typedef {(argv: string[], options: { timeoutMs: number }) => Promise<RunResult>} Runner
 * @typedef {{ ok: boolean, path?: string, via?: string, code?: string, detail?: string }} PickResult
 */

/**
 * Run a program without a shell, with a deadline and captured output.
 *
 * @type {Runner}
 */
export async function runCapture(argv, options) {
  return await new Promise((resolve) => {
    /** @type {any} */
    let child;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child?.kill();
      } catch {
        /* already gone */
      }
      finish({ code: -1, stdout: '', stderr: 'timeout', timedOut: true });
    }, options.timeoutMs);
    try {
      child = spawn(argv[0], argv.slice(1), {
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
      if (stdout.length < 16 * 1024) stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 16 * 1024) stderr += String(chunk);
    });
    child.on('error', (error) => finish({ code: -1, stdout, stderr: String(error?.message ?? error), timedOut: false }));
    child.on('close', (code) => finish({ code: typeof code === 'number' ? code : -1, stdout, stderr, timedOut: false }));
  });
}

/**
 * Whether this build may open a picker at all.
 * @returns {boolean}
 */
export function canPick() {
  return process.env.DSH_SESSION_DELETE_NO_PICKER !== '1';
}

/**
 * The argv for the platform's folder dialog, or null when there is none.
 *
 * @param {string} platform
 * @param {string} start
 * @param {string} title
 * @returns {string[] | null}
 */
export function pickerArgv(platform, start, title) {
  if (platform === 'win32') {
    const safeStart = start.replace(/'/g, "''");
    const safeTitle = title.replace(/'/g, "''");
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      `$dialog.Description = '${safeTitle}'`,
      `if ('${safeStart}' -ne '') { $dialog.SelectedPath = '${safeStart}' }`,
      '$dialog.ShowNewFolderButton = $true',
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
    ].join('; ');
    return ['powershell.exe', '-NoProfile', '-NonInteractive', '-STA', '-Command', script];
  }
  if (platform === 'darwin') {
    return ['osascript', '-e', `POSIX path of (choose folder with prompt "${title}")`];
  }
  if (platform === 'linux') {
    return ['zenity', '--file-selection', '--directory', `--title=${title}`];
  }
  return null;
}

/**
 * Ask the desktop for a folder, without throwing.
 *
 * @param {{ start?: string, title?: string, run?: Runner, loadElectron?: () => Promise<any> }} [options]
 * @returns {Promise<PickResult>}
 */
export async function pickFolder(options = {}) {
  if (canPick() === false) return { ok: false, code: 'unsupported' };
  const start = typeof options.start === 'string' ? options.start : '';
  const title = typeof options.title === 'string' && options.title !== '' ? options.title : 'Choose a folder';
  const loadElectron = options.loadElectron ?? (() => import('electron'));

  /* 1. The desktop app's own dialog. */
  try {
    const electron = await loadElectron();
    const dialog = electron?.dialog;
    if (dialog !== undefined && typeof dialog.showOpenDialog === 'function') {
      const window = electron?.BrowserWindow?.getFocusedWindow?.() ?? null;
      const request = {
        title,
        properties: ['openDirectory', 'createDirectory'],
        ...(start !== '' && existsSync(start) ? { defaultPath: start } : {}),
      };
      const result = window === null ? await dialog.showOpenDialog(request) : await dialog.showOpenDialog(window, request);
      if (result === undefined || result === null || result.canceled === true) return { ok: false, code: 'cancelled' };
      const chosen = Array.isArray(result.filePaths) ? result.filePaths[0] : undefined;
      if (typeof chosen !== 'string' || chosen === '') return { ok: false, code: 'cancelled' };
      return { ok: true, path: chosen, via: 'electron' };
    }
  } catch {
    /* not running inside Electron: fall through to the platform dialog */
  }

  /* 2. The platform's folder browser. */
  const argv = pickerArgv(process.platform, start, title);
  if (argv === null) return { ok: false, code: 'unsupported' };
  const run = options.run ?? runCapture;
  let outcome;
  try {
    outcome = await run(argv, { timeoutMs: PICK_TIMEOUT_MS });
  } catch (error) {
    return { ok: false, code: 'picker-failed', detail: String(error?.message ?? error) };
  }
  if (outcome.timedOut === true) return { ok: false, code: 'picker-failed', detail: 'timeout' };
  const chosen = String(outcome.stdout ?? '').trim();
  /* The dialog closing without a choice prints nothing and exits 0; zenity exits 1. */
  if (chosen === '') return { ok: false, code: 'cancelled' };
  if (outcome.code !== 0 && outcome.code !== null) return { ok: false, code: 'cancelled' };
  return { ok: true, path: chosen, via: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux' };
}
