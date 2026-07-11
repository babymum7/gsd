---
name: gsd-executing-plans
description: Internal GSD sub-skill (routed via /gsd). Executes approved Markdown plan tasks with immutable source binding, JIT runtime attempts, review, repair, and terminal verification.
triggers: approved Markdown plan exists, pending/in-progress (gsd Route 3)
produces: [handoff-<n>.toon, docs/gsd/<feature>/milestones.md, .scratch/<feature>/tasks/<Tn>/a<N>.toon]
consumes: [proposal.md, spec.md, design.md, plan.md, handoff-<n>.toon, docs/gsd/<feature>/milestones.md]
---

# Executing Plans

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Select the Invocation Mode before validating its Required artifacts; missing Optional state is normal. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Normal plan execution | `proposal.md`; `spec.md`; `plan.md`; bound `handoff-<n>.toon` | `design.md`; authorized ledger | JIT attempt; `handoff-<n>.toon`; authorized ledger | Stop as Spec escalation; never synthesize source state or dispatch |
| Milestone plan execution | Normal required state; authoritative ledger | `design.md` | JIT attempt; `handoff-<n>.toon` | Missing source/binding is Spec escalation; missing ledger evidence is a Blocker |

## Intake and immutable contract

Select and validate the highest-numbered handoff, then read the complete Markdown packet from `.scratch/<feature>/`, parse it under [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Canonical Markdown contract, and compare all live source bytes to that active source-set SHA-256 binding. Never fall back to an older handoff. Repeat this check on every handoff/resume, before dispatch, after repair, and before terminal verification. Missing, invalid, altered, or additional source is a Spec escalation. Do not infer intent from legacy pre-approval TOON; it is stale and non-authoritative.

Read `plan.md` task headings in order. Use only valid bound handoff/attempt/runtime evidence to determine which non-superseded task is next; the approved Markdown Status field is never mutated after approval and cannot itself prove completion. Work on `wip/<feature>` from the approved Base. Preserve the existing Git/base/WIP/conflict, milestone, result-marker, and scratch-cleanup contracts in [../gsd/REFERENCE.md](../gsd/REFERENCE.md); those runtime artifacts cannot modify the approved Markdown contract.

## Per-task loop

1. Select the next task and verify every task-owned path, active AC, interface pin, focused check, invariant, non-goal, and source digest from the approved packet.
2. Immediately before dispatch, write `.scratch/<feature>/tasks/<Tn>/a<N>.toon`; fsync, close, and read it back. The attempt records task/attempt identity, source paths/hashes/anchors, verbatim active criteria, constraints, targets, focused checks, and safety facts. Bind its digest for implementer, reviewer, and fixer. Never mutate or reuse it as authoring input.
3. Implement only owned task scope. Run the focused test and applicable runnable acceptance check. A task can defer acceptance only to one named later task/gate that makes the complete behavior observable.
4. Review the diff against the same attempt digest and Markdown source binding. Critical/Important findings or red checks re-enter the bounded task repair loop; a changed requirement is a Spec escalation, not an implementation fix.
5. Commit only green task-owned changes on the WIP branch. Record completion by writing a fresh immutable `handoff-<n>.toon` with the completed task and next action; never mutate the attempt or rewrite the approved Markdown plan. Continue in task order.

In `Milestone plan execution`, keep the authoritative ledger byte-for-byte read-only throughout the per-task loop. Revalidate that the selected milestone is still the matching first-pending row before every dispatch and pass that identity to `gsd-verify`; execution never marks a row `done` or deletes the ledger.

After every non-superseded task is done, invoke `gsd-verify`.

## Auto-pilot

Approval is the last prompt. During execution report factual progress and blockers only: no menus, confirmations, visual-review offers, or manual merge. A hard blocker preserves evidence, clears only prompt-local Ponytail auto scope, and stops with the applicable Spec escalation, conflict, or bounded repair result.
