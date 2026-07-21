---
name: gsd-executing-plans
description: "Use when a valid approved GSD plan and resumable state.toon have pending work, including resuming active planned implementation. Do not use without the bound plan artifacts. Composes with gsd-tdd, gsd-diagnosing-bugs, gsd-handoff, and gsd-verify."
triggers: validated approved plan and state.toon with pending or in-progress work
produces: [state.toon, docs/gsd/<feature>/milestones.md]
consumes: [plan.md, state.toon, docs/gsd/<feature>/milestones.md]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Do-not-load: missing bound plan/state; inventing authority
- Transition: after all tasks and Fast TDD Checks are green load `gsd-verify`

# Executing Plans

> **Invocation guard** — load only for validated approved plan state selected automatically or by `gsd-handoff`. Select the Invocation Mode before validating its Required artifacts; missing Optional state is normal. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Normal plan execution | `plan.md`; bound `state.toon` | authorized ledger | `state.toon`; authorized ledger | Stop as Spec escalation; never synthesize source state or dispatch |
| Milestone plan execution | Normal required state; authoritative ledger | — | `state.toon` | Missing source/binding is Spec escalation; missing ledger evidence is a Blocker |

## Intake and immutable contract

Validate the current `state.toon`, then read `plan.md` from `.scratch/<feature>/`, and perform one full parse and binding check at execution entry/resume. Any legacy `proposal.md`, `spec.md`, or `design.md` is rejected. Reject numbered handoffs, task-attempt files, reload manifests, and result markers as authority. Instead of repeated full validation, follow the approved phase-boundary semantic-validation and digest-guard model. Repeat this full parse and binding check only at execution entry/resume. Do not compare plan digest at ordinary task dispatch. The parent builds the task brief directly from the validated plan; The persistent executor, reviewer, or any launched OMP child agents consume the validated task slice (including the lossless ordered Decisions) without independently reparsing `plan.md`. The executor may fan out task attempts concurrently through OMP child agents if and only if the complete safe fan-out gate is satisfied: (1) attempts are dependency-independent, (2) attempts target path-disjoint files, (3) attempts consume only parent-created validated task slices, (4) safe isolation and model evidence are present, and (5) GSD performs deterministic integration of the results. If any proof of these conditions is absent, GSD must fall back to sequential task execution. If the independent reviewer capability or model configuration is unavailable, GSD must fail closed immediately.

Read `plan.md` task headings in order. Use only valid bound `state.toon` plus Git evidence to determine which non-superseded task is next; the approved Markdown Status field is never mutated after approval and cannot itself prove completion. Work on `wip/<feature>` from the approved Base. Preserve the existing Git/base/WIP/conflict, milestone, and scratch-cleanup contracts in [../gsd/REFERENCE.md](../gsd/REFERENCE.md); runtime state cannot modify the approved Markdown contract. Missing, invalid, altered, or additional `plan.md` is a Spec escalation.

## Per-task loop

1. Select the next task and verify every task-owned path, active AC, interface pin, focused check, invariant, non-goal, and source facts from `plan.md`.
2. Build a validated task slice from the plan: task identity, source paths/anchors, verbatim active criteria, lossless ordered Decisions, constraints, targets, focused checks, and safety facts. A "None." decisions block in the plan is represented as an explicit empty decisions marker in the slice. Do not write task-attempt TOON files; the plan plus `state.toon` are sufficient. Never rewrite the approved Markdown plan.
3. Immediately before any task work dispatch, execution bootstraps a hub-revivable gsd-executor agent on the bound executor model (from `modelRoles.gsdExecutor`), verifies the actual model, and reuses a reachable process-local identity or recreates from the bound selector. Live agent identities and generation counters are not persisted in `state.toon`. Then dispatches the persistent gsd-executor agent with the bound executor model and direct-root TDD instructions. GSD reuses its OMP agent identity (gsd-executor / gsd-executor-N) through `hub` for task and repair turns. Every observable task loads `gsd-tdd` and follows direct-root TDD: RED before implementation, GREEN after implementation, then refactor after green. Task acceptance deferral is removed; the terminal verifier solely owns acceptance/E2E.
4. Do not dispatch `gsdReviewer` per task. The task boundary is based on executor fast-green evidence: the gsd-executor agent's Fast TDD Checks must be green and recorded in reporting and transcripts only. Critical/Important self-verification failures or red focused checks re-enter the bounded task repair loop. If needed for red focused checks, the parent updates `state.toon` for the `task repair` transition with `next_action` set to `start/continue task` before directing the persistent gsd-executor agent to perform the repair. Task repair is executor-only: derive only `gsd-executing-plans`, `gsd-handoff`, and `gsd-tdd`; do not load `gsd-verify` and do not dispatch `gsdReviewer`. After any repair, the gsd-executor agent reruns only focused checks invalidated by its repair, records replacement green evidence for each invalidated check, and reports replacement green evidence to the parent for an executor-only focused-check decision.
5. Commit only green task-owned changes on the WIP branch. Record completion by atomically updating `state.toon` with the completed task (`last_green_task` / `last_green_commit`) and `next_action` set to `start/continue task`; never rewrite the approved Markdown plan. The parent retains task order, Git commits, state checkpoints, and terminal transition. Tasks remain sequential on the shared worktree.

In `Milestone plan execution`, keep the authoritative ledger byte-for-byte read-only throughout the per-task loop. Revalidate that the selected milestone is still the matching first-pending row before every dispatch and pass that identity to `gsd-verify`; execution never marks a row `done` or deletes the ledger.

After every non-superseded task and green Fast TDD Checks, update `state.toon` for terminal entry with `next_action` set to `enter terminal verification/repair`; invoke `gsd-verify`. There is no terminal pre-E2E visual pause. Execution stays automatic through Fast TDD, whole-diff review, and Deferred Slow E2E. Explicit retain or archive-and-delete may be recorded in `cleanup_preference` before final review; otherwise scratch auto-deletes after green merge. Scope/AC/interface/invariant changes escalate to `Discussion/Spec-escalation`.

## Auto-pilot

Approval is the last normal planning prompt. During execution report factual progress and blockers only; do not open unrelated menus or confirmations. A post-approval prototype request is Spec escalation, not a runtime visual gate. A manual pause or automatic context-pressure writes `phase=paused` and preserves the exact interrupted executable `next_action` before returning/stopping. A hard blocker writes `next_action` set to `Discussion/Spec-escalation` and `phase` recording the pause/block transition (e.g., `phase=paused`). Both cases use atomic `state.toon` writes via `gsd-handoff`.
