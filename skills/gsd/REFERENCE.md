# GSD Reference

Load only the `§` sections the flow needs. It defines the shared meaning of artifacts and lifecycle state; skills select an Invocation Mode before validating required artifacts.

## Artifact Contract

`consumes:` and `produces:` frontmatter are catalog unions, not prerequisites. Explicit intent and entry context choose a skill's mode; artifact presence never does. A missing, malformed, or duplicate artifact the mode requires fails closed and names the file; never invent a file or its contents. Optional context that is absent is normal. Validate `phase` against the schema enum and preserve opaque `next_action` values on resume.
Hidden references (`gsd-to-plan`, `gsd-codebase-architecture`, `gsd-domain-modeling`, `gsd-tdd`) are files, not registered skills: read `GSD_ROOT/skills/<name>/SKILL.md`, never through a Skill tool.

## Durable documentation contract

Git-tracked knowledge for people and agents is strict Markdown under `docs/`; TOON is only the runtime `state.toon` under `.scratch/`.

- `docs/domain/index.md` is a small bounded-context index; `docs/domain/<scope>.md` shards describe current production terms, actors, invariants, workflows, outcomes, relationships, and policies. Shard by bounded context, never feature. `gsd-domain-modeling` owns the exact schema and is sole writer.
- `docs/decisions/NNNN-slug.md` and `docs/design/NNNN-slug.md` are durable decision and UI/UX design records; numbering is sequential and gap-free per directory.

### Domain lifecycle

Domain docs apply only in repositories with `docs/domain/index.md` or after the user accepts a bootstrap; elsewhere a plan omits `Domain Impact`.
- When recorded, `classification=none` requires `contexts=none`, `documentation=none`, and concrete evidence. Semantic changes name affected contexts and bind exact `docs/domain/<context>.md` paths to tasks that also change semantic code; prose-only or test-only ownership fails.
- An existing index suppresses every broad bootstrap prompt: read only shards mapped to affected contexts. When absent, brainstorming may offer a bootstrap once; an accepted bootstrap writes the feature-scoped contexts, and a decline writes nothing.
- Domain docs describe current production behavior after tasks; plans record target behavior before them. Code, schemas, contracts, and tests win on conflict, and drift in the affected contexts blocks until they agree; drift elsewhere is reported, never repaired in this feature.
- `gsd-domain-modeling` upserts one canonical `## Domain documentation` section in applicable `AGENTS.md` without duplication.

### Durable decision and design records

Decision records capture load-bearing tradeoffs settled during convergence; design records capture UI/UX decisions settled during execution. Both carry `# NNNN — Title`, exactly one `- **Status:** Accepted|Rejected|Superseded by NNNN`, exactly one `- **Date:** YYYY-MM-DD`, and a non-empty `## Decision` section; measurement sections stay optional.
`bun "<GSD_ROOT>/tools/gsd-record.mjs" validate --path <record> --kind decisions|design` proves the header: exit 0 is `status: valid`, or `status: skipped` for a basename that does not start with digits (a README or a theme file gathering several records); exit 1 is `code: invalid-record` or `io-error`; exit 2 is usage.
Only basenames under those directories that start with digits must match `NNNN-slug.md`. The terminal gate validates only the records the feature added (`git diff --name-only --diff-filter=A <base_ref> -- docs/decisions docs/design`); an older record edited or renamed in passing keeps its shape. `AGENTS.md` gains one `## Decisions` and one `## Design` section, upserted without duplication.

## Canonical Markdown contract

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
bun "<GSD_ROOT>/tools/gsd-domain.mjs" normalize --index docs/domain/index.md [--write] [--scope <scope>]...
```

- The same command validates a new, resumed, or amended plan; `plan.md` bytes are not pinned. Once `state.toon` exists, pass `--expected-base <state.base_ref>`, so a drifted `## Base` fails closed instead of retargeting the merge.
- The two `normalize` commands fix only surface form and order; run them with `--write` before validating instead of fixing by hand. Domain commands take one `--scope` per affected context.
- Exit 1 lists every defect as `error:`, `error_2:`, and onward, each with its `help:` fix, so fix them all before rerunning; exit 2 corrects invocation.
- Only `init-plan`, `normalize-plan --write`, `gsd-domain.mjs normalize --write`, and `gsd-state.mjs set` write anything.

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

