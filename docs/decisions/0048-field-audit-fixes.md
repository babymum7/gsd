# 0048 — Field audit fixes: kept untracked files, record collisions, committed quick fixes

- **Status:** Accepted
- **Date:** 2026-11-01

## Decision

Three changes follow the audit of sessions run after the 2026-10-30 install.

1. **Untracked files outside the feature are kept, not blocked.** A feature directory is the parent directory of each path the WIP branch changed against the base and of each path a live task's Files lists; any directory but the repository root also covers its subdirectories, and the root covers only files directly in it. An untracked path in a feature directory, or listed in a live task's Files, still blocks `dirty-worktree`; every other untracked path prints as `kept_untracked:` in the ready report and is never stashed, moved, or deleted. Tracked, staged, and renamed paths always block.
2. **Preflight catches taken record numbers.** After `base-advanced` passes, the working tree holds the base's records, so preflight groups numbered basenames in `docs/decisions/` and `docs/design/` by their leading number and blocks `record-number-taken` for each record the branch added that shares its number with another. `gsd-record.mjs renumber` moves that record to the highest number in its directory plus one, at the old width, rewrites its title line, and replaces its full old stem (`NNNN-slug`) in every tracked file; a bare number is never rewritten, since the base's record of that number is a different decision.
3. **A quick fix commits when asked.** When the user or the repository's instructions ask for a commit, branch, or pull request, a quick fix commits on the branch they prescribe (never `wip/*`, which `derive-base` reads as a feature), passes `gsd-git.mjs preflight --base <base>`, and lands the way they say, still without a packet or plan. A commit the user asks for on the checked-out branch, the base included, needs no preflight: only a branch that lands elsewhere, pushed for a pull request or merged into the base, passes it first. `gsd-git.mjs` stays read-only, so the agent cuts the branch itself. Packet-less preflight proves an attached HEAD on a branch other than the base (`head-is-base` otherwise), a local base the branch contains, a clean tree under item 1, and the record check under item 2; it reads no `state.toon` or plan and skips the base-checked-out-elsewhere check, as a pull-request delivery does. This amends decision 0027's quick fix, which forbade every commit.

The bootstrap keeps decision 0045's 520-word cap: the quick-fix commit rule is paid for by dropping "Each turn resends the whole context." and shortening the Lean delivery ladder.

## Rationale

The audit read 14 Claude Code sessions across 8 repositories. One session stashed a user's untracked research note twice to get past `dirty-worktree`, though an untracked file never enters the index the merge commits and Git refuses rather than overwrites one. In another repository, parallel pull requests collided on decision numbers without any tool noticing. Most branch-and-pull-request work, such as tracker bug fixes, bypassed GSD entirely: a quick fix forbade commits, and a full plan was too heavy for a one-file fix. Collisions with open sibling pull requests show only after the local base holds them, and textual conflicts in a repository's own record index stay a manual merge.
