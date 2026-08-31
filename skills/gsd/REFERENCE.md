# GSD Reference

Load this file only when a flow needs its policy. It defines the shared meaning of artifacts and lifecycle state; skills select an Invocation Mode before validating required artifacts.

## Artifact Contract

`consumes:` and `produces:` frontmatter are catalog unions, not unconditional prerequisites. Each multi-mode skill declares a compact Invocation modes table:

| Role | Meaning |
| --- | --- |
| Required | Must exist for the selected mode. Follow that row's recovery or blocker action when absent. |
| Optional | Normal when absent; never reroutes a mode. |
| Produced | May be created by the selected mode. |
| Fallback | The documented recovery, reconstruction, or blocker path. Never invent a file or contents. |

Explicit intent and entry context choose the mode; artifact presence never does. Validate `phase` against fixed schema enums; preserve opaque `next_action` values on resume. A missing, malformed, or duplicate **required** artifact fails closed; optional state does not; bound-hash mismatches rebind under § Plan amendment.


## Visible skill mandatory-use matrix

Canonical dispatch authority for the 9 visible GSD skills. Shared semantics live only here; each skill file restates only its mode-specific guard and transition. Exactly one row per visible skill. Helper rows with a true Helper-when condition must load and cannot be skipped.

| Skill | Role | Intent | Prerequisites | Do-not-load | Transition | Helper-when |
| --- | --- | --- | --- | --- | --- | --- |
| `gsd-brainstorming` | owner | Resolve non-trivial new behavior or product/architecture tradeoffs into a concrete acceptance and Domain Impact contract | Explicit design intent or load-bearing Spec-gap return | Read-only questions, pure mechanical edits, known single-spot quick fix | On convergence load `gsd-to-plan` | — |
| `gsd-to-plan` | owner | Create or finalize canonical `plan.md` with bound Domain Impact after acceptance criteria converge | Converged acceptance contract from `gsd-brainstorming` or validated unfinalized plan | Design decisions still open; Nano edits | On `validate-plan` success use `gsd-state.mjs write-state` to write `state.toon` and load `gsd-executing-plans` | — |
| `gsd-executing-plans` | owner | Own bound plan tasks and domain docs on `wip/<feature>`: sub-agents author each wave's tasks, the owner reconciles and repairs | Valid bound `plan.md` and bound `state.toon` whose pending work the prompt names | No bound plan/state; a bare resume naming no work; inventing authority | After all tasks and Fast TDD Checks are green load `gsd-verify` | — |
| `gsd-handoff` | owner | Pause, save, resume, or recover from a valid `state.toon`, ledger, or capsule | Valid `state.toon`, ledger, or capsule; every bare resume naming no work enters here first | Missing/malformed state used to invent work | Load the peer named by validated `next_action` | — |
| `gsd-verify` | owner | Review a diff/PR or prove planned or Quick-fix code-and-domain conformance before slow/E2E | Planned: bound plan/`state.toon`; Quick-fix: exact Quick-fix `plan.md`; standalone: supplied diff | Invent completion without deterministic gates | Planned or Quick-fix green path: squash, cleanup, optional retain/archive | — |
| `gsd-diagnosing-bugs` | owner | Diagnose non-obvious failures inline and produce root-cause evidence | An unlocated or non-obvious cause needing evidence | A located failure: the prompt names the file/line or exact failure signature | Return evidence to execution or an architectural cause to `gsd-codebase-architecture` | — |
| `gsd-codebase-architecture` | owner | Design a named seam or audit/refactor architecture with domain-aligned deep boundaries | Explicit interface/architecture intent or diagnosis-returned architectural cause | Unrelated broad exploration or feature work with no unresolved seam | Selected candidates enter `gsd-brainstorming`; execution evidence returns to its owner | — |
| `gsd-tdd` | helper | Drive Fast TDD RED→GREEN→refactor at a public seam | Session owner is implementing or repairing observable behavior | Primary skill selection; resource-heavy browser/E2E task loops | Return green/red evidence to session owner | must load when an observable task is selected or repaired |
| `gsd-domain-modeling` | helper | Maintain current production domain behavior for affected contexts | Domain Impact changes a context or explicit domain-model work is selected | Read-only/Nano work; uncertain or unrelated contexts | Return exact changed domain and AGENTS paths to session owner | must load when Domain Impact is not `none` or explicit domain-model work is selected |

