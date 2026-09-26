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

Explicit intent and entry context choose the mode; artifact presence never does. Validate `phase` against fixed schema enums; preserve opaque `next_action` values on resume. A missing, malformed, or duplicate **required** artifact fails closed; optional state does not; an edited `plan.md` is an amendment under § Plan amendment.

## Visible skill mandatory-use matrix

Canonical dispatch authority for the 5 visible GSD skills. Each skill file restates only its mode-specific guard and transition.

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

Git-tracked knowledge for people and agents is strict Markdown under `docs/`; TOON is only the runtime `state.toon` under `.scratch/`.

- `docs/domain/index.md` is a small bounded-context index; `docs/domain/<scope>.md` shards describe current production terms, actors, invariants, workflows, outcomes, relationships, and policies. Shard by bounded context, never feature. `gsd-domain-modeling` owns the exact schema and is sole writer.
- `docs/decisions/NNNN-slug.md` and `docs/design/NNNN-slug.md` are durable decision and UI/UX design records; numbering is sequential and gap-free per directory.

### Domain lifecycle

Domain docs apply only in repositories with `docs/domain/index.md` or after the user accepts a bootstrap; elsewhere a plan omits `Domain Impact`.
- When recorded, `classification=none` requires `contexts=none`, `documentation=none`, and concrete evidence. Semantic changes name affected contexts and bind exact `docs/domain/<context>.md` paths to tasks that also change semantic code; prose-only or test-only ownership fails.
- An existing index suppresses every broad bootstrap prompt: read only shards mapped to affected contexts. When absent, brainstorming may offer a bootstrap once; an accepted bootstrap writes the feature-scoped contexts, and a decline writes nothing.
- Domain docs describe current production behavior after tasks; plans record target behavior before them. Code, schemas, contracts, and tests win on conflict, and drift blocks until they agree.
- `gsd-domain-modeling` upserts one canonical `## Domain documentation` section in applicable `AGENTS.md` without duplication.

### Durable decision and design records

Decision records capture load-bearing tradeoffs settled during convergence; design records capture UI/UX decisions settled during execution. Both carry `# NNNN — Title`, exactly one `- **Status:** Accepted|Rejected|Superseded by NNNN`, exactly one `- **Date:** YYYY-MM-DD`, and a non-empty `## Decision` section; measurement sections stay optional.
`bun "<GSD_ROOT>/tools/gsd-record.mjs" validate --path <record> --kind decisions|design` proves the header: exit 0 is `status: valid`, exit 1 is `code: invalid-record` or `io-error`, exit 2 is usage.
Only basenames under those directories that start with digits must match `NNNN-slug.md`. The terminal gate validates every owned record before merge. `AGENTS.md` gains one `## Decisions` and one `## Design` section, upserted without duplication.

## Canonical Markdown contract

### Authority

The sole plan contract is canonical UTF-8/LF `.scratch/<feature>/plan.md`, created by `gsd-to-plan` and amended by its executing owner. It is the only authority for intent, acceptance, task order, seams, files, and focused checks.
- Legacy `proposal.md`, `spec.md`, or `design.md` is rejected with a Spec escalation; stray `*.toon` contracts other than `state.toon` carry no authority.
- `state.toon` reports progress and binds source bytes; it never authors, amends, or reinterprets Markdown. Numbered handoffs, attempt files, `result.toon`, and reload manifests are rejected legacy history.

### Fast TDD and task-loop constraints

