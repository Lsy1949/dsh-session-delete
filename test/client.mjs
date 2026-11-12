/**
 * Client-half test: load the browser bundle the way the Module Loader does,
 * then assert what it registers and that the components render without a real
 * browser (no DOM, no React, no host).
 *
 * Run with `node test/client.mjs`.
 */
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, '..', 'client.js'), 'utf8');

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

/* --------------------------------------------------------------- harness */

/** A React small enough to render shallowly: hooks exist, effects do not run. */
class FakeComponent {
  constructor(props) {
    this.props = props ?? {};
    this.state = null;
  }
  setState(patch) {
    this.state = { ...(this.state ?? {}), ...(typeof patch === 'function' ? patch(this.state) : patch) };
  }
}
FakeComponent.prototype.isReactComponent = {};

function fakeReact() {
  return {
    Component: FakeComponent,
    /* React semantics: children live in `props.children`, not beside it. */
    createElement(type, props, ...children) {
      const merged = { ...(props === null || props === undefined ? {} : props) };
      if (children.length === 1) merged.children = children[0];
      else if (children.length > 1) merged.children = children;
      return { type, props: merged };
    },
    useState(initial) {
      const value = typeof initial === 'function' ? initial() : initial;
      return [value, () => {}];
    },
    /* Run the effect inline: a crash inside an effect (a service read at mount
       time, say) must fail this suite, not only the browser. */
    useEffect(fn) {
      const cleanup = fn();
      if (typeof cleanup === 'function') return cleanup;
      return undefined;
    },
    useCallback(fn) {
      return fn;
    },
    useMemo(fn) {
      return fn();
    },
    Fragment: 'Fragment',
  };
}

/** The fetch stub, so no test ever leaves the process. */
const calls = [];
function fakeFetch(url, init) {
  calls.push({ url, body: init?.body === undefined ? undefined : JSON.parse(init.body) });
  return Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        ok: true,
        apiVersion: 3,
        items: [],
        workspaces: [],
        stats: { items: 0, bytes: 0 },
        trashDir: 'C:\\Users\\Test\\.dsh\\trash\\sessions',
        defaultTrashDir: 'C:\\Users\\Test\\.dsh\\trash\\sessions',
        configuredTrashDir: '',
      }),
  });
}

/** Minimal document so style injection and querySelector work. */
function fakeDocument() {
  return {
    head: { appendChild() {} },
    querySelector() {
      return null;
    },
    createElement() {
      return { dataset: {}, textContent: '' };
    },
  };
}

const loader = { load() {} };
const context = vm.createContext({
  window: { __ModuleLoader__: loader },
  document: fakeDocument(),
  navigator: { language: 'zh-CN' },
  fetch: fakeFetch,
  console: { warn() {}, log() {}, error() {} },
  Promise,
  setTimeout,
  clearTimeout,
  JSON,
  Date,
  String,
  Number,
  Object,
  Array,
  Math,
  isFinite,
  isNaN,
  RegExp,
  Error,
});

/* ------------------------------------------------------------- the bundle */

vm.runInContext(source, context, { filename: 'client.js' });
check('the bundle registers itself with the module loader', typeof loader.load === 'function');

let bundle = null;
loader.load = (definition) => {
  bundle = definition;
};
vm.runInContext(source, context, { filename: 'client.js' });

check('the bundle id is the package id', bundle !== null && bundle.id === 'dsh-session-delete', bundle === null ? 'not loaded' : bundle.id);

/* Stands in for the shipped MenuItemButton: renders a button and keeps its label. */
const menuButton = (props) => ({ type: 'button', props: { ...(props ?? {}), 'data-primitive': 'MenuItemButton' } });

/* The bundle keeps one React reference; swap what it delegates to per render. */
let activeReact = fakeReact();
const react = {
  get Component() {
    return activeReact.Component;
  },
  createElement: (...args) => activeReact.createElement(...args),
  useState: (...args) => activeReact.useState(...args),
  useEffect: (...args) => activeReact.useEffect(...args),
  useCallback: (...args) => activeReact.useCallback(...args),
  useMemo: (...args) => activeReact.useMemo(...args),
};

const moduleExports = bundle.factory((specifier) => {
  if (specifier === 'react') return react;
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return { MenuItemButton: menuButton };
  throw new Error(`unexpected module request: ${specifier}`);
});

check('the client half exports apply()', typeof moduleExports.apply === 'function');
check(
  'it injects only the certainly-provided service',
  Array.isArray(moduleExports.inject) && moduleExports.inject.length === 1 && moduleExports.inject[0] === 'slots',
  JSON.stringify(moduleExports.inject),
);

/* ------------------------------------------------------------- the context */

const registrations = [];
const fakeSessions = { refreshProjections: () => Promise.resolve() };
const ctx = {
  get: (name) => (name === 'sessions' ? fakeSessions : undefined),
  effect: (factory) => {
    factory();
    return () => {};
  },
  slots: {
    inject(name, factory) {
      registrations.push({ slot: name });
      return factory(name);
    },
    register(options, Component) {
      registrations.push({ options, Component });
      return () => {};
    },
  },
};

moduleExports.apply(ctx);

