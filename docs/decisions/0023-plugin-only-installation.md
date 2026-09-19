# 0023 — Plugin-only installation

- **Status:** Accepted
- **Date:** 2026-09-19

## Decision

GSD installs and uninstalls only through the unified plugin CLI. The repository ships no per-host compatibility installers, does not publish individual skills, hooks, agents, or managed `AGENTS.md` sections, and uninstall delegates only to each host's native plugin command before removing the generated bundle. Claude Code marketplace registration and removal are user-scoped so a same-named marketplace in another scope is never touched. Existing files that look like artifacts from an older install are not inspected or migrated.
