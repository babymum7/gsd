---
name: gsd-to-plan
description: "Use when converged acceptance criteria must become a created or finalized implementation plan."
hide: true
produces: [plan.md, state.toon]
consumes: [plan.md, state.toon, docs/domain/index.md, docs/domain/<scope>.md, AGENTS.md]
---

# To Plan

Read by `gsd-brainstorming` once acceptance converges or an unbound draft `plan.md` is to be finalized. It writes and validates `plan.md`, binds `state.toon`, and loads `gsd-executing-plans`. This is the sole `plan.md` writer at creation and finalization; after binding the executing owner amends it under `GSD_ROOT/skills/gsd/REFERENCE.md` § Plan amendment. A draft is read only when finalizing; legacy `proposal.md`, `spec.md`, `design.md`, and stale `*.toon` contracts carry no scope and return to `gsd-brainstorming`.

## Base

Read `plan.md` § Base from the work tree, never from convention: run `bun "<GSD_ROOT>/tools/gsd-git.mjs" derive-base` and record the printed branch. `code: detached-head` stops until the user checks out a branch. `code: head-is-wip` stops because another feature holds this work tree: ask the user, recommending a separate `git worktree` or a non-WIP branch they check out to build on that work. See `GSD_ROOT/skills/gsd/REFERENCE.md` § Base derivation and merge target.

## Write plan.md

Write `.scratch/<feature>/plan.md` exactly from [PLAN-GRAMMAR.md](PLAN-GRAMMAR.md). You may start from `bun "<GSD_ROOT>/tools/gsd-contract.mjs" init-plan --path .scratch/<feature>/plan.md --base <branch>`, which refuses to overwrite a plan; replace every `<slot>` and delete optional sections that carry nothing, since the gate rejects a leftover slot.

- Plan complete observable behavior, not layers. Tasks are sequential `T1`…`TN`, order encodes dependencies, and every active criterion occurs in at least one task.
- Pin the highest deterministic fast public seam per criterion; `none` is only for mechanically verified non-behavioral work. Slow checks are Deferred Slow E2E under § Fast TDD and task-loop constraints, never focused task checks.
- Expand → Migrate → Contract needs a caller inventory and a non-atomic migration.
- Several repositories: add `## Repos` with every repository (this one as path `.`), run `derive-base` in each for its Base, and give each task outside this repository a `- **Repo:**` line; `Files` stay relative to that task's repository.
- `Domain Impact` only where a touched repository has `docs/domain/index.md` or the user accepted a bootstrap. Bind the exact shard paths `gsd-domain-modeling` returned to the same task as the semantic code they describe, never to a trailing docs-only task.
- Decision and design records bind to their producing tasks; record-only tasks are allowed.
- Vague checks, unowned or duplicate criteria or paths, contradictory `Domain Impact`, or unresolved decisions go back to `gsd-brainstorming`.

## Validate and bind

Run `bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md`. Only exit 0 with `kind: plan`, the matching feature and base, and the expected task count binds; exit 1 returns to `gsd-brainstorming`, exit 2 corrects invocation.

Then, without an approval prompt, run `bun "<GSD_ROOT>/tools/gsd-state.mjs" set --feature-dir .scratch/<feature> owner=<GSD_SESSION> phase=approved plan_path=.scratch/<feature>/plan.md base_ref=<base> wip_branch=wip/<feature>`; the tool fills `next_action` and `checkpoint_revision` and reads the record back. A fresh binding after Spec escalation overwrites the old one; over a packet another session owns, which the user named, add `--takeover`. Then load `gsd-executing-plans`.
