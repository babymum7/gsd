---
name: gsd-handoff
description: Internal GSD sub-skill (routed via /gsd). Compact the current conversation into a resume-aware gsd-handoff document for another agent/session. Triggered at pauses/breakpoints; read back on resume.
triggers: resume/continue (read existing); pause/breakpoint/context-pressure (write new)
produces: [handoff-<n>.toon]
consumes: [plan.toon]
---

# Handoff

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Invoked standalone with its `consumes:` artifacts missing → load the `gsd` skill and enter through its router (it detects workspace state); don't improvise missing context.

 Compacts the conversation into `.scratch/<feature>/handoff-<n>.toon` so another session (or a fresh context) can resume without re-deriving state. Triggered at pauses, breakpoints, or context-pressure.
Numbering: glob existing `handoff-*.toon`, use `max + 1`. If the target already exists (concurrent sessions), re-glob and increment until free — never use a suffixed variant (the Read rule expects `handoff-<n>.toon` only).
 
 ## Write — the resume contract (AXI TOON Format)
 A gsd-handoff file MUST use the following token-efficient TOON format:
 
 ```
schema:v1
 handoff[1]{mode,phase,next_action}:
   <skill-name>,<phase-description>,<single next step to take>
 decisions[count]{topic,decision}:
   <topic-1>,<resolved design decision with brief why>
   <topic-2>,<resolved design decision with brief why>
 questions[count]{question}:
   <unresolved question 1>
   <unresolved question 2>
 skills[count]{name}:
   <skill-to-reload-1>
   <skill-to-reload-2>
settings[count]{name,value}:
  ponytail_level,full
  autosync,on
 ```
`settings[]` = **active non-default toggles only** (rows above are examples, not defaults); omit the table entirely when nothing is toggled. Exception: `autosync` is **tri-state** — no row = unset (triggers ask-once below); `autosync,on` and `autosync,off` are both explicit user choices worth a row (`off` = remembered decline, never re-ask). Second exception: a pre-plan portable sync records `base,<branch>` here (see § Portable step 1) — with no `plan.toon` yet, the handoff is the only durable place for it.

## Portable handoff (cross-machine)
The default handoff is machine-local (`.scratch/` is git-ignored — gsd Conventions). When the user will resume **on another machine** ("continue on my laptop", "handoff to another machine"): write the handoff as usual, then sync onto the WIP branch and push. Canonical sync (only the push is unconditional):
1. `git checkout wip/<feature>` — no wip branch yet (paused before execution, spec/discussion only)? Capture `<base>` per gsd Conventions **before** `git checkout -b wip/<feature>`, and record `base,<base>` in this handoff's `settings[]` — there is no `plan.toon` yet; `gsd-to-plan` reads it from there on the other machine (show-current on `wip/` would self-reference).
2. Uncommitted code changes (`git status --short` beyond `.scratch/`)? → STOP and surface the list; three choices: (a) finish/commit the task, (b) **explicitly approve** the list (or a named subset) → `git add -- <approved paths> && git commit -m "chore(gsd): wip snapshot" -- <approved paths> ':(exclude).scratch'`, or (c) **skip** — dirty code stays local; scratch and all committed branch work still travel (steps 3-4 proceed regardless). Never snapshot silently, never sweep with a blanket `add -A` — dirty files may be the user's unrelated work, and untracked files would get published. The squash erases the snapshot from *history* but not from the branch *diff* — `gsd-verify` spec-compliance ("no code outside the plan") flags any stray file that rode along.
3. `git add -f .scratch/<feature>/`; `git status --short .scratch/<feature>` non-empty → `git commit -m "chore(gsd): portable handoff" -- .scratch/<feature>` (a pathspec'd commit ignores anything else staged; skip when clean — it exits non-zero on no changes)
4. **always** `git push -u origin wip/<feature>` — unconditional, so code commits travel even when scratch didn't change.
On the other machine, `git checkout wip/<feature>` materializes `.scratch/<feature>/` → resume normally. The synced files are tracked on `wip/` only — `gsd-verify` runs `git rm -r --cached --ignore-unmatch .scratch/<feature>` before the squash commit, so nothing lands on `<base>`.

**Autosync** — `/gsd autosync on|off`, **tri-state**: unset (no `settings[]` row, the default) = ask-once below; `on` = always sync; `off` = remembered decline, no asking. Persisted like `ponytail_level` via `settings[]` so the choice survives the handoff to the other machine. When on: every handoff write runs the portable sync automatically (no cross-machine phrasing needed; a pause with uncommitted code still **asks** before snapshotting — step 2 is never silent), and `gsd-executing-plans` re-syncs scratch after each task commit. Sync points are pauses and task boundaries — work never pushed (no pause, mid-task) stays local. Requires a remote: none → stay machine-local and say so (graceful degradation, no error).
**Ask-once on first pause** — pause/handoff with autosync **unset** and a remote present → ask ONE question before finishing: "Sync to the remote so you can resume on another machine? (yes / no / always)". `yes` = run the portable sync this once (stays unset); `always` = set `autosync,on`; `no` = set `autosync,off` — the row makes the decline durable, never re-ask. Cross-machine phrasing in the prompt ("continue on my laptop") skips the question — it IS the consent. No remote → skip the question entirely.

## Read (on resume)
 If no file is passed, read the highest-numbered `handoff-<n>.toon` in `.scratch/<feature>/`. Open it, read `mode` and `phase` explicitly, and jump to `next_action`. Never re-infer the mode or re-litigate resolved decisions. If resuming `gsd-executing-plans`, also read `.scratch/<feature>/plan.toon` (skip the `schema:v1` and `base:` lines; task status is in the `plan[` table) + `git log` — the handoff says what/next, the `plan.toon` says what's done.
 Before `next_action`, restore the toggle `settings[]` values (`ponytail_level`, `autosync`) so session toggles survive the resume. A `base` row is metadata, not a toggle — don't "restore" it; it's consumed by `gsd-to-plan`/Conventions when capturing `<base>` pre-plan.
 **No gsd-handoff exists** (interrupted without one, or state looks broken): reconstruct from durable artifacts — `.scratch/<feature>/plan.toon` (intended status) + `git log wip/<feature>` (committed) + `git status`/`git diff` (uncommitted/broken) + `spec.md` (intent). Compare actual vs. plan.toon to find the divergence and resume there; if the working state is broken, route to `gsd-diagnosing-bugs`.

Forks the conversation — you open a new session referencing the file. `/compact` continues in place; `gsd-handoff` forks.

 ## Contextual disclosure (see gsd Conventions). Example:
 ```
 Next steps:
 - /gsd (to resume work, start planning, or begin execution)
 ```
