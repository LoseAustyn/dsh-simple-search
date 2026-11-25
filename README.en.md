# Simple Search（简单搜索）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Supported DSH versions: 0.2.2-rc.2+](https://img.shields.io/badge/DSH-0.2.2--rc.2%2B-4d6bfe)](https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions)
[![Open Plugin Market](https://img.shields.io/endpoint?url=https%3A%2F%2Fdshopen.org%2Fbadge%2Fdsh-simple-search.json%3Flang%3Den)](https://dshopen.org/plugins/dsh-simple-search/)

[简体中文](README.md)

A global search plugin for DSH Web. Press `Shift` twice anywhere on the page to open a JetBrains-style Search Everywhere dialog with three scopes:

- **Workspace** — Searches file names and file contents in the current workspace, with `All`, `Files`, and `Text` tabs.
- **Sessions** — Searches existing chats across all workspaces (matching session titles, workspace folder names, and session IDs). Press `Enter` to open the selected chat, switching workspaces automatically if needed.
- **This chat** — Searches messages in the active conversation. Only visible conversation text (your prompts and the assistant's replies) is indexed; reasoning blocks, tool calls/results, and system prompts are skipped.

Opening the panel selects your previous query so you can type or paste right over it. File results are grouped by path with matched spans highlighted, and the footer displays the workspace root, hit counts, active search engine, and elapsed time.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Shift` × 2 | Open the search panel (two clean `Shift` taps within 400 ms; holding `Shift` or typing uppercase letters won't trigger it) |
| `Tab` / `Shift+Tab` | Cycle through `Workspace` → `Sessions` → `This chat` while the search input is focused |
| `↑` / `↓` | Move through results |
| `Enter` | Open the selected file, switch to the selected session, or jump to the selected chat message |
| `Alt+Enter` | Insert the selected file as a native `@path` mention into the active chat input |
| `Esc` | Close the panel |

Panel shortcuts are active only while the dialog is open, leaving `Shift+Enter` and other composer shortcuts untouched.

## Installation

This plugin has zero runtime dependencies — no `npm install` is needed.

- **Open Plugin Market**: Follow the install instructions on the [DSH Open Plugin Market](https://dshopen.org/plugins/dsh-simple-search/).
- **From a local checkout**: Clone or download this repository, then either pick the `simple-search` folder under **Plugins → Add plugin** in DSH Web, or run:
  ```sh
  dsh plugin --profile web add /path/to/simple-search
  ```
  Restart DSH once if you installed via the CLI.

## Features

### Workspace File & Text Search

- **Dual engine**: Full-text search uses ripgrep when available (`@vscode/ripgrep` bundled with DSH, `rg` on `PATH`, or `DSH_SIMPLE_SEARCH_RG`), and falls back to a bounded Node.js directory walk when ripgrep isn't present.
- **Matching & ranking**: Supports case-sensitive (`Aa`) and regex (`.*`) toggles. File lists are cached for 10 seconds while typing and ranked by exact basename → basename substring → path substring → fuzzy subsequence (so `htexec` matches `http-executor.ts`). The `All` tab returns both file-name and text matches in a single request.
- **Ignores `.gitignore` by design**: Multi-repo workspaces often gitignore sub-repositories at the root. To keep sub-repos searchable, the plugin runs with `--no-ignore-vcs` and instead excludes heavy directories explicitly (`.git`, `node_modules`, `dist`, `.venv*`, caches, `.dsh-memory`).
- **Open or copy**: When `better-sidebar` is installed, clicking a result or pressing `Enter` opens the file directly in the side-card editor (jumping to the exact line for text hits). Without it, the plugin copies `path` or `path:line` to the clipboard and closes.
- **`@` file mentions**: Highlight a file or text match and press `Alt+Enter` to insert a native DSH `@path` reference (`@"path with spaces"` when needed) into the active chat composer, closing the panel and returning focus to the input. If no chat is open or the draft isn't editable, the `@path` text is copied instead.

### Session & Conversation Search

- **Cross-workspace session titles**: Matches against the session catalog already loaded in the browser — no server round-trip required. Empty placeholder sessions and subagent child sessions are filtered out, with the most recently updated chats listed first.
- **Full chat history**: **This chat** queries the committed session log on the host, reaching older messages outside the currently rendered scroll window (capped at 5,000 messages, 200 hits, and an 8-second timeout). Pressing `Enter` loads earlier history if needed and scrolls to the message in the Chat view, or copies the full message text when no chat anchor is available.

### Appearance

Under **Plugins → Simple Search** → *Appearance*, choose **Light**, **Dark**, or **Follow DSH** (saved in `localStorage`). *Follow DSH* tracks DSH's active theme and OS color-scheme changes in real time, updating the panel palette, caret, selection, and scrollbars together.

## Security

The plugin registers three read-only local routes: `/dsh-simple-search/version`, `/dsh-simple-search/search`, and `/dsh-simple-search/conversation`.

- **Fail-closed authentication**: Every route sits behind DSH's `connection` auth and same-origin checks, requiring the browser page's own auth cookie. If the host `connection` service is missing or unable to verify requests, the plugin refuses to mount or responds with `503 auth-unavailable` rather than serving workspace content unauthenticated.
- **Scoped access**: File searches are restricted to registered workspaces or the calling session's working directory. Conversation content is read strictly through the host's `sessionQuery` service rather than opening session log files directly.

See [docs/SECURITY.md](docs/SECURITY.md) for the full threat model and rejection matrix.

## Development & Verification

| Path | Purpose |
|---|---|
| `index.js` | Node host entry: read-only routes, origin/auth checks, workspace root resolution |
| `search.js` | File search core: ripgrep runner, fallback walker, exclusion list, matcher & file ranking |
| `conversation.js` | Conversation search core: visible-message extraction, thinking/tool filtering, snippet generation |
| `client.js` | Browser entry: search dialog, double-`Shift` listener, scope switching, `@` mentions, appearance card |
| `tests/*.test.mjs` | `node:test` suites covering search, conversation extraction, route auth, and client behavior |
| `scripts/verify-auth-fence.mjs` | 6-scenario loopback HTTP auth check against a throwaway local server (no running DSH needed) |

Run the full check suite (also used in CI):

```sh
npm run check        # syntax check + unit tests + 6 auth scenarios + npm pack dry-run
npm test             # unit tests only
npm run check:auth   # loopback HTTP auth-fence scenarios (expects 6/6)
```

Reloading changes locally:

- **Client (`client.js`)**: Refresh the browser page to pick up edits.
- **Host (`index.js`, `search.js`, `conversation.js`)**: Node caches `link:`-installed ESM modules by real path, so an in-place reinstall won't reload host code. Restart DSH or reinstall from a renamed directory (note that **This chat** requires `/dsh-simple-search/conversation` on the host and will report route-not-found until the host reloads).

See [docs/](docs/) ([ARCHITECTURE.md](docs/ARCHITECTURE.md), [DEVELOPMENT.md](docs/DEVELOPMENT.md), [decisions/](docs/decisions/)) for architecture notes, reload rules, and ADRs, and [AGENTS.md](AGENTS.md) for agent-oriented contributor guidelines.
