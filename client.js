/**
 * dsh-session-delete — client half (browser bundle).
 *
 * Shape: a Module-Loader CJS factory (`window.__ModuleLoader__.load`), the same
 * lane every shipped client plugin uses. The loader calls `factory(require)`
 * once, lazily, the first time the plugin is needed; `require` resolves the
 * frozen platform table (`react`) plus the baseline externals
 * (`@deepseek-ai/dsh-client-ui-primitives`).
 *
 * Rules this file follows, because breaking them breaks the GUI:
 *
 *   1. `inject` names only services that are certainly provided (`slots`). A
 *      declared service nobody provides keeps this entry PENDING and the web
 *      boot audit reports "did not activate".
 *   2. Every registration is wrapped: a missing slot means a missing menu item,
 *      never a broken sidebar.
 *   3. UI is React inside slots — no DOM hunting, no class-name anchors, no
 *      monkey-patching of another plugin's dictionary.
 *
 * Surfaces:
 *   sidebar.workspaces.session.menu.item  "Move to trash…" on a session row
 *   sidebar.panellist + main              the trash panel (restore / empty / workspace moves)
 *   settings.section + .icon              trash folder, size, operation log
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-delete',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');
    var primitives = null;
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    } catch (error) {
      /* the pill falls back to a plain button; nothing else depends on it */
      primitives = null;
    }

    var PACKAGE_ID = 'dsh-session-delete';
    var API_VERSION = 3;
    var PANEL_ID = 'dsh-session-delete';

    var ROUTES = {
      state: '/dsh-session-delete/state',
      sessionMove: '/dsh-session-delete/session/move',
      workspaceMove: '/dsh-session-delete/workspace/move',
      restore: '/dsh-session-delete/item/restore',
      empty: '/dsh-session-delete/empty',
      removeItems: '/dsh-session-delete/item/remove',
      updateCheck: '/dsh-session-delete/update/check',
      updateApply: '/dsh-session-delete/update/apply',
      sessionRetire: '/dsh-session-delete/session/retire',
      scan: '/dsh-session-delete/scan',
      scanTrash: '/dsh-session-delete/scan/trash',
      pickDir: '/dsh-session-delete/pick-dir',
      settingsSet: '/dsh-session-delete/settings/set',
      logRead: '/dsh-session-delete/log/read',
      logClear: '/dsh-session-delete/log/clear',
      reveal: '/dsh-session-delete/reveal',
      report: '/dsh-session-delete/client/report',
    };

    var SLOT_SESSION_MENU = 'sidebar.workspaces.session.menu.item';
    var SLOT_SESSION_ACTION = 'sidebar.workspaces.session.row.action';
    var SLOT_PANEL_LIST = 'sidebar.panellist';
    var SLOT_MAIN = 'main';
    var SLOT_OVERLAY = 'shell.overlay';
    var SLOT_SETTINGS_SECTION = 'settings.section';
    var SLOT_SETTINGS_ICON = 'settings.section.icon';

    /* ------------------------------------------------------------------ */
    /* text                                                                */
    /* ------------------------------------------------------------------ */

    var TEXT = {
      zh: {
        panel: '垃圾桶',
        panelTitle: '垃圾桶',
        panelHint: '移入垃圾桶的记录可以恢复；只有「清空垃圾桶」才会真正删除。',
        empty: '垃圾桶是空的。',
        refresh: '刷新',
        restore: '恢复',
        restoring: '正在恢复…',
        emptyAll: '清空垃圾桶',
        emptyCancel: '取消',
        size: '占用',
        items: '条记录',
        purgeOne: '永久删除',
        purgeSelected: '删除所选',
        scanTitle: '扫描会话目录',
        scanHint: '会话被删掉后，目录有时会留在磁盘上——这里把它们找出来，可以整条移进垃圾桶（可恢复），也可以只打开看看',
        scanRun: '开始扫描',
        scanRunning: '扫描中…',
        scanNone: '没有发现孤立的会话目录',
        scanSummary: '磁盘上有 {dirs} 个会话目录，其中 {orphans} 个已不在列表中',
        scanTrash: '移入垃圾桶',
        scanTrashSelected: '移入所选（{count}）',
        scanOpen: '打开目录',
        scanTrashed: '已移入垃圾桶 {count} 个，可在下面的列表里恢复',
        scanTrashedNone: '没有移入任何目录',
        scanUntitled: '（没有名字的会话）',
        restoreSelected: '恢复所选',
        selectAll: '全选',
        restoredPartly: '已恢复 {done} 条，{failed} 条没能恢复（可能已不在垃圾桶）',
        restoringSelected: '恢复中…',
        selectedCount: '已选 {count} 条',
        clearSelection: '取消选择',
        selectItem: '选择这条记录',
        purgeHint: '勾选后可只删除其中几条；「清空垃圾桶」才会一次删光。',
        confirmPurgeTitle: '永久删除这条记录',
        confirmPurgeDesc: '永久删除「{name}」？此操作不可恢复。',
        confirmPurgeManyTitle: '永久删除选中的记录',
        confirmPurgeManyDesc: '永久删除选中的 {count} 条记录？此操作不可恢复。',
        logPurgeOne: '永久删除「{name}」',
        logPurge: '永久删除 {count} 条记录',
        trashDir: '垃圾桶目录',
        workspaces: '工作区',
        moveWorkspace: '删除工作区…',
        moveWorkspaceHint: '该工作区的全部会话一起移入垃圾桶，可恢复。',
        rowAction: '移至垃圾桶',
        confirmTitle: '请确认',
        confirmSessionTitle: '移至垃圾桶',
        confirmSessionDesc: '将「{title}」移入垃圾桶？会话记录会完整保留，可随时从垃圾桶恢复。',
        confirmWorkspaceTitle: '删除工作区',
        confirmWorkspaceDesc: '将「{title}」及其 {count} 个会话一起移入垃圾桶？整个工作区可以整体恢复。',
        confirmEmptyTitle: '清空垃圾桶',
        confirmEmptyDesc: '永久删除垃圾桶里的 {count} 条记录？此操作不可撤销。',
        confirmAction: '确认',
        cancel: '取消',
        pending: '正在处理…',
        moving: '正在移动…',
        sessionCount: '个会话',
        noWorkspaces: '没有可操作的工作区。',
        sessionMenu: '移至垃圾桶…',
        failed: '操作失败：{code}',
        failLive: '这个会话正在运行，先结束它的回合再试',
        failBusy: '这条记录正被占用（可能还有一个回合在写），稍后再试',
        failMissing: '找不到这条记录了（可能已被移动或删除）',
        failAmbiguous: '同一个会话对应到多个目录，已拒绝操作',
        failExists: '目标位置已存在同名记录，未覆盖',
        failUnknownItem: '垃圾桶里没有这条记录',
        failBadArgs: '请求参数不完整',
        failUnsafe: '记录里的路径不合规，已拒绝操作',
        failNoReason: '操作没有成功，宿主也没有给出原因（详情见操作日志）',
        retireAction: '从列表中移除',
        retireHint: '这个会话的日志目录已经不在磁盘上（可能被手动删掉或被别的工具清理），没有可移动的数据。可以把这条记录归档掉，之后仍能在 DSH 的已归档里找回。',
        retireDone: '已从列表中移除',
        ghostsHint: '有 {count} 个会话还列在侧栏，但它的日志文件已经不在磁盘上（点开会报 ENOENT）',
        ghostsAction: '归档这些空行',
        confirmGhostsTitle: '归档这些空行',
        confirmGhostsDesc: '把 {count} 个没有数据的行为归档并从侧栏收走：不做任何文件操作，之后可在 DSH 的已归档里找回。',
        ungrouped: '未分组',
        selectGroup: '本组全选',
        collapseGroup: '收起',
        expandGroup: '展开',
        groupMeta: '{count} 条 · {size}',
        logRetire: '从列表归档「{name}」（数据已不在磁盘）',
        unavailable: '当前进程缺少服务：{missing}',
        settingsTitle: '垃圾桶',
        settingsHint: '会话进入垃圾桶后仍占用磁盘；清空才会释放。',
        settingsDir: '垃圾桶目录',
        settingsDirHint: '必须是绝对路径；留空表示使用默认目录。',
        settingsInUse: '当前生效',
        settingsDefaultLabel: '默认目录',
        settingsUnknown: '（未知）',
        settingsSave: '保存',
        settingsUnsaved: '有未保存的改动',
        settingsPick: '浏览…',
        settingsPicking: '选择中…',
        settingsPickHint: '在系统的文件夹对话框里选；也可以直接在这个框里输入或粘贴路径。',
        settingsPickCancelled: '没有选择文件夹',
        settingsPickUnsupported: '这个环境打不开文件夹对话框，请手动输入路径',
        settingsSaving: '正在保存…',
        settingsSaved: '已保存',
        settingsMigrate: '修改目录时把现有条目一起迁移',
        settingsDefault: '默认目录：{dir}',
        settingsEffective: '当前目录：{dir}',
        logShow: '查看操作日志',
        logHide: '收起日志',
        logEmpty: '还没有操作记录。',
        logClear: '清除日志',
        logOpen: '打开日志文件',
        trashOpen: '打开垃圾桶目录',
        openFailed: '无法打开：{code}',
        logCleared: '日志已清除',
        logSessionTrash: '移入垃圾桶「{name}」',
        logWorkspaceTrash: '删除工作区「{name}」（{count} 个会话）',
        logRestoreSession: '恢复「{name}」',
        logRestoreWorkspace: '恢复工作区「{name}」',
        logRestoreGeneric: '恢复一条记录',
        logEmpty: '清空垃圾桶（{count} 条记录）',
        logSettings: '垃圾桶目录改为 {dir}',
        logSettingsMigrated: '垃圾桶目录改为 {dir}（迁移 {count} 条）',
        logClearEntry: '清除操作日志（{count} 条）',
        logFailed: '{text}，失败：{code}',
        logOther: '其他操作',
        logDetailHint: '完整记录（含 id、目录、条数、用户与耗时）见日志文件',
        logRequestRows: '另有 {count} 条请求明细（路由、耗时、报错堆栈）只在日志文件里',
        updateTitle: '更新',
        updateCurrent: '当前版本 {version}',
        updateLatest: '最新版本 {version}',
        updateCheck: '检查更新',
        updateApply: '立即更新',
        updateChecking: '检查中…',
        updateUpdating: '更新中…',
        updateUpToDate: '已是最新版本',
        updateFailed: '更新失败，已保留原版本',
        updateCheckedAt: '上次检查 {time}',
        updateAvailable: '发现新版本 {version}',
        updateReady: '已更新到 {version}，完全重启 DSH 后生效',
        updateRestartHint: '更新只替换磁盘上的文件；当前进程仍用旧代码，完全重启后生效。',
        updateTimeout: '检查超时：可能连不上 GitHub，请按下面的方式手动更新',
        updateNotGitHint: '这个安装不是 git 检出，只能手动更新',
        updateNoGitBinary: '没有找到 git 命令，将改用 HTTPS 下载更新',
        updateNoGitBinaryHint: '想要走 git 更新，可以把 git 加到 PATH（或用 DSH_SESSION_DELETE_GIT 指定路径）后重启 DSH',
        updateManualTitle: '手动更新',
        updateManualHint: '在终端执行 dsh plugin --profile <profile> add {url}，然后完全重启 DSH（桌面端 profile 一般填 desktop）。',
        updateRepo: '仓库：{url}',
        updateEngines: '新版本要求的 DSH 版本范围是 {range}，升级前请确认 DSH 版本。',
        updateNotGit: '这个安装目录不是 git 检出，无法自动更新',
        updateOffline: '连不上 GitHub：检查网络，或用本地代理时先设置 HTTPS_PROXY 环境变量',
        failOffline: '连不上 GitHub，检查一下网络再试',
        updateDirty: '本地有未提交的改动，先提交或还原再更新',
        updateRolledBack: '新版本没通过校验，已回滚到 {version}',
        updateEnginesChanged: '新版本适配的 DSH 范围变了（{local} → {remote}），请按 README 换装对应分支',
        updateAutoCheck: '自动检查更新',
        updateAutoPull: '自动拉取更新',
        updateAutoPullHint: '开启后后台拉取并校验，校验不通过自动回滚；仍需重启生效。',
        confirmUpdateTitle: '更新插件',
        confirmUpdateDesc: '将拉取最新提交并替换磁盘上的文件，校验不通过会自动回滚。重启 DSH 后生效。',
        copyPath: '复制路径',
        copied: '已复制',
        loading: '正在加载…',
        opTrash: '移入垃圾桶',
        opRestore: '恢复',
        opEmpty: '清空垃圾桶',
        opSettings: '修改设置',
        opLogClear: '清除日志',
        opFailed: '失败',
      },
      en: {
        panel: 'Trash',
        panelTitle: 'Trash',
        panelHint: 'Trashed records can be restored; only "Empty trash" really deletes them.',
        empty: 'The trash is empty.',
        refresh: 'Refresh',
        restore: 'Restore',
        restoring: 'Restoring…',
        emptyAll: 'Empty trash',
        emptyCancel: 'Cancel',
        size: 'Size',
        items: 'items',
        purgeOne: 'Delete permanently',
        purgeSelected: 'Delete selected',
        scanTitle: 'Scan session folders',
        scanHint: 'Deleting a session can leave its folder behind. This finds them: move a whole folder to the trash (restorable), or just open it',
        scanRun: 'Scan',
        scanRunning: 'Scanning…',
        scanNone: 'No orphaned session folders found',
        scanSummary: '{dirs} session folders on disk, {orphans} of them no longer listed',
        scanTrash: 'Move to trash',
        scanTrashSelected: 'Move selected ({count})',
        scanOpen: 'Open folder',
        scanTrashed: 'Moved {count} to the trash — restorable from the list below',
        scanTrashedNone: 'Nothing was moved',
        scanUntitled: '(session without a name)',
        restoreSelected: 'Restore selected',
        selectAll: 'Select all',
        restoredPartly: 'Restored {done}; {failed} could not be restored (they may be gone already)',
        restoringSelected: 'Restoring…',
        selectedCount: '{count} selected',
        clearSelection: 'Clear selection',
        selectItem: 'Select this record',
        purgeHint: 'Tick rows to delete only those; Empty trash is the delete-everything path.',
        confirmPurgeTitle: 'Delete this record permanently',
        confirmPurgeDesc: 'Permanently delete {name}? This cannot be undone.',
        confirmPurgeManyTitle: 'Delete the selected records permanently',
        confirmPurgeManyDesc: 'Permanently delete the {count} selected records? This cannot be undone.',
        logPurgeOne: 'Deleted {name} permanently',
        logPurge: 'Deleted {count} records permanently',
        trashDir: 'Trash folder',
        workspaces: 'Workspaces',
        moveWorkspace: 'Delete workspace…',
        moveWorkspaceHint: 'Every session of that workspace moves to the trash together; it is restorable.',
        rowAction: 'Move to trash',
        confirmTitle: 'Please confirm',
        confirmSessionTitle: 'Move to Trash',
        confirmSessionDesc: 'Move "{title}" to the trash? The session is kept intact and can be restored from the trash at any time.',
        confirmWorkspaceTitle: 'Delete workspace',
        confirmWorkspaceDesc: 'Move "{title}" and its {count} sessions to the trash? The whole workspace can be restored at once.',
        confirmEmptyTitle: 'Empty trash',
        confirmEmptyDesc: 'Permanently delete the {count} records in the trash? This cannot be undone.',
        confirmAction: 'Confirm',
        cancel: 'Cancel',
        pending: 'Working…',
        moving: 'Moving…',
        sessionCount: 'sessions',
        noWorkspaces: 'No workspace to act on.',
        sessionMenu: 'Move to Trash…',
        failed: 'Failed: {code}',
        failLive: 'That session is running — finish its turn first',
        failBusy: 'That record is in use (a turn may still be writing) — try again later',
        failMissing: 'That record is gone (moved or deleted already)',
        failAmbiguous: 'That session matches more than one folder — refused',
        failExists: 'Something already exists at the target — not overwritten',
        failUnknownItem: 'No such record in the trash',
        failBadArgs: 'The request was incomplete',
        failUnsafe: 'The manifest points outside the trash — refused',
        failNoReason: 'The action did not succeed and the host gave no reason (see the operation log)',
        retireAction: 'Remove from the list',
        retireHint: 'This session has no log directory on disk any more (deleted by hand or cleaned by another tool), so there is nothing to move. The row can be archived away and found again in the DSH archive.',
        retireDone: 'Removed from the list',
        ghostsHint: '{count} sessions are still listed but their log file is gone (opening one fails with ENOENT)',
        ghostsAction: 'Archive these empty rows',
        confirmGhostsTitle: 'Archive the empty rows',
        confirmGhostsDesc: 'Archives {count} rows that have no data and takes them out of the sidebar: no file is touched, and they stay recoverable from the DSH archive.',
        ungrouped: 'Ungrouped',
        selectGroup: 'Select group',
        collapseGroup: 'Collapse',
        expandGroup: 'Expand',
        groupMeta: '{count} · {size}',
        logRetire: 'Archived {name} (its data is already gone)',
        unavailable: 'This process is missing a service: {missing}',
        settingsTitle: 'Trash',
        settingsHint: 'Trashed sessions still use disk space; emptying the trash frees it.',
        settingsDir: 'Trash folder',
        settingsDirHint: 'Absolute path; leave empty to use the default folder.',
        settingsInUse: 'In use',
        settingsDefaultLabel: 'Default',
        settingsUnknown: '(unknown)',
        settingsSave: 'Save',
        settingsUnsaved: 'Unsaved changes',
        settingsPick: 'Browse…',
        settingsPicking: 'Choosing…',
        settingsPickHint: 'Pick it in the system folder dialog, or type or paste the path in this field.',
        settingsPickCancelled: 'No folder chosen',
        settingsPickUnsupported: 'This environment cannot open a folder dialog — type the path instead',
        settingsSaving: 'Saving…',
        settingsSaved: 'Saved',
        settingsMigrate: 'Move existing items when the folder changes',
        settingsDefault: 'Default: {dir}',
        settingsEffective: 'In use: {dir}',
        logShow: 'Show operation log',
        logHide: 'Hide operation log',
        logEmpty: 'No operations recorded yet.',
        logClear: 'Clear log',
        logOpen: 'Open log file',
        trashOpen: 'Open trash folder',
        openFailed: 'Could not open: {code}',
        logCleared: 'Log cleared',
        logSessionTrash: 'Moved "{name}" to the trash',
        logWorkspaceTrash: 'Deleted workspace "{name}" ({count} sessions)',
        logRestoreSession: 'Restored "{name}"',
        logRestoreWorkspace: 'Restored workspace "{name}"',
        logRestoreGeneric: 'Restored a record',
        logEmpty: 'Emptied the trash ({count} records)',
        logSettings: 'Trash folder set to {dir}',
        logSettingsMigrated: 'Trash folder set to {dir} ({count} moved)',
        logClearEntry: 'Cleared the operation log ({count} entries)',
        logFailed: '{text} — failed: {code}',
        logOther: 'Other operation',
        logDetailHint: 'The log file holds the full record (ids, folders, counts, actor, timings)',
        logRequestRows: '{count} request records (route, timing, stack) live in the log file only',
        updateTitle: 'Updates',
        updateCurrent: 'Installed {version}',
        updateLatest: 'Published {version}',
        updateCheck: 'Check for updates',
        updateApply: 'Update now',
        updateChecking: 'Checking…',
        updateUpdating: 'Updating…',
        updateUpToDate: 'Already up to date',
        updateFailed: 'The update failed; the installed version was kept',
        updateCheckedAt: 'Last checked {time}',
        updateAvailable: 'Version {version} is available',
        updateReady: 'Updated to {version} — fully restart DSH to apply it',
        updateRestartHint: 'The update only replaces files on disk; this process runs the old code until a full restart.',
        updateTimeout: 'The check timed out — GitHub may be unreachable; update by hand below',
        updateNotGitHint: 'This install is not a git checkout, so updating is manual',
        updateNoGitBinary: 'No git command found — the update will download the release over HTTPS instead',
        updateNoGitBinaryHint: 'To update through git, put it on PATH (or point DSH_SESSION_DELETE_GIT at it) and restart DSH',
        updateManualTitle: 'Manual update',
        updateManualHint: 'Run dsh plugin --profile <profile> add {url} in a terminal, then fully restart DSH (<profile> is usually desktop).',
        updateRepo: 'Repository: {url}',
        updateEngines: 'The new version requires DSH {range} — check your DSH version before upgrading.',
        updateNotGit: 'This install is not a git checkout, so it cannot update itself',
        updateOffline: 'Cannot reach GitHub — check the connection, or set HTTPS_PROXY if you use a local proxy',
        failOffline: 'Cannot reach GitHub — check the connection and try again',
        updateDirty: 'The working tree has uncommitted changes — commit or revert them first',
        updateRolledBack: 'The new version failed verification and was rolled back to {version}',
        updateEnginesChanged: 'The update targets a different DSH range ({local} → {remote}) — install the matching branch instead',
        updateAutoCheck: 'Check for updates automatically',
        updateAutoPull: 'Pull updates automatically',
        updateAutoPullHint: 'Pulls and verifies in the background, rolls back on failure; a restart is still required.',
        confirmUpdateTitle: 'Update the plugin',
        confirmUpdateDesc: 'Pulls the latest commits and replaces the files on disk; a failed verification rolls back. A restart applies it.',
        copyPath: 'Copy path',
        copied: 'Copied',
        loading: 'Loading…',
        opTrash: 'Moved to trash',
        opRestore: 'Restored',
        opEmpty: 'Emptied trash',
        opSettings: 'Settings changed',
        opLogClear: 'Log cleared',
        opFailed: 'failed',
      },
    };

    /**
     * Fill `{name}` placeholders.
     * @param {string} template
     * @param {Record<string, unknown>} [values]
     * @returns {string}
     */
    function format(template, values) {
      if (values === undefined) return template;
      return String(template).replace(/\{([a-zA-Z]+)\}/g, function (whole, key) {
        return values[key] === undefined ? whole : String(values[key]);
      });
    }

    /**
     * Language for this render pass: the DSH locale service when it is there,
     * the browser language otherwise.
     * @param {any} locale
     * @returns {'zh' | 'en'}
     */
    function languageOf(locale) {
      try {
        if (locale !== null && locale !== undefined) {
          var value = typeof locale.getLocale === 'function' ? locale.getLocale() : undefined;
          var id = typeof value === 'string' ? value : value !== null && value !== undefined && typeof value.id === 'string' ? value.id : '';
          if (id !== '') return id.toLowerCase().indexOf('en') === 0 ? 'en' : 'zh';
        }
      } catch (error) {
        /* fall through to the browser language */
      }
      try {
        var nav = typeof navigator === 'undefined' ? '' : String(navigator.language || '');
        return nav.toLowerCase().indexOf('en') === 0 ? 'en' : 'zh';
      } catch (error) {
        return 'zh';
      }
    }

    /* ------------------------------------------------------------------ */
    /* styles                                                              */
    /* ------------------------------------------------------------------ */

    var CSS = [
      /* Page frame: the settings page is a column of cards, the panel is not. */
      '.dsd-root{display:flex;flex-direction:column;gap:18px;padding:18px 20px;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-primary);overflow:auto;height:100%;box-sizing:border-box}',
      '.dsd-set{max-width:760px}',
      '.dsd-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.dsd-head-text{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.dsd-title{margin:0;font-size:16px;font-weight:600;line-height:1.3}',
      '.dsd-sub{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsd-muted{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsd-spacer{flex:1}',
      '.dsd-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dsd-grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      /* One card per concern. */
      '.dsd-section{display:flex;flex-direction:column;gap:12px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}',
      '.dsd-section-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dsd-section-title{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);letter-spacing:0}',
      '.dsd-error{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary)}',
      '.dsd-empty{padding:18px 0;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      /* Buttons: the shell's outline language. One base, three intents. */
      '.dsd-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 12px;font:inherit;font-size:12px;line-height:1;cursor:pointer;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1);white-space:nowrap;transition:background-color .14s ease,color .14s ease}',
      '.dsd-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.dsd-btn:disabled{opacity:.55;cursor:not-allowed;background:transparent}',
      '.dsd-btn:focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);outline-offset:1px}',
      '.dsd-btn.dsd-primary{color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary) 42%,transparent)}',
      '.dsd-btn.dsd-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}',
      '.dsd-btn.dsd-danger{color:var(--dsw-alias-state-error-primary);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-error-primary) 42%,transparent)}',
      '.dsd-btn.dsd-danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}',
      '.dsd-btn.dsd-danger-solid{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-inverted);box-shadow:none}',
      '.dsd-btn.dsd-danger-solid:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 88%,black)}',
      /* One field, its browse button attached to the right edge. */
      '.dsd-field{display:flex;align-items:stretch;max-width:100%}',
      '.dsd-input{box-sizing:border-box;font:inherit;font-size:12px;height:28px;padding:0 8px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;min-width:0}',
      '.dsd-input::placeholder{color:var(--dsw-alias-label-secondary)}',
      '.dsd-input:focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);outline-offset:-1px}',
      '.dsd-field-input{flex:1;border-radius:8px 0 0 8px;border-right:0}',
      '.dsd-field-button{height:28px;border-radius:0 8px 8px 0}',
      '.dsd-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.dsd-check-box{flex:none;width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
      '.dsd-check input{accent-color:var(--dsw-alias-brand-primary);margin:0}',
      /* Key/value rows, like the settings page of the desktop-control plugin. */
      '.dsd-rows{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;margin:0;font-size:12px}',
      '.dsd-rows dt{color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dsd-rows dd{margin:0;min-width:0;overflow-wrap:anywhere}',
      /* The trash list: workspace groups, then rows. */
      '.dsd-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}',
      '.dsd-group{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}',
      '.dsd-group-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:2px 0 6px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dsd-group-title{font-weight:600;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer;border:0;background:none;padding:0;font-family:inherit;text-align:left}',
      '.dsd-group-title:hover{color:var(--dsw-alias-brand-primary)}',
      '.dsd-group-items{margin-left:6px;padding-left:12px;border-left:1px solid var(--dsw-alias-border-l1)}',
      '.dsd-item{display:flex;align-items:center;gap:12px;padding:8px 10px;border:1px solid transparent;border-radius:10px}',
      '.dsd-item:hover{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}',
      '.dsd-item-main{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}',
      '.dsd-item-title{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsd-item-path{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dsd-item-meta{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dsd-panel-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px}',
      '.dsd-icon-btn{width:26px;height:26px;border:none;border-radius:8px;background:0 0;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0}',
      '.dsd-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      /* The operation log reads like text, not like a terminal. */
      '.dsd-log{max-height:220px;overflow:auto;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);display:flex;flex-direction:column;gap:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}',
      '.dsd-log-row{display:flex;gap:10px;align-items:baseline}',
      '.dsd-log-time{flex:none;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:11px}',
      '.dsd-modal{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;gap:12px;align-items:stretch;justify-content:center;box-sizing:border-box;padding:24px;margin:auto;max-width:420px;height:fit-content;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55}',
      '.dsd-modal-actions{justify-content:flex-end;padding-top:4px}',
    ].join('\n');

    function installStyles() {
      try {
        var id = PACKAGE_ID + '-styles';
        if (document.querySelector('style[data-plugin-css="' + id + '"]') !== null) return;
        var tag = document.createElement('style');
        tag.dataset.plugin = PACKAGE_ID;
        tag.dataset.pluginCss = id;
        tag.textContent = CSS;
        document.head.appendChild(tag);
      } catch (error) {
        /* an unstyled panel still works */
      }
    }

    /* ------------------------------------------------------------------ */
    /* host API                                                            */
    /* ------------------------------------------------------------------ */

    /**
     * POST one JSON body to a host route and normalize the answer.
     * @param {string} path
     * @param {object} [body]
     * @returns {Promise<{ ok: boolean, code?: string, missing?: string[], [key: string]: any }>}
     */
    function callHost(path, body) {
      return fetch(path, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body === undefined ? {} : body),
      })
        .then(function (response) {
          return response.json().then(
            function (payload) {
              if (payload !== null && typeof payload === 'object') return payload;
              return { ok: false, code: 'bad-response' };
            },
            function () {
              return { ok: false, code: 'bad-response' };
            },
          );
        })
        .catch(function (error) {
          return { ok: false, code: 'unreachable', detail: String(error && error.message ? error.message : error) };
        });
    }

    /**
     * Ask the host to show one of the plugin's own files or folders.
     * The browser half has no window to open; the host does it.
     *
     * @param {'log'|'config'|'trash'} target
     * @returns {Promise<{ ok: boolean, opened?: boolean, code?: string }>}
     */
    function revealTarget(target) {
      return callHost(ROUTES.reveal, { target: target });
    }

    /**
     * Human text for one host answer.
     * @param {any} copy
     * @param {{ ok: boolean, code?: string, missing?: string[] }} result
     * @returns {string}
     */
    function describeFailure(copy, result) {
      if (result !== null && Array.isArray(result.missing) && result.missing.length > 0) {
        return format(copy.unavailable, { missing: result.missing.join(', ') });
      }
      return reasonText(copy, result === null || result === undefined ? undefined : result.code);
    }

    /**
     * The host answers with a code; a person reads a sentence.
     * @param {any} copy
     * @param {unknown} code
     * @returns {string}
     */
    function reasonText(copy, code) {
      if (code === undefined || code === null || code === '') return copy.failNoReason;
      var key = String(code);
      var known = {
        live: copy.failLive,
        busy: copy.failBusy,
        missing: copy.failMissing,
        ambiguous: copy.failAmbiguous,
        exists: copy.failExists,
        'unknown-item': copy.failUnknownItem,
        'bad-args': copy.failBadArgs,
        'unsafe-path': copy.failUnsafe,
        'no-git-binary': copy.updateNoGitBinary,
        'up-to-date': copy.updateUpToDate,
        'verify-failed': copy.updateFailed,
        'install-failed': copy.updateFailed,
        'archive-invalid': copy.updateFailed,
        'archive-empty': copy.updateFailed,
        'rolled-back': copy.updateFailed,
        'pull-failed': copy.updateFailed,
        'engines-changed': copy.updateEngines,
        offline: copy.failOffline,
        'bad-path': copy.failUnsafe,
      };
      return known[key] !== undefined ? known[key] : format(copy.failed, { code: key });
    }

    /**
     * Load the panel state once and keep the loading/error phases around.
     * @returns {{ state: any, phase: string, error: string, reload: () => void }}
     */
    function usePanelState() {
      var store = React.useState({ phase: 'loading', state: null, error: '' });
      var view = store[0];
      var setView = store[1];
      var load = React.useCallback(function () {
        setView(function (previous) {
          return { phase: previous.state === null ? 'loading' : 'ready', state: previous.state, error: '' };
        });
        callHost(ROUTES.state).then(function (result) {
          if (result.ok === true) setView({ phase: 'ready', state: result, error: '' });
          else setView({ phase: 'error', state: null, error: String(result.code || 'unknown') });
        });
      }, []);
      React.useEffect(function () {
        load();
      }, [load]);
      return { state: view.state, phase: view.phase, error: view.error, reload: load };
    }

    /**
     * @param {number} bytes
     * @returns {string}
     */
    function formatBytes(bytes) {
      var value = Number(bytes);
      if (!isFinite(value) || value <= 0) return '0 B';
      var units = ['B', 'KB', 'MB', 'GB', 'TB'];
      var index = 0;
      while (value >= 1024 && index < units.length - 1) {
        value = value / 1024;
        index += 1;
      }
      return (index === 0 ? String(Math.round(value)) : value.toFixed(1)) + ' ' + units[index];
    }

    /**
     * What the update block says on one line: installed, published, phase.
     * @param {any} copy
     * @param {any} update
     * @returns {string}
     */
    function updateStatusText(copy, update) {
      if (update === null || update === undefined) return copy.loading;
      if (update.phase === 'checking') return copy.updateChecking;
      if (update.phase === 'updating') return copy.updateUpdating;
      if (update.error === 'timeout') return copy.updateTimeout;
      var result = update.result;
      if (update.phase === 'failed' && update.result !== null && update.result !== undefined) {
        if (update.result.code === 'offline') return copy.updateOffline;
        if (update.result.code === 'timeout') return copy.updateTimeout;
      }
      if (update.newer === true) {
        var offer = format(copy.updateAvailable, { version: String(update.remote) });
        if (update.updateBlocked === 'dirty') offer += ' · ' + copy.updateDirty;
        /* A checkout whose git cannot be reached still updates — over HTTPS —
           so this is a note about the transport, not a refusal. */
        if (update.installKind === 'git' && update.gitAvailable === false) offer += ' · ' + copy.updateNoGitBinary;
        return offer;
      }
      if (result !== null && result !== undefined && typeof result === 'object') {
        if (result.code === 'rolled-back') return format(copy.updateRolledBack, { version: String(result.from || update.local) });
        if (result.ok === true && result.to !== undefined && result.from !== undefined && result.to !== result.from) {
          return format(copy.updateReady, { version: String(result.to) });
        }
        if (result.code === 'dirty') return copy.updateDirty;
        if (result.code === 'not-git') return copy.updateNotGit;
        if (result.code === 'offline') return copy.updateOffline;
        if (result.code === 'engines-changed') {
          return format(copy.updateEnginesChanged, { local: String(result.localEngines || '?'), remote: String(result.remoteEngines || '?') });
        }
      }
      var text = format(copy.updateCurrent, { version: String(update.local || '?') });
      if (typeof update.checkedAt === 'number' && update.checkedAt > 0) {
        text += ' · ' + format(copy.updateCheckedAt, { time: formatShortTime(new Date(update.checkedAt).toISOString()) });
      }
      if (update.remote !== undefined) text += ' · ' + format(copy.updateLatest, { version: String(update.remote) });
      if (update.phase === 'failed' && typeof update.error === 'string' && update.error !== '') {
        text += ' · ' + update.error;
      }
      return text;
    }

    /**
     * The folder a trashed record came from, as the host reported it.
     * @param {any} item
     * @returns {string}
     */
    function itemPath(item) {
      if (item === null || item === undefined) return '';
      if (typeof item.cwd === 'string' && item.cwd !== '') return item.cwd;
      if (typeof item.path === 'string' && item.path !== '') return item.path;
      return '';
    }

    /**
     * A session id shortened to something a person can compare at a glance.
     * @param {unknown} sessionId
     * @returns {string}
     */
    function shortSessionId(sessionId) {
      var text = String(sessionId === null || sessionId === undefined ? '' : sessionId);
      if (text === '') return '';
      var bare = text.indexOf('session-') === 0 ? text.slice(8) : text;
      return '#' + bare.slice(0, 8);
    }

    /**
     * A compact local timestamp for a log row: month/day, hour:minute.
     * @param {unknown} iso
     * @returns {string}
     */
    function formatShortTime(iso) {
      try {
        var date = new Date(String(iso));
        if (isNaN(date.getTime())) return String(iso === null || iso === undefined ? '' : iso);
        var pad = function (value) {
          return value < 10 ? '0' + value : String(value);
        };
        return pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
      } catch (error) {
        return '';
      }
    }

    /**
     * @param {string} iso
     * @returns {string}
     */
    function formatTime(iso) {
      try {
        var date = new Date(iso);
        if (isNaN(date.getTime())) return String(iso);
        return date.toLocaleString();
      } catch (error) {
        return String(iso);
      }
    }

    /* ------------------------------------------------------------------ */
    /* small components                                                    */
    /* ------------------------------------------------------------------ */

    function iconButton(props) {
      return React.createElement(
        'button',
        {
          type: 'button',
          className: 'dsd-icon-btn',
          title: props.title,
          'aria-label': props.title,
          onClick: props.onClick,
        },
        props.children,
      );
    }

    /**
     * The shipped trash icon, so the plugin matches the desktop chrome instead
     * of shipping a second visual language. Falls back to a local glyph when the
     * primitives module is not reachable.
     * @returns {any}
     */
    function trashIcon() {
      try {
        var Icon = primitives !== null && primitives !== undefined ? primitives.IconTrashOutlineRegular : undefined;
        if (typeof Icon === 'function' || (Icon !== null && typeof Icon === 'object')) return React.createElement(Icon, {});
      } catch (error) {
        /* fall through to the local glyph */
      }
      return React.createElement(TrashGlyph, null);
    }

    /** The trash glyph, in the shipped icon language (16px, currentColor). */
    function TrashGlyph() {
      return React.createElement(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        React.createElement('path', {
          d: 'M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        React.createElement('path', { d: 'M7 7v3.5M9 7v3.5', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
      );
    }

    /* ------------------------------------------------------------------ */
    /* confirmation                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Every destructive action asks first, in one dialog.
     *
     * A request is module state because only one dialog can be open at a time
     * and both the row action and the panel act on the same request; subscribers
     * are notified instead of polled, so the dialog and the panel stay in step.
     */
    var confirmRequest = null;
    var confirmListeners = [];
    /** The panel registers its own reloader here. */
    var panelRefresh = null;

    function emitConfirm() {
      var listeners = confirmListeners.slice();
      for (var index = 0; index < listeners.length; index += 1) {
        try {
          listeners[index](confirmRequest);
        } catch (error) {
          /* one broken subscriber must not keep the others from updating */
        }
      }
    }

    /** Run the panel's reloader after a mutation, when the panel is mounted. */
    function afterMutation() {
      if (typeof panelRefresh !== 'function') return;
      try {
        panelRefresh();
      } catch (error) {
        /* a stale panel is not worth failing the action over */
      }
    }

    /**
     * @param {{ kind: string, sessionId?: string, workspaceId?: string, title?: string, count?: number }} request
     */
    function requestConfirm(request) {
      confirmRequest = request;
      emitConfirm();
    }

    function settleConfirm() {
      confirmRequest = null;
      emitConfirm();
    }

    /**
     * The open request, re-rendered on every change.
     * @returns {any}
     */
    function useConfirmRequest() {
      var pair = React.useState(confirmRequest);
      var setCurrent = pair[1];
      React.useEffect(function () {
        var listener = function (next) {
          setCurrent(next);
        };
        confirmListeners.push(listener);
        return function () {
          var at = confirmListeners.indexOf(listener);
          if (at >= 0) confirmListeners.splice(at, 1);
        };
      }, []);
      return pair[0];
    }

    /**
     * The shipped Button, or a plain one in a harness that does not ship it.
     *
     * A destructive action is drawn by the plugin itself: the shipped Button
     * only offers `outline` and `primary`, and "delete this" has to *look* like
     * a delete — solid red, matching the danger buttons the panel already uses.
     * The same markup is used for the cancel button next to it so the two keep
     * one size and shape inside the dialog.
     *
     * @param {{ disabled?: boolean, onClick?: Function, danger?: boolean, own?: boolean, children?: any }} props
     * @returns {any}
     */
    function actionButton(props) {
      var Button = primitives !== null && primitives !== undefined ? primitives.Button : undefined;
      var shipped = typeof Button === 'function' || (Button !== null && typeof Button === 'object');
      if (shipped && props.danger !== true && props.own !== true) {
        return React.createElement(Button, { variant: 'outline', disabled: props.disabled, onClick: props.onClick }, props.children);
      }
      return React.createElement(
        'button',
        {
          type: 'button',
          className: 'dsd-btn' + (props.danger === true ? ' dsd-danger-solid' : ''),
          disabled: props.disabled,
          onClick: props.onClick,
        },
        props.children,
      );
    }

    /**
     * The shipped Modal when it exists, otherwise a plain dialog box — the
     * confirmation must never be the thing that silently goes missing.
     */
    function dialogElement(props) {
      var Modal = primitives !== null && primitives !== undefined ? primitives.Modal : undefined;
      var footer = React.createElement(React.Fragment, null, props.cancel, props.confirm);
      if (typeof Modal === 'function' || (Modal !== null && typeof Modal === 'object')) {
        return React.createElement(
          Modal,
          {
            open: true,
            onClose: props.onClose,
            closeLabel: props.closeLabel,
            title: props.title,
            description: props.description,
            footer: footer,
          },
          props.children,
        );
      }
      return React.createElement(
        'div',
        { className: 'dsd-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': props.title },
        React.createElement('h2', { className: 'dsd-title' }, props.title),
        props.description === undefined ? null : React.createElement('div', { className: 'dsd-muted' }, props.description),
        props.children,
        React.createElement('div', { className: 'dsd-row dsd-modal-actions' }, props.cancel, props.confirm),
      );
    }

    /**
     * The one dialog behind every destructive action in this plugin.
     */
    function ConfirmDialog() {
      var copy = useCopy();
      var request = useConfirmRequest();
      var busyPair = React.useState(false);
      var busy = busyPair[0];
      var setBusy = busyPair[1];
      var errorPair = React.useState(null);
      var error = errorPair[0];
      var setError = errorPair[1];
      /* A move that finds no directory is not a dead end: the row can be
         archived away instead. */
      var retirePair = React.useState(false);
      var retire = retirePair[0];
      var setRetire = retirePair[1];

      /* Escape closes the dialog unless a request is in flight: the shipped Modal
         does this for its own chrome, and the fallback one must not be worse. */
      React.useEffect(function () {
        if (typeof document === 'undefined' || document === null || typeof document.addEventListener !== 'function') {
          return undefined;
        }
        var onKey = function (event) {
          if (event === null || event === undefined) return;
          if (event.key !== 'Escape') return;
          if (busy === true) return;
          settleConfirm();
        };
        document.addEventListener('keydown', onKey);
        return function () {
          if (typeof document.removeEventListener === 'function') document.removeEventListener('keydown', onKey);
        };
      }, [busy]);

      if (request === null || request === undefined) return null;

      var title = copy.confirmTitle;
      var description = '';
      var action = null;
      if (request.kind === 'workspace') {
        title = copy.confirmWorkspaceTitle;
        description = format(copy.confirmWorkspaceDesc, {
          title: request.title === undefined || request.title === '' ? String(request.workspaceId) : request.title,
          count: String(request.count === undefined ? 0 : request.count),
        });
        action = { path: ROUTES.workspaceMove, body: { workspaceId: request.workspaceId, title: request.title } };
      } else if (request.kind === 'purge') {
        var purgeIds = Array.isArray(request.trashIds) ? request.trashIds : [];
        var many = purgeIds.length > 1;
        title = many ? copy.confirmPurgeManyTitle : copy.confirmPurgeTitle;
        description = many
          ? format(copy.confirmPurgeManyDesc, { count: String(purgeIds.length) })
          : format(copy.confirmPurgeDesc, { name: String(request.title || '') });
        action = { path: ROUTES.removeItems, body: { trashIds: purgeIds } };
      } else if (request.kind === 'ghosts') {
        title = copy.confirmGhostsTitle;
        description = format(copy.confirmGhostsDesc, { count: String(request.count ?? 0) });
        action = { path: ROUTES.sessionRetire, body: { sessionIds: request.sessionIds } };
      } else if (request.kind === 'update') {
        title = copy.confirmUpdateTitle;
        description = copy.confirmUpdateDesc;
        action = { path: ROUTES.updateApply, body: { confirm: true } };
      } else if (request.kind === 'empty') {
        title = copy.confirmEmptyTitle;
        description = format(copy.confirmEmptyDesc, { count: String(request.count === undefined ? 0 : request.count) });
        action = { path: ROUTES.empty, body: { confirm: true } };
      } else {
        title = copy.confirmSessionTitle;
        description = format(copy.confirmSessionDesc, {
          title: request.title === undefined || request.title === '' ? String(request.sessionId) : request.title,
        });
        action = { path: ROUTES.sessionMove, body: { sessionId: request.sessionId, title: request.title } };
      }

      var close = function () {
        if (busy) return;
        settleConfirm();
      };

      var confirm = function () {
        if (busy) return;
        setBusy(true);
        setError(null);
        callHost(action.path, action.body).then(function (result) {
          setBusy(false);
          if (result.ok !== true) {
            if (request.kind === 'session' && result.code === 'missing') setRetire(true);
            setError(describeFailure(copy, result));
            return;
          }
          settleConfirm();
          afterMutation();
          if (request.kind === 'session') refreshSessionList(clientContext, request.sessionId);
        });
      };

      return dialogElement({
        title: title,
        description: description,
        closeLabel: copy.cancel,
        onClose: close,
        cancel: actionButton({ own: true, disabled: busy, onClick: close, children: copy.cancel }),
        confirm: actionButton({ disabled: busy, onClick: confirm, danger: true, children: busy ? copy.pending : copy.confirmAction }),
        children:
          error === null && retire !== true
            ? null
            : React.createElement(
                'div',
                null,
                error === null ? null : React.createElement('div', { className: 'dsd-error' }, error),
                retire === true
                  ? React.createElement(
                      'div',
                      { className: 'dsd-section' },
                      React.createElement('div', { className: 'dsd-muted' }, copy.retireHint),
                      React.createElement(
                        'button',
                        {
                          type: 'button',
                          className: 'dsd-btn dsd-danger',
                          disabled: busy,
                          onClick: function () {
                            if (busy) return;
                            setBusy(true);
                            callHost(ROUTES.sessionRetire, {
                              sessionId: request.sessionId,
                              title: request.title,
                            }).then(function (outcome) {
                              setBusy(false);
                              if (outcome.ok !== true) {
                                setError(describeFailure(copy, outcome));
                                return;
                              }
                              settleConfirm();
                              afterMutation();
                            });
                          },
                        },
                        copy.retireAction,
                      ),
                    )
                  : null,
              ),
      });
    }

    /* ------------------------------------------------------------------ */
    /* the trash panel                                                     */
    /* ------------------------------------------------------------------ */

    /**
     * The panel page: what is in the trash, and which workspaces can be moved
     * wholesale. Registered into the `main` keyed slot; the sidebar panellist
     * entry with the same id selects it.
     */
    function TrashPanelPage() {
      var copy = useCopy();
      var panel = usePanelState();
      var busyPair = React.useState('');
      var busy = busyPair[0];
      var setBusy = busyPair[1];
      var noticePair = React.useState(null);
      var notice = noticePair[0];
      var setNotice = noticePair[1];
      var selectedPair = React.useState({});
      var selected = selectedPair[0];
      var setSelected = selectedPair[1];
      /* Which workspace groups are folded shut. Declared here, with every
         other hook: the panel returns early while loading, and a hook below
         that return would change the hook order between renders (#310). */
      var collapsedPair = React.useState({});
      var collapsed = collapsedPair[0];
      var setCollapsed = collapsedPair[1];
      /* The scan lives here too: same reason as `collapsed` — this component
         returns early while the panel loads, so a hook declared below that return
         would reorder the hook list between renders (#310). */
      var scanPair = React.useState(null);
      var scan = scanPair[0];
      var setScan = scanPair[1];
      var scanSelPair = React.useState({});
      var scanSel = scanSelPair[0];
      var setScanSel = scanSelPair[1];

      var run = function (label, work) {
        setBusy(label);
        setNotice(null);
        return work().then(function (result) {
          setBusy('');
          if (result.ok !== true) setNotice({ ok: false, text: describeFailure(copy, result) });
          panel.reload();
          return result;
        });
      };

      /** Orphans the scan found: a folder on disk the app no longer lists. */
      var runScan = function () {
        setScan({ phase: 'running' });
        return callHost(ROUTES.scan, {}).then(function (result) {
          if (result.ok === true) {
            setScan({ phase: 'ready', items: Array.isArray(result.items) ? result.items : [], scanned: result.scanned, listed: result.listed });
            setScanSel({});
          } else {
            setScan({ phase: 'error', code: result.code });
          }
          return result;
        });
      };

      var scannedIds = function () {
        var found = scan !== null && scan.phase === 'ready' && Array.isArray(scan.items) ? scan.items : [];
        var ids = [];
        for (var index = 0; index < found.length; index += 1) {
          if (scanSel[found[index].sessionId] === true) ids.push(found[index].sessionId);
        }
        return ids;
      };

      var moveScanned = function (ids) {
        if (ids.length === 0) return;
        run('scan-trash', function () {
          return callHost(ROUTES.scanTrash, { sessionIds: ids });
        }).then(function (result) {
          if (result.ok === true) {
            setNotice({
              ok: true,
              text: format(copy.scanTrashed, { count: String(result.trashed === undefined ? ids.length : result.trashed) }),
            });
            runScan();
          }
        });
      };

      var openScanned = function (sessionId) {
        callHost(ROUTES.reveal, { target: 'orphan', sessionId: sessionId }).then(function (result) {
          if (result.ok !== true) setNotice({ ok: false, text: describeFailure(copy, result) });
        });
      };

      /** One row per orphaned directory. */
      var renderScanRow = function (entry) {
        var ticked = scanSel[entry.sessionId] === true;
        return React.createElement(
          'li',
          { className: 'dsd-item', key: entry.sessionId },
          React.createElement(
            'label',
            { className: 'dsd-check' },
            React.createElement('input', {
              type: 'checkbox',
              checked: ticked,
              'aria-label': entry.title || entry.sessionId,
              onChange: function () {
                var next = {};
                for (var key in scanSel) if (scanSel[key] === true) next[key] = true;
                if (ticked) delete next[entry.sessionId];
                else next[entry.sessionId] = true;
                setScanSel(next);
              },
            }),
          ),
          React.createElement(
            'div',
            { className: 'dsd-item-main' },
            React.createElement('div', { className: 'dsd-item-title' }, entry.title || copy.scanUntitled),
            React.createElement('div', { className: 'dsd-item-path', title: entry.dir }, String(entry.dir || '')),
            React.createElement(
              'div',
              { className: 'dsd-item-meta' },
              React.createElement('span', null, formatBytes(entry.sizeBytes || 0)),
              React.createElement('span', null, formatShortTime(String(entry.modifiedAt || ''))),
              React.createElement('span', null, String(entry.group || '')),
            ),
          ),
          React.createElement(
            'button',
            { type: 'button', className: 'dsd-btn', onClick: function () { openScanned(entry.sessionId); } },
            copy.scanOpen,
          ),
          React.createElement(
            'button',
            { type: 'button', className: 'dsd-btn dsd-danger', disabled: busy !== '', onClick: function () { moveScanned([entry.sessionId]); } },
            copy.scanTrash,
          ),
        );
      };

      var renderScanCard = function () {
        var ready = scan !== null && scan.phase === 'ready';
        var rows = ready ? scan.items : [];
        var selectedNow = scannedIds();
        return React.createElement(
          'div',
          { className: 'dsd-group' },
          React.createElement(
            'div',
            { className: 'dsd-group-head' },
            React.createElement('span', { className: 'dsd-group-title' }, copy.scanTitle),
            React.createElement(
              'span',
              { className: 'dsd-muted' },
              ready
                ? format(copy.scanSummary, { dirs: String(scan.scanned || 0), orphans: String(rows.length) })
                : scan !== null && scan.phase === 'error'
                  ? format(copy.failed, { code: String(scan.code || '') })
                  : copy.scanHint,
            ),
            React.createElement('span', { className: 'dsd-spacer' }),
            selectedNow.length === 0
              ? null
              : React.createElement(
                  'button',
                  { type: 'button', className: 'dsd-btn dsd-danger', disabled: busy !== '', onClick: function () { moveScanned(selectedNow); } },
                  format(copy.scanTrashSelected, { count: String(selectedNow.length) }),
                ),
            React.createElement(
              'button',
              { type: 'button', className: 'dsd-btn', disabled: busy !== '', onClick: runScan },
              busy === 'scan-trash' || (scan !== null && scan.phase === 'running') ? copy.scanRunning : copy.scanRun,
            ),
          ),
          ready === false
            ? null
            : rows.length === 0
              ? React.createElement('div', { className: 'dsd-muted' }, copy.scanNone)
              : React.createElement('ul', { className: 'dsd-list' }, rows.map(renderScanRow)),
        );
      };

      React.useEffect(function () {
        panelRefresh = panel.reload;
        return function () {
          if (panelRefresh === panel.reload) panelRefresh = null;
        };
      }, [panel.reload]);

      var state = panel.state;
      if (panel.phase === 'loading') {
        /* The chrome renders before the host answers, so a click always shows
           something even when the request is slow. */
        return React.createElement(
          'div',
          { className: 'dsd-root' },
          React.createElement('h2', { className: 'dsd-title' }, copy.panelTitle),
          React.createElement('div', { className: 'dsd-muted' }, copy.loading),
        );
      }
      if (panel.phase === 'error') {
        return React.createElement(
          'div',
          { className: 'dsd-root' },
          React.createElement('h2', { className: 'dsd-title' }, copy.panelTitle),
          React.createElement('div', { className: 'dsd-error' }, format(copy.failed, { code: panel.error })),
          React.createElement('button', { type: 'button', className: 'dsd-btn', onClick: panel.reload }, copy.refresh),
        );
      }

      var items = Array.isArray(state.items) ? state.items : [];
      var workspaces = Array.isArray(state.workspaces) ? state.workspaces : [];
      var stats = state.stats !== null && typeof state.stats === 'object' ? state.stats : { items: 0, bytes: 0 };
      var ghosts = Array.isArray(state.ghosts) ? state.ghosts : [];

      /* The sidebar groups sessions under their workspace, and so does this:
         the same records under the same names, so a person can see at a glance
         which workspace a trashed session belongs to. */
      var groups = groupTrashItems(items, copy);

      var toggleGroupCollapsed = function (key) {
        var next = Object.assign({}, collapsed);
        if (next[key] === true) delete next[key];
        else next[key] = true;
        setCollapsed(next);
      };

      var toggleGroupSelected = function (group) {
        var all = group.items.every(function (item) {
          return selected[item.trashId] === true;
        });
        var next = Object.assign({}, selected);
        group.items.forEach(function (item) {
          if (all) delete next[item.trashId];
          else next[item.trashId] = true;
        });
        setSelected(next);
      };
      /* Which rows the user ticked: a trash that restores one row and destroys
         another cannot only offer "delete everything". */
      var selectedIds = Object.keys(selected).filter(function (id) {
        return (
          selected[id] === true &&
          items.some(function (item) {
            return item.trashId === id;
          })
        );
      });

      return React.createElement(
        'div',
        { className: 'dsd-root' },
        React.createElement(
          'div',
          { className: 'dsd-head' },
          React.createElement(
            'div',
            { className: 'dsd-head-text' },
            React.createElement('h2', { className: 'dsd-title' }, copy.panelTitle),
            React.createElement('div', { className: 'dsd-sub' }, stats.items + ' ' + copy.items + ' · ' + formatBytes(stats.bytes)),
          ),
          React.createElement('span', { className: 'dsd-spacer' }),
          iconButton({ title: copy.refresh, onClick: panel.reload, children: React.createElement(RefreshGlyph, null) }),
          items.length > 0
            ? React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dsd-btn dsd-danger',
                  disabled: busy !== '',
                  title: copy.confirmEmptyDesc.split('{count}').join(String(items.length)),
                  onClick: function () {
                    requestConfirm({ kind: 'empty', count: items.length });
                  },
                },
                copy.emptyAll,
              )
            : null,
        ),
        React.createElement('div', { className: 'dsd-muted' }, copy.panelHint),
        React.createElement(
          'div',
          { className: 'dsd-row' },
          React.createElement('div', { className: 'dsd-muted dsd-grow' }, copy.trashDir + ': ' + String(state.trashDir || '')),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsd-btn',
              onClick: function () {
                revealTarget('trash').then(function (result) {
                  if (result.ok !== true) setNotice({ ok: false, text: describeFailure(copy, result) });
                });
              },
            },
            copy.trashOpen,
          ),
        ),
        notice === null ? null : React.createElement('div', { className: notice.ok ? 'dsd-muted' : 'dsd-error' }, notice.text),
        renderScanCard(),
        items.length === 0
          ? null
          : React.createElement(
              'div',
              { className: 'dsd-row' },
              React.createElement('div', { className: 'dsd-muted dsd-grow' }, copy.purgeHint),
              React.createElement(
                'span',
                { className: 'dsd-muted' },
                format(copy.selectedCount, { count: String(selectedIds.length) }),
              ),
              selectedIds.length === 0
                ? null
                : React.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'dsd-btn dsd-primary',
                      disabled: busy !== '',
                      onClick: function () {
                        run('restore-selected', function () {
                          return callHost(ROUTES.restore, { trashIds: selectedIds.slice() });
                        }).then(function (result) {
                          /* Whatever came back, the rows that did return are gone
                             from the list; the selection starts over. */
                          setSelected({});
                          if (result.ok === true && Array.isArray(result.failed) && result.failed.length > 0) {
                            setNotice({
                              ok: false,
                              text: format(copy.restoredPartly, {
                                done: String(result.restored ?? 0),
                                failed: String(result.failed.length),
                              }),
                            });
                          }
                        });
                      },
                    },
                    busy === 'restore-selected' ? copy.restoringSelected : copy.restoreSelected,
                  ),
              selectedIds.length === 0
                ? null
                : React.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'dsd-btn dsd-danger',
                      disabled: busy !== '',
                      onClick: function () {
                        var names = items
                          .filter(function (item) {
                            return selectedIds.indexOf(item.trashId) >= 0;
                          })
                          .map(function (item) {
                            return String(item.title || '');
                          });
                        requestConfirm({
                          kind: 'purge',
                          trashIds: selectedIds.slice(),
                          title: names.length === 1 ? names[0] : '',
                        });
                      },
                    },
                    copy.purgeSelected,
                  ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dsd-btn',
                  onClick: function () {
                    if (selectedIds.length === items.length) {
                      setSelected({});
                      return;
                    }
                    var next = {};
                    items.forEach(function (item) {
                      next[item.trashId] = true;
                    });
                    setSelected(next);
                  },
                },
                selectedIds.length === items.length ? copy.clearSelection : copy.selectAll,
              ),
            ),
        ghosts.length === 0
          ? null
          : React.createElement(
              'div',
              { className: 'dsd-section' },
              React.createElement('div', { className: 'dsd-muted' }, format(copy.ghostsHint, { count: String(ghosts.length) })),
              React.createElement(
                'div',
                { className: 'dsd-muted' },
                ghosts.map(function (ghost) {
                  return shortSessionId(ghost.sessionId);
                }).join(' · '),
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dsd-btn dsd-danger',
                  disabled: busy !== '',
                  onClick: function () {
                    requestConfirm({
                      kind: 'ghosts',
                      sessionIds: ghosts.map(function (ghost) {
                        return String(ghost.sessionId);
                      }),
                      count: ghosts.length,
                    });
                  },
                },
                copy.ghostsAction,
              ),
            ),
        items.length === 0
          ? React.createElement('div', { className: 'dsd-empty' }, copy.empty)
          : groups.map(function (group) {
              var allSelected = group.items.every(function (item) {
                return selected[item.trashId] === true;
              });
              var isCollapsed = collapsed[group.key] === true;
              return React.createElement(
                'div',
                { key: group.key, className: 'dsd-group' },
                React.createElement(
                  'div',
                  { className: 'dsd-group-head' },
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'dsd-group-title',
                      title: group.path,
                      onClick: function () {
                        toggleGroupCollapsed(group.key);
                      },
                    },
                    (isCollapsed ? '▸ ' : '▾ ') + group.title,
                  ),
                  React.createElement('span', { className: 'dsd-muted' }, format(copy.groupMeta, { count: String(group.count), size: formatBytes(group.bytes) })),
                  React.createElement(
                    'label',
                    { className: 'dsd-check' },
                    React.createElement('input', {
                      type: 'checkbox',
                      checked: allSelected,
                      onChange: function () {
                        toggleGroupSelected(group);
                      },
                    }),
                    copy.selectGroup,
                  ),
                  React.createElement('span', { className: 'dsd-spacer' }),
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'dsd-btn',
                      onClick: function () {
                        toggleGroupCollapsed(group.key);
                      },
                    },
                    isCollapsed ? copy.expandGroup : copy.collapseGroup,
                  ),
                ),
                isCollapsed
                  ? null
                  : React.createElement(
                      'ul',
                      { className: 'dsd-list dsd-group-items' },
                      group.items.map(function (item) {
                        return React.createElement(
                          'li',
                          { key: item.trashId, className: 'dsd-item' },
                          React.createElement('input', {
                            type: 'checkbox',
                            className: 'dsd-check-box',
                            'aria-label': copy.selectItem,
                            checked: selected[item.trashId] === true,
                            onChange: function (event) {
                              var next = Object.assign({}, selected);
                              if (event.target.checked) next[item.trashId] = true;
                              else delete next[item.trashId];
                              setSelected(next);
                            },
                          }),
                          React.createElement(
                            'div',
                            { className: 'dsd-item-main' },
                            React.createElement(
                              'div',
                              {
                                className: 'dsd-item-title',
                                title: [String(item.title || ''), itemPath(item), String(item.sessionId || item.workspaceId || '')]
                                  .filter(function (part) {
                                    return part !== '';
                                  })
                                  .join('\n'),
                              },
                              String(item.title || item.sessionId || item.workspaceId || item.trashId),
                            ),
                            itemPath(item) === ''
                              ? null
                              : React.createElement('div', { className: 'dsd-item-path', title: itemPath(item) }, itemPath(item)),
                            React.createElement(
                              'div',
                              { className: 'dsd-item-meta' },
                              React.createElement('span', null, formatTime(item.trashedAt)),
                              React.createElement('span', null, formatBytes(item.sizeBytes)),
                              item.kind === 'workspace'
                                ? React.createElement('span', null, item.sessionCount + ' ' + copy.sessionCount)
                                : [
                                    item.titleSource === 'folder'
                                      ? React.createElement('span', { key: 'id' }, shortSessionId(item.sessionId))
                                      : null,
                                  ],
                            ),
                          ),
                          React.createElement(
                            'button',
                            {
                              type: 'button',
                              className: 'dsd-btn',
                              disabled: busy !== '',
                              onClick: function () {
                                run('restore:' + item.trashId, function () {
                                  return callHost(ROUTES.restore, { trashId: item.trashId });
                                });
                              },
                            },
                            busy === 'restore:' + item.trashId ? copy.restoring : copy.restore,
                          ),
                          React.createElement(
                            'button',
                            {
                              type: 'button',
                              className: 'dsd-btn dsd-danger',
                              disabled: busy !== '',
                              onClick: function () {
                                requestConfirm({
                                  kind: 'purge',
                                  trashIds: [item.trashId],
                                  title: String(item.title || ''),
                                });
                              },
                            },
                            copy.purgeOne,
                          ),
                        );
                      }),
                    ),
              );
            }),
        React.createElement(
          'div',
          { className: 'dsd-section' },
          React.createElement('h3', { className: 'dsd-section-title' }, copy.workspaces),
          React.createElement('div', { className: 'dsd-muted' }, copy.moveWorkspaceHint),
          workspaces.length === 0
            ? React.createElement('div', { className: 'dsd-muted' }, copy.noWorkspaces)
            : React.createElement(
                'ul',
                { className: 'dsd-list' },
                workspaces.map(function (workspace) {
                  return React.createElement(
                    'li',
                    { key: workspace.id, className: 'dsd-item' },
                    React.createElement(
                      'div',
                      { className: 'dsd-item-main' },
                      React.createElement(
                        'div',
                        { className: 'dsd-item-title', title: String(workspace.path || '') },
                        String(workspace.title || workspace.path || workspace.id),
                      ),
                      React.createElement(
                        'div',
                        { className: 'dsd-item-meta' },
                        React.createElement('span', null, workspace.sessionCount + ' ' + copy.sessionCount),
                      ),
                    ),
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'dsd-btn dsd-danger',
                        disabled: busy !== '' || workspace.sessionCount === 0,
                        title: copy.moveWorkspaceHint,
                        onClick: function () {
                          requestConfirm({
                            kind: 'workspace',
                            workspaceId: workspace.id,
                            title: workspace.title,
                            count: workspace.sessionCount,
                          });
                        },
                      },
                      copy.moveWorkspace,
                    ),
                  );
                }),
              ),
        ),
      );
    }

    function RefreshGlyph() {
      return React.createElement(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        React.createElement('path', {
          d: 'M13 8a5 5 0 1 1-1.6-3.7M13 3.5V6h-2.5',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    /**
     * The sidebar panellist entry. The sidebar renders its own button around
     * this, so the entry is the glyph and nothing else.
     */
    function TrashPanelIcon() {
      return React.createElement('span', { className: 'dsd-panel-icon' }, trashIcon());
    }

    /* ------------------------------------------------------------------ */
    /* session row action                                                  */
    /* ------------------------------------------------------------------ */

    /**
     * "Move to Trash…" inside a session row's "…" menu.
     *
     * The slot projects `sessionId`, `displayTitle` and `useMenuOpenState`; the
     * entry closes the menu itself, which is what the slot contract asks for.
     */
    function SessionTrashItem(props) {
      var copy = useCopy();
      var openState = typeof props.useMenuOpenState === 'function' ? props.useMenuOpenState() : [];
      var setMenuOpen = typeof openState[1] === 'function' ? openState[1] : null;
      var Button = primitives !== null && typeof primitives.MenuItemButton === 'function' ? primitives.MenuItemButton : 'button';

      var onSelect = function () {
        if (setMenuOpen !== null) setMenuOpen(false);
        requestConfirm({ kind: 'session', sessionId: props.sessionId, title: props.displayTitle });
      };

      return React.createElement(
        Button,
        {
          separatorBefore: true,
          role: 'menuitem',
          onSelect: onSelect,
          onClick: Button === 'button' ? onSelect : undefined,
        },
        copy.sessionMenu,
      );
    }

    /**
     * The hover action on a session row: one click arms, the second moves.
     *
     * `sidebar.workspaces.session.row.action` renders an icon button in the
     * row's hover strip; the strip stops the click from opening the row, but the
     * handler stops it again so a stray propagation never selects the session.
     */
    function SessionTrashAction(props) {
      var copy = useCopy();
      var onClick = function (event) {
        try {
          if (event !== null && event !== undefined && typeof event.stopPropagation === 'function') event.stopPropagation();
        } catch (error) {
          /* the row still must not navigate */
        }
        requestConfirm({ kind: 'session', sessionId: props.sessionId, title: props.displayTitle });
      };
      return React.createElement(
        'button',
        {
          type: 'button',
          className: 'dsd-icon-btn',
          title: copy.rowAction,
          'aria-label': copy.rowAction,
          onClick: onClick,
        },
        trashIcon(),
      );
    }

    /**
     * Ask the GUI to re-project one session after its log directory moved.
     * `sessions` is optional: without it the row simply updates on the next
     * workspace broadcast.
     * @param {any} ctx
     * @param {string} sessionId
     */
    function refreshSessionList(ctx, sessionId) {
      try {
        var sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined;
        if (sessions !== null && sessions !== undefined && typeof sessions.refreshProjections === 'function') {
          Promise.resolve(sessions.refreshProjections(sessionId)).catch(function () {});
        }
      } catch (error) {
        /* a stale row is not worth breaking the action over */
      }
    }

    /* ------------------------------------------------------------------ */
    /* settings section                                                    */
    /* ------------------------------------------------------------------ */

    function TrashSettingsPage() {
      var copy = useCopy();
      var panel = usePanelState();
      var draftPair = React.useState(null);
      var draft = draftPair[0];
      var setDraft = draftPair[1];
      var migratePair = React.useState(true);
      var migrate = migratePair[0];
      var setMigrate = migratePair[1];
      var statusPair = React.useState(null);
      var status = statusPair[0];
      var setStatus = statusPair[1];
      var logPair = React.useState(null);
      var log = logPair[0];
      var setLog = logPair[1];
      var copiedPair = React.useState(false);
      var copied = copiedPair[0];
      var setCopied = copiedPair[1];
      /* The folder is chosen in the desktop dialog; typing is the fallback for an
         environment that has none (a headless host, a browser tab). */
      var pickingPair = React.useState(false);
      var picking = pickingPair[0];
      var setPicking = pickingPair[1];
      /* One field holds the folder: typed, pasted, or filled in by the dialog. */
      var chosen =
        draft !== null ? draft : state !== null && state !== undefined ? String(state.configuredTrashDir || '') : '';

      /** Open the desktop folder dialog and take what it returns. */
      var chooseFolder = function () {
        if (picking) return;
        setPicking(true);
        setStatus(null);
        callHost(ROUTES.pickDir, { start: chosen }).then(function (result) {
          setPicking(false);
          if (result.ok === true && typeof result.path === 'string') {
            setDraft(result.path);
            setStatus({ ok: true, text: result.path });
            return;
          }
          if (result.code === 'unsupported') {
            /* Nothing to switch to: the field is already editable. */
            setStatus({ ok: false, text: copy.settingsPickUnsupported });
            return;
          }
          if (result.code === 'cancelled') {
            setStatus({ ok: true, text: copy.settingsPickCancelled });
            return;
          }
          setStatus({ ok: false, text: describeFailure(copy, result) });
        });
      };

      var update =
        panel.state === null || panel.state === undefined || panel.state.update === undefined
          ? null
          : panel.state.update;

      /** Ask the host whether the repository publishes something newer. */
      var checkUpdates = function () {
        setStatus({ ok: true, text: copy.updateChecking });
        callHost(ROUTES.updateCheck, {}).then(function (result) {
          panel.reload();
          if (result.ok !== true) {
            setStatus({
              ok: false,
              text: result.code === 'not-git' ? copy.updateNotGit : describeFailure(copy, result),
            });
            return;
          }
          setStatus({
            ok: true,
            text: result.newer === true ? format(copy.updateAvailable, { version: String(result.remote) }) : copy.updateUpToDate,
          });
        });
      };

      /** Ask for confirmation, and let the dialog post the update. */
      var askUpdate = function () {
        requestConfirm({ kind: 'update' });
      };

      /** Persist one update toggle without touching the folder setting. */
      var saveUpdateToggle = function (key, value) {
        if (panel.state === null || panel.state === undefined) return;
        callHost(ROUTES.settingsSet, { [key]: value }).then(function (result) {
          if (result.ok !== true) setStatus({ ok: false, text: describeFailure(copy, result) });
          else setStatus(null);
          panel.reload();
        });
      };

      /** Hand the log file to the desktop file manager. */
      var logSplit = splitLogEntries(
        log === null || log === undefined || Array.isArray(log.entries) === false ? [] : log.entries,
      );
      var logRows = logSplit.rows;
      var requestRows = logSplit.requestCount;

      var openLogFile = function () {
        revealTarget('log').then(function (result) {
          if (result.ok !== true) setStatus({ ok: false, text: describeFailure(copy, result) });
        });
      };

      /** Put the log's location on the clipboard: that file is the detail view. */
      var copyLogPath = function () {
        try {
          var file = log !== null && log !== undefined && typeof log.file === 'string' ? log.file : '';
          if (file === '' || typeof navigator === 'undefined' || navigator.clipboard === undefined) return;
          Promise.resolve(navigator.clipboard.writeText(file)).then(
            function () {
              setCopied(true);
              setTimeout(function () {
                setCopied(false);
              }, 2000);
            },
            function () {
              /* a refusal to copy is not worth an error banner */
            },
          );
        } catch (error) {
          /* clipboard access is a convenience */
        }
      };

      var state = panel.state;
      var effective = state === null ? '' : String(state.trashDir || '');
      var configured = state === null ? '' : String(state.configuredTrashDir || '');
      var value = draft === null ? configured : draft;

      var save = function () {
        setStatus({ ok: true, text: copy.settingsSaving });
        callHost(ROUTES.settingsSet, { trashDir: value, migrate: migrate }).then(function (result) {
          if (result.ok === true) {
            setStatus({ ok: true, text: copy.settingsSaved });
            setDraft(null);
            panel.reload();
          } else {
            setStatus({ ok: false, text: describeFailure(copy, result) });
          }
        });
      };

      var loadLog = function () {
        setLog({ phase: 'loading', entries: [] });
        callHost(ROUTES.logRead, { limit: 100 }).then(function (result) {
          if (result.ok === true) setLog({ phase: 'ready', entries: Array.isArray(result.entries) ? result.entries : [] });
          else setLog({ phase: 'error', entries: [] });
        });
      };

      var clearLog = function () {
        callHost(ROUTES.logClear).then(function () {
          loadLog();
          setStatus({ ok: true, text: copy.logCleared });
        });
      };

      return React.createElement(
        'div',
        { className: 'dsd-root dsd-set' },
        React.createElement(
          'div',
          { className: 'dsd-head-text' },
          React.createElement('h2', { className: 'dsd-title' }, copy.settingsTitle),
          React.createElement('div', { className: 'dsd-sub' }, copy.settingsHint),
        ),
        React.createElement(
          'div',
          { className: 'dsd-section' },
          React.createElement('div', { className: 'dsd-section-title' }, copy.updateTitle),
          React.createElement(
            'div',
            { className: 'dsd-row' },
            React.createElement('div', { className: 'dsd-muted dsd-grow' }, updateStatusText(copy, update)),
            React.createElement(
              'button',
              { type: 'button', className: 'dsd-btn', disabled: update === null || update.phase === 'checking' || update.phase === 'updating', onClick: checkUpdates },
              copy.updateCheck,
            ),
            update !== null && update.canUpdate === true
              ? React.createElement(
                  'button',
                  { type: 'button', className: 'dsd-btn dsd-danger', disabled: update.phase === 'checking' || update.phase === 'updating', onClick: askUpdate },
                  copy.updateApply,
                )
              : null,
          ),
          React.createElement(
            'label',
            { className: 'dsd-check' },
            React.createElement('input', {
              type: 'checkbox',
              checked: update === null ? true : update.autoCheck === true,
              onChange: function (event) { saveUpdateToggle('autoUpdateCheck', event.target.checked); },
            }),
            copy.updateAutoCheck,
          ),
          React.createElement(
            'label',
            { className: 'dsd-check' },
            React.createElement('input', {
              type: 'checkbox',
              checked: update !== null && update.autoPull === true,
              onChange: function (event) { saveUpdateToggle('autoUpdatePull', event.target.checked); },
            }),
            copy.updateAutoPull,
          ),
          React.createElement('div', { className: 'dsd-muted' }, copy.updateAutoPullHint),
          React.createElement('div', { className: 'dsd-muted' }, copy.updateRestartHint),
          React.createElement(
            'div',
            { className: 'dsd-section' },
            React.createElement('h3', { className: 'dsd-section-title' }, copy.updateManualTitle),
            React.createElement(
              'div',
              { className: 'dsd-muted' },
              format(copy.updateRepo, {
                url: update === null || update === undefined || update.repoUrl === undefined ? '' : String(update.repoUrl),
              }),
            ),
            React.createElement(
              'div',
              { className: 'dsd-muted' },
              format(copy.updateManualHint, {
                url: update === null || update === undefined || update.repoUrl === undefined ? '' : String(update.repoUrl),
              }),
            ),
          ),
        ),
        React.createElement(
          'div',
          { className: 'dsd-section' },
          React.createElement('label', { className: 'dsd-section-title', htmlFor: 'dsd-trash-dir' }, copy.settingsDir),
          React.createElement(
            'div',
            { className: 'dsd-field' },
            React.createElement('input', {
              id: 'dsd-trash-dir',
              className: 'dsd-input dsd-field-input',
              type: 'text',
              spellCheck: false,
              autoComplete: 'off',
              placeholder: state === null ? '' : String(state.defaultTrashDir || ''),
              title: chosen,
              value: value,
              onChange: function (event) {
                setDraft(event.target.value);
              },
            }),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsd-btn dsd-field-button',
                disabled: picking,
                title: copy.settingsPickHint,
                onClick: chooseFolder,
              },
              picking ? copy.settingsPicking : copy.settingsPick,
            ),
          ),
          React.createElement(
            'div',
            { className: 'dsd-row' },
            React.createElement(
              'button',
              { type: 'button', className: 'dsd-btn dsd-primary', disabled: picking || draft === null, onClick: save },
              copy.settingsSave,
            ),
            draft === null ? null : React.createElement('span', { className: 'dsd-muted' }, copy.settingsUnsaved),
          ),
          React.createElement('div', { className: 'dsd-muted' }, copy.settingsDirHint),
          React.createElement(
            'label',
            { className: 'dsd-check' },
            React.createElement('input', {
              type: 'checkbox',
              checked: migrate,
              onChange: function (event) {
                setMigrate(event.target.checked);
              },
            }),
            copy.settingsMigrate,
          ),
          React.createElement(
            'dl',
            { className: 'dsd-rows' },
            React.createElement('dt', null, copy.settingsInUse),
            React.createElement('dd', null, effective === '' ? copy.settingsUnknown : effective),
            React.createElement('dt', null, copy.settingsDefaultLabel),
            React.createElement('dd', null, state === null ? copy.settingsUnknown : String(state.defaultTrashDir || '')),
          ),
          status === null ? null : React.createElement('div', { className: status.ok ? 'dsd-muted' : 'dsd-error' }, status.text),
        ),
        React.createElement(
          'div',
          { className: 'dsd-section' },
          React.createElement(
            'div',
            { className: 'dsd-row' },
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsd-btn',
                onClick: function () {
                  if (log === null) loadLog();
                  else setLog(null);
                },
              },
              log === null ? copy.logShow : copy.logHide,
            ),
            log === null
              ? null
              : React.createElement('button', { type: 'button', className: 'dsd-btn dsd-danger', onClick: clearLog }, copy.logClear),
            log === null ? null : React.createElement('button', { type: 'button', className: 'dsd-btn', onClick: openLogFile }, copy.logOpen),
            log === null ? null : React.createElement('button', { type: 'button', className: 'dsd-btn', onClick: copyLogPath }, copied ? copy.copied : copy.copyPath),
          ),
          log === null
            ? null
            : React.createElement(
                'div',
                { className: 'dsd-log' },
                log.phase === 'loading'
                  ? copy.loading
                  : logRows.length === 0
                    ? copy.logEmpty
                    : logRows.map(function (entry, index) {
                        var described = describeOperation(copy, entry);
                        return React.createElement(
                          'div',
                          { key: String(index), className: 'dsd-log-row', title: JSON.stringify(entry) },
                          React.createElement('span', { className: 'dsd-log-time' }, formatShortTime(entry.at)),
                          React.createElement('span', null, described),
                        );
                      }),
              ),
          requestRows === 0
            ? null
            : React.createElement('div', { className: 'dsd-muted' }, format(copy.logRequestRows, { count: String(requestRows) })),
          log === null || log.file === undefined
            ? null
            : React.createElement('div', { className: 'dsd-muted' }, copy.logDetailHint + '：' + String(log.file)),
        ),
      );
    }

    /**
     * Group trash items the way the sidebar groups sessions: one block per
     * workspace, in the workspace's own name, with the records that belong to it
     * underneath. Sessions that live in no workspace share the "ungrouped" block,
     * which is the same word the sidebar uses for them.
     *
     * @param {Array<any>} items
     * @param {any} copy
     * @returns {Array<{ key: string, title: string, path: string, items: Array<any>, count: number, bytes: number }>}
     */
    function groupTrashItems(items, copy) {
      var groups = [];
      var byKey = {};
      var list = Array.isArray(items) ? items : [];
      list.forEach(function (item) {
        var id = item.workspaceId === null || item.workspaceId === undefined ? '' : String(item.workspaceId);
        var key = id === '' ? '__ungrouped__' : 'ws:' + id;
        var group = byKey[key];
        if (group === undefined) {
          group = {
            key: key,
            title: id === '' ? copy.ungrouped : workspaceNameOf(item, copy),
            path: id === '' ? '' : String(item.workspacePath || ''),
            items: [],
            count: 0,
            bytes: 0,
          };
          byKey[key] = group;
          groups.push(group);
        }
        group.items.push(item);
        group.count += 1;
        group.bytes += typeof item.sizeBytes === 'number' ? item.sizeBytes : 0;
      });
      groups.sort(function (left, right) {
        if (left.key === '__ungrouped__') return 1;
        if (right.key === '__ungrouped__') return -1;
        return left.title.localeCompare(right.title);
      });
      return groups;
    }

    /**
     * The workspace name to head a group with: the recorded title, then the
     * folder the workspace points at, then the id.
     * @param {any} item
     * @param {any} copy
     * @returns {string}
     */
    function workspaceNameOf(item, copy) {
      var title = String(item.workspaceTitle || '').trim();
      if (title !== '') return title;
      var path = String(item.workspacePath || '').trim();
      if (path !== '') {
        var parts = path.split(/[\\/]+/).filter(function (part) {
          return part !== '';
        });
        if (parts.length > 0) return parts[parts.length - 1];
      }
      var id = String(item.workspaceId || '');
      return id === '' ? copy.ungrouped : id;
    }

    /**
     * Split the log into what a person reads and what a bug hunter reads.
     *
     * The file holds two kinds of line: what happened (one sentence each) and
     * the request that carried it (route, actor, timing, stack). Only the
     * first belongs in the panel; the rest is the detail view in the file.
     *
     * @param {Array<any>} entries
     * @returns {{ rows: Array<any>, requestCount: number }}
     */
    function splitLogEntries(entries) {
      var all = Array.isArray(entries) ? entries : [];
      var rows = all.filter(function (entry) {
        return entry === null || typeof entry !== 'object' || entry.kind !== 'request';
      });
      return { rows: rows, requestCount: all.length - rows.length };
    }

    /**
     * One log entry as a sentence a person would write.
     *
     * The entry itself keeps every id and count — the view only says what
     * happened to what. Details stay in the file, which the row above names.
     *
     * @param {any} copy
     * @param {any} entry
     * @returns {string}
     */
    function describeOperation(copy, entry) {
      var op = String(entry.op || '');
      var failed = op.slice(-7) === '.failed';
      var base = failed ? op.slice(0, -7) : op;
      var name = String(entry.sessionTitle || entry.workspaceTitle || '').trim();
      var text;
      if (base === 'session.trash') {
        text = format(copy.logSessionTrash, { name: name !== '' ? name : shortSessionId(entry.sessionId) });
      } else if (base === 'workspace.trash') {
        text = format(copy.logWorkspaceTrash, {
          name: name !== '' ? name : String(entry.workspaceId || ''),
          count: String(entry.trashed === undefined ? 0 : entry.trashed),
        });
      } else if (base === 'restore') {
        var restoreName = name !== '' ? name : shortSessionId(entry.sessionId);
        if (restoreName === '') restoreName = String(entry.workspaceId || '');
        if (restoreName === '') text = copy.logRestoreGeneric;
        else if (entry.kind === 'workspace') text = format(copy.logRestoreWorkspace, { name: restoreName });
        else text = format(copy.logRestoreSession, { name: restoreName });
      } else if (base === 'session.retire') {
        var retiredName = name !== '' ? name : shortSessionId(entry.sessionId);
        text = format(copy.logRetire, { name: retiredName === '' ? '?' : retiredName });
      } else if (base === 'trash.purge') {
        var purgedTitles = Array.isArray(entry.titles) ? entry.titles : [];
        text =
          purgedTitles.length === 1
            ? format(copy.logPurgeOne, { name: String(purgedTitles[0]) })
            : format(copy.logPurge, { count: String(entry.removed === undefined ? 0 : entry.removed) });
      } else if (base === 'trash.empty') {
        text = format(copy.logEmpty, { count: String(entry.removed === undefined ? 0 : entry.removed) });
      } else if (base === 'settings.set') {
        var dir = String(entry.effective || entry.trashDir || '');
        text =
          typeof entry.migrated === 'number' && entry.migrated > 0
            ? format(copy.logSettingsMigrated, { dir: dir, count: String(entry.migrated) })
            : format(copy.logSettings, { dir: dir });
      } else if (base === 'log.clear') {
        text = format(copy.logClearEntry, { count: String(entry.removed === undefined ? 0 : entry.removed) });
      } else {
        text = copy.logOther;
      }
      return failed ? format(copy.logFailed, { text: text, code: String(entry.code || 'unknown') }) : text;
    }

    /**
     * The settings rail glyph: a trash can, in the shell's filled icon language.
     *
     * Drawn here rather than borrowed from the icon set: the rail renders this
     * component with only a `size` prop, and a shipped outline component given no
     * props renders at no size at all — which is why the rail kept its default
     * gear. A raw svg with explicit width/height always draws.
     */
    function TrashSettingsIcon(props) {
      var size = props !== null && props !== undefined && typeof props.size === 'number' ? props.size : 16;
      return React.createElement(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'currentColor',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        React.createElement('path', {
          d: 'M6.2 1.6h3.6c.5 0 .9.4.9.9v.5h2.4c.4 0 .8.3.8.8s-.4.8-.8.8h-.4l-.6 9c0 .6-.5 1-1 1H4.9c-.6 0-1-.4-1-1l-.6-9h-.4c-.4 0-.8-.3-.8-.8s.4-.8.8-.8h2.4v-.5c0-.5.4-.9.9-.9Zm.8 1.4h2v-.5h-2v.5Zm-.6 2.9a.6.6 0 0 0-1.2 0v5.4a.6.6 0 0 0 1.2 0V5.9Zm3.2 0a.6.6 0 0 0-1.2 0v5.4a.6.6 0 0 0 1.2 0V5.9Z',
        }),
      );
    }

    /* ------------------------------------------------------------------ */
    /* locale plumbing                                                     */
    /* ------------------------------------------------------------------ */

    /** The client context, kept so services can be read at render time. */
    var clientContext = null;
    /** The last language we rendered with. */
    var language = 'zh';

    /**
     * The `locale` service, or `null`.
     *
     * It is read on every use instead of cached: on this DSH build the service
     * may be registered after this plugin applies, and `ctx.get()` answers
     * `undefined` until then. Anything but a live object is "no locale service".
     * @returns {any}
     */
    function currentLocale() {
      try {
        var context = clientContext;
        if (context === null || context === undefined || typeof context.get !== 'function') return null;
        var service = context.get('locale');
        if (service === null || service === undefined) return null;
        return typeof service === 'object' ? service : null;
      } catch (error) {
        return null;
      }
    }

    /**
     * Translations for the current language. A tiny local hook keeps every
     * component honest: the dictionary never throws, needs no host service, and
     * falls back to Chinese.
     * @returns {any}
     */
    function useCopy() {
      var pair = React.useState(language);
      var current = pair[0];
      var setCurrent = pair[1];
      React.useEffect(function () {
        var next = languageOf(currentLocale());
        if (next !== current) setCurrent(next);
        return undefined;
      }, []);
      return TEXT[current] !== undefined ? TEXT[current] : TEXT.zh;
    }

    /**
     * Remember the context and the language to start with.
     * @param {any} ctx
     */
    function installLocale(ctx) {
      clientContext = ctx === undefined ? null : ctx;
      language = languageOf(currentLocale());
    }

    /* ------------------------------------------------------------------ */
    /* workspace label shim                                                */
    /* ------------------------------------------------------------------ */

    /**
     * DSH ships "删除工作区" for an action that only unregisters the workspace
     * and leaves every session in place. The name promises data loss it does not
     * perform, so this plugin shows it as "移至未分组" / "Move to Ungrouped".
     *
     * There is no supported override. `locale.register('workspace', …)` refuses a
     * second dictionary for the same locale ("already has locale"), the workspace
     * row menu is not a slot (it is a hard-coded array in ui-workspace), and
     * `translate()` resolves through a fixed `dicts` table. So the shim rewrites
     * the two keys in the live dictionary object and republishes, which is the
     * only lever a plugin has.
     *
     * It is written to fail closed: it only touches a dictionary it recognises,
     * it restores the exact strings it replaced, and if DSH reorganizes that
     * table the shim does nothing at all and the stock wording stays.
     */
    var LABEL_RENAMES = {
      'delete.workspace': { zh: '移至未分组', en: 'Move to Ungrouped' },
      'delete.pending': { zh: '正在移至未分组…', en: 'Moving to Ungrouped…' },
    };

    /**
     * Ask the locale runtime to re-render its subscribers.
     * @param {any} locale
     */
    function republishLocale(locale) {
      try {
        if (locale === null || locale === undefined) return;
        if (typeof locale.publish !== 'function') return;
        var current = typeof locale.getLocale === 'function' ? locale.getLocale() : '';
        var id = typeof current === 'string' ? current : current !== null && current !== undefined && typeof current.id === 'string' ? current.id : '';
        if (id !== '') locale.publish(id, false);
      } catch (error) {
        /* a failed repaint leaves the old wording; nothing breaks */
      }
    }

    /**
     * Rewrite the shipped workspace labels once their dictionary exists.
     * ui-workspace may register after this plugin, so the shim subscribes and
     * patches on the first publication that carries the dictionary.
     *
     * @param {any} ctx
     * @param {{ patched: boolean, originals: Array<{ dict: any, key: string, value: string }> }} state
     */
    function installWorkspaceLabelShim(ctx, state) {
      /** @returns {boolean} whether anything was rewritten */
      function patch() {
        var locale = currentLocale();
        if (locale === null) return false;
        var tables = locale.dicts;
        if (tables === null || tables === undefined || typeof tables.get !== 'function') return false;
        var byLocale = tables.get('workspace');
        if (byLocale === null || byLocale === undefined || typeof byLocale.forEach !== 'function') return false;
        var changed = false;
        byLocale.forEach(function (dict, key) {
          if (dict === null || typeof dict !== 'object') return;
          var language = String(key).toLowerCase().indexOf('en') === 0 ? 'en' : 'zh';
          for (var name in LABEL_RENAMES) {
            if (!Object.prototype.hasOwnProperty.call(LABEL_RENAMES, name)) continue;
            if (typeof dict[name] !== 'string') continue;
            if (dict[name] === LABEL_RENAMES[name][language]) continue;
            state.originals.push({ dict: dict, key: name, value: dict[name] });
            dict[name] = LABEL_RENAMES[name][language];
            changed = true;
          }
        });
        if (changed) {
          state.patched = true;
          republishLocale(locale);
        }
        return changed;
      }

      function restore() {
        for (var index = state.originals.length - 1; index >= 0; index -= 1) {
          var entry = state.originals[index];
          try {
            entry.dict[entry.key] = entry.value;
          } catch (error) {
            /* the dictionary went away with its owner: nothing to restore */
          }
        }
        state.originals.length = 0;
        state.patched = false;
        republishLocale(currentLocale());
      }

      try {
        var service = currentLocale();
        if (!patch() && service !== null && typeof service.subscribe === 'function') {
          ctx.effect(
            function () {
              return service.subscribe(function () {
                if (!state.patched) patch();
              });
            },
            'dsh-session-delete: workspace label shim',
          );
        }
        ctx.effect(function () {
          return restore;
        }, 'dsh-session-delete: workspace label restore');
      } catch (error) {
        /* the shim is a courtesy: never let it break the plugin */
      }
    }

    /* ------------------------------------------------------------------ */
    /* registration                                                        */
    /* ------------------------------------------------------------------ */

    /** What this bundle managed to do in this page, for the host's diagnostics. */
    var report = { phase: 'factory', registered: [], failures: [], entries: '' };

    /**
     * Tell the host half what happened in the browser.
     *
     * The web boot audit only says whether an entry activated; it cannot say
     * which slot a plugin failed to reach. This one-shot POST is the difference
     * between "the panel is missing" and "the panel never got a slot".
     *
     * @param {string} phase
     * @param {object} [extra]
     */
    function postReport(phase, extra) {
      try {
        var body = {
          phase: phase,
          registered: report.registered.join(','),
          failures: report.failures.join(' | '),
          entries: report.entries,
          locale: language,
          at: new Date().toISOString(),
        };
        if (extra !== undefined) for (var key in extra) if (Object.prototype.hasOwnProperty.call(extra, key)) body[key] = extra[key];
        fetch(ROUTES.report, {
          method: 'POST',
          keepalive: true,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(function () {});
      } catch (error) {
        /* the report is a diagnostic, never a requirement */
      }
    }

    /**
     * Register one slot entry, swallowing any failure.
     * A plugin must never take the surface it decorates down with it.
     * @param {any} ctx
     * @param {string} slot
     * @param {any} options
     * @param {Function} Component
     * @param {{ locale: boolean }} [extra]
     * @returns {boolean} whether the registration was accepted
     */
    function register(ctx, slot, options, Component, extra) {
      try {
        if (ctx === null || ctx === undefined || ctx.slots === null || ctx.slots === undefined) {
          throw new Error('the `slots` service is not available');
        }
        var registration = Object.assign({ name: slot }, options);
        ctx.slots.inject(slot, function () {
          return ctx.slots.register(registration, Component);
        });
        report.registered.push(slot);
        return true;
      } catch (error) {
        report.failures.push(slot + ': ' + String(error && error.message ? error.message : error));
        try {
          console.warn('[' + PACKAGE_ID + '] could not register ' + slot + ':', error);
        } catch (ignored) {
          /* nothing else to do */
        }
        return false;
      }
    }

    /**
     * The slot names this plugin owns, in registration order.
     */
    var OWNED_SLOTS = [
      'sidebar.workspaces.session.menu.item',
      'sidebar.workspaces.session.row.action',
      'shell.overlay',
      'sidebar.panellist',
      'main',
      'settings.section',
      'settings.section.icon',
    ];

    /**
     * How many entries each owned slot actually holds right now.
     *
     * `ctx.slots.register()` can be deferred until the owning slot is declared,
     * so "we called register" is not the same as "the entry exists". This
     * snapshot is the honest answer, and it is what the host report carries.
     *
     * @param {any} ctx
     * @returns {string}
     */
    function slotSnapshot(ctx) {
      var parts = [];
      try {
        var slots = ctx !== null && ctx !== undefined ? ctx.slots : undefined;
        for (var index = 0; index < OWNED_SLOTS.length; index += 1) {
          var name = OWNED_SLOTS[index];
          var count = 0;
          try {
            if (slots !== undefined && typeof slots.entries === 'function') {
              var list = slots.entries(name);
              count = Array.isArray(list) ? list.length : 0;
            }
          } catch (error) {
            count = -1;
          }
          parts.push(name + '=' + count);
        }
      } catch (error) {
        return 'unavailable';
      }
      return parts.join(',');
    }

    /**
     * Keep a surface from rendering an empty rectangle when it throws.
     *
     * A React error boundary is the only place a plugin can turn its own crash
     * into words, and words are the difference between "the panel is empty" and
     * "the panel failed for this reason".
     *
     * @param {string} name
     * @param {Function} Component
     * @returns {Function}
     */
    function withBoundary(name, Component) {
      var Base = typeof React.Component === 'function' ? React.Component : null;
      if (Base === null) return Component;
      var Boundary = class extends Base {
        constructor(props) {
          super(props);
          this.state = { error: null };
        }
        static getDerivedStateFromError(error) {
          return { error: error };
        }
        componentDidCatch(error) {
          var message = String(error !== null && error !== undefined && error.message !== undefined ? error.message : error);
          report.failures.push('render ' + name + ': ' + message);
          postReport('client.render.failed', { surface: name, error: message });
        }
        render() {
          if (this.state !== null && this.state !== undefined && this.state.error !== null && this.state.error !== undefined) {
            var detail = String(this.state.error.message !== undefined ? this.state.error.message : this.state.error);
            return React.createElement(
              'div',
              { className: 'dsd-root' },
              React.createElement('h2', { className: 'dsd-title' }, '垃圾桶'),
              React.createElement('div', { className: 'dsd-error' }, '渲染失败：' + detail),
            );
          }
          return React.createElement(Component, this.props);
        }
      };
      Boundary.displayName = 'DsdBoundary(' + name + ')';
      return Boundary;
    }

    /**
     * @param {any} ctx client cordis context
     */
    function apply(ctx) {
      var shimState = { patched: false, originals: [] };
      try {
        installStyles();
        installLocale(ctx);

        /** The locale service is optional; only label vendors need it. */

        /* Rename the shipped "删除工作区" to what it actually does. */
        installWorkspaceLabelShim(ctx, shimState);

        /* Session row "…" menu: order 500 puts the row after the shipped
           archive (400) and opens the plugin group with a separator. */
        register(
          ctx,
          SLOT_SESSION_MENU,
          {
            id: PACKAGE_ID + '.move-session',
            order: 500,
            inject: function (sessionId) {
              return { sessionId: sessionId, __ctx: ctx };
            },
          },
          SessionTrashItem,
          { locale: false },
        );

        /* Hover action on the same row: same operation, one click away. */
        register(
          ctx,
          SLOT_SESSION_ACTION,
          {
            id: PACKAGE_ID + '.move-session-action',
            order: 150,
            label: function () {
              return TEXT[language].rowAction;
            },
            inject: function (sessionId) {
              return { sessionId: sessionId, __ctx: ctx };
            },
          },
          SessionTrashAction,
          { locale: false },
        );

        /* The confirmation dialog every destructive action opens. */
        register(ctx, SLOT_OVERLAY, { id: PACKAGE_ID + '.confirm', order: 200 }, withBoundary('confirm', ConfirmDialog), { locale: false });

        /* The trash panel: one icon in the sidebar's global panel list, one page
           in the layout's keyed `main` slot under the same id. */
        register(
          ctx,
          SLOT_PANEL_LIST,
          {
            id: PANEL_ID,
            order: 30,
            label: function () {
              return TEXT[language].panel;
            },
          },
          TrashPanelIcon,
          { locale: false },
        );
        register(
          ctx,
          SLOT_MAIN,
          {
            /* `key` is what the layout dispatches a panellist id with; `id` is
               carried as well so an entry lookup by either name finds it. */
            key: PANEL_ID,
            id: PANEL_ID,
            label: function () {
              return TEXT[language].panelTitle;
            },
          },
          withBoundary('panel', TrashPanelPage),
          { locale: false },
        );

        /* Settings → one page in the left rail, with a matching nav icon. */
        register(
          ctx,
          SLOT_SETTINGS_SECTION,
          {
            id: PACKAGE_ID,
            order: 70,
            label: function () {
              return TEXT[language].settingsTitle;
            },
          },
          withBoundary('settings', TrashSettingsPage),
          { locale: false },
        );
        register(
          ctx,
          SLOT_SETTINGS_ICON,
          {
            id: PACKAGE_ID,
            order: 70,
            label: function () {
              return TEXT[language].settingsTitle;
            },
          },
          TrashSettingsIcon,
          { locale: false },
        );

        report.phase = 'client.applied';
        postReport('client.applied', { patched: shimState.patched === true });
        /* A second, settled report says what the slots really hold once their
           declarations have had a chance to materialise. */
        try {
          if (typeof setTimeout === 'function') {
            setTimeout(function () {
              report.entries = slotSnapshot(ctx);
              postReport('client.settled', { patched: shimState.patched === true });
            }, 2000);
          }
        } catch (error) {
          /* the first report already said we applied */
        }
      } catch (error) {
        report.phase = 'client.failed';
        postReport('client.failed', { error: String(error && error.message ? error.message : error) });
        try {
          console.warn('[' + PACKAGE_ID + '] client half failed:', error);
        } catch (ignored) {
          /* nothing else to do */
        }
      }
    }

    exports.apply = apply;
    /** Only `slots` is certainly provided; anything else is resolved lazily. */
    exports.inject = ['slots'];
    /* Exposed for the plugin's own tests; not part of any contract. */
    exports.__internals = {
      ROUTES: ROUTES,
      TEXT: TEXT,
      LABEL_RENAMES: LABEL_RENAMES,
      format: format,
      formatBytes: formatBytes,
      languageOf: languageOf,
      describeOperation: describeOperation,
      reasonText: reasonText,
      splitLogEntries: splitLogEntries,
      updateStatusText: updateStatusText,
      groupTrashItems: groupTrashItems,
      formatShortTime: formatShortTime,
      callHost: callHost,
      postReport: postReport,
      installWorkspaceLabelShim: installWorkspaceLabelShim,
      withBoundary: withBoundary,
      ConfirmDialog: ConfirmDialog,
      requestConfirm: requestConfirm,
      getConfirmRequest: function () { return confirmRequest; },
      settleConfirm: settleConfirm,
      slotSnapshot: slotSnapshot,
    };
    /* The bundle reached the page; say so even when `apply` never runs. */
    postReport('factory');
    return module.exports;
  },
});
