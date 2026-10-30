# 0008 - Names keep the spelling people chose

- **Status:** Accepted
- **Date:** 2026-07-14

## Decision

A name a person chooses for themselves, such as a handle, is stored and shown exactly as typed, without surrounding spaces. A rule that treats two spellings as the same name compares them and never rewrites the stored spelling.

## Rationale

Lower-casing names when they were saved made profiles look wrong, and support had to restore the original spellings by hand.
