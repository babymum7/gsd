# 0008 — Pre-squash wave-artifact cleanup

- **Status:** Accepted
- **Date:** 2026-09-11

## Decision

Extending records 0004 and 0007, the session owner retires all wave-dispatched
task branches (`omp/task/<name>` in this harness) and their isolated workspaces
during terminal verification under `gsd-verify`, before squashing `wip/<feature>`
into `base_ref`:
1. Each task branch is verified as an ancestor of `wip/<feature>` (`merge-base --is-ancestor`)
   and safely deleted via `git branch -d`; never force-delete with `-D`.
2. Each associated isolated workspace is inspected and removed through the harness's
   isolation mechanism (`git worktree remove` for plain linked worktrees); a dirty
   workspace is never force-removed without explicit confirmation.
3. Unmerged task branches that fail the ancestor check remain untouched and surface
   for explicit inspection, adhering to § Feature cleanup's invariant that unmerged
   work is never force-deleted.
4. Performing retirement before squash preserves the ancestor proof against
   `wip/<feature>`, which squash-merging to base would otherwise sever.
