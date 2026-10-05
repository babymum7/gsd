# 0003 — Keep plan and state formats, improve CLI ergonomics

- **Status:** Accepted
- **Date:** 2026-08-24

## Decision

GSD keeps `plan.md` canonical Markdown and `state.toon` schema v4 as two separate
authoritative artifacts — the plan stays validated grammar (see 0028), state keeps moving per
checkpoint. Agent ergonomics ship as CLI behavior only: semantic validator failures
print actionable help lines, a `normalize-plan` command proposes and applies a closed
set of surface-only fixes as a reviewable diff (`--write` to mutate), and
`gsd-state.mjs set key=value…` writes the same canonical snapshot without hand-built
JSON input. The multi-AC identical-pin rule stays fully enforced: errors enumerate the
conflicting pins per criterion so the agent can align them or split the task; nothing
is loosened or auto-copied.

## Amendment

Amended 2026-10-05. `state.toon` is now schema `v0.0.3` (decisions 0024 and 0028), not v4. The
two-format split and the CLI ergonomics stand; decision 0028 already replaced the hash-bound clause.
