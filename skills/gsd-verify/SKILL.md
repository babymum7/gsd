---
name: gsd-verify
description: "Use for an explicit diff or PR review, or as the terminal gate for planned and quick-fix GSD work. Standalone review is read-only; planned verification owns acceptance, squash merge, state cleanup, and optional archive."
triggers: explicit diff or PR review; terminal planned gate; quick-fix gate
produces: [docs/gsd/<feature>/milestones.md, docs/gsd/<feature>/archive/plan.md, docs/gsd/<feature>/archive/implementation.md, state.toon]
consumes: [plan.md, state.toon, docs/gsd/<feature>/milestones.md]
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
| Quick-fix WIP gate | `plan.md` | Markdown packet absent by design | `state.toon` | Recover the real quick-fix plan; never fabricate it |

## Planned and milestone WIP gate

At terminal entry, validate canonical `schema:v3`, exact plan hash/binding, base/WIP identity, last green checkpoint, current tree, and required artifacts; rebuild the terminal slice. Changed plan bytes, malformed grammar, feature mismatch, missing artifact, or Git drift is Spec escalation. Repeat the digest guard before squash.

After all tasks and Fast TDD Checks are green, the session owner performs deterministic cumulative conformance before Deferred Slow E2E:

1. Prove every active AC maps exactly once to one completed task and one public interface pin; every changed path is task-owned. Read task diffs in plan order against explicit Decisions, invariants, non-goals, file intents, and focused-check evidence on the unchanged current commit.
2. Only a malformed binding, ownership/coverage mismatch, explicit contract contradiction, unresolved change, or red deterministic check blocks. No free-form critique or model-generated verdict is terminal authority; green is current-commit conformance, never persisted prose authority.
3. A blocker keeps `phase=repair` and `next_action=enter terminal verification/repair`; repair only plan-owned source, run affected Fast TDD Checks, and repeat invalidated proofs. Any source change invalidates prior conformance.
4. Run the complete feature-affected Deferred Slow E2E suite only after current-commit conformance. Failure returns to repair, affected fast checks, invalidated conformance, then the complete slow suite. Merge requires full slow/E2E GREEN on the same unchanged commit.

For squash, scratch disposition, archive, and cleanup use § Git/base/WIP/scratch mechanics and § Feature cleanup. Archive-and-delete materializes the exact approved plan and outcome before conformance so canonical archive destinations are terminal-cleanup-owned lifecycle paths in changed-path proof; every other changed path must be task-owned.

After green merge, atomically write `phase=merged-cleanup-pending`.

For `Milestone WIP gate`, revalidate the selected row is matching and first `pending`; before final conformance change only a non-final row to `done`, while final milestone deletes the ledger. Include the mutation in the same reviewed squash; any changed prefix, other row, append, reorder, or wrong row blocks.
## Standalone review

Standalone review is read-only and has no branch, result, or merge authority. Review supplied diff for intent compliance and code quality. Optional Markdown context informs findings only — not an approval gate.

## Quick-fix WIP gate

Quick fixes have minimal approved `plan.md` but no full feature packet. Run code-quality, focused behavior, whole-branch build where available, and applicable E2E before squash/cleanup sequence.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Pipeline mode reports progress or blockers only; standalone review may use its report surface.
