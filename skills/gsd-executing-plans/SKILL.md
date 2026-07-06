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

## Auto-pilot (canonical contract implementation)
Entering this skill means the plan is **already approved** (gsd-to-plan's approval gate — the last prompt of the cycle). Implement [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Post-approval pipeline contract locally and disclose only via [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates → Post-approval pipeline progress or Blocker stop: no questions, confirmations, or end-of-response menus — and no `Next steps:` — between tasks, before the terminal `gsd-verify` gate, or before the squash merge. Report progress (task started/committed, verdicts, findings fixed) — visibility stays, prompts go. Stop only for this skill's blockers: spec escalation, a merge conflict too tangled to resolve mechanically, a fix loop that can't converge (→ `gsd-diagnosing-bugs`), or a failing terminal verify that survives its fix loop. A blocker stop reports what blocked and why — it never silently merges.

 ## Intake
 Read the consolidated plan `.scratch/<feature>/plan.toon` (skip the `schema:v1` header and `base:` line; tasks start at the `plan[` table). Tasks run sequentially. Do not dispatch parallel tasks on shared code.
 **Branch** (if not on `wip/<feature>` yet): follow [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics. If the branch already exists (resume/rerun), `git checkout wip/<feature>`. Otherwise create from authoritative `base:` with `git checkout -b wip/<feature> <base>`; never recapture when `base:` is present. Old plan missing `base:` → use the canonical base-detection ladder, then persist `base:<base>` immediately after `schema:v1` before continuing.

## Per task
1. **Dispatch** a fresh `task` subagent with a single deterministic task-brief (not the whole plan, not prior history). Record `TASK_BASE=$(git rev-parse HEAD)` before dispatch — the review-diff base for this task. The task-brief must be constructed at dispatch time (ensuring it matches the live codebase state) using the following structured template. **Important rules for dispatcher:** fields may be `none/unknown` and the dispatcher MUST NOT invent design decisions when `spec.md` lacks `Design & Invariants`. It must only quote `spec.md` and current codebase facts. If a missing design decision is load-bearing, STOP and escalate to spec revision (route back to `gsd` Discussion to revise `spec.md` and re-plan) rather than inventing it inline.
   ```markdown
   # Task Brief: <ID> - <Task Description>
   ## Context & Objectives
   - **Task:** <The 5-8 word task description>
   - **Satisfies:** <verbatim text of ACs from spec.md that this task satisfies>
   - **Design & Invariants:** <Design, invariants, non-goals, and shared interfaces quoted from spec.md if present; else "none">
   - **Target Files & Interfaces:** <files from plan.toon, plus specific functions/interfaces/classes to create or modify if already defined or obvious from codebase; else "unknown">
   ## Implementation Scope
   - **Requirements:** <exact behavioral changes needed to satisfy the ACs in these files, quoting spec/code facts only; else "none">
   - **Invariants:** <conditions/rules that must remain true, quoting spec/code facts only; else "none">
   - **Non-Goals:** <what NOT to do / scope exclusions from spec.md; else "none">
   ## Verification & Done Criteria
   - **TDD Test Path:** <test path from plan.toon>
   - **Test Command:** <exact test run command>
   - **Done Criteria:** <observable/verifiable outcomes proving completion>
   - **Acceptance Check:** start from the `Check:` sketch of each AC in **Satisfies** (the spec-time oracle — action + expected observable result), then *specialize* it into the exact targeted command/action against the live codebase (curl/CLI/headless-browser/script) with its expected observable result. Quote the sketch first, then the concretized command — never invent an oracle the spec didn't sketch (a missing/unsketched `Check:` is a spec gap → escalate to spec revision, don't improvise one). Or `deferred — <why + which later task/gate makes it observable>` when the slice is not independently runnable yet.
   ```
2. **Review** the returned diff: hand a `reviewer` subagent the task-brief (expected behavior) + the task's TDD note (its `test` column in `plan.toon`) + the diff file. Capture that diff from the recorded `TASK_BASE` (never `HEAD~1`, which truncates multi-commit tasks; never the branch-wide `base:` — that's `gsd-verify`'s scope) excluding session artifacts: `git diff $TASK_BASE -- . ':(exclude).scratch'` — a portable-handoff sync makes scratch tracked; keep it out of review. Require two verdicts: **task-compliance** (TDD test exists, passes, covers the task — per-task scope; the terminal whole-branch analogue is `gsd-verify`'s **spec-compliance**) AND **code-quality**. A `test:none` task (test-exempt per `gsd-to-plan`) drops the TDD check — task-compliance is then "the diff does the brief, nothing more".
3. **Fix loop**: Critical/Important findings → fix subagent → re-verify. Never proceed with open Critical/Important. The same finding surviving two fix rounds = a failure the fix loop can't resolve → route to `gsd-diagnosing-bugs` instead of a third identical attempt.
4. **Verify the task's behavior — two tiers, before the commit:**
   - **Unit** (always): the task's TDD test(s) green.
   - **Per-task acceptance / targeted E2E** (when the task's ACs are runnable *now*): don't wait for the terminal gate — exercise the task's own AC end-to-end at the smallest scope that proves the observable outcome (a curl against the new endpoint, a CLI invocation asserting the printed result, a headless-browser check of the new UI path, a script replaying the user action). A failing/un-runnable-yet-expected acceptance check blocks the task exactly like a Critical finding — loop back to the fix step; never commit or mark `done` past it. This is *targeted* — only this task's ACs, not the whole user journey.
   - **Explicit deferral** (when the task is not independently runnable — internal API, shared helper, partial slice whose AC only becomes observable after a later task): state `Acceptance Check: deferred — <why + which later task/gate makes it observable>` in the task-brief and echo it in the terminal progress line. Do NOT encode it in the `plan.toon` `status` cell — `status` is the fixed enum `pending/in_progress/done/superseded` and `|` is the field sub-separator; overloading it corrupts resume/done detection. Durability does not depend on a per-task note: the terminal `gsd-verify` gate re-checks **every non-superseded AC that is runtime-observable** over the merged branch (below), so a deferred slice is structurally guaranteed to be exercised before merge — it cannot silently vanish. Deferral must still be a stated decision, never a silent skip.
   - **Whole-journey E2E stays terminal.** The end-to-end *user journey* over the merged branch is owned by the `gsd-verify` acceptance/E2E gate (run once before the `<base>` merge). Its durability guarantee is AC-based, not marker-based: every deferred slice's AC lives in `spec.md`, and the gate re-verifies **every non-superseded AC that is runtime-observable** — so a deferred acceptance check is re-exercised there whether or not any note survived. Per-task acceptance proves each slice as it lands; the terminal gate proves they compose. The two are complementary, not duplicative.
5. **Commit** to `wip/<feature>` — code only, and only after step 4 is green (or its deferral recorded): never stage `.scratch/` in a task commit (the ledger update in the working tree is enough; `gsd-handoff`'s portable sync commit is the sole exception). Never commit <base> during execution. **Autosync on** (handoff `settings[]`) → use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics scratch sync: after the task commit, sync scratch iff dirty, then **always** `git push`; No remote → skip the sync/push and stay machine-local (graceful degradation per `gsd-handoff` § Portable), don't error the task loop.

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
 If a merge, cherry-pick, or apply fails due to merge conflicts, follow [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics → Conflict handling. Do NOT treat it as a code bug (do not route to `gsd-diagnosing-bugs`); if too complex to resolve mechanically, abort when possible and surface it to the user (or the parent agent, e.g. via `irc` where the harness has one) using the blocker template.


## Never
- Commit <base> during execution.
- Skip per-task verify, or accept a report missing either verdict.
- Parallel `task` subagents on shared code. Hand a subagent its task-brief, not the whole plan.
- Re-dispatch a task the ledger marks done.
- Prompt, ask, emit `Next steps:`, or menu mid-pipeline after plan approval — auto-pilot runs per the canonical post-approval pipeline contract and Contextual disclosure templates to merge or to a blocker.
- Merge past a red gate: a blocker stops and reports, never auto-merges anyway.

## Contextual disclosure
Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. In the approved pipeline, use only the Post-approval pipeline progress template for status and the Blocker stop template when stopping; inline firing appends nothing. Direct invocation outside the pipeline uses Direct sub-skill Next steps.
