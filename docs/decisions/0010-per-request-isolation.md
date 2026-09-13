# 0010 — Per-request isolation for concurrent wave dispatch

- **Status:** Accepted
- **Date:** 2026-09-13

## Decision

Extending records 0004, 0007, and 0009, concurrent wave dispatch runs under stock
host configuration without machine-global mutation:

1. **Per-request isolation instantiation:** The concurrent wave-dispatch contract
   defined in decision 0004 is instantiated through per-request `isolated: true` on
   each dispatched sub-agent task rather than requiring global configuration changes.
   Each sub-agent runs in its own isolated workspace and produces task artifacts
   reconciled solely by the session owner. Per-request isolation flags honor the
   host's stock default configuration without mutating `task.isolation.*` keys in
   the user's agent directory.
2. **Spike evidence:** Probing the host adapter under stock default configuration
   (pristine agent directory without overrides) yielded the following measured
   evidence:
   - *Pristine-dir probe:*
     Command:
     ```bash
     TMP=$(mktemp -d) && PI_CODING_AGENT_DIR="$TMP" omp config get task.isolation.enabled; PI_CODING_AGENT_DIR="$TMP" omp config get task.isolation.merge; PI_CODING_AGENT_DIR="$TMP" omp config get task.isolation.apply; rm -rf "$TMP"
     ```
     Verbatim output:
     ```
     false
     patch
     true
     ```
     Stock host configuration defaults are `task.isolation.enabled=false`,
     `task.isolation.merge=patch`, and `task.isolation.apply=true`, inverting all
     three global settings previously assumed in decision 0004.
   - *Per-request behavior probe:*
     Dispatching a sub-agent task with per-request `isolated: true` (a read-only probe
     requesting `git rev-parse HEAD`) succeeded under stock defaults without requiring
     global configuration changes. The sub-agent spawned in an isolated workspace
     (`T1SpikeRecord.ProbeSubagent ran isolated and cannot be resumed or messaged`)
     and returned completed with output:
     ```json
     {
       "output": "101423a1361cb1c18fbdf7b5eaf1cdb6fbbc9d9a",
       "commit_oid": "101423a1361cb1c18fbdf7b5eaf1cdb6fbbc9d9a"
     }
     ```
     and `<merge-summary>Isolation: no changes captured.</merge-summary>`.
   - *Artifact form:*
     Under stock defaults (`task.isolation.merge=patch`), the host adapter returns
     isolated changes as patch and merge-summary artifacts rather than creating git
     branches in the host repository (`git branch -a --list 'omp/task/*'` showed no
     sub-agent task branch created).
   - *Auto-apply observation:*
     After the isolated task completed, `git status --porcelain` remained clean and
     `git log --oneline -3` confirmed the shared tree remained untouched at wave base
     `101423a1361cb1c18fbdf7b5eaf1cdb6fbbc9d9a`.
3. **Supersession of global-config instantiation:** Decision 0004's global-config
   instantiation (`omp config set task.isolation.enabled true`, `merge: branch`,
   `apply: false`) is superseded by this record. The installer (`install.sh`) is
   advisory-only: it reports effective isolation settings and prints manual
   configuration commands for users who want global matching, but never invokes
   `omp config set` or mutates host configuration. The canonical serial fallback
   defined in GSD REFERENCE.md § Wave dispatch remains in full effect: whenever task
   isolation is unavailable or an isolated spawn fails, the session owner degrades
   the wave to strict serial dispatch of the same slices in plan order, never
   executing concurrent tasks unisolated in a shared working tree.
4. **Stock-config honoring:** The spike confirmed that per-request `isolated: true`
   is fully honored under stock defaults without machine-global configuration
   mutation. The session owner remains the sole integration point, reconciling
   task outputs while preserving the host environment intact.
