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

Write atomic `.scratch/<feature>/state.toon` per [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Runtime state contract: same-directory temp, fsync, rename, directory fsync where supported, then validated readback. Approval first writes `phase=approved`. Canonical `schema:v4` gives the session owner only lifecycle, plan/Git binding, green checkpoint, runtime preferences, and revision. Exact active v1, v2, and v3 records migrate atomically after full validation; v1/v2 terminal records fail closed unchanged. The exact v3 `completed-retained` compatibility case remains inert during candidate discovery, while an explicit read validates and migrates it atomically to `schema:v4`.

Exact v1/v2 `completed-retained` records are structurally recognized during candidate discovery only to remain inert and byte-identical; an explicit read rejects them fail closed unchanged. Retained v3 remains the sole terminal record that an explicit validated read migrates.

Active skills are derived from `phase` and `next_action` per [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Skill derivation from phase and next_action. Never serialize a `reload` manifest. Master (`gsd`) is present from bootstrap.

Scratch is machine-local by default. Portable resume follows [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics and never makes scratch authoritative.

## Runtime preferences

Known preference fields on `state.toon` are unique scalars: `autosync` accepts only `none|on|off`; `cleanup_preference` accepts only `none|delete|retain|archive-and-delete`. Omission uses canonical `none` (autosync unset and cleanup defaults to delete after green merge). Ponytail has no runtime mode or persisted field. Reject legacy settings tables. Mandatory domain-modeling output completes before checkpoint; plan outputs are not resumable execution modes. Malformed, duplicate, or invalid known values fail closed.

## Portable and autosync

At the first user-requested pause with a remote and `autosync=none`, ask once: `no`→`off`, `always`→`on`, one-time `yes` leaves `none`. `on` syncs only at user-requested pause/portable handoff or a clean completed-task boundary; dirty and context-pressure checkpoints stay local.

Cross-machine handoff may snapshot only explicitly approved dirty non-scratch paths, then sync committed WIP plus exact feature `plan.md` and `state.toon` to `origin/wip/<feature>`. Never sweep unrelated paths. Without a remote, cross-machine resume is unavailable.

## Resume

Without a supplied path, discover active candidates via [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Candidate discovery; numbered history and result markers have no authority. Load master once, validate state, and execute `next_action` without circular re-entry, capsule execution, or duplicated action. Reject an unknown `phase`; preserve an opaque `next_action` only when structurally valid. Malformed state fails closed; invalid, missing, or changed plan is Spec escalation. Never reconstruct from dirty files, plan status, conversation, or legacy pre-approval TOON.

For every Execution resume, run `node tools/gsd-contract.mjs validate-plan --path .scratch/<feature>/plan.md --expected-sha256 <state.plan_sha256>` after state validation and before deriving the peer owner. Exit 0 must report the same feature and hash; exit 1 is Spec escalation, while exit 2 corrects only the invocation.

A valid Execution resume verifies `schema:v4`, plan hash/path, base/WIP, last green task/commit, and current tree, then rebuilds the active slice including `Domain Impact`. Exact bound pre-Domain-Impact plans are accepted only after their recorded hash matches. Resume validates whether verification must continue before repair, E2E, or merge. These stages add no state keys.

For `Milestone ledger recovery`, use only the ledger selected by automatic active-state detection. Report the first pending milestone slug and goal, then load `gsd-brainstorming` for reconstruction. Do not create scratch, mutate ledger bytes, detail later rows, mark completion, start execution, or authorize merge.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Inline firing appends nothing.
