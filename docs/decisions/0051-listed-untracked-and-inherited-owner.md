# 0051 — Only listed untracked files block, and a resumed Claude session inherits its earlier owner

- **Status:** Accepted
- **Date:** 2026-11-04

## Decision

1. **Only a listed untracked file blocks.** `dirty-worktree` counts an untracked path only when a live task's Files lists it, or it sits under a directory a live task lists. Decision 0048 item 1 also counted every untracked path in a directory the branch changed or a task lists; that rule is retired. Every other untracked path is `kept_untracked:`, and a ready report that lists any also prints one `kept_untracked_note:` line: those paths never enter the merge, so they stay where they are, never stashed, moved, ignored, or deleted. A new file a feature forgot to list in any task's Files no longer blocks; the terminal gate's diff review is what catches a feature that needs it.
2. **A resumed Claude Code session inherits its earlier owner token.** A transcript Claude Code continues under a new session id keeps the id it started with in its first hook output, so the packets its agent recorded under that `GSD_SESSION` are invisible to the capsule rendered for the new id. On `compact` and `resume`, the Claude Code adapter reads the first `TRANSCRIPT_HEAD_BYTES` of the hook's `transcript_path`, takes each `GSD_SESSION: claude-…` token from GSD's own `SessionStart` and `UserPromptSubmit` hook attachments that differs from the current one, and the capsule lists the packets those tokens own as inherited, with the `gsd-state.mjs set … --takeover owner=<GSD_SESSION>` command that re-owns each. The adapter only reads that file; a tool result that merely quotes a token is never read as one. Other hosts are unchanged.
3. **A Vietnamese prompt joins the intent benchmark.** The vague fixture `vnd-price` states its request in Vietnamese, so the five-agent intent matrix of decision 0049 also covers a prompt in the language most real sessions use.

## Rationale

The field audit of 2026-11-04 read the 80 Claude Code sessions run after the 2026-11-02 install. `dirty-worktree` blocked five times on a user's untracked file in a directory the branch had touched: a changed `docs/OPERATIONS.md` claimed `docs/research/fallback-providers.md`, and a changed root `README.md` claimed an image at the root. Two sessions asked the user; agents in the two other repositories hid the file from the gate, one with `git stash push -u` (7 times in one session, 4 in its continuation) and one by adding it to `.git/info/exclude` (9 commands), even though the refusal already said never to stash or move it. Both habits began under the previous bundle and survived through compaction summaries that recorded them as procedure, and the stash ritual continued after preflight printed `kept_untracked:` for the same file. The directory rule was guessing ownership; a task's Files is where a plan states it, so that list is the only owner signal the gate trusts.

The same audit found two continued transcripts whose first hook output carried the previous session's id: one agent wrote `owner=` with the old token 17 times and its own twice, so after the next compaction the capsule, keyed to the new id, would list none of its packets. Reading the transcript the host already names, rather than a second marker, keeps the adapter within its read-only, git-only contract.

A paper on agent self-adaptation (arXiv 2610.34938, discussed on X on 2026-11-03) found that an adaptation helps only on the cases it covers, that stale adaptations persist, and that checks in code hold where prose rules fail. These changes move both fixes into code, and the benchmark fixture measures the 0050 ask rule on a case the English fixtures did not cover.

## Evidence

Recorded after the live runs in `test/eval/intent-report.json` and `test/eval/outcome-report.json`.
