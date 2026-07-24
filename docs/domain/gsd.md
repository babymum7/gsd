# Domain Scope

## Scope

`gsd`

## Purpose and responsibilities

Own request classification, feature convergence, immutable plan approval, ordered implementation, deterministic verification, resumable state, merge, and cleanup for GSD delivery.

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| Artifact Contract | The rule classifying repository artifacts per Invocation Mode as Required, Optional, Produced, or Fallback. | flat mandatory dependency list |
| Context Harvest | Scope-bounded domain inspection: existing indexes limit reads to affected mapped contexts, while an absent index permits required feature bootstrap plus one optional broad-bootstrap decision. | routine broad codebase scan |
| Deferred Slow E2E | A resource-heavy feature journey run only after current-commit deterministic conformance. | task-loop check |
| Domain Impact | The mandatory plan classification binding semantic change evidence, affected contexts, documentation action, and broad-bootstrap disposition. | optional documentation note |
| Fast TDD Check | A deterministic local command suitable for repeated RED→GREEN use at a production-facing seam. | final slow acceptance suite |
| Invocation Mode | A named path through one skill with its own required artifacts, fallback behavior, output authority, and prompt policy. | dispatch label |
| Milestone Ledger | The Git-tracked `docs/gsd/<feature>/milestones.md` contract carrying precise user-approved milestone goals and durable pending/done state. | roadmap, task ledger |
| Resumable State Snapshot | The atomic canonical `schema:v4` `.scratch/<feature>/state.toon` record binding plan bytes, Git identity, green checkpoint, runtime preferences, and revision. | handoff history, task attempt |
| Session Owner | The current top-level session as sole lifecycle authority; a later session assumes the role only through canonical rehydration. | persistent agent identity |
| Terminal Conformance | Deterministic current-commit proof of plan/state binding, acceptance coverage, path ownership, Domain Impact, code/domain agreement, and check evidence. | free-form verdict |

## Actors

- User — supplies intent, resolves load-bearing decisions, approves a plan, and may select a broad domain bootstrap only before the first domain index exists.
- Session Owner — owns discovery, planning, implementation, repair, verification, Git, merge, and cleanup inline.
- Future Coding Agent — follows the canonical domain-documentation instructions in `AGENTS.md` and reads only affected mapped contexts.

## Invariants

- Exactly one visible process owner controls a lifecycle transition at a time.
- Approved `plan.md` bytes remain immutable; runtime state only binds and reports them.
- Every converged feature records Domain Impact, including a concrete justification for `none`.
- Semantic code and affected domain docs share one owning task and agree at each green checkpoint.
- A broad domain bootstrap is never offered when `docs/domain/index.md` exists.
- Terminal evidence applies only to the unchanged commit on which it ran.

## Workflows and state transitions

### Deliver a feature

1. Classify intent and converge acceptance behavior plus Domain Impact.
2. Write and approve one canonical plan, then bind it in `schema:v4` state.
3. Execute ordered tasks with Fast TDD and green checkpoints.
4. Prove terminal conformance, run Deferred Slow E2E, squash to base, and clean transient state.

### Resume active work

1. Validate the state schema, plan hash/path, Git identity, green checkpoint, and current tree.
2. Rebuild exactly one active task or terminal slice from canonical sources.
3. Continue the recorded owner action without replaying prior lifecycle work.

### Escalate a quick fix

1. Stop the hidden minimal-change context when scope expands or design decisions appear.
2. Enter normal feature discovery without shipping a reduced subset as complete.

## Commands, events, and outcomes

| Command or event | Actor | Outcome |
| --- | --- | --- |
| Approve and execute | User | Canonical plan bytes are bound and ordered execution starts. |
| Continue active feature | User | Validated state selects one resumable owner action. |
| Domain drift detected | Session Owner | Completion is blocked until code and affected shards agree. |
| Green terminal conformance | Session Owner | Deferred Slow E2E becomes eligible on unchanged bytes. |
| Pause and save | User | One atomic state snapshot records the next action. |
| Scope expands | Session Owner | Quick-fix context ends and normal discovery begins. |

## Context relationships

None.

## Domain policies

### P-gsd-1: Preserve mode-aware artifact authority

- **Policy:** Each Invocation Mode defines its own Required, Optional, Produced, and Fallback artifacts; flat frontmatter arrays are catalog metadata.
- **Reason:** Mode-first validation prevents missing optional files from inventing workflow state.

### P-gsd-2: Escalate work that stops being a quick fix

- **Policy:** Clear bounded quick-fix context and enter the normal lifecycle when requested work becomes complex or expands beyond known scope.
- **Reason:** Silently reducing requested scope would bypass design and verification.

### P-gsd-3: Make the session owner the sole lifecycle authority

- **Policy:** The current top-level session owns plan interpretation, implementation, repair, verification, E2E, Git, merge, and cleanup inline and sequentially.
- **Reason:** One owner avoids lossy handoff while canonical artifacts let a later session assume the role safely.

### P-gsd-4: Converge only through deterministic blockers

- **Policy:** Repair continues only for malformed authority, ownership or coverage mismatch, explicit contradiction, domain drift, unresolved change, or a red deterministic check.
- **Reason:** Objective evidence converges without subjective verdict loops.

### P-gsd-5: Rehydrate authority from canonical sources

- **Policy:** Resume validates `schema:v4`, exact plan path/hash, base/WIP identity, last green task/commit, and current tree before rebuilding work.
- **Reason:** Portable continuation depends on canonical bytes and Git rather than conversation or persistent identities.

### P-gsd-6: Require fast TDD and defer resource-heavy E2E

- **Policy:** Every observable task runs RED→GREEN→refactor at the smallest real fast public seam; Deferred Slow E2E runs after current-commit conformance.
- **Reason:** Fast feedback protects implementation while the expensive journey remains the final unchanged-commit gate.

### P-gsd-7: Keep production domain documentation aligned

- **Policy:** Every feature records Domain Impact; affected shards describe current production behavior and change in the same task as semantic code.
- **Reason:** Domain knowledge remains useful to people and future agents only when it cannot drift behind production authority.

### P-gsd-8: Clean transient feature artifacts after green merge

- **Policy:** Delete feature scratch after a green merge unless retain or archive-and-delete was selected.
- **Reason:** Exact ownership removes completed runtime evidence without touching neighboring sessions.
