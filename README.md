# Simple Search（简单搜索）

[简体中文](README.zh-CN.md)

A DSH Web UI plugin: press **Shift twice** anywhere in the page to open a
JetBrains-style **Simple Search** box. It searches **file names** and the
**text of every file** in the current workspace, with `All` / `Files` / `Text`
tabs. `↑`/`↓` move through the hits, `Enter` opens the selected hit in the
side-card editor (at its line for text hits), `Esc` closes. Opening the panel
selects the previous query, so typing or pasting replaces it.

## What it does

- Double-tap detection means "two clean Shift presses" within 400 ms: holding
  Shift or typing `Shift`+letter never opens the panel.
- Content search runs on the host: the packaged ripgrep binary when resolvable
  (`@vscode/ripgrep`, `rg` on `PATH`, or `DSH_SIMPLE_SEARCH_RG`), with a bounded
  Node.js walk as the fallback, so the feature keeps working without ripgrep.
- File-name search lists the workspace once (cached for 10 s while typing) and
  ranks by a JetBrains-style scorer: exact basename, basename substring, path
  substring, then fuzzy subsequence (so `htexec` finds `http-executor.ts`).
  `All` returns both sections from one request.
- `.gitignore` rules are **not** applied (`--no-ignore-vcs`): many workspaces
  are root repos that ignore every sub-repository, and JetBrains-style search
  is expected to look inside them. Heavy trees (`.git`, `node_modules`, `dist`,
  `.venv*`, caches, `.dsh-memory`) are excluded explicitly instead, and both
  engines share one exclusion list.
- Case-sensitive (`Aa`) and regular-expression (`.*`) toggles.
- Results group per file with the matched text highlighted; the footer shows the
  workspace root, hit/file counts, engine, and elapsed time.
- The panel is a fixed dark (Darcula-like) surface — `#1e1f22` panel, `#232528`
  group headers, `#2e436e` selection — independent of the page theme, with
  `color-scheme: dark` so the caret, selection and scrollbars follow.
- Activating a hit (click or `Enter`) opens the file **and closes the panel**.
  `Enter` opens the file at the exact line through `ctx.betterSidebar.openFile`
  when that plugin is installed; other deployments copy `path:line`, show a
  short notice, and close a beat later.

## Layout

| File | Role |
|---|---|
| `index.js` | Host half: loopback routes `/dsh-simple-search/version` and `/dsh-simple-search/search` (`mode=text|files|all`), workspace/session root resolution, browser-trust fence. |
| `search.js` | Testable search core: ripgrep argv + parsing, fallback walk, skip list, matcher compilation, file listing and name ranking. |
| `client.js` | Browser half: `shell.overlay` entry, double-Shift listener, dialog, debounced requests, opening hits. |
| `tests/search.test.mjs` | `node --test` coverage for the search core. |
| `tests/route.test.mjs` | `node --test` coverage for the fence, root resolution and response envelope. |

The routes are read-only and refuse any root outside a registered workspace or
the calling Session's working directory. They sit behind the same browser-trust
fence as the shipped local routes (loopback/`trustedHosts` Host, same-origin
metadata, `connection.requestRejection`), so the page's own auth cookie is what
authorizes a request.

## Install

The plugin is installed into a DSH `web` profile as the `dsh-simple-search`
bundle; the profile links this directory, which stays the source of truth.

```sh
node --test tests/search.test.mjs tests/route.test.mjs
node --check index.js && node --check search.js && node --check client.js
```

After changing `client.js`, refresh the page so the new client module replaces
the loaded one. Host-half changes (`index.js`, `search.js`) are not re-evaluated
for a linked package (Node caches the module by its real path and HMR only
evicts modules under the profile root): remove + install from a directory whose
path changed, or restart the host.

## Verify

```sh
# route registered and answering (401 without the page's auth cookie is expected)
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3080/dsh-simple-search/version'

# the live client registration
#   cordis_inspect_query Slots.listSubTree root=shell.overlay  → occupant "simple-search"
```

Manual check: refresh the page, press Shift twice, type `RPC HTTP GET`, and
press Enter on the first hit.
