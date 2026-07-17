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

The sole pre-approval human/agent contract is the canonical UTF-8/LF `plan.md` in `.scratch/<feature>/`, written only by `gsd-to-plan`.

The `plan.md` is the only authority for intent, acceptance, task order, seams, files, and focused checks. Any legacy `proposal.md`, `spec.md`, or `design.md` is rejected and stops automatic selection with a Spec escalation. Root or scratch `proposal.toon`, `spec.toon`, `design.toon`, and `plan.toon` are stale non-authoritative files: never derive scope, recovery, acceptance, or task order from them. A detected legacy packet stops automatic selection with a Spec escalation.

TOON remains runtime-only: immutable task attempts, handoffs, and result markers. Runtime records report progress and bind source bytes; they cannot author, amend, or reinterpret Markdown contracts or durable documentation.

### Packet grammar

All fields use exact headings, exact field labels, canonical field order, UTF-8, LF, and no blank leading/trailing lines. Reject missing, duplicate, malformed, unknown, empty, vague, or reordered required fields. Never normalize, infer, or repair source values.

`plan.md`:

```markdown
# Plan
## Feature
`<feature>`
## Base
`<base>`
## Summary
<one concrete outcome>
## Context
<bounded context>
## Scope
- <included behavior>
## Acceptance Criteria
### AC-1: <title>
- **State:** active
- **Outcome:** <concrete behavior>
- **Action:** <concrete operation>
- **Expected:** <observable result>
## Decisions
None.
## Invariants
- **I-1:** <must remain true>
## Non-goals
- **NG-1:** <explicit exclusion>
## Interfaces
| Criterion | Seam | Path | Lower-seam reason |
| --- | --- | --- | --- |
| AC-1 | <public seam> | `<repository-relative path>` | none |
## Publication
null
## Tasks
### T1: <short task>
- **Satisfies:** AC-1
- **Files:** `path/to/file`
- **Test:** `<focused command or none>`
- **Status:** pending
```

Decisions is exact `None.` or sequential D blocks with Decision and Rationale:
```markdown
### D-1: <title>
- **Decision:** <value>
- **Rationale:** <value>
```

An AC ID is a positive sequential integer. Only `active` criteria execute; a replacement receives a new ID while the former criterion is `superseded`. Outcome, Action, and Expected must independently name a concrete behavior, operation, and observable result. `TBD`, `TODO`, `works correctly`, `run tests`, `valid`, `covered`, or `success` are invalid. Every active AC has exactly one matching Interfaces row. A lower seam is valid only with a concrete reason that the higher production boundary is absent or cannot deterministically isolate the criterion. Task IDs are positive sequential integers in heading order. Every active AC appears exactly once across non-superseded task `Satisfies` fields. Every task owns at least one exact repository-relative path and one focused public-seam check unless it changes no runtime behavior. Task status is `pending`, `in_progress`, `done`, or `superseded`; the approved Markdown status is immutable after approval and is never progress evidence.

### Quick-fix plan exception

A Quick-fix is not a converged feature packet. Its direct fast path may write a minimal UTF-8/LF `plan.md` containing exactly `# Quick-fix Plan`, `## Feature`, `## Base`, and `## Tasks` with one or two task headings, each naming its files and focused check. Only the Quick-fix WIP verifier may consume it. It has no proposal/spec/design source set, no approval binding, and no normal-packet authority. Ordinary packet validation MUST NOT classify it as malformed converged state or dispatch normal execution from it; its special `gsd-verify` gate owns it until landing or a blocker.

### Approval binding

`gsd-to-plan` validates the canonical `plan.md`, writes the plan, prints the task/AC summary, calculates SHA-256 for `plan.md`, and asks exactly one approval question. Approval records the feature, `plan.md` path, and its hash in runtime state. After approval, the execution-control plane applies phase-boundary plan validation: full semantic parse and binding checks occur only at plan approval, execution entry/resume, and terminal entry. Digest guards verify the binding at task attempt creation and pre-squash. At approval, GSD binds the persistent executor model from `modelRoles.task` and the distinct persistent reviewer model from `modelRoles.advisor`. The persistent executor, reviewer, or any launched OMP child agents consume the attempt directly without independently parsing or validating the plan. A missing, changed, extra, or malformed `plan.md` or any legacy source file is a Spec escalation. Never regenerate a new plan or derive requirements from runtime TOON.

