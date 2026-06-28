---
name: gsd-handoff
description: Compact the current conversation into a resume-aware gsd-handoff document for another agent/session. Triggered at pauses/breakpoints; read back on resume.
---

# Handoff

Compacts the conversation into `.scratch/<feature>/handoff-<n>.md` so another session (or a fresh context) can resume without re-deriving state. Triggered at pauses, breakpoints, or context-pressure.

## Write — the resume contract
A gsd-handoff file MUST contain:
- **Mode + phase** — which skill, which phase (e.g., "gsd-grilling / stress-test", "gsd-executing-plans / task 3 of 7").
- **Resolved decisions** — what's settled (with the one-line why).
- **Open questions** — what's still undecided.
- **Next action** — the single concrete step to take on resume.
- **Resume-skills** — which skills to re-load.

## Read (on resume)
If no file is passed, read the highest-numbered `handoff-<n>.md` in `.scratch/<feature>/`. Open it, read `Mode` explicitly, jump to **Next action**. Never re-infer the mode or re-litigate resolved decisions. If resuming `gsd-executing-plans`, also read `.scratch/<feature>/ledger.md` (task status) + `git log` — gsd-handoff says what/next, the ledger says what's done.
**No gsd-handoff exists** (interrupted without one, or state looks broken): reconstruct from durable artifacts — `.scratch/<feature>/ledger.md` (intended status) + `git log wip/<feature>` (committed) + `git status`/`git diff` (uncommitted/broken) + `spec.md`/`plans/` (intent). Compare actual vs. ledger to find the divergence and resume there; if the working state is broken (bad edit, conflict), route to `gsd-diagnosing-bugs`.

Forks the conversation — you open a new session referencing the file. `/compact` continues in place; `gsd-handoff` forks.
