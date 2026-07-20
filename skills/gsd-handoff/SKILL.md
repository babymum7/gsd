---
name: gsd-handoff
description: "Use when pausing, saving, resuming, or recovering GSD work from a valid handoff or compaction capsule. Do not invent work when required state is missing or malformed. Loads the peer skill named by validated next_action state."
triggers: pause, save, resume, continue, compaction recovery, context pressure, or task-completion handoff
produces: [handoff-<n>.toon]
consumes: [handoff-<n>.toon, plan.md, docs/gsd/<feature>/milestones.md]
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
| Pre-plan handoff write | — | Markdown packet | `handoff-<n>.toon` | — |
| Execution handoff write | `plan.md` | milestone ledger | `handoff-<n>.toon` | Missing or drifted plan is Spec escalation; never invent execution state or a binding |
| Pre-plan resume | `handoff-<n>.toon` | Markdown packet | — | Return once to state detection; preserve explicit intent |
| Execution resume | `handoff-<n>.toon`; `plan.md` | milestone ledger | — | Recover only from valid runtime state and the bound plan.md; plan drift is Spec escalation |
| Milestone ledger recovery | authoritative ledger selected by automatic active-state detection | — | — | Missing/malformed/base-mismatched ledger fails closed; never invent work |

## Write

Write the next positive sequential `.scratch/<feature>/handoff-<n>.toon`; never overwrite or suffix an existing handoff. The approval binding is the first execution handoff (`handoff-1.toon` when none exists), written immediately after approval and before dispatch. Every executable handoff explicitly requires and validates concrete, distinct executor and reviewer model selectors (via settings: 'executor_model' and 'reviewer_model'), actual agent identity/model/generation fields by phase, and progress/fingerprint evidence for repair rounds. Sentinel agent identities or models ('none', 'unassigned', 'pending') are strictly rejected. GSD must write and validate these fields structurally and semantically; they must never be left opaque or ignored. Phase-specific required identity/result fields match the execution-resume validation matrix below. Store opaque `mode` and `phase`, resolved decisions, unresolved questions, `next_action`, runtime settings, current completed task/evidence when applicable, and—after approval—the exact approved `plan.md` path plus SHA-256 hash. Pre-plan handoffs omit an approval binding rather than fabricating one. A handoff is immutable runtime state, not a source of requirements.

Every execution handoff write requires exact manifest coverage for the `next_action` being transitioned to. Serialize the reload manifest as `reload[N]{skill,path}` rows, where `N` is exactly equal to the following row count in the manifest table. The manifest must specify exactly the active subskills required for the `next_action`. Master (`gsd`) must never be written to or duplicated in the `reload` manifest. The byte parser requires the exact ordered schema `reload[N]{skill,path}` with a canonical numeric count and exact row arity, and rejects extra, reordered, or unknown columns before decoded validation.

