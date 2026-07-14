---
name: gsd-tdd
description: "Use as a helper while implementing observable behavior through an existing public seam, especially from gsd-executing-plans or gsd-diagnosing-bugs. Do not start a lifecycle or create a plan."
triggers: active executor or diagnosis requests focused red-green-refactor support
produces: []
consumes: [docs/domain/index.md, docs/domain/<scope>.md, .scratch/<feature>/tasks/<Tn>/a<N>.toon]
---

# Test-Driven Development

> **Direct invocation guard** — internal GSD sub-skill. `gsd-executing-plans` loads it for dispatched task TDD; another active parent skill may compose inline TDD support, but automatic selection never makes TDD a standalone primary owner. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract: select an Invocation Mode below before validating only that row's Required artifacts, then follow its Missing required action. A missing Optional artifact never reroutes the invocation.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Dispatched task TDD | `.scratch/<feature>/tasks/<Tn>/a<N>.toon` | `docs/domain/index.md`; relevant domain shards | — | Missing attempt TOON: STOP and escalate; task-brief attempt must exist to proceed |
| Inline TDD support | — | `docs/domain/index.md`; relevant domain shards | — | — |

Tests verify **behavior through public interfaces**, not implementation. Code can change entirely; tests shouldn't. A good test reads like a spec ("user can checkout with valid cart") and survives refactors. A bad test is coupled to implementation (mocks internals, tests privates) — it breaks on refactor though behavior is unchanged.

The immutable task-brief attempt TOON (`.scratch/<feature>/tasks/<Tn>/a<N>.toon`) selects its focused test seam from the approved Markdown plan. The implementer and TDD skill consume the validated immutable attempt and relevant pinned sections (including the lossless ordered Decisions) directly without independently reparsing `plan.md`; missing, duplicate, unknown, superseded-only, conflicting, or mismatched pins block rather than being inferred or normalized. Start at the **highest deterministic existing public interface/harness** that observes the criterion through production behavior: an existing browser/CLI/HTTP interface when usable, otherwise the highest existing public module interface. At the same tier, honor the production entrypoint named by the criterion Action, then the repository's canonical existing harness convention, then greater production-path coverage with no test-only bypass; an unresolved tie returns to Discussion as materially ambiguous. The attempt TOON's seam, path, and lower-seam reason must match the criterion's exact Markdown Interfaces row; its focused check must match the plan task's Test. Use a lower seam only when that row's concrete reason establishes that the higher harness is absent or cannot deterministically isolate the criterion. Never pad or silently substitute a seam, and never invent a lower public or test-only interface because it is easier.

Triggered by `gsd-executing-plans` for each task's **Focused TDD test**. That focused check may be unit, integration, CLI, browser, or HTTP; it proves one task's selected-seam behavior and is distinct from the terminal whole-journey E2E.

## Anti-pattern: horizontal slices
**Do NOT write all tests, then all implementation, and do not batch a tests layer before implementation layers.** Bulk tests test *imagined* behavior and the *shape* of things — they pass when behavior breaks, fail when it's fine. **Vertical slices via tracer bullets**: begin at the selected public seam; derive the behavior's required production layers from the AC and live codebase, then one focused test → exactly every required layer → verified green; repeat. Avoid assuming a universal UI/API/domain/storage stack, omitting a required layer, or stopping at a test-only bypass.

```
WRONG:  RED: test1..5  →  GREEN: impl1..5
RIGHT:  RED→GREEN: test1→impl1, test2→impl2, ...
```

## Workflow
1. **Planning** — consume the exact immutable task attempt and relevant pinned sections (including the lossless ordered Decisions) directly without independently reparsing `plan.md`, and verify its task-brief facts (source paths/hashes, criterion, interface pin, focused check, and safety facts). When task evidence already contains a durable domain signal, read `docs/domain/index.md` and only the relevant indexed shard(s); otherwise perform no domain read. Derive every production layer and owned file required for the behavior, not generic implementation layers.
2. **Tracer bullet** — at the selected public seam, write ONE focused test confirming ONE observable thing: RED (test fails) → GREEN (the minimal production path through every required layer passes). Never stop at a green test double, implementation layer, or partial path. A focused browser/HTTP test remains per-task and does not replace terminal whole-journey E2E.
3. **Incremental loop** — for each remaining behavior, RED → GREEN. Write one focused test at a time and only enough production code to pass.
4. **Refactor** — after every focused behavior is verified green, remove duplication and deepen modules where natural, running tests after each step. Never refactor while RED.

## Optional context signal
Context harvesting is optional and bounded to the selected test/task. Reuse only the task-brief attempt TOON, tests, implementation files, and relevant domain docs already read for TDD; never run a repository-wide term/decision scan or create missing scaffolds. Trigger `gsd-domain-modeling` only if that already-relevant work reveals a recurring project-specific term or explicit decision/rationale signal. Generic test vocabulary, fixture names, one-off identifiers, and code shape are no-op. This skill never writes a domain artifact itself.

Inline pre-approval TDD delegates material term/ownership/trade-off ambiguity to domain modeling's one-question rule. Dispatched TDD is post-approval: ask zero documentation questions; return load-bearing AC/interface/invariant ambiguity to `gsd-executing-plans` for Spec escalation, otherwise skip the documentation write and keep the RED→GREEN loop moving.

## Per-cycle checklist
- [ ] Focused test describes behavior, not implementation, and has a concrete `action → expected observable result`: actual operation/input at the seam → observed subject with explicit state/value, never padded generic pass prose.
- [ ] Uses the selected public interface only; it may be unit, integration, CLI, focused browser, or focused HTTP.
- [ ] Would survive an internal refactor.
- [ ] Starts at the deterministic highest usable existing public seam; a present pin matches, and any lower seam has the existing concrete reason.
- [ ] Covers exactly every behavior/codebase-derived required layer with at least one owned file per layer.
- [ ] Drives one complete behavior through the production path, then produces and records its verified-green fact; false or missing green blocks landing.
- [ ] Code is minimal for this test.
- [ ] No speculative features or terminal whole-journey duplication.

Details: [tests.md](tests.md), [mocking.md](mocking.md), [refactoring.md](refactoring.md).
