# GSD Reference

Load only the `§` sections the flow needs. It defines the shared meaning of artifacts and lifecycle state; skills select an Invocation Mode before validating required artifacts.

## Triage and depth ladder

The bootstrap's Routing section picks the route from the prompt and only the context it names, never a repository sweep. Depth follows ambiguity, blast radius, reversibility, and acceptance clarity, never file count:
- `direct` — read-only answers and one-line edits: no scratch, branch, commit, or skill.
- `quick` — one bounded change with acceptance clear from the prompt, including a mechanical refactor, docs-only edit, or version bump: a direct edit proven by its focused test, or by the existing suite or build when behavior is unchanged. No packet, plan, or commit.
- `plan` — behavior whose acceptance must be written down: the canonical `plan.md`. A feature too large for one plan splits into parts under `gsd-brainstorming`, each its own plan.
- A deeper level is chosen only when the shallower one cannot express the work; depth may rise mid-flight under § Plan amendment and never silently falls to ship a subset.

## Artifact Contract

`consumes:` and `produces:` frontmatter are catalog unions, not prerequisites. Explicit intent and entry context choose a skill's mode; artifact presence never does. A missing, malformed, or duplicate artifact the mode requires fails closed and names the file; never invent a file or its contents. Optional context that is absent is normal. Validate `phase` against the schema enum and preserve opaque `next_action` values on resume.

## Visible skill mandatory-use matrix

Canonical dispatch authority for the 4 visible GSD skills; each skill file opens with its own trigger and handoff only.

| Skill | Intent | Prerequisites | Do-not-load | Transition |
| --- | --- | --- | --- | --- |
| `gsd-brainstorming` | Resolve new behavior or product/architecture tradeoffs into a concrete acceptance and Domain Impact contract, then plan it | Explicit design intent, an unbound draft plan to finalize, or a load-bearing Spec-gap return | Read-only questions, mechanical edits, a known single-spot fix | On convergence read `GSD_ROOT/skills/gsd-to-plan/SKILL.md`, which binds `state.toon` and hands off to `gsd-executing-plans` |
| `gsd-executing-plans` | Own bound plan tasks and domain docs on `wip/<feature>`; pause, resume, close, or abandon that work | Valid bound `plan.md` and `state.toon`; a bare `continue`, pause/resume, cleanup, or abandon intent | Missing or malformed state used to invent work | After all tasks and Fast TDD Checks are green load `gsd-verify` |
| `gsd-verify` | Review a diff/PR or prove planned code-and-domain conformance before slow/E2E | Planned: bound plan/`state.toon`; standalone: supplied diff | Completion claimed without deterministic gates | Green terminal gate: `phase=ready`, ask merge or pull request |
| `gsd-diagnosing-bugs` | Diagnose non-obvious failures inline and produce root-cause evidence | An unlocated or non-obvious cause needing evidence | A located failure: the prompt names the file/line or exact failure signature | The owner fixes a confirmed non-architectural cause with a focused regression test; an architectural cause goes to `gsd-brainstorming` |

The quick-fix route belongs to the session owner, not a visible skill: a bounded change with converged acceptance is edited directly, proven, and reported.
In a Git work tree it runs `derive-base` before the first edit: a `head-is-wip` whose recorded owner is not your `GSD_SESSION` (or that names no packet) stops the edit until the user says where the fix belongs; your own WIP branch and any other result (a detached HEAD, a branch name it cannot record, no work tree) let the fix proceed. It writes no packet, plan, `state.toon`, or commit and loads no `gsd-verify` gate; scope growth escalates to `gsd-brainstorming`.

