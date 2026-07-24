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

Perform one full parse and binding check at execution entry or resume: validate canonical `schema:v3` and `.scratch/<feature>/plan.md` under [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Canonical Markdown contract. Reject legacy proposal/spec/design files, numbered handoffs, attempts, reload manifests, and result markers. At ordinary task selection consume the retained validated task slice; repeat full parsing only at resume, terminal entry, and pre-squash. Never reconstruct scope from memory.

Dual-read exact already-approved hash-bound legacy task blocks only to finish their binding; execution never creates or approves one.

Select the next task in strict heading order from bound state and Git evidence, never mutable plan Status. Work on approved `wip/<feature>` and follow [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics. Runtime state cannot modify intent; missing, invalid, altered, or additional `plan.md` is Spec escalation. Never rewrite the approved Markdown plan.

## Per-task loop

1. Select only the next task in strict heading order and verify every structured file path, operation, intent, active AC, interface pin, focused check, invariant, non-goal, and source fact from `plan.md`.
2. Build and retain a validated task slice from the plan: task identity, structured file operations and intents, verbatim active criteria, lossless ordered Decisions, constraints, targets, focused checks, and safety facts. A "None." decisions block in the plan is represented as an explicit empty decisions marker in the slice. Do not write task-attempt TOON files, status into `plan.md`, or synthetic task briefs. Exact already-approved path-only legacy task blocks remain readable only to finish their bound feature; newly approved plans use the canonical structured form.
3. The current top-level session owner consumes the validated slice and implements or repairs the task inline. GSD dispatches no executor, implementation worker, generic child task, repair task, or parallel lifecycle work. Every observable task loads `gsd-tdd` and performs direct RED before implementation, GREEN after implementation, then refactor after green. Run deterministic local unit, integration, CLI, contract, or fast acceptance checks only; browser, resource-heavy, slow, whole-acceptance, and E2E suites stay outside the task loop.
4. The task boundary is green focused evidence, recorded only in reporting and transcripts. A red focused check or explicit self-verification failure re-enters this task's bounded inline repair. First checkpoint `next_action=start/continue task`, repair source-first under `gsd-executing-plans`, `gsd-handoff`, and `gsd-tdd`, then rerun only checks invalidated by the repair. Load no terminal verifier until every task is green.
5. Commit only green task-owned changes on WIP. Atomically update `state.toon` with `last_green_task`, `last_green_commit`, and `next_action=start/continue task`; never rewrite approved Markdown. Task `Tn+1` begins only from the committed green checkpoint of `Tn`. Source mutations never overlap task/repair or Deferred Slow E2E.

In `Milestone plan execution`, keep the authoritative ledger byte-for-byte read-only throughout the per-task loop. Revalidate the selected milestone is still the matching first-pending row before every task and pass that identity to `gsd-verify`; execution never marks a row `done` or deletes the ledger.

Only after every non-superseded task and Fast TDD Check is green, atomically set `next_action=enter terminal verification/repair` and load `gsd-verify`. The session owner then performs deterministic cumulative conformance before Deferred Slow E2E.

## Auto-pilot

Approval is the last normal planning prompt. During execution report factual progress and blockers only; do not open unrelated menus or confirmations. Manual pause or automatic context-pressure writes `phase=paused` and preserves the interrupted executable `next_action`. A hard blocker sets `next_action` to `Discussion/Spec-escalation` with pause/block `phase`. Both use atomic `state.toon` writes via `gsd-handoff`.