On approval, `gsd-to-plan` immediately loads `gsd-handoff` and creates the next positive sequential execution handoff (`handoff-1.toon` when none exists). It records the approved feature, the `plan.md` path and hash, selected execution mode, `phase=approved`, no completed task, and `next_action` set to `start/continue task`. It also records the bound executor and reviewer model settings (as 'settings[2]{key,value}:', never 'settings[0]'). A fresh approval after Spec escalation starts a new active binding generation in that next handoff; older handoffs remain immutable history and their old hashes are expected, not a conflict. Later task/pause handoffs continue from the newest approval binding. Execution never depends on prompt-local memory for the approval binding.

### Convergence Ledger publication contract

A milestone ledger is optional Git-tracked Markdown at exactly `docs/gsd/<feature>/milestones.md`. It is allowed only when a large feature has materially precise, user-approved milestone goals. Its creation/update is a convergence-time write owned by one exact plan task's Files field and subject to normal review/acceptance. `plan.md` must contain `## Publication` with either `null` or the canonical ledger path whose slug exactly equals Feature. It authorizes planned publication only, never completion, task selection, or resume. Ledger presence alone is metadata.

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

Immediately before dispatch, `gsd-executing-plans` writes `.scratch/<feature>/tasks/<Tn>/a<N>.toon`, fsyncs, closes, and reads it back. It is immutable. The attempt contains task/attempt identity; approved `plan.md` path, SHA-256 hash, and source anchors; verbatim active criterion facts; lossless ordered Decisions; pinned seam/path/lower-seam reason; task-owned files; focused check; relevant invariant/non-goal; and safety facts. The persistent executor, reviewer, and TDD skill consume the validated immutable attempt and relevant pinned sections (including the lossless ordered Decisions) directly without independently parsing or validating the plan. A `None.` decisions block in the plan is represented as an explicit empty decisions marker in the attempt.

The attempt derives all acceptance and interface values from `plan.md` before dispatch. It never reads or embeds a legacy pre-approval TOON table. Missing, duplicate, unknown, superseded-only, conflicting, or mismatched criterion/interface/task facts block dispatch rather than being inferred or normalized.

### Handoff

After approval, every approval, task-active, context-pressure, pause, green-task, repair, or terminal transition writes a new `.scratch/<feature>/handoff-<n>.toon` with a fresh monotonically numbered name (`handoff-<positive canonical integer>.toon`, rejecting zero, leading zeros, custom prefixes, or suffixes). Never overwrite or suffix an existing handoff. It records opaque `mode`/`phase`, completed task, verified evidence, `next_action`, runtime settings, and the exact approved plan.md path/hash. Fresh handoff writes are required and wired for approval, task-active before dispatch, automatic context-pressure/pause, green-task, task repair before repair dispatch, terminal entry, and terminal repair before repair dispatch. Every approval/task-active/context-pressure/pause/green-task/repair/terminal transition emits a fresh handoff before dispatch/return. All referenced history records (prior completed review and triggering handoffs) must be loaded with lstat-style checks resolving canonical filenames within the canonical same-feature directory (`dirname(suppliedHandoffPath)`), rejecting symbolic links before reading, and requiring existence as a regular file. `feature`, `plan_path`, and `plan_sha256` must be present and identical across current, trigger, and prior history handoffs, alongside model settings bindings. History records used for convergence must be fully semantically validated as completed `terminal-repair` records with non-sentinel executor and reviewer identities, actual models matching bound settings, positive executor and reviewer generations, positive review round, completed non-pending check and non-empty result, exact `reviewer_verdict: BLOCKED`, positive `blocking_count`, valid current and previous fingerprints, mandatory `reviewed_commit`, exact `progress_status: advanced`, and non-empty `progress_evidence` and `progress_guard`, performing unconditional commit/fingerprint comparisons without conditional skips.

