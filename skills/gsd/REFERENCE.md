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

Explicit intent and entry context choose the mode; artifact presence never does. Validate `phase` against the fixed schema enum; preserve only opaque `next_action` values on resume. A missing, malformed, or duplicate **required** artifact fails closed; optional state does not, and bound-hash mismatch rebinds under § Plan amendment.


## Visible skill mandatory-use matrix

Canonical dispatch authority for the 9 visible GSD skills. Shared semantics live only here; each skill file restates only its mode-specific guard and transition. Exactly one row per visible skill. Helper rows with a true Helper-when condition must load and cannot be skipped.

| Skill | Role | Intent | Prerequisites | Do-not-load | Transition | Helper-when |
| --- | --- | --- | --- | --- | --- | --- |
| `gsd-brainstorming` | owner | Resolve non-trivial new behavior or product/architecture tradeoffs into a concrete acceptance and Domain Impact contract | Explicit design intent or load-bearing Spec-gap return | Read-only questions, pure mechanical edits, known single-spot quick fix | On convergence load `gsd-to-plan` | — |
| `gsd-to-plan` | owner | Create or finalize canonical `plan.md` with bound Domain Impact after acceptance criteria converge | Converged acceptance contract from `gsd-brainstorming` or validated unapproved plan | Design decisions still open; Nano edits | On approval use `gsd-state.mjs write-state` to write `state.toon` and load `gsd-executing-plans` | — |
| `gsd-executing-plans` | owner | Implement approved plan tasks and owned domain docs inline and sequentially on `wip/<feature>` | Valid approved `plan.md` and bound `state.toon` whose pending work the prompt names | No bound plan/state; a bare resume naming no work; inventing authority | After all tasks and Fast TDD Checks are green load `gsd-verify` | — |
| `gsd-handoff` | owner | Pause, save, resume, or recover from a valid `state.toon`, ledger, or capsule | Valid `state.toon`, ledger, or capsule; every bare resume naming no work enters here first | Missing/malformed state used to invent work | Load the peer named by validated `next_action` | — |
| `gsd-verify` | owner | Review a diff/PR or prove planned or Quick-fix code-and-domain conformance before slow/E2E | Planned: bound plan/`state.toon`; Quick-fix: exact Quick-fix `plan.md`; standalone: supplied diff | Invent completion without deterministic gates | Planned or Quick-fix green path: squash, cleanup, optional retain/archive | — |
| `gsd-diagnosing-bugs` | owner | Diagnose non-obvious failures inline and produce root-cause evidence | An unlocated or non-obvious cause needing evidence | A located failure: the prompt names the file/line or exact failure signature | Return evidence to execution or an architectural cause to `gsd-codebase-architecture` | — |
| `gsd-codebase-architecture` | owner | Design a named seam or audit/refactor architecture with domain-aligned deep boundaries | Explicit interface/architecture intent or diagnosis-returned architectural cause | Unrelated broad exploration or feature work with no unresolved seam | Selected candidates enter `gsd-brainstorming`; execution evidence returns to its owner | — |
| `gsd-tdd` | helper | Drive Fast TDD RED→GREEN→refactor at a public seam | Session owner is implementing or repairing observable behavior | Primary skill selection; resource-heavy browser/E2E task loops | Return green/red evidence to session owner | must load when an observable task is selected or repaired |
| `gsd-domain-modeling` | helper | Maintain current production domain behavior for affected contexts | Domain Impact changes a context or explicit domain-model work is selected | Read-only/Nano work; uncertain or unrelated contexts | Return exact changed domain and AGENTS paths to session owner | must load when Domain Impact is not `none` or explicit domain-model work is selected |

The Quick-fix route belongs to the session owner, not a visible skill: a fix the user already diagnosed stays ordinary direct work, while a larger bounded fix reads the exact injected Ponytail context, writes the canonical Quick-fix plan, runs RED→GREEN→refactor with `gsd-tdd`, then loads `gsd-verify` as that packet's WIP gate. A returned Quick-fix WIP Fail leaves a repair round the prompt can name, and naming it loads that same `gsd-verify` gate rather than answering directly. Ponytail stays hidden and never enters the matrix or runtime state.

## Durable documentation contract

