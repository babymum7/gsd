---
name: gsd-verify
description: Terminal commit gate, invoked by `gsd-executing-plans` (or directly for quick-fix). Dispatch a `reviewer` subagent over the full WIP-branch diff; block the main commit on Critical/Important findings. Two verdicts — spec-compliance + code-quality.
---

# Verify

The gate before a WIP branch merges to main. Dispatch a **reviewer** subagent (or any available code-review agent in your harness) over the full `wip/<feature>` diff and require two verdicts: **spec-compliance** (every acceptance criterion in `spec.md` met + every task's TDD test green + no code outside the plan) and **code-quality** (universal standards: correctness, security, dead code, `AGENTS.md` conventions). No `spec.md` (quick-fix/trivial path) → spec-compliance is N/A; judge code-quality + that the diff matches the stated fix (no scope creep).

 ## Run
 1. Capture the full WIP diff against main: `git diff main...wip/<feature>` → a uniquely-named file.
 2. Dispatch a `reviewer` subagent with the diff file + `.scratch/<feature>/spec.md` + `.scratch/<feature>/plan.toon`.
 3. Compile the verify findings and invoke `/gsd-lavish` to present the verify report visually to the user.
 4. Critical/Important findings block the commit; Minor are logged.
## Outcomes
- **Pass** (no open Critical/Important) → squash `wip/<feature>` → single commit to main. Optionally archive/remove `.scratch/<feature>/` (keep if you want an audit trail).
- **Fail** → route back to `gsd-executing-plans` (fix subagent on the specific findings), then re-verify.
 - **Spec flawed** — an acceptance criterion is itself wrong/incomplete (contradictory, or correctly met yet obviously wrong): do NOT pass. Route back to `gsd` (Discussion) → revise `spec.md` → re-plan. (Distinct from Fail: Fail fixes code against a correct spec.)

## Auto-triggers
- `gsd-lavish` — the verify report is a substantial deliverable; render it visually if the user wants.

E2E (UI/UX features only) is not a skill — run it ad-hoc (manual or the harness browser tool) after this gate passes, before relying on the commit.

 ## Contextual disclosure (AXI Style)
 At the end of every response, always append a `Next steps:` block suggesting the specific commands or triggers, e.g.:
 ```
 Next steps:
 - /gsd (if spec/design needs revision or to save progress)
 - git checkout main (to merge when verify passes)
 ```
