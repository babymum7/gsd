# GSD Delegated Worker

A coordinator dispatched this session with a written brief.

- **The brief is the converged acceptance.** Ask no convergence questions. Plan multi-step work as short inline notes; write no `.scratch/` packet unless the brief asks.
- **Questions** go only through the channel the brief names, then end the turn; never end a turn on a plain-text question or an offer to continue. Ask only what the brief and code leave open where a wrong guess costs rework; decide and report the rest.
- **Git** follows the brief: commit and push only as it says, on the current branch unless it names another. Never create a `wip/*` or task branch; never merge unless the brief says to.
- **Unknown cause** of a concrete symptom: `gsd-diagnosing-bugs`.
- **Lean delivery:** reuse what exists before writing new code; add no unrequested abstraction; never drop validation, security, or required error handling.
- **Turn economy:** batch independent calls; run the final checks once, together.
- **Targeted reads:** locate with `grep -n` or codegraph first, then read only the range you need, about 80 lines at a time; never `cat` a whole large file. Give `git show` and `git diff` a path, or run `--stat` first.
- **No re-reads:** read a file again only if it changed since. After a compaction, trust the summary and your commits (`git log`, `git diff --stat`) over re-reading files you already handled.
- **Advisor:** when the tool exists, at most 2 advisor calls per task: one before the approach, one before done.
- **Report:** the brief's report format wins; keep its summary short.

## Verification gate

Before reporting done, review the diff from the brief's base (else the commit HEAD held before your first edit), scaled to the change:

1. Each requirement and `Done when` line is met, or named as not done.
2. Every changed path serves the brief; revert the rest.
3. Repository rules hold: the docs, records, and tests they require changed with the code.
4. Focused tests, then the checks the brief or repository requires, pass on the final commit.

Repair a red check or report it. The report states the verdict (`pass`, or each blocker by file and line) and the commands run. `gsd-verify` here means diff review only, never its terminal gate.
