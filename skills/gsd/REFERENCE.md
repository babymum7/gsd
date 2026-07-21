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

Choose mode from explicit intent and entry context first. Artifact presence alone never selects a mode. Preserve opaque state `phase` and `next_action` values on resume. A missing, malformed, duplicate, or hash-mismatched **required** artifact fails closed; optional state does not.


## Visible skill mandatory-use matrix

Canonical dispatch authority for the 12 visible GSD skills. Shared semantics live only here; each skill file restates only its mode-specific guard and transition. Exactly one row per visible skill. Helper rows with a true Helper-when condition must load and cannot be skipped.

| Skill | Role | Intent | Prerequisites | Do-not-load | Transition | Helper-when |
| --- | --- | --- | --- | --- | --- | --- |
| `gsd-brainstorming` | owner | Resolve non-trivial new behavior or product/architecture tradeoffs into a concrete acceptance contract | Explicit design intent or load-bearing Spec-gap return | Read-only questions, pure mechanical edits, known single-spot quick fix | On convergence load `gsd-to-plan` | — |
| `gsd-to-plan` | owner | Create or finalize the canonical `plan.md` after acceptance criteria converge | Converged acceptance contract from `gsd-brainstorming` or validated unapproved plan | Design decisions still open; Nano edits | On approval write `state.toon` and load `gsd-executing-plans` | — |
| `gsd-executing-plans` | owner | Implement approved plan tasks on `wip/<feature>` with Fast TDD and executor-only task repair | Valid approved `plan.md` and bound resumable `state.toon` | No bound plan/state; inventing authority | After all tasks and Fast TDD Checks are green load `gsd-verify` | — |
| `gsd-handoff` | owner | Pause, save, resume, or recover from a valid `state.toon` or compaction capsule | Valid `state.toon` or recovery capsule naming peer owner | Missing/malformed state used to invent work | Load the peer skill named by validated `next_action` | — |
| `gsd-verify` | owner | Standalone diff/PR review or terminal planned/quick-fix gate with slow suite then whole-diff review | Planned: bound plan/`state.toon`; standalone: supplied diff | Invent completion without gates; dispatch `gsdReviewer` per task | Planned green path: squash, automatic cleanup, optional retain/archive | — |
| `gsd-diagnosing-bugs` | owner | Produce root-cause evidence for non-obvious bugs, regressions, intermittent failures, or performance problems | Non-obvious failure or execution blocker needing evidence | Known single-spot quick fix | Return evidence to executor or hand architecture cause to `gsd-improve-codebase-architecture` | — |
| `gsd-improve-codebase-architecture` | owner | Audit or refactor architecture, or deepen candidates after diagnosis names an architectural cause | Explicit architecture intent or diagnosis-returned architectural cause | One named interface design without architecture scope | Return recommendations into discussion/plan ownership | — |
| `gsd-ponytail` | helper | Run a known-scope behavioral quick fix or apply explicit ponytail preference level | Real known single-spot behavioral scope or explicit lite/full/ultra/normal preference | Non-trivial new behavior needing brainstorming; Nano work | Return to the normal GSD lifecycle or escalate to `gsd-brainstorming` when scope expands | must load when a known-scope quick fix is active or an explicit lite/full/ultra/normal preference is set (including normal/stop clearing state); cannot be skipped while that condition holds |
| `gsd-tdd` | helper | Drive Fast TDD Check RED→GREEN→refactor at a public seam for observable behavior | Parent owner is implementing or repairing observable behavior | Primary skill selection; resource-heavy browser/E2E task loops | Return green/red evidence to parent owner | must load when an observable task is dispatched or repaired |
| `gsd-domain-modeling` | helper | Write durable domain terms/decisions when already-bounded evidence makes a candidate certain | Certain project-specific term or evidenced architectural decision in already-bounded work | Proactive repository scans; uncertain candidates | Return exact changed domain paths to parent owner | must load when a durable domain candidate is certain |
| `gsd-codebase-design` | helper | Design one named module interface, seam, or deep-module boundary | Named module/interface target from parent owner or explicit request | System-wide architecture audit | Return design result to parent owner | must load when designing one named module interface or seam |
| `gsd-lavish` | helper | Opt-in browser visual review or pre-approval planning prototype of a substantial deliverable | User opt-in or post-plan `Build prototype with Lavish` choice; eligible deliverable | Automatic launch; inline Q&A; post-approval prototype gate | Return annotations to parent owner | must load when the user opts into visual review or chooses Build prototype with Lavish |

