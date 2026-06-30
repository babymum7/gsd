---
name: gsd-verify
description: Terminal commit gate, invoked by `gsd-executing-plans` (or directly for quick-fix). Dispatch a `reviewer` subagent over the full WIP-branch diff; block the main commit on Critical/Important findings. Two verdicts — spec-compliance + code-quality.
triggers: diff/PR review (gsd Route 2); terminal after gsd-executing-plans; quick-fix gate
produces: []
consumes: [spec.md, plan.toon]
---

# Verify

The gate before a WIP branch merges to main. Dispatch a **reviewer** subagent (or any available code-review agent in your harness) over the full `wip/<feature>` diff and require two verdicts: **spec-compliance** (every acceptance criterion in `spec.md` met + every task's TDD test green + no code outside the plan — whole-branch terminal scope; the per-task analogue is `gsd-executing-plans`' **task-compliance**) and **code-quality** (universal standards: correctness, security, dead code, `AGENTS.md` conventions). No `spec.md` (quick-fix/trivial path) → spec-compliance is N/A; judge code-quality + that the diff matches the stated fix (no scope creep).

 ## Run
 1. Capture the full WIP diff against main: `git diff main...wip/<feature>` → a uniquely-named file.
 2. Dispatch a `reviewer` subagent with the diff file + `.scratch/<feature>/spec.md` + `.scratch/<feature>/plan.toon`.
 3. Compile the verify findings and invoke `/gsd-lavish` to present the verify report visually to the user.
 4. Critical/Important findings block the commit; Minor are logged.
## Outcomes
- **Pass** (no open Critical/Important) → squash `wip/<feature>` → single commit to main. **For UI/UX features, run E2E immediately after** (manual or harness browser tool) — this gate is unit-level; E2E is the only check of the user-facing path. Optionally archive/remove `.scratch/<feature>/`.
- **Fail** → route back to `gsd-executing-plans` (fix subagent on the specific findings), then re-verify.
 - **Spec flawed** — an acceptance criterion is itself wrong/incomplete (contradictory, or correctly met yet obviously wrong): do NOT pass. Route back to `gsd` (Discussion) → revise `spec.md` → re-plan. (Distinct from Fail: Fail fixes code against a correct spec.)

## Auto-triggers
- `gsd-lavish` — the verify report is a substantial deliverable; render it visually if the user wants.


 ## Contextual disclosure (AXI Style)
Append this `Next steps:` block **only when you are the terminal/standalone response** (directly invoked or the last skill in the chain) — never when firing **inline** inside another skill's response; only the outermost response shows next-steps (`gsd` Conventions → Contextual disclosure). Example:
 ```
 Next steps:
 - /gsd (if spec/design needs revision or to save progress)
 - git checkout main (to merge when verify passes)
 ```
