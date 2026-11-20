# Simple Search（简单搜索）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Supported DSH versions: 0.2.2-rc.2+](https://img.shields.io/badge/DSH-0.2.2--rc.2%2B-4d6bfe)](https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions)

[简体中文](README.zh-CN.md)

A DSH Web UI plugin: press **Shift twice** anywhere in the page to open a
JetBrains-style **Simple Search** box with three scopes:

- **Workspace** — searches **file names** and the **text of every file** in the
  current workspace, with `All` / `Files` / `Text` tabs. `Enter` opens the
  selected hit in the side-card editor (at its line for text hits).
- **Sessions** — searches **session titles across every workspace** (the title,
  the workspace directory name, and the session id). `Enter` opens that chat,
  switching workspace when needed.
- **This chat** — searches the **content of the current conversation**. Only
  text both sides actually saw is searched: your prompts and the assistant's
  visible replies. Reasoning/thinking, tool calls, tool results, synthetic
  context and system prompts are excluded. `Enter` jumps to that message in the
  Chat view (loading older history when needed); if no Chat anchor is available
  it copies the full message instead.

`↑`/`↓` move through the hits and `Esc` closes. Opening the panel selects the
previous query, so typing or pasting replaces it.

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
- Session titles are matched locally against the page's loaded session catalog,
  so they need no host round-trip and always cover every workspace. Blank
  placeholders and subagent child sessions are excluded; results are newest
  first.
- Current-chat content is read from the committed Session log on the host, so
  it reaches older history outside the loaded window. The host route
  (`/dsh-simple-search/conversation`) sits behind the same trust fence as the
  file routes, caps the scan (5,000 messages), the response (200 hits) and the
  observation (8 s), and caches the extraction per log cursor. Reasoning blocks
  ("thinking"), tool calls/results and system prompts never enter the search
  surface.
- Results group per file with the matched text highlighted; the footer shows the
  workspace root, hit/file counts, engine, and elapsed time.
- Appearance is a three-way choice — **Light / Dark / Follow DSH** — on the
  bundle's page in **Plugins → Simple Search** → *Appearance*; the choice is
  kept in browser `localStorage` (`dsh-simple-search:appearance`). *Follow DSH*
  reads the DSH theme's effective palette (`body[data-ds-dark-theme]`, plus the
  `theme/change` event) and tracks theme switches or OS flips; Light and Dark
  pin the panel. Both palettes are CSS variables inside the panel and set the
  matching `color-scheme`, so the caret, selection and scrollbars follow.
- Activating a hit (click or `Enter`) opens the file **and closes the panel**.
  `Enter` opens the file at the exact line through `ctx.betterSidebar.openFile`
  when that plugin is installed; other deployments copy `path:line`, show a
  short notice, and close a beat later.

## Layout

| File | Role |
|---|---|
| `index.js` | Host half: loopback routes `/dsh-simple-search/version`, `/dsh-simple-search/search` (`mode=text|files|all`) and `/dsh-simple-search/conversation`, workspace/session root resolution, browser-trust fence. |
| `search.js` | Testable search core: ripgrep argv + parsing, fallback walk, skip list, matcher compilation, file listing and name ranking. |
| `conversation.js` | Testable conversation core: human-visible extraction (human prompts + assistant text, no reasoning/tool traffic), in-session matching, excerpts and caps. |
| `client.js` | Browser half: `shell.overlay` entry, double-Shift listener, scope switcher (Workspace / Sessions / This chat), dialog, debounced requests, opening hits, read-only Chat anchor jump with copy fallback; the `plugins.bundle.config` entry renders the appearance card on the plugin's page. |
| `tests/search.test.mjs` | `node --test` coverage for the search core. |
| `tests/conversation.test.mjs` | `node --test` coverage for conversation extraction, thinking/tool exclusion, matching and caps. |
| `tests/route.test.mjs` | `node --test` coverage for the fence, root resolution, session observation and response envelopes. |
| `tests/client.test.mjs` | `node --test` coverage for the appearance preference, Follow DSH, panel palette resolution, scope switching, title matching and message copying (VM plus fake React, no browser). |

The routes are read-only and refuse any root outside a registered workspace or
the calling Session's working directory; the conversation route reads one
Session through the host's `sessionQuery` service and never opens log files
directly. All three sit behind the same browser-trust fence as the shipped local
routes (loopback/`trustedHosts` Host, same-origin metadata,
`connection.requestRejection`), so the page's own auth cookie is what authorizes
a request. The fence **fails closed**: when the host's Connection service is
missing or cannot reject requests, the routes answer `503 auth-unavailable`
rather than serve workspace text to a caller whose identity cannot be verified.
The plugin also declares `connection` in `inject`, so it does not mount at all
in a deployment without host authentication.

## Install

The plugin is installed into a DSH `web` profile as the `dsh-simple-search`
bundle; the profile links this directory, which stays the source of truth.

```sh
npm run check
```

`npm run check` runs the syntax checks, all `node:test` files, the six
auth-fence scenarios, and `npm pack --dry-run`; CI runs the same command.
After changing `client.js`, refresh the page so the new client module replaces
the loaded one. Host-half changes (`index.js`, `search.js`) are not re-evaluated
for a linked package (Node caches the module by its real path and HMR only
evicts modules under the profile root): remove + install from a directory whose
path changed, or restart the host.

## Verify

```sh
# route registered and answering (401 without the page's auth cookie is expected)
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3080/dsh-simple-search/version'

# reproducible auth-fence check: real HTTP, throwaway loopback server, fake host services
npm run check:auth   # expects 6/6 and exit 0

# the live client registration
#   cordis_inspect_query Slots.listSubTree root=shell.overlay  → occupant "simple-search"
```

`scripts/verify-auth-fence.mjs` mounts the real handlers and covers the branch a
normal `dsh web` installation cannot reach: no `connection` service at all
(`503 auth-unavailable`), a `null` service, a throwing check (`403`), an
admitting session (`200`), a rejected one (`401`) and a cross-site request
(`403`). It needs neither a running host nor a session cookie.

Manual check: refresh the page, press Shift twice, type `RPC HTTP GET`, and
press Enter on the first hit. Then switch the scope to **Sessions**, search for
part of a chat title, and press Enter to open it (this can cross workspaces).
Finally switch to **This chat**, search for a word from the recent conversation,
and press Enter to jump to that message — thinking/tool text must not appear.
Switching the Conversation view away from Chat should fall back to copy. Open
**Plugins → Simple Search**, switch the *Appearance* card through Light / Dark /
Follow DSH, and reopen the panel to confirm each palette; while *Follow DSH* is
active, switching the DSH theme must update the panel immediately.

The **This chat** scope needs the new host route, so it only works after the host
half is reloaded (renamed-directory reinstall or host restart). A refreshed page
against a stale host answers with a route-not-found error.

## Development

Agent-facing rules, commands, and the module map start at [AGENTS.md](AGENTS.md).
Architecture, security, the reload matrix, and decision records live under
[docs/](docs/); reusable workflows are in `.agents/skills/`.
