# 0004 - Handles are unique regardless of case

- **Status:** Accepted
- **Date:** 2026-03-12

## Decision

No two accounts hold handles that are equal after trimming and `toLowerCase()`. `register` refuses a handle that matches a taken one this way with `handle taken`.

## Rationale

People could not tell `Ana` and `ana` apart in lists and mentions.
