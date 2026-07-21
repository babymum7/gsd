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
- Do-not-load: invent completion without gates; per-task `gsdReviewer`
- Transition: planned green path performs squash, automatic cleanup, and optional retain/archive

# Verify

> **Invocation guard** — automatic selection loads standalone review; the active executor loads planned and quick-fix gates. Choose the Invocation Mode from intent and context, then validate only its Required state. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Standalone review | — | Markdown packet context | — | — |
| Planned WIP gate | `plan.md`; bound `state.toon` | authorized ledger | `state.toon`; authorized ledger | Stop before review or merge as Spec escalation |
| Milestone WIP gate | Planned state; authoritative ledger | — | `state.toon`; milestone ledger lifecycle state | Missing source/binding is Spec escalation; missing ledger evidence is a Blocker |
| Quick-fix WIP gate | `plan.md` | Markdown packet absent by design | `state.toon` | Recover the real quick-fix plan; never fabricate it |

## Planned and milestone WIP gate

At terminal verification entry, full-validate once at entry by parsing the canonical `plan.md` and verifying its SHA-256 hash. Any changed source, malformed grammar, mismatched feature, missing interface pin, or plan coverage drift is a Spec escalation. No legacy pre-approval TOON can restore or define the contract. Instead of repeated full validation, use a single lightweight pre-squash digest guard comparison immediately before squash.

Terminal cadence after all tasks and Fast TDD Checks are green:
1. Run the complete feature-affected slow suite (Deferred Slow E2E) only after all tasks and fast checks pass. There is no terminal pre-E2E visual pause.
2. Begin whole-diff review only after the complete feature-affected slow suite is green. The parent dispatches the persistent gsd-reviewer agent (reusing the same gsd-reviewer session with the bound reviewer model from `modelRoles.gsdReviewer`). If the independent reviewer capability or model configuration is unavailable, GSD must fail closed immediately.
3. Red gates/findings: source-first repair, smallest affected fast/slow subset, complete feature-affected slow suite, whole-diff re-review; repeat with progress guard. Terminal completion requires both the complete feature-affected slow suite and `gsdReviewer` whole-diff verdict to be green on final bytes.

If needed for blocking findings or red suite/acceptance/E2E gates, the parent updates `state.toon` for the `terminal repair` transition with `next_action` set to `enter terminal verification/repair` and persists last-completed review-progress evidence (`review_round`, `blocking_fingerprint`, `reviewed_commit`, `progress_status`) before directing the persistent gsd-executor agent to perform the repair. Live agent identities are process-local. Progress compares the current completed fingerprint to the last completed comparison and stops on a repeated blocking fingerprint or no relevant repair diff; terminal repair continues without a fixed round count only while findings or the relevant diff demonstrably change; stop on a repeated blocking fingerprint or no relevant repair diff.

A planned pass uses the existing Git/base/WIP/scratch contract in [../gsd/REFERENCE.md](../gsd/REFERENCE.md) to squash merge to `<base>`, clean remote/local WIP, and update `state.toon`. Before final terminal review/squash, honor an explicit `cleanup_preference` of retain or archive-and-delete when already selected; otherwise default to delete after green merge. There is no mandatory terminal cleanup prompt. When archive-and-delete is selected, copy the exact approved `.scratch/<feature>/plan.md` to `docs/gsd/<feature>/archive/plan.md` and write `docs/gsd/<feature>/archive/implementation.md` with the feature outcome, changed paths, acceptance outcomes, and verification evidence; materialize those files before review so they land in the same green one-feature/one-squash commit, then delete `.scratch/<feature>/` after publication; never create a post-squash documentation-only commit. After a green merge, write `phase=merged-cleanup-pending` and automatically remove scratch unless retain was selected (`phase=completed-retained`, `next_action=none`). Post-merge `merged-cleanup-pending` recovery resumes only the existing delete-or-retain decision; the pre-squash archive opportunity is not reopened after merge. Archive files are non-authoritative historical reference only; never copy handoffs, attempts, or result markers; fail closed without overwrite on collision.
Final green cleanup keeps `.gsd-lavish/` and removes only direct-child regular files whose basenames start with the exact feature-derived `${feature}.` prefix. Missing `.gsd-lavish/` or no matching files is a no-op. Inspect the root and each match with `lstat`, require the root to resolve exactly under the project and every match to remain a regular direct child, and never follow symlinks; a matching symlink or non-regular entry fails closed and remains untouched. Never delete `.gsd-lavish/` itself, another feature's prefix, or unrelated feature or non-feature artifacts.

For a `Milestone WIP gate`, first prove that the executor-selected row still matches the approved milestone and is the first `pending` row. Before final diff review, apply the exact lifecycle transition from [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Milestone Ledger completion contract: non-final milestone → change only that row to `done`; final milestone → delete the ledger. Review that mutation with the complete WIP diff. A changed prefix, another changed row, an append, a reorder, or the wrong active row is a Blocker. The transition lands only with the same green squash commit; a red gate never changes base ledger state. Do not ask to merge or offer a Lavish visual review after approval; Critical/Important findings and red gates block merge.

## Standalone review

Standalone review is read-only and has no branch, result, or merge authority. Review the supplied diff for stated-intent compliance and code quality. Optional Markdown context informs findings only; it is not an approval gate.

## Quick-fix WIP gate

Quick fixes have their minimal approved `plan.md` but no full feature packet. Run code-quality, focused behavior, whole-branch build where available, and applicable E2E before the same squash/cleanup sequence. Do not invent spec compliance.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Pipeline mode reports progress or blockers only; standalone review may use its report surface.