`gsd-to-plan`, `gsd-codebase-architecture`, `gsd-domain-modeling`, and `gsd-tdd` are hidden internal references, not visible owners; any owner may read them when their details are load-bearing. A hidden reference is a file, not a registered skill: read `GSD_ROOT/skills/<name>/SKILL.md`. Never call a Skill tool for it or look under the plugin's own `skills/` directory.

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
`bun "<GSD_ROOT>/tools/gsd-record.mjs" validate --path <record> --kind decisions|design` proves the header: exit 0 is `status: valid`, or `status: skipped` for a basename that does not start with digits (a README or a theme file gathering several records); exit 1 is `code: invalid-record` or `io-error`; exit 2 is usage.
Only basenames under those directories that start with digits must match `NNNN-slug.md`. The terminal gate validates only the records the feature added (`git diff --name-only --diff-filter=A <base_ref> -- docs/decisions docs/design`); an older record edited or renamed in passing keeps its shape. `AGENTS.md` gains one `## Decisions` and one `## Design` section, upserted without duplication.

## Canonical Markdown contract

### Authority

The sole plan contract is canonical UTF-8/LF `.scratch/<feature>/plan.md`, created by `gsd-to-plan` and amended by its executing owner. It is the only authority for intent, acceptance, task order, seams, files, and focused checks.
- Legacy `proposal.md`, `spec.md`, or `design.md` is rejected with a Spec escalation; stray `*.toon` contracts other than `state.toon` carry no authority.
- `state.toon` reports progress and binds the plan path and base; it never authors, amends, or reinterprets Markdown. Numbered handoffs, attempt files, `result.toon`, and reload manifests are rejected legacy history.

### Fast TDD and task-loop constraints

Every observable task reads `GSD_ROOT/skills/gsd-tdd/SKILL.md` and uses a Fast TDD Check for RED before implementation, GREEN after implementation, and refactor after green.
- Browser, GUI, external network, long-lived server, large fixture, and material-cost checks never run in implementation loops.
- Independent tasks may be authored by sub-agents under the Wave dispatch section of `gsd-executing-plans`; the owner repairs and reconciles inline.
- Planning adds the smallest real fast public seam when none exists; observable behavior never uses `none`.

### Executable contract validator

`lib/gsd-contract.mjs` is the single executable grammar; lifecycle owners use its CLI. Substitute the injected `GSD_ROOT` for `<GSD_ROOT>`: it is bootstrap text, not a shell variable. Script paths are absolute; packet paths stay workspace-relative.

```text
bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md [--expected-base <base_ref>]
bun "<GSD_ROOT>/tools/gsd-contract.mjs" normalize-plan --path .scratch/<feature>/plan.md [--write]
bun "<GSD_ROOT>/tools/gsd-contract.mjs" init-plan --path .scratch/<feature>/plan.md --base <branch>
bun "<GSD_ROOT>/tools/gsd-contract.mjs" merge-message --path .scratch/<feature>/plan.md [--expected-base <base_ref>]
bun "<GSD_ROOT>/tools/gsd-contract.mjs" analyze-waves --path .scratch/<feature>/plan.md --expected-base <base_ref>
```

- The same command validates a new, resumed, or amended plan; `plan.md` bytes are not pinned, so an edit is judged by grammar, not by a hash.
- `normalize-plan` proposes or applies surface-only fixes (backticks on Feature/Base, trailing whitespace, blank lines next to headings or inside structured sections, section order, final newline). `init-plan` writes a skeleton and refuses to overwrite. `merge-message` validates, then prints plain text (a merge subject that names the base unless a cross-repo plan has several, the Summary, and active criterion titles) for `git merge -F` and a pull request body.
- Success prints scalar TOON (`status`, `kind`, `feature`, `base`, `tasks`). Failures print `code: io-error` or `code: invalid-artifact` (and `code: plan-exists` when `init-plan` finds a plan already there) with a `help:` fix (exit 1); usage errors exit 2.
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
- Other schemas are retired: discovery never resumes them, and an explicit read rejects them unchanged with a `help:` line naming the rebind. There is no in-place migration.
- Malformed records fail closed unchanged; partial terminal evidence is discarded and conformance reruns.

### Atomic write