Git-tracked knowledge intended for both people and agents is strict Markdown under `docs/`; TOON is never used for durable prose or human-approved goals.

- `docs/domain/index.md` is a small bounded-context index; `docs/domain/<scope>.md` shards describe current production terms, actors, invariants, workflows, outcomes, relationships, and policies. Shard by bounded context, never feature. They are not implementation plans or journals. `gsd-domain-modeling` owns the exact schema and is the sole writer.
- `docs/gsd/<feature>/milestones.md` is the human-reviewable milestone contract and ledger. Its goals are approved authority; its status column is controlled by terminal verification.
- `docs/gsd/<feature>/archive/plan.md` and `docs/gsd/<feature>/archive/implementation.md` are optional history only. They never become execution authority and never reopen a completed feature.

Runtime-only `state.toon` stays TOON under `.scratch/`. A format is authoritative by its declared role and canonical path, never extension alone.

### Domain lifecycle

Every converged feature records `Domain Impact`. `classification=none` requires `contexts=none`, `documentation=none`, and concrete evidence. A semantic change names every affected context and binds its exact `docs/domain/<context>.md` paths to the tasks owning the code change. Both grammars enforce it: every live shard owner must also change semantic code; a superseded task never counts, so prose-only or test-only ownership fails.

An existing `docs/domain/index.md` suppresses every broad codebase/domain bootstrap prompt: validate it, read only shards mapped to affected contexts, and do not offer one. When the index is absent, semantic work must bootstrap the feature-scoped context documentation, then offer one independent broad-bootstrap decision; `declined` never waives that required write.

Domain docs describe current production behavior after the task, while the plan records target behavior before it. Existing docs are hints; code, schemas, contracts, and tests win on conflict. Drift blocks until code and affected shards agree. `gsd-domain-modeling` also upserts one canonical `## Domain documentation` section in the applicable `AGENTS.md`, preserving unrelated instructions without duplication.

## Canonical Markdown contract

### Authority

The sole pre-approval human/agent contract is the canonical UTF-8/LF `plan.md` in `.scratch/<feature>/`, created by `gsd-to-plan` and amended in place by its executing owner.

The `plan.md` is the only authority for intent, acceptance, task order, seams, files, and focused checks. Any legacy `proposal.md`, `spec.md`, or `design.md` is rejected and stops automatic selection with a Spec escalation. Root or scratch `proposal.toon`, `spec.toon`, `design.toon`, and `plan.toon` are stale non-authoritative files: never derive scope, recovery, acceptance, or task order from them.

TOON remains runtime-only: the single atomic `state.toon` snapshot. Runtime records report progress and bind source bytes; they cannot author, amend, or reinterpret Markdown contracts or durable documentation. Numbered `handoff-<n>.toon`, task-attempt files, `result.toon`, reload manifests, and persisted live-agent generation fields are rejected legacy runtime history with no authority and no compatibility shim.

### Fast TDD and task-loop constraints

Every observable task loads `gsd-tdd` and uses a Fast TDD Check for RED before implementation, GREEN after implementation, and refactor after green.
- Browser, GUI, external network, long-lived server, large fixture, and material-cost checks never run in the implementation loop.
- The current top-level session owner implements and repairs each ordered task inline and sequentially; GSD dispatches no child implementation, repair, diagnosis, architecture, or verification work.
- Task boundaries use focused green evidence kept only in reporting/transcripts.
- Planning adds the smallest real fast public seam when none exists; observable behavior never uses `none`.

### Packet grammar

All fields use exact headings and labels, canonical order, UTF-8/LF, and no blank leading/trailing lines. Reject missing, duplicate, malformed, unknown, empty, vague, or reordered fields, and any line between the title and its first section. Never normalize, infer, or repair source values.

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
## Domain Impact
- **Classification:** <none|change-existing-context|introduce-context|change-context-boundary>
- **Contexts:** <none|sorted comma-space-separated context slugs>
- **Documentation:** <none|update-existing|bootstrap-feature-context>
- **Broad bootstrap:** <not-offered|declined|selected>
- **Evidence:** <concrete code/schema/contract evidence>
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
- **Files:**
  - `<path>` — <create|modify|delete>: <concise contract intent>
