---
name: gsd-executing-plans
description: Internal GSD sub-skill (routed via /gsd). Execute implementation plan(s) — dispatch a fresh `task` subagent per task, per-task verify, then the terminal `gsd-verify` gate. Triggered after `gsd-to-plan` (reads `.scratch/<feature>/plan.toon`).
triggers: plan exists, pending/in-progress (gsd Route 3)
produces: [plan.toon]
consumes: [plan.toon]
---

# Executing Plans

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Invoked standalone with its `consumes:` artifacts missing → load the `gsd` skill and enter through its router (it detects workspace state); don't improvise missing context.

Dispatch a fresh `task` subagent (the implementer) per task, verify each, then a terminal gsd-verify. Markdown-skill authoring and trivial edits are done directly (skip this).

## Auto-pilot (no-prompt contract)
Entering this skill means the plan is **already approved** (gsd-to-plan's approval gate — the last prompt of the cycle). From here to the `<base>` merge, run **hands-free**: no questions, confirmations, or end-of-response menus between tasks, before the terminal `gsd-verify` gate, or before the squash merge. Report progress (task started/committed, verdicts, findings fixed) — visibility stays, prompts go. The ONLY stops are hard blockers: spec escalation, a merge conflict too tangled to resolve mechanically, a fix loop that can't converge (→ `gsd-diagnosing-bugs`), or a failing terminal verify that survives its fix loop. A blocker stop reports what blocked and why — it never silently merges.

 ## Intake
 Read the consolidated plan `.scratch/<feature>/plan.toon` (skip the `schema:v1` header and `base:` line; tasks start at the `plan[` table). Tasks run sequentially. Do not dispatch parallel tasks on shared code.
 **Branch** (if not on `wip/<feature>` yet): the branch already exists (resume/rerun — check `git branch --list wip/<feature>`) → `git checkout wip/<feature>`. Else, creation depends on `base:` in `plan.toon`: present → it is authoritative, `git checkout -b wip/<feature> <base>` (never recapture from whatever branch you happen to be on); absent → capture `BASE=$(git branch --show-current)` first, `git checkout -b wip/<feature>`, and persist `base:$BASE` immediately after `schema:v1` (see gsd Conventions).

## Per task
1. **Dispatch** a fresh `task` subagent with a single task-brief (the one task, its `satisfies` ACs from `spec.md`, the interfaces, the global constraints) — not the whole plan, not prior history. Record `TASK_BASE=$(git rev-parse HEAD)` before dispatch — the review-diff base for this task.
2. **Review** the returned diff: hand a `reviewer` subagent the task-brief (expected behavior) + the task's TDD note (its `test` column in `plan.toon`) + the diff file. Capture that diff from the recorded `TASK_BASE` (never `HEAD~1`, which truncates multi-commit tasks; never the branch-wide `base:` — that's `gsd-verify`'s scope) excluding session artifacts: `git diff $TASK_BASE -- . ':(exclude).scratch'` — a portable-handoff sync makes scratch tracked; keep it out of review. Require two verdicts: **task-compliance** (TDD test exists, passes, covers the task — per-task scope; the terminal whole-branch analogue is `gsd-verify`'s **spec-compliance**) AND **code-quality**. A `test:none` task (test-exempt per `gsd-to-plan`) drops the TDD check — task-compliance is then "the diff does the brief, nothing more".
3. **Fix loop**: Critical/Important findings → fix subagent → re-verify. Never proceed with open Critical/Important. The same finding surviving two fix rounds = a failure the fix loop can't resolve → route to `gsd-diagnosing-bugs` instead of a third identical attempt.
4. **Commit** to `wip/<feature>` — code only: never stage `.scratch/` in a task commit (the ledger update in the working tree is enough; `gsd-handoff`'s portable sync commit is the sole exception). Never commit <base> during execution. **Autosync on** (handoff `settings[]`) → after the task commit, sync scratch **iff dirty** (`git status --short .scratch/<feature>` non-empty → the pathspec'd commit from `gsd-handoff` § Portable; a clean-scratch commit exits non-zero), then **always** `git push` — push is unconditional so code commits travel even when the ledger didn't change. No remote → skip the sync/push and stay machine-local (graceful degradation per `gsd-handoff` § Portable), don't error the task loop.
5. **Tests**: unit only. E2E is excluded from this per-task loop by design — it's owned by the `gsd-verify` E2E gate, which runs the end-to-end user path once over the whole branch before the <base> merge.

> **Subagent failure** (no diff / errored — not a verify finding): re-dispatch with a sharper brief. Repeats → route to `gsd-diagnosing-bugs` (real blocker, not unfinished work).
> **No subagents in the harness** (no `task`/`reviewer` tool): degrade per gsd Conventions — implement the task yourself inline, then run the review as a separate self-contained pass against the same task-brief and both verdicts. Degraded self-review keeps the same blocking semantics: open Critical/Important still stops the loop.

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
All plans done + per-task verifications passed → invoke `gsd-verify` **immediately** (reviewer subagent over the full WIP diff) — no prompt, no menu; auto-pilot carries through the gate. Pass → squash `wip/<feature>` → one commit to <base>, automatically. Fail → fix loop, re-verify.

 
 ## Git conflict resolution
 If a merge, cherry-pick, or apply fails due to merge conflicts:
 1. Do NOT treat it as a code bug (do not route to `gsd-diagnosing-bugs`).
 2. Run `git status` to locate conflicted files.
 3. Use the `read` tool with the `:conflicts` selector (e.g., `read path/to/file:conflicts`) to view the conflicting chunks.
 4. Solve the conflicts using the `edit` tool, cleanly removing markers (`<<<<<<<`, `=======`, `>>>>>>>`).
5. Run `git add` to mark resolved. If the conflict is too complex to resolve mechanically, run `git merge --abort` and surface it to the user (or the parent agent, e.g. via `irc` where the harness has one).
## Never
- Commit <base> during execution.
- Skip per-task verify, or accept a report missing either verdict.
- Parallel `task` subagents on shared code. Hand a subagent its task-brief, not the whole plan.
- Re-dispatch a task the ledger marks done.
- Prompt, ask, or menu mid-pipeline after plan approval — auto-pilot runs to merge or to a blocker.
- Merge past a red gate: a blocker stops and reports, never auto-merges anyway.

 ## Contextual disclosure (see gsd Conventions). Example:
 ```
 Auto-pilot appends nothing mid-run. Only a blocker stop (or direct invocation outside the pipeline) discloses:
 Blocked at <task/gate>: <why>. Next steps:
 - /gsd (to revise the spec, resume after the fix, or save progress)
 ```
