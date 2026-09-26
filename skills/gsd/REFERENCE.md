# GSD Reference

Load only the `§` sections the flow needs. It defines the shared meaning of artifacts and lifecycle state; skills select an Invocation Mode before validating required artifacts.

## Triage and depth ladder

Triage runs before every route and classifies exactly one of `answer` (read-only or Nano), `clarify`, `research`, `quick`, or `plan` from the prompt and only the context it names, never a repository sweep. Direct work loads no skill, scans no state, and writes no scratch artifact or Git change.

- `clarify` covers missing intent or scope too vague to act, a claimed cause, a supplied design, or a false premise, and asks exactly one question carrying a recommended default and each option's consequence; when nothing behavioral turns on the answer it states the conservative default and proceeds.
- `research` gathers codebase, documentation, reference-repository, or concrete failure evidence before answering, never from memory; bounded read-only delegation stays allowed and carries no authority, so the owner re-verifies every fact.
- A trigger plus an observed failure is sufficient scope to investigate, even without a file, line, stack trace, or known cause; a confirmed non-architectural cause is fixed directly when acceptance is clear.
- Every choice names one recommended option, its alternatives, and their costs.

Depth follows ambiguity, blast radius, reversibility, and acceptance clarity, never file count:
- `direct` — read-only answers and Nano edits: no scratch, branch, commit, or skill.
- `quick` — one bounded change with acceptance converged from the prompt: a direct edit plus a focused test, with no packet, plan, or commit.
- `plan` — multi-task behavior whose acceptance must be written down: the canonical `plan.md`. A feature too large for one plan splits into parts under `gsd-brainstorming`, each its own plan.
- A deeper level is chosen only when the shallower one cannot express the work; depth may rise mid-flight under § Plan amendment and never silently falls to ship a subset.

## Artifact Contract

`consumes:` and `produces:` frontmatter are catalog unions, not unconditional prerequisites. Each multi-mode skill declares a compact Invocation modes table:

| Role | Meaning |
| --- | --- |
| Required | Must exist for the selected mode. Follow that row's recovery or blocker action when absent. |
| Optional | Normal when absent; never reroutes a mode. |
| Produced | May be created by the selected mode. |
| Missing required | The documented recovery, reconstruction, or blocker path when a required artifact is absent. Never invent a file or contents. |

Explicit intent and entry context choose the mode; artifact presence never does. Validate `phase` against fixed schema enums; preserve opaque `next_action` values on resume. A missing, malformed, or duplicate **required** artifact fails closed; optional state does not; bound-hash mismatches rebind under § Plan amendment.


## Visible skill mandatory-use matrix

Canonical dispatch authority for the 5 visible GSD skills. Shared semantics live only here; each skill file restates only its mode-specific guard and transition. Exactly one row per visible skill.

| Skill | Role | Intent | Prerequisites | Do-not-load | Transition | Helper-when |
| --- | --- | --- | --- | --- | --- | --- |
| `gsd-brainstorming` | owner | Resolve non-trivial new behavior or product/architecture tradeoffs into a concrete acceptance and Domain Impact contract | Explicit design intent or load-bearing Spec-gap return | Read-only questions, pure mechanical edits, known single-spot quick fix | On convergence load `gsd-to-plan` | — |
| `gsd-to-plan` | owner | Create or finalize canonical `plan.md` with bound Domain Impact after acceptance criteria converge | Converged acceptance contract from `gsd-brainstorming` or validated unfinalized plan | Design decisions still open; Nano edits | On `validate-plan` success use `gsd-state.mjs set` to write `state.toon` and load `gsd-executing-plans` | — |
| `gsd-executing-plans` | owner | Own bound plan tasks and domain docs on `wip/<feature>`, and pause or resume that work | Valid bound `plan.md` and `state.toon`; a bare `continue` or pause/resume intent | Missing or malformed state used to invent work | After all tasks and Fast TDD Checks are green load `gsd-verify` | — |
| `gsd-verify` | owner | Review a diff/PR or prove planned code-and-domain conformance before slow/E2E | Planned: bound plan/`state.toon`; standalone: supplied diff | Invent completion without deterministic gates | Green terminal gate: `phase=ready`, ask merge or pull request | — |
| `gsd-diagnosing-bugs` | owner | Diagnose non-obvious failures inline and produce root-cause evidence | An unlocated or non-obvious cause needing evidence | A located failure: the prompt names the file/line or exact failure signature | Fix a confirmed non-architectural cause directly with a focused regression test, or an architectural cause to `gsd-brainstorming` | — |

