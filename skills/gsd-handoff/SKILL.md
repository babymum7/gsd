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

**Always use the CLI tool** `node "<GSD_ROOT>/tools/gsd-state.mjs" write-state --feature-dir .scratch/<feature> --json-file .scratch/<feature>/.state-input.json` to write state.toon. Write the state fields to `.scratch/<feature>/.state-input.json`, pass its path via `--json-file`, then delete the temp file — both on success and on failure. Never write state.toon directly using the `write` tool; direct writes bypass validation and produce malformed files that break autocompact and resume. The CLI validates, serializes, writes atomically, and readbacks automatically.
The CLI writes atomically to `.scratch/<feature>/state.toon` per [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Runtime state contract: same-directory temp, fsync, rename, directory fsync where supported, then validated readback.
- Approval first writes `phase=approved`.
- Canonical `schema:v4` gives the session owner only lifecycle, plan/Git binding, green checkpoint, runtime preferences, and revision.
- Exact active v1, v2, and v3 records migrate atomically after full validation; v1/v2 terminal records fail closed unchanged.
- The exact v3 `completed-retained` compatibility case remains inert during candidate discovery, while an explicit read validates and migrates it atomically to `schema:v4`.

Exact v1/v2 `completed-retained` records are structurally recognized during candidate discovery only to remain inert and byte-identical; an explicit read rejects them fail closed unchanged. Retained v3 remains the sole terminal record that an explicit validated read migrates.

Active skills are derived from `phase` and `next_action` per [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Skill derivation from phase and next_action. Never serialize a `reload` manifest. Master (`gsd`) is present from bootstrap.

Scratch is machine-local by default. Portable resume follows [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics and never makes scratch authoritative.

## Runtime preferences

Known preference fields on `state.toon` are unique scalars: `autosync` accepts only `none|on|off`; `cleanup_preference` accepts only `none|delete|retain|archive-and-delete`. Omission uses canonical `none` (autosync unset and cleanup defaults to delete after green merge). Ponytail has no runtime mode or persisted field. Reject legacy settings tables. Mandatory domain-modeling output completes before checkpoint; plan outputs are not resumable execution modes. Malformed, duplicate, or invalid known values fail closed.

## Portable and autosync

At the first user-requested pause with a remote and `autosync=none`, ask once: `no`→`off`, `always`→`on`, one-time `yes` leaves `none`. `on` syncs only at user-requested pause/portable handoff or a clean completed-task boundary; dirty and context-pressure checkpoints stay local.

Cross-machine handoff may snapshot only explicitly approved dirty non-scratch paths, then sync committed WIP plus exact feature `plan.md` and `state.toon` to `origin/wip/<feature>`. Never sweep unrelated paths. Without a remote, cross-machine resume is unavailable.

## Resume

Without a supplied path, discover active candidates via [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Candidate discovery; numbered history and result markers have no authority.
- Master is already loaded from bootstrap and is never reloaded: validate state, then load the peer owner named by `next_action` and execute it without circular re-entry, capsule execution, or duplicated action.
- Reject an unknown `phase`; preserve an opaque `next_action` only when structurally valid.
- Malformed state fails closed, and a missing or malformed-grammar plan is Spec escalation. A plan whose bytes moved is not drift to stop on: revalidate and rebind it under [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Plan amendment, asking one question only when the change is material or unaccounted for.
- Never reconstruct from dirty files, plan status, conversation, or legacy pre-approval TOON.

For every Execution resume, after state validation and before deriving the peer owner, select the validator by probe: `schema:v4` records no grammar kind, so never assume one.

1. Run `node "<GSD_ROOT>/tools/gsd-contract.mjs" validate-quick-fix --path .scratch/<feature>/plan.md`. Exit 0 is a Quick-fix packet; it accepts no `--expected-sha256`, so compare its returned `sha256` against `state.plan_sha256`.
2. Exit 1 means the bytes are not Quick-fix grammar: run `node "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md --expected-sha256 <state.plan_sha256>`. Exit 0 resumes the full plan.
3. On exit 1 there, revalidate unbound with `node "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md`: exit 0 proves the bytes only moved, which the rebind rule below resolves; exit 1 means both grammars reject the packet, which is Spec escalation.

Exit 2 is never escalation: correct the invocation and rerun. A bound call checks the hash before parsing, so on its own it never proves malformed grammar. A Quick-fix plan is never malformed converged state: escalating it because the full-plan grammar rejected it is a validator-selection error.

The probe reads current bytes, so it proves the recorded grammar only when the hash matches. On any difference the prior kind is unprovable, because a packet rewritten into the other grammar probes just as clean: resume asks one question naming the grammar that accepts the bytes now and stating that the prior kind cannot be proven, then rebinds only if the user accepts the current grammar.

A valid Execution resume verifies `schema:v4`, plan hash/path, base/WIP, last green task/commit, and current tree, then rebuilds the active slice including `Domain Impact`. Resume validates whether verification must continue before repair, E2E, or merge. These stages add no state keys.

For `Milestone ledger recovery`, use only the ledger selected by automatic active-state detection. Report the first pending milestone slug and goal, then load `gsd-brainstorming` for reconstruction. Do not create scratch, mutate ledger bytes, detail later rows, mark completion, start execution, or authorize merge.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Inline firing appends nothing.
