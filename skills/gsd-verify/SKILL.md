---
name: gsd-verify
description: "Use for an explicit diff or PR review, or as the terminal gate for planned and quick-fix GSD work. Standalone review is read-only; planned verification owns acceptance, squash merge, state cleanup, and optional archive."
triggers: explicit diff or PR review; terminal planned gate; quick-fix gate
produces: [docs/gsd/<feature>/milestones.md, docs/gsd/<feature>/archive/plan.md, docs/gsd/<feature>/archive/implementation.md, state.toon]
consumes: [plan.md, state.toon, docs/domain/index.md, docs/domain/<scope>.md, AGENTS.md, docs/gsd/<feature>/milestones.md]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Do-not-load: invent completion without deterministic gates; per-task terminal verification
- Transition: planned green path performs squash, automatic cleanup, and optional retain/archive

# Verify

> **Invocation guard** — automatic selection loads standalone review; active owners load planned/quick-fix gates. Select an Invocation Mode and validate only its Required state under [REFERENCE.md § Post-approval pipeline contract](../gsd/REFERENCE.md#post-approval-pipeline-contract) and § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Standalone review | — | Markdown packet context | — | — |
| Planned WIP gate | `plan.md`; bound `state.toon` | authorized ledger | `state.toon`; authorized ledger | Stop before review or merge as Spec escalation |
| Milestone WIP gate | Planned state; authoritative ledger | — | `state.toon`; milestone ledger lifecycle state | Missing source/binding is Spec escalation; missing ledger evidence is a Blocker |
| Quick-fix WIP gate | exact Quick-fix `plan.md` | affected domain shards; `AGENTS.md` | `state.toon` | Missing or malformed Quick-fix grammar blocks; recover the real plan and never fabricate it |

## Planned and milestone WIP gate

At terminal entry, validate canonical `schema:v4`, exact plan hash/binding, base/WIP identity, last green checkpoint, current tree, and required artifacts; rebuild the terminal slice including `Domain Impact`. An exact bound pre-Domain-Impact plan is accepted only after its recorded hash matches. Changed plan bytes, malformed new grammar, feature mismatch, missing artifact, or Git drift is Spec escalation. Repeat the digest guard before squash.

At terminal entry and again before squash run `node tools/gsd-contract.mjs validate-plan --path .scratch/<feature>/plan.md --expected-sha256 <state.plan_sha256>`. Exit 0 must report the bound feature and hash before cumulative proof continues; exit 1 blocks as Spec escalation, while exit 2 corrects only the invocation. Never use the unbound form after approval.

After all tasks and Fast TDD Checks are green, the session owner performs deterministic cumulative conformance before Deferred Slow E2E:

1. Prove every active AC maps exactly once to one completed task and one public interface pin; every changed path is task-owned. Read task diffs in plan order against explicit Decisions, invariants, non-goals, file intents, and focused-check evidence on the unchanged current commit.
2. Prove `Domain Impact` against the cumulative diff. `none` requires concrete evidence that no term, invariant, workflow, outcome, relationship, policy, or bounded-context meaning changed. Every non-`none` classification requires exact affected shards and any index/AGENTS upsert to be owned by the same tasks as code. If the index existed, any broad-bootstrap offer or selection is contradictory.
3. Compare affected domain shards with production code, schemas, contracts, and tests. They must describe current production behavior, contain no obsolete or future target state, and leave unrelated contexts untouched. Domain drift blocks completion as a deterministic Blocker.
4. Only a malformed binding, ownership/coverage mismatch, explicit contract contradiction, domain drift, unresolved change, or red deterministic check blocks. No free-form critique or model-generated verdict is terminal authority; green is current-commit conformance, never persisted prose authority.
5. A blocker keeps `phase=repair` and `next_action=enter terminal verification/repair`; repair only plan-owned source, run affected Fast TDD Checks, and repeat invalidated proofs. Any source change invalidates prior conformance.
6. Run the complete feature-affected Deferred Slow E2E suite only after current-commit conformance. Failure returns to repair, affected fast checks, invalidated conformance, then the complete slow suite. Merge requires full slow/E2E GREEN on the same unchanged commit.

For squash, scratch disposition, archive, and cleanup use § Git/base/WIP/scratch mechanics and § Feature cleanup. Archive-and-delete materializes the exact approved plan and outcome before conformance so canonical archive destinations are terminal-cleanup-owned lifecycle paths in changed-path proof; every other changed path must be task-owned.

After green merge, atomically write `phase=merged-cleanup-pending`.

For `Milestone WIP gate`, revalidate the selected row is matching and first `pending`; before final conformance change only a non-final row to `done`, while final milestone deletes the ledger. Include the mutation in the same reviewed squash; any changed prefix, other row, append, reorder, or wrong row blocks.
## Standalone review

Standalone review is read-only and has no branch, result, or merge authority. Review supplied diff for intent compliance and code quality. Optional Markdown context informs findings only — not an approval gate.

## Quick-fix WIP gate

Quick fixes have the exact minimal `plan.md` grammar from `REFERENCE.md`, not a full feature packet. Parse its exact five-field `Domain Impact` before review. `none` requires concrete evidence that no term, invariant, workflow, outcome, relationship, policy, or bounded-context meaning changed. Every non-`none` classification requires each affected shard in the same Quick-fix task as code, and `Broad bootstrap` must always be `not-offered`; a missing index or requested broad bootstrap exits Quick-fix for normal discovery. Compare affected domain prose with production code, schemas, contracts, and tests; missing, obsolete, future, or unrelated prose is domain drift and blocks completion as a deterministic Blocker. Then run code-quality, the recorded focused behavior command, whole-branch build where available, and applicable E2E before the normal squash/cleanup sequence.

Before reviewing a Quick-fix run `node tools/gsd-contract.mjs validate-quick-fix --path .scratch/<feature>/plan.md`. Exit 0 must report `kind: quick-fix` and the matching feature; exit 1 blocks malformed Quick-fix authority, while exit 2 corrects only the invocation.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Pipeline mode reports progress or blockers only; standalone review may use its report surface.
