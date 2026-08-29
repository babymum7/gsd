# 0004 — Isolated wave dispatch for concurrent sub-agents

- **Status:** Accepted
- **Date:** 2026-08-29

## Decision

Waves of two or more independent tasks dispatch with OMP task isolation
(`isolated: true` per task, `task.isolation.mode: auto`, `merge: branch`,
`apply: false`): each sub-agent works in its own isolated workspace and commits
green task-owned changes to its `omp/task/<name>` branch, so concurrent tasks
never mutate one shared working tree. When isolation is unavailable or the
spawn fails, the owner degrades the wave to strict serial dispatch of the same
slices — never concurrent work in the shared tree. The owner stays the sole
integration point: it merges each returned task branch into `wip/<feature>` in
strict plan order before the wave's green checkpoint.
