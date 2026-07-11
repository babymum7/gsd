---
name: gsd-handoff
description: Internal GSD sub-skill (routed via /gsd). Writes and resumes immutable runtime handoffs bound to an approved canonical Markdown packet.
triggers: resume/continue (read existing); pause/breakpoint/context-pressure/task completion (write new)
produces: [handoff-<n>.toon]
consumes: [handoff-<n>.toon, proposal.md, spec.md, design.md, plan.md, docs/gsd/<feature>/milestones.md]
---

# Handoff

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Select the Invocation Mode before validating its Required artifacts. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Pre-plan handoff write | — | Markdown packet | `handoff-<n>.toon` | — |
| Execution handoff write | `proposal.md`; `spec.md`; `plan.md` | `design.md`; milestone ledger | `handoff-<n>.toon` | Missing or drifted packet is Spec escalation; never invent execution state or a binding |
| Pre-plan resume | `handoff-<n>.toon` | Markdown packet | — | Return once to state detection; preserve explicit intent |
| Execution resume | `handoff-<n>.toon`; `proposal.md`; `spec.md`; `plan.md` | `design.md`; milestone ledger | — | Recover only from valid runtime state and the complete bound packet; packet drift is Spec escalation |
| Milestone ledger recovery | authoritative ledger selected by `/gsd` state detection | — | — | Missing/malformed/base-mismatched ledger fails closed; never invent work |

## Write

Write the next positive sequential `.scratch/<feature>/handoff-<n>.toon`; never overwrite or suffix an existing handoff. The approval binding is the first execution handoff (`handoff-1.toon` when none exists), written immediately after approval and before dispatch. Store opaque `mode` and `phase`, resolved decisions, unresolved questions, `next_action`, runtime settings, current completed task/evidence when applicable, and—after approval—the exact approved Markdown source paths plus SHA-256 hashes. Pre-plan handoffs omit an approval binding rather than fabricating one. A handoff is immutable runtime state, not a source of requirements.

The default handoff is machine-local under git-ignored scratch. Portable handoff retains the existing WIP/base mechanics from [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics; it never modifies the Markdown packet or makes scratch authoritative.

## Runtime settings

Serialize settings as `settings[N]{key,value}` rows. Known keys are unique: `autosync` accepts only `on|off`, and `ponytail_level` accepts only `lite|full|ultra`. Omission means autosync is unset or Ponytail is inactive. Preserve an unknown well-formed key/value row verbatim for forward compatibility. A malformed row, duplicate key, or invalid known value makes the handoff invalid and fails closed; never silently reset, choose one duplicate, or reinterpret a value.

## Portable and autosync

At the first user-requested pause with a remote and `autosync` unset, ask once whether to sync (`yes`/`no`/`always`): `no` persists `autosync,off`; `always` persists `autosync,on`; a one-time `yes` does not change the setting. `autosync,on` syncs only at a user-requested pause/portable handoff or after a completed task commit with a clean non-scratch tree. A dirty task boundary or automatic context-pressure handoff stays machine-local.

An explicit cross-machine handoff lists only uncommitted non-scratch paths and asks whether to snapshot those exact paths. `yes` creates the WIP snapshot commit; `no` leaves them local. Sync committed WIP state plus the exact scratch feature path to `origin/wip/<feature>`; never sweep unrelated files or make scratch authoritative. A non-portable pause never asks to snapshot dirty paths. With no remote, keep the handoff local and report that cross-machine resume is unavailable.

## Resume

When no path is supplied, select the highest-numbered handoff first and validate that exact file; never search backward for an older valid handoff. Preserve unknown `mode`, `phase`, settings, and runtime rows exactly. Before applying `next_action`, parse the complete live packet and compare every source path, source set, and SHA-256 hash with the selected binding. Malformed handoff state fails closed; invalid/missing/changed source is a Spec escalation. Do not reconstruct an interpretation from an older handoff, dirty files, plan status, or legacy pre-approval TOON.

Validate runtime settings before applying them. Unknown well-formed rows remain opaque; malformed, duplicate, or conflicting rows block resume.

For a valid execution resume, derive the last completed task and next task from immutable runtime handoff evidence, then continue the exact plan order. Do not mutate a prior attempt, change approved Markdown status, or re-dispatch completed work. Runtime terminal-repair counters retain their existing blocker semantics.

For `Milestone ledger recovery`, use only the ledger selected under `/gsd` Route 1 rules. Report the first pending milestone slug and goal, then return to Discussion/reconstruction. Do not create scratch state, mutate ledger bytes, detail later rows, mark completion, start execution, or authorize a merge.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Inline firing appends nothing.