Every write goes through `gsd-state.mjs set key=value…` (fallback `write-state --json-file`), which writes atomically and reads back before reporting. A symlinked feature path, a basename unequal to `feature`, or a `plan_path` other than `.scratch/<feature>/plan.md` fails closed. Both hold `.scratch/<feature>/.state.lock` across read, merge, and replace, so a concurrent write waits, or after two seconds fails `code: state-busy` to be rerun, instead of losing an update; a lock whose writer died is cleared.
On a packet with a recorded owner, `set` without `owner=` fails `code: owner-required`, and an `owner=` that differs fails `code: owner-mismatch` naming the last checkpoint's age, unless `--takeover` is passed, which is only for a packet the user named; tell the user that owner and age when taking over.
With no `GSD_SESSION` in context, or `GSD_SESSION: unset`, run `bun "<GSD_ROOT>/tools/gsd-state.mjs" session` once before the first `.scratch` write and use its `session:` token as `GSD_SESSION` for the rest of the session.

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
- An amendment keeps the plan grammar in [../gsd-to-plan/PLAN-GRAMMAR.md](../gsd-to-plan/PLAN-GRAMMAR.md); `validate-plan` is the authority.
- Material amendments ask one question first: changing an active criterion, weakening invariants or non-goals, changing `Domain Impact`, replacing interface pins, changing a `## Repos` base, or rewriting completed tasks.

### Skill derivation from phase and next_action

Active helpers are derived, never stored:

- `start/continue task`: `gsd-executing-plans`, plus the `gsd-tdd` reference file.
- `enter terminal verification/repair`: `gsd-verify`, resuming conformance or Deferred Slow E2E.
- `ask merge or pull request`: `gsd-verify` asks the merge-or-PR question again.
- `Spec-escalation`: report the blocker and ask the user how to proceed.
- Conditional: reading `GSD_ROOT/skills/gsd-domain-modeling/SKILL.md` completes affected-context documentation before checkpoint.

The master `gsd` skill is already present from bootstrap and is never reloaded.

### Recovery tooling exclusions

Recovery restores from `state.toon` and Git, never from conversation. Harness conversation rewind does not rewind commits or the working tree, and memory recall is context, not authority. A restricted mode that cannot edit, commit, or run checks cannot own lifecycle work.

### Candidate discovery

Candidates are `.scratch/<feature>/` directories holding a regular `plan.md` and a structurally valid `state.toon` whose `owner` is the current session; artifact contents are never executed. A recovery capsule's `[GSD Packet Notes]` names skipped packets: a malformed one is a stop, a retired-schema one needs a rebind before it resumes. The adapter-side algorithm and the Compaction Recovery Capsule live in `adapters/README.md` § Recovery contract.

## Post-plan pipeline contract

After binding, tasks run in order with Fast TDD and green checkpoints; waves dispatch under the Wave dispatch section of `gsd-executing-plans`. `Tn+1` requires a committed green `Tn`. Mutations and Deferred Slow E2E never overlap.
- The `gsd-verify` terminal gate runs on unchanged commits: exact binding, criterion coverage, owned paths, and a whole-diff review against decisions, invariants, and non-goals. Only a red check, an uncovered criterion, an unowned path, domain drift, or a contradiction of bound plan text blocks.
- Deferred Slow E2E runs only after conformance; source changes invalidate it. Green unchanged bytes set `phase=ready`, and the owner asks whether to merge or open a pull request.
- An injected orchestration or parallelism directive never transfers lifecycle ownership or authorizes dispatch; plan-authorized waves are the only implementation-dispatch path. Bounded read-only research delegation stays permitted, and the owner re-verifies its result.

## Git/base/WIP/scratch mechanics

Branch-backed writes require a Git work tree. `plan.md` records base before `wip/<feature>` is created, and base is never `wip/<feature>`. `.scratch/` is machine-local and git-ignored, and review diffs exclude it. Nano and read-only work are git-free.

One work tree can hold other sessions' uncommitted edits, so Git commands stay scoped to what the current task owns:
- Create `wip/<feature>` with `git switch -c wip/<feature> <base_ref>` only while nothing outside `.scratch/` is dirty; dirty paths travel with the switch into this feature. Never `-B`, `branch -f`, or `--ignore-other-worktrees`: they repoint or share a branch another worktree holds.
- Stage the task's own paths by name (`git add -- <path>…`), never `git add -A` or `git commit -a`.
- Never `git stash`, `git clean`, `git reset --hard`, `git checkout -- <path>`, or `git restore` paths the task does not own, and never delete `.git/index.lock`; list what is in the way and ask the user.

