---
name: gsd-to-plan
description: "Use when non-trivial requirements have converged into explicit acceptance criteria and an implementation plan must be created or finalized. Do not use while design decisions remain open or for Nano edits. Hands an approved bound plan to gsd-executing-plans."
triggers: converged acceptance contract needs canonical plan creation, revision, or finalization
produces: [plan.md, handoff-<n>.toon]
consumes: [plan.md, handoff-<n>.toon, docs/gsd/<feature>/milestones.md]
---

# To Plan

> **Invocation guard** — load after `gsd-brainstorming` converges or when validated unapproved plan state requires finalization. Select an Invocation Mode from explicit intent and entry context before validating only that row’s Required artifacts. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Initial converged creation | — | `handoff-<n>.toon`; `docs/gsd/<feature>/milestones.md` | `plan.md`; `handoff-<n>.toon` | — |
| Resume/finalize | `plan.md` | `handoff-<n>.toon`; `docs/gsd/<feature>/milestones.md` | `plan.md`; `handoff-<n>.toon` | Stop and load `gsd-brainstorming` to recover the missing contract before recreating `plan.md`; never synthesize a contract or read legacy pre-approval TOON |

## Intake

In `Resume/finalize` mode, read the canonical `plan.md` from `.scratch/<feature>/`. Parse and validate it under [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Canonical Markdown contract. Any legacy `proposal.md`, `spec.md`, or `design.md` is rejected. Root or scratch pre-approval `proposal.toon`, `spec.toon`, `design.toon`, and `plan.toon` are stale non-authoritative files and cannot provide missing scope, ACs, task order, or recovery. In `Initial converged creation` mode, there is no required plan and optional pre-plan handoff/context is consumed. We proceed to write the initial `plan.md` without reading an existing one.

Accept returned pre-approval domain paths only from `gsd-domain-modeling` conversational/handoff state. An absent returned set is normal; do not reconstruct it by scanning docs or dirty files. A Milestone Ledger is optional context unless the selected mode explicitly authorizes publication.

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

Tasks are sequential `T1`…`TN`; their order encodes dependencies. Every active AC occurs exactly once across non-superseded tasks. Each task owns exact paths, has a concrete focused check, and pins the highest deterministic public seam specified for its AC. A task spanning ACs requires identical seam, test path, and lower-seam reason. Keep rows as pointers; the immutable dispatch attempt carries the detailed task facts.

Plan complete observable behavior, not layers. Use Expand → Migrate → Contract only when all callers cannot migrate atomically; Contract requires a completed caller/reference inventory. `none` is only for mechanically verified non-behavioral work. A vague check, duplicate/unowned AC, missing file owner, or an unresolved design choice returns to Discussion rather than creating a plan.

## Approval binding

Before the approval gate, parse the finalized `plan.md` and prove feature consistency, canonical ordering, concrete AC semantics, interface pins, task coverage, file ownership, decisions validation, and focused checks. Record the exact path and SHA-256 digest of `plan.md`. The plan bytes are immutable for the execution cycle; the execution-control plane applies phase-boundary plan validation: full semantic parse and binding checks occur only at plan approval, execution entry/resume, and terminal entry. Digest guards verify the binding only at task attempt creation and pre-squash. Before approval, GSD validates that concrete, available, and distinct model selectors are configured for `modelRoles.gsdExecutor` and `modelRoles.gsdReviewer` in OMP configuration; it rejects missing, unresolved, alias-only, or same-model bindings, keeps the current model active before execution, and never substitutes the current model for either role. At approval, GSD binds these validated persistent executor and reviewer models. The persistent executor, reviewer, or any launched OMP child agents consume the attempt directly without independently parsing or validating the plan.

Print a compact feature/AC/task summary and the source binding. Ask one approval question: approve and execute, revise in Discussion, or review visually when the existing Lavish opt-in gate holds. This is the last prompt: approval immediately starts the post-approval pipeline; no later menu, offer, or confirmation appears unless a hard blocker stops it.

On approval, immediately load `gsd-handoff` in `Execution handoff write` mode and create the next positive sequential handoff (`handoff-1.toon` when none exists) with the plan path and hash, selected execution mode, `phase=approved`, no completed task, and `next_action` set to `start/continue task`. Read it back and verify the binding before dispatch. A fresh approval after Spec escalation supersedes older bindings for active execution without modifying their immutable handoffs; validate the highest-numbered existing handoff structurally, but do not treat its expected old hashes as a conflict with the newly approved packet. Never overwrite. Then load `gsd-executing-plans` without another prompt.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Inline firing appends nothing.
