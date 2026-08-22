---
name: gsd-executing-plans
description: "Use when a valid bound plan and resumable state.toon have pending work that the prompt names."
produces: [state.toon, docs/gsd/<feature>/milestones.md]
consumes: [plan.md, state.toon, docs/domain/index.md, docs/domain/<scope>.md, AGENTS.md, docs/gsd/<feature>/milestones.md]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Do-not-load: missing bound plan/state; a bare resume naming no work; inventing authority
- Transition: after all tasks and Fast TDD Checks are green load `gsd-verify`

# Executing Plans

> **Invocation guard** — load only for validated bound plan state selected automatically or by `gsd-handoff`. Select the Invocation Mode before validating its Required artifacts; missing Optional state is normal. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Normal plan execution | `plan.md`; bound `state.toon` | authorized ledger | `state.toon`; authorized ledger; amended `plan.md` | Stop only when `plan.md` or `state.toon` is missing or malformed; never synthesize source state or dispatch |
| Milestone plan execution | Normal required state; authoritative ledger | — | `state.toon` | Missing source/binding is Spec escalation; missing ledger evidence is a Blocker |
Select `Milestone plan execution` when `plan.md` `## Publication` is non-`null` (the feature owns a milestone ledger); otherwise `Normal plan execution`.

## Intake and amendable contract

