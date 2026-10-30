# 0005 - Notifications go out hourly

- **Status:** Accepted
- **Date:** 2026-04-08

## Decision

Notifications are queued and sent once an hour, one batch per user holding everything queued for that user, in the order it was queued.

## Rationale

People asked for fewer messages, and one batch an hour kept the important ones timely.