const entries = registrations.filter((entry) => entry.options !== undefined);
const slots = entries.map((entry) => entry.options.name);

check('seven slot entries are registered', entries.length === 7, String(entries.length));
check('the session row menu is extended', slots.includes('sidebar.workspaces.session.menu.item'));
check('the session row hover action is extended', slots.includes('sidebar.workspaces.session.row.action'));
check('the confirmation overlay is extended', slots.includes('shell.overlay'));
check('the sidebar panel list is extended', slots.includes('sidebar.panellist'));
check('the main panel is extended', slots.includes('main'));
check('the settings rail is extended', slots.includes('settings.section'));
check('the settings nav icon is extended', slots.includes('settings.section.icon'));

const sessionEntry = entries.find((entry) => entry.options.name === 'sidebar.workspaces.session.menu.item');
check('the session entry sits after the shipped archive row', sessionEntry.options.order > 400, String(sessionEntry.options.order));

const panelEntry = entries.find((entry) => entry.options.name === 'main');
check('the panel page is keyed by the plugin id', panelEntry.options.key === 'dsh-session-delete', JSON.stringify(panelEntry.options));

/* ------------------------------------------------------------- rendering */

/**
 * Render a component shallowly: call function components, keep host elements.
 * @param {any} node
 * @returns {any}
 */
function render(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(render).filter((child) => child !== null);
  if (typeof node.type === 'function') {
    if (node.type.prototype !== undefined && node.type.prototype.isReactComponent !== undefined) {
      return render(new node.type(node.props).render());
    }
    return render(node.type(node.props));
  }
  const children = node.props === undefined ? [] : node.props.children;
  return {
    type: node.type,
    props: node.props,
    children: (Array.isArray(children) ? children : children === undefined ? [] : [children]).map(render).filter((child) => child !== null),
  };
}

/** Collect every text node in a rendered tree. */
function texts(tree) {
  if (tree === null || tree === undefined) return [];
  if (typeof tree === 'string') return [tree];
  if (Array.isArray(tree)) return tree.flatMap(texts);
  return texts(tree.children);
}

const closed = { value: false };
const menuElement = sessionEntry.Component({
  sessionId: 'session-a',
  displayTitle: 'hello',
  useMenuOpenState: () => [false, (value) => (closed.value = value)],
});

const renderedMenu = render(menuElement);
check('the menu item renders the move label', texts(renderedMenu).includes('移至垃圾桶…'), JSON.stringify(texts(renderedMenu)));
check('the menu item uses the shipped MenuItemButton', renderedMenu.props['data-primitive'] === 'MenuItemButton', JSON.stringify(renderedMenu.props));

const beforeMenu = calls.length;
renderedMenu.props.onSelect();
await new Promise((resolve) => setTimeout(resolve, 0));
check('selecting asks first instead of moving at once', calls.length === beforeMenu, JSON.stringify(calls.slice(beforeMenu)));
const pendingRequest = moduleExports.__internals.getConfirmRequest();
check(
  'the request names the session and its title',
  pendingRequest !== null && pendingRequest.kind === 'session' && pendingRequest.sessionId === 'session-a' && pendingRequest.title === 'hello',
  JSON.stringify(pendingRequest),
);

const overlayEntry = entries.find((entry) => entry.options.name === 'shell.overlay');
const dialogTree = renderWith(overlayEntry.Component, ['zh', pendingRequest, false, null, false]);
const dialogTexts = texts(dialogTree);
check('the dialog names the session', dialogTexts.some((text) => text.indexOf('hello') >= 0), JSON.stringify(dialogTexts));
check('the dialog offers cancel and confirm', dialogTexts.includes('取消') && dialogTexts.includes('确认'), JSON.stringify(dialogTexts));

/** Find the first element whose own text is exactly `label`. */
function findByText(tree, label) {
  if (tree === null || tree === undefined) return null;
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const hit = findByText(child, label);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (typeof tree === 'string') return null;
  const own = tree.children.filter((child) => typeof child === 'string');
  if (own.length === 1 && own[0] === label) return tree;
  for (const child of tree.children) {
    const hit = findByText(child, label);
    if (hit !== null) return hit;
  }
  return null;
}

const confirmButton = findByText(dialogTree, '确认');
check('the confirm button is reachable', confirmButton !== null);
check(
  'the confirm button is red, not an outline button',
  String(confirmButton.props.className || '').indexOf('dsd-danger-solid') >= 0,
  String(confirmButton.props.className),
);
const cancelButton = findByText(dialogTree, '取消');
check(
  'the cancel button is not painted as a danger',
  cancelButton !== null && String(cancelButton.props.className || '').indexOf('dsd-danger') < 0,
  cancelButton === null ? 'missing' : String(cancelButton.props.className),
);
const beforeConfirm = calls.length;
confirmButton.props.onClick();
await new Promise((resolve) => setTimeout(resolve, 0));
const moveCall = calls.slice(beforeConfirm).find((entry) => entry.url === '/dsh-session-delete/session/move');
check('confirming posts the session id to the host', moveCall !== undefined && moveCall.body.sessionId === 'session-a', JSON.stringify(moveCall));
check('confirming clears the request', moduleExports.__internals.getConfirmRequest() === null, JSON.stringify(moduleExports.__internals.getConfirmRequest()));

