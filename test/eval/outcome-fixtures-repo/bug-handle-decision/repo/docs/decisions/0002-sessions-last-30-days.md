# 0002 - Sessions last 30 days

- **Status:** Accepted
- **Date:** 2026-02-17

## Decision

A session lasts 30 days from sign-in. Activity does not extend it, and signing in again starts a new session.

## Rationale

A fixed expiry keeps session handling simple and bounds how long a stolen session works.
