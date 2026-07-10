---
name: gsd-executing-plans
description: Internal GSD sub-skill (routed via /gsd). Execute implementation plan(s) — dispatch a fresh `task` subagent per task, per-task verify, then the terminal `gsd-verify` gate. Triggered after `gsd-to-plan` (reads `.scratch/<feature>/plan.toon`).
triggers: plan exists, pending/in-progress (gsd Route 3)
produces: [plan.toon]
consumes: [plan.toon, spec.md]
---

# Executing Plans

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract: select an Invocation Mode below before validating only that row's Required artifacts, then follow its Missing required action. A missing Optional artifact never reroutes the invocation.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Normal plan execution | `plan.toon`; `spec.md` | — | `plan.toon` (progress status updates) | Missing `plan.toon`: STOP and recover or block through `/gsd` state detection. Missing `spec.md`: STOP through Spec escalation, revise in `/gsd` Discussion, and re-plan. Never dispatch a task or synthesize either state |

Dispatch a fresh `task` subagent (the implementer) per task, verify each, then a terminal gsd-verify. Markdown-skill authoring and trivial edits are done directly (skip this).

## Auto-pilot (canonical contract implementation)
Entering this skill means the plan is **already approved** (gsd-to-plan's approval gate — the last prompt of the cycle). Implement [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Post-approval pipeline contract locally and disclose only via [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates → Post-approval pipeline progress or Blocker stop: no questions, confirmations, or end-of-response menus — and no `Next steps:` — between tasks, before the terminal `gsd-verify` gate, or before the squash merge. Report progress (task started/committed, verdicts, findings fixed) — visibility stays, prompts go. Stop only for this skill's blockers: spec escalation, a merge conflict too tangled to resolve mechanically, a fix loop that can't converge (→ `gsd-diagnosing-bugs`), or a failing terminal verify that survives its fix loop. A blocker stop reports what blocked and why — it never silently merges.
Before reporting any hard-blocker or verify-fail stop, apply the normative Ponytail stop transition: preserve `explicit_level`, set `auto_scope=none`, and report the blocker without another prompt. A later resume reclassifies the same fix and may auto-fire anew; it never inherits stale `auto_scope`.

 ## Intake
 Read the consolidated plan `.scratch/<feature>/plan.toon` (skip the `schema:v1` header and `base:` line; tasks start at the `plan[` table). Tasks run sequentially. Do not dispatch parallel tasks on shared code.
 Read `.scratch/<feature>/spec.md` as the required behavior/design contract before the first dispatch. Its absence follows the mode row's Spec escalation path; it is not a quick-fix execution mode and no AC or design state may be invented.
 **Branch** (if not on `wip/<feature>` yet): follow [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics. If the branch already exists (resume/rerun), `git checkout wip/<feature>`. Otherwise create from authoritative `base:` with `git checkout -b wip/<feature> <base>`; never recapture when `base:` is present. Old plan missing `base:` → use the canonical base-detection ladder, then persist `base:<base>` immediately after `schema:v1` before continuing.
**Pre-approval document ownership gate:** before the first dispatch, verify that every exact pre-approval domain path returned by `gsd-domain-modeling` appears in exactly one named task's `files`. A missing or multiply owned path is an invalid approved plan: stop before dispatch under the blocker contract rather than committing it from `<base>` or inventing a generic documentation commit. The named task owns and commits the tracked project document.

## Per task
1. **Dispatch** a fresh `task` subagent with a single deterministic task-brief (not the whole plan, not prior history). Record `TASK_BASE=$(git rev-parse HEAD)` before dispatch — the review-diff base for this task. The task-brief must be constructed at dispatch time (ensuring it matches the live codebase state) using the following structured template. **Important rules for dispatcher:** fields may be `none/unknown` and the dispatcher MUST NOT invent design decisions when `spec.md` lacks `Design & Invariants`. It must only quote `spec.md` and current codebase facts. If a missing design decision is load-bearing, STOP and escalate to spec revision (route back to `gsd` Discussion to revise `spec.md` and re-plan) rather than inventing it inline.
   `Ponytail Level` is mandatory on every fresh implementation task-brief. At dispatch time copy only `explicit_level` restored/set by `/gsd`: `lite`, `full`, or `ultra`; if `explicit_level=none` (including after stop), write `none`. Never infer a level from the task, plan, wording, or a quick-fix `auto_scope`, and never propagate `auto_scope`. Re-dispatches derive the field again from the current `explicit_level` rather than inventing or remembering an auto-fired level.
   Before dispatch, parse the actual non-superseded AC ID set from `spec.md`; every row must have a nonempty, duplicate-free `satisfies` list containing only those IDs, and the complete plan union must cover them. Missing/duplicate/unknown IDs (for example `AC-404`) or extra/conflicting pins stop for re-plan/Spec escalation.
   Validate the selected public test seam at dispatch. When an AC pin is present under `Design & Invariants` → `Shared Interfaces`, compare the row's existing `test` path against that exact seam pin for every satisfied AC; every pin in one row must share the exact path and lower-seam reason. Use the live test layout only to confirm that the pinned seam still exists, is public/deterministic, remains highest usable, and observes the production entrypoint named by the AC/`Check:`. A present missing/mismatched/duplicate/conflicting pin is an invalid plan/spec → stop and re-plan or Spec-escalate.
   **Legacy no-pin compatibility:** do not deadlock an existing pre-contract spec solely because that pin is absent. Treat the existing plan row `test` as the proposed seam and validate it against the AC's concrete `Check:` plus the live layout. At the highest usable tier, select the named production entrypoint first, then the repository's canonical existing harness/project convention, then greater production-path coverage with no test-only bypass. A remaining tie is materially ambiguous → stop in Discussion. If the proposed row seam wins, proceed and record `Lower-Seam Reason: none`; if it is lower, require a valid concrete reason already present in the existing spec or stop to re-plan/Spec-escalate. Never invent behavior or a reason, derive a replacement decision from live code, silently substitute another seam, or invent a test-only seam.
   A copied lower-seam reason is not self-validating: compare its claimed cause with the live higher-seam facts. “Absent” is valid only when no existing public higher-boundary harness exists; when one exists but is nondeterministic or cannot deterministically isolate the AC, the reason must say that instead. A stale/contradictory cause is a spec gap → Spec-escalate rather than rewriting the reason at dispatch.
   ```markdown
   # Task Brief: <ID> - <Task Description>
   ## Context & Objectives
   - **Task:** <The 5-8 word task description>
   - **Ponytail Level:** <lite|full|ultra|none, derived only from the active explicit toggle>
   - **Satisfies:** <verbatim text of ACs from spec.md that this task satisfies>
   - **Design & Invariants:** <Design, invariants, non-goals, and shared interfaces quoted from spec.md if present; else "none">
   - **Target Files & Interfaces:** <files from plan.toon, plus specific functions/interfaces/classes to create or modify if already defined or obvious from codebase; else "unknown">
   ## Implementation Scope
   - **Requirements:** <exact behavioral changes needed to satisfy the ACs in these files, quoting spec/code facts only; else "none">
   - **Invariants:** <conditions/rules that must remain true, quoting spec/code facts only; else "none">
   - **Non-Goals:** <what NOT to do / scope exclusions from spec.md; else "none">
   - **Required Behavior Layers:** <the exact layers derived from the AC and live codebase; no universal layer list>
   - **Emitted Task Layers & Owned Files:** <exactly every required layer, with at least one owned affected file per layer>
   - **Green Verification Obligation:** <the exact focused check/command execution must run after implementation; do not predict its result at dispatch>
   - **Migration Safety:** <for ordinary work, "not applicable"; for Expand, backward-compatibility evidence; for each Migrate, bounded scope + both-seams-working evidence; for Contract, complete caller/reference inventory + consumer migration or completed compatibility/deprecation obligation>
   ## Verification & Done Criteria
   - **Public Test Seam:** <the exact existing public seam pinned in `Shared Interfaces` and shared by every AC in **Satisfies**; for a legacy no-pin spec, the validated existing plan-row `test`; validate against each AC `Check:`, the live layout, and deterministic tie-break>
   - **Lower-Seam Reason:** <copy the spec's concrete higher-boundary absence or deterministic-isolation failure verbatim; `none` when the selected seam is highest, including a validated legacy no-pin row>
   - **Focused TDD Test/Path:** <focused automated test path or self-check from plan.toon; may be unit, integration, CLI, focused browser, or focused HTTP>
   - **Test Command:** <exact focused test run command>
   - **Done Criteria:** <observable/verifiable outcomes proving completion>
   - **Acceptance Check:** start from the `Check:` sketch of each AC in **Satisfies**; it must be the concrete spec-time oracle in canonical `action → expected observable result` form. “Concrete” means the action names the actual operation/input at the selected seam and the expected side names the observed subject plus an explicit state/value; domain-noun padding around generic work/pass prose is invalid. For Expand/Migrate, separately invoke or exercise each old and new seam and expect a positive observed result from each—merely mentioning one or using unsafe positive-sounding prose fails. Then *specialize* the sketch into the exact targeted command/action against the live codebase (curl/CLI/headless-browser/script) with its expected observable result. Quote the sketch first, then the concretized command — never invent an oracle the spec didn't sketch. Empty/TBD/TODO/vague checks are invalid, and a missing/unsketched `Check:` is a spec gap → escalate to spec revision, don't improvise one. Or `deferred — <why + which later task/gate makes it observable>` when the otherwise complete slice is not independently runnable yet.
   ```
2. **Review** the returned diff: hand a `reviewer` subagent the task-brief (expected behavior) + the task's TDD note (its `test` column in `plan.toon`) + the diff file. Capture that diff from the recorded `TASK_BASE` (never `HEAD~1`, which truncates multi-commit tasks; never the branch-wide `base:` — that's `gsd-verify`'s scope) excluding session artifacts: `git diff $TASK_BASE -- . ':(exclude).scratch'` — a portable-handoff sync makes scratch tracked; keep it out of review. Require two verdicts: **task-compliance** (TDD test exists, passes, covers the task — per-task scope; the terminal whole-branch analogue is `gsd-verify`'s **spec-compliance**) AND **code-quality**. A `test:none` task (test-exempt per `gsd-to-plan`) drops the TDD check — task-compliance is then "the diff does the brief, nothing more".
   Public-seam compliance is part of **task-compliance**: the reviewer verifies that the named seam already exists, is public and deterministic for the AC, matches the task's focused TDD test, is the deterministic same-tier winner, and is the highest usable seam; any lower choice has the recorded concrete reason. A new test-only interface, an unexplained lower seam, an ordinary layer-only or incomplete required-layer slice, or an unjustified Expand/Migrate/Contract stage is an Important finding.
   When Shared Interfaces contains pins, the reviewer compares the brief's seam/reason against every satisfied AC's exact pin; missing, duplicate, unknown, extra, conflicting, or mismatched pins require re-plan/Spec escalation. For an existing legacy no-pin spec, the reviewer instead verifies the proposed plan-row `test` through the AC `Check:` and live tie-break, accepting `Lower-Seam Reason: none` only at the highest seam and requiring an existing spec reason below it. The reviewer never fabricates a missing pin or silently replaces the row seam.
   A copied reason whose absence-versus-deterministic-isolation cause contradicts the live higher-seam state is an Important task-compliance finding; the reviewer never repairs that spec decision inline. The reviewer also verifies exact required-layer/file coverage, the returned implementation's recorded focused-check result, and stage safety: Expand backward-compatible; every bounded Migrate keeps both seams working; Contract's explicit inventory check proves repository callers/references gone and consumer migration/obligation complete. External consumers without evidence or unknown ownership keep the old seam and defer Contract behind a later precise milestone/evidence gate.
3. **Fix loop**: Critical/Important findings → fix subagent → re-verify. Never proceed with open Critical/Important. The same finding surviving two fix rounds = a failure the fix loop can't resolve → route to `gsd-diagnosing-bugs` instead of a third identical attempt.
4. **Verify the task's behavior — two tiers, before the commit:**
   Planning supplies only the green-verification obligation; it never predicts a pass. Step 4 runs that obligation after implementation and records the verified-green fact before the row lands or any later migration stage begins.
   Every ordinary behavior task must cover exactly the behavior/codebase-derived required layers, own a file per required layer, and be independently runnable and green. Every ordered Expand/Migrate/Contract row also supplies and verifies a green fact; false, missing, or knowingly red intermediate state blocks. Before Contract, verify its caller/reference inventory and consumer evidence again; unknown ownership or unmet external-consumer obligations retain the old seam. Explicit acceptance deferral is exceptional and defers only the runtime acceptance action: the focused TDD test, verified-green fact, stage-safety facts, and both reviewer verdicts still must pass. Never use deferral for an ordinary `DB`/`service`/`API`/`all tests` layer row or any slice omitting a required layer.
   - **Focused TDD test** (always): run the row's selected-seam focused automated test/path/self-check to green and record the exact command/result as its verified-green fact before commit or any later migration stage. It may be unit, integration, CLI, focused browser, or focused HTTP; “focused” means this task's boundary behavior, not a whole-journey run.
   - **Per-task acceptance / targeted E2E** (when the task's ACs are runnable *now*): don't wait for the terminal gate — exercise the task's own AC end-to-end at the smallest scope that proves the observable outcome (a curl against the new endpoint, a CLI invocation asserting the printed result, a headless-browser check of the new UI path, a script replaying the user action). A failing/un-runnable-yet-expected acceptance check blocks the task exactly like a Critical finding — loop back to the fix step; never commit or mark `done` past it. This is *targeted* — only this task's ACs, not the whole user journey.
   - **Explicit deferral** (only when an otherwise complete vertical behavior slice cannot run its acceptance action until a named later integration/environment gate, or when a green and semantically safe Expand/Migrate/Contract stage's contract becomes observable at a named later task/gate): state `Acceptance Check: deferred — <why + which later task/gate makes it observable>` in the task-brief and echo it in the terminal progress line. An internal helper/API or incomplete ordinary slice is not eligible — re-plan it into a complete behavior. Do NOT encode deferral or safety facts in the `plan.toon` `status` cell: `status` remains `pending/in_progress/done/superseded`. The focused TDD test and both reviewer verdicts still pass now; the terminal `gsd-verify` gate re-checks every non-superseded runtime-observable AC.
   - **Whole-journey E2E stays terminal.** The end-to-end *user journey* over the merged branch is owned by the `gsd-verify` acceptance/E2E gate (run once before the `<base>` merge). Its durability guarantee is AC-based, not marker-based: every deferred slice's AC lives in `spec.md`, and the gate re-verifies **every non-superseded AC that is runtime-observable** — so a deferred acceptance check is re-exercised there whether or not any note survived. A focused per-task boundary test proves one row as it lands; the terminal whole-journey E2E proves the rows compose. The two are complementary, not duplicative.
5. **Commit** to `wip/<feature>` — task-owned changes only, including any certain in-scope domain document written through `gsd-domain-modeling`, and only after step 4 is green (or its deferral recorded): never stage `.scratch/` in a task commit (the ledger update in the working tree is enough; `gsd-handoff`'s portable sync commit is the sole exception). Never commit <base> during execution, and never make an unplanned generic documentation commit. **Autosync on** (handoff `settings[]`) → use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics scratch sync: after the task commit, sync scratch iff dirty, then **always** `git push`; No remote → skip the sync/push and stay machine-local (graceful degradation per `gsd-handoff` § Portable), don't error the task loop.
   **Tracked-document scope:** every tracked project document named by this task's `files` is task-owned and committed with the task. Here “code only” excludes scratch and session artifacts, not intentional tracked project documents. Never omit an owned document or move it to a generic/unowned documentation commit.

> **Subagent failure** (no diff / errored — not a verify finding): re-dispatch with a sharper brief. Repeats → route to `gsd-diagnosing-bugs` (real blocker, not unfinished work).
> **No subagents in the harness** (no `task`/`reviewer` tool): degrade per gsd Conventions — implement the task yourself inline, then run the review as a separate self-contained pass against the same task-brief and both verdicts. Degraded self-review keeps the same blocking semantics: open Critical/Important still stops the loop.

## Post-approval context harvest
Execution is already routed and approved, so context harvesting is optional and task-scoped. Reuse the task brief plus code/docs already relevant to the task; do not scan the repository or create missing domain scaffolds. Only a recurring project-specific term or explicit decision/rationale signal permits narrow supporting reads and an inline `gsd-domain-modeling` invocation. That skill remains the sole writer and applies map selection, ADR evidence gates, and dedupe.

- **Certain, in scope:** let `gsd-domain-modeling` create/update the one evidenced artifact, return its exact changed path, and include it in the owning task commit under step 5. It is a task-owned tracked project artifact, not `.scratch/`, and “code only” excludes scratch and session artifacts, not intentional tracked project documents.
- **Uncertain:** ask zero documentation questions. If the ambiguity changes an AC, interface, or invariant, or prevents correct implementation, STOP through **Spec escalation** below; otherwise make the documentation outcome no-op and continue implementation.
- **No durable signal:** no-op; missing docs never cause extra reads, writes, or a separate documentation task/commit.

## Spec escalation
If a task reveals an **acceptance criterion is itself wrong/incomplete** (not a code bug — the spec contradicts real intent, or is impossible/ambiguous), STOP the task. Do not patch code to fit a flawed criterion. Route back to `gsd` (Discussion) → revise `spec.md` → re-plan the affected tasks under **fresh IDs**, marking the ledger entries they replace as **superseded** — so a spec revision that invalidates an already-done task is re-dispatched, not blocked by the dedup rule. (Distinct from the fix loop, which fixes code not matching a correct spec.)

## Auto-triggers
- `gsd-tdd` — for the focused TDD test/path or self-check each task specifies.
- `gsd-diagnosing-bugs` — when a task is blocked by a real bug/regression, not just unfinished.
- `gsd-handoff` — on compaction/resume (read the progress ledger first).
- `gsd-domain-modeling` — only when already-relevant task evidence reveals a recurring project-specific term or explicit decision/rationale signal; apply Post-approval context harvest.
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
