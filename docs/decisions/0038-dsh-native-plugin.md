# 0038 — dsh loads GSD as a native Cordis plugin instead of a hooks-bridge row

- **Status:** Accepted
- **Date:** 2026-10-18

## Decision

The dsh adapter is a Cordis plugin module that the home patch inserts by absolute path; it injects through `agent.inject` and `agent/pre-step` and needs no `@deepseek-ai/dsh-hooks-claude-code` row or `hooks/dsh.json`. The marked block of `$DSH_HOME/cordis.patch.yml` now holds one `- insert:` row `id: gsd` whose `name` is the bundle's `adapters/dsh/gsd-context.mjs`, and an install replaces the earlier block in place. The plugin builds its frozen `{ role, content, source, id }` user message itself, as `dsh-tmux-context` does, and imports only Node built-ins and the bundle's `lib/`.

This supersedes the hooks-bridge row of 0037. The marked block, the no-profile, and the no-router decisions of 0037 still hold.

## Rationale

dsh 0.2.0-rc.2 announces `agent/created` only with `startup` and `resume`, so the hooks bridge never fired SessionStart after compaction and the capsule never came back. The bridge exposes no compaction event, and one in-process plugin keeps a single injection path without spawning `bun` on every prompt. A live spike showed that an inserted row whose `name` is an absolute module path loads, because dsh converts absolute names in `insert` rows to file URLs, that its `session/event` listener sees `compaction/end`, and that a message appended in `agent/pre-step` reaches the model. A module loaded from the bundle cannot resolve `@deepseek-ai` packages and dsh runs under node, so the plugin imports nothing from dsh.
