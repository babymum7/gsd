# GSD Reference — load-on-demand payloads

Not needed at routing time. Load this file when the matching flow below fires (it sits next to `SKILL.md`; resolve the path per SKILL.md § Dynamic Sub-Skill Loading).

## Artifact Contract

This is the single canonical runtime meaning of skill artifacts. Frontmatter stays deliberately flat and parseable:

- `consumes: [...]` is the catalog union of repository artifacts that any invocation mode of the skill may read, including Optional and Fallback artifacts.
- `produces: [...]` is the catalog union of repository artifacts that any invocation mode may create or update.

Those arrays are discovery metadata, not runtime preconditions. Do not add nested workflow YAML, a manifest, or a parser. Runtime requirements belong to the selected mode's local table.

Artifact roles are evaluated per Invocation Mode:

- **Required** — authentic state that must exist before that mode can run. If it is absent, use the row's recovery, reconstruction, or blocker path; never invent the artifact or its contents.
- **Optional** — useful context when present. Absence is normal: continue without it, and never redirect to `/gsd` merely because it is missing.
- **Produced** — state the mode is authorized to create or update. It need not exist on entry and may be created lazily when the mode actually has content to persist.
- **Fallback** — durable evidence explicitly named by a recovery path to reconstruct missing Required state. Use it only for that documented reconstruction; if it cannot establish the state, block or recover through `/gsd` rather than fabricate it.

Apply the contract in this order:

1. Select the target skill and its **Invocation Mode** from explicit intent and entry context. On resume, preserve the handoff's open `mode` and `phase` values. Artifact presence may inform routing, but never infer the mode solely from `spec.md` or `plan.toon`.
2. Load the skill and validate only that mode's **Required** artifacts.
3. Treat missing **Optional** and not-yet-created **Produced** artifacts as normal.
4. For a missing **Required** artifact, execute the row's **Missing required** action. Reconstruction may use a named **Fallback**; otherwise recover once or stop with a blocker. No skill synthesizes workflow state to make validation pass.

Every local invocation-mode table uses this interface exactly:

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| `<mode selected from the invocation>` | `<artifacts or —>` | `<artifacts or —>` | `<artifacts or —>` | `<recovery, reconstruction, blocker, or —>` |

The rows are instance data only; this section owns their semantics. Tables list repository artifacts, use `—` for none, and name any Fallback inside **Missing required**.

## spec.md — template & rules (Route 6 convergence)

```
# <feature>
## Context
<1-3 sentences: why this exists, current pain>
## Design & Invariants (Optional)
- **Constraints/Invariants**: <conditions/rules that must remain true, e.g. "Do not add new dependencies", "Keep memory allocations to zero in critical paths">
- **Non-Goals**: <what NOT to do, e.g. "No need to implement retry logic for this phase">
- **Shared Interfaces**: <the public seams/methods/types decided during Discussion; for every AC, record its exact selected test seam/path and `Lower-Seam Reason: none` when it is highest, or the concrete causal lower-seam reason>
## Acceptance Criteria
- AC-1: <one verifiable outcome a reviewer can check in isolation>
  - Check: <acceptance-check sketch in canonical `action → expected observable result` form, e.g. "POST /login with a wrong password → 401 + `{error:'invalid'}`". Empty text and TBD/TODO/placeholder prose are ineligible. A sketch, not a runnable command; the exact command is finalized in the dispatch-time task-brief.>
- AC-2: <...>
  - Check: <...>
```

