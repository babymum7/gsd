# 0005 — Owner verification at both ends of wave dispatch

- **Status:** Accepted
- **Date:** 2026-08-29

## Decision

The session owner verifies both ends of every dispatch through the existing
build-slice and reconcile steps, adding no node, skill, or review round: before
dispatch it re-reads each dispatch prompt against the validated slice and
rebuilds any prompt found missing slice facts; before merge it inspects each
returned task — diff scope matches the slice, it re-runs the task's focused
check, and it reads the diff for evident defects — returning any failed task to
the existing bounded inline repair.
