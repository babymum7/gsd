# GSD Reference

Load this file only when the matching flow needs its policy. It defines the shared meaning of artifacts and lifecycle state; individual skills select an Invocation Mode before validating that mode's required artifacts.

## Artifact Contract

`consumes:` and `produces:` frontmatter are catalog unions, not unconditional prerequisites. Each multi-mode skill declares a compact Invocation modes table:

| Role | Meaning |
| --- | --- |
| Required | Must exist for the selected mode. Follow that row's recovery or blocker action when absent. |
| Optional | Normal when absent; never reroutes a mode. |
| Produced | May be created by the selected mode. |
| Fallback | The documented recovery, reconstruction, or blocker path. Never invent a file or contents. |

Choose mode from explicit intent and entry context first. Artifact presence alone never selects a mode. Preserve opaque handoff `mode` and `phase` values on resume. A missing, malformed, duplicate, or hash-mismatched **required** artifact fails closed; optional state does not.

## Durable documentation contract

Git-tracked knowledge intended for both people and agents is strict Markdown under `docs/`; TOON is never used for durable prose or human-approved goals.

- `docs/domain/index.md` is a small bounded-context index; `docs/domain/<scope>.md` shards hold durable glossary terms and architectural decisions. Shard by stable bounded context, never by feature. `gsd-domain-modeling` owns the exact schema and is the sole writer.
- `docs/gsd/<feature>/milestones.md` is the human-reviewable milestone contract and lifecycle ledger. Its goals are approved authority; its status column is controlled by terminal verification.

Runtime-only attempts, handoffs, and result markers stay TOON under `.scratch/`. A format is authoritative by its declared role and canonical path, never by extension alone.

## Canonical Markdown contract

### Authority

The sole pre-approval human/agent contract is the UTF-8/LF Markdown packet in `.scratch/<feature>/`:

- `proposal.md`
- `spec.md`
- optional `design.md`
- `plan.md`, written only by `gsd-to-plan`

The feature slug is identical in every present file. The Markdown packet is the only authority for intent, acceptance, task order, seams, files, and focused checks. Root or scratch `proposal.toon`, `spec.toon`, `design.toon`, and `plan.toon` are stale non-authoritative files: never derive scope, recovery, acceptance, or task order from them. A detected legacy packet stops normal routing with a Spec escalation, except an explicitly approved one-time bootstrap that removes it before ordinary routing resumes.

TOON remains runtime-only: immutable task attempts, handoffs, and result markers. Runtime records report progress and bind source bytes; they cannot author, amend, or reinterpret Markdown contracts or durable documentation.

### Packet grammar

All sources use exact headings, exact field labels, canonical field order, UTF-8, LF, and no blank leading/trailing lines. Reject missing, duplicate, malformed, unknown, empty, vague, or reordered required fields. Never normalize, infer, or repair source values.

`proposal.md`:

```markdown
# Proposal
## Feature
`<feature>`
## Summary
<one concrete outcome>
## Why
<user value>
## Scope
- <included behavior>
## Impact
- **<area>:** <change>
## Questions
None.
```

`spec.md`:

```markdown
# Specification
## Feature
`<feature>`
## Context
<bounded context>
## Acceptance Criteria
### AC-1: <title>
- **State:** active
- **Outcome:** <concrete behavior>
- **Action:** <concrete operation>
- **Expected:** <observable result>
## Invariants
- **I-1:** <must remain true>
## Non-goals
- **NG-1:** <explicit exclusion>
## Interfaces
| Criterion | Seam | Path | Lower-seam reason |
| --- | --- | --- | --- |
| AC-1 | <public seam> | `<repository-relative path>` | none |
```

An AC ID is a positive sequential integer. Only `active` criteria execute; a replacement receives a new ID while the former criterion is `superseded`. Outcome, Action, and Expected must independently name a concrete behavior, operation, and observable result. `TBD`, `TODO`, `works correctly`, `run tests`, `valid`, `covered`, or `success` are invalid. Every active AC has exactly one matching Interfaces row. A lower seam is valid only with a concrete reason that the higher production boundary is absent or cannot deterministically isolate the criterion.

`design.md` exists only for a resolved load-bearing decision, alternative, or risk. It has `# Design`, `## Feature`, `## Decisions`, `## Alternatives rejected`, and `## Risks and mitigations`. Its absence means no such decision; downstream work never infers one.

`plan.md`:

```markdown
# Plan
## Feature
`<feature>`
## Base
`<base>`
## Tasks
### T1: <short task>
- **Satisfies:** AC-1
- **Files:** `path/to/file`
- **Test:** `<focused command or none>`
- **Status:** pending
```

Task IDs are positive sequential integers in heading order. Every active AC appears exactly once across non-superseded task `Satisfies` fields. Every task owns at least one exact repository-relative path and one focused public-seam check unless it changes no runtime behavior. Task status is `pending`, `in_progress`, `done`, or `superseded`; the approved Markdown status is immutable after approval and is never progress evidence.

### Quick-fix plan exception

A Quick-fix is not a converged feature packet. Its direct fast path may write a minimal UTF-8/LF `plan.md` containing exactly `# Quick-fix Plan`, `## Feature`, `## Base`, and `## Tasks` with one or two task headings, each naming its files and focused check. Only the Quick-fix WIP verifier may consume it. It has no proposal/spec/design source set, no approval binding, and no normal-packet authority. Ordinary packet validation MUST NOT classify it as malformed converged state or dispatch normal execution from it; its special `gsd-verify` gate owns it until landing or a blocker.

### Approval binding

`gsd-to-plan` validates the complete packet, writes `plan.md`, prints the task/AC summary, calculates SHA-256 for every present Markdown source, and asks exactly one approval question. Approval records the feature, ordered source set, and hashes in runtime state. After approval, every dispatch, handoff/resume, reviewer, verifier, repair loop, and merge gate compares the live packet byte-for-byte with that binding. Missing, changed, extra, or malformed source is a Spec escalation. Never regenerate a new packet or derive requirements from runtime TOON.

On approval, `gsd-to-plan` immediately loads `gsd-handoff` and creates the next positive sequential execution handoff (`handoff-1.toon` when none exists). It records the approved feature, ordered source set and hashes, selected execution mode, `phase=approved`, no completed task, and `next_action` for `gsd-executing-plans`. A fresh approval after Spec escalation starts a new active binding generation in that next handoff; older handoffs remain immutable history and their old hashes are expected, not a conflict. Later task/pause handoffs continue from the newest approval binding. Execution never depends on prompt-local memory for the approval binding.

### Convergence Ledger publication contract

A milestone ledger is optional Git-tracked Markdown at exactly `docs/gsd/<feature>/milestones.md`. It is allowed only when a large feature has materially precise, user-approved milestone goals. Its creation/update is a convergence-time write owned by one exact plan task's Files field and subject to normal review/acceptance. `spec.md` may contain optional `## Publication` with either `null` or that exact path. It authorizes planned publication only, never completion, task selection, or resume. Ledger presence alone is metadata.

The canonical UTF-8/LF grammar is:

```markdown
# Milestones

## Feature

`<feature>`

## Base

`<base>`

## Milestones

| ID | Slug | Goal | Status |
| --- | --- | --- | --- |
| M1 | `<milestone-slug>` | <precise user-approved goal> | pending |
```

IDs are positive sequential `M1..MN`; slugs are unique lowercase kebab-case; goals are non-empty, concrete single-line text without `|`; status is exactly `pending` or `done`. Feature must equal the directory slug, Base must name the approved base branch, headings and columns are exact, and no extra sections, rows, or columns are allowed. Rows consist of a possibly empty `done` prefix followed by a non-empty `pending` suffix. Creation or convergence-time append preserves every existing row byte-for-byte and adds only new `pending` rows. A ledger with no pending row is a stale lifecycle residual, not a completed canonical ledger.

### Milestone Ledger completion contract

Only the `Milestone WIP gate` may complete ledger lifecycle state. `gsd-executing-plans` treats the selected first-pending row and all ledger bytes as read-only during task work. At terminal verification, `gsd-verify` proves the selected row still matches the approved milestone and remains first pending.

- **Non-final milestone:** change exactly the selected row's status from `pending` to `done`; preserve every other byte.
- **Final milestone:** delete `docs/gsd/<feature>/milestones.md` instead of writing an all-`done` ledger.

The status transition or deletion is part of the reviewed WIP diff and lands only in the same green squash commit as the milestone implementation. A red gate never changes base ledger state. Normal execution/publication never completes or deletes a row.

## Runtime TOON contract

### JIT task attempt

