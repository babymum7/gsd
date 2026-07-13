---
name: gsd-handoff
description: Internal GSD sub-skill (routed via /gsd). Writes and resumes immutable runtime handoffs bound to an approved canonical Markdown packet.
triggers: resume/continue (read existing); pause/breakpoint/context-pressure/task completion (write new)
produces: [handoff-<n>.toon]
consumes: [handoff-<n>.toon, plan.md, docs/gsd/<feature>/milestones.md]
---

# Handoff

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Select the Invocation Mode before validating its Required artifacts. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Pre-plan handoff write | — | Markdown packet | `handoff-<n>.toon` | — |
| Execution handoff write | `plan.md` | milestone ledger | `handoff-<n>.toon` | Missing or drifted plan is Spec escalation; never invent execution state or a binding |
| Pre-plan resume | `handoff-<n>.toon` | Markdown packet | — | Return once to state detection; preserve explicit intent |
| Execution resume | `handoff-<n>.toon`; `plan.md` | milestone ledger | — | Recover only from valid runtime state and the bound plan.md; plan drift is Spec escalation |
| Milestone ledger recovery | authoritative ledger selected by `/gsd` state detection | — | — | Missing/malformed/base-mismatched ledger fails closed; never invent work |

## Write

Write the next positive sequential `.scratch/<feature>/handoff-<n>.toon`; never overwrite or suffix an existing handoff. The approval binding is the first execution handoff (`handoff-1.toon` when none exists), written immediately after approval and before dispatch. Store opaque `mode` and `phase`, resolved decisions, unresolved questions, `next_action`, runtime settings, current completed task/evidence when applicable, and—after approval—the exact approved `plan.md` path plus SHA-256 hash. Pre-plan handoffs omit an approval binding rather than fabricating one. A handoff is immutable runtime state, not a source of requirements.

Every execution handoff write requires exact manifest coverage for the `next_action` being transitioned to. Serialize the reload manifest as `reload[N]{skill,path}` rows, where `N` is exactly equal to the following row count in the manifest table. The manifest must specify exactly the active subskills required for the `next_action`. Master (`gsd`) must never be written to or duplicated in the `reload` manifest. The byte parser requires the exact ordered schema `reload[N]{skill,path}` with a canonical numeric count and exact row arity, and rejects extra, reordered, or unknown columns before decoded validation.

The default handoff is machine-local under git-ignored scratch. Portable handoff retains the existing WIP/base mechanics from [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics; it never modifies the Markdown packet or makes scratch authoritative.

## Runtime settings

Require exact `settings[N]{key,value}` presence for executable handoffs, including canonical `settings[0]{key,value}:`; reject missing, scalarized, duplicated, malformed, or count-mismatched settings tables. Known keys are unique: `autosync` accepts only `on|off`, and `ponytail_level` accepts only `lite|full|ultra`. `design_state` and `domain_state` are deleted as persisted conditional rows and reload inputs. Omission means autosync is unset, and ponytail is inactive. Inline codebase-design/domain-modeling complete before handoff and their authoritative outputs are already in plan/attempt; they are not resumable execution modes. At every execution-handoff write, derive their conditional reload entries directly from the currently loaded active subskill/action context; the reload table itself persists them. Ponytail remains settings-derived. Add active/inactive design/domain writer cases without inventing set/clear rows. Preserve an unknown well-formed key/value row verbatim for forward compatibility (unknown settings remain opaque). A malformed row, duplicate key, or invalid known value makes the handoff invalid and fails closed; never silently reset, choose one duplicate, or reinterpret a value. The byte parser requires the exact ordered schema `settings[N]{key,value}` with a canonical numeric count and exact row arity, and rejects extra, reordered, or unknown columns before decoded validation.

## Portable and autosync

At the first user-requested pause with a remote and `autosync` unset, ask once whether to sync (`yes`/`no`/`always`): `no` persists `autosync,off`; `always` persists `autosync,on`; a one-time `yes` does not change the setting. `autosync,on` syncs only at a user-requested pause/portable handoff or after a completed task commit with a clean non-scratch tree. A dirty task boundary or automatic context-pressure handoff stays machine-local.

An explicit cross-machine handoff lists only uncommitted non-scratch paths and asks whether to snapshot those exact paths. `yes` creates the WIP snapshot commit; `no` leaves them local. Sync committed WIP state plus the exact scratch feature path to `origin/wip/<feature>`; never sweep unrelated files or make scratch authoritative. A non-portable pause never asks to snapshot dirty paths. With no remote, keep the handoff local and report that cross-machine resume is unavailable.

## Resume

When no path is supplied, select the highest-numbered handoff first and validate that exact file; never search backward for an older valid handoff. On resume, the compaction/generic bootstrap (validated and rendered per the generic renderer protocol defined in [../gsd/REFERENCE.md](../gsd/REFERENCE.md)) loads the master once. Ordinary handoff processing parses and validates the handoff and executes next_action without circular re-entry, capsule execution, or duplicated action. Preserve unknown `mode`, `phase`, settings, and runtime rows exactly. Malformed handoff state fails closed; invalid/missing/changed plan is a Spec escalation. Do not reconstruct an interpretation from an older handoff, dirty files, plan status, or legacy pre-approval TOON.

Perform ordinary handoff processing by parsing and validating the handoff and executing next_action without circular re-entry, capsule execution, or duplicated action. Strict validation rules apply to the `reload[N]{skill,path}` manifest:
- Reject duplicate skill names or duplicate paths.
- Reject unknown or non-installed skills (never treat unknown reload skills as forward-compatible).
- Reject mismatched skill names and paths (e.g. skill `gsd-handoff` paired with path `skills/gsd-verify/SKILL.md`).
- Reject absolute paths, backslashes, empty paths, dot/traversal segments (`.` or `..`), or malformed row counts/structures.
- Reject non-canonical numeric counts, non-matching table headers/schemas, extra/reordered/unknown columns, or incorrect row arity before decoded validation.
Fail closed immediately if any entry is invalid.
Preserve unknown runtime settings (`settings[N]{key,value}`) rows exactly, but never treat unknown reload skills in the manifest as forward-compatible.

Validate runtime settings before applying them. Unknown well-formed rows remain opaque; malformed, duplicate, or conflicting rows block resume.

For a valid execution resume, derive the last completed task and next task from immutable runtime handoff evidence, then continue the exact plan order. Do not mutate a prior attempt, change approved Markdown status, or re-dispatch completed work. Runtime terminal-repair counters retain their existing blocker semantics.

For `Milestone ledger recovery`, use only the ledger selected under `/gsd` Route 1 rules. Report the first pending milestone slug and goal, then return to Discussion/reconstruction. Do not create scratch state, mutate ledger bytes, detail later rows, mark completion, start execution, or authorize a merge.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Inline firing appends nothing.