Rules:
- Every AC is **checkable** ("endpoint returns 200 with `{ok:true}`", "user sees the badge") — never a task ("implement logging"). A reviewer reading only the AC knows how to confirm it.
- AC IDs are stable: `gsd-to-plan`/`gsd-verify` reference them. A spec revision re-issues fresh ACs and marks the replaced ones superseded.
- **Design & Invariants** (optional section) captures only durable decisions, constraints, and non-goals decided during Discussion, not speculative implementation steps. Its absence means "none" (no extra constraints), and does not grant license to infer design details at dispatch-time.
- **ACs pin the final behavior — the convergence contract.** Each AC states an observable outcome (a user-visible result, a return value, a state transition) precise enough that any implementer, regardless of model or approach, converges to the *same* end behavior even if the code differs. Creativity belongs in Discussion (exploring approaches, suggesting design); once an AC is written it is a fixed target, not a suggestion. Vague ACs are the root cause of divergent results across agents — sharpen the AC, don't over-specify the implementation.
- **Every AC carries a concrete `Check:` — the acceptance-check sketch is the convergence gate.** Before an AC is written to `spec.md`, sketch the acceptance check that proves it in canonical `action → expected observable result` form. Both sides must be concrete; empty text, `TBD`, `TODO`, labels, and vague placeholder prose are not checks. If you *cannot* sketch a concrete expected result, the AC is not yet converged: stop, sharpen it in Discussion, don't write it. This is the writability test — an AC such as "user sees an error" with no stated shape/where/when is not ready. The sketch is a spec-time oracle proving the AC is testable and unambiguous, NOT a runnable command — the exact command is finalized against live code in the dispatch-time task-brief. `gsd-executing-plans` quotes the AC's `Check:` sketch into the task-brief's `Acceptance Check` field and specializes it there; the per-task and terminal gates use the same oracle.
- **Concrete is structural, not padded prose.** The action identifies the actual operation/input at the selected seam, and the expected side identifies an observable subject plus its explicit state/value. Repeating domain nouns around “perform work” or “works correctly” does not satisfy either side.

## Planning decomposition & precision contract

Discussion inspects the existing test layout already relevant to the feature and pins the **highest deterministic existing public seam** that can observe each AC through production behavior. Use an existing user/browser/CLI/HTTP boundary harness when it exists and can deterministically isolate the AC; otherwise use the highest existing public module API. For every new convergence, `Design & Invariants` → `Shared Interfaces` records each AC's exact selected seam/path and `Lower-Seam Reason: none` when it is highest. A lower seam is valid only when the higher boundary is absent or cannot deterministically isolate that AC, and the same pin records that concrete reason. Never create a lower public or test-only interface merely to make a test easier. An internal invariant need not be forced into E2E when the boundary cannot isolate it, but convenience is never a reason.

Resolve multiple usable harnesses at the same highest tier deterministically. First keep the harness for the production entrypoint named by the AC or its `Check:` (browser versus CLI versus HTTP). If several harnesses observe that entrypoint, prefer the repository's canonical existing harness/project convention; then prefer greater coverage of the production path with no test-only bypass. If candidates remain tied, stop in Discussion as materially ambiguous rather than choosing by array order, filename, or convenience.

At dispatch, a present AC seam pin must match the plan row's existing `test` exactly. Do not deadlock an existing pre-contract spec solely because it lacks a pin: treat that existing plan-row `test` as the proposed seam and validate it against the AC's concrete `Check:` plus the live layout and tie-break above. If it is the highest usable seam, proceed and record `Lower-Seam Reason: none` in the task brief. If it is lower, require a concrete causal reason already present in the existing spec; otherwise stop to re-plan or Spec-escalate. Never invent behavior, manufacture a reason, or silently substitute another seam.

The lower-seam reason must match the live cause: state absence only when no existing public higher-boundary harness exists; otherwise state its nondeterminism or deterministic-isolation failure. A stale or contradictory cause is a spec gap, not an acceptable copied explanation.

Each plan row's `satisfies` contains only known, unique AC IDs from the actual spec. Missing IDs, duplicates, unknown IDs, and extra/conflicting seam pins are plan/spec defects. If one task satisfies several ACs, every AC must have the same exact pinned test path and lower-seam reason. Otherwise split the behaviors into separate sequential rows; one `test` cell and one task-brief must never collapse conflicting seam decisions. The union of all non-superseded rows must still cover every non-superseded spec AC.

Ordinary implementation is decomposed into **vertical behavior slices**. Derive the required behavior layers from the AC and live codebase; UI/API/domain/storage are examples, never a universal architecture template. The emitted task must cover exactly every required layer, own at least one affected file for each required layer, include the focused automated check at the selected seam, and land green. Rows named only for a layer (`add DB`, `add service`, `add API`, `write all tests`) or a slice omitting a required layer are rejected and rewritten around behavior unless that row independently exposes and verifies a real public contract. Each behavior task is independently runnable where possible; the existing explicit acceptance deferral is an exceptional bridge to a named later task/gate, not permission to normalize a partial horizontal slice.

