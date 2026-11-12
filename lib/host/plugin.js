/**
 * dsh-session-delete — host half.
 *
 * A third-party DSH plugin follows three rules that matter more than any
 * feature, because breaking them breaks the whole app:
 *
 *   1. `apply()` never throws. A synchronous throw fails this loader entry and
 *      the boot audit turns it into "Failed to load plugins".
 *   2. No module-level `inject`. Declaring a service nobody provides leaves the
 *      entry PENDING and drags the entire plugin tree down with it; the trash
 *      only needs `webServer`, and it asks for it late with `ctx.inject()`.
 *   3. No log noise. A working plugin says nothing; anything worth saying is
 *      said once, with what the reader can do about it.
 *
 * Everything else lives in `./lib/host/*`: this file only wires the service
 * lifecycle to the route table.
 */
import { buildRoutes, ROUTE_PREFIX, scheduleAutoUpdate } from './routes.js';
import { Store } from './store.js';
import { messageOf } from './http.js';

const PACKAGE_ID = 'dsh-session-delete';

/**
 * Read the mount row's `config` without trusting its shape.
 *
 * @param {unknown} config
 * @returns {{ trashDir: string }}
 */
export function normalizeConfig(config) {
  if (config === null || config === undefined || typeof config !== 'object') return { trashDir: '' };
  const trashDir = /** @type {{ trashDir?: unknown }} */ (config).trashDir;
  return { trashDir: typeof trashDir === 'string' ? trashDir.trim() : '' };
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {unknown} [config]
 */
export function apply(ctx, config) {
  try {
    const mountConfig = normalizeConfig(config);
    const store = new Store(ctx);
    /** @type {string[]} */
    const warnings = [];
    const report = (error) => {
      try {
        const text = messageOf(error);
        /* One line per distinct failure: a broken route must not flood a log. */
        if (text !== '' && !warnings.includes(text)) {
          warnings.push(text);
          console.warn(`[${PACKAGE_ID}] request failed: ${text}`);
        }
      } catch {
        /* reporting must never throw either */
      }
    };

    ctx.inject(['webServer'], (scoped) => {
      try {
        const server = scoped.webServer;
        if (server === undefined || typeof server.register !== 'function') return;
        for (const [path, handler] of buildRoutes(store, mountConfig, report)) {
          scoped.effect(() => server.register({ kind: 'exact', path, handler }), `${PACKAGE_ID}: ${path}`);
        }
        /* One background look at the repository, well after boot so it can
           never delay the window. It only reads unless auto-pull is on. */
        scoped.effect(() => {
          const sweep = scheduleAutoUpdate(store, mountConfig);
          const timer = setTimeout(() => {
            sweep().catch(() => {});
          }, 10_000);
          if (typeof timer.unref === 'function') timer.unref();
          return () => clearTimeout(timer);
        }, `${PACKAGE_ID}: auto update check`);
      } catch (error) {
        report(error);
      }
    });
  } catch (error) {
    /* apply() must not throw, whatever happens */
    try {
      console.warn(`[${PACKAGE_ID}] not started: ${messageOf(error)}`);
    } catch {
      /* nothing left to do */
    }
  }
}

export default { name: PACKAGE_ID, apply };
export { ROUTE_PREFIX, PACKAGE_ID };
