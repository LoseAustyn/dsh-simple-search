# Changelog

All notable user-visible changes to `dsh-simple-search`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
`package.json`. Agent-facing process changes are listed too when they affect
how the project is developed.

## [Unreleased]

### Added

- `AGENTS.md`, `tests/AGENTS.md`, and `CLAUDE.md`/`.claude/skills` links for
  agent-facing development instructions.
- `.agents/skills/` workflows for changing, verifying, and releasing the plugin.
- `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/SECURITY.md`, and
  `docs/decisions/` records for the current design and its security rules.
- `npm run check` and a GitHub Actions workflow that runs the same gate.

### Fixed

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