const panelComponent = panelEntry.Component;
const panelTree = render(react.createElement(panelComponent, {}));
check('the panel page renders its root', panelTree !== null && panelTree.type === 'div' && panelTree.props.className === 'dsd-root');
check('the panel page renders its loading state first', texts(panelTree).includes('正在加载…'), JSON.stringify(texts(panelTree)));

/* ------------------------------------------------ the panel with real data */

/**
 * Render a component once with hook values supplied in call order: the panel
 * renders its "ready" branch this way without a real reconciler.
 * @param {Function} Component
 * @param {any[]} values
 */
function renderWith(Component, values) {
  const queue = values.slice();
  activeReact = {
    ...fakeReact(),
    useState(initial) {
      if (queue.length > 0) {
        const next = queue.shift();
        return [typeof next === 'function' ? next() : next, () => {}];
      }
      const value = typeof initial === 'function' ? initial() : initial;
      return [value, () => {}];
    },
  };
  try {
    return render(react.createElement(Component, {}));
  } finally {
    activeReact = fakeReact();
  }
}

const emptyState = { ok: true, trashDir: 'C:\\t', trashSource: 'default', configuredTrashDir: '', stats: { items: 0, bytes: 0 }, items: [], workspaces: [] };
const emptyPanel = renderWith(panelComponent, ['zh', { phase: 'ready', state: emptyState, error: '' }, '', null, {}]);
check('the empty panel says so', texts(emptyPanel).includes('垃圾桶是空的。'), JSON.stringify(texts(emptyPanel).slice(0, 6)));

const filledState = {
  ...emptyState,
  stats: { items: 1, bytes: 2048 },
  items: [
    { kind: 'session', trashId: 't1', title: '论文截图', titleSource: 'name', sessionId: 'session-a', cwd: 'C:\\work', workspaceId: 'ws-1', workspaceTitle: 'Project', sessionCount: 1, trashedAt: '2026-11-11T14:00:00.000Z', sizeBytes: 2048 },
    { kind: 'session', trashId: 't2', title: '1', titleSource: 'folder', sessionId: 'session-e4b8a47e-1612-4aba-8d77-cb91795da01f', cwd: 'C:\\work', workspaceId: null, workspaceTitle: null, sessionCount: 1, trashedAt: '2026-11-11T13:00:00.000Z', sizeBytes: 100 },
  ],
  workspaces: [{ id: 'ws-1', title: 'Project', path: 'C:\\work', sessionCount: 2 }],
};
const filledPanel = renderWith(panelComponent, ['zh', { phase: 'ready', state: filledState, error: '' }, '', null, {}]);
const filledTexts = texts(filledPanel);
check('a trashed session is listed by its name', filledTexts.includes('论文截图'), JSON.stringify(filledTexts.slice(0, 8)));
check('the raw session id is not the primary label', filledTexts.includes('session-a') === false, JSON.stringify(filledTexts.slice(0, 8)));
check('the workspace it came from is shown', filledTexts.includes('Project'), JSON.stringify(filledTexts.slice(0, 12)));
check('the folder path is shown as well', filledTexts.includes('C:\\work'), JSON.stringify(filledTexts.slice(0, 12)));
check('the restore button is offered', filledTexts.includes('恢复'), JSON.stringify(filledTexts.slice(0, 12)));
check(
  'the empty trash hint survives the card layout',
  filledTexts.some((entry) => entry.indexOf('勾选后') >= 0),
  JSON.stringify(filledTexts.slice(0, 20)),
);
/* ---------------------------------------------------- scanning for orphans */

check(
  'the panel offers a scan for folders the app no longer lists',
  texts(emptyPanel).includes('扫描会话目录') && texts(emptyPanel).includes('开始扫描'),
  JSON.stringify(texts(emptyPanel)),
);

const scanResult = {
  phase: 'ready',
  scanned: 5,
  listed: 3,
  items: [
    {
      sessionId: 'session-o1',
      dir: 'C:\\Users\\Test\\.dsh\\sessions\\g\\session-o1',
      group: 'g',
      title: '遗留会话',
      logFile: 'session.v4.jsonl.zstd',
      sizeBytes: 2048,
      modifiedAt: '2026-11-10T08:00:00.000Z',
    },
    {
      sessionId: 'session-o2',
      dir: 'C:\\Users\\Test\\.dsh\\sessions\\g\\session-o2',
      group: 'g',
      title: '',
      logFile: '',
      sizeBytes: 100,
      modifiedAt: '2026-11-09T08:00:00.000Z',
    },
  ],
};

