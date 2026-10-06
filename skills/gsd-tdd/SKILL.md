---
name: gsd-tdd
description: "Use as a helper while implementing observable behavior through an existing public seam."
hide: true
produces: []
consumes: [docs/domain/index.md, docs/domain/<scope>.md, plan.md, state.toon]
---

# Test-Driven Development

Read by the owner of an observable task, inline or in a wave sub-agent, and while repairing one; it returns green or red evidence to the session owner. It needs the validated task slice from `plan.md`; without one, stop and escalate so the owner rebuilds it.

Tests specify observable behavior through public interfaces and survive refactors; never test private shape or mocked internals.

## Fast TDD Check

A **Fast TDD Check** is deterministic, local, and cheap enough to repeat: unit, contract, local integration, or in-process CLI/API. Everything slower is Deferred Slow E2E under `GSD_ROOT/skills/gsd/REFERENCE.md` § Fast TDD and task-loop constraints.

The task slice selects the focused seam from the bound plan, with its pinned sections and ordered Decisions; a pin missing from the slice, or differing from the bound plan, blocks. A task serving several pinned criteria proves each at its own seam, with its own RED and GREEN. Target the highest deterministic fast public seam; a lower seam needs the reason the plan records. Source-text assertions, private probes, and fakes never substitute for behavior. RED, GREEN, and refactor evidence stays in transcripts; nothing adds runtime schema.

## Workflow

1. **Plan** — verify the slice: paths, criteria, interface pins, Fast TDD Check. Derive the production layers the criterion needs and the owned files; ambiguous ownership is Spec escalation.
2. **Tracer bullet** — write one focused public-seam test, see **RED before implementation**, implement the minimal complete production path, then prove **GREEN after implementation**. Green doubles, partial layers, or bypasses are not green.
3. **Incremental loop** — one behavior at a time, vertically: never batch tests ahead of implementation, and never assume a universal layer stack or accept a test-only bypass.
4. **Refactor** — **refactor after green**, rerunning the checks after each step; never while RED. See [refactoring.md](refactoring.md) when the step is more than a rename.

Read indexed domain shards only when the task evidences them, and `GSD_ROOT/skills/gsd-domain-modeling/SKILL.md` only for evidenced recurring terms or explicit decisions. After binding, ambiguity in criteria, interfaces, or invariants returns to `gsd-executing-plans` for Spec escalation; otherwise continue without documentation questions.
