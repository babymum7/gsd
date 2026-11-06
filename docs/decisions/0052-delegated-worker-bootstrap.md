# 0052 — A delegated worker gets a short worker bootstrap

- **Status:** Accepted
- **Date:** 2026-11-06

## Decision

1. **The environment selects the mode.** A coordinator that launches a worker with a complete written brief sets `GSD_DELEGATED=1` in the launch command. Only that exact value selects delegated mode; unset, empty, `0`, `true`, or any other value renders the default bootstrap, byte-identical to before. `lib/gsd-bootstrap.mjs` owns the variable name, `isDelegated(env)` reads it, and `createBootstrap(root, { delegated })` takes the result as an explicit option, so the core render stays a pure function of its inputs. Every adapter that renders the shared bootstrap passes it: claude-code and codex (hook subprocesses), and dsh, opencode, and omp, which read their host process's environment.
2. **The body lives beside the master.** `skills/gsd/DELEGATED.md` is the delegated body, with its own word budget. The envelope, marker, `GSD_ROOT` line, `GSD_SESSION` line, and sub-agent profiles stay as they are, so transcript detection and the capsule work unchanged. The line saying the hidden master is already loaded is left out, since the master is not what the worker gets.
3. **The brief replaces convergence and the lifecycle.** The body says the brief is the converged acceptance: no convergence questions, and inline notes instead of a `.scratch/` packet unless the brief asks for one. Questions go only through the channel the brief names, then the turn ends, and a turn never ends on a plain-text question. Branches, commits, and pushes follow the brief: no `wip/*` or task branch, and no merge unless the brief says so. The default bootstrap's "Unstated outcome" rule, lifecycle authority, and session-ownership sections are left out.
4. **A worker gate before done.** The body carries the essentials of `gsd-verify` inline, scaled to the change. The diff from the brief's base (or the commit HEAD held before the first edit) must cover each requirement and `Done when` line, touch only paths that serve the brief, and keep the repository rules on docs, records, and tests. Focused tests and the required checks must pass on the final commit, and the report states the verdict. `gsd-verify` is named for diff review only, never its terminal gate, which merges.
5. **Two catalog rows.** The catalog keeps only `gsd-diagnosing-bugs` and `gsd-verify` (`DELEGATED_SKILLS`). If either is missing from the visible catalog, the render fails closed and names the skill.

## Rationale

The coordinator measured 15 dispatched worker transcripts on 2026-11-06. None made a Skill call, a `gsd-state.mjs set`, a `.scratch/` packet, or a `wip/*` branch, so the default bootstrap cost every worker tokens and returned nothing. The workers also skipped the verify gate. Two of its rules were hazards to an unattended worker: ending a turn on a plain-text question stalls it silently when the brief forgets to redirect questions, and the `wip/*` merge lifecycle contradicts a brief that forbids other branches.

At this checkout's root, the default core render is 5074 bytes and the delegated one 2395 (47%). With the `GSD_SESSION` line and a two-profile sub-agent block appended to both, they are 5307 and 2628 bytes (49.5%). A test pins the delegated core render at no more than half the default. Another test pins the default to its composition from `skills/gsd/SKILL.md` and the catalog, so the switch cannot move a default byte.

No intent eval has measured the delegated arm. A run with briefs that leave a question open and forbid branches would show whether workers ask through the channel and report the gate's verdict.

## Amendment

Amended 2026-11-06. The body gains context-economy rules, and the size pin moves from half to three fifths of the default.

1. **Targeted reads.** Locate with `grep -n` or codegraph first, then read only the needed range, about 80 lines at a time. Never `cat` a whole large file. Give `git show` and `git diff` a path, or run `--stat` first.
2. **No re-reads.** A file is read again only if it changed. After a compaction the worker trusts the summary and its commits (`git log`, `git diff --stat`) instead of re-reading files it already handled. This replaces the shorter re-read clause in **Turn economy**.
3. **A capped advisor.** When the advisor tool exists, a worker makes at most 2 calls per task: one before the approach, one before done.
4. **A short report.** The brief's report format wins, and its summary stays short.

The coordinator measured 6 worker sessions on 2026-11-06. File reads were 61% of all tool-result characters: `sed` 220 calls / 839k characters, `grep` 292 / 527k, `cat` 100 / 395k, and `git show` 29 / 175k, about 6k per call. One session read one file 6 times. In the first 15 calls after each compaction, up to 58% of result characters were re-reads of files already read. 23 advisor calls cost 3.55M uncached input tokens, and one worker made 5 of them (825k tokens).

The rules add 561 bytes, loaded at every worker start and after every compaction. That is small next to the read volume they target. At this checkout's root the default core render stays 5069 bytes and the delegated one is 2953 (58%). The test now pins the delegated core render at no more than three fifths of the default. The default is still pinned to its composition, so it stays byte-identical.