const scannedPanel = renderWith(panelComponent, ['zh', { phase: 'ready', state: filledState, error: '' }, '', null, {}, {}, scanResult, {}]);
const scannedTexts = texts(scannedPanel);
check('the scan summarises what it looked at', scannedTexts.includes('磁盘上有 5 个会话目录，其中 2 个已不在列表中'), JSON.stringify(scannedTexts.slice(0, 24)));
check('an orphaned folder is listed by the name in its log', scannedTexts.includes('遗留会话'), JSON.stringify(scannedTexts.slice(0, 24)));
check('its path is shown', scannedTexts.some((entry) => entry.includes('session-o1')), JSON.stringify(scannedTexts.slice(0, 24)));
check(
  'a folder with no recoverable name says so instead of showing a raw id',
  scannedTexts.includes('（没有名字的会话）'),
  JSON.stringify(scannedTexts.slice(0, 24)),
);
check(
  'each row can be moved to the trash or opened',
  scannedTexts.filter((entry) => entry === '移入垃圾桶').length === 2 && scannedTexts.includes('打开目录'),
  JSON.stringify(scannedTexts.slice(0, 30)),
);

const tickedScanPanel = renderWith(panelComponent, [
  'zh',
  { phase: 'ready', state: filledState, error: '' },
  '',
  null,
  {},
  {},
  scanResult,
  { 'session-o1': true },
]);
check(
  'ticking a scanned row offers the bulk move',
  texts(tickedScanPanel).includes('移入所选（1）'),
  JSON.stringify(texts(tickedScanPanel).slice(0, 30)),
);

const emptyScanPanel = renderWith(panelComponent, ['zh', { phase: 'ready', state: emptyState, error: '' }, '', null, {}, {}, { phase: 'ready', scanned: 4, listed: 4, items: [] }, {}]);
check(
  'a scan that finds nothing says so',
  texts(emptyScanPanel).includes('没有发现孤立的会话目录'),
  JSON.stringify(texts(emptyScanPanel).slice(0, 24)),
);

const selectedPanel = renderWith(panelComponent, ['zh', { phase: 'ready', state: filledState, error: '' }, '', null, { t1: true }, {}]);
const selectedTexts = texts(selectedPanel);
check(
  'a ticked selection offers restoring as well as deleting',
  selectedTexts.includes('恢复所选') && selectedTexts.includes('删除所选'),
  JSON.stringify(selectedTexts.slice(0, 20)),
);
check(
  'and it counts what is ticked',
  selectedTexts.includes('已选 1 条'),
  JSON.stringify(selectedTexts.slice(0, 20)),
);
check(
  'with nothing ticked there is no bulk action',
  filledTexts.includes('恢复所选') === false && filledTexts.includes('删除所选') === false,
  JSON.stringify(filledTexts.slice(0, 20)),
);

const ghostPanelState = { ...filledState, ghosts: [{ sessionId: 'session-e2d30fca' }, { sessionId: 'session-3e541024' }] };
const ghostPanel = renderWith(panelComponent, ['zh', { phase: 'ready', state: ghostPanelState, error: '' }, '', null, {}]);
const ghostTexts = texts(ghostPanel);
check(
  'the panel reports rows whose data is already gone',
  ghostTexts.some((entry) => entry.indexOf('还列在侧栏') >= 0),
  JSON.stringify(ghostTexts.slice(0, 24)),
);
check(
  'and offers to archive them',
  ghostTexts.includes('归档这些空行'),
  JSON.stringify(ghostTexts.slice(0, 24)),
);
check('a healthy trash says nothing about ghosts', filledTexts.every((entry) => entry.indexOf('还列在侧栏') < 0), JSON.stringify(filledTexts.slice(0, 24)));

check('the workspace action is offered', filledTexts.includes('删除工作区…'), JSON.stringify(filledTexts.slice(0, 16)));
check('every row can be deleted on its own', filledTexts.filter((text) => text === '永久删除').length === 2, JSON.stringify(filledTexts.slice(0, 20)));
check('the selection hint is shown', filledTexts.some((text) => text.indexOf('勾选后') >= 0), JSON.stringify(filledTexts.slice(0, 20)));
check('the selected count starts at zero', filledTexts.includes('已选 0 条'), JSON.stringify(filledTexts.slice(0, 20)));
const filledTree = filledPanel;
const checkboxes = (function collect(node, found) {
  if (node === null || node === undefined) return found;
  if (Array.isArray(node)) {
    for (const child of node) collect(child, found);
    return found;
  }
  if (typeof node === 'string') return found;
  if (node.type === 'input' && node.props.type === 'checkbox' && String(node.props.className || '').includes('dsd-check-box')) {
    found.push(node);
  }
  for (const child of node.children) collect(child, found);
  return found;
})(filledTree, []);
check('each row has a selection box', checkboxes.length === 2, String(checkboxes.length));
check('the panel reports the trash size', filledTexts.some((text) => text.indexOf('2.0 KB') >= 0), JSON.stringify(filledTexts.slice(0, 6)));
check(
  'an item with no recorded name shows a short id instead of a long one',
  filledTexts.some((text) => text === '#e4b8a47e'),
  JSON.stringify(filledTexts.slice(0, 16)),
);

