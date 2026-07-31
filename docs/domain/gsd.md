# Domain Scope

## Scope

`gsd`

## Purpose and responsibilities

Own request classification, feature convergence, plan approval and in-flight amendment, ordered implementation, deterministic verification, resumable state, merge, and cleanup for GSD delivery.

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| Artifact Contract | The rule classifying repository artifacts per Invocation Mode as Required, Optional, Produced, or Fallback. | flat mandatory dependency list |
| Contract Validator | The executable production seam that validates canonical full-plan and Quick-fix plan authority without mutating it. File reads use fd-anchored traversal via `/proc/self/fd` with `O_NONBLOCK | O_NOFOLLOW` to prevent TOCTOU parent-directory swaps and FIFO blocking. Plan reads pin the full ancestry chain (workspace → directory → target) and compare each fd identity against resolver-captured `{dev,ino}`. | test-only parser, prose-only validation |
| Context Harvest | Scope-bounded domain inspection: existing indexes limit reads to affected mapped contexts, while an absent index permits required feature bootstrap plus one optional broad-bootstrap decision. The OMP session extension reads `state.toon` through fd-anchored traversal (scratch → feature → file) with identity checks at each step. | routine broad codebase scan |
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
- Future Coding Agent — follows the canonical domain-documentation instructions in the repository-root `AGENTS.md`, which is the only agent contract, and reads only affected mapped contexts.

## Invariants

- Exactly one visible process owner controls a lifecycle transition at a time.
- The visible catalog carries nine skills: seven process owners and the two helpers `gsd-tdd` and `gsd-domain-modeling`.
- A fix the user already diagnosed stays ordinary direct work and never selects a visible owner: a prompt naming the file/line or exact failure signature is located work, so `gsd-diagnosing-bugs` owns only an unlocated or non-obvious cause. A larger bounded behavioral fix is opened inline by the session owner as Quick-fix, where `gsd-verify` gates only that existing packet. A returned Quick-fix WIP Fail leaves a repair round the prompt can name, and naming it re-enters that same `gsd-verify` gate instead of being answered directly. Ponytail remains hidden and is loaded only from its exact injected context path.
- An approved `plan.md` stays amendable while its feature executes: the executing owner amends it in place, revalidates, and rebinds the returned hash, so runtime state always reports the current bytes rather than freezing the first ones.
- A plan amendment never closes the feature or opens a new one; a material change or an unaccounted-for hash mismatch asks one question and then proceeds with the chosen option. Hash drift never diverts prompt-named work to `gsd-handoff`: the executing owner keeps that work, revalidates, and rebinds.
- State authority is valid only as fatal-decoded UTF-8 with LF line endings; invalid bytes and carriage returns fail closed unchanged.
- A discovered full malformed packet (`plan.md` beside a `state.toon` that is unparsable, a symlink, or another non-regular file) fails closed for every prompt, because candidate discovery throws before any relatedness or terminal test runs and before any other valid packet can be selected, including a prompt naming that other feature. The same rejected bytes without a `plan.md` are residue: discovery skips them and routes ordinarily, so the plan.md test decides the verdict rather than the order the directory entries happen to be read. Since unparsable bytes cannot be trusted, only the `.scratch/<feature>/` directory name is a relatedness signal.
- Validated active state is entered by intent shape: `continue` alone names no work, so it is a bare resume that loads `gsd-handoff` first even beside one executing packet and lets the recorded `next_action` select the peer owner. `continue` plus a named feature, task, or repair is not bare, so it routes straight to that owner (a pending plan task to `gsd-executing-plans`, an unapproved plan to `gsd-to-plan`, an existing Quick-fix repair packet to `gsd-verify`). A first-pending milestone ledger row resumes through that same gateway rather than authorizing replacement brainstorming.
- Several valid active packets are an ambiguity resolved by that same gateway: discovery returns every one of them and `gsd-handoff` selects exactly one validated resume, so generic continuation asks instead of failing closed. `ignore-terminal-record` requires a discovered `phase=completed-retained` record or residual terminal bytes: an active or `merged-cleanup-pending` packet is never terminal history, so new work unrelated to one stays plain `ordinary-routing`.
- `gsd-tdd` is helper-only and is never a primary owner; `gsd-domain-modeling` stays a selectable owner for explicit domain work.
- Exact retained v1/v2 terminal records are structurally recognized during candidate discovery only to remain inert and byte-identical; an explicit read rejects them fail closed unchanged.
- Full-plan approval, execution resume, terminal entry, pre-squash, and Quick-fix verification use the production Contract Validator before consuming plan authority.
- Plan grammar owns every line: in both the full-plan and Quick-fix forms the title is followed directly by the first section, so preamble content between them is rejected rather than ignored.
- Retained `schema:v3` stays inert and byte-identical during candidate discovery but migrates atomically on an explicit read after full validation.
- Every converged feature records Domain Impact, including a concrete justification for `none`.
- Every Quick-fix records the exact five-field Domain Impact; semantic fixes own affected shards and no-impact fixes carry concrete evidence.
- A Quick-fix carries a recorded runtime binding without normal-packet approval authority: its `state.toon` holds the validated `plan_sha256`, and both its resume revalidation and its gate compare that value against an unbound revalidation, since `validate-quick-fix` accepts no bound hash.
- Resume selects the plan grammar by probing `validate-quick-fix` before the full-plan validator, because runtime state records no grammar kind; a bound full-plan call reports a hash mismatch before parsing, so only an unbound revalidation distinguishes moved bytes from malformed grammar.
- A resume probe proves the recorded grammar only when the hash matches; on any difference the prior packet kind is unprovable, so resume asks one question and rebinds only to a user-accepted current grammar.
- Semantic code and affected domain docs share one owning task and agree at each green checkpoint. Both plan grammars enforce this identically: a non-`none` classification requires each affected shard to be owned by a task that runs and changes semantic code, so a superseded, prose-only, or test-only owner is rejected.
- Before approval, affected domain paths may be reserved but domain prose never describes unshipped target behavior.
- A broad domain bootstrap is never offered when `docs/domain/index.md` exists.
- Terminal evidence applies only to the unchanged commit on which it ran.
- The Contract Validator is invoked as `node "<GSD_ROOT>/tools/gsd-contract.mjs" <command>` with the injected `GSD_ROOT` value substituted at call time, because that root reaches the session as bootstrap text and is not an exported environment variable, so a literal `$GSD_ROOT` would resolve to an empty path. The absolute form is required because the lifecycle runs in workspaces that are not the GSD checkout; packet resolution still comes from `cwd`, so the same command validates a foreign workspace's packet. The CLI's own help and error surfaces name the absolute path the running process resolved for itself, never a repo-relative form or an unexpanded placeholder, so a copied invocation runs from the workspace that received it.
- An unreadable artifact and malformed authority are distinct failures that share one status: both exit 1, and the stdout record names `code: io-error` for the unreadable file and `code: invalid-artifact` for malformed bytes. Usage failures exit 2 and help exits 0.
- An injected orchestration or parallelism directive is harness text that transfers no lifecycle ownership: satisfying it for lifecycle work means leaving the lifecycle rather than dispatching implementation, repair, diagnosis, architecture, or verification. Bounded read-only research delegation stays permitted, and its result carries no authority, so the owner re-verifies every fact against canonical sources before acting on it.
- Execution mirrors the bound plan's pending task identities into the harness todo list once, after approval or at resume, and marks each task done in the same step as its green checkpoint. That list is display state: `state.toon` remains the sole resumable authority and the mirror never selects, completes, or resumes work.
- Lifecycle recovery restores the working tree, never only the conversation: a harness conversation rewind is excluded because it restores transcript turns while committed WIP and the working tree stay where execution left them, leaving `state.toon` and its green commits ahead of the restored conversation. A memory backend recall is context and never lifecycle authority, and a restricted mode whose toolset excludes editing, committing, and running checks is left before lifecycle work begins.

