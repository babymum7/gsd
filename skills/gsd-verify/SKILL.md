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

> **Invocation guard** — automatic selection loads standalone review; the active session owner loads planned and quick-fix gates. Choose the Invocation Mode from intent and context, then validate only its Required state. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Standalone review | — | Markdown packet context | — | — |
| Planned WIP gate | `plan.md`; bound `state.toon` | authorized ledger | `state.toon`; authorized ledger | Stop before review or merge as Spec escalation |
| Milestone WIP gate | Planned state; authoritative ledger | — | `state.toon`; milestone ledger lifecycle state | Missing source/binding is Spec escalation; missing ledger evidence is a Blocker |
| Quick-fix WIP gate | `plan.md` | Markdown packet absent by design | `state.toon` | Recover the real quick-fix plan; never fabricate it |

## Planned and milestone WIP gate

At terminal entry, validate canonical `schema:v3`, `plan.md`, the exact plan hash and state binding, base/WIP identity, last green task/commit, current tree, and required plan-referenced artifacts. Rebuild the terminal slice from those sources. Changed plan bytes, malformed grammar, mismatched feature, missing artifact, or Git drift is Spec escalation. Repeat the digest guard before squash.

After all tasks and Fast TDD Checks are green, the session owner performs deterministic cumulative conformance before Terminal Visual Review or Deferred Slow E2E:

1. Prove every active AC maps exactly once to one completed task and one public interface pin. Prove every changed path is task-owned. Read task diffs in plan order and compare them with explicit Decisions, invariants, non-goals, file operations/intents, artifact fidelity requirements, and focused-check evidence on the unchanged current commit.
2. Only a malformed binding, ownership/coverage mismatch, explicit contract contradiction, unresolved change, or red deterministic check blocks. No free-form critique or model-generated verdict is terminal authority. A green result is current-commit session-owner conformance, not a persisted identity or prose pass.
3. For a blocker, atomically keep `phase=repair` and `next_action=enter terminal verification/repair`; repair the smallest plan-owned source set inline, run affected Fast TDD Checks, then repeat every invalidated conformance proof. Any source change invalidates prior conformance and selected visual acceptance.
4. After current-commit conformance, offer Terminal Visual Review when eligible. UI/UX plans always receive `Continue to Deferred Slow E2E` and `Visualize completed work with Lavish`; other work receives the same surface only when a substantial completed deliverable passes the Lavish Fire gate. Ineligible work proceeds without a prompt. Continue does not launch Lavish. Visualize loads `gsd-lavish` with actual completed implementation evidence; planning prototypes never satisfy this gate. Unavailable Lavish degrades to equivalent terminal inspection.
5. Terminal Visual Review is capture-only. Checkpoint `capture in progress` with the intended next batch sequence in opaque `next_action` before invoking each destructive `lavish-axi poll`. After success, apply the canonical ledger schema and atomic-write/readback sequence in [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Post-approval pipeline contract, then clear the marker, acknowledge recorded but not applied, checkpoint the next sequence, and poll again. Capture never edits tracked source, begins repair, runs Fast TDD, repeats conformance, or starts Deferred Slow E2E.
6. When the browser session ends with pending feedback, stop polling, summarize the pending ledger/set, checkpoint `await terminal repair confirmation`, and present only `Start fixing`/`Continue feedback`; no acceptance and no repair before `Start fixing`. Continue feedback reopens collection. After `Start fixing`, bind the pending cutoff and digest in opaque `next_action`; the session owner repairs only that frozen confirmed in-scope feedback set. Reject feedback that changes scope, acceptance, interface, invariant, or design as Spec escalation. Run affected fast checks, repeat conformance on changed bytes, and refresh visual evidence.
7. With zero pending feedback and current-commit conformance, present only `Accept visual result`/`Continue feedback`; no `Start fixing`. Explicit acceptance checkpoints current-commit visual acceptance. New feedback clears acceptance and re-enters capture; source changes clear both conformance and acceptance.
8. Run the complete feature-affected Deferred Slow E2E suite only after current-commit conformance, zero pending feedback, and explicit visual acceptance when visualization was selected. On failure, repair inline, rerun affected fast checks, repeat invalidated conformance and visual acceptance, then rerun the complete slow suite. Terminal completion and merge require conformance, applicable visual acceptance, and full slow/E2E GREEN on the same unchanged commit.

A planned green path uses [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics to squash onto `<base>` and clean WIP refs. Before conformance/squash, honor explicit `cleanup_preference` retain or archive-and-delete; otherwise delete scratch after green merge. For archive-and-delete, materialize exact approved `plan.md` plus implementation outcome, changed paths, acceptance outcomes, and verification evidence before conformance so they land in the same one-feature/one-squash commit. Those canonical archive destinations are terminal-cleanup-owned lifecycle paths included in changed-path ownership proof; every other changed path must be task-owned. Archive files are reference-only.

After the green merge, atomically write `phase=merged-cleanup-pending` before cleanup. Final cleanup keeps `.gsd-lavish/` and removes only regular direct-child files whose basenames start with exact `${feature}.`, including `${feature}.feedback.json`. Resolve and inspect with `lstat`; never follow symlinks or touch another prefix. A matching symlink or non-regular entry fails closed unchanged.

For `Milestone WIP gate`, prove the session-owner-selected row still matches the approved milestone and is first `pending`. Before final conformance, apply the canonical transition: non-final milestone changes only that row to `done`; final milestone deletes the ledger. Include the mutation in cumulative conformance and the same green squash. A changed prefix, other row, append, reorder, or wrong row blocks without changing base.

## Standalone review

Standalone review is read-only and has no branch, result, or merge authority. Review supplied diff for intent compliance and code quality. Optional Markdown context informs findings only — not an approval gate.

## Quick-fix WIP gate

Quick fixes have minimal approved `plan.md` but no full feature packet. Run code-quality, focused behavior, whole-branch build where available, and applicable E2E before squash/cleanup sequence.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Pipeline mode reports progress or blockers only; standalone review may use its report surface.