## Durable documentation contract

Git-tracked knowledge intended for both people and agents is strict Markdown under `docs/`; TOON is never used for durable prose or human-approved goals.

- `docs/domain/index.md` is a small bounded-context index; `docs/domain/<scope>.md` shards hold durable glossary terms and architectural decisions. Shard by stable bounded context, never by feature. `gsd-domain-modeling` owns the exact schema and is the sole writer.
- `docs/gsd/<feature>/milestones.md` is the human-reviewable milestone contract and lifecycle ledger. Its goals are approved authority; its status column is controlled by terminal verification.
- `docs/gsd/<feature>/archive/plan.md` and `docs/gsd/<feature>/archive/implementation.md` are optional historical reference only. They never become execution authority and never reopen a completed feature.

Runtime-only `state.toon` stays TOON under `.scratch/`. A format is authoritative by its declared role and canonical path, never by extension alone.

## Canonical Markdown contract

### Authority

The sole pre-approval human/agent contract is the canonical UTF-8/LF `plan.md` in `.scratch/<feature>/`, written only by `gsd-to-plan`.

The `plan.md` is the only authority for intent, acceptance, task order, seams, files, and focused checks. Any legacy `proposal.md`, `spec.md`, or `design.md` is rejected and stops automatic selection with a Spec escalation. Root or scratch `proposal.toon`, `spec.toon`, `design.toon`, and `plan.toon` are stale non-authoritative files: never derive scope, recovery, acceptance, or task order from them. A detected legacy packet stops automatic selection with a Spec escalation.

TOON remains runtime-only: the single atomic `state.toon` snapshot. Runtime records report progress and bind source bytes; they cannot author, amend, or reinterpret Markdown contracts or durable documentation. Numbered `handoff-<n>.toon`, task-attempt files, `result.toon`, reload manifests, and persisted live-agent generation fields are rejected legacy runtime history with no authority and no compatibility shim.

### Fast TDD and task-loop constraints

Every observable task loads `gsd-tdd` and uses a Fast TDD Check for RED before implementation, GREEN after implementation, and refactor after green. No browser, GUI, external network, long-lived server, large fixture, or material cost may run in an implementation task loop. Do not dispatch `gsdReviewer` per task; the task boundary is based on executor fast-green evidence. If no fast public seam exists, planning adds the smallest real fast public seam; never use `none` for observable behavior. Red/Green/refactor evidence remains reporting-only and transcript-only; do not add persistent TDD evidence fields to runtime TOON. After all tasks and fast checks pass, run the complete feature-affected slow suite; begin whole-diff review only after that suite is green. Failures are fixed at their source and rerun through the smallest affected subset until clear, then the complete feature-affected slow suite reruns, then whole-diff re-review. Repeat that progress-guarded loop until green under the progress guard. Terminal completion requires both the complete feature-affected slow suite and `gsdReviewer` whole-diff verdict to be green on the final reviewed bytes.

### Planning Prototype Session