#### Handoff reload manifest
Every execution handoff carries strict unique `reload[N]{skill,path}` entries for subskills required by its `next_action`. The `N` in the header `reload[N]{skill,path}` must be exactly equal to the following row count in the manifest table. Master (`gsd`) is always reloaded from its fixed direct-root path (`skills/gsd/SKILL.md`) and must never be duplicated or included in the `reload` manifest.
The paths in the manifest are exact GSD_ROOT-relative paths formatted as `skills/<gsd-name>/SKILL.md`.

Active subskill mappings for `next_action` are:
- `start/continue task`: requires unconditional base skills `gsd-executing-plans`, `gsd-handoff`, and `gsd-tdd`.
- `run task review/repair`: requires unconditional base skills `gsd-executing-plans`, `gsd-handoff`, `gsd-verify`, and `gsd-diagnosing-bugs`.
- `enter terminal verification/repair`: requires unconditional base skills `gsd-verify` and `gsd-handoff`.
- `Discussion/Spec-escalation`: requires unconditional base skill `gsd-handoff`.

Every executable `next_action` (including task review/repair, terminal verification/repair, and preserved pause destinations) additionally applies the following conditional active skills:
- `gsd-ponytail` (active if and only if `ponytail_level` setting is `lite`, `full`, or `ultra`).
- `gsd-codebase-design` (active if and only if it is currently loaded in the active subskill/action context at handoff write; the reload table itself persists its active/inactive design writer case). Inline codebase-design/domain-modeling complete before handoff and their authoritative outputs are already in plan/attempt; they are not resumable execution modes.
- `gsd-domain-modeling` (active if and only if it is currently loaded in the active subskill/action context at handoff write; the reload table itself persists its active/inactive domain writer case).

Unknown settings remain opaque and do not affect manifest validation.

Strict validation rules for the reload manifest and settings are:
- Reject duplicate skill names or duplicate paths.
- Reject unknown or non-installed skills (never treat unknown reload skills as forward-compatible).
- Reject mismatched skill names and paths (e.g. skill `gsd-handoff` paired with path `skills/gsd-verify/SKILL.md`).
- Reject absolute paths, paths containing backslashes, empty paths, dot/traversal segments (`.` or `..`), or malformed row counts/structures.
- Reject non-canonical numeric counts, non-matching table headers/schemas (settings must match exactly `settings[N]{key,value}` and reload must match exactly `reload[N]{skill,path}`), extra/reordered/unknown columns, or incorrect row arity before decoded validation. Require exact `settings[N]{key,value}` presence for executable handoffs, where approved and other active executable phases require exactly both concrete distinct bound model settings (never `settings[0]` settings table); reject missing, scalarized, duplicated, malformed, or count-mismatched settings tables.
- Fail closed immediately if any entry is invalid.

During resume, the rehydration sequence is executed in the following order:
1. Parse the handoff (common byte parse/validation). Reject any scalar `reload` key, empty or nonempty, during common byte validation before classification.
2. Classify pre-plan versus execution from mode and phase rules. Require exact explicit `mode=discussion` and `phase=pre-plan` for pre-plan; return once to state detection with no master log.
3. For execution handoffs:
   a. Confirm the master is loaded via the bootstrap capsule (never load master recursively or execute the capsule again).
   b. Validate that supplied execution handoff path equals highest canonical handoff path (supplied/highest guard).
   c. Compare handoff `plan_path` and hash to the trusted liveBinding values passed by caller.
   d. Validate settings and `reload[N]{skill,path}` manifest, then reload every listed subskill in order.
   e. Validate next_action and execute/log.

#### Compaction Recovery Capsule

The Compaction Recovery Capsule is owned by GSD and is the canonical recovery interface. The exact model-independent recovery capsule template is:

```text
[GSD Recovery Capsule]
Active GSD features: <features>
To resume execution, perform direct-root rehydration in this exact order:
1. Use the already-loaded GSD bootstrap from <GSD_ROOT>/skills/gsd/SKILL.md; do not load it again.
2. <resume_instruction>
Stop immediately on any malformed or ambiguous state, or if the intent is unrelated to the active features.
```

#### Canonical Candidate State-Selection & Discovery Algorithm

