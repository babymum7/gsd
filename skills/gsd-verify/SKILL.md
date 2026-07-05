---
name: gsd-verify
description: Internal GSD sub-skill (routed via /gsd). Terminal commit gate, invoked by `gsd-executing-plans` (or directly for quick-fix). Dispatch a `reviewer` subagent over the full WIP-branch diff; block the <base> commit on Critical/Important findings. Two verdicts — spec-compliance + code-quality.
triggers: diff/PR review (gsd Route 2); terminal after gsd-executing-plans; quick-fix gate
produces: []
consumes: [spec.md, plan.toon]
---

# Verify

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Invoked standalone with its `consumes:` artifacts missing → load the `gsd` skill and enter through its router (it detects workspace state); don't improvise missing context.

The gate before a WIP branch merges to <base>. Dispatch a **reviewer** subagent (or any available code-review agent in your harness) over the full `wip/<feature>` diff and require two verdicts: **spec-compliance** (every non-superseded acceptance criterion in `spec.md` met + every task's TDD test green + no code outside the plan — whole-branch terminal scope; the per-task analogue is `gsd-executing-plans`' **task-compliance**) and **code-quality** (universal standards: correctness, security, dead code, `AGENTS.md` conventions). No `spec.md` (quick-fix/trivial path) → spec-compliance is N/A; judge code-quality + that the diff matches the stated fix (no scope creep).
No `reviewer` subagent in the harness → degrade per gsd Conventions: run the review yourself as a separate self-contained pass with the same two verdicts. Degraded self-review keeps the same blocking semantics — Critical/Important findings still block — and the report names itself self-review.

## Standalone review (Route 2 — pasted diff / PR / named range)
No `.scratch/`, no WIP branch, nothing to merge → **review-and-report only, read-only**. Take the diff as given (pasted, or `git diff <range>` when the prompt names one), dispatch the reviewer with it, and require code-quality + **intent-compliance** (the diff does what its description claims — no spec.md to check). Report the findings; skip everything below — Run's branch mechanics, the whole-branch build, the E2E gate, and the squash/merge Outcomes apply only to the WIP-branch gate.

 ## Run
 1. Read `<base>` from the `base:` line in `.scratch/<feature>/plan.toon` (or detect per gsd Conventions if absent). Capture the full WIP diff excluding session artifacts: `git diff <base>...wip/<feature> -- . ':(exclude).scratch'` → a uniquely-named file (keeps portable-handoff syncs out of the reviewer's diff).
 2. Dispatch a `reviewer` subagent with the diff file + `.scratch/<feature>/plan.toon` (starts with `schema:v1` + `base:` metadata; the `plan[` table is the task data) (+ `.scratch/<feature>/spec.md` if it exists — quick-fix has none).
 3. Compile the verify findings and present them in the terminal by default. Offer a browser-reviewed `gsd-lavish` report only if the user opts in — lavish is opt-in, never assumed (Fire gate).
 4. Critical/Important findings block the commit; Minor are logged.
 5. **Whole-branch green**: run the project's full build + test suite once over the merged branch state (not just the per-task tests). A red build or suite blocks the merge like a Critical finding. No build/test tooling exists → say so explicitly.
## Outcomes
- **Pass** (no open Critical/Important) → **E2E gate first for UI/UX or user-facing features**: this reviewer pass is unit-level, so before merging run the end-to-end user path (harness browser tool, or a manual script when no browser) and assert the actual user-facing outcome — a failing/un-runnable E2E blocks the merge exactly like a Critical finding. Pure non-UI changes (libs, internal APIs, refactors) are E2E-exempt — say so explicitly. Then squash `wip/<feature>` → single commit to <base>; before that final commit, run `git rm -r --cached --ignore-unmatch .scratch/<feature>` (safe no-op unless a portable handoff tracked it) and confirm nothing under `.scratch/` is staged — scratch never lands on `<base>`. Optionally archive/remove `.scratch/<feature>/`.
  - **Stale <base>**: if `<base>` advanced while the feature was in flight, the squash-merge may conflict. Rebase `wip/<feature>` onto current `<base>` (or merge `<base>` in) and resolve before the final commit — use the `:conflicts` selector + `edit` like `gsd-executing-plans`' conflict step. Re-run this verify gate (and the E2E gate) after resolving, since the rebase introduced new code. Conflict too tangled to resolve mechanically → STOP and route back to `gsd` rather than force the merge.
- **Fail** → route back to `gsd-executing-plans` (fix subagent on the specific findings), then re-verify.
 - **Spec flawed** — an acceptance criterion is itself wrong/incomplete (contradictory, or correctly met yet obviously wrong): do NOT pass. Route back to `gsd` (Discussion) → revise `spec.md` → re-plan. (Distinct from Fail: Fail fixes code against a correct spec.)

## Auto-triggers
- `gsd-lavish` — the verify report is a substantial deliverable; render it visually if the user wants.


 ## Contextual disclosure (see gsd Conventions). Example:
 ```
 Next steps:
 - /gsd (if spec/design needs revision or to save progress)
 - git checkout <base> (to merge when verify passes)
 ```