Perform one full parse and binding check at execution entry or resume: validate canonical `schema:v4` and `.scratch/<feature>/plan.md` under [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Canonical Markdown contract. Reject legacy proposal/spec/design files, numbered handoffs, attempts, reload manifests, and result markers. At ordinary task selection consume the retained validated task slice; repeat full parsing only at resume, terminal entry, and pre-squash. Never reconstruct scope from memory.

At execution entry or resume run `bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md --expected-sha256 <state.plan_sha256> --expected-base <state.base_ref>` before building the retained slice. Exit 0 must report the matching feature, bound hash, and recorded base. Exit 1 on malformed grammar or a base mismatch is Spec escalation; exit 1 on a hash mismatch alone means the plan bytes moved, so resolve it through [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Plan amendment instead of stopping. Exit 2 corrects only the invocation.

Execution reads only structured task blocks carrying canonical `Domain Impact`. A path-only task form or missing Domain Impact is malformed authority, not a compatibility case, and execution never creates or binds it.

Select the next task in strict heading order from bound state and Git evidence, never mutable plan Status. Work on `wip/<feature>` and follow [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics. A missing or malformed `plan.md` is Spec escalation.

The plan stays amendable while the feature executes. When the work shows the plan is wrong or incomplete, amend `.scratch/<feature>/plan.md` under § Plan amendment, revalidate, rebind the returned hash, and continue the same task; never close the plan or open a fresh feature to record a correction. Routine bookkeeping needs no prompt.
A user-stated requirement addition or change mid-execution is the same amendment flow: update `plan.md`, revalidate, rebind, and continue the same packet — the user already decided it, so no confirmation question re-asks it; only genuinely new product scope exits to discovery. For a material change the owner discovers to acceptance, an invariant, a non-goal, `Domain Impact`, an interface pin, or a completed task's record, ask one question first, then proceed with the chosen option. Anything uncertain is also one question, never a block.

## Per-task loop

Initialize one phase in the harness todo list from the exact pending `T1..TN` identities of the bound plan, once after binding or at resume. That list is display state: `state.toon` remains the sole resumable authority and the todo list never selects, completes, or resumes work.

1. Select only the next task in strict heading order and verify every structured file path, operation, intent, active AC, interface pin, focused check, invariant, non-goal, `Domain Impact` field, and source fact from `plan.md`. Compute the wave schedule once at entry or resume under [§ Wave dispatch](#wave-dispatch) and reuse it across tasks; recompute only after a plan amendment.
2. Build and retain a validated task slice from the plan: task identity, structured file operations and intents, verbatim active criteria, lossless ordered Decisions, Domain Impact, constraints, targets, focused checks, and safety facts. A "None." decisions block in the plan is represented as an explicit empty decisions marker in the slice. Do not write task-attempt TOON files, status into `plan.md`, or synthetic task briefs.
3. The current top-level session owner consumes the validated slice and dispatches the task within its wave under [§ Wave dispatch](#wave-dispatch), so a sub-agent authors the task code; when dispatch is unavailable it implements or repairs the task inline. GSD dispatches no repair task, generic child task, or parallel lifecycle work outside validated waves.
   Every observable task loads `gsd-tdd` and performs direct RED before implementation, GREEN after implementation, then refactor after green — inline or in its sub-agent. Run deterministic local unit, integration, CLI, contract, or fast acceptance checks only; browser, resource-heavy, slow, whole-acceptance, and E2E suites stay outside the task loop.
4. For non-`none` Domain Impact, the same owning task contains code and its exact affected domain documentation paths. Implement the target domain behavior, then make each shard describe current production behavior; upsert `AGENTS.md` only when its canonical section is missing or stale. Existing docs never override code/schema/contract/test evidence. Missing, obsolete, unrelated, or future-tense domain prose keeps the task red.
5. The task boundary is green focused evidence, recorded only in reporting and transcripts. A red focused check or explicit self-verification failure re-enters this task's bounded inline repair. First checkpoint `next_action=start/continue task`, repair source-first under `gsd-executing-plans`, `gsd-handoff`, and `gsd-tdd`, then rerun only checks invalidated by the repair. Load no terminal verifier until every task is green.
6. Commit only green task-owned changes on WIP. Use `gsd-state.mjs write-state --json-file` (never the `write` tool directly) to atomically update `state.toon` with `last_green_task`, `last_green_commit`, `next_action=start/continue task`, and an amended plan hash; delete `.scratch/<feature>/.state-input.json`. Mark that task done in the todo list in the same step as its green checkpoint. Task `Tn+1` begins only from the committed green checkpoint of `Tn` (after a wave, the owner's merged checkpoint). Source mutations never overlap task/repair or Deferred Slow E2E.

Write one `docs/design/NNNN-slug.md` record with the minimal header from [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Durable decision and design records when a UI/UX decision settles in the owning task; measurement sections stay optional.

In `Milestone plan execution`, keep the authoritative ledger byte-for-byte read-only throughout the per-task loop. Validate the selected milestone is the matching first-pending row once at entry or resume by running `bun "<GSD_ROOT>/tools/gsd-milestone.mjs" validate --path docs/gsd/<feature>/milestones.md --expected-feature <state.feature> --expected-base <state.base_ref>`; execution never marks a row `done` or deletes the ledger (only the `Milestone WIP gate` does, via `complete`).

Only after every non-superseded task and Fast TDD Check is green, atomically set `next_action=enter terminal verification/repair` and load `gsd-verify`. The session owner then performs deterministic cumulative conformance before Deferred Slow E2E.

## Wave dispatch

Every wave is dispatched to sub-agents, a single-task wave included, so the owner orchestrates, reconciles, and verifies instead of authoring task code. Authorship is not authority: the owner remains sole lifecycle authority because no dispatched result counts until it inspects, merges, and checkpoints it. The canonical contract is [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Wave dispatch.

1. At entry or resume, run `bun "<GSD_ROOT>/tools/gsd-contract.mjs" analyze-waves --path .scratch/<feature>/plan.md --expected-sha256 <state.plan_sha256> --expected-base <state.base_ref>`. Exit 0 prints `waves: T1,T2|T3|...`; dispatch every wave to sub-agents, single-task waves included, and fall back to the inline per-task loop only when dispatch is unavailable. Exit 1 resolves like a bound validation failure; exit 2 corrects the invocation.
2. Fan out one task per sub-agent, so a single-task wave is exactly one sub-agent. Each sub-agent receives the full validated slice for exactly one task (step 2 of the per-task loop), the plan path, and the base/WIP identity, rebuilt from `plan.md` — never invented.
3. A sub-agent MUST perform Fast TDD RED before implementation, GREEN after, then refactor; update every affected domain shard in the same commit as its semantic code; and commit only green task-owned changes on its own branch `wip/<feature>/t<n>` cut from the wave base. It MUST NOT mutate `state.toon`, amend `plan.md`, merge, decide lifecycle, or run Deferred Slow E2E.
4. Reconcile the wave: merge each sub-agent branch into `wip/<feature>` in strict plan order, commit one green checkpoint, then write `state.toon` through the `gsd-state.mjs` CLI exactly as step 6 with `last_green_task` set to the wave's last task. Mark the wave's tasks done in the todo list in the same step.
5. A failed or red sub-agent task returns to the session owner for bounded inline repair under this skill, `gsd-handoff`, and `gsd-tdd`; re-dispatch only when the validator again proves the task independent of the remaining wave.

## Auto-pilot

Plan binding is the last planning step and there is no approval prompt. During execution report factual progress and blockers only; do not open unrelated menus or confirmations. Manual pause or automatic context-pressure writes `phase=paused` and preserves the interrupted executable `next_action`. A hard blocker sets `next_action` to `Discussion/Spec-escalation` with pause/block `phase`. Both use atomic `state.toon` writes via `gsd-handoff`.