Generic agents and harness adapters derive active feature candidates from the workspace filesystem using metadata inspection only:
1. **Directory Inspection**: Check if `.scratch/` exists and is a directory in `cwd`. If missing or not a directory, candidate list is empty (`[]`).
2. **Feature Directory Filtering**: Inspect child entries of `.scratch/`. A candidate entry is eligible if:
   - It is a directory (not a regular file, symlink, or special file type).
   - Its name matches the safe kebab-case feature slug grammar `^[a-z0-9]+(?:-[a-z0-9]+)*$` and UTF-8 byte length is <= 255 bytes.
3. **Feature Requirements & Blockers**: Inspect child entries of `.scratch/<feature>/`:
   - Must contain a regular file `plan.md` (`isFile()`).
   - Must contain at least one regular file matching the canonical handoff naming scheme `handoff-<n>.toon` where `<n>` is a positive integer `[1-9]\d*` (`isFile()`).
   - Must NOT contain any entry named `result.toon` (whether regular file, directory, or symlink). Any `result.toon` entry renders the feature completed/inert.
4. **No Content Reading/Execution**: Discovery operates exclusively on name and file-type metadata. Artifact contents are never read or executed.
5. **Candidate Array**: Returns all eligible feature names sorted alphabetically (by byte order). Every finite discovered count is accepted; count alone never causes a lifecycle failure.

#### Generic Renderer Protocol

The canonical renderer is a generic protocol with the following requirements:
1. **Inputs & Validation Preconditions**:
   - `features`: An array of feature name strings. Must contain at least 1 feature. Accepts every finite candidate count. Each feature must match the safe-slug grammar `^[a-z0-9]+(?:-[a-z0-9]+)*$` and must not exceed a maximum length of 255 bytes. All feature names must be unique; duplicates are rejected.
   - `gsdRoot`: The absolute GSD_ROOT master path. Must be a non-empty string, must be an absolute path (`path.isAbsolute`), must contain no control characters (`[\x00-\x1F\x7F]`, including NUL `\0`, CR `\r`, LF `\n`), and its input byte length must not exceed 1024 bytes.
   - `masterPath`: Emitted master path `<gsdRoot>/skills/gsd/SKILL.md` must not exceed 1024 UTF-8 bytes.
   - Fail-closed rule: If any input validation precondition is violated, the renderer must immediately throw an error and fail closed, rendering no partial capsule.
2. **Literal Byte Rendering**:
   - Build canonical capsule lines using direct string interpolation / concatenation of validated fields. Do not use pattern-replacement mechanisms (`String.replace`) with untrusted strings, ensuring special characters (`$&`, `$'`, backticks, spaces, non-ASCII UTF-8 path bytes, placeholder-like strings) remain literal.
3. **Stable Sorting**:
   - The array of feature names is sorted alphabetically (by byte order).
4. **Normal vs. Bounded-Ambiguity Selection**:
   - If candidate count is <= 5, the renderer selects the **Normal** mode.
   - If candidate count is > 5, the renderer selects the **Bounded-Ambiguity** mode.
5. **Omitted-Count Formatting**:
   - The candidate list is serialized once only. Normal and ambiguity instructions refer to that list rather than repeating it.
   - In Normal mode, the `<features>` template field is serialized as the list of all feature names joined by `", "`.
   - In Bounded-Ambiguity mode, the `<features>` template field is serialized as the first 5 sorted features joined by `", "`, followed by the exact omitted-count suffix: ` (and <omittedCount> more)` where `<omittedCount>` is `features.length - 5`.
6. **Exact Instruction Values**:
   - For Normal mode (<= 5 active features), `<resume_instruction>` is:
    `Load gsd-handoff from the injected catalog and perform exactly one validated resume.` (84 UTF-8 bytes)
   - For Bounded-Ambiguity mode (> 5 active features), `<resume_instruction>` is:
     `Stop immediately and select exactly one active feature to resume.` (65 UTF-8 bytes)