const settingsEntry = entries.find((entry) => entry.options.name === 'settings.section');
const settingsIconEntry = entries.find((entry) => entry.options.name === 'settings.section.icon');
check(
  'the settings rail gets its own glyph entry',
  settingsIconEntry !== undefined && settingsIconEntry.options.id === settingsEntry.options.id,
  settingsIconEntry === undefined ? 'missing' : String(settingsIconEntry.options.id),
);
const iconTree = render(react.createElement(settingsIconEntry.Component, { size: 16 }));
check(
  'the rail glyph is a raw 16px svg, not an icon component with no props',
  iconTree !== null && iconTree.type === 'svg' && iconTree.props.width === 16 && iconTree.props.height === 16,
  JSON.stringify(iconTree === null ? null : { type: iconTree.type, width: iconTree.props.width }),
);
check(
  'the glyph paints with the current colour',
  iconTree !== null && iconTree.props.fill === 'currentColor' && iconTree.props['aria-hidden'] === 'true',
  JSON.stringify(iconTree === null ? null : { fill: iconTree.props.fill }),
);
const bigIcon = render(react.createElement(settingsIconEntry.Component, { size: 20 }));
check('the glyph honours the size it is given', bigIcon !== null && bigIcon.props.width === 20, String(bigIcon === null ? 'missing' : bigIcon.props.width));
const settingsTree = render(react.createElement(settingsEntry.Component, {}));
const settingsTexts = texts(settingsTree);
check(
  'the folder is one field with a browse button',
  settingsTexts.includes('浏览…') && settingsTexts.includes('垃圾桶目录'),
  JSON.stringify(settingsTexts.slice(0, 24)),
);
const folderInputs = (function collect(node, found) {
  if (node === null || node === undefined) return found;
  if (Array.isArray(node)) {
    for (const child of node) collect(child, found);
    return found;
  }
  if (typeof node === 'string') return found;
  if (node.type === 'input' && node.props.type === 'text') found.push(node);
  for (const child of node.children) collect(child, found);
  return found;
})(settingsTree, []);
check(
  'there is exactly one path field, and it is editable',
  folderInputs.length === 1 &&
    folderInputs[0].props.id === 'dsd-trash-dir' &&
    folderInputs[0].props.readOnly !== true &&
    typeof folderInputs[0].props.onChange === 'function',
  JSON.stringify(folderInputs.map((node) => node.props.id)),
);
check(
  'the field and its browse button sit in one row',
  typeof folderInputs[0].props.value === 'string' && settingsTexts.indexOf('浏览…') === settingsTexts.indexOf('垃圾桶目录') + 1,
  JSON.stringify(settingsTexts.slice(8, 14)),
);
check(
  'the settings page renders its root',
  settingsTree !== null && String(settingsTree.props.className).indexOf('dsd-root') === 0,
  settingsTree === null ? 'missing' : String(settingsTree.props.className),
);
check('the settings page renders the folder field', texts(settingsTree).includes('垃圾桶目录'));

/* ------------------------------------------------------- workspace labels */

/* The shipped dictionary ui-workspace registers for its workspace row menu. */
const localeDicts = new Map([
  ['workspace', new Map([
    ['zh', { 'delete.workspace': '删除工作区', 'delete.pending': '正在删除工作区…', rename: '重命名' }],
    ['en', { 'delete.workspace': 'Delete workspace', 'delete.pending': 'Deleting workspace…', rename: 'Rename' }],
  ])],
]);
let published = 0;
const fakeLocale = {
  dicts: localeDicts,
  register: () => () => {},
  getLocale: () => 'zh',
  publish: () => {
    published += 1;
  },
  subscribe: () => () => {},
};

registrations.length = 0;
const localeCtx = {
  get: (name) => (name === 'locale' ? fakeLocale : undefined),
  effect: (factory) => {
    factory();
    return () => {};
  },
  slots: ctx.slots,
};
moduleExports.apply(localeCtx);

const zhDict = localeDicts.get('workspace').get('zh');
const enDict = localeDicts.get('workspace').get('en');
check('the shipped "删除工作区" is renamed in Chinese', zhDict['delete.workspace'] === '移至未分组', zhDict['delete.workspace']);
check('the shipped "正在删除工作区…" is renamed too', zhDict['delete.pending'] === '正在移至未分组…', zhDict['delete.pending']);
check('the English wording follows', enDict['delete.workspace'] === 'Move to Ungrouped', enDict['delete.workspace']);
check('unrelated keys are untouched', zhDict.rename === '重命名', zhDict.rename);
check('the rename repaints the locale', published > 0, String(published));

/* ------------------------------------------------- service-less rendering */

/* A client context whose `locale` service is not there yet — the exact shape
   that used to crash the panel with "cannot read properties of undefined". */
const bareCtx = {
  get: () => undefined,
  effect: (factory) => {
    factory();
    return () => {};
  },
  slots: {
    inject: (name, factory) => factory(name),
    register: () => () => {},
  },
};
let bareThrew = null;
try {
  moduleExports.apply(bareCtx);
} catch (error) {
  bareThrew = error;
}
check('apply survives a context without services', bareThrew === null, bareThrew === null ? '' : String(bareThrew));

const barePanel = renderWith(panelEntry.Component, ['zh', { phase: 'ready', state: emptyState, error: '' }, '', null, {}]);
check('the panel renders without a locale service', texts(barePanel).includes('垃圾桶'), JSON.stringify(texts(barePanel).slice(0, 5)));

/* ------------------------------------------------------------ boundaries */

