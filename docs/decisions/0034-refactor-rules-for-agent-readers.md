# 0034 — Refactor rules serve agent readers and land as one base commit

- **Status:** Accepted
- **Date:** 2026-10-13

## Decision

`gsd-refactor` writes its rules for agents as the only readers and editors of the code and of every file the run writes; the owner only runs a few commands by hand, such as a dev server or a manual test. Rules favor fast search and small context: small single-purpose files, names a search finds, one owner per concern. Each rule holds for every language in the repository, and a check only one language needs goes into that language's linter config. The `## Code quality` section also names the commands the owner runs by hand, which keep their names and behavior, and states that every commit on the base branch passes all checks and can deploy.

A refactor with several parts runs them on an integration branch that merges into the base once with `--no-ff`, so the base's first-parent history gains one commit that passes every check. GSD does not squash.

## Rationale

The owner of a pet-game run said they no longer read code by hand, only start a server to test, want rules that apply to every language, and want few deployable commits on the main branch. Agent-oriented rules cut the context each later task spends finding code, and a single merge commit keeps every first-parent commit on the base deployable while the part commits stay reachable for bisecting.
