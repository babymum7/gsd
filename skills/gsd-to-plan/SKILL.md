---
name: gsd-to-plan
description: "Use when converged acceptance criteria must become a created or finalized implementation plan."
produces: [plan.md, state.toon]
consumes: [plan.md, state.toon, docs/domain/index.md, docs/domain/<scope>.md, AGENTS.md]
---

## Dispatch contract
Canonical row: `GSD_ROOT/skills/gsd/REFERENCE.md` § Visible skill mandatory-use matrix.
- Role: owner
- Intent: create or finalize the canonical `plan.md` after acceptance criteria converge, with `Domain Impact` where the repository opts into domain docs
- Do-not-load: open design decisions; Nano edits
- Transition: on `validate-plan` success use `gsd-state.mjs set` to write `state.toon` atomically with the invocation this skill's binding step names, never the `write` tool, then load `gsd-executing-plans` without a prompt

# To Plan

> **Invocation guard** — load after `gsd-brainstorming` converges or when validated unfinalized plan state requires finalization. Select an Invocation Mode from explicit intent and entry context before validating only that row’s Required artifacts. Apply `GSD_ROOT/skills/gsd/REFERENCE.md` § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Initial converged creation | — | `state.toon` | `plan.md`; `state.toon` | — |
| Resume/finalize | `plan.md` | `state.toon` | `plan.md`; `state.toon` | Stop and load `gsd-brainstorming` to recover the missing contract before recreating `plan.md`; never synthesize a contract or read legacy pre-binding TOON |

## Intake

In `Resume/finalize` mode, read canonical `.scratch/<feature>/plan.md`.
- Parse and validate it under `GSD_ROOT/skills/gsd/REFERENCE.md` § Canonical Markdown contract; legacy `proposal.md`, `spec.md`, or `design.md` is rejected.
- Stale pre-binding `proposal.toon`, `spec.toon`, `design.toon`, and `plan.toon` cannot provide missing scope, ACs, task order, or recovery.
- In `Initial converged creation` mode, optional draft state/context is consumed without reading an existing plan.

Write `Domain Impact` only when a touched repository has `docs/domain/index.md` or the user accepted a domain bootstrap; otherwise omit the section. When present, consume its fields in exact order:
`Classification`, `Contexts`, `Documentation`, `Broad bootstrap`, `Evidence`.
- `classification=none` requires `contexts=none`, `documentation=none`, and concrete no-impact evidence; every other classification requires sorted context slugs and documentation actions.
- Bind exact reserved domain-documentation paths returned by `gsd-domain-modeling` to the same tasks as their implementing code; the plan owns target behavior until implementation, while existing domain prose remains current-production-only.
- `Broad bootstrap` is `not-offered` when the domain index exists; for an accepted bootstrap it records the user's `selected` or `declined` choice. Never reconstruct paths by scanning docs or dirty files.
## Write plan.md

Write `.scratch/<feature>/plan.md` exactly from [PLAN-GRAMMAR.md](PLAN-GRAMMAR.md). Writing may start by scaffolding the skeleton via `bun "<GSD_ROOT>/tools/gsd-contract.mjs" init-plan --path .scratch/<feature>/plan.md --base <branch>`, which refuses to overwrite an existing `plan.md`. The scaffold defaults Domain Impact to `none`; fill the slots and delete every optional section that carries nothing before the `validate-plan` gate.

This skill is the sole writer at creation and finalization; after binding the executing owner amends it in place under § Plan amendment. Required: Feature, Base, one concrete `GIVEN/WHEN/THEN` Scenario per active criterion (Outcome, Action, and Expected are optional), and structured tasks with unique path operation/intents, focused checks, and pending status. Add Summary, Context, `Domain Impact`, Scope, Decisions, Invariants, Non-goals, or Interfaces only when they carry information; `Domain Impact` is needed whenever the change touches domain semantics.

When the work spans several repositories, add `## Repos` with every repository (this one as path `.`), run `derive-base` in each for its Base, and give each task outside this repository a `- **Repo:**` line; `Files` stay relative to that task's repository. A part of a larger feature (the Parts section of `gsd-brainstorming`) is planned as its own feature `<feature>-pN`.

Read `plan.md` § Base from the work tree, never from convention: before `wip/<feature>` exists run `bun "<GSD_ROOT>/tools/gsd-git.mjs" derive-base` and record the printed branch, so a linked worktree records its own branch. Exit 1 with `code: detached-head` stops packet creation until the user checks out a branch, because a commit oid cannot receive a merge.
`code: head-is-wip` stops it because another feature holds this work tree: ask the user, recommending a separate `git worktree`, or a non-WIP branch they check out to build on that work. Never read the base by hand with `git rev-parse --abbrev-ref HEAD`, which prints the literal `HEAD` when detached. See `GSD_ROOT/skills/gsd/REFERENCE.md` § Base derivation and merge target.

Before binding, run `bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md`; drafts need no validation. Only exit 0 with `kind: plan`, the matching feature and base, and expected task count reaches execution. Exit 1 returns malformed authority to Spec escalation back to `gsd-brainstorming`; exit 2 corrects invocation.

Tasks are sequential `T1`…`TN`; order encodes dependencies. Every active AC occurs in at least one task. A task spanning pinned ACs requires identical seam, test path, and lower-seam reason. For non-`none` Domain Impact, bind every exact affected `docs/domain/<scope>.md`, any required `docs/domain/index.md`, and canonical `AGENTS.md` upsert to the same owning task as semantic code; never create trailing documentation-only tasks. The validator rejects shard owners without semantic code changes.

Durable decision and design records (`docs/decisions/NNNN-slug.md`, `docs/design/NNNN-slug.md`) bind to their producing tasks; record-only tasks changing no semantic code are allowed. See `GSD_ROOT/skills/gsd/REFERENCE.md` § Durable decision and design records.

Plan complete observable behavior, not layers.
- Expand → Migrate → Contract requires caller/reference inventory and non-atomic migration.
- Pin the highest deterministic fast public seam; never use `none` for observable behavior.
- `none` is only for mechanically verified non-behavioral work.
- Browser/GUI, external-network, long-lived, large-fixture, and material-cost checks are Deferred Slow E2E, not focused task checks.
- Vague checks, unowned/duplicate ACs/paths, missing references, contradictory Domain Impact, or unresolved decisions return to Spec escalation back to `gsd-brainstorming`.
## Auto-execution handoff
The parser accepts only structured task blocks. This planner single-writes exactly that grammar; path-only task forms or malformed fields return to Spec escalation back to `gsd-brainstorming` instead of receiving a binding. A plan without `Domain Impact` is valid and makes no domain claim.


Planning is the last interactive step of discuss. Without approval prompts or menus: once `validate-plan` exits 0, atomically write canonical `schema:v0.0.3` `state.toon` with `bun "<GSD_ROOT>/tools/gsd-state.mjs" set --feature-dir .scratch/<feature> owner=<GSD_SESSION> phase=approved plan_path=.scratch/<feature>/plan.md base_ref=<base> wip_branch=wip/<feature>` (derived defaults fill `next_action=start/continue task` and `checkpoint_revision`).
Read it back and verify binding before execution. A fresh binding after Spec escalation supersedes older binding state by atomic overwrite without numbered handoff history; over a packet another session owns, which the user named, add `--takeover`. Never leave partial state bytes.
Then load `gsd-executing-plans` without another prompt.
## Contextual disclosure

Use `GSD_ROOT/skills/gsd/REFERENCE.md` § Contextual disclosure templates. Inline firing appends nothing.
