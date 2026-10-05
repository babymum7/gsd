# 0029 — Skills-only install for harnesses without an adapter

- **Status:** Accepted
- **Date:** 2026-09-27

## Decision

`gsd install --skills-dir <dir>` builds the normal bundle, then writes the visible skills into `<dir>` with every `<GSD_ROOT>` replaced by the bundle's absolute `core/` path, plus a visible `gsd` router skill: the master bootstrap body under a preamble that names `GSD_ROOT` and `GSD_SESSION: skills-only`. Hidden helper skills stay in `core/`. Every skills-only session shares the owner `skills-only`, and no recovery capsule is delivered after compaction. Install refuses to overwrite a skill directory without the `.gsd-skill` marker; uninstall removes only marked directories. The skills directory is recorded in CLI state beside plugin agents, so the bundle is deleted only once neither uses it.

## Rationale

Without a session hook nothing injects the bootstrap, the root path, or a session id, so each skill must carry its own resolved path and the router must be discoverable like any other skill. A per-session owner would need a host session id the harness does not expose; a shared fixed owner keeps resume working at the cost of parallel-session scoping, which the README states. Adding an adapter remains the way to get the full lifecycle.

## Amendment

Amended 2026-10-05. Decision 0030 replaces the shared `skills-only` owner: each skills-only session now mints its own owner token, and a token lost to compaction makes the earlier packet resume only when the user names it.
