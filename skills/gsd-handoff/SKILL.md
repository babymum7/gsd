---
name: gsd-handoff
description: "Use when pausing, saving, resuming, or recovering GSD work from a valid state.toon or compaction capsule. Do not invent work when required state is missing or malformed. Loads peer skill named by validated next_action state."
triggers: pause, save, resume, continue, compaction recovery, context pressure, or task-completion checkpoint
produces: [state.toon]
consumes: [state.toon, plan.md, docs/gsd/<feature>/milestones.md]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Do-not-load: invent work from missing/malformed state
- Transition: load peer skill named by validated `next_action`

# Handoff

> **Invocation guard** — automatic selection loads this skill for pause, resume, or recovery intent. Select the Invocation Mode before validating its Required artifacts. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Pre-plan state write | — | Markdown packet | `state.toon` | — |
| Execution state write | `plan.md` | milestone ledger | `state.toon` | Missing or drifted plan is Spec escalation; never invent execution state or a binding |
| Pre-plan resume | `state.toon` | Markdown packet | — | Return once to state detection; preserve explicit intent |
| Execution resume | `state.toon`; `plan.md` | milestone ledger | — | Recover only from valid runtime state and bound plan.md; plan drift is Spec escalation |
| Milestone ledger recovery | authoritative ledger selected by automatic active-state detection | — | — | Missing/malformed/base-mismatched ledger fails closed; never invent work |

## Write

Write atomic `.scratch/<feature>/state.toon` through same-directory temp, fsync, atomic rename, directory fsync where supported, and read-back validation; never leave partial bytes. The approval binding is the first execution checkpoint (`phase=approved`), written after approval and before execution. Canonical `schema:v3` stores only lifecycle, plan binding, Git identity, green checkpoint, preferences, and checkpoint revision; the session owner is the sole authority consuming it. On resume, exact valid active production `schema:v1` and `schema:v2` records are fully validated then atomically rewritten to `schema:v3` with all obsolete model, agent, and review-progress fields discarded; malformed, reordered, unknown, partial, or terminal legacy records fail closed unchanged. Phase-inapplicable values use canonical `none`.

Active skills are derived from `phase` and `next_action` per [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Skill derivation from phase and next_action. Never serialize a `reload` manifest. Master (`gsd`) is present from bootstrap.

The default state file is machine-local under git-ignored scratch. Portable resume retains existing WIP/base mechanics from [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics; it never modifies the Markdown packet or makes scratch authoritative.

## Runtime preferences

Known preference fields on `state.toon` are unique scalars: `autosync` accepts only `none|on|off`; `ponytail_level` accepts only `none|lite|full|ultra`; `cleanup_preference` accepts only `none|delete|retain|archive-and-delete`. Omission uses canonical `none` (autosync unset, Ponytail inactive, cleanup defaults to delete after green merge). Reject legacy settings tables and visual-specific state rows. Inline codebase-design/domain-modeling complete before checkpoint; plan outputs are not resumable execution modes. Malformed, duplicate, or invalid known values fail closed.

## Portable and autosync

At the first user-requested pause with a remote and `autosync` unset (`none`), ask once whether to sync (`yes`/`no`/`always`): `no`→`autosync=off`; `always`→`autosync=on`; one-time `yes` leaves the setting. `autosync=on` syncs only at user-requested pause/portable handoff or after a completed task commit with a clean non-scratch tree. Dirty task boundaries and automatic context-pressure checkpoints stay local.

An explicit cross-machine handoff lists only uncommitted non-scratch paths and asks whether to snapshot those exact paths (`yes` = WIP snapshot commit; `no` = leave local). Sync committed WIP plus the exact feature scratch path (`plan.md`, `state.toon`, promoted prototype refs) to `origin/wip/<feature>`; never sweep unrelated files or make scratch authoritative; `.gsd-lavish/${feature}.feedback.json` is not portable and is never included. With no remote, keep the checkpoint local and report cross-machine resume unavailable.

## Resume

When no path is supplied, discover active candidates via [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Candidate discovery (`plan.md` + valid active `state.toon` only); never treat numbered handoffs, attempts, or result markers as authority. On resume, compaction/generic bootstrap (per [../gsd/REFERENCE.md](../gsd/REFERENCE.md)) loads master once. Ordinary state processing parses and validates `state.toon` and executes `next_action` without circular re-entry, capsule execution, or duplicated action. Reject an unknown `phase`; preserve an opaque `next_action` only when structurally valid. Malformed state fails closed; invalid/missing/changed plan at resume is a Spec escalation. Do not reconstruct an interpretation from legacy handoffs, dirty files, plan status, or pre-approval TOON.

For a valid execution resume, validate `schema:v3`, plan path/hash at the resume boundary, base/WIP identity, last green task/commit, current tree, and every required plan-referenced artifact. Rebuild the complete active task or terminal slice from canonical sources; never derive scope from a report, child memory, or conversational summary. Opaque `next_action` may carry Terminal Visual Review stages (`capture in progress` with next feedback batch sequence, `await terminal repair confirmation`, confirmed cutoff plus digest after `Start fixing`, and current-commit visual acceptance when selected). Resume validates ledger sequence, cutoff/digest, applied cursor, and current commit before repair, acceptance, E2E, or merge; a missing machine-local ledger during a feedback stage fails closed.
Visual, feedback, and capture stages encode only through `phase` plus opaque `next_action` without new `state.toon` keys.

For `Milestone ledger recovery`, use only the ledger selected by automatic active-state detection. Report the first pending milestone slug and goal, then load `gsd-brainstorming` for reconstruction. Do not create scratch, mutate ledger bytes, detail later rows, mark completion, start execution, or authorize merge.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Inline firing appends nothing.
