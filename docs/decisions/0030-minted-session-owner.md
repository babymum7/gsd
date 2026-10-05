# 0030 — Sessions without a host id mint their own owner token

- **Status:** Accepted
- **Date:** 2026-10-05

## Decision

A session whose host supplies no session id mints its own `GSD_SESSION` with `bun tools/gsd-state.mjs session`, which prints `local-<uuid>`. The skills-only router and an adapter hook that received no id both inject `GSD_SESSION: unset` with that command in place of a token, and the canon tells a session with no `GSD_SESSION` at all to do the same. This replaces the shared `skills-only` owner of decision 0029. Packets already recorded under `skills-only` keep it, and `derive-base` still says that owner proves nothing.

## Rationale

The shared owner let every skills-only session see, resume, and checkpoint every other one's packet, so two parallel sessions in one work tree were not scoped apart, and the owner checks of `gsd-state.mjs set` could not tell them apart. A minted token gives each session its own packets with no host support. The cost is compaction: no capsule carries the token in a skills-only or id-less session, so a session that loses it mints a new one, and its earlier packet then resumes only when the user names it (`--takeover`). Resuming a named packet is one sentence from the user; two sessions writing one packet was silent.
