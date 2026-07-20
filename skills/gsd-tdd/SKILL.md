---
name: gsd-tdd
description: "Use as a helper while implementing observable behavior through an existing public seam, especially from gsd-executing-plans or gsd-diagnosing-bugs. Do not start a lifecycle or create a plan."
triggers: active executor or diagnosis requests focused red-green-refactor support
produces: []
consumes: [docs/domain/index.md, docs/domain/<scope>.md, plan.md, state.toon]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: helper
- Helper-when: must load when an observable task is dispatched or repaired; cannot be skipped while that condition holds
- Do-not-load: primary skill selection; resource-heavy browser/E2E task loops
- Transition: return green/red evidence to the parent owner

# Test-Driven Development

> **Direct invocation guard** — internal GSD sub-skill. `gsd-executing-plans` loads it for dispatched task TDD; another active parent skill may compose inline TDD support, but automatic selection never makes TDD a standalone primary owner. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract: select an Invocation Mode below before validating only that row's Required artifacts, then follow its Missing required action. A missing Optional artifact never reroutes the invocation.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Dispatched task TDD | validated task slice from `plan.md`; bound `state.toon` | `docs/domain/index.md`; relevant domain shards | — | Missing validated task slice: STOP and escalate; parent must supply the plan-derived brief |
| Inline TDD support | — | `docs/domain/index.md`; relevant domain shards | — | — |

Tests verify **behavior through public interfaces**, not implementation. Code can change entirely; tests shouldn't. A good test reads like a spec ("user can checkout with valid cart") and survives refactors. A bad test is coupled to implementation (mocks internals, tests privates) — it breaks on refactor though behavior is unchanged.

## Fast TDD Check

A **Fast TDD Check** is a deterministic local test command suitable for repeated RED→GREEN→refactor use: no browser or GUI, no external network, no long-lived server, no large fixture, and no material machine cost. It may be unit, contract, local integration, or in-process CLI/API harness work. Resource-heavy journeys are Deferred Slow E2E and never run inside the implementation task loop.

The parent-built validated task slice selects its focused test seam from the approved Markdown plan as a Fast TDD Check and trusts the plan binding already validated by the parent (SHA-256 hash checked at resume/terminal boundaries, not per task). The implementer and TDD skill consume the validated task slice and relevant pinned sections (including the lossless ordered Decisions) directly without independently reparsing `plan.md`; missing, duplicate, unknown, superseded-only, conflicting, or mismatched pins block rather than being inferred or normalized. Start at the **highest deterministic existing fast public interface/harness** that observes the criterion through production behavior. Prefer an existing local public module, contract, or in-process CLI/API seam; never select browser, GUI, external network, long-lived server, large-fixture, or material-cost seams for the implementation task loop.

Triggered by `gsd-executing-plans` for each observable task's **Focused TDD test**. That focused check is a Fast TDD Check; it proves one task's selected-seam behavior and is distinct from terminal whole-journey or Deferred Slow E2E.

Red/Green/refactor evidence stays in executor/reviewer reporting and transcripts only. Do not add persistent TDD evidence tables, fields, or schema to runtime TOON.

## Anti-pattern: horizontal slices
**Do NOT write all tests, then all implementation, and do not batch a tests layer before implementation layers.** Bulk tests test *imagined* behavior and the *shape* of things — they pass when behavior breaks, fail when it's fine. **Vertical slices via tracer bullets**: begin at the selected public seam; derive the behavior's required production layers from the AC and live codebase, then one focused test → exactly every required layer → verified green; repeat. Avoid assuming a universal UI/API/domain/storage stack, omitting a required layer, or stopping at a test-only bypass.

```
WRONG:  RED: test1..5  →  GREEN: impl1..5
RIGHT:  RED→GREEN: test1→impl1, test2→impl2, ...
```

## Workflow
1. **Planning** — consume the exact validated task slice and relevant pinned sections (including the lossless ordered Decisions) directly without independently reparsing `plan.md`, and verify its task-brief facts (source paths, criterion, interface pin, focused Fast TDD Check, and safety facts). When task evidence already contains a durable domain signal, read `docs/domain/index.md` and only the relevant indexed shard(s); otherwise perform no domain read. Derive every production layer and owned file required for the behavior, not generic implementation layers.
2. **Tracer bullet** — at the selected fast public seam, write ONE focused test confirming ONE observable thing with **RED before implementation** (the new test fails for the missing behavior) → implement the minimal production path through every required layer → **GREEN after implementation** (that same test passes). Never stop at a green test double, implementation layer, or partial path. Never run browser/GUI/network/long-lived/large-fixture/material-cost checks in this loop.
3. **Incremental loop** — for each remaining behavior, RED → GREEN. Write one focused test at a time and only enough production code to pass.
4. **Refactor** — after every focused behavior is verified green, **refactor after green**: remove duplication and deepen modules where natural, running the Fast TDD Check after each step. Never refactor while RED. The required sequence is RED→GREEN→refactor.

## Optional context signal
Context harvesting is optional and bounded to the selected test/task. Reuse only the validated task slice, tests, implementation files, and relevant domain docs already read for TDD; never run a repository-wide term/decision scan or create missing scaffolds. Trigger `gsd-domain-modeling` only if that already-relevant work reveals a recurring project-specific term or explicit decision/rationale signal. Generic test vocabulary, fixture names, one-off identifiers, and code shape are no-op. This skill never writes a domain artifact itself.

Inline pre-approval TDD delegates material term/ownership/trade-off ambiguity to domain modeling's one-question rule. Dispatched TDD is post-approval: ask zero documentation questions; return load-bearing AC/interface/invariant ambiguity to `gsd-executing-plans` for Spec escalation, otherwise skip the documentation write and keep the RED→GREEN loop moving.

## Per-cycle checklist
- [ ] Focused test describes behavior, not implementation, and has a concrete `action → expected observable result`: actual operation/input at the seam → observed subject with explicit state/value, never padded generic pass prose.
- [ ] Uses a Fast TDD Check only: unit, contract, local integration, or in-process CLI/API; no browser or GUI, no external network, no long-lived server, no large fixture, no material machine cost.
- [ ] Would survive an internal refactor.
- [ ] Starts at the deterministic highest usable existing fast public seam; a present pin matches, and any lower seam has the existing concrete reason.
- [ ] Covers exactly every behavior/codebase-derived required layer with at least one owned file per layer.
- [ ] Records RED before implementation, GREEN after implementation, and refactor after green in reporting and transcripts only; false or missing green blocks landing.
- [ ] Code is minimal for this test.
- [ ] No speculative features or terminal whole-journey duplication.

Details: [tests.md](tests.md), [mocking.md](mocking.md), [refactoring.md](refactoring.md).
