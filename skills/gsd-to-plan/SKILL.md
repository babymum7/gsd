---
name: gsd-to-plan
description: "Use when non-trivial requirements have converged into explicit acceptance criteria and an implementation plan must be created or finalized. Do not use while design decisions remain open or for Nano edits. Hands an approved bound plan to gsd-executing-plans."
triggers: converged acceptance contract needs canonical plan creation, revision, or finalization
produces: [plan.md, state.toon]
consumes: [plan.md, state.toon, docs/gsd/<feature>/milestones.md]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Do-not-load: open design decisions; Nano edits
- Transition: on approval write `state.toon` and load `gsd-executing-plans`

# To Plan

> **Invocation guard** — load after `gsd-brainstorming` converges or when validated unapproved plan state requires finalization. Select an Invocation Mode from explicit intent and entry context before validating only that row’s Required artifacts. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Initial converged creation | — | `state.toon`; `docs/gsd/<feature>/milestones.md` | `plan.md`; `state.toon` | — |
| Resume/finalize | `plan.md` | `state.toon`; `docs/gsd/<feature>/milestones.md` | `plan.md`; `state.toon` | Stop and load `gsd-brainstorming` to recover the missing contract before recreating `plan.md`; never synthesize a contract or read legacy pre-approval TOON |
| Prototype feedback revision | `plan.md` | Lavish annotations; prototype refs | `plan.md`; `state.toon` | Missing draft plan stops; never invent prototype authority |

## Intake

In `Resume/finalize` mode, read the canonical `plan.md` from `.scratch/<feature>/`. Parse and validate it under [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Canonical Markdown contract. Any legacy `proposal.md`, `spec.md`, or `design.md` is rejected. Root or scratch pre-approval `proposal.toon`, `spec.toon`, `design.toon`, and `plan.toon` are stale non-authoritative files and cannot provide missing scope, ACs, task order, or recovery. In `Initial converged creation` mode, there is no required plan and optional draft state/context is consumed. We proceed to write the initial `plan.md` without reading an existing one.

Accept returned pre-approval domain paths only from `gsd-domain-modeling` conversational/state. An absent returned set is normal; do not reconstruct it by scanning docs or dirty files. A Milestone Ledger is optional context unless the selected mode explicitly authorizes publication.

## Write plan.md

Write `.scratch/<feature>/plan.md` in this order:

```md
# Plan
## Feature
`<feature-slug>`
## Base
`<base>`
## Summary
<one concrete outcome>
## Context
<bounded context>
## Scope
- <included behavior>
## Acceptance Criteria
### AC-1: <title>
- **State:** active
- **Outcome:** <concrete behavior>
- **Action:** <concrete operation>
- **Expected:** <observable result>
## Decisions
None.
## Invariants
- **I-1:** <must remain true>
## Non-goals
- **NG-1:** <explicit exclusion>
## Interfaces
| Criterion | Seam | Path | Lower-seam reason |
| --- | --- | --- | --- |
| AC-1 | <public seam> | `<repository-relative path>` | none |
## Publication
null
## Tasks
### T1: <short task>
- **Satisfies:** AC-1
- **Files:** `<path>`
- **Test:** `<focused command or none>`
- **Status:** pending
```

Decisions is exact `None.` or sequential D blocks with Decision and Rationale:
```markdown
### D-1: <title>
- **Decision:** <value>
- **Rationale:** <value>
```

Tasks are sequential `T1`…`TN`; their order encodes dependencies. Every active AC occurs exactly once across non-superseded tasks. Each task owns exact paths, has a concrete focused check, and pins the highest deterministic public seam specified for its AC. A task spanning ACs requires identical seam, test path, and lower-seam reason. Keep rows as pointers; the parent builds the detailed task brief from the validated plan at dispatch.

Plan complete observable behavior, not layers. Use Expand → Migrate → Contract only when all callers cannot migrate atomically; Contract requires a completed caller/reference inventory. Observable behavior always receives a fast public seam; if none exists, add the smallest real fast public seam instead of using `none`. Never use `none` for observable behavior. `none` is only for mechanically verified non-behavioral work. Classify each task's focused check as a Fast TDD Check: deterministic, local, and free of browser/GUI, external network, long-lived server, large fixture, or material cost. A vague check, behavior task without a fast seam, duplicate/unowned AC, missing file owner, or an unresolved design choice returns to Discussion rather than creating a plan.

## Post-plan action surface

Before the approval gate, parse the finalized `plan.md` and prove feature consistency, canonical ordering, concrete AC semantics, interface pins, task coverage, file ownership, decisions validation, and focused checks. Record the exact path and SHA-256 digest of `plan.md`. The plan bytes are immutable for the execution cycle once approved; the execution-control plane applies phase-boundary plan validation: full semantic parse and binding checks occur only at plan approval, execution resume, terminal entry, and pre-squash. Digest guards do not run at ordinary task dispatch. Before approval, GSD validates that concrete, available, and distinct model selectors are configured for `modelRoles.gsdExecutor` and `modelRoles.gsdReviewer` in OMP configuration; rejects missing, unresolved, alias-only, or same-model bindings; keeps the current model active before execution, and never substitutes the current model for either role. At approval, GSD binds these validated persistent executor and reviewer models.

Present exactly one post-plan action surface for every complete draft plan and every feature type:

1. Approve and execute
2. Build prototype with Lavish
3. Revise the plan
4. Pause & save progress

Choosing `Build prototype with Lavish` is launch consent and causes no second confirmation. Load `gsd-lavish` for a feature-appropriate interactive prototype; annotations return here, update and revalidate the draft, optionally promote selected stable assets under `.scratch/<feature>/prototype/` with relative links from Context or Decisions, then present the same approve/build/revise/pause surface again. Unavailable Lavish degrades without blocking planning. Prototype sessions and artifacts never become execution authority or Terminal Visual Review evidence. After approval, a prototype request is Spec escalation, not an execution or terminal gate. Do not ask about terminal visual review during planning; Terminal Visual Review is owned later by `gsd-verify` after reviewer PASS.

This is the last planning prompt: Approve and execute ends planning; no later planning menu, approval confirmation, or generic Lavish visual-review offer appears. Scratch cleanup defaults to automatic delete after green merge; retain or archive-and-delete only when explicitly selected before final review, and that choice never reopens planning or any other menu.

On approval, immediately load `gsd-handoff` in `Execution state write` mode and write atomic `state.toon` with the plan path and SHA-256 hash, `phase=approved`, no completed task, concrete distinct bound model selectors, and `next_action` set to `start/continue task`. Read it back and verify the binding before dispatch. A fresh approval after Spec escalation supersedes older bindings by atomic overwrite of `state.toon`; there is no numbered handoff history. Never leave partial state bytes. Then load `gsd-executing-plans` without another prompt.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Inline firing appends nothing.
