# 0015 — OMP adapter surfaces re-homed under adapters/omp/

- **Status:** Accepted
- **Date:** 2026-09-19

## Decision

Executes the mechanical re-home that decision 0012 §2 planned, and supersedes
only the surface-file inventory in decision 0009 §2. The OMP coupling now lives
entirely under `adapters/omp/`, exactly like `adapters/claude-code/` and
`adapters/codex/`.

1. `adapters/omp/gsd-context.js` is the OMP adapter body. It names the host's
   session lifecycle events, prompt-injection events, compaction events,
   messaging API, and task isolation, and it renders the shared core's bootstrap
   and recovery capsule from `lib/`.
2. `adapters/omp/gsd-context.d.ts` is the hand-maintained public type surface,
   moved beside the module it types.
3. `adapters/omp/install.sh` is the OMP installer. Its `REPO` derivation moves
   from one directory level up to two, so the published extension symlink and
   every legacy-artifact preflight target still resolve against the checkout
   root.
4. The OMP entry paths are unchanged, thin, and host-identifier-free:
   `extensions/gsd-context.js` and `extensions/gsd-context.d.ts` re-export the
   adapter, and the root `install.sh` forwards its arguments and environment to
   `adapters/omp/install.sh`. `bash install.sh`, the published
   `~/.omp/agent/extensions/gsd-context.js` symlink, and existing importers of
   `extensions/gsd-context.js` all keep working, and the injected bootstrap and
   recovery-capsule bytes are unchanged.

The consumed host surface inventory in decision 0009 §2 — the events, the
messaging API, and task isolation the adapter uses — is unchanged. Decision 0009
§1's identifier guard over `lib/`, `tools/`, and `skills/` is also unchanged:
the OMP coupling is now confined to `adapters/omp/`, with the entry shims naming
no host identifier.
