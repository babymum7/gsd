---
name: gsd-tdd
description: "Use as a helper while implementing observable behavior through an existing public seam."
produces: []
consumes: [docs/domain/index.md, docs/domain/<scope>.md, plan.md, state.toon]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: helper
- Helper-when: must load when an observable task is selected or repaired inline or in a wave-dispatched sub-agent; unskippable while condition holds
- Do-not-load: primary skill selection; resource-heavy browser/E2E task loops
- Transition: return green/red evidence to session owner

# Test-Driven Development

> **Direct invocation guard** — internal helper only; active owners compose it inline or pass to wave-dispatched sub-agents. Select an Invocation Mode, validate Required artifacts, follow Missing required actions, and apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract and § Fast TDD and task-loop constraints.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Session-owner task TDD | validated task slice from `plan.md`; bound `state.toon` | `docs/domain/index.md`; domain shards | — | Missing validated task slice: STOP and escalate; session owner rebuilds the plan-derived brief |
| Inline TDD support | — | `docs/domain/index.md`; domain shards | — | — |

Tests specify observable behavior through public interfaces and survive refactors; never test private shape or mocked internals.

## Fast TDD Check

A **Fast TDD Check** is deterministic, local, and cheap for repeated RED→GREEN→refactor: unit, contract, local integration, or in-process CLI/API. Browser/GUI, network, long-lived servers, large fixtures, and machine costs are Deferred Slow E2E.

The validated task slice selects its focused test seam from the bound Markdown plan. Consume that slice and pinned sections (including ordered Decisions) without reparsing plan or binding; missing or mismatched pins block. Target the highest deterministic fast public seam; lower seams require plan-recorded constraints. Source-text assertions, private probes, and fakes cannot substitute for behavior.

Keep RED/Green/refactor evidence in session-owner transcripts only; wave-dispatched sub-agents return evidence without adding runtime schemas.

## Anti-pattern: horizontal slices
Never batch tests before implementation. Use vertical tracer bullets: one focused public-seam test → all AC-required production layers and live code → verified green; repeat. Never assume universal layer stacks or accept test-only bypasses.

## Workflow
1. **Planning** — consume the exact validated task slice and relevant pinned sections; verify paths, criterion, interface pin, Fast TDD Check, safety facts, and artifact fidelity. Read indexed domain files signaled by task evidence. Derive required production layers and owned files; ambiguous ownership triggers Spec escalation.
2. **Tracer bullet** — write ONE focused public-seam test with **RED before implementation**, implement the minimal complete production path, then prove **GREEN after implementation**. Green doubles, partial layers, or bypasses are not green.
3. **Incremental loop** — repeat one behavior at a time; never run browser, GUI, network, server, large-fixture, or costly checks here.
4. **Refactor** — **refactor after green**, rerunning Fast TDD Checks after each step. Never refactor while RED; required sequence is RED→GREEN→refactor.

## Optional context signal
Context harvesting is optional, bounded to selected tasks, tests, implementation files, and read domain docs. Never scan repository-wide or create missing scaffolds. Load `gsd-domain-modeling` only for evidenced recurring terms or explicit decisions/rationales; generic vocabulary and code shape are no-ops.

Pre-binding material ambiguity uses domain modeling's one-question rule. Post-binding ambiguity in ACs, interfaces, or invariants returns to `gsd-executing-plans` for Spec escalation; otherwise continue without documentation questions.

## Per-cycle checklist
- [ ] Public-seam test defines concrete `action → observable state/value`, not implementation-coupled prose.
- [ ] Deterministic Fast TDD Check only; highest usable seam and lower-seam rationale match plan.
- [ ] Covers every behavior-derived layer and at least one owned file per layer.
- [ ] RED, GREEN, refactor evidence is truthful and transcript-only; missing green blocks landing.
- [ ] Minimal code; no speculative features or whole-journey duplication.

Optional detail, read only when a step requires it: [tests.md](tests.md), [mocking.md](mocking.md), [refactoring.md](refactoring.md).