- **Test:** `<focused command or none>`
- **Status:** pending
```

Decisions is exact `None.` or sequential D blocks:

```markdown
### D-1: <title>
- **Decision:** <value>
- **Rationale:** <value>
```

An AC ID is a positive sequential integer.
- Only `active` criteria execute; a replacement receives a new ID while the former criterion is `superseded`.
- Outcome, Action, and Expected must independently name a concrete behavior, operation, and observable result.
- `TBD`, `TODO`, `works correctly`, `run tests`, `valid`, `covered`, or `success` are invalid.
- `Domain Impact` uses the exact five fields above.
- `none` requires no contexts or documentation; every other classification requires sorted affected context slugs and a documentation update, while `introduce-context` requires `bootstrap-feature-context`.
- Broad bootstrap is an independent decision and is `not-offered` whenever the domain index exists.
- Every active AC has exactly one matching Interfaces row.
- A lower seam is valid only with a concrete reason that the higher production boundary is absent or cannot deterministically isolate the criterion.
- Task IDs are positive sequential integers in heading order.
- Every active AC appears exactly once across non-superseded task `Satisfies` fields.
- Every task owns at least one exact repository-relative path and one focused command; `none` is valid only for truly non-observable mechanical work.

Canonical task parsing accepts only structured task blocks. Structured `Files` entries require a unique safe repository-relative path, one `create|modify|delete` operation, and concise non-vague intent.

`gsd-to-plan` single-writes and approves only plans containing canonical `Domain Impact`, and the parser accepts exactly that grammar. A plan missing `Domain Impact`, or using the single-line path-only task form, is rejected in every validation path whether or not a recorded SHA-256 binding matches.

### Quick-fix plan exception

A Quick-fix is not a converged feature packet. Its direct fast path writes a minimal UTF-8/LF `plan.md` with this exact grammar:

```markdown
# Quick-fix Plan
## Feature
`<feature>`
## Base
`<base>`
## Domain Impact
- **Classification:** <none|change-existing-context|introduce-context|change-context-boundary>
- **Contexts:** <none|sorted comma-space-separated context slugs>
- **Documentation:** <none|update-existing|bootstrap-feature-context>
- **Broad bootstrap:** not-offered
- **Evidence:** <concrete code/schema/contract evidence>
## Tasks
### T1: <short task>
- **Files:**
  - `<path>` — <create|modify|delete>: <concise contract intent>
