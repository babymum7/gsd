# 0002 — Superseded tasks keep their criterion references

- **Status:** Accepted
- **Date:** 2026-08-23

## Decision

An amended full plan may keep a `superseded` task's `Satisfies` references pointing at
criteria that are themselves `superseded`, so amendment history stays verbatim instead of
being rewritten to survive validation. Live (non-superseded) tasks still satisfy active
criteria only, every active criterion remains covered exactly once across non-superseded
tasks, and any task naming a criterion ID that does not exist is rejected.
