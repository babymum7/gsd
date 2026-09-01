---
name: gsd-handoff
description: "Use to pause, save, resume, or recover GSD work from a valid state.toon, milestone ledger row, or compaction capsule, including selecting one of several active features."
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
| Execution state write | `plan.md` | milestone ledger | `state.toon` | Missing or malformed plan is Spec escalation; never invent execution state or a binding |
| Pre-plan resume | `state.toon` | Markdown packet | — | Return once to state detection; preserve explicit intent |
| Execution resume | `state.toon`; `plan.md` | milestone ledger | — | Recover only from valid runtime state and a valid `plan.md`; a drifted hash rebinds under § Plan amendment |
| Milestone ledger recovery | authoritative ledger selected by automatic active-state detection | — | — | Missing/malformed/base-mismatched ledger fails closed; never invent work |

## Write

**Always use the CLI tool** `bun "<GSD_ROOT>/tools/gsd-state.mjs" set --feature-dir .scratch/<feature> key=value…` to write state.toon.
Pass each field as a `key=value` argument; derived defaults fill `next_action` and `checkpoint_revision`. `write-state --json-file` remains the fallback for values `key=value` cannot express. Never write state.toon directly using `write`: direct writes bypass validation, breaking autocompact and resume. The CLI validates, serializes, and writes atomically to `.scratch/<feature>/state.toon` per [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Runtime state contract: temp, fsync, rename, directory fsync, readback.
- Plan binding writes `phase=approved`.
- Canonical `schema:v4` gives the session owner only lifecycle, plan/Git binding, green checkpoint, runtime preferences, and revision.
- Exact active v1, v2, and v3 records migrate atomically after full validation; v1/v2 terminal records fail closed unchanged.
- The exact v3 `completed-retained` compatibility case remains inert during candidate discovery, while an explicit read validates and migrates it atomically to `schema:v4`.
- Exact v1/v2 `completed-retained` records during candidate discovery remain inert and byte-identical; explicit `readStateFile` rejects them fail closed unchanged. Retained v3 remains the sole terminal record an explicit validated read migrates.

Active skills are derived from `phase` and `next_action` per [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Skill derivation from phase and next_action. Never serialize a `reload` manifest. Master (`gsd`) is present from bootstrap.

Scratch is machine-local. Portable resume follows [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics; scratch is never authoritative.

## Runtime preferences
Known preference fields on `state.toon` are unique scalars: `autosync` accepts only `none|on|off`; `cleanup_preference` accepts only `none|delete|retain|archive-and-delete`. Omission uses canonical `none` (autosync unset; cleanup defaults to delete after green merge). Ponytail has no runtime mode or persisted field; reject legacy settings tables. Mandatory domain-modeling output completes before checkpoint; plan outputs are not resumable execution modes. Malformed, duplicate, or invalid known values fail closed.

## Portable and autosync
At the first user-requested pause with a remote and `autosync=none`, ask once: `no`→`off`, `always`→`on`, one-time `yes` leaves `none`. `on` syncs only at user-requested pause/portable handoff or a clean completed-task boundary; dirty and context-pressure checkpoints stay local.

Cross-machine handoff snapshots only explicitly selected dirty non-scratch paths, syncing committed WIP plus feature `plan.md` and `state.toon` to `origin/wip/<feature>`. Never sweep unrelated paths; without a remote, cross-machine resume is unavailable.

## Resume

Without a supplied path, discover active candidates via [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Candidate discovery; numbered history and result markers have no authority.
- Master is already loaded from bootstrap and is never reloaded: validate state, then load the peer owner named by `next_action` and execute it without circular re-entry, capsule execution, or duplicated action.
- Reject an unknown `phase`; preserve an opaque `next_action` only when structurally valid.
- Malformed state fails closed; missing or malformed-grammar plans are Spec escalation. Plans whose bytes moved are not drift: revalidate and rebind under [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Plan amendment, asking one question only when changes are material or unaccounted for.
- Never reconstruct from dirty files, plan status, conversation, or legacy pre-binding TOON.

For every Execution resume, after state validation and before deriving the peer owner, select the validator by probe: `schema:v4` records no grammar kind, so never assume one.

1. Run `bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-quick-fix --path .scratch/<feature>/plan.md --expected-base <state.base_ref>`. Exit 0 is a Quick-fix packet; it accepts no `--expected-sha256`, so compare its returned `sha256` against `state.plan_sha256`.
2. Exit 1 means not Quick-fix grammar: run `bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md --expected-sha256 <state.plan_sha256> --expected-base <state.base_ref>`. Exit 0 resumes full plan.
3. On exit 1 there, revalidate unbound with `bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md --expected-base <state.base_ref>`: exit 0 proves bytes only moved, resolved by rebind below; exit 1 means both grammars reject, which is Spec escalation.

Base mismatch errors stop the ladder immediately as Spec escalation: `plan.md` § Base no longer matches the recorded merge target. Keeping `--expected-base` on the unbound call prevents retargeting the squash; a base is never rebound mid-lifecycle.
Exit 2 is never escalation: correct invocation and rerun. A bound call checks hash before parsing, so it alone never proves malformed grammar. A Quick-fix plan is never malformed converged state: escalating it because full-plan grammar rejected it is a validator-selection error.

The probe reads current bytes, proving recorded grammar only when hash matches. On difference, prior kind is unprovable: resume asks one question naming the accepting grammar and stating prior kind is unprovable; rebind only if the user accepts current grammar.
A valid Execution resume verifies `schema:v4`, plan hash/path, base/WIP, last green task/commit, and current tree, rebuilding active slice including `Domain Impact`. Resume validates whether verification continues before repair, E2E, or merge without adding state keys.

For `Milestone ledger recovery`, use only the ledger selected by automatic active-state detection. Report first pending milestone slug and goal, then load `gsd-brainstorming` for reconstruction. Do not create scratch, mutate ledger bytes, detail later rows, mark completion, start execution, or authorize merge.
## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Inline firing appends nothing.
