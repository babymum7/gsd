# 0017 — Host plan and goal features are affordances, never authority

- **Status:** Accepted
- **Date:** 2026-09-19

## Decision

The plan-mode and goal features a host ships are declared per adapter and used as
affordances, never driven by GSD and never allowed to bind GSD acceptance.

1. The adapter map declares, per host, which plan and goal feature exists and what
   the fallback is when neither does. OMP ships a read-only plan mode with a plan
   todo list (CLI help, v18.2.6: "Force read-only plan mode at start" and "the plan's
   todo list"), and no goal feature; Claude Code plan mode is presentation: it cannot
   edit, commit, or run checks, so the owner leaves it before lifecycle work, and its
   `/goal` keeps the session running on a completion condition a separate evaluator
   checks after every turn; Codex ships plan mode (`/plan`) and Goal mode (`/goal`).
2. No adapter names a host plan or goal feature to the model. The adapter map
   records each host's features for maintainers, the Codex adapter writes no managed
   `## GSD` section, and the core bootstrap carries no host-goal sentence; the
   bootstrap's "`plan.md` owns intent" line and the canonical artifacts are all the
   model reads about authority.
3. GSD neither drives nor recommends the affordance, and the host artifact stays
   context. `plan.md` and the deterministic gates remain the only definition of
   acceptance and done; a goal that completes in the host never completes a GSD
   feature. A host plan beside `.scratch/<feature>/plan.md` is context that never
   binds; no adapter or bootstrap text asks about it.
4. A host plan or goal artifact is never lifecycle state: triage still classifies
   the prompt, and neither artifact may enter resume ownership.

Canon `REFERENCE.md` § Recovery tooling exclusions already excludes
toolset-restricted harness modes from lifecycle work and keeps resume authority in
`plan.md`, `state.toon`, and Git; `adapters/README.md` carries the per-host
affordance; and P-gsd-16 states the durable rule.

Official sources for the host features: the OMP CLI help (`omp --help`, v18.2.6) for
the read-only plan mode and the plan todo list; Codex slash commands
<https://learn.chatgpt.com/docs/reference/slash-commands> (`/plan`, `/goal`,
`/worktree`) and long-running work
<https://learn.chatgpt.com/docs/long-running-work> ("the goal text becomes both the
first prompt and the completion criteria for the task"); Claude Code goal
<https://code.claude.com/docs/en/goal> (completion "decided by a fresh model rather
than the one doing the work").

## Amendment

Amended 2026-09-30. Points 2 to 4 and the closing paragraph first described a Codex
`## GSD` section, a bootstrap sentence "Host goal artifacts never bind acceptance.",
a "milestone ledger" that decision 0027 removed, and a completed-state matrix that
the canon no longer carries. No code or bootstrap text ever shipped the first two.
The rule is unchanged; only the claims about how it reaches the model now say what
ships.
