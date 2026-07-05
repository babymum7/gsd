# GSD Reference — load-on-demand payloads

Not needed at routing time. Load this file when the matching flow below fires (it sits next to `SKILL.md`; resolve the path per SKILL.md § Dynamic Sub-Skill Loading).

## spec.md — template & rules (Route 6 convergence)

```
# <feature>
## Context
<1-3 sentences: why this exists, current pain>
## Acceptance Criteria
- AC-1: <one verifiable outcome a reviewer can check in isolation>
- AC-2: <...>
```

Rules:
- Every AC is **checkable** ("endpoint returns 200 with `{ok:true}`", "user sees the badge") — never a task ("implement logging"). A reviewer reading only the AC knows how to confirm it.
- AC IDs are stable: `gsd-to-plan`/`gsd-verify` reference them. A spec revision re-issues fresh ACs and marks the replaced ones superseded.

## Milestones — large features

An ask that converges to many independently-shippable chunks (or would plan past ~10 tasks) is split at convergence: `.scratch/<feature>-m1/`, `-m2/`, … — each milestone a full spec→plan→verify→merge cycle landing on `<base>` before the next is specced in detail. Short-lived branches beat one giant plan; later milestones are specced against the merged reality, not a prediction. (`gsd-to-plan` enforces the same smell from its side: a plan pushing past ~10 tasks routes back here to split.)

## Post-approval pipeline contract

This is the canonical contract for the plan-approved pipeline. `gsd`, `gsd-to-plan`, `gsd-executing-plans`, and `gsd-verify` reference this section instead of restating the whole contract; each skill owns only its local implementation details.

- **Approval is the last prompt.** `gsd-to-plan` prints the inline plan summary, asks one approval question, and treats approval as the final human gate for that cycle.
- **Hands-free after approval.** On approval, execution proceeds without further questions, confirmations, menus, or offers through `gsd-executing-plans`, the terminal `gsd-verify` gate, and final integration.
- **Pass merges automatically.** A passing terminal gate runs any required E2E check first, then squash-merges `wip/<feature>` to `<base>` as one commit; there is no manual post-verify merge prompt.
- **Blockers stop and report.** The pipeline stops, reports the blocker, and does not merge for spec flaws/escalations, unresolvable conflicts, non-converging task or verify fix loops, open Critical/Important review findings, a red build/test suite, or failing/unrunnable required E2E.
- **Visibility is not prompting.** Progress, verdicts, build/test results, E2E outcomes, blockers, and the final `<base>` commit are reported in terminal; reporting never asks the user to choose the next pipeline step.

## Contextual disclosure templates

These are the canonical templates for surfacing next actions. `gsd`, `gsd-to-plan`, `gsd-executing-plans`, `gsd-verify`, and `gsd-handoff` reference this section instead of inventing local menus. Pick exactly one surface; inline sub-skill firing appends nothing.

### Master end-session menu

Use only from `gsd` discussion/resume surfaces before plan approval:
```
Next steps (reply with number or text):
1. <human outcome, e.g. Generate the implementation plan>
2. <human outcome, e.g. Audit codebase architecture>
3. <human outcome, e.g. Pause & Save progress>
```
Rules: choices are numbered, concrete, and non-technical; do not list skill commands; never include "Start executing tasks". After the plan approval question, this menu is suppressed until the pipeline merges to `<base>` or stops on a blocker.

### Direct sub-skill Next steps

Use only when a sub-skill is invoked directly/standalone and must hand control back:
```
Next steps:
- /gsd (to <resume/revise/save/continue the appropriate flow>)
```
Rules: `Next steps:` means technical commands; keep bullets minimal; do not show a numbered human menu; inline firing inside another skill's flow appends nothing.

### Post-approval pipeline progress

Use after `gsd-to-plan` approval while auto-pilot is running:
```
<phase>: <observable fact>. Next: <automatic next action>.
```
Rules: progress is status, not a choice. Do not emit `Next steps:`, numbered menus, offers, "Start executing tasks", or any prompt to continue/merge. On pass, report the squash merge to `<base>` as a completed fact.

### Blocker stop

Use when the post-approval pipeline must stop:
```
Blocked at <task/gate>: <why>.
Stopped before merge; <base> is unchanged.
Next steps:
- /gsd (to revise the spec, resume after the external fix, save progress, or choose a new path)
```
Rules: name the blocker category from the post-approval pipeline contract; never merge past it; do not add a numbered menu.

### Standalone review/report surface

Use for `gsd-verify` Route 2 or other standalone reports with no WIP merge authority:
```
Review report:
Verdict: <pass/fail/n/a>
Findings: <summary or none>
Next steps:
- /gsd (to plan fixes, save progress, or return to discussion)
```
Rules: review/report surfaces are read-only unless explicitly in the WIP-branch gate; never offer or ask to merge after a standalone report.

## Lavish opt-in gate taxonomy

This is the canonical taxonomy for `gsd-lavish` and every skill that may surface a browser-reviewed artifact. `gsd-lavish`, `gsd-to-plan`, `gsd-verify`, and `gsd-improve-codebase-architecture` reference this section instead of inventing local opt-in rules.

