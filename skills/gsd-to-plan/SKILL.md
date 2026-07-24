---
name: gsd-to-plan
description: "Use when non-trivial requirements have converged into explicit acceptance criteria and an implementation plan must be created or finalized. Do not use while design decisions remain open or for Nano edits. Hands an approved bound plan to gsd-executing-plans."
triggers: converged acceptance contract needs canonical plan creation, revision, or finalization
produces: [plan.md, state.toon]
consumes: [plan.md, state.toon, docs/domain/index.md, docs/domain/<scope>.md, AGENTS.md, docs/gsd/<feature>/milestones.md]
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

## Intake

In `Resume/finalize` mode, read the canonical `plan.md` from `.scratch/<feature>/`. Parse and validate it under [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Canonical Markdown contract. Any legacy `proposal.md`, `spec.md`, or `design.md` is rejected. Root or scratch pre-approval `proposal.toon`, `spec.toon`, `design.toon`, and `plan.toon` are stale non-authoritative files and cannot provide missing scope, ACs, task order, or recovery. In `Initial converged creation` mode, there is no required plan and optional draft state/context is consumed. We proceed to write the initial `plan.md` without reading an existing one.

Consume the converged `Domain Impact`. Record its fields in this exact order: `Classification`, `Contexts`, `Documentation`, `Broad bootstrap`, `Evidence`. `classification=none` requires `contexts=none`, `documentation=none`, and concrete no-impact evidence. Every other classification requires sorted context slugs and a documentation action. Bind the exact reserved domain-documentation paths returned by `gsd-domain-modeling` to the same tasks as their implementing code; the plan owns target behavior until implementation, while existing domain prose remains current-production-only. When the domain index exists, `Broad bootstrap` must be `not-offered`. When it is absent, record the user's independent `selected` or `declined` choice after mandatory feature-scoped paths are established. Never reconstruct paths by scanning docs or dirty files.

## Write plan.md

Write `.scratch/<feature>/plan.md` exactly from [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Packet grammar. This skill is the sole writer. Use canonical section order, exact `Domain Impact`, concrete Outcome/Action/Expected criteria, ordered Decisions, one public interface pin per active criterion, optional Publication, and structured tasks with unique path operation/intents, focused checks, and pending status.

Tasks are sequential `T1`…`TN`; order encodes dependencies. Every active AC occurs exactly once across tasks. A task spanning ACs requires identical seam, test path, and lower-seam reason. For non-`none` Domain Impact, bind every exact affected `docs/domain/<scope>.md`, any required `docs/domain/index.md`, and canonical `AGENTS.md` upsert to the same owning task as the semantic code change; never create a trailing documentation-only task.

Plan complete observable behavior, not layers. Use Expand → Migrate → Contract only when callers cannot migrate atomically and Contract has a completed caller/reference inventory. Pin the highest deterministic fast public seam. Never use `none` for observable behavior; add the smallest real fast seam when needed. `none` is only for mechanically verified non-behavioral work. Browser/GUI, external-network, long-lived, large-fixture, and material-cost checks are Deferred Slow E2E, not focused task checks. Any vague check, unowned or duplicate AC/path, missing reference, contradictory Domain Impact, or unresolved decision returns to Discussion.

## Post-plan action surface

The parser dual-reads structured task blocks and exact already-approved hash-bound legacy task blocks. It also dual-reads an exact pre-Domain-Impact plan only after its recorded SHA-256 binding matches. This planner single-writes and may newly approve only structured task blocks with canonical `Domain Impact`; legacy task format, missing Domain Impact, or malformed new fields return to Discussion instead of receiving a new binding.

Present exactly one post-plan action surface for every complete draft plan and every feature type:

1. Approve and execute
2. Revise the plan
3. Pause & save progress

This is the last planning prompt: Approve and execute ends planning; no later planning menu or approval confirmation appears. Scratch cleanup defaults to automatic delete after green merge; retain or archive-and-delete only when explicitly selected before final review, and that choice never reopens planning or any other menu.

On approval, immediately load `gsd-handoff` in `Execution state write` mode and atomically write canonical `schema:v4` `state.toon` with plan path/hash, `phase=approved`, no completed task, base/WIP identity, canonical preferences, checkpoint revision, and `next_action` set to `start/continue task`. Read it back and verify the binding before execution. A fresh approval after Spec escalation supersedes older binding state by atomic overwrite; there is no numbered handoff history. Never leave partial state bytes. Then load `gsd-executing-plans` without another prompt.
## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Inline firing appends nothing.
