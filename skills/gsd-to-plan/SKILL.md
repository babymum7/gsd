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

Write `.scratch/<feature>/plan.md` exactly from [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Packet grammar. This skill is the sole writer. Use the canonical section order, concrete Outcome/Action/Expected criteria, ordered Decisions, one public interface pin per active criterion, optional Publication, and structured tasks with unique path operation/intents, optional bound prototype references, focused checks, and pending status.

Tasks are sequential `T1`…`TN`; order encodes dependencies. Every active AC occurs exactly once across tasks. A task spanning ACs requires identical seam, test path, and lower-seam reason. Every referenced prototype path must stay under `.scratch/<feature>/prototype/`, exist and be readable, and include role plus concrete fidelity requirements; prototype evidence never becomes scope authority.

Plan complete observable behavior, not layers. Use Expand → Migrate → Contract only when callers cannot migrate atomically and Contract has a completed caller/reference inventory. Pin the highest deterministic fast public seam. Never use `none` for observable behavior; add the smallest real fast seam when needed. `none` is only for mechanically verified non-behavioral work. Browser/GUI, external-network, long-lived, large-fixture, and material-cost checks are Deferred Slow E2E, not focused task checks. Any vague check, unowned or duplicate AC/path, missing reference, or unresolved decision returns to Discussion.

## Post-plan action surface

Before the approval gate, parse finalized `plan.md` and prove feature consistency, canonical ordering, concrete AC semantics, interface pins, task coverage, file ownership, decision validity, artifact availability/readability, and focused checks. Record exact path and SHA-256. Approved bytes are immutable. Full semantic parse and binding checks run only at approval, execution resume, terminal entry, and pre-squash; digest guards do not run at ordinary task selection. The current top-level session remains the sole lifecycle authority.

The parser dual-reads structured and legacy task blocks so exact already-approved hash-bound legacy plans can finish. This planner single-writes and may newly approve only structured task blocks; a newly submitted legacy-format plan returns to Discussion instead of receiving a new approval binding.

Present exactly one post-plan action surface for every complete draft plan and every feature type:

1. Approve and execute
2. Build prototype with Lavish
3. Revise the plan
4. Pause & save progress

Choosing `Build prototype with Lavish` is launch consent and causes no second confirmation. Load `gsd-lavish` for a feature-appropriate interactive prototype; annotations return here, update and revalidate the draft, optionally promote selected stable assets under `.scratch/<feature>/prototype/` with relative links from Context or Decisions, then present the same approve/build/revise/pause surface again. Unavailable Lavish degrades without blocking planning. Prototype sessions and artifacts never become execution authority or Terminal Visual Review evidence. After approval, a prototype request is Spec escalation, not an execution or terminal gate. Do not ask about terminal visual review during planning; Terminal Visual Review is owned later by `gsd-verify` after current-commit conformance.

After prototype feedback, every promoted reference used by implementation is bound in the applicable task `Artifacts` block with role and fidelity requirements. Before presenting approval, validate all referenced paths stay under `.scratch/<feature>/prototype/`, exist and are readable. Prototype artifacts guide implementation but never become scope authority, acceptance evidence, or a replacement for current-commit Terminal Visual Review.

This is the last planning prompt: Approve and execute ends planning; no later planning menu, approval confirmation, or generic Lavish visual-review offer appears. Scratch cleanup defaults to automatic delete after green merge; retain or archive-and-delete only when explicitly selected before final review, and that choice never reopens planning or any other menu.

On approval, immediately load `gsd-handoff` in `Execution state write` mode and atomically write canonical `schema:v3` `state.toon` with plan path/hash, `phase=approved`, no completed task, base/WIP identity, canonical preferences, checkpoint revision, and `next_action` set to `start/continue task`. Read it back and verify the binding before execution. A fresh approval after Spec escalation supersedes older binding state by atomic overwrite; there is no numbered handoff history. Never leave partial state bytes. Then load `gsd-executing-plans` without another prompt.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Inline firing appends nothing.