7. **Byte-Budget Limits & Accounting**:
   - Fixed template static text: exactly 299 UTF-8 bytes.
   - Emitted absolute master path (`<gsdRoot>/skills/gsd/SKILL.md`): maximum 1024 bytes.
   - Feature slug: maximum 255 bytes per slug.
   - Displayed candidate count: maximum 5 feature slugs displayed in `<features>`.
   - Omitted count digits: maximum 16 bytes.
   - Candidate serialization bytes (`<features>`):
     - Normal mode (<=5): 5 * 255 + 4 * 2 = 1283 bytes max.
     - Bounded-Ambiguity mode (>5): 5 * 255 + 4 * 2 + 12 + 16 = 1311 bytes max.
   - Total capsule formula:
     `totalBytes = fixedTemplateBytes (299) + masterPathBytes (<=1024) + instructionBytes (84 or 65) + featuresSerializationBytes (<=1283 or <=1311)`
   - Maximum worst-case complete capsule size:
     - Normal mode (<=5): 299 + 1024 + 84 + 1283 = 2690 bytes.
     - Bounded-Ambiguity mode (>5): 299 + 1024 + 65 + 1311 = 2699 bytes.
   - Complete UTF-8 capsule cap: maximum 4000 bytes.
   - Post-rendering rule: The rendered capsule must be fully formed. If the complete UTF-8 byte count of the rendered capsule exceeds 4000 bytes, the renderer must fail closed and throw an error. No post-render truncation or slicing of root, slug, instruction, or Unicode is permitted.
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

Validate schema, field order, enum values, non-empty identities, and status consistency fail-closed. A valid result marker blocks implementation resume for its completed feature. No result-marker state can reopen execution or author a second cleanup flow.

#### Entry result-marker decision matrix

Master activation validates every discovered result marker before deriving prompt relevance. Apply the first matching row:

| Order | Marker state and prompt relation | Decision | Consequence |
| --- | --- | --- | --- |
| 1 | Any discovered marker is malformed | `fail-closed` | Stop before skill selection. |
| 2 | Any valid marker has `scratch:pending` | `cleanup-question` | Resume only that marker's existing delete-or-retain decision; never resume implementation or select a primary skill. |
| 3 | Explicit cleanup targets `status:merged` with `scratch:retained` | `cleanup-only` | Permit deletion of that named packet only. |
| 4 | Explicit cleanup targets `status:merged_cleanup_residual` | `cleanup-only` | Permit residual cleanup for that named feature only. |
| 5 | Resume, implementation, or new-work intent explicitly targets a retained or residual completed feature | `block-resume` | Stop and report that the feature is completed; select no primary skill. |
| 6 | A retained or residual marker is unrelated to the prompt, including generic `continue` | `ignore-terminal-record` | Exclude that marker from feature relevance and continue existing active-packet, ledger-recovery, and automatic skill selection. |
| 7 | No marker condition above applies | `ordinary-routing` | Continue automatic active-state and skill selection. |

`scratch:pending` is a global crash-recovery gate because its cleanup choice was not durably resolved. When several pending markers exist, prefer an explicitly named pending feature; otherwise select the most-recently-modified pending feature, breaking equal timestamps by feature slug, and resolve only that marker's single cleanup decision on this entry.

After pending recovery, only explicit feature naming can make retained or residual terminal history related. Generic `continue` never selects terminal history; retained and residual marker mtimes never compete with active packets. The activation-bearing decisions are `ordinary-routing` and `ignore-terminal-record`; every other decision stops with `primarySkill: null`.

## Post-approval pipeline contract

Approval is the final prompt of the normal feature cycle. Immediately dispatch `gsd-executing-plans`; no later menu, confirmation, or visual-review offer appears unless the user explicitly asks. For each ordered task: bind `plan.md`, record task base, create an immutable attempt using a lightweight bound-source digest comparison under the phase-boundary semantic-validation and digest-guard model, and explicitly dispatch the persistent executor (with the bound task model from `modelRoles.task`) with direct-root TDD instructions. GSD reuses the executor's OMP agent identity through `hub` for task and repair turns. The executor runs the focused check once after implementation; it never runs acceptance checks. The parent dispatches the persistent reviewer (reusing the same reviewer session with the bound advisor model from `modelRoles.advisor`) against the task diff and recorded green evidence (the reviewer consumes recorded green evidence rather than rerunning it). If the independent reviewer capability or model configuration is unavailable, GSD must fail closed immediately. If needed for blocking findings or red focused checks, the parent writes a fresh task-repair handoff for the `task repair` transition with `next_action` set to `run task review/repair` before directing the persistent executor to perform the repair. The executor may fan out task attempts concurrently through OMP child agents if and only if the complete safe fan-out gate is satisfied: (1) attempts are dependency-independent, (2) attempts target path-disjoint files, (3) attempts consume only parent-created immutable attempts, (4) safe isolation and model evidence are present, and (5) GSD performs deterministic integration of the results. If any proof of these conditions is absent, GSD must fall back to sequential task execution. If an OMP process or session boundary makes the bound agent unreachable, GSD creates exactly one active successor at a time on the same bound model from validated handoff and attempt evidence, records the generation change, and invalidates the old identity. Commit only green owned changes to `wip/<feature>` on the shared worktree sequentially, then write a fresh immutable handoff. The parent retains task order, Git commits, handoff generation, and terminal transition. Critical/Important review findings, failed checks, merge conflicts, source-binding drift, or a non-convergent repair loop stop and report the applicable blocker. A changed requirement is a Spec escalation, never an implementation repair.