- **Test:** `<focused command>`
```

It contains one or two sequential tasks with unique structured paths and a real focused command.
- The exact five-field `Domain Impact` follows the canonical classification rules:
  - `none` requires concrete no-change evidence, every non-`none` classification changes production sources in exactly one task, and Quick-fix always records `Broad bootstrap: not-offered`.
- An absent `docs/domain/index.md` keeps Quick-fix bounded:
  - `Broad bootstrap` stays `not-offered` and non-`none` impact bootstraps the feature-scoped shard inline in that same task.
  - Only an explicitly requested broad bootstrap exits the bounded route for normal discovery.
- Only the Quick-fix WIP verifier consumes this plan.
- It has no proposal/spec/design source set, no normal-packet approval binding, and no normal-packet authority. Its `state.toon` records the validated hash; since `validate-quick-fix` takes no `--expected-sha256`, the gate compares its unbound revalidation against that record.
- Ordinary packet validation MUST NOT classify it as malformed converged state or dispatch normal execution from it; its `gsd-verify` gate owns it until landing or a blocker.

### Executable contract validator

`lib/gsd-contract.mjs` is the single executable Markdown grammar. Repository tests import it directly; lifecycle owners use its thin agent-facing CLI. Substitute the injected `GSD_ROOT` value for `<GSD_ROOT>` at call time: it reaches the session as bootstrap text, not an exported shell variable, so a literal `$GSD_ROOT` resolves to an empty path. The absolute script path is required because the lifecycle runs in workspaces that are not the GSD checkout, where a repo-relative path reaches no CLI; packet resolution stays relative to the workspace `cwd`.

```text
node "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md [--expected-base <base_ref>]
node "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md --expected-sha256 <64-hex> --expected-base <base_ref>
node "<GSD_ROOT>/tools/gsd-contract.mjs" validate-quick-fix --path .scratch/<feature>/plan.md [--expected-base <base_ref>]
```

The first command validates a new canonical full plan and returns its exact SHA-256; it also revalidates a full-plan amendment before rebinding. The second requires the bytes to match an approved hash, so a moved byte exits 1 without mutation; the owner resolves that through § Plan amendment, not as a lifecycle stop. The third selects only the Quick-fix grammar. Inputs are bounded to a 1 MiB fatal-UTF-8 regular `plan.md` beneath a real `.scratch/<feature>/`; symlinks, escaped paths, feature mismatch, and malformed grammar fail closed.


Success emits only deterministic scalar TOON:
- A plan returns `status`, `kind`, `feature`, `base`, `sha256`, and `tasks`.

Structured actionable failures also use TOON on stdout:
- An unreadable file reports `code: io-error`; malformed authority reports `code: invalid-artifact`. Both exit 1.
- Usage failures exit 2 and help exits 0.
- No command writes plan, state, domain, or Git data.

### Approval binding

`gsd-to-plan` validates canonical structured `plan.md`, prints its task/AC/Domain Impact summary, calculates SHA-256, and presents the single post-plan action surface.
- Approval records feature, exact plan path/hash, base/WIP identity, no completed task, canonical preferences, and checkpoint revision in atomic `schema:v4` `state.toon`, then reads it back before loading `gsd-executing-plans`.
- A fresh approval after Spec escalation atomically supersedes the older binding.
- Full semantic parse and binding checks run only at approval, resume, terminal entry, and pre-squash; ordinary task selection and green checkpoints use the retained validated slice.

The validator runs unbound at new-plan approval and when revalidating an amendment before rebinding; every other full-plan call uses the bound-hash form. Once `state.toon` exists, every call also passes `--expected-base <state.base_ref>`, so a plan whose § Base drifted from the recorded merge target fails closed instead of sending the squash elsewhere. Quick-fix verification and resume use `validate-quick-fix`.

Because `state.toon` records no grammar kind, resume probes `validate-quick-fix` first and only then the full-plan form; a bound call checks the hash before parsing, so an unbound revalidation is what separates moved bytes from malformed grammar. The probe proves the recorded grammar only on a hash match; on any difference the prior kind is unprovable, so resume asks before rebinding to the current grammar.

No model, agent, or persistent session identity participates in approval. The current top-level session is the sole lifecycle authority; a later session assumes that role only through canonical rehydration.

### Convergence Ledger publication contract

A milestone ledger is optional Git-tracked Markdown at exactly `docs/gsd/<feature>/milestones.md`, allowed only when a large feature has materially precise, user-approved milestone goals. Its creation/update is a convergence-time write owned by one exact plan task's Files field and subject to normal review/acceptance. `plan.md` must contain `## Publication` with either `null` or the canonical ledger path whose slug exactly equals Feature. It authorizes planned publication only, never completion, task selection, or resume. Ledger presence alone is metadata.

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

IDs are positive sequential `M1..MN`; slugs are unique lowercase kebab-case; goals are non-empty, concrete single-line text without `|`; status is exactly `pending` or `done`.
- Feature must equal the directory slug, Base must name the approved base branch, headings and columns are exact, and no extra sections, rows, or columns are allowed.
- Rows consist of a possibly empty `done` prefix followed by a non-empty `pending` suffix.
- Creation or convergence-time append preserves every existing row byte-for-byte and adds only new `pending` rows.
- A ledger with no pending row is a stale lifecycle residual, not a completed canonical ledger.

### Milestone Ledger completion contract

Only the `Milestone WIP gate` may complete ledger lifecycle state. `gsd-executing-plans` treats the selected first-pending row and all ledger bytes as read-only during task work. At terminal verification, `gsd-verify` proves the selected row still matches the approved milestone and remains first pending.

- **Non-final milestone:** change exactly the selected row's status from `pending` to `done`; preserve every other byte.
- **Final milestone:** delete `docs/gsd/<feature>/milestones.md` instead of writing an all-`done` ledger.

The status transition or deletion is part of the reviewed WIP diff and lands only in the same green squash commit as the milestone implementation. A red gate never changes base ledger state. Normal execution/publication never completes or deletes a row.

## Runtime state contract

### Resumable State Snapshot

