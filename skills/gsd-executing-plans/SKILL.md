---
name: gsd-executing-plans
description: Execute implementation plan(s) — dispatch a fresh `task` subagent per task, per-task verify, then the terminal `gsd-verify` gate. Triggered after `gsd-to-plan` (reads `.scratch/<feature>/plan.toon`).
---

# Executing Plans

Dispatch a fresh `task` subagent (the implementer) per task, verify each, then a terminal gsd-verify. Markdown-skill authoring and trivial edits are done directly (skip this).

 ## Intake
 Read the consolidated plan `.scratch/<feature>/plan.toon`. Tasks run sequentially. Do not dispatch parallel tasks on shared code.

## Per task
1. **Dispatch** a fresh `task` subagent with a single task-brief (the one task, the interfaces, the global constraints) — not the whole plan, not prior history.
2. **Review** the returned diff: hand a `reviewer` subagent the task-brief (expected behavior) + the task's TDD note + the diff file + the BASE recorded before dispatch (never `HEAD~1`, which truncates multi-commit tasks). Require two verdicts: **task-compliance** (TDD test exists, passes, covers the task) AND **code-quality**.
3. **Fix loop**: Critical/Important findings → fix subagent → re-verify. Never proceed with open Critical/Important.
4. **Commit** to `wip/<feature>`. Never commit main during execution.
5. **Tests**: unit only. E2E excluded from this loop.

> **Subagent failure** (no diff / errored — not a verify finding): re-dispatch with a sharper brief. Repeats → route to `gsd-diagnosing-bugs` (real blocker, not unfinished work).

## Spec escalation
If a task reveals an **acceptance criterion is itself wrong/incomplete** (not a code bug — the spec contradicts real intent, or is impossible/ambiguous), STOP the task. Do not patch code to fit a flawed criterion. Route back to `gsd` (Discussion) → revise `spec.md` → re-plan the affected tasks under **fresh IDs**, marking the ledger entries they replace as **superseded** — so a spec revision that invalidates an already-done task is re-dispatched, not blocked by the dedup rule. (Distinct from the fix loop, which fixes code not matching a correct spec.)

## Auto-triggers
- `gsd-tdd` — for the unit test each task specifies.
- `gsd-diagnosing-bugs` — when a task is blocked by a real bug/regression, not just unfinished.
- `gsd-handoff` — on compaction/resume (read the progress ledger first).
- `gsd-domain-modeling` — when implementation reveals a durable term/decision missing from `CONTEXT.md`.
- `gsd-verify` — terminal, when all plans + per-task verifications pass.

 ## Progress ledger (plan.toon)
 Update each task's status column directly inside `.scratch/<feature>/plan.toon` (e.g. from `pending` -> `in_progress` -> `done`). After resume, check `plan.toon` + `git log` — never re-dispatch a task marked `done`.

## Terminal — gsd-verify gate
All plans done + per-task verifications passed → invoke `gsd-verify` (reviewer subagent over the full WIP diff). Pass → squash `wip/<feature>` → one commit to main. Fail → fix loop, re-verify.

 
 ## Git conflict resolution
 If a merge, cherry-pick, or apply fails due to merge conflicts:
 1. Do NOT treat it as a code bug (do not route to `gsd-diagnosing-bugs`).
 2. Run `git status` to locate conflicted files.
 3. Use the `read` tool with the `:conflicts` selector (e.g., `read path/to/file:conflicts`) to view the conflicting chunks.
 4. Solve the conflicts using the `edit` tool, cleanly removing markers (`<<<<<<<`, `=======`, `>>>>>>>`).
 5. Run `git add` to mark resolved. If the conflict is too complex to resolve mechanically, run `git merge --abort` and notify `Main` via `irc`.
## Never
- Commit main during execution.
- Skip per-task verify, or accept a report missing either verdict.
- Parallel `task` subagents on shared code. Hand a subagent its task-brief, not the whole plan.
- Re-dispatch a task the ledger marks done.

 ## Contextual disclosure (AXI Style)
 At the end of every response, always suggest next actions using the `/gsd` master entry point:
 ```
 Next steps:
 - /gsd (to check progress, trigger a verify, or save progress)
 ```
