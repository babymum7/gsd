---
name: gsd-review
description: Terminal commit gate, invoked by `gsd-executing-plans` (or directly for quick-fix). Dispatch the reviewer agent over the full WIP-branch diff; block the main commit on Critical/Important findings. Two verdicts — spec-compliance + code-quality.
---

# Review

The gate before a WIP branch merges to main. Dispatch the **reviewer** agent over the full `wip/<feature>` diff and require two verdicts: **spec-compliance** (every acceptance criterion in `spec.md` met + every task's TDD test green + no code outside the plan) and **code-quality** (universal standards: correctness, security, dead code, `AGENTS.md` conventions). No `spec.md` (quick-fix/trivial path) → spec-compliance is N/A; judge code-quality + that the diff matches the stated fix (no scope creep).

## Run
1. Capture the full WIP diff against main: `git diff main...wip/<feature>` → a uniquely-named file.
2. Dispatch the **reviewer** agent with the diff file + `.scratch/<feature>/spec.md` (acceptance criteria) + the original plan(s).
3. Require both verdicts. Critical/Important findings **block** the commit; Minor are logged.

## Outcomes
- **Pass** (no open Critical/Important) → squash `wip/<feature>` → single commit to main. Optionally archive/remove `.scratch/<feature>/` (keep if you want an audit trail).
- **Fail** → route back to `gsd-executing-plans` (fix subagent on the specific findings), then re-review.
- **Spec flawed** — an acceptance criterion is itself wrong/incomplete (contradictory, or correctly met yet obviously wrong): do NOT pass. Route back to `gsd-grilling` → revise `spec.md` → re-plan. (Distinct from Fail: Fail fixes code against a correct spec.)

## Auto-triggers
- `gsd-lavish` — the gsd-review report is a substantial deliverable; render it reviewable if the user wants.

E2E (UI/UX features only) is not a skill — run it ad-hoc (manual or the harness browser tool) after this gate passes, before relying on the commit.
