---
name: gsd-verify
description: Internal GSD sub-skill (routed via /gsd). Verifies approved Markdown packets against the WIP diff, blocks on Critical/Important findings, and completes terminal squash/cleanup.
triggers: diff/PR review (gsd Route 2); terminal after gsd-executing-plans; quick-fix gate
produces: [docs/gsd/<feature>/milestones.toon, .scratch/<feature>/result.toon]
consumes: [proposal.md, spec.md, design.md, plan.md, handoff-<n>.toon, docs/gsd/<feature>/milestones.toon]
---

# Verify

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Choose the Invocation Mode from intent and context, then validate only its Required state. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Standalone review (Route 2) | — | Markdown packet context | — | — |
| Planned WIP gate | `proposal.md`; `spec.md`; `plan.md` | `design.md`; `handoff-<n>.toon`; authorized ledger | `result.toon`; authorized ledger | Stop before review or merge as Spec escalation |
| Milestone WIP gate | Planned state; authoritative ledger | `design.md`; `handoff-<n>.toon` | `result.toon`; milestone ledger lifecycle state | Missing source is Spec escalation; missing ledger evidence is a Blocker |
| Quick-fix WIP gate | `plan.md` | Markdown packet absent by design | `result.toon` | Recover the real quick-fix plan; never fabricate it |

## Planned and milestone WIP gate

Before dispatching review, after every repair, and immediately before squash, parse the complete Markdown packet and verify the exact approved source paths and SHA-256 hashes. Any changed source, changed source set, malformed grammar, mismatched feature, missing interface pin, or plan coverage drift is a Spec escalation. No legacy pre-approval TOON can restore or define the contract.

Review the full WIP diff against the same bound bytes. Planned verification proves every active AC through its pinned highest deterministic public seam, every current task’s focused check and owned paths, applicable runnable acceptance/E2E, and code quality. A missing reviewer degrades to a separate self-review with identical blocking semantics. Critical/Important findings and red gates block; terminal repair has at most two complete re-review/retest rounds against the unchanged binding.

A pass uses the existing Git/base/WIP/scratch and result-marker contract in [../gsd/REFERENCE.md](../gsd/REFERENCE.md) to squash merge to `<base>`, clean remote/local WIP and scratch, and record the result. Existing milestone TOON remains durable lifecycle state only. Do not ask to merge or offer a visual review after approval.

## Standalone review

Route 2 is read-only and has no branch, result, or merge authority. Review the supplied diff for stated-intent compliance and code quality. Optional Markdown context informs findings only; it is not an approval gate.

## Quick-fix WIP gate

Quick fixes have their minimal approved `plan.md` but no full feature packet. Run code-quality, focused behavior, whole-branch build where available, and applicable E2E before the same squash/cleanup sequence. Do not invent spec compliance.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Pipeline mode reports progress or blockers only; standalone review may use its report surface.
