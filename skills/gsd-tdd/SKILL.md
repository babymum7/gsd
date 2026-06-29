---
name: gsd-tdd
description: Test-driven development — behavior through public interfaces, vertical tracer-bullet slices, red-green-refactor. Triggered by gsd-executing-plans for the per-task unit test.
---

# Test-Driven Development

Tests verify **behavior through public interfaces**, not implementation. Code can change entirely; tests shouldn't. A good test reads like a spec ("user can checkout with valid cart") and survives refactors. A bad test is coupled to implementation (mocks internals, tests privates) — it breaks on refactor though behavior is unchanged.

Triggered by `gsd-executing-plans` for each task's unit test.

## Anti-pattern: horizontal slices
**Do NOT write all tests, then all implementation.** Bulk tests test *imagined* behavior and the *shape* of things — they pass when behavior breaks, fail when it's fine. **Vertical slices via tracer bullets**: one test → one implementation → repeat. Each test responds to what the previous cycle taught you.

```
WRONG:  RED: test1..5  →  GREEN: impl1..5
RIGHT:  RED→GREEN: test1→impl1, test2→impl2, ...
```

## Workflow
1. **Planning** — read `CONTEXT.md` if it exists (match domain vocabulary) + respect ADRs. Confirm with user: interface changes, which behaviors to test (prioritize — you can't test everything), identify deep-module opportunities (`gsd-codebase-design`). List behaviors (not impl steps). Get approval.
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
