---
name: gsd-executing-plans
description: "Use when a valid approved GSD plan and execution handoff have pending work, including resuming active planned implementation. Do not use without the bound plan artifacts. Composes with gsd-tdd, gsd-diagnosing-bugs, gsd-handoff, and gsd-verify."
triggers: validated approved plan and execution handoff with pending or in-progress work
produces: [handoff-<n>.toon, docs/gsd/<feature>/milestones.md, .scratch/<feature>/tasks/<Tn>/a<N>.toon]
consumes: [plan.md, handoff-<n>.toon, docs/gsd/<feature>/milestones.md]
---

# Executing Plans

> **Invocation guard** — load only for validated approved plan state selected automatically or by `gsd-handoff`. Select the Invocation Mode before validating its Required artifacts; missing Optional state is normal. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Normal plan execution | `plan.md`; bound `handoff-<n>.toon` | authorized ledger | JIT attempt; `handoff-<n>.toon`; authorized ledger | Stop as Spec escalation; never synthesize source state or dispatch |
| Milestone plan execution | Normal required state; authoritative ledger | — | JIT attempt; `handoff-<n>.toon` | Missing source/binding is Spec escalation; missing ledger evidence is a Blocker |

## Intake and immutable contract

Select and validate the highest-numbered handoff, then read `plan.md` from `.scratch/<feature>/`, and perform one full parse and binding check. Any legacy `proposal.md`, `spec.md`, or `design.md` is rejected. Never fall back to an older handoff. Instead of repeated full validation, follow the approved phase-boundary semantic-validation and digest-guard model. Repeat this full parse and binding check only at execution entry/resume. Task attempt creation performs only a lightweight bound-source digest comparison. Child roles (implementer, reviewer, and fixer) consume the immutable attempt (including the lossless ordered Decisions) without independently reparsing `plan.md`. Missing, invalid, altered, or additional `plan.md` is a Spec escalation. Do not infer intent from legacy pre-approval TOON; it is stale and non-authoritative.

Read `plan.md` task headings in order. Use only valid bound handoff/attempt/runtime evidence to determine which non-superseded task is next; the approved Markdown Status field is never mutated after approval and cannot itself prove completion. Work on `wip/<feature>` from the approved Base. Preserve the existing Git/base/WIP/conflict, milestone, result-marker, and scratch-cleanup contracts in [../gsd/REFERENCE.md](../gsd/REFERENCE.md); those runtime artifacts cannot modify the approved Markdown contract.

## Per-task loop

1. Select the next task and verify every task-owned path, active AC, interface pin, focused check, invariant, non-goal, and source digest from `plan.md`.
2. Immediately before dispatch, perform a lightweight bound-source digest comparison. Write `.scratch/<feature>/tasks/<Tn>/a<N>.toon`; fsync, close, and read it back. The attempt records task/attempt identity, source paths/hashes/anchors, verbatim active criteria, lossless ordered Decisions, constraints, targets, focused checks, and safety facts. Bind its digest for implementer, reviewer, and fixer. Never mutate or reuse it as authoring input. The parent validates/copies the exact decision blocks from plan.md into the attempt. None. is represented as an explicit empty decisions marker.
3. The parent records task base and the immutable attempt digest. It writes a fresh handoff for the `task-active` transition with `next_action` set to `start/continue task`, then dispatches one fresh task implementer with direct-root TDD instructions. If the `task` agent capability is missing, it falls back to a separate inline implementation pass using the same attempt. The implementer runs its focused check once after implementation; it never runs acceptance checks. It reruns only checks invalidated by a repair. Task acceptance deferral is removed; the terminal verifier solely owns acceptance/E2E.
4. The parent dispatches a fresh read-only reviewer against the task diff and recorded green evidence (the reviewer consumes recorded green evidence rather than rerunning it). If the `reviewer` capability is missing, it falls back to a separate read-only self-review. Critical/Important findings or red checks re-enter the bounded task repair loop; any available role is still dispatched. If needed for blocking findings or red focused checks, the parent writes a fresh task-repair handoff for the `task repair` transition with `next_action` set to `run task review/repair` before it dispatches a fresh finding-scoped `task` fixer (falling back to a separate inline repair pass if the `task` capability is missing). After any fresh task fixer or inline fallback, that fixer pass reruns only focused checks invalidated by its repair, records replacement green evidence, and re-enters fresh review. Rerun all invalidated evidence and review. A changed requirement is a Spec escalation, not an implementation fix. Critical/Important findings and repair limits remain unchanged. Prose never claims a subagent was dispatched when it was not.
5. Commit only green task-owned changes on the WIP branch. Record completion by writing a fresh immutable `handoff-<n>.toon` for the `green-task` transition with the completed task and `next_action` set to `start/continue task`; never mutate the attempt or rewrite the approved Markdown plan. The parent retains task order, Git commits, handoff generation, and terminal transition. Tasks remain sequential on the shared worktree.

In `Milestone plan execution`, keep the authoritative ledger byte-for-byte read-only throughout the per-task loop. Revalidate that the selected milestone is still the matching first-pending row before every dispatch and pass that identity to `gsd-verify`; execution never marks a row `done` or deletes the ledger.

After every non-superseded task is done, the parent writes a fresh handoff for the `terminal entry` transition with `next_action` set to `enter terminal verification/repair`, then invokes `gsd-verify`.

## Auto-pilot

Approval is the last prompt. During execution report factual progress and blockers only: no menus, confirmations, visual-review offers, or manual merge. A manual pause or automatic context-pressure writes a fresh handoff for the `pause` transition and preserves the exact interrupted executable `next_action` before returning/stopping. A hard blocker writes a fresh handoff with `next_action` set to `Discussion/Spec-escalation` and `phase` recording the pause/block transition (e.g., `phase=blocked` or `phase=paused`). Both clear only prompt-local Ponytail auto scope and stop with the applicable Spec escalation, conflict, or bounded repair result.