The Quick-fix route belongs to the session owner, not a visible skill: an already diagnosed fix stays ordinary direct work, while a larger bounded fix reads the exact injected Ponytail context, writes the canonical Quick-fix plan, runs RED→GREEN→refactor with `gsd-tdd`, then loads `gsd-verify` as WIP gate. A returned Quick-fix WIP Fail leaves a repair round whose prompt name loads `gsd-verify` rather than answering directly. Ponytail stays hidden and never enters the matrix or runtime state.

## Durable documentation contract

Git-tracked knowledge for people and agents is strict Markdown under `docs/`; TOON is never used for durable prose or human-approved goals.

- `docs/domain/index.md` is a small bounded-context index; `docs/domain/<scope>.md` shards describe current production terms, actors, invariants, workflows, outcomes, relationships, and policies. Shard by bounded context, never feature; they are not implementation plans or journals. `gsd-domain-modeling` owns the exact schema and is sole writer.
- `docs/gsd/<feature>/milestones.md` is the human-reviewable milestone contract and ledger. Its goals are approved authority; its status column is controlled by terminal verification.
- `docs/decisions/NNNN-slug.md` and `docs/design/NNNN-slug.md` are durable decision and UI/UX design records with one mandatory minimal header; numbering is sequential and gap-free per directory.
- `docs/gsd/<feature>/archive/plan.md` and `docs/gsd/<feature>/archive/implementation.md` are optional history only, never execution authority and never reopening completed features.

Runtime-only `state.toon` stays TOON under `.scratch/`. Formats are authoritative by declared role and canonical path, never extension alone.

### Domain lifecycle

Every converged feature records `Domain Impact`. `classification=none` requires `contexts=none`, `documentation=none`, and concrete evidence. Semantic changes name affected contexts and bind exact `docs/domain/<context>.md` paths to tasks owning code changes. Both grammars enforce it: live shard owners must also change semantic code; superseded tasks never count, so prose-only or test-only ownership fails.

Existing `docs/domain/index.md` suppresses every broad codebase/domain bootstrap prompt: validate it, read only shards mapped to affected contexts, and do not offer one. When absent, semantic work bootstraps feature-scoped context documentation, then offers one independent broad-bootstrap decision; `declined` never waives that required write.

Domain docs describe current production behavior after tasks; plans record target behavior before them. Existing docs are hints; code, schemas, contracts, and tests win on conflict. Drift blocks until code and affected shards agree. `gsd-domain-modeling` upserts one canonical `## Domain documentation` section in applicable `AGENTS.md`, preserving unrelated instructions without duplication.

### Durable decision and design records

Decision records capture load-bearing tradeoffs settled during convergence; design records capture UI/UX decisions settled during execution. Both carry one mandatory minimal header: `# NNNN — Title`, exactly one `- **Status:** Accepted|Rejected|Superseded by NNNN`, exactly one `- **Date:** YYYY-MM-DD`, and a non-empty `## Decision` section; measurement sections stay optional.
`bun "<GSD_ROOT>/tools/gsd-record.mjs" validate --path <record> --kind decisions|design` proves the header: exit 0 is `status: valid`, exit 1 is `code: invalid-record` or `io-error`, exit 2 is usage.
Record naming is opt-in per file: only paths under `docs/decisions/` or `docs/design/` whose basenames start with digits must match canonical `NNNN-slug.md` form; ordinary prose in those directories keeps repository naming.
The terminal gate runs validation on every owned record before squash. `AGENTS.md` gains one `## Decisions` and one `## Design` section, upserted without duplication.

## Canonical Markdown contract

### Authority

The sole plan contract is canonical UTF-8/LF `plan.md` in `.scratch/<feature>/`, created by `gsd-to-plan` and amended by its executing owner.

`plan.md` is the only authority for intent, acceptance, task order, seams, files, and focused checks. Legacy `proposal.md`, `spec.md`, or `design.md` is rejected, stopping automatic selection with a Spec escalation. Root or scratch `proposal.toon`, `spec.toon`, `design.toon`, and `plan.toon` are stale non-authoritative files: never derive scope, recovery, acceptance, or task order from them.

TOON remains runtime-only: the single atomic `state.toon` snapshot. Runtime records report progress and bind source bytes; they cannot author, amend, or reinterpret Markdown contracts or durable documentation. Numbered `handoff-<n>.toon`, task-attempt files, `result.toon`, reload manifests, and persisted live-agent generation fields are rejected legacy runtime history without authority or compatibility shims.

### Fast TDD and task-loop constraints

