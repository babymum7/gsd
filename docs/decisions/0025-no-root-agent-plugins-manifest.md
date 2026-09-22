# 0025 — No root Agent Plugins manifest

- **Status:** Accepted
- **Date:** 2026-09-22

## Decision

The generated plugin bundle ships no root `plugin.json`. Each host consumes its own native manifest: Claude Code reads `.claude-plugin/plugin.json`, Codex reads `.codex-plugin/plugin.json`, and OMP reads `package.json`. A root Agent Plugins (`https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`) `plugin.json` must never be written alongside them: codex prefers a root `plugin.json` over `.codex-plugin/plugin.json` when resolving a plugin manifest, and codex 0.155 skips hook registration entirely for AgentPlugin-format local plugins — SessionStart/UserPromptSubmit bootstrap hooks then never load. Codex hook trust is recorded per hook in the user's `hooks.state` (key `gsd@gsd-local:hooks/codex.json:<event>:<group>:<handler>`), matching the hash codex computes over the normalized hook identity, so trusted hooks run without `--dangerously-bypass-hook-trust`.

Verified live on all three hosts with everyday prompts: new-feature prompts read `gsd-brainstorming` as the first visible action, review prompts read `gsd-verify`, unlocated-bug prompts read `gsd-diagnosing-bugs`, and read-only or nano prompts take no skill read.
