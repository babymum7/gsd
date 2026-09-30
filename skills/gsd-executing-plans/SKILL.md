---
name: gsd-executing-plans
description: "Use to execute, continue, pause, or resume a bound GSD plan from its state.toon, including picking one of several owned features."
produces: [state.toon, plan.md]
consumes: [plan.md, state.toon, docs/domain/index.md, docs/domain/<scope>.md, AGENTS.md]
---

## Dispatch contract
Canonical row: `GSD_ROOT/skills/gsd/REFERENCE.md` § Visible skill mandatory-use matrix.
- Role: owner
- Intent: own bound plan tasks and domain docs on `wip/<feature>`, and pause or resume that work: sub-agents author each wave's tasks, the owner reconciles and repairs
- Do-not-load: missing or malformed bound plan/state; inventing work from conversation or dirty files
- Transition: after all tasks and Fast TDD Checks are green load `gsd-verify`

# Executing Plans

> **Invocation guard** — load for bound plan execution, a bare `continue`, or pause/resume intent. Select the Invocation Mode before validating Required artifacts. Apply `GSD_ROOT/skills/gsd/REFERENCE.md` § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Execute | `plan.md`; bound `state.toon` | affected domain shards; `AGENTS.md` | `state.toon`; amended `plan.md` | Stop and name the missing or malformed file; never synthesize state or dispatch |
| Pause | bound `state.toon` | — | `state.toon` | Nothing to pause; say so |
| Resume | one owned feature's `plan.md` and `state.toon` | recovery capsule | — | Name the owned candidates, or say none exist; never invent work |

## State writes

Write `state.toon` only with `bun "<GSD_ROOT>/tools/gsd-state.mjs" set --feature-dir .scratch/<feature> owner=<GSD_SESSION> key=value…`; derived defaults fill `next_action` and `checkpoint_revision`. `write-state --json-file` is the fallback for values `key=value` cannot express. Never write the file directly: the CLI validates, writes atomically, and reads back under `GSD_ROOT/skills/gsd/REFERENCE.md` § Runtime state contract.

## Pause and resume

- **Pause**: at a user request or context pressure, set `phase=paused` through `gsd-state.mjs` and keep the interrupted `next_action`. Hard blockers write `next_action=Spec-escalation`.
- **Resume**: with no feature named, list owned candidates under `GSD_ROOT/skills/gsd/REFERENCE.md` § Candidate discovery. One candidate resumes; several ask which one. A packet another session owns resumes only when the user names it, and the resume writes your own `owner`.
- Validate before acting: run `bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md --expected-base <state.base_ref>`. Exit 0 resumes, including after an amendment. Exit 1 is Spec escalation; a base mismatch always stops there, because the merge target never changes mid-lifecycle. Exit 2 corrects invocation.
- Then load the skill `next_action` names under `GSD_ROOT/skills/gsd/REFERENCE.md` § Skill derivation from phase and next_action. Never reconstruct work from conversation, dirty files, or plan status.

## Intake and amendments

At entry or resume, validate the plan as above, then build task slices from it. Work on `wip/<feature>` under `GSD_ROOT/skills/gsd/REFERENCE.md` § Git/base/WIP/scratch mechanics; a plan with `## Repos` has one `wip/<feature>` per listed repository and each task commits in its own repository. Select tasks in heading order from bound state and Git evidence, never from plan prose status.

The plan stays amendable. When work shows it is wrong or incomplete, or the user changes a requirement, amend `.scratch/<feature>/plan.md` under § Plan amendment, revalidate, and continue the same task. Material changes to acceptance, invariants, non-goals, `Domain Impact`, interfaces, or completed tasks ask one question first. New product scope exits to `gsd-brainstorming`.

## Per-task loop

Track pending `T1..TN` in the harness todo list as display only; `state.toon` stays the sole resume authority.

