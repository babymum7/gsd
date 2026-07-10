---
name: gsd-verify
description: Internal GSD sub-skill (routed via /gsd). Terminal commit gate, invoked by `gsd-executing-plans` (or directly for quick-fix). Dispatch a `reviewer` subagent over the full WIP-branch diff; block the <base> commit on Critical/Important findings. Two verdicts — spec-compliance + code-quality.
triggers: diff/PR review (gsd Route 2); terminal after gsd-executing-plans; quick-fix gate
produces: []
consumes: [spec.md, plan.toon]
---

# Verify

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract: select an Invocation Mode below before validating only that row's Required artifacts, then follow its Missing required action. A missing Optional artifact never reroutes the invocation.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Standalone review (Route 2) | — | `spec.md`; `plan.toon` (supplied context only; no gate authority) | — | — |
| Planned WIP gate | `spec.md`; `plan.toon` | — | — | Missing `spec.md` or `plan.toon`: stop before review or merge with the Blocker stop, then recover or re-plan through `/gsd`; never fabricate either artifact |
| Quick-fix WIP gate | `plan.toon` | `spec.md` (absent by design) | — | Missing `plan.toon`: stop before review or merge, then recover the real quick-fix plan through `/gsd`; never fabricate it |

In either WIP mode, dispatch a **reviewer** subagent (or any available code-review agent in your harness) over the full `wip/<feature>` diff. Planned WIP requires **spec-compliance** (every non-superseded acceptance criterion in `spec.md` met + every task's TDD test green + no code outside the plan — whole-branch terminal scope; the per-task analogue is `gsd-executing-plans`' **task-compliance**) and **code-quality** (universal standards: correctness, security, dead code, `AGENTS.md` conventions). Quick-fix has no `spec.md`, so spec-compliance is N/A; judge code-quality + that the diff matches the stated fix with no scope creep.
No `reviewer` subagent in the harness → degrade per gsd Conventions: run the review yourself as a separate self-contained pass with the same two verdicts. Degraded self-review keeps the same blocking semantics — Critical/Important findings still block — and the report names itself self-review.