The quick-fix route belongs to the session owner, not a visible skill: a bounded change with converged acceptance is edited directly, proven by its focused test, and reported. It writes no packet, plan, `state.toon`, or commit and loads no `gsd-verify` gate; scope growth escalates to `gsd-brainstorming`.
`gsd-codebase-architecture`, `gsd-domain-modeling`, and `gsd-tdd` are hidden internal references, not visible owners; `gsd-brainstorming`, `gsd-to-plan`, and `gsd-executing-plans` may cite them when their details are load-bearing.

## Durable documentation contract

Git-tracked knowledge for people and agents is strict Markdown under `docs/`; TOON is never used for durable prose or human-approved goals.

- `docs/domain/index.md` is a small bounded-context index; `docs/domain/<scope>.md` shards describe current production terms, actors, invariants, workflows, outcomes, relationships, and policies. Shard by bounded context, never feature; they are not implementation plans or journals. `gsd-domain-modeling` owns the exact schema and is sole writer.
- `docs/decisions/NNNN-slug.md` and `docs/design/NNNN-slug.md` are durable decision and UI/UX design records with one mandatory minimal header; numbering is sequential and gap-free per directory.

Runtime-only `state.toon` stays TOON under `.scratch/`. Formats are authoritative by declared role and canonical path, never extension alone.

### Domain lifecycle

Domain docs apply only in repositories with `docs/domain/index.md` or after the user accepts a bootstrap; elsewhere a plan omits `Domain Impact`. When recorded, `classification=none` requires `contexts=none`, `documentation=none`, and concrete evidence. Semantic changes name affected contexts and bind exact `docs/domain/<context>.md` paths to tasks owning code changes. Both grammars enforce it: live shard owners must also change semantic code; superseded tasks never count, so prose-only or test-only ownership fails.

Existing `docs/domain/index.md` suppresses every broad codebase/domain bootstrap prompt: validate it, read only shards mapped to affected contexts, and do not offer one. When absent, brainstorming may offer a bootstrap once; an accepted bootstrap writes the feature-scoped contexts and may offer one broad-bootstrap decision, and a decline writes nothing.

Domain docs describe current production behavior after tasks; plans record target behavior before them. Existing docs are hints; code, schemas, contracts, and tests win on conflict. Drift blocks until code and affected shards agree. `gsd-domain-modeling` upserts one canonical `## Domain documentation` section in applicable `AGENTS.md`, preserving unrelated instructions without duplication.

### Durable decision and design records

Decision records capture load-bearing tradeoffs settled during convergence; design records capture UI/UX decisions settled during execution. Both carry one mandatory minimal header: `# NNNN — Title`, exactly one `- **Status:** Accepted|Rejected|Superseded by NNNN`, exactly one `- **Date:** YYYY-MM-DD`, and a non-empty `## Decision` section; measurement sections stay optional.
`bun "<GSD_ROOT>/tools/gsd-record.mjs" validate --path <record> --kind decisions|design` proves the header: exit 0 is `status: valid`, exit 1 is `code: invalid-record` or `io-error`, exit 2 is usage.
Record naming is opt-in per file: only paths under `docs/decisions/` or `docs/design/` whose basenames start with digits must match canonical `NNNN-slug.md` form; ordinary prose in those directories keeps repository naming.
The terminal gate validates every owned record before merge. `AGENTS.md` gains one `## Decisions` and one `## Design` section, upserted without duplication.

