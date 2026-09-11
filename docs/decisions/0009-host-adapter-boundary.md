# 0009 — Host-adapter boundary: generic core, single OMP adapter

- **Status:** Accepted
- **Date:** 2026-09-11

## Decision

Extending records 0004 and 0007, the GSD core stays harness-generic and the
harness coupling stays confined to the adapter surfaces. Concretely:

1. `lib/`, `tools/`, and `skills/` (including the canon `REFERENCE.md`) name no
   harness-specific identifier. A regression test in `test/skills-harness.test.js`
   locks this by scanning those trees for `OMP_`, `PI_CODING_AGENT_DIR`,
   `PI_PROFILE` (enumerated literally so `API_` cannot false-positive),
   `pi.on(`, `pi.logger`, `pi.sendMessage`, `.omp/`, `omp config`, `omp/task/`,
   and the compaction event tokens `session.compacting` and `event.messages`,
   failing on any match. The canon's single documented drift sentence
   (section 4) is pinned as the one asserted-present-then-excised exception.
2. `extensions/gsd-context.js` and `install.sh` are the sole OMP adapter
   surfaces. The adapter consumes exactly this host surface: session lifecycle
   events (`session_start`, `session_switch`, `session_branch`, `session_tree`,
   `session_shutdown`), prompt-injection events (`before_agent_start` for the
   system-policy block, `context` for the bootstrap message), compaction events
   (`session.compacting` for the recovery capsule and current-request
   extraction, `session_compact` for the next-turn delivery), the host messaging
   API (`sendMessage` with `deliverAs: nextTurn`, `triggerTurn: false`), the
   host logger, and task isolation (per-task isolated workspaces with
   `merge: branch` per decision 0004). Any second harness port starts from
   this inventory.
3. No host-engine interface is extracted yet. Splitting
   `extensions/gsd-context.js` into a harness-neutral engine plus a thin
   adapter is deferred until a real second harness exists: the repo's seam
   discipline forbids inventing an interface from one production adapter. The
   core is now guarded identifier-clean: one lib comment drift the first
   hardened scan caught has been reworded, and the remaining drift is only the
   canon sentence deferred in section 4.
4. Known limitation, deferred: `skills/gsd/REFERENCE.md` § Current Request
   Preservation still words the compaction hook with this harness's event names
   (`session.compacting`, `event.messages`). The prose is harness-specific while
   the section declares a generic contract; de-drifting it is left to a later
   round so this record stays scoped to locking the boundary.