Exactly one current `.scratch/<feature>/state.toon` owns resume discovery. It is a fixed-schema UTF-8/LF scalar record with canonical field order:

```toon
schema:v4
feature:<feature-slug>
phase:draft|approved|executing|paused|verifying|repair|merged-cleanup-pending|completed-retained
next_action:<opaque next action or none>
plan_path:.scratch/<feature>/plan.md|none
plan_sha256:<64-hex>|none
base_ref:<branch>|none
wip_branch:wip/<feature>|none
last_green_task:T<n>|none
last_green_commit:<40-hex>|none
autosync:none|on|off
cleanup_preference:none|delete|retain|archive-and-delete
checkpoint_revision:<positive int>
```

Phase-inapplicable values use canonical `none`.
- Current `schema:v4` parsing rejects invalid UTF-8, carriage returns, blank lines, unknown keys, duplicates, reordered fields, empty values, legacy settings tables, Ponytail preference state, and obsolete model or agent rows.
- Exact active `schema:v1`, `schema:v2`, and `schema:v3` records migrate only after full validation.
- Explicit reads and resume reject every v1/v2 terminal record fail closed and byte-identical.
- An exact `schema:v3` `completed-retained` record is the sole terminal explicit-read compatibility case: candidate discovery leaves it inert, while an explicit `readStateFile` validates and atomically migrates it to canonical `schema:v4`.
- Every legacy field, including `ponytail_level` where present, is validated before migration, obsolete rows are discarded, and `checkpoint_revision` increments.
- Malformed, partial, reordered, unknown, or non-concrete legacy records fail closed unchanged; partial old terminal evidence is discarded and deterministic conformance reruns.

Exact v1/v2 `completed-retained` records are structurally recognized during candidate discovery only so they can remain inert, byte-identical, and excluded from active candidates. This is not terminal read compatibility: an explicit `readStateFile` rejects v1/v2 terminal records unchanged. Retained v3 remains the sole terminal case that an explicit validated read can migrate.

### Atomic write

Every checkpoint write creates a complete temporary file in the same feature directory, fsyncs it, atomically renames it over `state.toon`, fsyncs the directory where supported, then reads back and validates before reporting the checkpoint complete. Reject symlink or non-directory feature paths; require the feature directory basename to equal `state.feature` under a real `.scratch` parent; require `plan_path` to equal `.scratch/<feature>/plan.md` when bound. No dispatch occurs from unvalidated or partially written `state.toon`.

### Checkpoint cadence

Persist only:

- draft plan existence
- approval binding (`phase=approved`)
- green task commit (`last_green_task` / `last_green_commit`)
- pause or automatic context pressure (`phase=paused`)
- terminal entry, repair, or current-commit conformance (`phase=verifying|repair`)
- merged cleanup (`phase=merged-cleanup-pending|completed-retained`)

Do not write active-task, numbered-history, reload-manifest, or persistent identity checkpoints. The session owner rebuilds complete task or terminal slices from canonical plan/state/Git. Structured slices preserve ordered file paths, operations, intents, and applicable AC/Decision constraints.

### Plan amendment

A bound-hash mismatch means the bytes moved, never a stop; only a missing or malformed-grammar `plan.md` fails closed. Drift never diverts prompt-named work to `gsd-handoff`: the executing owner amends it, revalidates unbound with its grammar's validator (`validate-plan`, or `validate-quick-fix` for a Quick-fix), and rebinds the returned hash into `state.toon` with an incremented `checkpoint_revision`. No branch closes and no fresh feature opens.
- Bookkeeping amendments are self-service: recording a file the task touches, fixing a path or intent, splitting or reordering pending tasks, or sharpening wording that leaves acceptance intact.
- Material amendments ask one question first, then proceed with the chosen option: changing an active criterion's Outcome/Action/Expected, weakening an invariant or non-goal, changing `Domain Impact`, replacing an interface pin, or rewriting a completed task's record. Ask before rebinding.
- A mismatch the owner cannot account for asks one question naming the affected sections; the answer picks rebind or restore.
- Uncertainty is one question with a recommended default, never a stop or new plan.

### Skill derivation from phase and next_action

Active helpers are derived, never stored as a reload manifest:

- `start/continue task`: `gsd-executing-plans`, `gsd-handoff`, and `gsd-tdd`; implementation and repair remain session-owner inline.
- `enter terminal verification/repair`: `gsd-verify` and `gsd-handoff`; opaque `next_action` resumes deterministic conformance or Deferred Slow E2E without new state keys.
- `Discussion/Spec-escalation`: `gsd-handoff`.
- Conditional: `gsd-domain-modeling` completes mandatory affected-context documentation before checkpoint.

Master (`gsd`) is already present from bootstrap and is never listed as a derived reload skill. Hidden Ponytail context has no runtime mode or preference state. Recovery must never load master recursively or execute the capsule again.

### Recovery tooling exclusions

Lifecycle recovery restores the working tree, never only the conversation.
- A harness conversation rewind is excluded from lifecycle recovery: it restores transcript turns while committed WIP and the working tree stay where execution left them, so `state.toon` and its green commits remain ahead of the restored conversation. Resume from `state.toon` and Git instead.
- A memory backend recall is context, never lifecycle authority: only canonical `plan.md`, `state.toon`, and Git bytes authorize a resume decision.
- A restricted harness mode whose toolset excludes editing files, committing, and running checks cannot own lifecycle work; the owner leaves that mode before task, repair, verification, or merge work begins.

### Candidate discovery

The extension and harness adapters derive active feature candidates from the filesystem:

1. **Directory Inspection**: Check if `.scratch/` exists and is a directory in `cwd`. If missing or not a directory, the candidate list is empty (`[]`).
2. **Feature Directory Filtering**: Inspect child entries of `.scratch/`. An entry is eligible if it is a real directory (not a symlink), its name matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`, and UTF-8 byte length is <= 255.
3. **Feature Requirements**: The feature directory must contain regular files `plan.md` and `state.toon`. Symlink `state.toon` fails closed. Validate `state.toon` structurally; completed-retained is inert for ordinary resume; active phases may be selected. Legacy handoff-only or attempt-only packets are ignored (no authority).
4. **No Content Execution**: Discovery never executes artifact contents.
5. **Candidate Array**: Returns eligible active feature names sorted alphabetically (byte order).

#### Compaction Recovery Capsule

The Compaction Recovery Capsule is owned by GSD and is the canonical recovery interface. Its exact model-independent template is:

```text
[GSD Recovery Capsule]
Active GSD features: <features>
The listed features are a workspace inventory only and do not indicate which feature the current session is working on.
<resume_instruction>
Compaction MUST preserve and continue the current user request. Only resume an active feature when the preserved request or a bare continue explicitly selects it.
```

#### Current Request Preservation

During compaction, `session.compacting` extracts the last genuine user request from `event.messages` and returns it as a separate context item alongside the capsule. The extraction filters out bootstrap messages, recovery capsules, and compaction summaries. The request is bounded to 500 UTF-8 bytes.

When present, the second context item is:

```text
[GSD Current Request]
<last genuine user request, truncated to 500 bytes>
```


The capsule itself remains bounded and unchanged. The current request is informational: it preserves user intent across compaction so the agent can continue the current task rather than resuming a listed workspace feature. The capsule's workspace inventory does not prove session ownership; only a bare `continue` or an explicit prompt naming an active feature should trigger resume.

#### Generic Renderer Protocol

The canonical renderer is a generic protocol requiring:
1. **Inputs & Validation Preconditions**:
   - `features`: An array of feature name strings. Must contain at least 1 feature. Accepts every finite candidate count. Each feature must match the safe-slug grammar `^[a-z0-9]+(?:-[a-z0-9]+)*$` and must not exceed 255 bytes. All feature names must be unique; duplicates are rejected.
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
   - The `<resume_instruction>` is a single string for both modes. It delegates routing to the bootstrap:
    `If resuming, follow the bootstrap routing in <masterPath>: bare "continue" selects gsd-handoff; a prompt naming an active feature routes to that feature's owner skill.`
   - In Bounded-Ambiguity mode (> 5 active features), an additional clause is appended:
    ` Some features are omitted from this list — stop and select exactly one active feature before resuming.`
   - Both modes end with:
    ` Stop immediately on malformed or ambiguous state. Otherwise, continue ordinary routing for the current request.`