Immediately before dispatch, `gsd-executing-plans` writes `.scratch/<feature>/tasks/<Tn>/a<N>.toon`, fsyncs, closes, and reads it back. It is immutable. The attempt contains task/attempt identity; approved Markdown source paths, SHA-256 hashes, and source anchors; verbatim active criterion facts; pinned seam/path/lower-seam reason; task-owned files; focused check; relevant invariant/non-goal; and safety facts. The implementer, TDD skill, reviewer, and fixer read the same bytes.

The attempt derives all acceptance and interface values from `spec.md` and `plan.md` before dispatch. It never reads or embeds a legacy pre-approval TOON table. Missing, duplicate, unknown, superseded-only, conflicting, or mismatched criterion/interface/task facts block dispatch rather than being inferred or normalized.

### Handoff

After approval, every approval, green-task, or pause transition writes a new `.scratch/<feature>/handoff-<n>.toon` with a fresh monotonically numbered name. Never overwrite or suffix an existing handoff. It records opaque `mode`/`phase`, completed task, verified evidence, next action, runtime toggles, and the exact approved Markdown source paths/hashes. The highest-numbered handoff is the only active runtime generation; older handoffs are immutable history. Resume selects that file first, fails closed if it is invalid, and verifies the current packet against its binding before accepting progress. Runtime evidence determines completed work; it never changes Markdown Status, requirements, or task order.

### Squash and cleanup result marker contract

After all terminal verification gates pass, write `.scratch/<feature>/result.toon` as the exact nine-line UTF-8/LF scalar record:

```toon
schema:v1
status:merged|merged_cleanup_residual
feature:<feature-slug>
base:<branch>
commit:<squash-oid>
wip_tip:<reviewed-wip-oid>
local_branch:<deleted|none>
remote_branch:<deleted|none>
scratch:<retained|pending>
```

Validate schema, field order, enum values, non-empty identities, and status consistency fail-closed. A valid result marker blocks implementation resume. `scratch:pending` permits only the one explicit user cleanup decision. `status:merged_cleanup_residual` permits only explicit residual cleanup. No result-marker state can reopen execution or author a second cleanup flow.

## Post-approval pipeline contract

Approval is the final prompt of the normal feature cycle. Immediately dispatch `gsd-executing-plans`; no later menu, confirmation, or visual-review offer appears unless the user explicitly asks. For each ordered task: bind the packet, create an immutable attempt, implement the owned slice with focused TDD, review the exact attempt/diff, run the focused test and runnable acceptance, commit only green owned changes to `wip/<feature>`, then write a fresh immutable handoff. Critical/Important review findings, failed checks, merge conflicts, source-binding drift, or a non-convergent repair loop stop and report the applicable blocker. A changed requirement is a Spec escalation, never an implementation repair.

When every non-superseded task is complete, `gsd-verify` checks the whole WIP diff, all active ACs through their pinned public seams, applicable project suite, and terminal acceptance/E2E. Only a green terminal verifier can squash to base.

## Git/base/WIP/scratch mechanics

For branch-backed writes, first require a Git work tree. `plan.md` records the base before `wip/<feature>` is created. The feature branch is `wip/<feature>` and never self-references as base. Keep `.scratch/` machine-local and git-ignored; portable handoff sync, where intentionally requested, is an explicit pathspec operation and remains runtime-only. Review diffs exclude scratch. Before squash, verify base, WIP, upstream, and reviewed non-scratch tree against the recorded runtime binding; any mismatch blocks merge. Nano and read-only work are completely git-free.

## Feature cleanup

For explicit abandon/drop/delete: confirm the feature name, inspect whether the worktree is dirty, check out the recorded base, safely delete the WIP branch, and remove `.scratch/<feature>/`. Never force-delete unmerged work without explicit confirmation. A result marker uses its dedicated cleanup state machine instead.

## Lavish opt-in gate taxonomy

Lavish is an optional browser review surface, never an automatic launch. Offer it only when both conditions hold: (1) a substantial completed, reviewable deliverable exists and the flow is not mid-conversation; and (2) browser annotation adds real review value. Fold one offer into the current surface; launch only after acceptance. Post-approval pipeline progress has no offer mode. Missing browser or lavish capability degrades silently to terminal prose.

## Contextual disclosure templates

Master pre-approval end-session surface:

```text
Next steps (reply with number or text):
1. Generate the implementation plan
2. Review the deliverable visually
3. Pause & save progress
```

Directly invoked sub-skills use technical bullets:

```text
Next steps:
- /gsd (to continue or save progress)
```

Inline supporting-skill firing appends nothing. Post-approval pipeline output reports progress or blockers only; blocker stops never imply merge success.
