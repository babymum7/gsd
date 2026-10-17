# 0036 — A tracked issue is converged input, and repository landing steps follow a merge

- **Status:** Accepted
- **Date:** 2026-10-17

## Decision

A well-specified issue still routes to `gsd-brainstorming`. An issue or ticket from any tracker or file, read with its comments, that states acceptance criteria is converged input: brainstorming rewrites each criterion as a scenario with its seam and goes straight to planning without discovery questions. Its open questions are asked as usual unless the repository's instructions say not to ask back; then the session picks its recommendation and records it as a `D-n` decision. When the repository's instructions say how work from the checked-out branch lands, the plan records `merge` without asking, merges into that branch, and after feature cleanup `gsd-verify` runs those landing steps; when they forbid merging into the checked-out branch, the session first cuts the branch they prescribe. Only skills change: no plan grammar, tool, or tracker integration, and the merge target stays the recorded base.

## Rationale

After 24ec8fb, sessions in issue worktrees of a repository whose instructions say "one issue, one branch, a pull request, never ask back" committed whole features with no plan, reasoning that a specified issue made brainstorming overkill; they lost the slice and verify gates on their largest changes. The worktree's own issue branch is already a valid base, so the gap was only where the spec comes from and who runs the final push, not Git mechanics. A new delivery value or a `Closes` field would widen the merge target and tie GSD to one tracker.
