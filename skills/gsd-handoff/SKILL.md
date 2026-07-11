---
name: gsd-handoff
description: Internal GSD sub-skill (routed via /gsd). Writes and resumes immutable runtime handoffs bound to an approved canonical Markdown packet.
triggers: resume/continue (read existing); pause/breakpoint/context-pressure/task completion (write new)
produces: [handoff-<n>.toon]
consumes: [handoff-<n>.toon, proposal.md, spec.md, design.md, plan.md, docs/gsd/<feature>/milestones.toon]
---

# Handoff

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Select the Invocation Mode before validating its Required artifacts. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Pre-plan handoff write | — | Markdown packet | `handoff-<n>.toon` | — |
| Execution handoff write | `plan.md` | Remaining Markdown packet; milestone ledger | `handoff-<n>.toon` | Stop through `/gsd`; never invent execution state |
| Pre-plan resume | `handoff-<n>.toon` | Markdown packet | — | Return once to state detection; preserve explicit intent |
| Execution resume | `handoff-<n>.toon`; `plan.md` | Remaining Markdown packet; milestone ledger | — | Recover only from valid runtime state and binding; packet drift is Spec escalation |

## Write

Write the next positive sequential `.scratch/<feature>/handoff-<n>.toon`; never overwrite or suffix an existing handoff. Store opaque `mode` and `phase`, resolved decisions, unresolved questions, `next_action`, runtime settings, current completed task/evidence when applicable, and the exact approved Markdown source paths plus SHA-256 hashes. A handoff is immutable runtime state, not a source of requirements.

The default handoff is machine-local under git-ignored scratch. Portable handoff retains the existing WIP/base mechanics from [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics; it never modifies the Markdown packet or makes scratch authoritative.

## Resume

Read the highest valid handoff when no path is supplied. Preserve unknown `mode`, `phase`, settings, and runtime rows exactly. Before applying `next_action`, parse the complete live packet and compare every source path, source set, and SHA-256 hash with the binding. Invalid/missing/changed source is a Spec escalation; do not reconstruct an interpretation from dirty files, plan status, or legacy pre-approval TOON.

For a valid execution resume, derive the last completed task and next task from immutable runtime handoff evidence, then continue the exact plan order. Do not mutate a prior attempt, change approved Markdown status, or re-dispatch completed work. Runtime terminal-repair counters retain their existing blocker semantics.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Inline firing appends nothing.