A Planning Prototype Session is an optional pre-approval Lavish session built from a completed draft plan for any feature type. After every complete draft plan, the single post-plan action surface offers approve and execute, `Build prototype with Lavish`, revise, and pause/save together. Choosing `Build prototype with Lavish` is launch consent and causes no second confirmation. Lavish annotations return to `gsd-to-plan`, may revise and revalidate the draft, and may promote selected stable assets under `.scratch/<feature>/prototype/` with relative links from plan Context or Decisions. Prototype sessions and artifacts never become implementation evidence or terminal acceptance. After approval, a prototype request is Spec escalation, not an execution or terminal gate. Unavailable Lavish degrades to terminal prose without blocking planning. No terminal pre-E2E visual pause remains.

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
- **Files:** `<path>`
- **Test:** `<focused command or none>`
- **Status:** pending
```

Decisions is exact `None.` or sequential D blocks:

```markdown
### D-1: <title>
- **Decision:** <value>
- **Rationale:** <value>
```

An AC ID is a positive sequential integer. Only `active` criteria execute; a replacement receives a new ID while the former criterion is `superseded`. Outcome, Action, and Expected must independently name a concrete behavior, operation, and observable result. `TBD`, `TODO`, `works correctly`, `run tests`, `valid`, `covered`, or `success` are invalid. Every active AC has exactly one matching Interfaces row. A lower seam is valid only with a concrete reason that the higher production boundary is absent or cannot deterministically isolate the criterion. Task IDs are positive sequential integers in heading order. Every active AC appears exactly once across non-superseded task `Satisfies` fields. Every task owns at least one exact repository-relative path and one concrete focused check. Observable behavior always receives a fast public seam; never use `none` for observable behavior.

### Quick-fix plan exception

A Quick-fix is not a converged feature packet. Its direct fast path may write a minimal UTF-8/LF `plan.md` containing exactly `# Quick-fix Plan`, `## Feature`, `## Base`, and `## Tasks` with one or two task headings, each naming its files and focused check. Only the Quick-fix WIP verifier may consume it. It has no proposal/spec/design source set, no approval binding, and no normal-packet authority. Ordinary packet validation MUST NOT classify it as malformed converged state or dispatch normal execution from it; its special `gsd-verify` gate owns it until landing or a blocker.

### Approval binding

`gsd-to-plan` validates the canonical `plan.md`, writes the plan, prints the task/AC summary, calculates the SHA-256 hash for `plan.md`, and presents the single post-plan action surface. Approval records the feature, `plan.md` path, and its hash in `state.toon`. After approval, the execution-control plane applies phase-boundary plan validation: full semantic parse and binding checks occur only at plan approval, execution resume, terminal entry, and pre-squash. Do not copy or compare the digest for ordinary task dispatches or green-task checkpoints. At approval, GSD binds the persistent executor model from `modelRoles.gsdExecutor` and the distinct persistent reviewer model from `modelRoles.gsdReviewer`. Persist only the model selectors; live agent identities are process-local and may be reused while reachable, then recreated from the same selectors. The parent builds task briefs directly from the validated plan; executors consume the validated task slice without independently reparsing `plan.md`. If the independent reviewer capability or model configuration is unavailable, GSD must fail closed immediately. Execution never depends on prompt-local memory for the approval binding.

On approval, `gsd-to-plan` immediately loads `gsd-handoff` and writes atomic `.scratch/<feature>/state.toon` with `phase=approved`, bound plan path/hash, base/WIP identity, concrete distinct executor and reviewer model selectors, `next_action` set to `start/continue task`, and phase-inapplicable fields set to canonical `none`. Read it back and validate before dispatch. A fresh approval after Spec escalation supersedes older bindings by overwriting `state.toon` atomically; there is no numbered handoff history. Then load `gsd-executing-plans` without another prompt.

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

## Runtime state contract

### Resumable State Snapshot

Exactly one current `.scratch/<feature>/state.toon` owns resume discovery. It is a fixed-schema UTF-8/LF scalar record with canonical field order:

```toon
schema:v1
feature:<feature-slug>
phase:draft|approved|executing|paused|verifying|repair|merged-cleanup-pending|completed-retained
next_action:<opaque next action or none>
plan_path:.scratch/<feature>/plan.md|none
plan_sha256:<64-hex>|none
base_ref:<branch or oid>|none
wip_branch:wip/<feature>|none
last_green_task:T<n>|none
last_green_commit:<40-hex>|none
executor_model:<selector>|none
reviewer_model:<selector>|none
review_round:<positive int>|none
blocking_fingerprint:<64-hex>|none
reviewed_commit:<40-hex>|none
progress_status:none|advanced|blocked|pending
autosync:none|on|off
ponytail_level:none|lite|full|ultra
cleanup_preference:none|delete|retain|archive-and-delete
checkpoint_revision:<positive int>
```

Phase-inapplicable fields use canonical `none`. Reject blank lines, unknown keys, duplicates, reordered fields, empty values, and every legacy key including `mode`, `manual_ui_review`, `executor_agent`, `reviewer_agent`, `executor_generation`, `reviewer_generation`, `reload`, `task_attempt`, and `settings`. Numbered handoffs, task-attempt files, reload manifests, and result markers provide no authority and are never aliased.

### Atomic write

Every checkpoint write creates a complete temporary file in the same feature directory, fsyncs it, atomically renames it over `state.toon`, fsyncs the directory where supported, then reads back and validates before reporting the checkpoint complete. Reject symlink or non-directory feature paths; require the feature directory basename to equal `state.feature` under a real `.scratch` parent; require `plan_path` to equal `.scratch/<feature>/plan.md` when bound. No dispatch occurs from unvalidated or partially written `state.toon`.

### Checkpoint cadence

Persist only these resumable checkpoints:

- draft plan existence
- approval binding (`phase=approved`)
- green task commit (`last_green_task` / `last_green_commit`)
- pause or automatic context-pressure (`phase=paused`)
- terminal entry / completed terminal verdict (`phase=verifying` or `repair`, with last completed review progress)
- merged cleanup (`phase=merged-cleanup-pending` or `completed-retained`)

Do not write task-active, pending-review, numbered-history, reload-manifest, or live-agent-generation checkpoints. Derive active skills from `phase` and `next_action`. Build task briefs from the validated plan. A `None.` decisions block in the plan is represented as an explicit empty decisions marker in the task slice. Reuse reachable process-local agents or recreate them from bound model selectors. Store only the last completed blocking fingerprint, reviewed commit, review round, and progress status needed to reject no-progress repair; pending review dispatch may safely repeat after interruption.

### Plan digest checks

Calculate and bind SHA-256 at approval, then compare it only at execution resume, terminal entry, and pre-squash. Approved plan digest mismatch at those boundaries fails closed as Spec escalation.

### Skill derivation from phase and next_action

Active subskills are derived, never stored as a reload manifest:

- `start/continue task` (including task repair): requires `gsd-executing-plans`, `gsd-handoff`, and `gsd-tdd`. Do not load `gsd-verify` and do not dispatch `gsdReviewer` for task repair.
- `enter terminal verification/repair`: requires `gsd-verify` and `gsd-handoff`.
- `Discussion/Spec-escalation`: requires `gsd-handoff`.
- Conditional: `gsd-ponytail` when `ponytail_level` is `lite|full|ultra`; inline codebase-design/domain-modeling complete before checkpoint and are not resumable execution modes.

Master (`gsd`) is always present from bootstrap and is never listed as a derived reload skill.
Recovery must never load master recursively or execute the capsule again; ordinary processing continues through the validated `state.toon` and peer skill.

### Candidate discovery

Generic agents and harness adapters derive active feature candidates from the workspace filesystem:

1. **Directory Inspection**: Check if `.scratch/` exists and is a directory in `cwd`. If missing or not a directory, candidate list is empty (`[]`).
2. **Feature Directory Filtering**: Inspect child entries of `.scratch/`. A candidate entry is eligible if it is a real directory (not a symlink), its name matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`, and UTF-8 byte length is <= 255.
3. **Feature Requirements**: The feature directory must contain regular files `plan.md` and `state.toon`. Symlink `state.toon` fails closed. Validate `state.toon` structurally; completed-retained is inert for ordinary resume; active phases may be selected. Legacy handoff-only or attempt-only packets are ignored (no authority).
4. **No Content Execution**: Discovery never executes artifact contents.
5. **Candidate Array**: Returns eligible active feature names sorted alphabetically (by byte order).

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
   - Maximum worst-case complete capsule size:
     - Normal mode (<=5): 299 + 1024 + 84 + 1283 = 2690 bytes.
     - Bounded-Ambiguity mode (>5): 299 + 1024 + 65 + 1311 = 2699 bytes.
   - Complete UTF-8 capsule cap: maximum 4000 bytes.
   - Post-rendering rule: The rendered capsule must be fully formed. If the complete UTF-8 byte count of the rendered capsule exceeds 4000 bytes, the renderer must fail closed and throw an error. No post-render truncation or slicing of root, slug, instruction, or Unicode is permitted.

### Completed-state and cleanup matrix

Apply this matrix only before non-direct lifecycle work. Strictly validate every discovered `.scratch/<feature>/state.toon` first and take the first matching outcome:

| Condition | Decision | Action |
|---|---|---|
| Any state is malformed | `fail-closed` | Stop before skill selection. |
| Any valid state has `phase=merged-cleanup-pending` | `cleanup-question` | Resume only its existing delete-or-retain decision; the pre-squash archive opportunity is not reopened. |
| Explicit cleanup targets `completed-retained` or residual merged state | `cleanup-only` | Permit cleanup of that named completed packet only. |
| Resume, implementation, or new-work intent explicitly targets a completed-retained feature | `block-resume` | Stop and report that the feature is completed. |
| A completed-retained state is unrelated to the prompt, including generic `continue` | `ignore-terminal-record` | Exclude terminal history and continue active-state selection. |
| No condition above applies | `ordinary-routing` | Continue automatic skill selection. |

`merged-cleanup-pending` is a global crash-recovery gate. Generic `continue` never selects completed-retained terminal history, and terminal state mtimes never compete with active packets.

## Post-approval pipeline contract

Approval is the final prompt of the normal planning cycle after the single post-plan action surface. Immediately dispatch `gsd-executing-plans`; no later planning menu, approval confirmation, or generic Lavish visual-review offer appears. For each ordered task, explicitly dispatch the persistent gsd-executor agent (with the bound executor model from `modelRoles.gsdExecutor`) with a validated task slice built from the plan. After green Fast TDD Checks, update `state.toon` with the completed task and keep `next_action` set to `start/continue task`. After every non-superseded task is complete, set `next_action` to `enter terminal verification/repair` and load `gsd-verify`.

When every non-superseded task is complete and all Fast TDD Checks are green, `gsd-verify` runs the complete feature-affected slow suite and whole-diff review only after the complete feature-affected slow suite is green. Terminal verification performs one full parse at entry; the parent dispatches the persistent gsd-reviewer with the bound reviewer model from `modelRoles.gsdReviewer`. If the independent reviewer capability or model configuration is unavailable, GSD must fail closed immediately. Only a green terminal verifier can squash to base. Terminal completion requires both the complete feature-affected slow suite and `gsdReviewer` whole-diff verdict to be green on the final reviewed bytes. Post-approval pipeline output reports factual progress or blockers only; blocker stops never imply merge success.

## Git/base/WIP/scratch mechanics

For branch-backed writes, first require a Git work tree. `plan.md` records the base before `wip/<feature>` is created. The feature branch is `wip/<feature>` and never self-references as base. Keep `.scratch/` machine-local and git-ignored; portable sync, where intentionally requested, is an explicit pathspec operation and remains runtime-only. Review diffs exclude scratch. Before squash, verify base, WIP, upstream, and reviewed non-scratch tree against the recorded runtime binding; any mismatch blocks merge. Nano and read-only work are completely git-free.

Cross-machine sync carries the committed WIP branch and exact `.scratch/<feature>/` packet (`plan.md`, `state.toon`, and promoted prototype references). Dirty non-scratch paths still require an explicit named snapshot decision. A resumed process recreates agents from bound model selectors. Portable sync never sweeps unrelated dirty paths or treats prototype artifacts as authority.

## Feature cleanup

For explicit abandon/drop/delete: confirm the feature name, inspect whether the worktree is dirty, check out the recorded base, safely delete the WIP branch, and remove `.scratch/<feature>/`. Never force-delete unmerged work without explicit confirmation.

### Terminal scratch disposition

Before final terminal review/squash, the user may explicitly select retain or archive-and-delete; omission defaults to delete after a green merge. There is no mandatory terminal cleanup prompt. Persist `cleanup_preference` in `state.toon` when explicitly chosen. After a green merge, write `phase=merged-cleanup-pending` and automatically remove scratch unless retain or archive-and-delete was selected; crash recovery resumes only that cleanup decision. The pre-squash archive opportunity is not reopened after merge.

- **delete (default):** after the green squash, remove `.scratch/<feature>/`.
- **retain:** keep `.scratch/<feature>/` and set `phase=completed-retained` with `next_action=none`.
- **archive-and-delete:** materialize the feature archive under `docs/gsd/<feature>/archive/` before final terminal review/squash, include those files in the same reviewed squash, then remove `.scratch/<feature>/` after publication; never create a post-squash or post-merge documentation-only commit. Archive promoted prototype references needed by relative links when selected.
Final green cleanup also removes the project-root `.gsd-lavish/` when it exists as a real directory, regardless of scratch disposition. Inspect it with `lstat` and resolve it exactly under the project root without following symlinks; absence is a no-op. A symlink or non-directory is unsafe: fail closed and leave it untouched. Never sweep similarly named paths.

### Feature archive contract

Archive output is non-authoritative historical reference. During the active cycle, `.scratch/<feature>/plan.md` remains the sole execution/design authority; archived files never reopen execution and are never treated as active authority.

When archive-and-delete is selected:
1. Copy the exact approved `.scratch/<feature>/plan.md` bytes to `docs/gsd/<feature>/archive/plan.md`.
2. Write `docs/gsd/<feature>/archive/implementation.md` summarizing the feature outcome, changed paths, acceptance outcomes, and verification evidence.
3. Do not copy legacy handoffs, immutable attempts, `result.toon`, or other rejected runtime history. Promoted prototype references may be archived only when needed by relative links.
4. If either archive destination already exists, fail closed and preserve prior content; never overwrite.
5. Materialize and review the archive before squash so it lands in the same green one-feature/one-squash commit with the implementation; never create a second documentation commit after squash.
6. After publication, delete `.scratch/<feature>/` as with ordinary delete disposition.

Existing one-squash branch cleanup and scratch cleanup contracts remain intact.

## Lavish opt-in gate taxonomy

Lavish is an optional browser review surface, never an automatic launch. Offer or launch it when either: (1) a substantial completed, reviewable deliverable exists, the flow is not mid-conversation, and browser annotation adds real review value; or (2) the user chooses `Build prototype with Lavish` on the post-plan action surface (launch consent). Fold one offer into the current surface when offering; launch only after acceptance unless Build prototype already supplied consent. Post-approval pipeline progress has no offer mode and no terminal visual gate. Missing browser or lavish capability degrades silently to terminal prose without blocking planning.

## Contextual disclosure templates

Pre-approval post-plan action surface:

```text
Next steps (reply with number or text):
1. Approve and execute
2. Build prototype with Lavish
3. Revise the plan
4. Pause & save progress
```

Directly selected skills use natural-language actions:

```text
Next steps:
- Continue the active work or save progress.
```

Inline helper loading appends nothing. Post-approval pipeline output reports factual progress or blockers only; blocker stops never imply merge success.