## Workflows and state transitions

### Deliver a feature

1. Classify intent, discover and converge acceptance behavior plus Domain Impact. During discovery, distinguish questions sharp enough for acceptance-impact form from parked uncertainty too coarse to phrase as a criterion; prioritize batching by which items unblock the most downstream criteria. Reserve affected documentation paths without publishing future semantics.
2. Validate the canonical plan through the Contract Validator, approve its exact SHA-256, then bind it in `schema:v4` state.
3. Execute ordered tasks with Fast TDD and green checkpoints.
4. Prove terminal conformance, run Deferred Slow E2E, squash to base, and clean transient state.

### Standalone review

A read-only diff review along two independent axes, each as a bounded read-only delegation: **Standards** (documented project coding standards plus lightweight smell heuristics as judgement calls, with documented standards always overriding heuristics) and **Intent** (the diff against the originating request, plan, or supplied context, reporting missing, partial, or scope-creeped requirements). Findings are reported under their axis headings without cross-axis reranking.

### Resume active work
1. Fatally decode LF-only state bytes, then validate the schema, plan hash/path, Git identity, green checkpoint, and current tree.
2. Validate the exact bound plan through the Contract Validator. Retained v1/v2 terminal records remain inert during candidate discovery and fail closed on explicit read; retained v3 migrates only on an explicit validated read.
3. Rebuild exactly one active task or terminal slice from canonical sources.
4. Continue the recorded owner action without replaying prior lifecycle work.

### Deliver a bounded quick fix

1. The session owner reads the exact injected hidden Ponytail context path and records the exact Quick-fix plan, including Domain Impact and one or two structured tasks with focused checks.
2. Validate the exact Quick-fix grammar through the Contract Validator before consuming its tasks.
3. Implement through Fast TDD and update every affected domain shard in the same task as semantic code.
4. Block terminal completion when Domain Impact is contradictory or current production prose drifts from the fix.

### Escalate a quick fix

