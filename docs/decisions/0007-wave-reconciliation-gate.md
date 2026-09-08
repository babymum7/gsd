# 0007 — Layered wave reconciliation gate

- **Status:** Accepted
- **Date:** 2026-09-08

## Decision

Extending record 0005, the session owner reconciles returned wave tasks through an
ordered five-layer gate before checkpointing: sub-agent reports are inadmissible,
`verify-task-branch` provides mechanical proof of task branch integrity, each new
or changed test must fail on the wave base as RED re-proof, a weakened-guard scan
rejects deleted, skipped, or renamed existing tests and loosened checks outside
slice ownership, and an integration proof re-runs every merged task's focused check
on `wip/<feature>` after plan-ordered merges and before `gsd-state.mjs set`.
Integrity failures return to bounded inline owner repair and are never re-dispatched.
