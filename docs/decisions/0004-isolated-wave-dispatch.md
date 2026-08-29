# 0004 — Isolated wave dispatch for concurrent sub-agents

- **Status:** Accepted
- **Date:** 2026-08-29

## Decision

Waves of two or more independent tasks dispatch with task isolation: each
sub-agent works in its own isolated workspace and commits green task-owned
changes on its own task branch, so concurrent tasks never mutate one shared
working tree. When task isolation is unavailable or an isolated spawn fails,
the owner degrades the wave to strict serial dispatch of the same slices —
one task at a time in plan order — and never runs concurrent tasks in one
shared tree. The owner stays the sole integration point, merging each
returned task branch into `wip/<feature>` in strict plan order before the
wave's green checkpoint. The core GSD contract stays harness-generic: skills,
README, and domain prose name no harness-specific identifier. This harness
instantiates the contract with OMP task isolation — per-task `isolated: true`,
`task.isolation.mode: auto`, `merge: branch`, `apply: false`, per-task branch
`omp/task/<name>` — and another harness satisfies the same contract with its
own equivalent isolation mechanism.