7. **Complete-Capsule Fail-Closed Cap**:
   - A rendered capsule over 4000 bytes fails closed; no truncation or slicing of root, slug, instruction, or Unicode is permitted. The exact per-field arithmetic lives beside `createCapsule` in `extensions/gsd-context.js`.

### Completed-state and cleanup matrix

Apply this matrix only before non-direct lifecycle work. Strictly validate every discovered `.scratch/<feature>/state.toon` first and take the first matching outcome. `ignore-terminal-record` requires a discovered `phase=completed-retained` record or residual terminal bytes; with no such record present, unrelated work stays `ordinary-routing`:

| Condition | Decision | Action |
|---|---|---|
| A full malformed packet (`plan.md` plus `state.toon`) | `fail-closed` | Stop and name it; `detectCandidates` throws for every prompt, before relatedness or terminal tests and before any other valid packet wins. (Autocompaction uses fault-tolerant discovery — malformed packets are skipped individually, valid candidates survive, and all-malformed produces no capsule.) |
| Malformed residual bytes without a `plan.md` | `ordinary-routing` | Leave them; continue automatic selection. |
| A valid `phase=merged-cleanup-pending` state is named by the prompt, or the prompt is lifecycle work on that same feature | `cleanup-question` | Ask one question resuming only its existing delete-or-retain decision; the pre-squash archive opportunity is not reopened. |
| A valid `phase=merged-cleanup-pending` state is unrelated to the prompt, including a direct Nano edit or a new unrelated lifecycle | `ordinary-routing` | Continue ordinary selection; never report `ignore-terminal-record`, which covers completed-retained and residual records only. |
| Explicit cleanup targets `completed-retained` or residual merged state | `cleanup-only` | Stop after cleaning that one named packet; load no workflow skill. |
| Resume, implementation, or new-work intent explicitly targets a completed-retained feature | `block-resume` | Stop and report the feature completed. |
| An unrelated `phase=completed-retained` record or residual terminal bytes, including new work or `continue` | `ignore-terminal-record` | Report `ignore-terminal-record`; exclude that history and select active state. |
| No condition above applies | `ordinary-routing` | Continue automatic selection. |

Terminal state never blocks unrelated direct work, and uncertain relatedness asks one question instead of stopping. An active or `merged-cleanup-pending` packet is never terminal history, so new work unrelated to one is plain `ordinary-routing`. Malformed bytes cannot be parsed, so only the `.scratch/<feature>/` directory name is a trusted relatedness signal. Terminal mtimes never compete with active packets; generic `continue` never selects them.

## Post-approval pipeline contract

After approval, the top-level owner runs sequential tasks with Fast TDD RED→GREEN→refactor, commits green checkpoints, and dispatches no child lifecycle work. `Tn+1` requires committed green `Tn`. Mutations and Deferred Slow E2E never overlap.

After green checks, `gsd-verify` proves deterministic cumulative conformance on the unchanged commit: exact binding, one task/interface mapping per active AC, owned paths, plan-ordered diffs, decisions/invariants/non-goals, and focused evidence. Only malformed binding, ownership/coverage mismatch, explicit contract contradiction, unresolved change, or a red deterministic check blocks.

Deferred Slow E2E runs only after current-commit conformance. Source changes invalidate conformance. Green unchanged bytes then enter one-squash merge and cleanup.

An injected orchestration or parallelism directive is harness text that never transfers lifecycle ownership:
- It does not authorize dispatching implementation, repair, diagnosis, architecture, or verification work; satisfying such a directive for lifecycle work means leaving the lifecycle instead.
- Bounded read-only research delegation stays permitted. Its result carries no authority, so the owner re-verifies every fact against canonical sources before acting on it.

## Git/base/WIP/scratch mechanics

For branch-backed writes, first require a Git work tree. `plan.md` records the base before `wip/<feature>` is created. The feature branch is `wip/<feature>` and never self-references as base. Keep `.scratch/` machine-local and git-ignored; portable sync, where intentionally requested, is an explicit pathspec operation and remains runtime-only. Review diffs exclude scratch. Before squash, verify base, WIP, upstream, and reviewed non-scratch tree against the recorded runtime binding; any mismatch blocks merge. Nano and read-only work are completely git-free.