Use **Expand → Migrate → Contract** only for a blast-radius mechanical contract/API/schema refactor that cannot move all callers atomically while remaining green. `Expand` must be backward-compatible. Every bounded `Migrate` row must keep both old and new seams working. `Contract` may remove the old seam only after a complete caller/reference inventory proves repository references are gone and all owned and external consumers are migrated, or a precise compatibility/deprecation obligation is completed. If external consumers exist without that evidence, or consumer ownership is unknown, do not emit `Contract` now: retain the old seam and place `Contract` behind a later precise milestone/evidence gate. Its focused check must explicitly perform the caller/reference inventory and expect zero stale references. At planning, every Vertical, Expand, Migrate, and Contract row defines its concrete focused check and mandatory green-verification obligation; it never predicts a future pass. Execution runs that check and supplies the verified-green fact before the row can land or the next stage can proceed. When a candidate row/stage result is evaluated, false or missing green state fails. These semantic safety and result facts remain in the validated spec/task brief and execution review, not new `plan.toon` columns. Ordinary features never receive this sequence as ceremony.
For `Expand` and every `Migrate`, the focused action affirmatively invokes or exercises each old and new seam; merely naming, mentioning, omitting, or excluding one is not evidence. Its expected side names a positive observed result from each seam. Negative or ambiguous states do not become safe because they also contain words such as “both” or “working.”

A `Contract` row that planning emitted without surfacing blocking evidence stays bound to this same gate at execution: `gsd-executing-plans` reruns the caller/reference inventory after implementation and retains the old seam whenever an owned or external consumer is still unmigrated without a completed obligation. Planning-time deferral and this execution-time gate are one retain-until-proven rule, applied at whichever phase the blocker first surfaces.


Large-feature Discussion applies a precision gate before milestones or specs. A candidate is eligible only when it states a materially answerable precise question (not a topic label) or at least one checkable AC with a concrete `Check:` in `action → expected` form. Empty/TBD/TODO/vague checks remain unchecked. Otherwise retain exactly one concise fog/future/out-of-scope note, create no task or detailed speculative spec, introduce no tracker/map/artifact/skill, and revisit only when new evidence sharpens it. A precise question may keep a future milestone eligible for Discussion; writing `spec.md` still obeys the AC + `Check:` convergence gate above. For mixed candidates, write only the fully checked ACs and collapse every unchecked remainder into one fog/future/out-of-scope note; unchecked text never becomes an AC or task.
A materially answerable question identifies the exact decision/property to resolve and the constraint, choice, or threshold that makes the answer determinate. Domain nouns plus a copula, an open-ended “what should we do,” or a topic merely “worth discussing” remain topic labels.


### Executable planning policy scenarios (normative)

Match the explicit `Inputs`, then apply every output column. `Migrate+` means one or more bounded sequential rows. `highest-existing-deterministic-public` means the seam ladder and same-tier tie-break above, not a newly invented test API. At planning time, `each-row-focused-and-green` requires a concrete focused check plus the obligation to run it; it never requires or predicts a pass. Execution supplies the verified-green fact after implementation and blocks landing or the next stage when that candidate result is false or missing. The only artifacts named here are the existing `plan.toon` and `spec.md`; `none` creates nothing.

