---
name: gsd-to-plan
description: Produce an implementation plan from a converged design — no interview, just write the plan. Triggered by `gsd-grilling` when the spec/design converges; outputs task-decomposed plan(s) with parallelism markers to `.scratch/<feature>/plans/`.
---

# To Plan

Turn a converged design into an executable implementation plan. No interview — the design is settled (gsd-grilling did that). Read `.scratch/<feature>/spec.md` for the acceptance criteria this plan must deliver. Write the plan.

## Output

Write to `.scratch/<feature>/plans/NN-<area>.md`. One file per independently-shippable area.

Each plan:
- **Task list** — ordered, each task a single coherent unit (one brief per implementer).
- **Satisfies** — which acceptance-criteria IDs (from `spec.md`) this plan's tasks deliver.
- **Affected files** per task — exact paths.
- **TDD note** per task — the unit test that proves it (E2E deferred).
- **Parallelism marker**: `[PARALLEL]` (disjoint file set from other plans) or `[SEQ after NN]` (waits for another plan).

## Auto-triggers
- `gsd-codebase-design` — when a task involves designing/redesigning a module interface.

## Rules
- Decompose by what an implementer can do in one focused pass, not by file type.
- Mark inter-task dependencies explicitly; never hide a sequencing constraint inside a task.
- If the design has a gap that blocks planning, STOP — route back to `gsd-grilling` → revise `spec.md` → re-plan. Do not invent scope to fill it.
- No interviews, no scope expansion. The plan reflects the design; it doesn't renegotiate it.
