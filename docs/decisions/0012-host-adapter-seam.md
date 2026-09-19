# 0012 — Host-adapter seam for OMP, Claude Code, and Codex

- **Status:** Accepted
- **Date:** 2026-09-19

## Decision

Supersedes only decision 0009 §3, which deferred a host engine "until a real
second harness exists". Claude Code and Codex are now real second and third
harnesses, so the deferral's own condition is met and the seam is extracted now.
Everything else in 0009 stands unchanged: `lib/`, `tools/`, and `skills/` stay
identifier-clean as the harness-generic core, and each host's coupling stays
confined to that host's adapter surface.

1. **Generic core stays host-neutral.** The reusable engine is
   `lib/gsd-bootstrap.mjs` (bootstrap, recovery capsule, current-request
   extraction) plus `lib/gsd-state.mjs` candidate discovery. These functions take
   no host argument and name no host identifier; the guard in
   `test/skills-harness.test.js` keeps enforcing that over `lib/`, `tools/`, and
   `skills/`.
2. **One adapter per host.** Every host-specific surface lives under
   `adapters/<host>/` and is the only place that names that host's events,
   configuration files, binaries, or feature flags: the OMP adapter (today's
   `extensions/gsd-context.js` and `install.sh`, re-homed under `adapters/omp/`
   by a later mechanical move that keeps those paths working),
   `adapters/claude-code/`, and `adapters/codex/`. Adding a host adds exactly one
   directory and never edits the core or a sibling adapter.
3. **One injected contract, host-native delivery.** Every adapter injects the two
   payloads the core renders — the session bootstrap at session start and the
   recovery capsule across compaction — through the mechanism that host actually
   supports. A host without pre-compaction context injection delivers the capsule
   on the first turn after compaction instead; a host without session-scoped
   injection re-emits only when its own marker says the bootstrap is absent.
4. **Host-native feature mapping is declared, not assumed.** Each adapter
   declares which host features it can use for GSD's needs — plan mode, goals,
   sub-agents, isolated task workspaces, context injection, pre- and
   post-compaction delivery — and maps the core's route and depth decisions onto
   them. A feature a host lacks is never faked in that host; the adapter names the
   serial or inline fallback instead. The declared map is `adapters/README.md`.
5. **Unsupported-host safety is unchanged.** An adapter that cannot validate its
   payloads fails closed with a visible diagnostic and leaves the host's ordinary
   behavior intact, exactly as the OMP adapter does today. No adapter falls back to
   stale home-directory skills or a partial catalog.