| Scenario | Inputs | Output | Proposal handling | Tasks/order | Test seam | Lower seam | Green/check | Artifact |
|---|---|---|---|---|---|---|---|---|
| Cross-layer user behavior | `phase=plan;kind=behavior;proposal=cross-layer;wide-refactor=no` | `vertical-behavior-slice` | `accept` | `Vertical:all-required-layers` | `highest-existing-deterministic-public` | `concrete-reason-required` | `each-row-focused-and-green` | `plan.toon` |
| Ordinary three-layer proposal | `phase=plan;kind=behavior;proposal=horizontal-layers;wide-refactor=no` | `vertical-behavior-slice` | `reject-and-rewrite` | `Vertical:all-required-layers` | `highest-existing-deterministic-public` | `concrete-reason-required` | `each-row-focused-and-green` | `plan.toon` |
| Blast-radius mechanical refactor | `phase=plan;kind=mechanical-refactor;blast-radius=wide;atomic-green=no` | `ordered-expand-migrate-contract` | `allowed-only-for-unavoidable-wide-refactor` | `Expand:backward-compatible-new-seam;Migrate+:bounded-callers;Contract:remove-old-seam` | `highest-existing-deterministic-public` | `concrete-reason-required` | `each-row-focused-and-green` | `plan.toon` |
| Precise future milestone | `phase=discussion;kind=future;precision=question-or-ac-check` | `precise-milestone-or-spec` | `eligible` | `none` | `pin-at-convergence` | `not-applicable` | `precise-question-or-checked-ACs+Check;unchecked-remainder-one-note` | `spec.md-if-AC+Check` |
| Vague future area | `phase=discussion;kind=future;precision=vague` | `one-fog/future/out-of-scope-note` | `hold-until-new-evidence` | `none` | `none` | `not-applicable` | `one-note-no-task` | `none` |

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
2. <human outcome, e.g. Review the spec visually>
3. <human outcome, e.g. Audit codebase architecture>
4. <human outcome, e.g. Pause & Save progress>
```
Rules: choices are numbered, concrete, and non-technical; do not list skill commands; never include "Start executing tasks". When the just-produced deliverable is lavish offer-eligible (clears the 2-part Fire gate — a finalized spec, plan summary, verify report, or audit), one choice MUST be the visual review, folded into this menu — never a second prompt (per § Lavish opt-in gate taxonomy). After the plan approval question, this menu is suppressed until the pipeline merges to `<base>` or stops on a blocker.

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

- **Explicit acceptance = launch consent.** The user directly asks for a lavish/browser/visual report, or accepts an offered one. Acceptance is what authorizes *launching the browser flow* — it is NOT a precondition for *asking*. The Fire gate must still hold before launch.
- **Offer-eligible deliverable → ask first, mandatory.** When a finalized standalone deliverable is offer-eligible (both Fire gate checks hold: reviewable outside the conversation AND browser annotation adds value), the surfacing skill MUST proactively ask whether to review it visually — it does not merely *may*, and it never stays silent waiting to be asked. Fold the question into the surface already being shown (the master end-session menu as one numbered choice, e.g. "Review the spec visually"; or a single inline "review this visually?" line when no menu is present) — never as a second, separate prompt. Launching waits for the user to accept; asking does not. Examples: substantial specs, finalized `plan.toon` summaries, standalone verify reports, architecture audits/comparisons. Inline Q&A, transient progress, and per-task diffs are never offer-eligible. Asking costs one menu line; the user ignores it at no cost. The failure mode this fixes: staying silent so lavish never appears unless explicitly demanded.
- **One prompt, not two.** The offer rides an existing surface; it never adds a prompt. In particular it never introduces a second question around `gsd-to-plan`'s approval — plan approval stays the last prompt of the cycle. Pre-approval, the offer is one option in the end-session menu; it is not a standalone gate.
- **Post-approval pipeline no-offer mode.** After `gsd-to-plan` approval, the post-approval pipeline contract wins: do not ask, offer, menu, or pause for lavish. Use terminal progress/blocker templates only. If the user explicitly opted into lavish before or during the same session, a skill may render the relevant report without adding any new prompt; otherwise stay terminal-only.
- **Graceful terminal degradation.** Lavish is optional. Missing CLI, unavailable browser, failed lavish build, or unsuitable Fire gate degrades to the same content in terminal prose; never block, fail, or weaken the deliverable because the visual path is unavailable.

### Fire gate

Both checks must hold before **launching** `gsd-lavish`: (1) the artifact is a standalone, reviewable deliverable — not mid-conversation; and (2) the user gains from annotating it in a browser surface. When both hold and the deliverable is offer-eligible, asking whether to review it visually is mandatory (per "Offer-eligible deliverable → ask first" above); launching still waits for the user to accept. On ambiguity about whether to *launch*, choose terminal output. Outside the post-approval no-offer mode, the ask rides the existing surface — never a second prompt.

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
