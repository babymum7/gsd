---
name: gsd-executing-plans
description: Execute implementation plan(s) — dispatch a fresh `task` subagent per task, per-task gsd-review, then the terminal `gsd-review` gate. Triggered after `gsd-to-plan` (reads `.scratch/<feature>/plans/`).
---

# Executing Plans

Dispatch a fresh `task` subagent (the implementer) per task, gsd-review each, then a terminal gsd-review. Markdown-skill authoring and trivial edits are done directly (skip this).

## Intake
Read all plans in `.scratch/<feature>/plans/`. Honor markers: `[PARALLEL]` (disjoint files → may run concurrent streams), `[SEQ after X]` (wait for X). Within one plan, tasks run sequentially — never parallel `task` subagents on shared code.

## Per task
1. **Dispatch** a fresh `task` subagent with a single task-brief (the one task, the interfaces, the global constraints) — not the whole plan, not prior history.
2. **Review** the returned diff: hand the reviewer the task-brief (expected behavior) + the task's TDD note + the diff file + the BASE recorded before dispatch (never `HEAD~1`, which truncates multi-commit tasks). Require two verdicts: **task-compliance** (TDD test exists, passes, covers the task) AND **code-quality**.
3. **Fix loop**: Critical/Important findings → fix subagent → re-review. Never proceed with open Critical/Important.
4. **Commit** to `wip/<feature>`. Never commit main during execution.
5. **Tests**: unit only. E2E excluded from this loop.

> **Subagent failure** (no diff / errored — not a gsd-review finding): re-dispatch with a sharper brief. Repeats → route to `gsd-diagnosing-bugs` (real blocker, not unfinished work).

## Spec escalation
If a task reveals an **acceptance criterion is itself wrong/incomplete** (not a code bug — the spec contradicts real intent, or is impossible/ambiguous), STOP the task. Do not patch code to fit a flawed criterion. Route back to `gsd-grilling` → revise `spec.md` → re-plan the affected tasks under **fresh IDs**, marking the ledger entries they replace as **superseded** — so a spec revision that invalidates an already-done task is re-dispatched, not blocked by the dedup rule. (Distinct from the fix loop, which fixes code not matching a correct spec.)

## Auto-triggers
- `gsd-tdd` — for the unit test each task specifies.
- `gsd-diagnosing-bugs` — when a task is blocked by a real bug/regression, not just unfinished.
- `gsd-handoff` — on compaction/resume (read the progress ledger first).
- `gsd-domain-modeling` — when implementation reveals a durable term/decision missing from `CONTEXT.md`.
- `gsd-review` — terminal, when all plans + per-task reviews pass.

## Progress ledger
Record each task's status in `.scratch/<feature>/ledger.md`. After resume, check the ledger + `git log` — never re-dispatch a task the ledger marks done.

## Terminal — gsd-review gate
All plans done + per-task reviews passed → invoke `gsd-review` (reviewer agent over the full WIP diff). Pass → squash `wip/<feature>` → one commit to main. Fail → fix loop, re-review.

## Never
- Commit main during execution.
- Skip per-task gsd-review, or accept a report missing either verdict.
- Parallel `task` subagents on shared code. Hand a subagent its task-brief, not the whole plan.
- Re-dispatch a task the ledger marks done.
