---
name: gsd-tdd
description: "Use as a helper while implementing observable behavior through an existing public seam."
produces: []
consumes: [docs/domain/index.md, docs/domain/<scope>.md, plan.md, state.toon]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: helper
- Helper-when: must load when an observable task is selected or repaired inline or in a wave-dispatched sub-agent; cannot be skipped while that condition holds
- Do-not-load: primary skill selection; resource-heavy browser/E2E task loops
- Transition: return green/red evidence to the session owner

# Test-Driven Development

> **Direct invocation guard** — internal helper only; an active owner composes it inline or passes it to a wave-dispatched sub-agent. Select an Invocation Mode, validate only that row's Required artifacts, and follow its Missing required action. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract and § Fast TDD and task-loop constraints.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Session-owner task TDD | validated task slice from `plan.md`; bound `state.toon` | `docs/domain/index.md`; relevant domain shards | — | Missing validated task slice: STOP and escalate; the session owner must rebuild the plan-derived brief |
| Inline TDD support | — | `docs/domain/index.md`; relevant domain shards | — | — |

Tests specify observable behavior through public interfaces and should survive internal refactors; never test private shape or mocked internals.

## Fast TDD Check

A **Fast TDD Check** is deterministic, local, and cheap enough for repeated RED→GREEN→refactor: unit, contract, local integration, or in-process CLI/API. No browser or GUI, external network, long-lived server, large fixture, or material machine cost; those are Deferred Slow E2E.

The validated task slice selects its focused test seam from the bound Markdown plan. Consume that exact slice and relevant pinned sections, including ordered Decisions, without reparsing plan/binding. Missing or mismatched pins block. Use the highest deterministic existing fast public seam; use a lower seam only for a plan-recorded constraint. Source-text assertions, private-helper probes, and test-only fakes cannot substitute for behavior.

Keep RED/Green/refactor evidence in session-owner reporting/transcripts only; a wave-dispatched sub-agent returns its evidence to the session owner, and add no runtime schema.

## Anti-pattern: horizontal slices
Never batch all tests before implementation. Use vertical tracer bullets: one focused public-seam test → every production layer required by the AC and live code → verified green; repeat. Do not assume a universal layer stack or stop at a test-only bypass.

## Workflow
1. **Planning** — consume the exact validated task slice and relevant pinned sections; verify paths, criterion, interface pin, focused Fast TDD Check, safety facts, and artifact fidelity. Read only indexed domain files already signaled by task evidence. Derive required production layers and owned files; missing or ambiguous ownership is Spec escalation.
2. **Tracer bullet** — write ONE focused public-seam test with **RED before implementation**, implement the minimal complete production path, then prove **GREEN after implementation**. A green double, partial layer, or bypass is not green.
3. **Incremental loop** — repeat one behavior at a time; never run browser/GUI/network/long-lived/large-fixture/material-cost checks here.
4. **Refactor** — **refactor after green**, rerunning the Fast TDD Check after each step. Never refactor while RED; the required sequence is RED→GREEN→refactor.

## Optional context signal
Context harvesting is optional and bounded to the selected task, tests, implementation files, and relevant domain docs already read. Never scan repository-wide or create missing scaffolds. Load `gsd-domain-modeling` only for an already-evidenced recurring project term or explicit decision/rationale; generic vocabulary and code shape are no-op.

Pre-binding material ambiguity uses domain modeling's one-question rule. Post-binding ambiguity in an AC, interface, or invariant returns to `gsd-executing-plans` for Spec escalation; otherwise ask no documentation question and continue.

## Per-cycle checklist
- [ ] Public-seam test has concrete `action → observable state/value`, not implementation-coupled prose.
- [ ] Deterministic Fast TDD Check only; highest usable seam and any lower-seam reason match the plan.
- [ ] Covers every behavior-derived required layer and at least one owned file per layer.
- [ ] RED, GREEN, then refactor evidence is truthful and transcript-only; missing green blocks landing.
- [ ] Minimal code; no speculative feature or terminal whole-journey duplication.

Optional detail, read only when a step needs it: [tests.md](tests.md), [mocking.md](mocking.md), [refactoring.md](refactoring.md).
