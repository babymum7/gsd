# 0010 — Per-request isolation for concurrent wave dispatch

- **Status:** Accepted
- **Date:** 2026-09-13

## Decision

Extending records 0004, 0007, and 0009: concurrent wave dispatch is instantiated
through per-request `isolated: true` on each dispatched sub-agent task, and it
requires the host's global `task.isolation.enabled=true`. Under the host's stock
default configuration (`enabled=false`, `merge=patch`, `apply=true`), the
per-request flag is not honored — a dispatched sub-agent runs directly in the
parent checkout — so the canonical serial fallback is the default path on stock
config, and the installer's advisory commands are the opt-in for concurrent
isolated dispatch.

1. **Per-request isolation instantiation:** The concurrent wave-dispatch contract
   defined in decision 0004 is instantiated through per-request `isolated: true`
   on each dispatched sub-agent task rather than requiring session-global
   per-task isolation settings to be flipped before every wave. Each sub-agent
   runs in its own isolated workspace and produces task artifacts reconciled
   solely by the session owner. The instantiation requires global
   `task.isolation.enabled=true`; it does not honor the per-request flag when
   the global switch is off (see the falsification probe below).

2. **Spike evidence (corrected attribution, 2026-09-13):**
   - *Pristine-dir probe (stock defaults measured safely):*
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
   - *Per-request behavior probe (ran under the real session config, not stock):*
     Dispatching a read-only sub-agent task with per-request `isolated: true`
     succeeded and spawned in an isolated workspace — but that observation was
     made under this machine's session configuration
     (`enabled=true`/`merge=branch`/`apply=false`), not under stock defaults, so
     it does not establish stock-config behavior. Its "no changes captured"
     merge-summary also observed nothing about artifact form, because the probe
     task produced no changes. The original record wrongly cited these two
     observations as stock-default evidence.
   - *Falsification probe (stock defaults, measured via per-run overlay):*
     With a throwaway git repository and a per-run config overlay containing
     exactly the stock triple (`enabled=false`, `merge=patch`, `apply=true`):
     ```bash
     omp launch --config /tmp/stock-probe/stock.yml -p --mode json --no-extensions --no-skills --no-rules --no-lsp --no-session --no-title --max-time 240 "<prompt instructing exactly one sub-agent task with isolated:true that creates a file and commits it in its working directory>"
     ```
     The captured JSON stream shows the child passed `"isolated":true` in the
     task-tool arguments, yet the sub-agent's cwd was the parent repository
     itself and its commit (`364a98f spike`) landed directly on the parent's
     `main` — no isolated workspace, no task branch, no worktree. A control run
     with the identical prompt and flags but without the overlay (real config,
     `enabled=true`) kept the parent repository clean at its base commit with
     the sub-agent running in an isolated worktree under `~/.omp/wt/`. The only
     differing variable is the overlay: per-request `isolated: true` is not
     honored when global `task.isolation.enabled=false`.
   - *Stock merge/apply semantics (host schema, not runtime-measured):* the
     host's own schema descriptions state that `merge=patch` integrates
     isolated changes as patch apply and that `apply=true` "automatically
     appl[ies] successful isolated task changes to the parent checkout". Even
     with `enabled=true`, stock `merge`/`apply` values therefore bypass the
     owner-reconciles-branches gate that decision 0004 established; the
     advisory enable commands remain the opt-in for the full branch-gate form.
   - *Method note:* stock-default measurements are taken only through a per-run
     `--config` overlay or a pristine throwaway agent dir
     (`PI_CODING_AGENT_DIR` on an empty temporary directory). The real agent
     configuration is never flipped, read-modified, or written to measure —
     flipping the machine-global config is an unannounced side effect on every
     other session and is out of bounds for a measurement.

3. **Supersession of global-config instantiation:** Decision 0004's
   global-config instantiation (`omp config set task.isolation.enabled true`,
   `merge: branch`, `apply: false`) is superseded by this record: the installer
   (`install.sh`) is advisory-only — it reports effective isolation settings and
   prints manual configuration commands, but never invokes `omp config set` or
   mutates host configuration. The advisory commands are now load-bearing for
   concurrent isolated wave dispatch: `enabled=true`/`merge=branch`/`apply=false`
   is the measured configuration under which isolated sub-agents run in separate
   workspaces on separate task branches reconciled by the owner. The canonical
   serial fallback defined in GSD REFERENCE.md § Wave dispatch remains in full
   effect and is the default path under stock config: whenever task isolation
   is unavailable — including stock `enabled=false` — or an isolated spawn
   fails, the session owner degrades the wave to strict serial dispatch of the
   same slices in plan order, never executing concurrent tasks unisolated in a
   shared working tree.

4. **Concurrent-dispatch requirement:** Concurrent isolated wave dispatch
   requires the host to run sub-agents isolated (global
   `task.isolation.enabled=true`, with `merge=branch`/`apply=false` for the
   owner-reconciled branch-gate form). The session owner remains the sole
   integration point, reconciling task outputs while preserving the host
   environment intact; on stock hosts the same owner runs the identical slices
   serially.
