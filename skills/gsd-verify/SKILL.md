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

After all tasks and Fast TDD Checks are green, the session owner performs deterministic cumulative conformance before Terminal Visual Review or Deferred Slow E2E:

1. Prove every active AC maps exactly once to one completed task and one public interface pin; every changed path is task-owned. Read task diffs in plan order against explicit Decisions, invariants, non-goals, file intents/artifacts, and focused-check evidence on the unchanged current commit.
2. Only a malformed binding, ownership/coverage mismatch, explicit contract contradiction, unresolved change, or red deterministic check blocks. No free-form critique or model-generated verdict is terminal authority; green is current-commit conformance, never persisted prose authority.
3. A blocker keeps `phase=repair` and `next_action=enter terminal verification/repair`; repair only plan-owned source, run affected Fast TDD Checks, and repeat invalidated proofs. Any source change invalidates prior conformance and selected visual acceptance.
4. After current-commit conformance, offer Terminal Visual Review when eligible. UI/UX plans always receive `Continue to Deferred Slow E2E` and `Visualize completed work with Lavish`; eligible substantial non-UI work receives the same surface. Ineligible work proceeds without a prompt. Continue does not launch Lavish; Visualize loads `gsd-lavish` with actual completed implementation evidence. Unavailable Lavish degrades to equivalent terminal inspection.
5. Terminal Visual Review is capture-only. Keep the main session responsive; direct main-session instructions remain available, while source changes clear both conformance and acceptance. Checkpoint `capture in progress` with sequence, launch commit, and artifact digest before invoking each destructive `lavish-axi poll` or fallback drain. Queue async results to a safe boundary, reconcile stale revisions, record/read back the ledger, clear the marker, and acknowledge feedback as recorded but not applied. Capture never edits tracked source, begins repair, runs Fast TDD, repeats conformance, or starts Deferred Slow E2E.
6. When the browser session ends with pending feedback, summarize it, checkpoint `await terminal repair confirmation`, and present only `Start fixing`/`Continue feedback`; no acceptance and no repair before `Start fixing`. Continue feedback reopens collection. After `Start fixing`, bind the pending cutoff and digest in opaque `next_action`; the session owner repairs only that frozen confirmed in-scope feedback set. Reject feedback that changes scope, acceptance, interface, invariant, or design as Spec escalation; rerun affected fast checks, conformance, and visual evidence.
7. With zero pending feedback and current-commit conformance, present only `Accept visual result`/`Continue feedback`; no `Start fixing`. Explicit acceptance binds current-commit visual acceptance. New feedback clears acceptance; source changes clear both conformance and acceptance.
8. Run the complete feature-affected Deferred Slow E2E suite only after current-commit conformance, zero pending feedback, and explicit visual acceptance when selected. Failure returns to repair, affected fast checks, invalidated conformance/visual acceptance, then the complete slow suite. Merge requires full slow/E2E GREEN on the same unchanged commit.

For squash, scratch disposition, archive, and cleanup use § Git/base/WIP/scratch mechanics and § Feature cleanup. Archive-and-delete materializes the exact approved plan and outcome before conformance so canonical archive destinations are terminal-cleanup-owned lifecycle paths in changed-path proof; every other changed path must be task-owned.

After green merge, atomically write `phase=merged-cleanup-pending`; final cleanup removes only regular direct-child files whose basenames start with exact `${feature}.` inside `.gsd-lavish/`. Use `lstat`; never follow symlinks or touch another prefix. A matching symlink/non-regular entry fails closed.

For `Milestone WIP gate`, revalidate the selected row is matching and first `pending`; before final conformance change only a non-final row to `done`, while final milestone deletes the ledger. Include the mutation in the same reviewed squash; any changed prefix, other row, append, reorder, or wrong row blocks.
## Standalone review

Standalone review is read-only and has no branch, result, or merge authority. Review supplied diff for intent compliance and code quality. Optional Markdown context informs findings only — not an approval gate.

## Quick-fix WIP gate

Quick fixes have minimal approved `plan.md` but no full feature packet. Run code-quality, focused behavior, whole-branch build where available, and applicable E2E before squash/cleanup sequence.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Pipeline mode reports progress or blockers only; standalone review may use its report surface.
