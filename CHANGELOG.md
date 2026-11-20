# Changelog

All notable user-visible changes to `dsh-simple-search`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
`package.json`. Agent-facing process changes are listed too when they affect
how the project is developed.

## [Unreleased]

### Removed

- Claude Code compatibility shims (`CLAUDE.md`, `.claude/skills`). The
  repository targets DSH only: `AGENTS.md` plus `.agents/skills/`.

## [1.3.0] - 2026-11-20

### Added

- **Session title search across workspaces**: a new `Sessions` scope matches
  session titles, workspace directory names and session ids over the page's
  loaded catalog; `Enter` opens the selected chat through `uiWorkspace`,
  switching workspaces when needed.
- **Current-chat content search**: a new `This chat` scope searches the open
  session's human-visible text — human prompts and assistant replies — through
  a new fenced host route `/dsh-simple-search/conversation`. Reasoning/thinking
  blocks, tool calls, tool results, synthetic context and system prompts are
  excluded. `Enter` jumps to the matching message in the Chat view, loading older
  history through the message seq when needed; when no Chat anchor is available
  it falls back to copying the full message.
- `conversation.js`: pure extraction/matching core with its own caps
  (`MAX_CONVERSATION_*`), newest-first hits, bounded one-line excerpts, regex
  and case options; the host caches extraction per log cursor and returns the
  `turn`/`step`/`messageId` identities used for the Chat jump.
- `tests/conversation.test.mjs`, conversation route tests and client scope
  tests; ADR 0004 records why title search is client-side and chat search is
  host-side, and ADR 0005 records the best-effort Chat jump and its copy
  fallback.

### Changed

- The panel now has a scope switcher (`Workspace` / `Sessions` / `This chat`);
  the existing `All` / `Files` / `Text` tabs appear only in the workspace scope.
- Error taxonomy gains `bad-session` (422), `not-found` (404), `unavailable`
  (503) and `timeout` (504).

### Added (agent-facing)

- `AGENTS.md`, `tests/AGENTS.md`, and `CLAUDE.md`/`.claude/skills` links for
  agent-facing development instructions.
- `.agents/skills/` workflows for changing, verifying, and releasing the plugin.
- `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/SECURITY.md`, and
  `docs/decisions/` records for the current design and its security rules.
- `npm run check` and a GitHub Actions workflow that runs the same gate.

### Fixed

- Assistant hits now scroll to the assistant's response row: the jump matches
  `data-chat-anchor-key`, because the reasoning and response flow rows share one
  `data-chat-node-key` and matching that key selected the hidden reasoning row.
- `/dsh-simple-search/version` now reports the `package.json` version instead of
  a hand-written constant that had drifted to `1.0.1`.

## [1.2.1] - 2026-11-19

### Added

- Route tests for the browser-trust fence and a reproducible
  `scripts/verify-auth-fence.mjs` six-scenario check.
- `repository` metadata and bilingual README files.

### Fixed

- Both routes fail closed with `503 auth-unavailable` when the host's Connection
  service is missing or cannot reject requests.

## [1.2.0] - 2026-11-18

### Added

- Light / Dark / Follow DSH appearance choices on the plugin's page, persisted
  in browser `localStorage`.

## [1.1.0] - 2026-11-18

### Added

- Initial release: double-Shift search over file names and workspace text,
  with ripgrep and a bounded fallback walk.