## Canonical Markdown contract

### Authority

The sole plan contract is canonical UTF-8/LF `plan.md` in `.scratch/<feature>/`, created by `gsd-to-plan` and amended by its executing owner.

`plan.md` is the only authority for intent, acceptance, task order, seams, files, and focused checks. Legacy `proposal.md`, `spec.md`, or `design.md` is rejected, stopping automatic selection with a Spec escalation. Root or scratch `proposal.toon`, `spec.toon`, `design.toon`, and `plan.toon` are stale non-authoritative files: never derive scope, recovery, acceptance, or task order from them.

TOON remains runtime-only: the single atomic `state.toon` snapshot. Runtime records report progress and bind source bytes; they cannot author, amend, or reinterpret Markdown contracts or durable documentation. Numbered `handoff-<n>.toon`, task-attempt files, `result.toon`, reload manifests, and persisted live-agent generation fields are rejected legacy runtime history without authority or compatibility shims.

### Fast TDD and task-loop constraints

Every observable task loads `gsd-tdd` and uses a Fast TDD Check for RED before implementation, GREEN after implementation, and refactor after green.
- Browser, GUI, external network, long-lived server, large fixture, and material-cost checks never run in implementation loops.
- Planned implementation tasks in efficient batches are authored by sub-agents under [§ Wave dispatch](#wave-dispatch); the owner implements, repairs, and reconciles returned work inline and sequentially.
- Task boundaries use focused green evidence kept only in reporting.
- Planning adds the smallest real fast public seam when none exists; observable behavior never uses `none`.

### Wave dispatch

Implementation is the only lifecycle work GSD dispatches, and only as validated task batches to sub-agents; repair, diagnosis, architecture, or verification is never dispatched and stays session-owner inline.
Sub-agents author task code; the owner retains lifecycle authority until dispatched results are inspected, reconciled, committed, and terminally verified.

A **wave** is a maximal contiguous run of non-superseded tasks in strict heading order where pairs are independent: disjoint `Files` path sets, disjoint `Satisfies` criteria, and differing focused `Test` commands.
`analyze-waves` computes independence boundaries deterministically. The owner batches same-shape independent tasks into one wave when shared setup, review, or reconciliation makes the batch cheaper than repeated inline work. A single independent task may be dispatched when it has a complete validated slice, a distinct focused check, and a clearly beneficial context or cost saving. Inline execution with `gsd-tdd` is the default and fallback when dispatch is unavailable or not clearly beneficial.
By default, a single-task wave executes inline by the session owner with `gsd-tdd`; dispatch is reserved for the clearly beneficial case above.

Task batches dispatch concurrently, each task into its own isolated workspace on its own task branch, never two tasks in one shared working tree. When harness task isolation is unavailable or an isolated spawn fails for a batch, dispatch its tasks serially in plan order with the same validated slices.

Each sub-agent receives one complete validated task slice rebuilt from `plan.md`, never invented; MUST run Fast TDD RED→GREEN→refactor; update every affected domain shard in the same commit as semantic code; and commit only green task-owned changes in its isolated workspace on its own task branch cut from wave base.
A sub-agent MUST NOT mutate `state.toon`, amend `plan.md`, merge, decide lifecycle, or run Deferred Slow E2E.

The owner reconciles each dispatched task or batch in strict plan order before checkpointing. A sub-agent's report, summary, or self-assessment is inadmissible; only Git bytes and commands the owner runs itself count as evidence.
1. Mechanical proof: run `bun "<GSD_ROOT>/tools/gsd-git.mjs" verify-task-branch --feature-dir .scratch/<feature> --task <Tn> --branch <task-branch> --wave-base <ref>`; only `status: ready` on exit 0 admits the branch; `status: blocked` with its `code:` (`branch-missing`, `base-not-ancestor`, `empty-diff`, `out-of-slice-path`, `scratch-mutated`, `plan-unbound`) is an integrity failure; exit 2 corrects invocation.
2. Integration proof: after merging every task branch of the wave into `wip/<feature>` in strict plan order, the owner re-runs every merged wave task's focused check on `wip/<feature>` before the `gsd-state.mjs set` checkpoint write; pre-merge branch checks are never sufficient. Only when all pass does the owner checkpoint with `last_green_task` set to the wave's last task; `Tn+1` after the wave begins only from that committed green checkpoint.

The terminal `gsd-verify` review of the whole diff catches weakened tests or guards; there is no per-wave review.

There is no reviewer sub-agent: the session owner reviews the whole diff once, in the `gsd-verify` terminal gate.
When the bootstrap lists sub-agent profiles from user GSD settings, workers spawn with `worker`; otherwise the host default model applies.

Failure routing: any failed layer is an integrity failure that returns to bounded inline owner repair under `gsd-executing-plans` and `gsd-tdd`, and is never re-dispatched to a sub-agent. Terminal conformance proves the unchanged final commit, and plan-ordered diffs hold because the owner merges in plan order.

### Packet grammar

Only `# Plan`, `## Feature`, `## Base`, `## Acceptance Criteria`, and `## Tasks` are required. Every other section below is optional and sections may appear in any order; write an optional section only when it carries information. A present section keeps its exact grammar. The validator rejects missing required, duplicate, unknown, malformed, empty, or vague sections, and any line between the title and its first section. UTF-8/LF only. Never normalize, infer, or repair source values.

```markdown
# Plan
## Feature
`<feature>`
## Base
`<base>`
## Repos
| Repo | Path | Base |
| --- | --- | --- |
| <name> | `.` | `<base>` |
| <name> | `<relative path such as ../api>` | `<branch>` |
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
- **Scenario:** GIVEN <concrete precondition> WHEN <concrete operation> THEN <observable result>
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
## Tasks
### T1: <short task>
- **Satisfies:** AC-1
- **Repo:** <name from Repos; optional>
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
- Every active criterion carries exactly one concrete `GIVEN/WHEN/THEN` Scenario; the validator rejects a missing, malformed, or placeholder scenario.
- Outcome, Action, and Expected must independently name concrete behavior, operation, and observable result.
- `TBD`, `TODO`, `works correctly`, `run tests`, `valid`, `covered`, or `success` are invalid.
- A present `Domain Impact` uses the exact five fields above; an absent one makes no domain claim.
- `none` requires no contexts or documentation; other classifications require sorted affected context slugs and documentation updates (`introduce-context` requires `bootstrap-feature-context`).
- Broad bootstrap is an independent decision and is `not-offered` whenever the domain index exists.
- A present Interfaces table pins each listed active AC at most once; a task spanning pinned ACs needs identical pins.
- A lower seam requires a concrete reason that higher production boundaries are absent or cannot deterministically isolate the criterion.
- Task IDs are positive sequential integers in heading order.
- Every active AC appears in at least one non-superseded task `Satisfies` field.
- `Repos` is only for a plan that touches more than one repository. It lists every repository once, including this one as path `.` with the plan's Base; a task's `Repo` names a row, its `Files` are relative to that repository, and a task without `Repo` belongs to this repository.
- A `superseded` task may keep original references even when criteria are `superseded`; live tasks satisfy only `active` criteria.
- Structured `Files` entries under `test/`, `tests/`, `__tests__/`, or `spec/` directories, or with `*.test.*` / `*.spec.*` filenames, count as observation-only for shard ownership.
- Every task owns at least one exact repository-relative path and one focused command; `none` is valid only for truly non-observable mechanical work.

Canonical task parsing accepts only structured task blocks. Structured `Files` entries require unique safe repository-relative paths, one `create|modify|delete` operation, and concise non-vague intent.

The parser rejects single-line path-only task forms in every validation path whether or not a recorded SHA-256 binding matches. Full validation blocks only at binding (and each rebind after an amendment) and at the terminal gate; drafts in between are not revalidated.

### Executable contract validator

`lib/gsd-contract.mjs` is the single executable Markdown grammar. Repository tests import it directly; lifecycle owners use its agent CLI. Substitute injected `GSD_ROOT` for `<GSD_ROOT>` at call time: bootstrap text is not an exported shell variable, so literal `$GSD_ROOT` resolves empty. Absolute script paths are required because lifecycle workspaces differ from the GSD checkout; packet paths remain workspace-relative.

```text
bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md [--expected-base <base_ref>]
bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md --expected-sha256 <64-hex> --expected-base <base_ref>
bun "<GSD_ROOT>/tools/gsd-contract.mjs" normalize-plan --path .scratch/<feature>/plan.md [--write]
bun "<GSD_ROOT>/tools/gsd-contract.mjs" init-plan --path .scratch/<feature>/plan.md --base <branch>
```
The first validates a new canonical full plan and returns its SHA-256; it also revalidates amendments before rebinding. The second requires bytes to match a bound hash; a moved byte exits 1 without mutation; the owner resolves that through § Plan amendment, not as a lifecycle stop. `init-plan` writes a canonical full-plan skeleton and refuses to overwrite an existing `plan.md` (usage errors exit 2).
Inputs are bounded to a 1 MiB fatal-UTF-8 regular `plan.md` beneath real `.scratch/<feature>/`; symlinks, escaped paths, feature mismatch, and malformed grammar fail closed.

Success emits deterministic scalar TOON:
- Plans return `status`, `kind`, `feature`, `base`, `sha256`, and `tasks`.
- `normalize-plan [--write]` proposes or applies surface-only fixes (backtick wrapping for Feature/Base, line trailing whitespace stripping, single terminal newline) as reviewable diffs.

Actionable failures use TOON on stdout:
- Unreadable files report `code: io-error`; malformed authority reports `code: invalid-artifact` (both exit 1).
- Usage errors exit 2; help exits 0.
- Semantic rejections print `help:` naming concrete fixes (align or split pin conflicts, fields to reorder, canonical shapes); only I/O errors fall back to usage.
- No command writes plan, state, domain, or Git data, except `init-plan` (scaffolds `plan.md` skeleton, refusing overwrite), `normalize-plan --write` (sanctioned surface fixes on `plan.md`) and `gsd-state.mjs set` (writes `state.toon`).

### Plan binding and auto-execution

`gsd-to-plan` validates canonical structured `plan.md`, prints its task/AC/Domain Impact summary, calculates SHA-256, and binds it for execution without approval prompts or post-plan menus.
- Binding records feature, exact plan path/hash, base/WIP identity, no completed task, canonical preferences, and checkpoint revision in atomic `schema:v0.0.2` `state.toon` with `phase=approved` (plan-bound automatically), reading back before loading `gsd-executing-plans`.
- Fresh bindings after Spec escalation atomically supersede older bindings.
- Semantic parse and binding checks run at binding, resume, terminal entry, and pre-merge; ordinary task selection and green checkpoints use retained validated slices.

The validator runs unbound at new-plan binding and when revalidating amendments before rebinding; other full-plan calls use the bound-hash form. Once `state.toon` exists, calls pass `--expected-base <state.base_ref>`, so plans with drifted § Base fail closed instead of retargeting the merge.

Resume runs the bound form first; bound calls check hashes before parsing, so an unbound revalidation separates moved bytes from malformed grammar.

No model, agent, or persistent session identity participates in binding. Current top-level session is sole lifecycle authority; later sessions assume that role through canonical rehydration.

## Runtime state contract

### Resumable State Snapshot

Exactly one current `.scratch/<feature>/state.toon` owns resume discovery. It is a fixed-schema UTF-8/LF scalar record with canonical field order:

```toon
schema:v0.0.2
feature:<feature-slug>
owner:<GSD_SESSION token>|none
phase:approved|executing|paused|verifying|repair|ready
next_action:<opaque next action>
plan_path:.scratch/<feature>/plan.md
plan_sha256:<64-hex>
base_ref:<branch>
wip_branch:wip/<feature>
last_green_task:T<n>|none
last_green_commit:<40-hex>|none
checkpoint_revision:<positive int>
```

Phase-inapplicable values use canonical `none`.
- `schema:v0.0.2` parsing rejects invalid UTF-8, carriage returns, blank lines, unknown keys, duplicates, reordered fields, empty values, legacy settings tables, and obsolete model or agent rows.
- Every schema other than `schema:v0.0.2` is experimental history. Candidate discovery ignores such records without rewriting them; explicit reads and resume reject them fail closed and byte-identical.
- There is no migration path, compatibility parser, or upgrade command for experimental schemas. A user who needs old work continues it by creating a fresh pre-release packet from current sources.
- Malformed or partial `schema:v0.0.2` records fail closed unchanged; partial terminal evidence is discarded and deterministic conformance reruns.

### Atomic write

Every checkpoint write creates a complete temporary file in the feature directory, fsyncs it, atomically renames it over `state.toon`, fsyncs directory where supported, then reads back and validates before reporting completion. Reject symlink or non-directory feature paths; require feature directory basename to equal `state.feature` under real `.scratch` parent; require `plan_path` to equal `.scratch/<feature>/plan.md` when bound. No dispatch occurs from unvalidated or partially written `state.toon`.

State updates are recorded through `gsd-state.mjs set key=value…` with derived defaults; `write-state --json-file` remains the fallback for values `key=value` cannot express.

### Checkpoint cadence

Persist only:

- plan binding (`phase=approved`)
- green task commit (`last_green_task` / `last_green_commit`)
- pause or automatic context pressure (`phase=paused`)
- terminal entry, repair, or current-commit conformance (`phase=verifying|repair`)
- green terminal gate (`phase=ready`)

Do not write active-task, numbered-history, reload-manifest, or persistent identity checkpoints. The session owner rebuilds complete task or terminal slices from canonical plan/state/Git; structured slices preserve ordered file paths, operations, intents, and applicable AC/Decision constraints.

### Plan amendment

A bound-hash mismatch means bytes moved, never a stop; only missing or malformed-grammar `plan.md` fails closed. The executing owner amends it, revalidates unbound with `validate-plan`, and rebinds the returned hash into `state.toon` with an incremented `checkpoint_revision`. No branch closes and no fresh feature opens.
- Bookkeeping amendments are self-service: recording touched files, fixing paths or intents, splitting or reordering pending tasks, or sharpening wording that leaves acceptance intact.
- User-stated requirement changes mid-execution are amendments, never new features: amend, revalidate, rebind, and continue without re-asking.
- Material amendments ask one question first, then proceed with chosen options: changing an active criterion's Outcome/Action/Expected/Scenario, weakening invariants or non-goals, changing `Domain Impact`, replacing interface pins, or rewriting completed task records. Ask before rebinding.
- A mismatch the owner cannot account for asks one question naming affected sections; the answer picks rebind or restore.
- Uncertainty is one question with a recommended default, never a stop or new plan.

### Skill derivation from phase and next_action

Active helpers are derived, never stored as reload manifests:

- `start/continue task`: `gsd-executing-plans` and `gsd-tdd`; sub-agents author dispatched implementation, and repair remains session-owner inline.
- `enter terminal verification/repair`: `gsd-verify`; opaque `next_action` resumes conformance or Deferred Slow E2E without new state keys.
- `ask merge or pull request`: `gsd-verify` asks the merge-or-PR question again.
- `Spec-escalation`: report the blocker and ask the user how to proceed.
- Conditional: `gsd-domain-modeling` completes mandatory affected-context documentation before checkpoint.

Master (`gsd`) is already present from bootstrap and never listed as a derived reload skill. Recovery must never load master recursively or execute the capsule again.

### Recovery tooling exclusions

Lifecycle recovery restores the working tree, never only conversations.
- Harness conversation rewind is excluded from lifecycle recovery: transcript turns rewind while committed WIP and working tree remain where execution left them, so `state.toon` and green commits stay ahead of the restored conversation. Resume from `state.toon` and Git instead.
- Memory backend recall is context, never lifecycle authority: only canonical `plan.md`, `state.toon`, and Git bytes authorize resume decisions.
- A restricted harness mode excluding file edits, commits, and checks cannot own lifecycle work; the owner leaves that mode before task, repair, verification, or merge work begins.

### Candidate discovery

The extension and harness adapters derive active feature candidates from the filesystem:

1. **Directory Inspection**: Check if `.scratch/` is a directory in `cwd`; missing or non-directory yields empty (`[]`).
2. **Feature Directory Filtering**: Eligible `.scratch/` child entries are real directories (not symlinks) matching `^[a-z0-9]+(?:-[a-z0-9]+)*$` with byte length <= 255.
3. **Feature Requirements**: Feature directories must contain regular files `plan.md` and `state.toon`. Symlink `state.toon` fails closed. Validate `state.toon` structurally. With a session owner, only packets whose `owner` matches are candidates. Legacy handoff-only or attempt-only packets are ignored (no authority).
4. **No Content Execution**: Discovery never executes artifact contents.
5. **Candidate Array**: Returns eligible active feature names sorted alphabetically (byte order).

#### Compaction Recovery Capsule

The Compaction Recovery Capsule is owned by GSD and is the canonical recovery interface. Its exact model-independent template is:

```text
[GSD Recovery Capsule]
GSD features owned by this session: <features>
<resume_instruction>
Compaction MUST preserve and continue the current user request. Only resume an active feature when the preserved request or a bare continue explicitly selects it.
```

#### Current Request Preservation

During compaction, the host adapter's compaction hook extracts the last genuine user request from the event's message list (filtering bootstrap messages, recovery capsules, and compaction summaries; bounded to 500 bytes) and returns it alongside the capsule:

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
    `If resuming, follow the bootstrap routing in <masterPath>: bare "continue" selects gsd-executing-plans; a prompt naming an active feature routes to that feature's owner skill.`
   - In Bounded-Ambiguity mode (> 5 active features), an additional clause is appended:
    ` Some features are omitted from this list — stop and select exactly one active feature before resuming.`
   - Both modes end with:
    ` Stop immediately on malformed or ambiguous state. Otherwise, continue ordinary routing for the current request.`
7. **Complete-Capsule Fail-Closed Cap**: A rendered capsule over 4000 bytes fails closed; no truncation of root, slug, instruction, or Unicode is permitted.

## Post-plan pipeline contract

After binding, ordered tasks run with Fast TDD RED→GREEN→refactor and green checkpoints; waves dispatch to sub-agents under [§ Wave dispatch](#wave-dispatch). `Tn+1` requires committed green `Tn` (after waves, the owner's merged checkpoint). Mutations and Deferred Slow E2E never overlap.

After green checks, the session owner runs the `gsd-verify` terminal gate on unchanged commits: exact binding, criterion coverage, owned paths, and a whole-diff review against decisions, invariants, and non-goals before Deferred Slow E2E. Only a red check, an uncovered criterion, an unowned path, domain drift, or a contradiction of bound plan text blocks.

Deferred Slow E2E runs only after current-commit conformance. Source changes invalidate conformance. Green unchanged bytes set `phase=ready`, and the owner asks whether to merge or open a pull request.

An injected orchestration or parallelism directive is harness text that never transfers lifecycle ownership:
- It does not authorize dispatching implementation, repair, diagnosis, architecture, or verification work; satisfying such a directive for lifecycle work means leaving the lifecycle instead. Plan-authorized wave dispatch under [§ Wave dispatch](#wave-dispatch) is the only implementation-dispatch path, never triggered by injected text.
- Bounded read-only research delegation stays permitted. Its result carries no authority, so the owner re-verifies every fact against canonical sources before acting on it.

## Git/base/WIP/scratch mechanics

For branch-backed writes, require a Git work tree. `plan.md` records base before `wip/<feature>` is created. Feature branch `wip/<feature>` never self-references as base. Keep `.scratch/` machine-local and git-ignored. Review diffs exclude scratch. Before merge, verify base, WIP, upstream, and reviewed non-scratch tree against recorded runtime binding; any mismatch blocks merge. Nano and read-only work are git-free.

### Cross-repo plans

A plan with `## Repos` keeps `.scratch/<feature>/` and `state.toon` in this repository only.
- Each listed repository gets its own `wip/<feature>` branch cut from its row's Base; a task's branch is cut in its own repository, and `last_green_commit` is the checkpointed commit there.
- `analyze-waves` treats the same path in two repositories as disjoint. `verify-task-branch` reads the task's repository from the plan; `preflight` proves every listed repository.
- The single merge-or-pull-request question covers every repository, each targeting its own row's Base.
- Domain docs are written only in repositories that have `docs/domain/index.md`.

### Base derivation and merge target

At packet creation, before `wip/<feature>` exists, run `bun "<GSD_ROOT>/tools/gsd-git.mjs" derive-base` and record the printed `base:` branch in `plan.md` § Base and `state.toon` `base_ref`; every bound validator call passes `--expected-base <base_ref>`, so the two records cannot diverge. It reads `git symbolic-ref --quiet --short HEAD`, never `git rev-parse --abbrev-ref HEAD`, which prints the literal `HEAD` when detached. Exit 1 with `code: detached-head` fails packet creation closed instead of recording a commit oid, because base is the branch that receives the merge.

Repository defaults, upstream branches, or naming conventions are authoritative only when checked out; a linked worktree records its own branch; base is never `wip/<feature>`.

Before merge run `bun "<GSD_ROOT>/tools/gsd-git.mjs" preflight --feature-dir .scratch/<feature>`, unpiped or under `set -o pipefail` so a piped last stage cannot mask the verdict. Exit 0 prints `status: ready` with observed base, WIP branch, HEAD equal to the recorded `wip_branch`, clean tree outside `.scratch/`, and one `repo:` line per other listed repository, ending in a trailing `exit=0` line that echoes the process exit code.
Exit 1 prints `status: blocked` and a `code:` naming drift with a trailing `exit=1` line, which blocks as Spec escalation, because a blocked gate never retargets the merge. Exit 2 corrects only invocation.

Blocking codes are `detached-head`, `head-not-wip`, `base-missing`, `wip-missing`, `base-checked-out-elsewhere`, `base-is-wip`, `dirty-worktree`, `no-git-identity`, `unusable-branch-name`, `not-a-work-tree`, `state-unusable`, `git-query-failed`, `git-unavailable`, and `plan-unbound`: an unanswered Git query blocks rather than reporting ready, proving nothing. The gate proves the bound plan hash before merging.

`dirty-worktree` counts staged, modified, and untracked paths outside `.scratch/`, because unreviewed bytes would otherwise ride into the merge. A rename or copy counts both paths, so moving a reviewed file into `.scratch/` still blocks. Both commands only read: they run no Git subcommand that can change a repository, `status` runs lock-free so reading cannot refresh indexes, and `preflight` inspects `state.toon` without writing it.

The merge or pull request targets exactly the recorded `base_ref`, so `main` is the target only when `main` is that base; never widen to repository defaults. Promoting base onward is separate user-owned work.

## Feature cleanup

After a merge lands, check out `base_ref`, delete `wip/<feature>` and the retired task branches with `git branch -d` (never `-D`), remove clean isolated workspaces, and remove `.scratch/<feature>/`. A pull request keeps the branch and scratch until the user says it merged. Unmerged branches or dirty workspaces stay unforced and surface for inspection.

For explicit abandon/drop/delete: confirm the feature name, inspect whether the worktree is dirty, check out `base_ref`, safely delete the WIP branch, and remove `.scratch/<feature>/`. Never force-delete unmerged work without explicit confirmation.

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
