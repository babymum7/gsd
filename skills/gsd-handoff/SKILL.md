---
name: gsd-handoff
description: "Use when pausing, saving, resuming, or recovering GSD work from a valid state.toon or compaction capsule. Do not invent work when required state is missing or malformed. Loads the peer skill named by validated next_action state."
triggers: pause, save, resume, continue, compaction recovery, context pressure, or task-completion checkpoint
produces: [state.toon]
consumes: [state.toon, plan.md, docs/gsd/<feature>/milestones.md]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Do-not-load: invent work from missing/malformed state
- Transition: load the peer skill named by validated `next_action`

# Handoff

> **Invocation guard** — automatic selection loads this skill for pause, resume, or recovery intent. Select the Invocation Mode before validating its Required artifacts. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Pre-plan state write | — | Markdown packet | `state.toon` | — |
| Execution state write | `plan.md` | milestone ledger | `state.toon` | Missing or drifted plan is Spec escalation; never invent execution state or a binding |
| Pre-plan resume | `state.toon` | Markdown packet | — | Return once to state detection; preserve explicit intent |
| Execution resume | `state.toon`; `plan.md` | milestone ledger | — | Recover only from valid runtime state and the bound plan.md; plan drift is Spec escalation |
| Milestone ledger recovery | authoritative ledger selected by automatic active-state detection | — | — | Missing/malformed/base-mismatched ledger fails closed; never invent work |

## Write

Write atomic `.scratch/<feature>/state.toon` through same-directory temp, fsync, atomic rename, directory fsync where supported, and read-back validation; never leave partial bytes. The approval binding is the first execution checkpoint (`phase=approved`), written immediately after approval and before dispatch. Every executable state explicitly requires and validates concrete, distinct executor and reviewer model selectors (`executor_model` and `reviewer_model`). Persist only model selectors; do not persist live agent identities or generation counters. Sentinel model selectors (`none`, `unassigned`, `pending`) are strictly rejected after approval. Phase-inapplicable fields use canonical `none`. Reject every legacy key and every numbered handoff, task-attempt, result-marker, or reload-manifest authority path.

Active skills are derived from `phase` and `next_action` per [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Skill derivation from phase and next_action. Never serialize a `reload` manifest. Master (`gsd`) is always present from bootstrap.

The default state file is machine-local under git-ignored scratch. Portable resume retains the existing WIP/base mechanics from [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics; it never modifies the Markdown packet or makes scratch authoritative.

## Runtime preferences

Known preference fields on `state.toon` are unique scalars: `executor_model` and `reviewer_model` must specify concrete, distinct, available configured OMP model selectors after approval; `autosync` accepts only `none|on|off`; `ponytail_level` accepts only `none|lite|full|ultra`; `cleanup_preference` accepts only `none|delete|retain|archive-and-delete`. Omission uses canonical `none` (autosync unset, ponytail inactive, cleanup defaults to delete after green merge). Reject `manual_ui_review` and every other legacy settings table. `design_state` and `domain_state` are deleted as persisted rows. Inline codebase-design/domain-modeling complete before checkpoint; outputs already in plan are not resumable execution modes. Malformed, duplicate, or invalid known values fail closed.

## Portable and autosync

At the first user-requested pause with a remote and `autosync` unset (`none`), ask once whether to sync (`yes`/`no`/`always`): `no` persists `autosync=off`; `always` persists `autosync=on`; a one-time `yes` does not change the setting. `autosync=on` syncs only at a user-requested pause/portable handoff or after a completed task commit with a clean non-scratch tree. A dirty task boundary or automatic context-pressure checkpoint stays machine-local.

An explicit cross-machine handoff lists only uncommitted non-scratch paths and asks whether to snapshot those exact paths. `yes` creates the WIP snapshot commit; `no` leaves them local. Sync committed WIP state plus the exact scratch feature path (`plan.md`, `state.toon`, promoted prototype references) to `origin/wip/<feature>`; never sweep unrelated files or make scratch authoritative. A non-portable pause never asks to snapshot dirty paths. With no remote, keep the checkpoint local and report that cross-machine resume is unavailable. A resumed process recreates agents from bound model selectors.

## Resume

When no path is supplied, discover active candidates via [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Candidate discovery (`plan.md` + valid active `state.toon` only); never treat numbered handoffs, attempts, or result markers as authority. On resume, the compaction/generic bootstrap (validated and rendered per the generic renderer protocol defined in [../gsd/REFERENCE.md](../gsd/REFERENCE.md)) loads the master once. Ordinary state processing parses and validates `state.toon` and executes `next_action` without circular re-entry, capsule execution, or duplicated action. Preserve unknown opaque `phase`/`next_action` values exactly when structurally valid. Malformed state fails closed; invalid/missing/changed plan at resume is a Spec escalation. Do not reconstruct an interpretation from legacy handoffs, dirty files, plan status, or pre-approval TOON.

For a valid execution resume, validate concrete distinct executor and reviewer model selectors, compare plan path/hash only at resume/terminal/pre-squash boundaries, and load skills derived from `phase`/`next_action`. Reject sentinel models. Reject legacy agent identity/generation fields. Progress/fingerprint evidence for repair rounds lives in `review_round`, `blocking_fingerprint`, `reviewed_commit`, and `progress_status` as last-completed comparison only.

For `Milestone ledger recovery`, use only the ledger selected by automatic active-state detection. Report the first pending milestone slug and goal, then load `gsd-brainstorming` for reconstruction. Do not create scratch state, mutate ledger bytes, detail later rows, mark completion, start execution, or authorize a merge.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Inline firing appends nothing.