const internals = moduleExports.__internals;
const Bound = internals.withBoundary('probe', () => null);
check('a surface boundary is a React class', typeof Bound === 'function' && Bound.prototype.isReactComponent !== undefined);

const bound = new Bound({});
bound.state = { error: new Error('expected failure') };
const fallback = texts(render(bound.render()));
check('a crashed surface shows words, not a blank card', fallback.some((text) => text.indexOf('渲染失败') >= 0), JSON.stringify(fallback));
check('the boundary derived its error state', typeof Bound.getDerivedStateFromError === 'function');

check(
  'a slot with no entries reports zero, not a lie',
  internals.slotSnapshot({ slots: { entries: () => [] } }).indexOf('main=0') >= 0,
  internals.slotSnapshot({ slots: { entries: () => [] } }),
);

/* --------------------------------------------------------------- helpers */

check('byte formatting is human readable', internals.formatBytes(0) === '0 B' && internals.formatBytes(2048) === '2.0 KB', internals.formatBytes(2048));
check('placeholders are filled', internals.format('a {b}', { b: 'c' }) === 'a c');
check('english locale is detected', internals.languageOf({ getLocale: () => 'en-US' }) === 'en');
const zh = internals.TEXT.zh;
check(
  'a move reads as a sentence with the name',
  internals.describeOperation(zh, { op: 'session.trash', sessionId: 'session-a', sessionTitle: '论文截图' }) === '移入垃圾桶「论文截图」',
  internals.describeOperation(zh, { op: 'session.trash', sessionId: 'session-a', sessionTitle: '论文截图' }),
);
check(
  'a nameless move falls back to the short id',
  internals.describeOperation(zh, { op: 'session.trash', sessionId: 'session-e4b8a47e-1612' }) === '移入垃圾桶「#e4b8a47e」',
  internals.describeOperation(zh, { op: 'session.trash', sessionId: 'session-e4b8a47e-1612' }),
);
check(
  'a workspace move reports the session count',
  internals.describeOperation(zh, { op: 'workspace.trash', workspaceTitle: '项目A', trashed: 3 }) === '删除工作区「项目A」（3 个会话）',
  internals.describeOperation(zh, { op: 'workspace.trash', workspaceTitle: '项目A', trashed: 3 }),
);
check(
  'a failure keeps the reason',
  internals.describeOperation(zh, { op: 'restore.failed', kind: 'session', sessionTitle: '论文截图', code: 'exists' }).indexOf('失败：exists') > 0,
  internals.describeOperation(zh, { op: 'restore.failed', kind: 'session', sessionTitle: '论文截图', code: 'exists' }),
);
const grouped = internals.groupTrashItems(
  [
    { trashId: 'a', workspaceId: 'ws-1', workspaceTitle: '项目A', workspacePath: 'C:\\work\\a', sizeBytes: 10 },
    { trashId: 'b', workspaceId: 'ws-1', workspaceTitle: '项目A', workspacePath: 'C:\\work\\a', sizeBytes: 5 },
    { trashId: 'c', workspaceId: null, workspaceTitle: null, workspacePath: '', sizeBytes: 7 },
    { trashId: 'd', workspaceId: 'ws-2', workspaceTitle: '', workspacePath: 'C:\\work\\beta', sizeBytes: 1 },
  ],
  internals.TEXT.zh,
);
check(
  'the trash is grouped by workspace, like the sidebar',
  grouped.length === 3 && grouped[0].title === '项目A' && grouped[0].count === 2,
  JSON.stringify(grouped.map((group) => [group.title, group.count])),
);
check(
  'a group adds up what it holds',
  grouped[0].bytes === 15,
  String(grouped[0].bytes),
);
check(
  'a workspace with no recorded title falls back to its folder',
  grouped.some((group) => group.title === 'beta'),
  JSON.stringify(grouped.map((group) => group.title)),
);
check(
  'sessions in no workspace come last and say so',
  grouped[grouped.length - 1].title === '未分组',
  JSON.stringify(grouped.map((group) => group.title)),
);
check('the group carries the workspace folder for the tooltip', grouped[0].path === 'C:\\work\\a', grouped[0].path);
check(
  'the panel heads each group',
  filledTexts.some((entry) => entry.indexOf('Project') >= 0) && filledTexts.includes('本组全选'),
  JSON.stringify(filledTexts.slice(0, 20)),
);

/* Hook order is a runtime invariant React cannot forgive: a hook declared after
   an early return changes the hook count between renders (error #310). Check the
   bundle statically, for every component that uses hooks. */
const bundleSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
for (const componentName of ['TrashPanelPage', 'TrashSettingsPage', 'ConfirmDialog', 'SessionTrashItem', 'SessionTrashAction']) {
  const start = bundleSource.indexOf('function ' + componentName + '(');
  if (start < 0) {
    check(componentName + ' is in the bundle', false);
    continue;
  }
  const nextFunction = bundleSource.indexOf('\n    function ', start + 10);
  const body = bundleSource.slice(start, nextFunction < 0 ? undefined : nextFunction);
  const lastHook = body.lastIndexOf('React.use');
  const firstReturn = body.search(/\n {6}return\b/);
  check(
    componentName + ' declares its hooks before its first return',
    lastHook < 0 || firstReturn < 0 || lastHook < firstReturn,
    'lastHook=' + String(lastHook) + ' firstReturn=' + String(firstReturn),
  );
}