1. Stop the hidden minimal-change context when scope expands or design decisions appear.
2. Enter normal feature discovery without shipping a reduced subset as complete.

## Commands, events, and outcomes

| Command or event | Actor | Outcome |
| --- | --- | --- |
| Approve and execute | User | Canonical plan bytes are bound and ordered execution starts. |
| Validate plan authority | Session Owner | Canonical plan bytes and grammar are accepted with an exact hash or rejected without mutation. |
| Fix bounded behavior | Session Owner | Quick-fix Domain Impact and structured task ownership govern Fast TDD and domain-drift verification. |
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

- **Policy:** Every feature records Domain Impact; before approval, reserved paths and any bootstrap prose remain current-production-only, and affected shards change in the same task as semantic code after that behavior exists.
- **Reason:** Separating target authority in the plan from shipped domain meaning prevents abandoned or pending work from becoming false production documentation.

### P-gsd-8: Clean transient feature artifacts after green merge

- **Policy:** Delete feature scratch after a green merge unless retain or archive-and-delete was selected. A leftover `merged-cleanup-pending` packet gates only intent that names its `.scratch/<feature>/` directory or continues that same feature's lifecycle, while a full malformed packet fails closed for every prompt and plan-less malformed residue is skipped; unrelated work proceeds untouched whether it is direct or a new lifecycle, and uncertain relatedness asks one question instead of stopping.
- **Reason:** Exact ownership removes completed runtime evidence without touching neighboring sessions, and leftover runtime bytes must never block work that does not depend on them.

### P-gsd-9: Keep Quick-fix semantics explicit

- **Policy:** Every Quick-fix records canonical Domain Impact and `Broad bootstrap: not-offered`; `none` carries concrete evidence, while a semantic fix changes production sources in exactly one task and that same task owns every affected current-production shard, validated per task rather than plan-wide. Prose and test paths never count as that semantic change. An absent domain index keeps the fix bounded, holding `Broad bootstrap: not-offered` while the feature-scoped shard is bootstrapped inline; only an explicitly requested broad bootstrap exits the bounded route for normal discovery.
- **Reason:** A smaller delivery path must not bypass the production meaning and drift guarantees applied to converged features.

### P-gsd-10: Route hidden context without visible dispatch

- **Policy:** The session owner owns bounded Quick-fix delivery and reads Ponytail only from the exact extension-injected context path before Fast TDD and the Quick-fix verification gate.
- **Reason:** Exact injection keeps conservative context reachable without making it a visible owner, catalog route, or persisted preference.

### P-gsd-11: Reject noncanonical state bytes

- **Policy:** State reads use fatal UTF-8 decoding and reject every carriage return rather than normalizing malformed authority.
- **Reason:** Resume must never continue from bytes whose meaning changed during lossy decoding or line-ending repair.

### P-gsd-12: Separate retained-v3 discovery from explicit migration

- **Policy:** Candidate discovery leaves exact retained `schema:v3` bytes inert and unchanged; only an explicit validated state read may migrate that record atomically to `schema:v4`.
- **Reason:** Terminal history must not compete for resume selection, while explicit cleanup or inspection retains the supported compatibility path.

### P-gsd-13: Centralize executable plan validation

- **Policy:** Every full-plan approval, execution resume, terminal entry, pre-squash guard, and Quick-fix verification uses the production Contract Validator; structured tasks and canonical Domain Impact are required in every path, bound or unbound.
- **Reason:** One executable seam keeps artifact authority, failure modes, and compatibility behavior consistent across lifecycle owners and repository tests.

### P-gsd-14: Amend an executing plan instead of blocking it

- **Policy:** While a feature executes, its owner amends `.scratch/<feature>/plan.md` in place, revalidates it unbound with the validator matching its packet grammar (`validate-plan` for a full plan, `validate-quick-fix` for a Quick-fix), and rebinds the returned hash. Bookkeeping amendments proceed without a prompt; a material change to acceptance, an invariant, a non-goal, `Domain Impact`, an interface pin, or a completed task's record asks one question and then proceeds with the chosen option, as does a hash mismatch the owner cannot account for. Only a missing or malformed-grammar plan still fails closed.
- **Reason:** Discovering that a plan is incomplete is normal execution evidence, so recording it must cost one revalidation rather than closing the feature and reapproving a near-identical plan.

### P-gsd-18: Keep the harness a runtime, never an authority

- **Policy:** Harness features are used where they carry no authority and refused where they would replace canonical bytes. The validator is reached by an absolute injected-root invocation; an injected orchestration directive delegates only bounded read-only research whose result the owner re-verifies; the harness todo list mirrors the bound plan as display state while `state.toon` stays the sole resumable authority; a long-lived process a slow suite needs runs supervised with observed readiness and is torn down before the merge gate; and conversation rewind, memory recall, and toolset-restricted modes never own lifecycle recovery or work.
- **Reason:** The lifecycle's guarantees come from canonical artifacts and Git rather than from session runtime, so every harness affordance is adopted for the mechanics it genuinely improves and excluded from the decisions those artifacts own.