- **Explicit opt-in.** The user directly asks for a lavish/browser/visual report, or accepts an offered lavish surface. Explicit opt-in satisfies the consent requirement; the Fire gate must still hold before launching the browser flow.
- **Offer-eligible deliverable.** Before plan approval, a finalized standalone deliverable may offer lavish only when both Fire gate checks hold: (1) it is reviewable outside the current conversation, and (2) browser annotation adds value. Examples: substantial specs, finalized `plan.toon` summaries, standalone verify reports, architecture audits/comparisons. Inline Q&A, transient progress, and per-task diffs are never offer-eligible.
- **Post-approval pipeline no-offer mode.** After `gsd-to-plan` approval, the post-approval pipeline contract wins: do not ask, offer, menu, or pause for lavish. Use terminal progress/blocker templates only. If the user explicitly opted into lavish before or during the same session, a skill may render the relevant report without adding any new prompt; otherwise stay terminal-only.
- **Graceful terminal degradation.** Lavish is optional. Missing CLI, unavailable browser, failed lavish build, or unsuitable Fire gate degrades to the same content in terminal prose; never block, fail, or weaken the deliverable because the visual path is unavailable.

### Fire gate

Both checks must hold before launching `gsd-lavish`: (1) the artifact is a standalone, reviewable deliverable — not mid-conversation; and (2) the user gains from annotating it in a browser surface. On ambiguity, choose terminal output; outside the post-approval no-offer mode, ask only whether the user wants the lavish artifact.

## Git/base/WIP/scratch mechanics

This is the canonical mechanics reference for `gsd`, `gsd-to-plan`, `gsd-executing-plans`, `gsd-handoff`, and `gsd-verify`. Skill files reference this section instead of repeating fallback ladders; local sections may name only the step they own.

- **Artifacts and branch names.** `<feature>` is the feature slug. `.scratch/<feature>/` lives at the git repo root and contains `spec.md`, `plan.toon`, and `handoff-<n>.toon`. The WIP branch is `wip/<feature>`. `.scratch/` is git-ignored and machine-local by default; ensure the ignore entry before first scratch write.
- **Base detection.** `<base>` is the integration branch for the feature. Capture it before creating `wip/<feature>` with `BASE=$(git branch --show-current)`. If that is empty (detached HEAD) or already a `wip/*` branch, never self-reference the WIP branch; fall back in order to the `base` row in the latest handoff `settings[]` (pre-plan portable pause), `git symbolic-ref --short refs/remotes/origin/HEAD` with `origin/` stripped, `git config init.defaultBranch`, then `main`, checking for a non-empty value at each tier. Persist the chosen value as `base:<branch>` immediately after `schema:v1` in `plan.toon`; on resume, execution, and verify, `base:` is authoritative. Nano-fix has no branch/merge and needs no `<base>`.
- **WIP branch lifecycle.** `gsd-to-plan` writes `plan.toon` with `schema:v1` then `base:<base>`. `gsd-executing-plans` checks out an existing `wip/<feature>` on resume/rerun; otherwise it creates `wip/<feature>` from the authoritative `base:` (`git checkout -b wip/<feature> <base>`). If an old plan lacks `base:`, capture `<base>` with the canonical ladder and insert it immediately after `schema:v1` before continuing. During execution, commit only to `wip/<feature>`; never commit `<base>` until `gsd-verify` passes.
- **Scratch sync and strip.** Portable handoff is the only intentional path that tracks `.scratch/`: commit `.scratch/<feature>/` on `wip/<feature>` with `git add -f` and a pathspec'd handoff commit, then always `git push -u origin wip/<feature>` so code commits travel even when scratch is clean. Autosync uses that same path after handoff writes and task commits: sync scratch iff dirty, but push unconditionally. Review diffs exclude scratch (`':(exclude).scratch'`). Before the final squash commit, `gsd-verify` strips portable scratch with `git rm -r --cached --ignore-unmatch .scratch/<feature>` and confirms nothing under `.scratch/` is staged, so scratch never lands on `<base>`.
- **Final integration.** A passing WIP gate runs the required E2E check first, then squash-merges `wip/<feature>` to `<base>` as one commit using the exact local sequence owned by `gsd-verify`: checkout `<base>`, `git merge --squash wip/<feature>`, strip cached scratch, confirm staged scratch is empty, then `git commit`.
- **Conflict handling.** Merge/cherry-pick/apply conflicts are not code bugs. Locate conflicted files with `git status`, inspect markers with the `read` tool's `:conflicts` selector, and do not route to `gsd-diagnosing-bugs`; resolve with `edit` while removing `<<<<<<<`, `=======`, and `>>>>>>>`, then `git add` resolved files. If the conflict is too tangled to resolve mechanically, abort the operation when possible and stop with the canonical Blocker stop; do not force the merge. After resolving a stale-`<base>` rebase/merge, rerun `gsd-verify` and any required E2E before final integration.


## Feature cleanup — safe flow

"abandon/drop/delete feature X" → confirm name → read `<base>` from plan.toon → `git checkout <base>` (can't delete a branch you're on) → `git branch -d wip/<feature>` (safe delete; only `-D` after explicit force-confirm if unmerged) → `rm -rf .scratch/<feature>/`. If `git status --short` is dirty, warn before proceeding.
