---
name: gsd-tdd
description: Internal GSD sub-skill (routed via /gsd). Test-driven development — behavior through public interfaces, vertical tracer-bullet slices, red-green-refactor. Triggered by gsd-executing-plans for the per-task unit test.
triggers: gsd-executing-plans per-task unit test
produces: []
consumes: [CONTEXT.md]
---

# Test-Driven Development

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Invoked standalone with its `consumes:` artifacts missing → load the `gsd` skill and enter through its router (it detects workspace state); don't improvise missing context.

Tests verify **behavior through public interfaces**, not implementation. Code can change entirely; tests shouldn't. A good test reads like a spec ("user can checkout with valid cart") and survives refactors. A bad test is coupled to implementation (mocks internals, tests privates) — it breaks on refactor though behavior is unchanged.

Triggered by `gsd-executing-plans` for each task's unit test.

## Anti-pattern: horizontal slices
**Do NOT write all tests, then all implementation.** Bulk tests test *imagined* behavior and the *shape* of things — they pass when behavior breaks, fail when it's fine. **Vertical slices via tracer bullets**: one test → one implementation → repeat. Each test responds to what the previous cycle taught you.

```
WRONG:  RED: test1..5  →  GREEN: impl1..5
RIGHT:  RED→GREEN: test1→impl1, test2→impl2, ...
```

## Workflow
1. **Planning** — read `CONTEXT.md` if it exists (match domain vocabulary) + respect ADRs. Settle interface changes, which behaviors to test (prioritize — you can't test everything), and deep-module opportunities (`gsd-codebase-design`). List behaviors (not impl steps). **Dispatched headless by `gsd-executing-plans`** (the common path): derive all of this from the task-brief — no user to confirm with; the brief + `spec.md` ACs are the contract. **Invoked directly by a user**: confirm the behavior list and get approval before writing tests.
2. **Tracer bullet** — ONE test confirming ONE thing: RED (write test → fails) → GREEN (minimal code → passes). Proves the path end-to-end.
3. **Incremental loop** — each remaining behavior: RED → GREEN. One test at a time, only enough code to pass, no anticipating future tests, focused on observable behavior.
4. **Refactor** — after all green: extract duplication, deepen modules, SOLID where natural, consider what new code reveals about old. Run tests after each step. **Never refactor while RED.**

## Per-cycle checklist
- [ ] Test describes behavior, not implementation.
- [ ] Uses public interface only.
- [ ] Would survive an internal refactor.
- [ ] Code is minimal for this test.
- [ ] No speculative features.

Details: [tests.md](tests.md), [mocking.md](mocking.md), [refactoring.md](refactoring.md).