When every non-superseded task is complete, `gsd-verify` checks the whole WIP diff, all active ACs through their pinned public seams, applicable project suite, and terminal acceptance/E2E. Terminal verification performs one full parse at entry. The parent dispatches the persistent reviewer (reusing the same reviewer session with the bound advisor model). If the independent reviewer capability or model configuration is unavailable, GSD must fail closed immediately. If needed for blocking findings or red suite/acceptance/E2E gates, the parent writes a fresh terminal-repair handoff for the `terminal repair` transition with `next_action` set to `enter terminal verification/repair` and persists review-progress evidence before directing the persistent executor to perform the repair. Sentinel agent identities or models ('none', 'unassigned', 'pending') are strictly rejected. The triggering pending review's `current_review_commit` must match the `reviewed_commit` of the resulting `terminal-repair` handoff. `reviewer_terminal_check` is required in both terminal phases, routing pending vs completed states, and the verdict for `terminal-repair` must be exactly `reviewer_verdict:BLOCKED`. Progress compares the current completed review's fingerprint and commit to the prior completed blocked review rather than the immediate pending handoff. Terminal repair continues without a fixed round count only while findings or the relevant diff demonstrably change; stop on a repeated blocking fingerprint or no relevant repair diff. Terminal verification explicitly skips focused checks when exact-target or documented-superset coverage is proven. Replay of a focused check is performed only when such coverage proof is absent. The verifier performs one lightweight pre-squash digest comparison immediately before squash, and records the result. Only a green terminal verifier can squash to base.

## Git/base/WIP/scratch mechanics

For branch-backed writes, first require a Git work tree. `plan.md` records the base before `wip/<feature>` is created. The feature branch is `wip/<feature>` and never self-references as base. Keep `.scratch/` machine-local and git-ignored; portable handoff sync, where intentionally requested, is an explicit pathspec operation and remains runtime-only. Review diffs exclude scratch. Before squash, verify base, WIP, upstream, and reviewed non-scratch tree against the recorded runtime binding; any mismatch blocks merge. Nano and read-only work are completely git-free.

## Feature cleanup

For explicit abandon/drop/delete: confirm the feature name, inspect whether the worktree is dirty, check out the recorded base, safely delete the WIP branch, and remove `.scratch/<feature>/`. Never force-delete unmerged work without explicit confirmation. A result marker uses its dedicated cleanup state machine instead.

## Lavish opt-in gate taxonomy

Lavish is an optional browser review surface, never an automatic launch. Offer it only when both conditions hold: (1) a substantial completed, reviewable deliverable exists and the flow is not mid-conversation; and (2) browser annotation adds real review value. Fold one offer into the current surface; launch only after acceptance. Post-approval pipeline progress has no offer mode. Missing browser or lavish capability degrades silently to terminal prose.

## Contextual disclosure templates

Pre-approval human-action surface:

```text
Next steps (reply with number or text):
1. Generate the implementation plan
2. Review the deliverable visually
3. Pause & save progress
```

Directly selected skills use natural-language actions:

```text
Next steps:
- Continue the active work or save progress.
```

Inline helper loading appends nothing. Post-approval pipeline output reports progress or blockers only; blocker stops never imply merge success.
