# 0001 - User ids are sequential numbers

- **Status:** Accepted
- **Date:** 2026-02-03

## Decision

A user's id is the next whole number after the last one handed out, starting at 1, and it never changes. Profile links use the id: `/u/<id>`.

## Rationale

Ids appear in links people share, so they stay short and do not change when a handle does.