check(
  'a busy record explains itself instead of showing a code',
  internals.reasonText(internals.TEXT.zh, 'busy').indexOf('占用') >= 0,
  internals.reasonText(internals.TEXT.zh, 'busy'),
);
check(
  'a running session says to finish the turn first',
  internals.reasonText(internals.TEXT.zh, 'live').indexOf('正在运行') >= 0,
  internals.reasonText(internals.TEXT.zh, 'live'),
);
check(
  'a missing record has its own sentence',
  internals.reasonText(internals.TEXT.zh, 'missing').indexOf('找不到') >= 0,
  internals.reasonText(internals.TEXT.zh, 'missing'),
);
check(
  'an unknown code still names itself',
  internals.reasonText(internals.TEXT.zh, 'weird').indexOf('weird') >= 0,
  internals.reasonText(internals.TEXT.zh, 'weird'),
);
const zhText = internals.TEXT.zh;
check(
  'a copy install is offered the update instead of a manual-only note',
  internals
    .updateStatusText(internals.TEXT.zh, {
      local: '2.10.1',
      remote: '2.11.0',
      newer: true,
      canUpdate: true,
      installKind: 'copy',
      phase: 'ready',
    })
    .indexOf('发现新版本 2.11.0') === 0,
  internals.updateStatusText(internals.TEXT.zh, {
    local: '2.10.1',
    remote: '2.11.0',
    newer: true,
    canUpdate: true,
    installKind: 'copy',
    phase: 'ready',
  }),
);
check(
  'the status line says when it last asked',
  internals
    .updateStatusText(internals.TEXT.zh, {
      local: '2.11.1',
      remote: '2.11.1',
      newer: false,
      checkedAt: Date.parse('2026-11-13T15:56:55.000Z'),
      phase: 'ready',
    })
    .indexOf('上次检查') > 0,
  internals.updateStatusText(internals.TEXT.zh, {
    local: '2.11.1',
    remote: '2.11.1',
    newer: false,
    checkedAt: Date.parse('2026-11-13T15:56:55.000Z'),
    phase: 'ready',
  }),
);
check(
  'an update that found nothing to do says so in words',
  internals.reasonText(internals.TEXT.zh, 'up-to-date') === internals.TEXT.zh.updateUpToDate,
  internals.reasonText(internals.TEXT.zh, 'up-to-date'),
);
check(
  'a failed install explains itself instead of printing a code',
  internals.reasonText(internals.TEXT.zh, 'verify-failed') === internals.TEXT.zh.updateFailed,
  internals.reasonText(internals.TEXT.zh, 'verify-failed'),
);
check(
  'the update block names the installed version',
  internals.updateStatusText(zhText, { local: '2.3.0', phase: 'idle' }) === '当前版本 2.3.0',
  internals.updateStatusText(zhText, { local: '2.3.0', phase: 'idle' }),
);
check(
  'a known newer version is offered',
  internals.updateStatusText(zhText, { local: '2.3.0', remote: '2.4.0', phase: 'ready' }).indexOf('最新版本 2.4.0') > 0,
  internals.updateStatusText(zhText, { local: '2.3.0', remote: '2.4.0', phase: 'ready' }),
);
check(
  'a finished update asks for a restart',
  internals.updateStatusText(zhText, { local: '2.3.0', phase: 'ready', result: { ok: true, from: '2.3.0', to: '2.4.0' } }).indexOf('重启') > 0,
  internals.updateStatusText(zhText, { local: '2.3.0', phase: 'ready', result: { ok: true, from: '2.3.0', to: '2.4.0' } }),
);
check(
  'a rollback says which version is running',
  internals.updateStatusText(zhText, { local: '2.4.0', phase: 'failed', result: { ok: false, code: 'rolled-back', from: '2.3.0', to: '2.4.0' } }).indexOf('2.3.0') > 0,
  internals.updateStatusText(zhText, { local: '2.4.0', phase: 'failed', result: { ok: false, code: 'rolled-back', from: '2.3.0', to: '2.4.0' } }),
);
check(
  'a dirty worktree explains itself',
  internals.updateStatusText(zhText, { local: '2.3.0', phase: 'failed', result: { ok: false, code: 'dirty' } }) === zhText.updateDirty,
  internals.updateStatusText(zhText, { local: '2.3.0', phase: 'failed', result: { ok: false, code: 'dirty' } }),
);
check(
  'a running update says so',
  internals.updateStatusText(zhText, { local: '2.3.0', phase: 'updating' }) === zhText.updateUpdating,
  internals.updateStatusText(zhText, { local: '2.3.0', phase: 'updating' }),
);
check(
  'a settings change mentions the migration count',
  internals.describeOperation(zh, { op: 'settings.set', effective: 'D:\\dsh-trash', migrated: 2 }) === '垃圾桶目录改为 D:\\dsh-trash（迁移 2 条）',
  internals.describeOperation(zh, { op: 'settings.set', effective: 'D:\\dsh-trash', migrated: 2 }),
);
check(
  'no raw timestamp leaks into the row text',
  internals.describeOperation(zh, { op: 'trash.empty', removed: 4 }).indexOf('T') < 0,
  internals.describeOperation(zh, { op: 'trash.empty', removed: 4 }),
);
check('a short time has no ISO noise', internals.formatShortTime('2026-11-11T15:29:53.673Z').length === 11, internals.formatShortTime('2026-11-11T15:29:53.673Z'));
const split = internals.splitLogEntries([
  { op: 'session.trash', sessionTitle: 'a' },
  { kind: 'request', op: 'request.state' },
  { kind: 'request', op: 'request.item.remove' },
  { op: 'trash.purge', removed: 1 },
]);
check(
  'request records stay out of the sentence list',
  split.rows.length === 2 && split.requestCount === 2,
  JSON.stringify({ rows: split.rows.length, requests: split.requestCount }),
);
check(
  'a log with only requests reads as empty',
  internals.splitLogEntries([{ kind: 'request' }]).rows.length === 0 && internals.splitLogEntries(null).rows.length === 0,
  JSON.stringify(internals.splitLogEntries([{ kind: 'request' }])),
);
check(
  'a restore with no recorded identity still reads as a sentence',
  internals.describeOperation(zh, { op: 'restore', kind: 'session' }) === '恢复一条记录',
  internals.describeOperation(zh, { op: 'restore', kind: 'session' }),
);
check(
  'a restore of a named session uses its name',
  internals.describeOperation(zh, { op: 'restore', kind: 'session', sessionTitle: '论文截图' }) === '恢复「论文截图」',
  internals.describeOperation(zh, { op: 'restore', kind: 'session', sessionTitle: '论文截图' }),
);

