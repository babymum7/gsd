# 0033 — Explicit-only refactor and cleanup skills

- **Status:** Accepted
- **Date:** 2026-10-13

## Decision

A skill whose frontmatter carries `disable-model-invocation: true` is explicit-only. `discoverSkillCatalog` leaves it out of the injected catalog, while the plugin bundle and a skills-directory install still ship it. Each host gets its own marker from the skill's files: Claude Code reads `disable-model-invocation: true`, OMP reads `disableModelInvocation: true`, and Codex reads `agents/openai.yaml` with `policy.allow_implicit_invocation: false`. The bootstrap reads such a skill by path only when the user explicitly asks for its job, never through a Skill tool, because Claude Code refuses a model-initiated Skill call for it.

Two explicit-only skills ship:
- `gsd-refactor` measures size, complexity, hard-coding, duplication, hot-path performance, organization, and tests. It writes tool-checkable rules into the repository's own linter config, with names confirmed against the installed tool, and the rest into one `## Code quality` section of `AGENTS.md` that `CLAUDE.md` imports. It sets up GSD where it is missing, and runs a behavior-preserving refactor with characterization tests first.
- `gsd-cleanup` lists junk files, unreferenced files, dead code, and unused dependencies with evidence for one approval. Tracked removals become a plan. Approved untracked or ignored paths are removed by name outside the plan and reported. It never runs `git clean`.

Both work in repositories without GSD and ask the Delivery question in the same approval, then run to the end.

## Rationale

The user wants these jobs only on explicit request. Each host's own flag is the only mechanism that blocks implicit activation there, and keeping them out of the catalog keeps every session's bootstrap cost unchanged. It is not verified that OMP still lets a user invoke a skill marked `disableModelInvocation`. Untracked files such as `.env` and local data cannot be recovered from Git, so their removal needs a name in the approved list.