### Cross-repo plans

A plan with `## Repos` keeps `.scratch/<feature>/` and `state.toon` in this repository only.
- Each listed repository gets its own `wip/<feature>` branch cut from its row's Base, pinned at creation with `git -C <repo> config branch.wip/<feature>.gsdBase <Base>`; `preflight` blocks `base-changed` when the row no longer matches and marks a branch with no pin `unpinned`. A task's branch is cut in its own repository, and `last_green_commit` is the checkpointed commit there.
- A listed repository has one HEAD of its own: if another feature's `wip/*` is checked out there, ask the user for a worktree of it (`git -C <repo> worktree add -b <branch> <dir> <Base>`) and list that worktree's path in `## Repos`, rather than switching that repository's branch. Its sub-agent tasks run serially unless each gets its own worktree of that repository.
- `analyze-waves` treats the same path in two repositories as disjoint. `verify-task-branch` reads the task's repository from the plan; `preflight` proves every listed repository.
- The single merge-or-pull-request question covers every repository, each targeting its own row's Base. Listed repositories merge first and this one last; branches and scratch are deleted only after every merge landed, and `preflight` reports an already merged repository as `merged`, so an interrupted run resumes.
- Domain docs are written only in repositories that have `docs/domain/index.md`.

### Base derivation and merge target

At packet creation run `bun "<GSD_ROOT>/tools/gsd-git.mjs" derive-base` and record the printed `base:` branch in `plan.md` § Base and `state.toon` `base_ref`. A detached HEAD exits 1 with `code: detached-head` instead of recording a commit oid. A HEAD on any `wip/*` branch exits 1 with `code: head-is-wip`: another feature holds this work tree, so ask the user and recommend a separate `git worktree` rather than switching branches under that session. Defaults, upstreams, and conventions count only when checked out; a linked worktree records its own branch.

Before merge run `bun "<GSD_ROOT>/tools/gsd-git.mjs" preflight --feature-dir .scratch/<feature>`, unpiped or under `set -o pipefail`.
- Exit 0 prints `status: ready`, the observed base, WIP branch, and HEAD (equal to `wip_branch`), one `repo:` line per other listed repository, and a trailing `exit=0` line.
- Exit 1 prints `status: blocked`, a `code:`, and `exit=1`; it blocks as Spec escalation and never retargets the merge, except `base-advanced`, which merges `base_ref` into `wip/<feature>` and repeats the terminal gate. Exit 2 corrects invocation.
- Codes include `detached-head`, `head-not-wip`, `base-advanced` (the base gained commits the WIP branch lacks), `base-changed` (a listed repository's Repos row differs from its WIP branch's pin), `base-missing`, `wip-missing`, `base-checked-out-elsewhere`, `base-is-wip`, `dirty-worktree`, `not-a-repository-root` (a listed repository that is only a folder inside another one), `plan-invalid`, and Git-query failures; an unanswered query blocks.
- `dirty-worktree` counts staged, modified, and untracked paths outside `.scratch/`, both sides of a rename included. Both commands are read-only.

The merge or pull request targets exactly the recorded `base_ref`; never widen to repository defaults. Promoting base onward is separate user-owned work.

## Feature cleanup

After a merge lands, check out `base_ref`, delete `wip/<feature>` and the retired task branches with `git branch -d` (never `-D`), remove clean isolated workspaces, and remove `.scratch/<feature>/`. A plan with `## Repos` does the same in every listed repository. A pull request keeps the branch and scratch until the user says it merged. Unmerged branches or dirty workspaces stay unforced and surface for inspection.

For explicit abandon: confirm the feature name, inspect the worktree, check out `base_ref`, safely delete the WIP branch, and remove `.scratch/<feature>/`. Never force-delete unmerged work without explicit confirmation.