/* -------------------------------------------------------- dictionary audit */

const usedKeys = new Set([...source.matchAll(/copy\.([a-zA-Z]+)/g)].map((match) => match[1]));
const zhKeys = new Set(Object.keys(internals.TEXT.zh));
const enKeys = new Set(Object.keys(internals.TEXT.en));
const missingZh = [...usedKeys].filter((key) => !zhKeys.has(key));
const missingEn = [...usedKeys].filter((key) => !enKeys.has(key));
check('every copy key is defined in Chinese', missingZh.length === 0, missingZh.join(','));
check('every copy key is defined in English', missingEn.length === 0, missingEn.join(','));
const onlyZh = [...zhKeys].filter((key) => !enKeys.has(key));
const onlyEn = [...enKeys].filter((key) => !zhKeys.has(key));
check('both dictionaries carry the same keys', onlyZh.length === 0 && onlyEn.length === 0, `${onlyZh.join(',')} | ${onlyEn.join(',')}`);
check(
  'no button label leaks a template placeholder',
  ['logClear', 'logOpen', 'trashOpen', 'copyPath', 'emptyAll', 'moveWorkspace', 'refresh', 'restore', 'cancel', 'confirmAction'].every(
    (key) => !String(internals.TEXT.zh[key]).includes('{') && !String(internals.TEXT.en[key]).includes('{'),
  ),
  JSON.stringify({ zh: internals.TEXT.zh.logClear, en: internals.TEXT.en.logClear }),
);
check(
  'the entry template keeps its placeholder',
  internals.TEXT.zh.logClearEntry.includes('{count}') && internals.TEXT.en.logClearEntry.includes('{count}'),
  internals.TEXT.zh.logClearEntry,
);
check(
  'archiving a ghost row reads as a sentence',
  internals.describeOperation(internals.TEXT.zh, { op: 'session.retire', sessionTitle: '幽灵会话' }) === '从列表归档「幽灵会话」（数据已不在磁盘）',
  internals.describeOperation(internals.TEXT.zh, { op: 'session.retire', sessionTitle: '幽灵会话' }),
);
check(
  'a ghost row with no name falls back to its short id',
  internals.describeOperation(internals.TEXT.zh, { op: 'session.retire', sessionId: 'session-3e541024' }).indexOf('#3e541024') > 0,
  internals.describeOperation(internals.TEXT.zh, { op: 'session.retire', sessionId: 'session-3e541024' }),
);
check(
  'clearing the log reads as a sentence',
  internals.describeOperation(internals.TEXT.zh, { op: 'log.clear', removed: 5 }) === '清除操作日志（5 条）',
  internals.describeOperation(internals.TEXT.zh, { op: 'log.clear', removed: 5 }),
);

/* ------------------------------------------------ every surface mounts bare */

let mounted = 0;
for (const entry of entries) {
  const surface = entry.options.name;
  const props = { sessionId: 'session-a', displayTitle: 'x', useMenuOpenState: () => [false, () => {}] };
  try {
    renderWith(entry.Component, []);
    void props;
    mounted += 1;
  } catch (error) {
    check(`the ${surface} surface mounts without services`, false, String(error && error.message ? error.message : error));
  }
}
check('every registered surface mounts without services', mounted === entries.length, `${mounted}/${entries.length}`);

console.log(`\n${checks} checks, ${process.exitCode === 1 ? 'FAILURES' : 'all passed'}`);
