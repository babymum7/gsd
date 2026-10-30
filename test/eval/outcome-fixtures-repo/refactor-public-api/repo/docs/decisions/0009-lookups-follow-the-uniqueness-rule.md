# 0009 - Lookups follow the uniqueness rule

- **Status:** Accepted
- **Date:** 2026-08-25

## Decision

Wherever an account is found from a handle typed as text, in `findByHandle` or in an `@mention`, every spelling that decision 0004 treats as the same handle finds that account. A mention is rendered with the stored handle, never with the spelling it was typed in.

## Rationale

A uniqueness rule that lookups ignore leaves names that are taken but cannot be found.