`plan.md` stays editable while its feature executes; only a missing or malformed `plan.md` fails closed. The owner amends it in place and revalidates; an amendment writes no checkpoint of its own, and the next regular checkpoint increments `checkpoint_revision` as always. No branch closes and no new feature opens.
- Bookkeeping amendments are self-service while tasks execute: fixing paths or intents, adding a supporting path to a pending or dispatched task's `Files`, splitting or reordering pending tasks, or sharpening wording that leaves acceptance intact.
- `Files` keeps dispatched tasks disjoint, so a task completed inline is not backfilled with the supporting paths it touched; preflight's `outside_files:` lines name them for the terminal gate.
- Progress lives in `state.toon`, so a finished task needs no `Status` edit. Once the terminal gate starts, bookkeeping is not written back: the gate names in-scope supporting paths in its report.
- A user-stated requirement change mid-execution is an amendment: amend, revalidate, and continue.
- An amendment keeps the plan grammar in [../gsd-to-plan/PLAN-GRAMMAR.md](../gsd-to-plan/PLAN-GRAMMAR.md); `validate-plan` is the authority.
- Material amendments are changing an active criterion, weakening invariants or non-goals, changing `Domain Impact`, replacing interface pins, changing a `## Repos` base, or rewriting completed tasks. The owner decides each by its own recommendation, records it as the next `D-n` decision with its rationale, and lists it in the final report.
- The owner asks only for a destructive or outward action the plan does not cover (production data, a force push, deleting files nobody approved, a push the plan does not choose), for missing access, for a gate block whose help says to ask the user (such as `base-checked-out-elsewhere`; never merge inside another worktree's checkout), or for an acceptance contradiction with no defensible default.

### Skill derivation from phase and next_action

Active helpers are derived, never stored:

- `start/continue task`: `gsd-executing-plans`, plus the `gsd-tdd` reference file.
- `enter terminal verification/repair`: `gsd-verify`, resuming conformance or Deferred Slow E2E.
- `deliver merge or pull request` (older packets: `ask merge or pull request`): `gsd-verify` delivers as `plan.md` § Delivery says, or asks the merge-or-PR question when the plan has none.
- `Spec-escalation`: report the blocker and ask the user how to proceed.
- Conditional: reading `GSD_ROOT/skills/gsd-domain-modeling/SKILL.md` completes affected-context documentation before checkpoint.

The master `gsd` skill is already present from bootstrap and is never reloaded.

### Recovery tooling exclusions

Recovery restores from `state.toon` and Git, never from conversation. Harness conversation rewind does not rewind commits or the working tree, and memory recall is context, not authority. A restricted mode that cannot edit, commit, or run checks cannot own lifecycle work.

### Candidate discovery

Candidates are `.scratch/<feature>/` directories holding a regular `plan.md` and a structurally valid `state.toon` whose `owner` is the current session; artifact contents are never executed. A recovery capsule's `[GSD Packet Notes]` names skipped packets: a malformed one is a stop, a retired-schema one needs a rebind before it resumes. The adapter-side algorithm and the Compaction Recovery Capsule live in `adapters/README.md` § Recovery contract.

## Post-plan pipeline contract

After binding, tasks run in order with Fast TDD and green checkpoints; waves dispatch under the Wave dispatch section of `gsd-executing-plans`. `Tn+1` requires a committed green `Tn`. Mutations and Deferred Slow E2E never overlap.
- The `gsd-verify` terminal gate runs on unchanged commits: exact binding, criterion coverage, in-scope paths, and a whole-diff review against decisions, invariants, and non-goals. Only a red check, an uncovered criterion, an out-of-scope path, domain drift, or a contradiction of bound plan text blocks.
- Deferred Slow E2E runs only after conformance; source changes invalidate it. Green unchanged bytes set `phase=ready`, and the owner delivers as `plan.md` § Delivery says without asking; without that section it asks whether to merge or open a pull request, and a repository with no `git remote` offers only the merge.

## Git/base/WIP/scratch mechanics

Branch-backed writes require a Git work tree. `plan.md` records base before `wip/<feature>` is created, and base is never `wip/<feature>`. `.scratch/` is machine-local and git-ignored, and review diffs exclude it. Nano and read-only work are git-free.

One work tree can hold other sessions' uncommitted edits, so Git commands stay scoped to what the current task owns:
- Create `wip/<feature>` with `git switch -c wip/<feature> <base_ref>` when execution starts, only while nothing outside `.scratch/` is dirty or every dirty path is this feature's own; dirty paths travel with the switch into this feature. Never `-B`, `branch -f`, or `--ignore-other-worktrees`: they repoint or share a branch another worktree holds.
- Stage the task's own paths by name (`git add -- <path>…`), never `git add -A` or `git commit -a`.
- Never move a branch another worktree has checked out (`git update-ref`, `git fetch . <src>:<branch>`, `git branch -f`, or a `commit-tree` result written to it): that worktree's HEAD shifts under its index, and its next commit reverts the move. Merge there only after asking the user, or deliver parts through an integration branch (`gsd-brainstorming` § Parts).
- Never `git stash`, `git clean`, `git reset --hard`, `git checkout -- <path>`, or `git restore` paths the task does not own, and never delete `.git/index.lock`; list what is in the way and ask the user.

### Cross-repo plans

A plan with `## Repos` keeps `.scratch/<feature>/` and `state.toon` in this repository only.
- Each listed repository gets its own `wip/<feature>` branch cut from its row's Base, pinned at creation with `git -C <repo> config branch.wip/<feature>.gsdBase <Base>`; `preflight` blocks `base-changed` when the row no longer matches and marks a branch with no pin `unpinned`. A task's branch is cut in its own repository, and `last_green_commit` is the checkpointed commit there.
- A listed repository has one HEAD of its own: if another feature's `wip/*` is checked out there, ask the user for a worktree of it (`git -C <repo> worktree add -b <branch> <dir> <Base>`) and list that worktree's path in `## Repos`, rather than switching that repository's branch. Its sub-agent tasks run serially unless each gets its own worktree of that repository.
- `analyze-waves` treats the same path in two repositories as disjoint. `verify-task-branch` reads the task's repository from the plan; `preflight` proves every listed repository.
- The plan's Delivery, or the single merge-or-pull-request question, covers every repository, each targeting its own row's Base. Listed repositories merge first and this one last; branches and scratch are deleted only after every merge landed, and `preflight` reports an already merged repository as `merged`, so an interrupted run resumes.
- Domain docs are written only in repositories that have `docs/domain/index.md`.

### Base derivation and merge target

At packet creation run `bun "<GSD_ROOT>/tools/gsd-git.mjs" derive-base` and record the printed `base:` branch in `plan.md` § Base and `state.toon` `base_ref`. A detached HEAD exits 1 with `code: detached-head` instead of recording a commit oid. A HEAD on any `wip/*` branch exits 1 with `code: head-is-wip`: another feature holds this work tree, so ask the user and recommend a separate `git worktree` rather than switching branches under that session. Defaults, upstreams, and conventions count only when checked out; a linked worktree records its own branch.
- For a worktree of its own, run `derive-base` in the original tree, then `git worktree add -b wip/<feature> <dir> <base>`, and record that base in the new worktree's plan and state.

Before merge run `bun "<GSD_ROOT>/tools/gsd-git.mjs" preflight --feature-dir .scratch/<feature>`, unpiped or under `set -o pipefail`.
- Exit 0 prints `status: ready`, the observed base, WIP branch, and HEAD (equal to `wip_branch`), one `repo:` line per other listed repository, and a trailing `exit=0` line.
- Exit 1 prints `status: blocked`, a `code:`, and `exit=1`; it blocks as Spec escalation and never retargets the merge, except `base-advanced`, which merges `base_ref` into `wip/<feature>` and repeats the terminal gate. Exit 2 corrects invocation.
- Codes include `detached-head`, `head-not-wip`, `base-advanced` (the base gained commits the WIP branch lacks), `base-changed` (a listed repository's Repos row differs from its WIP branch's pin), `base-missing`, `wip-missing`, `base-checked-out-elsewhere` (another worktree holds the base; ask the user, never move the ref), `base-is-wip`, `dirty-worktree`, `not-a-repository-root` (a listed repository that is only a folder inside another one), `plan-invalid`, and Git-query failures; an unanswered query blocks.
- `dirty-worktree` counts staged, modified, and untracked paths outside `.scratch/`, both sides of a rename included. Both commands are read-only.

The merge or pull request targets exactly the recorded `base_ref`; never widen to repository defaults. Promoting base onward is separate user-owned work.

## Feature cleanup

After a merge lands, check out `base_ref`, delete `wip/<feature>` and the retired task branches with `git branch -d` (never `-D`), remove clean isolated workspaces, and remove `.scratch/<feature>/`. A plan with `## Repos` does the same in every listed repository. A pull request keeps the branch and scratch until the user says it merged. Unmerged branches or dirty workspaces stay unforced and surface for inspection.

For explicit abandon: confirm the feature name, inspect the worktree, check out `base_ref`, safely delete the WIP branch, and remove `.scratch/<feature>/`. Never force-delete unmerged work without explicit confirmation.
