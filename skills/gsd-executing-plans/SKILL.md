---
name: gsd-executing-plans
description: "Use to execute, continue, pause, resume, close, or abandon a bound GSD plan from its state.toon, including picking one of several owned features."
produces: [state.toon, plan.md]
consumes: [plan.md, state.toon, docs/domain/index.md, docs/domain/<scope>.md, AGENTS.md]
---

# Executing Plans

Owns a bound feature on `wip/<feature>`: execute, pause, resume, close after a merged pull request, or abandon. Needs a valid `plan.md` and bound `state.toon`; a missing or malformed one stops and names the file, and work is never invented from conversation, dirty files, or plan prose status. When every task is green, hands off to `gsd-verify`.

## State writes

Write `state.toon` only with `bun "<GSD_ROOT>/tools/gsd-state.mjs" set --feature-dir .scratch/<feature> owner=<GSD_SESSION> key=value…`, never by hand; the tool fills `next_action` and `checkpoint_revision` and reads back (`GSD_ROOT/skills/gsd/REFERENCE.md` § Runtime state contract).

## Entry, pause, and resume

- **Resume:** with no feature named, list owned candidates under § Candidate discovery; one resumes, several ask which. A packet another session owns resumes only when the user names it, writing your own `owner` with `set --takeover`.
- **Validate** at entry and resume with `bun "<GSD_ROOT>/tools/gsd-contract.mjs" analyze-waves --path .scratch/<feature>/plan.md --expected-base <state.base_ref>`: it validates and prints `waves:`. Exit 1 is Spec escalation (a base mismatch always stops, since the merge target never changes); exit 2 corrects invocation. Then follow the skill `next_action` names under § Skill derivation from phase and next_action.
- **Pause:** at a user request or context pressure, set `phase=paused`; the interrupted `next_action` is kept. A hard blocker writes `next_action=Spec-escalation`. Resuming a paused packet sets the phase its kept `next_action` implies: `executing` for a task, `verifying` for terminal verification, `ready` for the merge-or-pull-request question.
- **Amend:** when work shows the plan is wrong or the user changes a requirement, amend `plan.md` under § Plan amendment, revalidate, and continue the same task. New product scope exits to `gsd-brainstorming`.

## Per-task loop

Track `T1..TN` in the harness todo list as display only; `state.toon` is the resume authority. Work under § Git/base/WIP/scratch mechanics; a plan with `## Repos` has one `wip/<feature>` per listed repository and each task commits in its own.

1. Take the next task in heading order and build its slice: file operations and intents, verbatim active criteria, decisions, `Domain Impact`, and focused checks.
2. A single-task wave is authored inline; a wave of independent tasks dispatches under Wave dispatch below.
3. Follow `GSD_ROOT/skills/gsd-tdd/SKILL.md`: RED, GREEN, refactor, with Fast TDD Checks only.
4. A non-`none` `Domain Impact` task updates its named shards in the same commit.
5. A red check repairs inline. When its cause cannot be located, follow `GSD_ROOT/skills/gsd-diagnosing-bugs/SKILL.md` inline without asking questions; missing access or an ambiguous criterion is Spec escalation.
6. Before the first commit, prove `state.toon` is bound and `wip/<feature>` is checked out; if it does not exist, create it and set `phase=executing`; in a listed repository also run `git -C <repo> config branch.wip/<feature>.gsdBase <Base>`. Commit only green task-owned paths, then set `last_green_task`, `last_green_commit`, and `next_action=start/continue task`. `Tn+1` starts only from a committed green `Tn`.

Record settled UI/UX decisions as `docs/design/NNNN-slug.md` under § Durable decision and design records. When every task is green, set `next_action=enter terminal verification/repair` and load `gsd-verify`. Report progress and blockers only.

## Wave dispatch

Only implementation is dispatched; repair, diagnosis, architecture, and verification never are. A sub-agent result counts only after the owner inspects, merges, and checkpoints it.

A **wave** is a maximal contiguous run of tasks whose pairs have disjoint `Files` (per repository), disjoint `Satisfies`, and differing `Test`; `analyze-waves` prints them separated by `|`. Each dispatched task runs in its own isolated workspace; without isolation or dispatch, run the wave serially in plan order.

1. Each sub-agent gets one task's full slice, the plan path, base and WIP identity, and the absolute paths of `skills/gsd-tdd/SKILL.md` and, when `Domain Impact` is not `none`, `skills/gsd-domain-modeling/SKILL.md` under the injected `GSD_ROOT`. Use the bootstrap's `worker` profile when listed.
2. It runs RED, GREEN, refactor and commits only green task-owned changes on its own task branch cut from the wave base. It never touches `state.toon` or `plan.md`, merges, or runs slow suites.
3. Reconcile with Git bytes, never the sub-agent's report: `bun "<GSD_ROOT>/tools/gsd-git.mjs" verify-task-branch --feature-dir .scratch/<feature> --task <Tn> --branch <task-branch> --wave-base <ref>` must print `status: ready`. A block (`branch-missing`, `base-not-ancestor`, `empty-diff`, `out-of-slice-path`, `scratch-mutated`, `plan-invalid`, `not-a-repository-root`) is an integrity failure the owner repairs inline, never re-dispatches.
4. Merge the wave's task branches into `wip/<feature>` in plan order, rerun every merged task's focused check, then checkpoint with the wave's last task.

## Close or abandon

- **Close:** after the user says a pull request merged, follow § Feature cleanup.
- **Abandon:** confirm the feature name, then follow the abandon steps of § Feature cleanup. Never force-delete unmerged work without explicit confirmation.