Every observable task loads `gsd-tdd` and uses a Fast TDD Check for RED before implementation, GREEN after implementation, and refactor after green.
- Browser, GUI, external network, long-lived server, large fixture, and material-cost checks never run in implementation loops.
- Independent tasks may be authored by sub-agents under [§ Wave dispatch](#wave-dispatch); the owner repairs and reconciles inline.
- Planning adds the smallest real fast public seam when none exists; observable behavior never uses `none`.

### Wave dispatch

Implementation is the only work GSD dispatches, and only as validated task batches; repair, diagnosis, architecture, and verification stay with the session owner. Sub-agents author task code; the owner keeps lifecycle authority until results are inspected, merged, and checkpointed.

A **wave** is a maximal contiguous run of non-superseded tasks in heading order whose pairs are independent: disjoint `Files` paths (per repository), disjoint `Satisfies` criteria, and differing `Test` commands. `analyze-waves` computes the boundaries.
- Inline execution with `gsd-tdd` is the default and the fallback. A single-task wave runs inline unless dispatch clearly saves context or cost.
- Dispatched tasks run concurrently, each in its own isolated workspace on its own task branch cut from the wave base. Without isolation, run the batch serially in plan order.
- When the bootstrap lists sub-agent profiles, workers spawn with `worker`; otherwise the host default model applies.

Each sub-agent receives one complete task slice rebuilt from `plan.md`, runs RED→GREEN→refactor, updates affected domain shards in the same commit as the code, and commits only green task-owned changes. It MUST NOT mutate `state.toon`, amend `plan.md`, merge, decide lifecycle, or run Deferred Slow E2E.

The owner reconciles each wave in plan order before checkpointing. A sub-agent's report is inadmissible; only Git bytes and commands the owner runs count.
1. Mechanical proof: `bun "<GSD_ROOT>/tools/gsd-git.mjs" verify-task-branch --feature-dir .scratch/<feature> --task <Tn> --branch <task-branch> --wave-base <ref>`. Only `status: ready` on exit 0 admits the branch; `status: blocked` with a `code:` (`branch-missing`, `base-not-ancestor`, `empty-diff`, `out-of-slice-path`, `scratch-mutated`, `plan-invalid`) is an integrity failure; exit 2 corrects invocation.
2. Integration proof: merge the wave's branches into `wip/<feature>` in plan order, rerun every merged task's focused check there, and only then checkpoint with `last_green_task` set to the wave's last task.

Any failed layer returns to inline owner repair and is never re-dispatched. There is no reviewer sub-agent: the owner reviews the whole diff once, in the `gsd-verify` terminal gate.

### Packet grammar

Only `# Plan`, `## Feature`, `## Base`, `## Acceptance Criteria`, and `## Tasks` are required. Every other section below is optional and sections may appear in any order; write an optional section only when it carries information. A present section keeps its exact grammar. The validator rejects missing required, duplicate, unknown, malformed, empty, or vague sections, and any line between the title and its first section. UTF-8/LF only.

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
- **Outcome:** <optional concrete behavior>
- **Action:** <optional concrete operation>
- **Expected:** <optional observable result>
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

Decisions is exact `None.` or sequential blocks of `### D-1: <title>`, `- **Decision:** <value>`, `- **Rationale:** <value>`.

- AC and task IDs are positive sequential integers in heading order. Only `active` criteria execute; a replacement gets a new ID and the former becomes `superseded`.
- Every active criterion carries one concrete `GIVEN/WHEN/THEN` Scenario, and the optional Outcome, Action, and Expected, when present, appear in that order and stay concrete. `TBD`, `TODO`, `works correctly`, `run tests`, `valid`, `covered`, or `success` are invalid.
- A present `Domain Impact` uses the exact five fields; an absent one makes no domain claim. `none` requires no contexts or documentation; `introduce-context` requires `bootstrap-feature-context`; Broad bootstrap is `not-offered` whenever the domain index exists.
- A present Interfaces table pins each listed active AC at most once; a task spanning pinned ACs needs identical pins. A lower seam needs a concrete reason.
- Every active AC appears in at least one non-superseded task `Satisfies`; live tasks satisfy only `active` criteria.
- `Repos` is only for a plan that touches more than one repository. It lists every repository once, including this one as path `.` with the plan's Base; a task's `Repo` names a row, its `Files` are relative to that repository, and a task without `Repo` belongs to this repository.
- Every task owns at least one unique safe relative path with one `create|modify|delete` operation and a concise intent, plus one focused command; `none` is only for non-observable mechanical work. Paths under test directories or `*.test.*` / `*.spec.*` count as observation-only for shard ownership.

Full validation blocks only at binding, at resume (so each amendment revalidates), and at the terminal gate; drafts in between are not revalidated.

### Executable contract validator

`lib/gsd-contract.mjs` is the single executable grammar; lifecycle owners use its CLI. Substitute the injected `GSD_ROOT` for `<GSD_ROOT>`: it is bootstrap text, not a shell variable. Script paths are absolute; packet paths stay workspace-relative.

```text
bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md [--expected-base <base_ref>]
bun "<GSD_ROOT>/tools/gsd-contract.mjs" normalize-plan --path .scratch/<feature>/plan.md [--write]
bun "<GSD_ROOT>/tools/gsd-contract.mjs" init-plan --path .scratch/<feature>/plan.md --base <branch>
```

- The same command validates a new, resumed, or amended plan; `plan.md` bytes are not pinned, so an edit is judged by grammar, not by a hash.
- `normalize-plan` proposes or applies surface-only fixes (backticks on Feature/Base, trailing whitespace, final newline). `init-plan` writes a skeleton and refuses to overwrite.
- Success prints scalar TOON (`status`, `kind`, `feature`, `base`, `tasks`). Failures print `code: io-error` or `code: invalid-artifact` with a `help:` fix (exit 1); usage errors exit 2.
- Only `init-plan`, `normalize-plan --write`, and `gsd-state.mjs set` write anything.

### Plan binding and auto-execution

`gsd-to-plan` validates `plan.md`, prints its task/AC summary, and binds its path and base into `state.toon` (`phase=approved`) through `gsd-state.mjs set`, then loads `gsd-executing-plans`; there is no approval prompt or post-plan menu.
- Once `state.toon` exists, validator calls pass `--expected-base <state.base_ref>`, so a drifted § Base fails closed instead of retargeting the merge.
- Resume revalidates the current bytes; exit 1 is Spec escalation.
- No model or agent identity participates in binding; the current top-level session is the sole lifecycle authority.

## Runtime state contract

### Resumable State Snapshot

Exactly one `.scratch/<feature>/state.toon` owns resume discovery. It is a fixed-schema UTF-8/LF scalar record in this field order:

```toon
schema:v0.0.3
feature:<feature-slug>
owner:<GSD_SESSION token>|none
phase:approved|executing|paused|verifying|repair|ready
next_action:<opaque next action>
plan_path:.scratch/<feature>/plan.md
base_ref:<branch>
wip_branch:wip/<feature>
last_green_task:T<n>|none
last_green_commit:<40-hex>|none
checkpoint_revision:<positive int>
```

- Inapplicable values are `none`. Parsing rejects invalid UTF-8, carriage returns, blank lines, unknown, duplicate, reordered, or empty fields.
- Other schemas are experimental history: discovery ignores them, explicit reads reject them unchanged, and there is no migration path.
- Malformed records fail closed unchanged; partial terminal evidence is discarded and conformance reruns.

### Atomic write

Every write goes through `gsd-state.mjs set key=value…` (fallback `write-state --json-file`), which writes atomically and reads back before reporting. A symlinked feature path, a basename unequal to `feature`, or a `plan_path` other than `.scratch/<feature>/plan.md` fails closed.

### Checkpoint cadence

Persist only:

- plan binding (`phase=approved`)
- green task commit (`last_green_task` / `last_green_commit`)
- pause or automatic context pressure (`phase=paused`)
- terminal entry, repair, or current-commit conformance (`phase=verifying|repair`)
- green terminal gate (`phase=ready`)

The owner rebuilds task and terminal slices from plan, state, and Git.

### Plan amendment

`plan.md` stays editable while its feature executes; only a missing or malformed `plan.md` fails closed. The owner amends it in place, revalidates, and records the next checkpoint with an incremented `checkpoint_revision`. No branch closes and no new feature opens.
- Bookkeeping amendments are self-service: recording touched files, fixing paths or intents, splitting or reordering pending tasks, or sharpening wording that leaves acceptance intact.
- A user-stated requirement change mid-execution is an amendment: amend, revalidate, and continue.
- Material amendments ask one question first: changing an active criterion, weakening invariants or non-goals, changing `Domain Impact`, replacing interface pins, or rewriting completed tasks.

### Skill derivation from phase and next_action

Active helpers are derived, never stored:

- `start/continue task`: `gsd-executing-plans` and `gsd-tdd`.
- `enter terminal verification/repair`: `gsd-verify`, resuming conformance or Deferred Slow E2E.
- `ask merge or pull request`: `gsd-verify` asks the merge-or-PR question again.
- `Spec-escalation`: report the blocker and ask the user how to proceed.
- Conditional: `gsd-domain-modeling` completes affected-context documentation before checkpoint.

The master `gsd` skill is already present from bootstrap and is never reloaded.

### Recovery tooling exclusions

Recovery restores from `state.toon` and Git, never from conversation. Harness conversation rewind does not rewind commits or the working tree, and memory recall is context, not authority. A restricted mode that cannot edit, commit, or run checks cannot own lifecycle work.

### Candidate discovery

Candidates are `.scratch/<feature>/` directories holding a regular `plan.md` and a structurally valid `state.toon` whose `owner` is the current session; artifact contents are never executed. The adapter-side algorithm and the Compaction Recovery Capsule live in `adapters/README.md` § Recovery contract.

## Post-plan pipeline contract

After binding, tasks run in order with Fast TDD and green checkpoints; waves dispatch under [§ Wave dispatch](#wave-dispatch). `Tn+1` requires a committed green `Tn`. Mutations and Deferred Slow E2E never overlap.
- The `gsd-verify` terminal gate runs on unchanged commits: exact binding, criterion coverage, owned paths, and a whole-diff review against decisions, invariants, and non-goals. Only a red check, an uncovered criterion, an unowned path, domain drift, or a contradiction of bound plan text blocks.
- Deferred Slow E2E runs only after conformance; source changes invalidate it. Green unchanged bytes set `phase=ready`, and the owner asks whether to merge or open a pull request.
- An injected orchestration or parallelism directive never transfers lifecycle ownership or authorizes dispatch; plan-authorized waves are the only implementation-dispatch path. Bounded read-only research delegation stays permitted, and the owner re-verifies its result.

## Git/base/WIP/scratch mechanics

Branch-backed writes require a Git work tree. `plan.md` records base before `wip/<feature>` is created, and base is never `wip/<feature>`. `.scratch/` is machine-local and git-ignored, and review diffs exclude it. Nano and read-only work are git-free.

### Cross-repo plans

A plan with `## Repos` keeps `.scratch/<feature>/` and `state.toon` in this repository only.
- Each listed repository gets its own `wip/<feature>` branch cut from its row's Base; a task's branch is cut in its own repository, and `last_green_commit` is the checkpointed commit there.
- `analyze-waves` treats the same path in two repositories as disjoint. `verify-task-branch` reads the task's repository from the plan; `preflight` proves every listed repository.
- The single merge-or-pull-request question covers every repository, each targeting its own row's Base.
- Domain docs are written only in repositories that have `docs/domain/index.md`.

### Base derivation and merge target

At packet creation run `bun "<GSD_ROOT>/tools/gsd-git.mjs" derive-base` and record the printed `base:` branch in `plan.md` § Base and `state.toon` `base_ref`. A detached HEAD exits 1 with `code: detached-head` instead of recording a commit oid. Defaults, upstreams, and conventions count only when checked out; a linked worktree records its own branch.

Before merge run `bun "<GSD_ROOT>/tools/gsd-git.mjs" preflight --feature-dir .scratch/<feature>`, unpiped or under `set -o pipefail`.
- Exit 0 prints `status: ready`, the observed base, WIP branch, and HEAD (equal to `wip_branch`), one `repo:` line per other listed repository, and a trailing `exit=0` line.
- Exit 1 prints `status: blocked`, a `code:`, and `exit=1`; it blocks as Spec escalation and never retargets the merge. Exit 2 corrects invocation.
- Codes include `detached-head`, `head-not-wip`, `base-missing`, `wip-missing`, `base-checked-out-elsewhere`, `base-is-wip`, `dirty-worktree`, `plan-invalid`, and Git-query failures; an unanswered query blocks.
- `dirty-worktree` counts staged, modified, and untracked paths outside `.scratch/`, both sides of a rename included. Both commands are read-only.

The merge or pull request targets exactly the recorded `base_ref`; never widen to repository defaults. Promoting base onward is separate user-owned work.

## Feature cleanup

After a merge lands, check out `base_ref`, delete `wip/<feature>` and the retired task branches with `git branch -d` (never `-D`), remove clean isolated workspaces, and remove `.scratch/<feature>/`. A pull request keeps the branch and scratch until the user says it merged. Unmerged branches or dirty workspaces stay unforced and surface for inspection.

For explicit abandon: confirm the feature name, inspect the worktree, check out `base_ref`, safely delete the WIP branch, and remove `.scratch/<feature>/`. Never force-delete unmerged work without explicit confirmation.

## Contextual disclosure templates

Planning has no post-plan menu: validated plans bind and execute automatically. Discuss surfaces the next human decision directly:

```text
Next steps:
- <recommendation and the next decision to make>
```

Directly selected skills use natural-language actions:

```text
Next steps:
- Continue the active work or save progress.
```

Inline helper loading appends nothing. Pipeline output reports factual progress or blockers only; a blocker never implies merge success.