Every observable task loads `gsd-tdd` and uses a Fast TDD Check for RED before implementation, GREEN after implementation, and refactor after green.
- Browser, GUI, external network, long-lived server, large fixture, and material-cost checks never run in implementation loops.
- Planned implementation tasks are authored by sub-agents under [§ Wave dispatch](#wave-dispatch), the owner implementing inline only when dispatch is unavailable; it repairs each returned task inline and sequentially.
- Task boundaries use focused green evidence kept only in reporting.
- Planning adds the smallest real fast public seam when none exists; observable behavior never uses `none`.

### Wave dispatch

Implementation is the only lifecycle work GSD dispatches, and only as validated waves of provably independent tasks to sub-agents; repair, diagnosis, architecture, and verification stay session-owner inline.
Lifecycle authority and task authorship are distinct: sub-agents author task code, while the owner retains authority because dispatched results count for nothing until inspected, reconciled, committed, and terminally verified.

A **wave** is a maximal contiguous run of non-superseded tasks in strict heading order where pairs are independent: disjoint `Files` path sets, disjoint `Satisfies` criteria, and differing focused `Test` commands.
`analyze-waves` computes waves deterministically. Every wave dispatches: single-task waves to exactly one sub-agent; waves of two or more tasks concurrently, each task into its own isolated workspace on its own task branch, never two tasks in one shared working tree. When harness task isolation is unavailable or an isolated spawn fails, dispatch that wave serially in plan order, the same validated slices one task at a time; inline execution by the owner remains the fallback only when dispatch itself is unavailable.

Each sub-agent receives one complete validated task slice rebuilt from `plan.md`, never invented; MUST run Fast TDD RED→GREEN→refactor; update every affected domain shard in the same commit as semantic code; and commit only green task-owned changes in its isolated workspace on its own task branch cut from wave base.
Before sending any dispatch, the owner re-reads the dispatch prompt against the retained slice and rebuilds it when any slice fact is missing.
A sub-agent MUST NOT mutate `state.toon`, amend `plan.md`, merge, decide lifecycle, or run Deferred Slow E2E.

The owner reconciles waves in strict plan order into one green checkpoint: before merging each returned task it inspects that the diff stays inside the slice's paths and intents, re-runs the task's focused check green, and reads the diff for evident defects; a failed inspection returns to bounded inline repair exactly like a red task. The owner then merges each task branch into `wip/<feature>` in strict plan order and writes `state.toon` through `gsd-state.mjs` CLI; `Tn+1` after the wave begins only from that committed checkpoint.
Failed or red sub-agent tasks return to the owner for bounded inline repair. Terminal conformance proves the unchanged final commit, and plan-ordered diffs hold because the owner merges in plan order.

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
- Only `active` criteria execute; replacements receive a new ID while former criteria become `superseded`.
- Outcome, Action, and Expected must independently name concrete behavior, operation, and observable result.
- `TBD`, `TODO`, `works correctly`, `run tests`, `valid`, `covered`, or `success` are invalid.
- `Domain Impact` uses the exact five fields above.
- `none` requires no contexts or documentation; other classifications require sorted affected context slugs and documentation updates (`introduce-context` requires `bootstrap-feature-context`).
- Broad bootstrap is an independent decision and is `not-offered` whenever the domain index exists.
- Every active AC has exactly one matching Interfaces row.
- A lower seam requires a concrete reason that higher production boundaries are absent or cannot deterministically isolate the criterion.
- Task IDs are positive sequential integers in heading order.
- Every active AC appears exactly once across non-superseded task `Satisfies` fields.
- A `superseded` task may keep original references even when criteria are `superseded`; live tasks satisfy only `active` criteria.
- Structured `Files` entries under `test/`, `tests/`, `__tests__/`, or `spec/` directories, or with `*.test.*` / `*.spec.*` filenames, count as observation-only for shard ownership.
- Every task owns at least one exact repository-relative path and one focused command; `none` is valid only for truly non-observable mechanical work.

Canonical task parsing accepts only structured task blocks. Structured `Files` entries require unique safe repository-relative paths, one `create|modify|delete` operation, and concise non-vague intent.

`gsd-to-plan` single-writes and binds only plans containing canonical `Domain Impact`, and the parser accepts exactly that grammar. Plans missing `Domain Impact` or using single-line path-only task forms are rejected in every validation path whether or not a recorded SHA-256 binding matches.

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
- The exact five-field `Domain Impact` follows canonical classification rules:
  - `none` requires concrete no-change evidence, non-`none` classifications change production sources in exactly one task, and Quick-fix always records `Broad bootstrap: not-offered`.
- An absent `docs/domain/index.md` keeps Quick-fix bounded:
  - `Broad bootstrap` stays `not-offered`; non-`none` impact bootstraps the feature-scoped shard inline in that same task.
  - Only an explicitly requested broad bootstrap exits the bounded route for normal discovery.
- Only the Quick-fix WIP verifier consumes this plan.
- It has no proposal/spec/design source set, no normal-packet plan binding, and no normal-packet authority. Its `state.toon` records validated hashes; since `validate-quick-fix` takes no `--expected-sha256`, the gate compares unbound revalidation against that record.
- Ordinary packet validation MUST NOT classify it as malformed converged state or dispatch normal execution from it; its `gsd-verify` gate owns it until landing or a blocker.

### Executable contract validator

`lib/gsd-contract.mjs` is the single executable Markdown grammar. Repository tests import it directly; lifecycle owners use its agent CLI. Substitute injected `GSD_ROOT` for `<GSD_ROOT>` at call time: bootstrap text is not an exported shell variable, so literal `$GSD_ROOT` resolves empty. Absolute script paths are required because lifecycle workspaces differ from the GSD checkout; packet paths remain workspace-relative.

```text
bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md [--expected-base <base_ref>]
bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md --expected-sha256 <64-hex> --expected-base <base_ref>
bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-quick-fix --path .scratch/<feature>/plan.md [--expected-base <base_ref>]
bun "<GSD_ROOT>/tools/gsd-contract.mjs" normalize-plan --path .scratch/<feature>/plan.md [--write]
```
The first validates a new canonical full plan and returns its SHA-256; it also revalidates amendments before rebinding. The second requires bytes to match a bound hash; a moved byte exits 1 without mutation; the owner resolves that through § Plan amendment, not as a lifecycle stop. The third selects the Quick-fix grammar. Inputs are bounded to a 1 MiB fatal-UTF-8 regular `plan.md` beneath real `.scratch/<feature>/`; symlinks, escaped paths, feature mismatch, and malformed grammar fail closed.

Success emits deterministic scalar TOON:
- Plans return `status`, `kind`, `feature`, `base`, `sha256`, and `tasks`.
- `normalize-plan [--write]` proposes or applies surface-only fixes (backtick wrapping for Feature/Base, line trailing whitespace stripping, single terminal newline) as reviewable diffs.

Actionable failures use TOON on stdout:
- Unreadable files report `code: io-error`; malformed authority reports `code: invalid-artifact` (both exit 1).
- Usage errors exit 2; help exits 0.
- Semantic rejections print `help:` naming concrete fixes (align or split pin conflicts, fields to reorder, canonical shapes); only I/O errors fall back to usage.
- No command writes plan, state, domain, or Git data, except `normalize-plan --write` (sanctioned surface fixes on `plan.md`) and `gsd-state.mjs set` (writes `state.toon`).

### Plan binding and auto-execution

`gsd-to-plan` validates canonical structured `plan.md`, prints its task/AC/Domain Impact summary, calculates SHA-256, and binds it for execution without approval prompts or post-plan menus.
- Binding records feature, exact plan path/hash, base/WIP identity, no completed task, canonical preferences, and checkpoint revision in atomic `schema:v4` `state.toon` with `phase=approved` (plan-bound automatically), reading back before loading `gsd-executing-plans`.
- Fresh bindings after Spec escalation atomically supersede older bindings.
- Semantic parse and binding checks run at binding, resume, terminal entry, and pre-squash; ordinary task selection and green checkpoints use retained validated slices.

The validator runs unbound at new-plan binding and when revalidating amendments before rebinding; other full-plan calls use the bound-hash form. Once `state.toon` exists, calls pass `--expected-base <state.base_ref>`, so plans with drifted § Base fail closed instead of retargeting squashes. Quick-fix verification and resume use `validate-quick-fix`.

Resume probes `validate-quick-fix` first, then the full-plan form; bound calls check hashes before parsing, separating moved bytes from malformed grammar. Probes prove recorded grammars on hash match; differences ask before rebinding.

No model, agent, or persistent session identity participates in binding. Current top-level session is sole lifecycle authority; later sessions assume that role through canonical rehydration.

### Convergence Ledger publication contract

A milestone ledger is optional Git-tracked Markdown at exactly `docs/gsd/<feature>/milestones.md`, allowed only when large features have materially precise, user-approved milestone goals. Creation/update is a convergence-time write owned by one plan task's Files field under review. `plan.md` must contain `## Publication` with `null` or the canonical ledger path whose slug equals Feature. It authorizes planned publication only, never completion, task selection, or resume; ledger presence is metadata.

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

IDs are positive sequential `M1..MN`; slugs are unique lowercase kebab-case; goals are non-empty single-line text without `|`; status is exactly `pending` or `done`.
- Feature equals directory slug, Base names recorded base branch, headings and columns are exact, and no extra sections, rows, or columns are allowed.
- Rows consist of a possibly empty `done` prefix followed by a non-empty `pending` suffix.
- Creation or appends preserve existing rows byte-for-byte, adding only new `pending` rows.
- Ledgers with no pending row are stale lifecycle residuals, not completed canonical ledgers.

### Milestone Ledger completion contract

Only the `Milestone WIP gate` completes ledger lifecycle state. `gsd-executing-plans` treats the selected first-pending row and ledger bytes as read-only during tasks. At terminal verification, `gsd-verify` proves the selected row still matches the bound milestone and remains first pending with `bun "<GSD_ROOT>/tools/gsd-milestone.mjs" validate --path docs/gsd/<feature>/milestones.md --expected-feature <state.feature> --expected-base <state.base_ref>`, then applies the transition with `... complete ...` under the same binding.

- **Non-final milestone:** change the selected row's status from `pending` to `done`; preserve every other byte.
- **Final milestone:** delete `docs/gsd/<feature>/milestones.md` instead of writing an all-`done` ledger.

Status transitions or deletions are part of the reviewed WIP diff, landing in the same green squash commit as the milestone implementation. Red gates never change base ledger state. Normal execution/publication never completes or deletes rows. `tools/gsd-milestone.mjs` is deterministic executor: `complete` marks the first pending row `done`, or deletes the ledger when final.

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
- `schema:v4` parsing rejects invalid UTF-8, carriage returns, blank lines, unknown keys, duplicates, reordered fields, empty values, legacy settings tables, Ponytail preference state, and obsolete model or agent rows.
- Exact active `schema:v1`, `schema:v2`, and `schema:v3` records migrate only after full validation.
- Explicit reads and resume reject every v1/v2 terminal record fail closed and byte-identical.
- An exact `schema:v3` `completed-retained` record is the sole terminal explicit-read compatibility case: candidate discovery leaves it inert, while an explicit `readStateFile` validates and atomically migrates it to canonical `schema:v4`.
- Legacy fields, including `ponytail_level` where present, are validated before migration; obsolete rows are discarded; `checkpoint_revision` increments.
- Malformed, partial, reordered, unknown, or non-concrete legacy records fail closed unchanged; partial terminal evidence is discarded and deterministic conformance reruns.

Exact v1/v2 `completed-retained` records are structurally recognized during candidate discovery only to remain inert, byte-identical, and excluded from active candidates. This is not terminal read compatibility: explicit `readStateFile` rejects v1/v2 terminal records fail closed and byte-identical. Retained v3 remains the sole terminal case an explicit validated read migrates.

### Atomic write

Every checkpoint write creates a complete temporary file in the feature directory, fsyncs it, atomically renames it over `state.toon`, fsyncs directory where supported, then reads back and validates before reporting completion. Reject symlink or non-directory feature paths; require feature directory basename to equal `state.feature` under real `.scratch` parent; require `plan_path` to equal `.scratch/<feature>/plan.md` when bound. No dispatch occurs from unvalidated or partially written `state.toon`.

State updates are recorded through `gsd-state.mjs write-state` or `gsd-state.mjs set` with derived defaults.

### Checkpoint cadence

Persist only:

- draft plan existence
- plan binding (`phase=approved`)
- green task commit (`last_green_task` / `last_green_commit`)
- pause or automatic context pressure (`phase=paused`)
- terminal entry, repair, or current-commit conformance (`phase=verifying|repair`)
- merged cleanup (`phase=merged-cleanup-pending|completed-retained`)

Do not write active-task, numbered-history, reload-manifest, or persistent identity checkpoints. The session owner rebuilds complete task or terminal slices from canonical plan/state/Git; structured slices preserve ordered file paths, operations, intents, and applicable AC/Decision constraints.

### Plan amendment

A bound-hash mismatch means bytes moved, never a stop; only missing or malformed-grammar `plan.md` fails closed. Drift never diverts prompt-named work to `gsd-handoff`: the executing owner amends it, revalidates unbound with its grammar's validator (`validate-plan`, or `validate-quick-fix` for Quick-fix), and rebinds the returned hash into `state.toon` with an incremented `checkpoint_revision`. No branch closes and no fresh feature opens.
- Bookkeeping amendments are self-service: recording touched files, fixing paths or intents, splitting or reordering pending tasks, or sharpening wording that leaves acceptance intact.
- User-stated requirement changes mid-execution are amendments, never new features: amend, revalidate, rebind, and continue without re-asking.
- Material amendments ask one question first, then proceed with chosen options: changing an active criterion's Outcome/Action/Expected, weakening invariants or non-goals, changing `Domain Impact`, replacing interface pins, or rewriting completed task records. Ask before rebinding.
- A mismatch the owner cannot account for asks one question naming affected sections; the answer picks rebind or restore.
- Uncertainty is one question with a recommended default, never a stop or new plan.

### Skill derivation from phase and next_action

Active helpers are derived, never stored as reload manifests:

- `start/continue task`: `gsd-executing-plans`, `gsd-handoff`, and `gsd-tdd`; sub-agents author dispatched implementation, and repair remains session-owner inline.
- `enter terminal verification/repair`: `gsd-verify` and `gsd-handoff`; opaque `next_action` resumes deterministic conformance or Deferred Slow E2E without new state keys.
- `Discussion/Spec-escalation`: `gsd-handoff`.
- Conditional: `gsd-domain-modeling` completes mandatory affected-context documentation before checkpoint.

Master (`gsd`) is already present from bootstrap and never listed as a derived reload skill. Hidden Ponytail context has no runtime mode or preference state. Recovery must never load master recursively or execute the capsule again.

### Recovery tooling exclusions

Lifecycle recovery restores the working tree, never only conversations.
- Harness conversation rewind is excluded from lifecycle recovery: transcript turns rewind while committed WIP and working tree remain where execution left them, so `state.toon` and green commits stay ahead of the restored conversation. Resume from `state.toon` and Git instead.
- Memory backend recall is context, never lifecycle authority: only canonical `plan.md`, `state.toon`, and Git bytes authorize resume decisions.
- A restricted harness mode excluding file edits, commits, and checks cannot own lifecycle work; the owner leaves that mode before task, repair, verification, or merge work begins.

### Candidate discovery

The extension and harness adapters derive active feature candidates from the filesystem:

1. **Directory Inspection**: Check if `.scratch/` is a directory in `cwd`; missing or non-directory yields empty (`[]`).
2. **Feature Directory Filtering**: Eligible `.scratch/` child entries are real directories (not symlinks) matching `^[a-z0-9]+(?:-[a-z0-9]+)*$` with byte length <= 255.
3. **Feature Requirements**: Feature directories must contain regular files `plan.md` and `state.toon`. Symlink `state.toon` fails closed. Validate `state.toon` structurally; completed-retained is inert for ordinary resume; active phases may be selected. Legacy handoff-only or attempt-only packets are ignored (no authority).
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

During compaction, `session.compacting` extracts the last genuine user request from `event.messages` (filtering bootstrap messages, recovery capsules, and compaction summaries; bounded to 500 bytes) and returns it alongside the capsule:

```text
[GSD Current Request]
<last genuine user request, truncated to 500 bytes>
```

The capsule itself remains bounded and unchanged. The current request preserves user intent across compaction so agents continue current tasks rather than resuming listed workspace features. Workspace inventory does not prove session ownership; only bare `continue` or explicit prompts naming active features trigger resume.

#### Generic Renderer Protocol

The canonical renderer is a generic protocol requiring:
1. **Inputs & Validation Preconditions**:
   - `features`: Array of unique feature name strings (>= 1 feature). Accepts every finite candidate count. Each feature matches safe-slug `^[a-z0-9]+(?:-[a-z0-9]+)*$` and <= 255 bytes; duplicates are rejected.
   - `gsdRoot`: Non-empty absolute master path string (`path.isAbsolute`), no control characters (`[\x00-\x1F\x7F]`), <= 1024 bytes.
   - `masterPath`: Emitted path `<gsdRoot>/skills/gsd/SKILL.md` <= 1024 bytes.
   - Fail-closed rule: On any validation violation, throw immediately and fail closed, rendering no partial capsule.
2. **Literal Byte Rendering**: Build canonical capsule lines using direct string concatenation of validated fields without `String.replace` pattern expansion, keeping special characters literal.
3. **Stable Sorting**: Sort feature names alphabetically (by byte order).
4. **Normal vs. Bounded-Ambiguity Selection**: If candidate count <= 5, select **Normal** mode; if > 5, select **Bounded-Ambiguity** mode.
5. **Omitted-Count Formatting**: The candidate list is serialized once only; instructions refer to it without repeating.
   - In Normal mode, `<features>` is serialized as all names joined by `", "`.
   - In Bounded-Ambiguity mode, `<features>` is serialized as the first 5 sorted features joined by `", "`, followed by ` (and <omittedCount> more)` where `<omittedCount>` is `features.length - 5`.
6. **Exact Instruction Values**:
   - The `<resume_instruction>` is a single string for both modes. It delegates routing to the bootstrap:
    `If resuming, follow the bootstrap routing in <masterPath>: bare "continue" selects gsd-handoff; a prompt naming an active feature routes to that feature's owner skill.`
   - In Bounded-Ambiguity mode (> 5 active features), an additional clause is appended:
    ` Some features are omitted from this list — stop and select exactly one active feature before resuming.`
   - Both modes end with:
    ` Stop immediately on malformed or ambiguous state. Otherwise, continue ordinary routing for the current request.`
7. **Complete-Capsule Fail-Closed Cap**: A rendered capsule over 4000 bytes fails closed; no truncation of root, slug, instruction, or Unicode is permitted.

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

Terminal state never blocks unrelated direct work; uncertain relatedness asks one question instead of stopping. Active or `merged-cleanup-pending` packets are never terminal history, so unrelated new work is plain `ordinary-routing`. Only `.scratch/<feature>/` directory names determine relatedness. Terminal mtimes never compete with active packets; generic `continue` never selects them.

## Post-plan pipeline contract

After binding, ordered tasks run with Fast TDD RED→GREEN→refactor and green checkpoints; waves dispatch to sub-agents under [§ Wave dispatch](#wave-dispatch). `Tn+1` requires committed green `Tn` (after waves, the owner's merged checkpoint). Mutations and Deferred Slow E2E never overlap.

After green checks, `gsd-verify` proves deterministic cumulative conformance on unchanged commits: exact binding, one task/interface mapping per active AC, owned paths, plan-ordered diffs, decisions/invariants/non-goals, and focused evidence before Deferred Slow E2E. Only malformed binding, ownership/coverage mismatch, explicit contract contradiction, unresolved change, or red deterministic checks block.

Deferred Slow E2E runs only after current-commit conformance. Source changes invalidate conformance. Green unchanged bytes enter one-squash merge and cleanup.

An injected orchestration or parallelism directive is harness text that never transfers lifecycle ownership:
- It does not authorize dispatching implementation, repair, diagnosis, architecture, or verification work; satisfying such a directive for lifecycle work means leaving the lifecycle instead. Plan-authorized wave dispatch under [§ Wave dispatch](#wave-dispatch) is the only implementation-dispatch path, never triggered by injected text.
- Bounded read-only research delegation stays permitted. Its result carries no authority, so the owner re-verifies every fact against canonical sources before acting on it.

## Git/base/WIP/scratch mechanics

For branch-backed writes, require a Git work tree. `plan.md` records base before `wip/<feature>` is created. Feature branch `wip/<feature>` never self-references as base. Keep `.scratch/` machine-local and git-ignored; portable sync is an explicit pathspec operation and runtime-only. Review diffs exclude scratch. Before squash, verify base, WIP, upstream, and reviewed non-scratch tree against recorded runtime binding; any mismatch blocks merge. Nano and read-only work are git-free.

Cross-machine sync carries committed WIP branch and exact `.scratch/<feature>/` packet (`plan.md` and `state.toon`). Dirty non-scratch paths require an explicit named snapshot decision. On resume, the session owner rehydrates from bound schema-v4 state, exact plan bytes/hash, base/WIP, last green task/commit, current tree, and required artifacts. Portable sync never sweeps unrelated dirty paths.

### Base derivation and merge target

At packet creation, before `wip/<feature>` exists, run `bun "<GSD_ROOT>/tools/gsd-git.mjs" derive-base` and record the printed `base:` branch in `plan.md` § Base and `state.toon` `base_ref`; every bound validator call passes `--expected-base <base_ref>`, so the two records cannot diverge. It reads `git symbolic-ref --quiet --short HEAD`, never `git rev-parse --abbrev-ref HEAD`, which prints the literal `HEAD` when detached. Exit 1 with `code: detached-head` fails packet creation closed instead of recording a commit oid, because base is the branch that must hold the squash.

Repository defaults, upstream branches, or naming conventions are authoritative only when checked out; a linked worktree records its own branch; base is never `wip/<feature>`.

Before squash run `bun "<GSD_ROOT>/tools/gsd-git.mjs" preflight --feature-dir .scratch/<feature>`. Exit 0 prints `status: ready` with observed base, WIP branch, attached HEAD, and clean tree outside `.scratch/`; exit 1 prints `status: blocked` and a `code:` naming drift, which blocks as Spec escalation, because a blocked gate never retargets the merge. Exit 2 corrects only invocation.

Blocking codes are `detached-head`, `base-missing`, `wip-missing`, `base-checked-out-elsewhere`, `base-is-wip`, `dirty-worktree`, `no-git-identity`, `unusable-branch-name`, `not-a-work-tree`, `state-unusable`, `git-query-failed`, `git-unavailable`, and `plan-unbound`: an unanswered Git query blocks rather than reporting ready, proving nothing. The gate proves the bound plan hash for every cleanup disposition before squashing.

`dirty-worktree` counts staged, modified, and untracked paths outside `.scratch/`, because squash commits take the whole index and would carry unreviewed bytes. A rename or copy counts both paths, so moving a reviewed file into `.scratch/` still blocks. Both commands only read: they run no Git subcommand that can change a repository, `status` runs lock-free so reading cannot refresh indexes, and `preflight` inspects `state.toon` without migrating it.

Terminal squash merges into exactly the recorded `base_ref`, so `main` is merge target only when `main` is that base. Never ask whether to merge into `main` and never widen to repository defaults. Promoting base onward (into `main`, release trains, or PRs) is separate user-owned work after packets end green.

## Feature cleanup

For explicit abandon/drop/delete: confirm feature name, inspect whether the worktree is dirty, check out recorded base, safely delete WIP branch, and remove `.scratch/<feature>/`. Never force-delete unmerged work without explicit confirmation.

### Terminal scratch disposition

During discuss the user may select retain or archive-and-delete; omission defaults to delete after green merges. There is no mandatory cleanup prompt. Persist `cleanup_preference` in `state.toon` when explicitly chosen (via `gsd-state.mjs write-state`; see `gsd-handoff` § Write). After green merge, use the same CLI invocation to write `phase=merged-cleanup-pending` and remove scratch unless retain or archive-and-delete was selected; crash recovery resumes only that cleanup decision. The pre-squash archive opportunity is not reopened after merge.

- **delete (default):** after green squash, remove `.scratch/<feature>/`.
- **retain:** keep `.scratch/<feature>/` and set `phase=completed-retained` with `next_action=none`.
- **archive-and-delete:** materialize the feature archive under `docs/gsd/<feature>/archive/` before final terminal conformance/squash, include those files in the same reviewed squash, then remove `.scratch/<feature>/` after publication; never create a post-squash or post-merge documentation-only commit. Canonical `docs/gsd/<feature>/archive/plan.md` and `docs/gsd/<feature>/archive/implementation.md` destinations are terminal-cleanup-owned lifecycle paths included in changed-path ownership proof; every other changed path must be task-owned.

### Feature archive contract

Archive output is non-authoritative historical reference. During active cycles, `.scratch/<feature>/plan.md` remains sole execution/design authority; archived files never reopen execution or active authority.

When archive-and-delete is selected:
1. Copy exact bound `.scratch/<feature>/plan.md` bytes to `docs/gsd/<feature>/archive/plan.md`.
2. Write `docs/gsd/<feature>/archive/implementation.md` summarizing feature outcome, changed paths, acceptance outcomes, and verification evidence.
3. Do not copy legacy handoffs, immutable attempts, `result.toon`, or rejected runtime history.
4. If either archive destination already exists, fail closed and preserve prior content; never overwrite.
5. Materialize and review the archive before squash so it lands in the same green one-feature/one-squash commit with implementation; never create a second documentation commit after squash. Pre-squash `gsd-git.mjs preflight` verifies `archive/plan.md` is byte-for-byte the bound plan and `archive/implementation.md` is non-empty.
6. After publication, delete `.scratch/<feature>/` as with ordinary delete disposition.

Existing one-squash branch cleanup and scratch cleanup contracts remain intact.

## Contextual disclosure templates

Planning has no post-plan menu: once validated, plans bind and execution starts automatically; discuss is the only interactive surface.

Discuss phase surfaces the next human decision directly:

```text
Next steps:
- <recommendation and the next decision to make>
```

Directly selected skills use natural-language actions:

```text
Next steps:
- Continue the active work or save progress.
```

Inline helper loading appends nothing. Post-plan pipeline output reports factual progress or blockers only; blocker stops never imply merge success.
