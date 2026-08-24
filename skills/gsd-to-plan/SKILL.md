---
name: gsd-to-plan
description: "Use when converged acceptance criteria must become a created or finalized implementation plan."
produces: [plan.md, state.toon]
consumes: [plan.md, state.toon, docs/domain/index.md, docs/domain/<scope>.md, AGENTS.md, docs/gsd/<feature>/milestones.md]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Do-not-load: open design decisions; Nano edits
- Transition: on `validate-plan` success write state fields to `.scratch/<feature>/.state-input.json`, then use `bun "<GSD_ROOT>/tools/gsd-state.mjs" write-state --feature-dir .scratch/<feature> --json-file .scratch/<feature>/.state-input.json` to write `state.toon` (never the `write` tool directly); delete `.state-input.json` after the CLI succeeds or fails. Then load `gsd-executing-plans` without a prompt

# To Plan

> **Invocation guard** — load after `gsd-brainstorming` converges or when validated unfinalized plan state requires finalization. Select an Invocation Mode from explicit intent and entry context before validating only that row’s Required artifacts. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Initial converged creation | — | `state.toon`; `docs/gsd/<feature>/milestones.md` | `plan.md`; `state.toon` | — |
| Resume/finalize | `plan.md` | `state.toon`; `docs/gsd/<feature>/milestones.md` | `plan.md`; `state.toon` | Stop and load `gsd-brainstorming` to recover the missing contract before recreating `plan.md`; never synthesize a contract or read legacy pre-binding TOON |

## Intake

In `Resume/finalize` mode, read canonical `.scratch/<feature>/plan.md`.
- Parse and validate it under [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Canonical Markdown contract; legacy `proposal.md`, `spec.md`, or `design.md` is rejected.
- Stale pre-binding `proposal.toon`, `spec.toon`, `design.toon`, and `plan.toon` cannot provide missing scope, ACs, task order, or recovery.
- In `Initial converged creation` mode, optional draft state/context is consumed without reading an existing plan.

Consume converged `Domain Impact` fields in exact order:
`Classification`, `Contexts`, `Documentation`, `Broad bootstrap`, `Evidence`.
- `classification=none` requires `contexts=none`, `documentation=none`, and concrete no-impact evidence; other classifications require sorted context slugs and documentation actions.
- Bind exact reserved domain-documentation paths returned by `gsd-domain-modeling` to the same tasks as their implementing code; the plan owns target behavior until implementation, while existing domain prose remains current-production-only.
- `Broad bootstrap` must be `not-offered` when the domain index exists; when absent, record user `selected` or `declined` choice after mandatory paths are set. Never reconstruct paths by scanning docs or dirty files.
## Write plan.md

Write `.scratch/<feature>/plan.md` exactly from [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Packet grammar. This skill is the sole writer at creation and finalization; after binding the executing owner amends it in place under § Plan amendment. Use canonical section order, exact `Domain Impact`, concrete Outcome/Action/Expected criteria, ordered Decisions, one public interface pin per active criterion, optional Publication, and structured tasks with unique path operation/intents, focused checks, and pending status.

Read `plan.md` § Base from the work tree, never from convention: before `wip/<feature>` exists run `bun "<GSD_ROOT>/tools/gsd-git.mjs" derive-base` and record the printed branch, so a linked worktree records its own branch. Exit 1 with `code: detached-head` stops packet creation until the user checks out a branch, because a commit oid can hold no squash. Never read the base by hand with `git rev-parse --abbrev-ref HEAD`, which prints the literal `HEAD` when detached. See [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Base derivation and merge target.

After every write or revision, run `bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md`. Only exit 0 with `kind: plan`, the matching feature, exact source `sha256`, and expected task count reaches execution. Exit 1 returns malformed authority to Discussion; exit 2 corrects invocation. Use the returned hash for plan binding and never calculate a competing interpretation.

Tasks are sequential `T1`…`TN`; order encodes dependencies. Every active AC occurs exactly once across tasks. A task spanning ACs requires identical seam, test path, and lower-seam reason. For non-`none` Domain Impact, bind every exact affected `docs/domain/<scope>.md`, any required `docs/domain/index.md`, and canonical `AGENTS.md` upsert to the same owning task as semantic code; never create trailing documentation-only tasks. The validator rejects shard owners without semantic code changes.

Durable decision and design records (`docs/decisions/NNNN-slug.md`, `docs/design/NNNN-slug.md`) bind to their producing tasks; record-only tasks changing no semantic code are allowed. See [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Durable decision and design records.

Plan complete observable behavior, not layers.
- Expand → Migrate → Contract requires caller/reference inventory and non-atomic migration.
- Pin the highest deterministic fast public seam; never use `none` for observable behavior.
- `none` is only for mechanically verified non-behavioral work.
- Browser/GUI, external-network, long-lived, large-fixture, and material-cost checks are Deferred Slow E2E, not focused task checks.
- Vague checks, unowned/duplicate ACs/paths, missing references, contradictory Domain Impact, or unresolved decisions return to Discussion.
## Auto-execution handoff
The parser accepts only structured task blocks carrying canonical `Domain Impact`. This planner single-writes exactly that grammar; path-only task forms, missing Domain Impact, or malformed fields return to Discussion instead of receiving a binding.


Planning is the last interactive step of discuss. Without approval prompts or menus: once `validate-plan` exits 0, immediately load `gsd-handoff` in `Execution state write` mode and atomically write canonical `schema:v4` `state.toon` with plan path/hash, `phase=approved`, no completed task, base/WIP identity, canonical preferences, checkpoint revision, and `next_action` set to `start/continue task`.
Read it back and verify binding before execution. A fresh binding after Spec escalation supersedes older binding state by atomic overwrite without numbered handoff history. Never leave partial state bytes.
Then load `gsd-executing-plans` without another prompt. Scratch cleanup defaults to automatic delete after green merge; retain or archive-and-delete is recorded only when selected during discuss without reopening planning.
## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Inline firing appends nothing.
