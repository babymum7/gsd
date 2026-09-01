# 0006 — Inline single-task waves

- **Status:** Accepted
- **Date:** 2026-09-01

## Decision

A single-task wave executes inline by the session owner with `gsd-tdd`:
no sub-agent, no task branch, and no two-ended dispatch verification, since
isolation protects nothing when only one task runs. Waves of two or more
tasks keep decision 0004 unchanged: isolated per-task sub-agents on task
branches, serial fallback in plan order when isolation is unavailable or an
isolated spawn fails, and owner reconciliation in strict plan order.
Decision 0004 itself stays Accepted and unchanged: its isolation rule already
governs waves of two or more tasks only. This decision supersedes the
single-task dispatch rule the REFERENCE and skill contracts carried
("single-task waves to exactly one sub-agent"); decision 0005's two-ended
verification applies to dispatched tasks only.
