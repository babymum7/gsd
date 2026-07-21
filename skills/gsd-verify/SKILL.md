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
1. Begin one cumulative whole-diff review after all tasks and fast checks are green and before any Terminal Visual Review or the complete feature-affected slow/E2E suite. The parent builds one reporting-only coverage manifest from the immutable plan, runtime checkpoint, and Git: ordered task-to-commit mapping, owned paths, active ACs, interface pins, invariants, non-goals, and focused-check evidence. The parent dispatches the persistent gsd-reviewer agent (reusing the same gsd-reviewer session with the bound reviewer model from `modelRoles.gsdReviewer`) against the cumulative `base...HEAD` diff with that manifest. The reviewer does not require prior slow-suite evidence. If the independent reviewer capability or model configuration is unavailable, GSD must fail closed immediately.
2. Parent-mediated repair loop: the read-only reviewer returns all structured findings to the parent in one batch; the parent alone updates state and directs the persistent gsd-executor agent to perform source-first repair with deterministic local fast checks (including fast acceptance/contract checks). Repeat whole-diff re-review until reviewer PASS on commit C, using the progress guard.
3. After reviewer PASS on commit C, offer Terminal Visual Review when eligible: UI/UX plans always receive a terminal surface with `Continue to Deferred Slow E2E` and `Visualize completed work with Lavish`; other work receives the same surface only when a substantial completed deliverable passes the Lavish Fire gate; ineligible work proceeds without a visual prompt. Selecting Continue to Deferred Slow E2E does not launch Lavish and proceeds to E2E without another merge confirmation. Selecting Visualize completed work with Lavish loads `gsd-lavish` for actual completed implementation evidence (relevant routes, loading, empty, error, disabled, focus, interaction, and responsive states where applicable). Planning prototypes never satisfy this gate. Unavailable Lavish degrades to equivalent terminal review without blocking the deliverable.
4. When Terminal Visual Review is selected, in-scope annotations return through the parent to the persistent gsd-executor for source repair, affected Fast TDD Checks, cumulative re-review to reviewer PASS, and a refreshed visualization before explicit visual acceptance. Feedback that changes approved scope, acceptance criteria, interfaces, or invariants is Spec escalation (`Discussion/Spec-escalation`). Deferred Slow E2E starts only after explicit visual acceptance when visualization was selected, or after Continue/no-offer resolution otherwise. Canonical `phase` and opaque `next_action` resume the exact terminal visual, repair, or Deferred Slow E2E step without new `state.toon` keys.
5. Run the complete feature-affected slow suite (Deferred Slow E2E) only after reviewer PASS on commit C and resolution of any offered/selected terminal visual flow. Reviewer and E2E never run concurrently.
6. E2E-failure repair: the parent forwards E2E failure evidence to the executor; the executor repairs source and reruns affected fast checks. Any changed bytes invalidate prior reviewer PASS and any selected visual acceptance and require affected fast checks, whole-diff re-review with reviewer PASS, and refreshed visual acceptance when visualization remains selected before the full slow/E2E suite reruns. Do not run reviewer and E2E in parallel.
7. Red gates/findings: source-first repair, smallest affected fast/slow subset, whole-diff re-review, optional refreshed Terminal Visual Review when selected, then complete feature-affected slow/E2E only after reviewer PASS and resolved visual choice/acceptance when applicable; repeat with progress guard. Terminal completion requires both the complete feature-affected slow suite and `gsdReviewer` whole-diff verdict to be green on final bytes, plus resolved visual acceptance when selected. Merge requires reviewer PASS and complete slow/E2E GREEN on the same unchanged commit; when Terminal Visual Review was selected, merge also requires selected visual acceptance on that same unchanged commit.

If needed for blocking findings or red suite/acceptance/E2E gates, the parent updates `state.toon` for the `terminal repair` transition with `next_action` set to `enter terminal verification/repair` and persists last-completed review-progress evidence (`review_round`, `blocking_fingerprint`, `reviewed_commit`, `progress_status`) before directing the persistent gsd-executor agent to perform the repair. Live agent identities are process-local. Progress compares the current completed fingerprint to the last completed comparison and stops on a repeated blocking fingerprint or no relevant repair diff; terminal repair continues without a fixed round count only while findings or the relevant diff demonstrably change; stop on a repeated blocking fingerprint or no relevant repair diff.

A planned pass uses the existing Git/base/WIP/scratch contract in [../gsd/REFERENCE.md](../gsd/REFERENCE.md) to squash merge to `<base>`, clean remote/local WIP, and update `state.toon`. Before final terminal review/squash, honor an explicit `cleanup_preference` of retain or archive-and-delete when already selected; otherwise default to delete after green merge. There is no mandatory terminal cleanup prompt. When archive-and-delete is selected, copy the exact approved `.scratch/<feature>/plan.md` to `docs/gsd/<feature>/archive/plan.md` and write `docs/gsd/<feature>/archive/implementation.md` with the feature outcome, changed paths, acceptance outcomes, and verification evidence; materialize those files before review so they land in the same green one-feature/one-squash commit, then delete `.scratch/<feature>/` after publication; never create a post-squash documentation-only commit. After a green merge, write `phase=merged-cleanup-pending` and automatically remove scratch unless retain was selected (`phase=completed-retained`, `next_action=none`). Post-merge `merged-cleanup-pending` recovery resumes only the existing delete-or-retain decision; the pre-squash archive opportunity is not reopened after merge. Archive files are non-authoritative historical reference only; never copy handoffs, attempts, or result markers; fail closed without overwrite on collision.
Final green cleanup keeps `.gsd-lavish/` and removes only direct-child regular files whose basenames start with the exact feature-derived `${feature}.` prefix. Missing `.gsd-lavish/` or no matching files is a no-op. Inspect the root and each match with `lstat`, require the root to resolve exactly under the project and every match to remain a regular direct child, and never follow symlinks; a matching symlink or non-regular entry fails closed and remains untouched. Never delete `.gsd-lavish/` itself, another feature's prefix, or unrelated feature or non-feature artifacts.

For a `Milestone WIP gate`, first prove that the executor-selected row still matches the approved milestone and is the first `pending` row. Before final diff review, apply the exact lifecycle transition from [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Milestone Ledger completion contract: non-final milestone → change only that row to `done`; final milestone → delete the ledger. Review that mutation with the complete WIP diff. A changed prefix, another changed row, an append, a reorder, or the wrong active row is a Blocker. The transition lands only with the same green squash commit; a red gate never changes base ledger state. Do not ask to merge; do not offer a planning-prototype Lavish session after approval. Terminal Visual Review remains the only post-PASS pre-E2E visual surface when eligible. Critical/Important findings and red gates block merge.

## Standalone review

Standalone review is read-only and has no branch, result, or merge authority. Review the supplied diff for stated-intent compliance and code quality. Optional Markdown context informs findings only; it is not an approval gate.

## Quick-fix WIP gate

Quick fixes have their minimal approved `plan.md` but no full feature packet. Run code-quality, focused behavior, whole-branch build where available, and applicable E2E before the same squash/cleanup sequence. Do not invent spec compliance.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Pipeline mode reports progress or blockers only; standalone review may use its report surface.
