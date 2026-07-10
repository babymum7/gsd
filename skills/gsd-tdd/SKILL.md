---
name: gsd-tdd
description: Internal GSD sub-skill (routed via /gsd). Focused TDD through public interfaces, vertical tracer-bullet slices, red-green-refactor. Triggered by gsd-executing-plans for each task's focused test/path/self-check.
triggers: gsd-executing-plans per-task focused TDD test
produces: []
consumes: [CONTEXT.md, docs/adr/]
---

# Test-Driven Development

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract: select an Invocation Mode below before validating only that row's Required artifacts, then follow its Missing required action. A missing Optional artifact never reroutes the invocation.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Dispatched task TDD | — | `CONTEXT.md`; `docs/adr/` | — | — |
| Direct TDD | — | `CONTEXT.md`; `docs/adr/` | — | — |

Tests verify **behavior through public interfaces**, not implementation. Code can change entirely; tests shouldn't. A good test reads like a spec ("user can checkout with valid cart") and survives refactors. A bad test is coupled to implementation (mocks internals, tests privates) — it breaks on refactor though behavior is unchanged.

The task-brief selects the focused test seam. Start at the **highest deterministic existing public interface/harness** that observes the AC through production behavior: an existing end-user harness (browser, CLI, or HTTP) when usable, otherwise the highest existing public module interface. At the same tier, honor the production entrypoint named by the AC/`Check:`, then the repository's canonical existing harness convention, then greater production-path coverage with no test-only bypass; an unresolved tie returns to Discussion as materially ambiguous. Use a lower seam only with the brief's concrete reason that the higher harness is absent or cannot deterministically isolate the AC. A present spec pin must match. A legacy no-pin brief may use its validated plan-row `test`, with `Lower-Seam Reason: none` at the highest seam or an existing spec reason below it. Never create or silently substitute a lower test-only interface because it is easier.

Triggered by `gsd-executing-plans` for each task's **Focused TDD test**. That focused check may be unit, integration, CLI, browser, or HTTP; it proves one task's selected-seam behavior and is distinct from the terminal whole-journey E2E.

## Anti-pattern: horizontal slices
**Do NOT write all tests, then all implementation, and do not batch a tests layer before implementation layers.** Bulk tests test *imagined* behavior and the *shape* of things — they pass when behavior breaks, fail when it's fine. **Vertical slices via tracer bullets**: begin at the selected public seam; derive the behavior's required production layers from the AC and live codebase, then one focused test → exactly every required layer → verified green; repeat. Avoid assuming a universal UI/API/domain/storage stack, omitting a required layer, or stopping at a test-only bypass.

```
WRONG:  RED: test1..5  →  GREEN: impl1..5
RIGHT:  RED→GREEN: test1→impl1, test2→impl2, ...
```

## Workflow
1. **Planning** — read `CONTEXT.md` and only relevant existing ADRs if they exist (match domain vocabulary). Take the selected public seam and any lower-seam reason from the task-brief; verify its present pin or validated legacy no-pin proposal against the AC `Check:`, deterministic same-tier tie-break, and relevant live test layout before writing. Derive the exact required behavior layers and owned files from the AC/live codebase; list complete behaviors, not generic implementation layers. **Dispatched headless by `gsd-executing-plans`** (the common path): derive all of this from the task-brief — no user to confirm with; the brief + `spec.md` ACs are the contract. **Invoked directly by a user**: inspect and select the seam under the same ladder, then confirm the behavior list and get approval before writing tests.
2. **Tracer bullet** — at the selected public seam, write ONE focused test confirming ONE observable thing: RED (test fails) → GREEN (minimal production path through exactly every required layer for that behavior passes). This proves one complete task seam end-to-end; never stop at a green test double, implementation layer, or partial path. A focused browser/HTTP test is still per-task; it does not replace the terminal whole-journey E2E.
3. **Incremental loop** — each remaining behavior: RED → GREEN. One focused test at a time, only enough code to pass, no anticipating future tests, focused on observable behavior.
4. **Refactor** — after all focused tests have produced verified-green facts: extract duplication, deepen modules, SOLID where natural, consider what new code reveals about old. Run tests after each step. **Never refactor while RED.**

## Optional context signal
Context harvesting is optional and bounded to the selected test/task. Reuse only the task brief, tests, implementation files, and relevant domain docs already read for TDD; never run a repository-wide term/ADR scan or create missing scaffolds. Trigger `gsd-domain-modeling` only if that already-relevant work reveals a recurring project-specific term or explicit decision/rationale signal. Generic test vocabulary, fixture names, one-off identifiers, and code shape are no-op. This skill never writes a domain artifact itself.

Direct pre-approval TDD delegates material term/ownership/trade-off ambiguity to domain modeling's one-question rule. Dispatched TDD is post-approval: ask zero documentation questions; return load-bearing AC/interface/invariant ambiguity to `gsd-executing-plans` for Spec escalation, otherwise skip the documentation write and keep the RED→GREEN loop moving.

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
