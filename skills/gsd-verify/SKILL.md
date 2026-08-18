---
name: gsd-verify
description: "Diff/PR review or planned/quick-fix terminal gate."
produces: [docs/gsd/<feature>/milestones.md, docs/gsd/<feature>/archive/plan.md, docs/gsd/<feature>/archive/implementation.md, state.toon]
consumes: [plan.md, state.toon, docs/domain/index.md, docs/domain/<scope>.md, AGENTS.md, docs/gsd/<feature>/milestones.md]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Do-not-load: invent completion without deterministic gates; per-task terminal verification
- Transition: planned or Quick-fix green path performs squash, automatic cleanup, and optional retain/archive

# Verify

> **Invocation guard** — automatic selection loads standalone review; active owners load planned/quick-fix/milestone gates. Select an Invocation Mode and validate only its Required state under [REFERENCE.md § Post-approval pipeline contract](../gsd/REFERENCE.md#post-approval-pipeline-contract) and § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Standalone review | — | Markdown packet context | — | — |
| Planned WIP gate | `plan.md`; bound `state.toon` | authorized ledger | `state.toon`; authorized ledger; amended `plan.md` | Stop before review or merge only when `plan.md` or `state.toon` is missing or malformed |
| Milestone WIP gate | Planned state; authoritative ledger | — | `state.toon`; milestone ledger lifecycle state | Missing source/binding is Spec escalation; missing ledger evidence is a Blocker |
| Quick-fix WIP gate | exact Quick-fix `plan.md`; bound `state.toon` | affected domain shards; `AGENTS.md` | `state.toon`; amended `plan.md` | Missing or malformed grammar, state, or binding blocks; recover the real plan and never fabricate it |

## Planned and milestone WIP gate

At terminal entry, validate canonical `schema:v4`, exact plan hash/binding, base/WIP identity, last green checkpoint, current tree, and required artifacts; rebuild the terminal slice including `Domain Impact`. Malformed new grammar, feature mismatch, missing artifact, or Git drift is Spec escalation. Repeat the digest guard before squash. Select `Milestone WIP gate` when `plan.md` `## Publication` is non-`null`; otherwise `Planned WIP gate`.

Terminal entry never blocks on the plan having moved: changed plan bytes revalidate and rebind under [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Plan amendment, then conformance proves the amended plan on the unchanged commit. Amend here only to record what the work actually did; a material change or drift the owner cannot account for asks one question first. Rebinding after the pre-squash guard requires rerunning that guard.

At terminal entry and again before squash run `node "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md --expected-sha256 <state.plan_sha256> --expected-base <state.base_ref>`. Exit 0 must report the bound feature, hash, and base before cumulative proof continues; exit 1 on malformed grammar or a base mismatch blocks as Spec escalation, while a hash mismatch alone routes to § Plan amendment. Exit 2 corrects only the invocation. Never use the unbound form except to revalidate an amendment before rebinding.

After all tasks and Fast TDD Checks are green, the session owner performs deterministic cumulative conformance before Deferred Slow E2E:

1. Prove every active AC maps exactly once to one completed task and one public interface pin; every changed path is task-owned. Read task diffs in plan order against explicit Decisions, invariants, non-goals, file intents, and focused-check evidence on the unchanged current commit.
2. Prove `Domain Impact` against the cumulative diff. `none` requires concrete evidence that no term, invariant, workflow, outcome, relationship, policy, or bounded-context meaning changed. Every non-`none` classification requires exact affected shards and any index/AGENTS upsert to be owned by the same tasks as code. If the index existed, any broad-bootstrap offer or selection is contradictory.
3. Compare affected domain shards with production code, schemas, contracts, and tests. They must describe current production behavior, contain no obsolete or future target state, and leave unrelated contexts untouched. Domain drift blocks completion as a deterministic Blocker.
4. Only a malformed binding, ownership/coverage mismatch, explicit contract contradiction, domain drift, unresolved change, or red deterministic check blocks. No free-form critique or model-generated verdict is terminal authority; green is current-commit conformance, never persisted prose authority.
5. A blocker keeps `phase=repair` and `next_action=enter terminal verification/repair`; repair only plan-owned source, run affected Fast TDD Checks, and repeat invalidated proofs. Any source change invalidates prior conformance.
6. Run the complete feature-affected Deferred Slow E2E suite only after current-commit conformance. Any server, watcher, or daemon that suite needs starts as a supervised named process with an observed readiness condition, never a bare shell launch, and every such process is torn down before the merge gate. Failure returns to repair, affected fast checks, invalidated conformance, then the complete slow suite. Merge requires full slow/E2E GREEN on the same unchanged commit.

For squash, scratch disposition, archive, and cleanup use § Git/base/WIP/scratch mechanics and § Feature cleanup. Archive-and-delete materializes the exact approved plan and outcome before conformance so canonical archive destinations are terminal-cleanup-owned lifecycle paths in changed-path proof; every other changed path must be task-owned.

The merge target is exactly the recorded `state.toon` `base_ref`; never ask whether to merge into `main` and never widen to the repository default. Before the squash run `node "<GSD_ROOT>/tools/gsd-git.mjs" preflight --feature-dir .scratch/<feature>`: only `status: ready` proceeds, which also proves no path outside `.scratch/` is staged, modified, or untracked, so the squash carries only reviewed bytes; any `status: blocked` code is Spec escalation that stops the gate instead of retargeting the merge. Promoting that base onward is separate user-owned work after this packet ends green.

After green merge, write the state fields to `.scratch/<feature>/.state-input.json`, then use `node "<GSD_ROOT>/tools/gsd-state.mjs" write-state --feature-dir .scratch/<feature> --json-file .scratch/<feature>/.state-input.json` to atomically write `phase=merged-cleanup-pending` (never the `write` tool directly). Delete `.state-input.json` after the CLI succeeds or fails.

For `Milestone WIP gate`, prove the ledger matches its packet and remains sequential:
- Validate: `node "<GSD_ROOT>/tools/gsd-milestone.mjs" validate --path docs/gsd/<feature>/milestones.md --expected-feature <state.feature> --expected-base <state.base_ref>` must exit 0 and report the matching feature/base with the first `pending` row as the selected milestone.
- Complete: run `node "<GSD_ROOT>/tools/gsd-milestone.mjs" complete --path docs/gsd/<feature>/milestones.md --expected-feature <state.feature> --expected-base <state.base_ref>` once per remaining pending milestone in plan order; each non-final invocation marks exactly that row `done`, and the final milestone deletes the ledger.
Include every mutation in the same reviewed squash; a red gate changes no base ledger state, and any changed prefix, other row, append, reorder, or wrong row blocks.
## Standalone review

Read-only; no branch/result/merge authority. Supplied context informs, never approves. Report separate bounded-read-only axes: **Standards** — cite documented-standard violations; smell concerns are judgement only, standards win. **Intent** — cite request/plan/context mismatches: missing, partial, scope creep. Do not cross-rerank; summarize per axis.

## Quick-fix WIP gate

Quick fixes have the exact minimal `plan.md` grammar from `REFERENCE.md`, not a full feature packet.
- Parse its exact five-field `Domain Impact` before review.
- `none` requires concrete evidence that no term, invariant, workflow, outcome, relationship, policy, or bounded-context meaning changed.
- Every non-`none` classification requires exactly one semantic-code task owning each affected shard, and `Broad bootstrap` must always be `not-offered`.
- An absent domain index keeps the fix bounded and bootstraps the feature-scoped shard inline; only an explicitly requested broad bootstrap exits Quick-fix for normal discovery.
- Compare affected domain prose with production code, schemas, contracts, and tests; missing, obsolete, future, or unrelated prose is domain drift and blocks completion as a deterministic Blocker.
- Then run code-quality, the recorded focused behavior command, whole-branch build where available, and applicable E2E before the normal squash/cleanup sequence.

Before reviewing a Quick-fix run `node "<GSD_ROOT>/tools/gsd-contract.mjs" validate-quick-fix --path .scratch/<feature>/plan.md`. Exit 0 must report `kind: quick-fix` and the matching feature; exit 1 blocks malformed Quick-fix authority, while exit 2 corrects only the invocation. This command takes no `--expected-sha256`, so compare the returned hash with the recorded `state.toon` `plan_sha256`. A difference means the plan moved after its last checkpoint, so rebind it under § Plan amendment before review rather than reviewing bytes no state records.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Pipeline mode reports progress or blockers only; standalone review may use its report surface.