## Standalone review (Route 2 — pasted diff / PR / named range)
No `.scratch/`, no WIP branch, nothing to merge → **review-and-report only, read-only**. Take the diff as given (pasted, or `git diff <range>` when the prompt names one), dispatch the reviewer with it, and require code-quality + **intent-compliance** (the diff does what its description claims — no spec.md to check). Report the findings using [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates → Standalone review/report surface; skip everything below — Run's branch mechanics, the whole-branch build, the E2E gate, and the squash/merge Outcomes apply only to the WIP-branch gate.

## WIP-branch gate — non-interactive (post-approval pipeline)
Arriving from `gsd-executing-plans` means the plan was approved (gsd-to-plan's approval gate — the last prompt of the cycle): implement [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Post-approval pipeline contract at the terminal gate and disclose only via § Contextual disclosure templates → Post-approval pipeline progress or Blocker stop. Never ask permission to merge, never end with a menu — a **Pass** squash-merges to `<base>` automatically, per the exact sequence in Outcomes. No prompts ≠ no visibility: always report the findings, the build/suite result, the E2E outcome, and the final commit on `<base>`. Mid-pipeline, skip the lavish offer (offering is a prompt; lavish stays available on explicit request). Standalone review (Route 2, above) is unaffected — read-only, never merges. Fail / Spec flawed still stop the pipeline exactly as Outcomes says: report and route; do not ask what to do next.

Quick-fix reaches this same WIP gate with its minimal `plan.toon` and no `spec.md`. Spec-compliance is N/A, but the Run, whole-branch build, applicable behavior/E2E checks, blockers, and merge sequence still apply.

Browser artifacts follow [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Lavish opt-in gate taxonomy. In this WIP gate, post-approval pipeline no-offer mode applies: offer nothing and render only after prior explicit opt-in. Standalone review (Route 2, above) remains offer-eligible when the Fire gate holds.

 ## Run
 1. Read `<base>` from the `base:` line in `.scratch/<feature>/plan.toon` (or apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics base detection if absent). Capture the full WIP diff excluding session artifacts: `git diff <base>...wip/<feature> -- . ':(exclude).scratch'` → a uniquely-named file (keeps portable-handoff syncs out of the reviewer's diff).
 2. Dispatch a `reviewer` subagent with the diff file + `.scratch/<feature>/plan.toon` (starts with `schema:v1` + `base:` metadata; the `plan[` table is the task data) (+ `.scratch/<feature>/spec.md` if it exists — quick-fix has none).
3. Compile the verify findings and present them in the terminal by default. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Lavish opt-in gate taxonomy: pipeline mode (post-approval) is no-offer mode, so use only the Post-approval pipeline progress or Blocker stop template unless the user already explicitly opted in; direct/standalone invocation MUST surface a browser-reviewed `gsd-lavish` report option when the report is offer-eligible and the Fire gate holds, folded into the Standalone review/report surface template — never a second prompt, launch only on explicit opt-in.
 4. Critical/Important findings block the commit; Minor are logged.
 5. **Whole-branch green**: run the project's full build + test suite once over the merged branch state (not just the per-task tests). A red build or suite blocks the merge like a Critical finding. No build/test tooling exists → say so explicitly.
## Outcomes
- **Pass** (no open Critical/Important) → **acceptance/E2E gate before merge**: this reviewer pass is unit-level, so before merging exercise the behavior. Two obligations: (a) run the end-to-end user path for UI/UX or user-facing features (harness browser tool, or a manual script when no browser) and assert the actual user-facing outcome; (b) run an acceptance check for **every non-superseded AC that is runtime-observable** — this explicitly absorbs any per-task `Acceptance Check: deferred` from `gsd-executing-plans` (a slice whose AC only became observable once later tasks landed is exercised here now). A failing/un-runnable check blocks the merge exactly like a Critical finding. An AC with no runtime-observable behavior (pure internal refactor, dead-code removal) is acceptance-exempt — say which ACs are exempt and why. Then squash `wip/<feature>` → single commit to <base> per [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics — the exact sequence: `git checkout <base>` → `git merge --squash wip/<feature>` → `git rm -r --cached --ignore-unmatch .scratch/<feature>` (safe no-op unless a portable handoff tracked it) → confirm nothing under `.scratch/` is staged (`git diff --cached --name-only -- .scratch` is empty) → one `git commit`. Scratch never lands on `<base>`. Optionally remove `.scratch/<feature>/`.
  - **Stale <base>**: if `<base>` advanced while the feature was in flight, the squash-merge may conflict. Resolve via [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics → Conflict handling: rebase `wip/<feature>` onto current `<base>` (or merge `<base>` in), inspect conflicts with `:conflicts`, edit out markers, and rerun this verify gate (and the E2E gate) after resolving. Conflict too tangled to resolve mechanically → STOP and route back to `gsd` rather than force the merge.
- **Fail** → route back to `gsd-executing-plans` (fix subagent on the specific findings), then re-verify.
 - **Spec flawed** — an acceptance criterion is itself wrong/incomplete (contradictory, or correctly met yet obviously wrong): do NOT pass. Route back to `gsd` (Discussion) → revise `spec.md` → re-plan. (Distinct from Fail: Fail fixes code against a correct spec.)

## Visual-review ask
- `gsd-lavish` — the verify report is a substantial deliverable; use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Lavish opt-in gate taxonomy: standalone review MUST ask whether to review visually when the report is offer-eligible and the Fire gate holds, launching only when the user accepts; the WIP-branch gate (post-approval) is no-offer mode. Apply that section for offer eligibility, post-approval no-offer mode, and terminal degradation.


## Contextual disclosure
Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. WIP-branch gate (post-approval): no menu — use Post-approval pipeline progress to report verdicts, build/suite, E2E, and the merged commit on `<base>`; use Blocker stop for Fail/Spec flawed/conflict/red-suite stops. Route 2 standalone reviews use Standalone review/report surface and stay read-only.
