---
name: gsd-verify
description: Internal GSD sub-skill (routed via /gsd). Verifies approved Markdown packets against the WIP diff, blocks on Critical/Important findings, and completes terminal squash/cleanup.
triggers: diff/PR review (gsd Route 2); terminal after gsd-executing-plans; quick-fix gate
produces: [docs/gsd/<feature>/milestones.md, .scratch/<feature>/result.toon]
consumes: [proposal.md, spec.md, design.md, plan.md, handoff-<n>.toon, docs/gsd/<feature>/milestones.md]
---

# Verify

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Choose the Invocation Mode from intent and context, then validate only its Required state. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Standalone review (Route 2) | — | Markdown packet context | — | — |
| Planned WIP gate | `proposal.md`; `spec.md`; `plan.md`; bound `handoff-<n>.toon` | `design.md`; authorized ledger | `result.toon`; authorized ledger | Stop before review or merge as Spec escalation |
| Milestone WIP gate | Planned state; authoritative ledger | `design.md` | `result.toon`; milestone ledger lifecycle state | Missing source/binding is Spec escalation; missing ledger evidence is a Blocker |
| Quick-fix WIP gate | `plan.md` | Markdown packet absent by design | `result.toon` | Recover the real quick-fix plan; never fabricate it |

## Planned and milestone WIP gate

Before dispatching review, after every repair, and immediately before squash, parse the complete Markdown packet and verify the exact approved source paths and SHA-256 hashes. Any changed source, changed source set, malformed grammar, mismatched feature, missing interface pin, or plan coverage drift is a Spec escalation. No legacy pre-approval TOON can restore or define the contract.

Review the full WIP diff against the same bound bytes. Planned verification proves every active AC through its pinned highest deterministic public seam, every current task’s focused check and owned paths, applicable runnable acceptance/E2E, and code quality. A missing reviewer degrades to a separate self-review with identical blocking semantics. Critical/Important findings and red gates block; terminal repair has at most two complete re-review/retest rounds against the unchanged binding.

A planned pass uses the existing Git/base/WIP/scratch and result-marker contract in [../gsd/REFERENCE.md](../gsd/REFERENCE.md) to squash merge to `<base>`, clean remote/local WIP and scratch, and record the result. Authorized convergence-time ledger publication remains subject to exact plan ownership and never completes a milestone.

For a `Milestone WIP gate`, first prove that the executor-selected row still matches the approved milestone and is the first `pending` row. Before final diff review, apply the exact lifecycle transition from [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Milestone Ledger completion contract: non-final milestone → change only that row to `done`; final milestone → delete the ledger. Review that mutation with the complete WIP diff. A changed prefix, another changed row, an append, a reorder, or the wrong active row is a Blocker. The transition lands only with the same green squash commit; a red gate never changes base ledger state. Do not ask to merge or offer a visual review after approval.

## Standalone review

Route 2 is read-only and has no branch, result, or merge authority. Review the supplied diff for stated-intent compliance and code quality. Optional Markdown context informs findings only; it is not an approval gate.

## Quick-fix WIP gate

Quick fixes have their minimal approved `plan.md` but no full feature packet. Run code-quality, focused behavior, whole-branch build where available, and applicable E2E before the same squash/cleanup sequence. Do not invent spec compliance.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Pipeline mode reports progress or blockers only; standalone review may use its report surface.