Cross-machine sync carries the committed WIP branch and exact `.scratch/<feature>/` packet (`plan.md` and `state.toon`). Dirty non-scratch paths still require an explicit named snapshot decision. On resume, the session owner rehydrates from the bound schema-v4 state, exact plan bytes/hash, base/WIP, last green task/commit, current tree, and required artifacts. Portable sync never sweeps unrelated dirty paths.

### Base derivation and merge target

At packet creation, before `wip/<feature>` exists, run `git symbolic-ref --quiet --short HEAD` and record that branch in both `plan.md` § Base and `state.toon` `base_ref`; every bound validator call passes `--expected-base <base_ref>`, so the two records cannot diverge. Never use `git rev-parse --abbrev-ref HEAD`, which prints the literal `HEAD` when detached. A detached HEAD fails closed instead of recording a commit oid, because the base is the branch that must hold the squash.

A repository default, upstream branch, or naming convention is authoritative only when it is the checked-out branch; a linked worktree records its own branch; the base is never `wip/<feature>`.

The terminal squash merges into exactly the recorded `base_ref`, so `main` is the merge target only when `main` is that base. Before squashing, verify `base_ref` still resolves to a local branch able to receive the merge; a vanished base blocks the gate instead of retargeting. Never ask whether to merge into `main` and never widen to the repository default. Promoting the base onward — into `main`, a release train, or a pull request — is separate user-owned work after the packet ends green.

## Feature cleanup

For explicit abandon/drop/delete: confirm the feature name, inspect whether the worktree is dirty, check out the recorded base, safely delete the WIP branch, and remove `.scratch/<feature>/`. Never force-delete unmerged work without explicit confirmation.

### Terminal scratch disposition

Before final terminal review/squash, the user may explicitly select retain or archive-and-delete; omission defaults to delete after a green merge. There is no mandatory terminal cleanup prompt. Persist `cleanup_preference` in `state.toon` when explicitly chosen (via `gsd-state.mjs write-state`; see `gsd-handoff` § Write). After a green merge, use the same CLI invocation to write `phase=merged-cleanup-pending` and remove scratch unless retain or archive-and-delete was selected; crash recovery resumes only that cleanup decision. The pre-squash archive opportunity is not reopened after merge.

- **delete (default):** after the green squash, remove `.scratch/<feature>/`.
- **retain:** keep `.scratch/<feature>/` and set `phase=completed-retained` with `next_action=none`.
- **archive-and-delete:** materialize the feature archive under `docs/gsd/<feature>/archive/` before final terminal conformance/squash, include those files in the same reviewed squash, then remove `.scratch/<feature>/` after publication; never create a post-squash or post-merge documentation-only commit. The canonical `docs/gsd/<feature>/archive/plan.md` and `docs/gsd/<feature>/archive/implementation.md` destinations are terminal-cleanup-owned lifecycle paths included in changed-path ownership proof; every other changed path must be task-owned.

### Feature archive contract

Archive output is non-authoritative historical reference. During the active cycle, `.scratch/<feature>/plan.md` remains the sole execution/design authority; archived files never reopen execution and are never treated as active authority.

When archive-and-delete is selected:
1. Copy the exact approved `.scratch/<feature>/plan.md` bytes to `docs/gsd/<feature>/archive/plan.md`.
2. Write `docs/gsd/<feature>/archive/implementation.md` summarizing the feature outcome, changed paths, acceptance outcomes, and verification evidence.
3. Do not copy legacy handoffs, immutable attempts, `result.toon`, or other rejected runtime history.
4. If either archive destination already exists, fail closed and preserve prior content; never overwrite.
5. Materialize and review the archive before squash so it lands in the same green one-feature/one-squash commit with the implementation; never create a second documentation commit after squash.
6. After publication, delete `.scratch/<feature>/` as with ordinary delete disposition.

Existing one-squash branch cleanup and scratch cleanup contracts remain intact.


## Contextual disclosure templates

Pre-approval post-plan action surface:

```text
Next steps (reply with number or text):
1. Approve and execute
2. Revise the plan
3. Pause & save progress
```

Directly selected skills use natural-language actions:

```text
Next steps:
- Continue the active work or save progress.
```

Inline helper loading appends nothing. Post-approval pipeline output reports factual progress or blockers only; blocker stops never imply merge success.