1. Take the next task. Build its slice from the plan: file operations and intents, verbatim active criteria, decisions, `Domain Impact`, constraints, and focused checks. Compute the wave schedule once at entry or resume under the Wave dispatch section below, and again only after an amendment.
2. A single-task wave is authored inline following `GSD_ROOT/skills/gsd-tdd/SKILL.md`. A wave of two or more independent tasks dispatches one isolated sub-agent per task; without dispatch, run the batch serially in plan order.
3. Every task follows `GSD_ROOT/skills/gsd-tdd/SKILL.md`: RED before implementation, GREEN after, refactor after green. Only fast deterministic checks run here; browser, slow, and E2E suites wait for `gsd-verify`.
4. A non-`none` `Domain Impact` task updates its named domain shards in the same commit so they describe current production behavior. Skip domain docs in any repository without `docs/domain/index.md`.
5. A red focused check repairs inline in this task, then reruns only the checks the repair affects.
6. Before the first commit, prove `wip/<feature>` is checked out and `state.toon` is bound. Commit only green task-owned changes, then set `last_green_task`, `last_green_commit`, and `next_action=start/continue task`. `Tn+1` starts only from the committed green `Tn`.

Record settled UI/UX decisions as `docs/design/NNNN-slug.md` under `GSD_ROOT/skills/gsd/REFERENCE.md` § Durable decision and design records.

When every task and Fast TDD Check is green, set `next_action=enter terminal verification/repair` and load `gsd-verify`.

## Wave dispatch

Implementation is the only work GSD dispatches. Authorship is not authority: no sub-agent result counts until the owner inspects, merges, and checkpoints it. Repair, diagnosis, architecture, and verification are never dispatched.

A **wave** is a maximal contiguous run of non-superseded tasks in heading order whose pairs are independent: disjoint `Files` paths (per repository), disjoint `Satisfies` criteria, and differing `Test` commands. Inline execution following `gsd-tdd` is the fallback when dispatch is unavailable; a single-task wave always runs inline (decision 0006). Dispatched tasks run concurrently, each in its own isolated workspace; without isolation, run the batch serially in plan order.

1. At entry or resume, run `bun "<GSD_ROOT>/tools/gsd-contract.mjs" analyze-waves --path .scratch/<feature>/plan.md --expected-base <state.base_ref>`. Exit 0 prints `waves: T1,T2|T3|...`; each `|` is an independence boundary. Exit 1 resolves like a validation failure; exit 2 corrects invocation.
2. Each sub-agent gets exactly one task's full slice, the plan path, base/WIP identity from `plan.md`, and the absolute paths, built from the injected `GSD_ROOT`, of `skills/gsd-tdd/SKILL.md` and, when `Domain Impact` is not `none`, `skills/gsd-domain-modeling/SKILL.md` to read before authoring. Re-read each prompt against its slice before sending. Use the bootstrap's `worker` sub-agent profile when listed.
3. A sub-agent runs RED, GREEN, refactor, updates affected domain shards in the same commit, and commits only green task-owned changes on its own task branch cut from the wave base. It never touches `state.toon` or `plan.md`, merges, decides lifecycle, or runs slow/E2E suites.
4. Reconcile each wave before checkpointing. A sub-agent's own report is not evidence; only Git bytes and commands the owner runs count.
   - Mechanical proof: `bun "<GSD_ROOT>/tools/gsd-git.mjs" verify-task-branch --feature-dir .scratch/<feature> --task <Tn> --branch <task-branch> --wave-base <ref>`. Only `status: ready` on exit 0 admits the branch; `status: blocked` names a `code:` (`branch-missing`, `base-not-ancestor`, `empty-diff`, `out-of-slice-path`, `scratch-mutated`, `plan-invalid`, `not-a-repository-root`) and is an integrity failure (for `not-a-repository-root`, amend the plan's `## Repos` row to a repository root); exit 2 corrects invocation.
   - Integration proof: merge the wave's task branches into `wip/<feature>` in plan order, rerun every merged task's focused check, and only then checkpoint with `last_green_task` set to the wave's last task.
5. Any failed layer returns to the owner for inline repair; never re-dispatch an integrity failure.

## Auto-pilot

Plan binding is the last planning step; there is no approval prompt. During execution, report progress and blockers only.
