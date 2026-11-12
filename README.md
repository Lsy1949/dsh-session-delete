---
description: "A DSH sidebar trash: move sessions or whole workspaces out of the session store, restore them, delete single records or all of them; with a configurable folder, a sidebar panel, a settings page and a readable operation log."
kind: "plugin-reference"
---

# dsh-session-delete

A **trash** for sessions and workspaces in DeepSeek Harness (DSH).

Moving to the trash is **not** deleting: the record leaves the session store
whole and can come back exactly as it was. Only "Delete permanently" and "Empty
trash" destroy data. Project folders, code and documents are never read or
written.

Targets DSH `>= 0.2.1-rc.2 < 0.3.0`. Version 2.x is a new implementation and
does not read 1.x trash items.

中文文档见 [README.zh.md](README.zh.md).

## Contents

- [What it does](#what-it-does)
- [Install](#install)
- [After installing](#after-installing)
- [Daily use](#daily-use)
- [Settings](#settings)
- [Updates](#updates)
- [Where names and paths come from](#where-names-and-paths-come-from)
- [How a session directory is found](#how-a-session-directory-is-found)
- [Safety](#safety)
- [Known limits](#known-limits)
- [Troubleshooting](#troubleshooting)
- [Where the data lives](#where-the-data-lives)
- [Development](#development)
- [Uninstall](#uninstall)
- [License](#license)

## What it does

| Where | Action | Effect |
|---|---|---|
| Session row "⋯" menu | **Move to Trash…** | that session's log directory moves into the trash, the sidebar stops listing it; restorable |
| Session row hover button | **trash icon** | same action, opens the confirmation dialog right away |
| Sidebar global panel list | **Trash** icon | opens the trash panel |
| Trash panel | **Restore** per row | moves the record back and reattaches it to its workspace (a workspace comes back with its original session order) |
| Trash panel | **Delete permanently** per row | deletes only that record, behind a confirmation dialog |
| Trash panel | tick rows, then **Restore selected** | puts every ticked record back in one request |
| Trash panel | tick rows, then **Delete selected** | deletes only the ticked records |
| Trash panel | **Select all / clear**, plus **Select group** per workspace | bulk work without a hundred clicks |
| Trash panel | **Scan session folders** | finds folders still on disk that the app no longer lists |
| Trash panel | **Empty trash** | deletes everything at once, behind a confirmation dialog |
| Session row (log already gone) | **Remove from the list** | a ghost row the store still lists but whose directory no longer exists can be archived away |
| Trash panel → Workspaces | **Delete workspace…** | the whole workspace (every session plus its registration) becomes one trash item, restorable as a whole |
| Settings → **Trash** | folder, migration, size, operation log | changing the folder migrates the existing items by default; the log can be opened, copied or cleared |

Every destructive action goes through the same confirmation dialog, and every
failure names its reason (`missing` / `live` / `ambiguous` / `exists` /
`unavailable` …).

## Install

```bash
dsh plugin --profile desktop add https://github.com/Lsy1949/dsh-session-delete.git
```

Replace `desktop` with your profile name (the desktop app uses `desktop`).

From a local checkout (offline, or while editing the code):

```bash
git clone https://github.com/Lsy1949/dsh-session-delete.git
dsh plugin --profile desktop add "D:\path\to\dsh-session-delete"
```

Then **fully quit and restart DSH** (tray icon → Quit, not just closing the
window): the host half only loads when the process starts.

Upgrading: `git pull` (or `add` again), then fully restart.

### Which version for which DSH

| Plugin version | DSH range | Where to get it |
|---|---|---|
| `main` (default) | whatever the current `engines.dsh` declares (now `>= 0.2.1-rc.2 < 0.3.0`) | the install command above |
| support for a newer DSH | announced in the release notes | lands on `main` when it is ready |
| maintenance for an older DSH | bug fixes only, frozen range | the matching branch (e.g. `dsh-0.2`), cut when `main` moves on |

Every release is tagged and its GitHub release notes state the DSH range it
supports. When the plugin announces support for a newer DSH, users still on the
old DSH pin the maintenance branch instead of `main`:

```bash
git clone -b dsh-0.2 https://github.com/Lsy1949/dsh-session-delete.git
dsh plugin --profile desktop add "D:\path\to\dsh-session-delete"
```

As an extra guard, the plugin's updater refuses to auto-pull a version whose
`engines.dsh` range differs from the installed one: it reports `engines-changed`
instead of silently moving you to an incompatible line.

Manual fallback when the CLI is unavailable:

1. put the package at `~/.dsh/profiles/desktop/node_modules/dsh-session-delete`
2. append to `~/.dsh/profiles/desktop/cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-session-delete
      name: dsh-session-delete
```

3. fully restart DSH

## After installing

| Check | Expect |
|---|---|
| sidebar panel list | a **Trash** icon |
| a session row's "⋯" menu | **Move to Trash…** at the end |
| hovering a session row | a trash icon |
| Settings → Trash | the trash page: folder field, size, operation log |

All four means installed.

## Daily use

**Move a session to the trash** — session row "⋯" → Move to Trash…, or click the
hover trash icon; confirm. The row leaves the sidebar and lands in the trash.

**Move a whole workspace** — trash panel → Workspaces → Delete workspace…; every
session of that workspace becomes one trash item and the registration goes with
it.

**Get records back** — open the trash panel → **Restore** on the row. A workspace
comes back with its sessions in their original order.

**Delete only a few** — tick them and use **Delete selected**, or press
**Delete permanently** on one row.

**Clean everything** — **Empty trash** (there is no undo).

## Settings

Settings → Trash:

| Field | Meaning |
|---|---|
| Trash folder | **one field**: type or paste the path, or press **Browse…** on its right edge to pick it in the system folder dialog (the app's own native one on the desktop). Must be an absolute path, `~` is expanded; empty means the default `<DSH home>/trash/sessions` |
| Move existing items when the folder changes | on by default; a failed migration rolls back as a whole |
| Current / default folder | shown for comparison |
| Operation log | view / open the file / copy the path / clear |
| Open trash folder | hands the folder to the system file manager |

The mount row can configure the folder too (lower precedence than the value saved
from the settings page):

```yaml
- id: dsh-session-delete
  name: dsh-session-delete
  config:
    trashDir: 'D:\dsh-trash'   # absolute; ~ is expanded
```

**Constraint**: the trash folder must not overlap the session store (equal,
inside, or containing it is refused). Otherwise "move to trash" would shuffle
records back into the store and "empty" could delete live data.

## The trash panel

Records are **grouped by workspace**, mirroring the sidebar, so it is obvious at a
glance which workspace a trashed session belongs to:

```
▾ Project A                          3 records · 5.2 MB   ☐ Select group   [Collapse]
    ☐ 论文截图                        11/11 23:29 · 2.1 MB   [Restore][Delete]
      C:\work\a\论文
▾ Ungrouped                          1 record · 100 B
```

- the group heading is the workspace name (falling back to its folder), with the
  folder in the tooltip
- each heading carries the **count and total size** plus **Select group** and
  **Collapse/Expand**
- sessions in no workspace share the "Ungrouped" block — the sidebar's own word
- ticking rows offers **Restore selected** next to **Delete selected**: the safe
  direction beside the destructive one, because fewer clicks is fewer mistakes
- the size is measured once, when a record is trashed, so a panel refresh no longer
  walks the whole trash (only items from older builds are measured again)
- a workspace deleted as a whole sits in its own group, counting the sessions it
  carried

### Scanning for leftover folders

Deleting a session can leave its log directory behind: invisible in the app, still
on disk. **Scan session folders** in the panel finds them:

```
▾ Scan session folders   12 session folders on disk, 3 no longer listed      [Move selected (2)] [Scan]
    ☐ 论文截图       2.1 MB · 11/10 16:00 · C-Users-Test-project   [Open folder] [Move to trash]
    ☐ (session without a name)   100 B · 11/09 09:12 · C-Users-Test-project   [Open folder] [Move to trash]
```

- "No longer listed" means neither the durable store's `list()` nor any
  workspace's `sessionIds` knows the id
- the name still comes from the `session/title` events in the log; when the log carries
  none the row says so instead of showing `session-e4b8a47f…`
- **Move to trash moves the whole folder**, it does not delete it: restore puts it back
  at `sessions/<group>/<id>` from the list below
- folders already waiting in the trash are not reported again
- a folder the app lists again is refused (`still-listed`), and so is a running
  session (`live`)
- sizes are measured only for the 200 rows that are returned, so thousands of
  leftovers do not turn one click into a minute

### How the folder is chosen

The browser half cannot open a native dialog (a plugin bundle has no handle on
the app window), so the host opens one, trying three transports in order:

1. **Electron's `dialog.showOpenDialog`** — what the desktop app uses: modal,
   parented to the window, remembers the last folder
2. the platform dialog — PowerShell's `FolderBrowserDialog` on Windows,
   `osascript choose folder` on macOS, `zenity --directory` on Linux (the path
   taken when the host runs under plain `node`)
3. neither: the route answers `unsupported` and the field falls back to typing

The field and the button are one control: the input is always editable, and the
button only fills in what the dialog returned — the shape every file picker in
VS Code or Windows Settings uses. The dialog times out after 180 s, cancelling is
not an error (it just says no folder was chosen), and
`DSH_SESSION_DELETE_NO_PICKER=1` disables it (tests, headless hosts). Nothing
applies until **Save**, which is also when the migration option takes effect; the
panel says "unsaved changes" until then.

## Updates

Settings → Trash → **Updates** shows the installed version and the published one,
and offers **Check for updates** and **Update now**, plus two switches:

| Switch | Default | Effect |
|---|---|---|
| Check for updates automatically | on | one background look at the repository about ten seconds after start; downloads nothing |
| Pull updates automatically | off | pulls and verifies in the background when something newer exists; rolls back on failure |

**An update only replaces files on disk: this process keeps running the old code
until DSH is fully restarted.** The panel says so every time.

### It works for every way the plugin is installed

Checking needs **no git at all**: it reads the repository package.json over HTTPS
first (no credentials, usually under two seconds) and only falls back to
git fetch when that fails. So:

| Install | Can check | Can update itself | What the panel says |
|---|---|---|---|
| installed from the git URL (a clone with .git) | yes | yes (`git pull`) | an **Update now** button |
| copied or unzipped (no .git) | yes | yes (downloads the tarball) | an **Update now** button |
| no git command at all | yes | yes (downloads the tarball) | an **Update now** button, noting the HTTPS transport |
| offline / GitHub unreachable | — | — | "check timed out" or "cannot reach GitHub", with the command below |

**Updating needs no git**: a checkout with a working git pulls; everything else
downloads GitHub's `tar.gz` and unpacks it — HTTPS is the only requirement.

When a checkout's `git pull` fails *because of the network* (a proxy that only
serves HTTPS, a blocked git transport), the tarball path is tried automatically, so
"git cannot connect" no longer means "cannot update". A failed automatic check at
startup (offline, timed out) is retried twice, quietly — after 60 s and 180 s.

The version metadata is read from `raw.githubusercontent.com`, then
`github.com/<repo>/raw/…`, then `api.github.com`; the tarball comes from
`codeload.github.com`, then `github.com/<repo>/archive/…`. One blocked host does
not fail the check — networks that block only the raw host are common. Both
paths do the same thing: verify, back up the current tree, write, verify again,
and roll back if anything fails.

The panel **always** shows the repository and the manual command, so every
install has a way forward:

    dsh plugin --profile <profile> add https://github.com/Lsy1949/dsh-session-delete

A check is bounded: 8 s per request, 10 s for git fetch, 15 s for the whole
check. Past that it answers "the check timed out" — it never sits on
"checking" forever.

**Whether this install is a checkout is decided by the presence of `.git`, not by
whether a git command answers** — different problems, different fixes:

- when the git command cannot be found (a desktop app launched from a launcher
  may not carry a terminal PATH) it searches `git`, `D:\Git\cmd\git.exe`,
  `C:\Program Files\Git\cmd\git.exe`, `%LOCALAPPDATA%\Programs\Git\cmd\git.exe`
  (and `/usr/bin/git` and friends elsewhere), or `DSH_SESSION_DELETE_GIT` when set
- if none answer it reports `no-git-binary` instead of the misleading "this is not
  a checkout"
- an offline answer still says which kind of install it is, so the panel names the
  real problem

> Note: Node fetch ignores the system proxy; only git reads HTTPS_PROXY. A machine
> that reaches GitHub through a proxy can check and update when the install is a
> checkout, and must update by hand when it is a copy.

### Why it cannot break the app

A plugin that updates itself is the easiest way to brick a plugin, so every step
is fenced:

- **not a git checkout, not touched** (`not-git`): pulling needs one
- **behind a local proxy**: `git fetch` reads `HTTPS_PROXY`, but not the Windows
  WinINET proxy setting. If this machine only reaches GitHub through a local proxy
  (say `HTTPS_PROXY=http://127.0.0.1:7897`), export it in the environment that
  starts DSH — otherwise the check answers `offline`, which is the truth
- **no network is reported as such** (`offline`): a failed connection is never
  dressed up as "already up to date"
- **a dirty worktree is refused** (`dirty`): your edits are never overwritten,
  which is also what makes a rollback safe
- **a different DSH range is refused** (`engines-changed`): a pull whose remote
  `engines.dsh` differs from the installed one would move you to another
  compatibility line, so it never happens automatically
- **`git pull --ff-only` only**: never a merge, never a rebase, never a
  half-resolved conflict
- **verified before it counts**: `package.json` must still carry the right name,
  `manifestVersion` and entry points; `index.js`, `client.js` and every
  `lib/host/*.js` must pass `node --check`; `client.js` must still register with
  the module loader
- **a failed verification rolls back** (`rolled-back`): `git reset --hard` to the
  commit it started from, with the reasons reported
- **a failed pull rolls back too** (`pull-failed`), e.g. a diverged branch
- **one update at a time** (`busy`); every subprocess and request has a deadline
  (git 60 s, network 15 s)
- **the app is never restarted**: your running session is never interrupted
- **a kill switch**: `DSH_SESSION_DELETE_NO_UPDATE=1` answers `disabled` for both
  check and apply (tests, headless deployments)

Updates are written to the operation log (`update.apply` /
`update.apply.failed`, with from/to, the number of changed files and why it
failed).

## Where names and paths come from

Each row shows **the name you saw in the sidebar**, from three sources in order:

1. recorded when the record was moved (the most accurate);
2. failing that — moved through the API, or by an older build — read out of the
   log the item carries: DSH writes each accepted title as a `session/title`
   event, so the newest one is recovered without a title service or a model call;
3. only then the folder name plus a short id (like `#e4b8a47e`).

Under the name sits **the folder it came from** (long paths are ellipsised; hover
for the whole thing), then a line with the workspace, the move time and the size.
Hovering also reveals the full session id.

## How a session directory is found

`sessionPersistence.list()` and `stat()` describe a session's header, revision
and size, but they do **not** hand out the log path (in this build `location`
only appears on error objects). So the plugin never derives the directory name —
it reads the store: one level of group directories under `<DSH home>/sessions/`,
looking for the directory named exactly like the session id.

Group names are DSH's own encoding (for example
`--C-Users-Administrator-Desktop-1-~65B0~5EFA~6587~4EF6-5939--`). Nothing here
computes them, so a change to that encoding cannot make the plugin move the wrong
directory.

| Case | Result |
|---|---|
| not found | `missing` (404), nothing is touched |
| one id in two groups | `ambiguous` (409), refused rather than guessed |
| not shaped `sessions/<group>/<session>` | `bad-path`, refused |

## Safety

- **Only a session with a turn actually running is refused** (`live`): a session
  the sidebar has merely loaded can still be trashed; when the plugin cannot tell,
  it assumes idle and lets the move decide, and a genuinely locked record answers
  `busy` (Windows reports an open file handle that way) instead of quietly copying
  a log a turn is still writing
- **Only** directories shaped like `sessions/<group>/<session>` are moved; a
  manifest path outside that shape is refused
- **Restore never overwrites**: an existing target answers `exists`
- **Deletion only happens inside the trash**; out-of-bounds manifest entries are
  skipped
- **A failed move rolls back**: files return, the archive flag returns, no
  half-written item is left behind
- Every mutation is a **same-origin POST + JSON**: a mismatched `Origin`/`Host`
  answers 403, anything but POST answers 405
- Handing a file to the file manager only accepts the targets `log` / `config` /
  `trash` — **a caller cannot supply a path**
- To make a row disappear immediately the plugin calls the official archive API;
  restoring undoes **only the flag it set itself**, leaving a previously archived
  session archived

### Ghost rows (the log directory is already gone)

DSH sometimes still lists a row whose log directory is gone. Two sources: you
deleted `~/.dsh/sessions/**/session-…` by hand, or **an older build of this
plugin created it** — that build cleared the archive flag after a permanent
delete, so the data was gone, the row came back, and opening it failed with
`ENOENT: no such file or directory … session.v4.jsonl.zstd`.

**Emptying the trash and deleting a record no longer clear the archive flag**
(that flag is what keeps the row hidden), so no new ghost rows appear. For the
ones that already exist:

- the trash panel lists them: "N sessions are still listed but their log file is
  gone" with an **Archive these empty rows** button
- one at a time also works: Move to Trash answers `missing`, and the dialog then
  offers **Remove from the list**
- both only call the official archive API, **touch no files**, and leave the row
  recoverable from the DSH archive
- the decision is written to the operation log (`session.retire` with
  `reason: "no-directory"`)

## Known limits

- **No workspace-row menu slot exists.** DSH exposes
  `sidebar.workspaces.session.menu.item` (session rows) and nothing for workspace
  rows, so whole-workspace moves live in the trash panel instead of a faked menu
- **Sessions need a backend that keeps one artifact per session** (the shipped
  JSONL backend does). A backend without per-session files is invisible here
- **Moving relies on the on-disk layout.** `sessions/<group>/<session>` is the
  only accepted shape; if DSH changes it, the plugin refuses instead of guessing
- **No global toast service**: a failed session-row action reports inside the
  confirmation dialog; the trash panel is where full state is shown
- Records still in the trash folder after uninstalling stay there, unmanaged

## Troubleshooting

The browser half reports what it did on every boot:

```bash
curl -s -X POST -H "content-type: application/json" -d "{}" http://127.0.0.1:<port>/dsh-session-delete/state
```

The `client` field carries:

| Field | Meaning |
|---|---|
| `phase` | `factory` / `client.applied` / `client.failed` / `client.settled` |
| `registered` | slots it reached |
| `entries` | how many entries each slot really holds |
| `failures` | failures and render crashes |
| `patched` | whether the workspace label rename applied |

A surface that crashes never renders blank: the panel and the settings page are
wrapped in an error boundary that shows "渲染失败：…" and records the reason in
that report.

### What the operation log records

The log file (`<DSH home>/dsh-session-delete/operations.log`, JSONL) holds two
kinds of line, one JSON each:

| Kind | `kind` | Content |
|---|---|---|
| what happened | absent | the action, the name it touched, counts, reason codes |
| who called what, when | `request` | route, HTTP status, duration, arguments, answer summary, stack |

Both carry the fields a person needs to explain a line without reproducing the
session:

```json
{"at":"2026-11-12T00:32:42.364Z","atMs":1794414762364,
 "actor":{"osUser":"Administrator","host":"Computer-L","platform":"win32","release":"10.0.26200","pid":35824},
 "reqId":"req-mwcc7vy0-t0clwg",
 "request":{"route":"/dsh-session-delete/session/move","method":"POST","origin":"http://127.0.0.1:58434",
            "userAgent":"Mozilla/5.0 …","remote":"127.0.0.1"},
 "kind":"request","op":"request.session.move","ok":true,"status":200,"durationMs":42,
 "args":{"sessionId":"session-...","title":"…"},
 "result":{"trashId":"20261112-003242-001-session-...","cwd":"C:\\Users\\..."}}
```

- `at` / `atMs`: ISO time and a millisecond stamp; `actor`: OS user, host,
  platform, release, pid
- `reqId`: every line produced by one request shares it, so lines correlate
- `args` / `result`: what was asked and what came back (arrays collapse to a
  length, long strings are trimmed)
- a failure adds `error: { message, stack }`
- every request is recorded; only the self-check polls (`client/report`,
  `log/read`) are skipped so they cannot drown the rest

The panel (Settings → Trash → Show operation log) lists only the first kind, one
sentence each in local time; the request detail stays in the file and the panel
prints "N request records" with an **Open log file** button:

```
11/11 23:29   Moved "仓颉编译器实验截图" to the trash
11/11 23:46   Deleted "论文截图" permanently
11/11 23:50   Trash folder set to D:\dsh-trash (2 moved)
```

```

The full record (session id, original folder, counts, actor, timings, stack)
stays in the log file; the panel offers **Open log file** and **Copy path** for
it. Past 1 MB the file rotates to `operations.log.1`, one generation kept.

## Where the data lives

| Content | Location |
|---|---|
| trash items | `<trashDir>/items/<trashId>/manifest.json`; a session under `session/`, a workspace under `sessions/<id>/` |
| settings | `<DSH home>/dsh-session-delete/config.json` |
| operation log | `<DSH home>/dsh-session-delete/operations.log` (JSONL, rotates to `.1` past 1 MB) |

## Development

```
index.js               host entry (re-exports lib/host/plugin.js)
client.js              browser half: one Module-Loader bundle
lib/host/plugin.js     apply(): service lifecycle → route table
lib/host/routes.js     the route table (/dsh-session-delete/*)
lib/host/actions.js    move / restore / delete / panel state
lib/host/trash.js      trash folders, manifests, cross-volume moves, migration
lib/host/title.js      recovering a session's title from its log
lib/host/paths.js      DSH home, session roots, trash-dir resolution and guards
lib/host/settings.js   config.json and operations.log
lib/host/store.js      thin adapter over the DSH services (incl. directory lookup)
lib/host/reveal.js     handing a file or folder to the system file manager
lib/host/http.js       same-origin POST + JSON request/response helpers
cordis.patch.yml       the shipped mount patch (dsh.bundle.patch)
test/smoke.mjs         host half against real temp directories and fake services
test/client.mjs        browser half against a fake module loader / React / slots
```

```bash
npm test          # host 74 checks + client 70 checks
npm run check     # syntax-check both entry points
```

There is no build step: `client.js` is the artifact and `lib/host/*` is imported
directly by the host. After editing, re-run `dsh plugin add` to refresh the copy
in `node_modules`, then fully restart DSH.

## Uninstall

```bash
dsh plugin --profile desktop remove dsh-session-delete
```

Then fully restart. Optional cleanup: delete `<DSH home>/dsh-session-delete/`
(settings and log) and the trash folder — **records still in the trash are
permanently deleted**.

## License

MIT
