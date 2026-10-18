# 0037 — dsh installs through a marked block of the home patch, with no profiles and no router skill

- **Status:** Accepted
- **Date:** 2026-10-18

## Decision

`gsd install --agent dsh` appends one text block delimited by `# gsd:dsh-hooks begin` and `# gsd:dsh-hooks end` to `$DSH_HOME/cordis.patch.yml` and `gsd uninstall --agent dsh` removes only that block, without parsing YAML. `gsd config` hosts stay `claude|codex|omp`: dsh is only an install agent. The dsh skills are written without the `gsd` router skill.

## Rationale

The home patch is hand-written YAML with comments and model routes that a parse and rewrite would lose, and dsh reads no other user patch file. The dsh `subagent` tool exposes `model`, paired with `provider`, only when `modelSelectionSettings` is on, which defaults to off, so there is nothing for a sub-agent profile to set. The router stands in for a missing hook and states `GSD_SESSION: unset`, which would contradict the bootstrap the hook injects. A spike showed that the `@deepseek-ai/dsh-hooks-claude-code` row fires SessionStart and UserPromptSubmit in both `dsh --profile headless` and `dsh-tui`, so the hook row replaces the router.