The default handoff is machine-local under git-ignored scratch. Portable handoff retains the existing WIP/base mechanics from [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics; it never modifies the Markdown packet or makes scratch authoritative.

## Runtime settings

Require exact `settings[N]{key,value}` presence for executable handoffs, including canonical `settings[0]{key,value}:`; reject missing, scalarized, duplicated, malformed, or count-mismatched settings tables. Known keys are unique: executor_model and reviewer_model must specify concrete, distinct, available configured OMP model selectors; `autosync` accepts only `on|off`, `ponytail_level` accepts only `lite|full|ultra`, and `manual_ui_review` accepts only `on|off`. Omission means autosync is unset, ponytail is inactive, and manual UI review is disabled. `design_state` and `domain_state` are deleted as persisted conditional rows and reload inputs. Inline codebase-design/domain-modeling complete before handoff; outputs already in plan/attempt are not resumable execution modes. At every execution-handoff write, derive conditional reload entries from the active subskill/action context; the reload table persists them. Ponytail remains settings-derived. Preserve an unknown well-formed key/value row verbatim for forward compatibility (unknown settings remain opaque). A malformed row, duplicate key, or invalid known value makes the handoff invalid and fails closed; never silently reset, choose one duplicate, or reinterpret a value. `manual_ui_review,on` is resumable. The byte parser requires the exact ordered schema `settings[N]{key,value}` with a canonical numeric count and exact row arity, and rejects extra, reordered, or unknown columns before decoded validation.

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
Preserve `manual_ui_review,on` across resumes/handoffs through completion; opt-in adds only the pre-E2E pause without changing `plan.md`. Invalid/duplicate rows fail closed.

For a valid execution resume, validate that the handoff specifies exact, concrete, distinct executor and reviewer model selectors (via settings: 'executor_model' and 'reviewer_model'), actual agent identity/model/generation fields by phase, and progress/fingerprint evidence for repair rounds. Sentinel agent identities or models ('none', 'unassigned', 'pending') are strictly rejected. The `approved` executable phase requires exactly both concrete distinct bound model settings (never `settings[0]`). All active/verification execution phases validate that actual executor and reviewer models match their bound settings exactly. All referenced history records (prior completed review and triggering handoffs) must be loaded with lstat-style checks resolving canonical filenames (`handoff-<positive canonical integer>.toon`, rejecting zero, leading zeros, prefixes, and suffixes) within the canonical same-feature directory (`dirname(suppliedHandoffPath)`), rejecting symbolic links before reading, and requiring existence as a regular file. `feature`, `plan_path`, and `plan_sha256` must be present and identical across current, trigger, and prior history handoffs, alongside model settings bindings. History records used for convergence must be fully semantically validated as completed `terminal-repair` records with non-sentinel executor and reviewer identities, actual models matching bound settings, positive executor and reviewer generations, positive review round, completed non-pending check and non-empty result, exact `reviewer_verdict: BLOCKED`, positive `blocking_count`, valid current and previous fingerprints, mandatory `reviewed_commit`, exact `progress_status: advanced`, and non-empty `progress_evidence` and `progress_guard`, performing unconditional commit/fingerprint comparisons without conditional skips. Validation is strictly phase-specific: (1) `task-active`, `task-repair`, `executor-terminal-green`, and `terminal-entry` require and validate `executor_agent`, `executor_actual_model`, and `executor_generation` (positive integer, never `unassigned`) and must not be forced to carry terminal fields; `executor-terminal-green` and `terminal-entry` also validate terminal PASS evidence as applicable; (2) `terminal-review` requires `reviewer_agent`, `reviewer_actual_model` (matching bound settings), `reviewer_generation` (positive integer), and `review_round` (positive integer); (3) `terminal-review` with `reviewer_terminal_check:pending` in round 1 allows no prior fingerprint; rounds >=2 require `previous_blocking_fingerprint` and structured progress; completed terminal results are not required; (4) `terminal-repair` requires executor and reviewer agent/model/generation fields plus completed reviewer results (`reviewer_terminal_check` not pending, `reviewer_verdict` exactly `BLOCKED`, positive `blocking_count`, `reviewed_commit` matching the triggering pending `terminal-review`'s `current_review_commit`, and `progress_status: advanced` with changed relevant commit and fingerprint vs the prior completed blocked review rather than the immediate pending handoff; same fingerprint or unchanged commit fails closed); (5) `approval` requires both model settings but must not carry active agent identities or terminal fields. Reject unchanged repeated fingerprints when no progress or diff is detected. Derive the last completed task and next task from immutable runtime handoff evidence, then continue the exact plan order. Do not mutate a prior attempt, change approved Markdown status, or re-dispatch completed work.

For `Milestone ledger recovery`, use only the ledger selected by automatic active-state detection. Report the first pending milestone slug and goal, then load `gsd-brainstorming` for reconstruction. Do not create scratch state, mutate ledger bytes, detail later rows, mark completion, start execution, or authorize a merge.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Inline firing appends nothing.
