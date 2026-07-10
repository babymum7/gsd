---
name: gsd-handoff
description: Internal GSD sub-skill (routed via /gsd). Compact the current conversation into a resume-aware gsd-handoff document for another agent/session. Triggered at pauses/breakpoints; read back on resume.
triggers: resume/continue (read existing); pause/breakpoint/context-pressure (write new)
produces: [handoff-<n>.toon]
consumes: [handoff-<n>.toon, plan.toon, spec.md]
---

# Handoff

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract: select an Invocation Mode below before validating only that row's Required artifacts, then follow its Missing required action. A missing Optional artifact never reroutes the invocation.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Pre-plan handoff write | — | `spec.md`; `plan.toon` (absent by design) | `handoff-<n>.toon` | — |
| Execution handoff write | `plan.toon` | `spec.md` | `handoff-<n>.toon` | Missing `plan.toon`: stop and recover or block through `/gsd`; never record invented execution state |
| Pre-plan resume | `handoff-<n>.toon` | `spec.md`; `plan.toon` (absent by design) | — | Missing `handoff-<n>.toon`: return once to `/gsd` state detection and preserve explicit intent; never infer a mode or invent the handoff or a plan |
| Execution resume | `handoff-<n>.toon`; `plan.toon` | `spec.md` | — | Missing `handoff-<n>.toon`: reconstruct from Fallback `plan.toon` plus git log and status/diff, with `spec.md` when present. Missing `plan.toon` in a claimed execution resume: stop and recover or block through `/gsd`; never fabricate either artifact |

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
`mode` and `phase` are open, opaque values, not a closed enumeration. Write the active values, preserve unknown values on read, and never replace them by inferring a mode from `spec.md` or `plan.toon` presence.

`settings[]` = **active non-default toggles only** (rows above are examples, not defaults); omit the table entirely when nothing is toggled. For Ponytail, "active" means an **explicit** `/gsd ponytail [lite|full|ultra]` toggle, including explicitly selected `full`: write exactly `ponytail_level,<level>` for that valid active level. With no explicit toggle or after "stop ponytail"/"normal mode", omit `ponytail_level`; never write `ponytail_level,none`. Quick-fix auto-fire is prompt-local, is never a setting, and MUST NOT be serialized even if context pressure causes a handoff during the fix. Exception: `autosync` is **tri-state** — no row = unset (triggers ask-once below); `autosync,on` and `autosync,off` are both explicit user choices worth a row (`off` = remembered decline, never re-ask). Second exception: a pre-plan portable sync records `base,<branch>` here per [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics — with no `plan.toon` yet, the handoff is the only durable place for it.

## Portable handoff (cross-machine)
The default handoff is machine-local (`.scratch/` is git-ignored). When the user will resume **on another machine** ("continue on my laptop", "handoff to another machine"), write the handoff as usual, then use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics → Scratch sync and strip: run `git checkout wip/<feature>` (no wip branch yet (paused before execution, spec/discussion only)? create it after capturing `<base>` and record `base,<base>` in this handoff's `settings[]`); surface any non-scratch dirty code for explicit user handling before snapshotting; approved dirty-code snapshots use commit message `chore(gsd): wip snapshot`, pathspec approved paths, and `:(exclude).scratch`; **skip** — dirty code stays local remains valid; Never snapshot silently. Then `git add -f .scratch/<feature>/`, commit the scratch path only when dirty with `-- .scratch/<feature>`, and **always** `git push -u origin wip/<feature>`.
On the other machine, `git checkout wip/<feature>` materializes `.scratch/<feature>/` → resume normally. The synced files are tracked on `wip/` only; `gsd-verify` strips them before the squash commit, so nothing lands on `<base>`.

**Autosync** — `/gsd autosync on|off`, **tri-state**: unset (no `settings[]` row, the default) = ask-once below; `on` = always sync; `off` = remembered decline, no asking. Persisted like `ponytail_level` via `settings[]` so the choice survives the handoff to the other machine. When on: every handoff write runs the portable sync automatically (no cross-machine phrasing needed; a pause with uncommitted code still **asks** before snapshotting — dirty code is never silent), and `gsd-executing-plans` re-syncs scratch after each task commit using the canonical scratch sync. Sync points are pauses and task handoffs — work never pushed (no pause, mid-task) stays local. Requires a remote: none → stay machine-local and say so (graceful degradation, no error).
**Ask-once on first pause** — pause/handoff with autosync **unset** and a remote present → ask ONE question before finishing: "Sync to the remote so you can resume on another machine? (yes / no / always)". `yes` = run the portable sync this once (stays unset); `always` = set `autosync,on`; `no` = set `autosync,off` — the row makes the decline durable, never re-ask. Cross-machine phrasing in the prompt ("continue on my laptop") skips the question — it IS the consent. No remote → skip the question entirely.


## Read (on resume)
 If no file is passed, read the highest-numbered `handoff-<n>.toon` in `.scratch/<feature>/`. Open it, preserve its `mode` and `phase` exactly (including unknown values), and jump to `next_action`; never re-infer the mode or re-litigate resolved decisions. A pre-plan resume does not require `plan.toon`. If the recorded mode resumes `gsd-executing-plans`, also read `.scratch/<feature>/plan.toon` (skip the `schema:v1` and `base:` lines; task status is in the `plan[` table) + `git log` — the handoff says what/next, the `plan.toon` says what's done.
 Before `next_action`, initialize the Ponytail runtime fields to `explicit_level=none` and `auto_scope=none`, then restore the toggle `settings[]` values (`ponytail_level`, `autosync`). For `ponytail_level`, accept only `lite|full|ultra` from an explicit row; a valid row overrides only `explicit_level`, while an absent or invalid row leaves both fields at `none`. `auto_scope` is never restored, and an invalid value must never be activated or replaced with an invented level. For `autosync`, restore its recorded tri-state value. A `base` row is metadata, not a toggle — don't "restore" it; it's consumed by `gsd-to-plan`/Conventions when capturing `<base>` pre-plan. Preserve `mode`, `phase`, and unrelated/unknown settings behavior exactly.
 **No gsd-handoff exists** (interrupted without one, or state looks broken): for an explicitly claimed execution resume, reconstruct from Fallback artifacts — `.scratch/<feature>/plan.toon` (intended status) + `git log wip/<feature>` (committed) + `git status`/`git diff` (uncommitted/broken) + `spec.md` when present (intent). Compare actual vs. `plan.toon` to find the divergence and resume there; if `plan.toon` is also missing, stop and recover or block through `/gsd` rather than inventing execution state. Without an explicit execution-resume claim, return to `/gsd` state detection once; do not infer a handoff mode solely from available artifacts. If the working state is broken, route to `gsd-diagnosing-bugs`.

Forks the conversation — you open a new session referencing the file. `/compact` continues in place; `gsd-handoff` forks.

## Contextual disclosure
Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates → Direct sub-skill Next steps when invoked directly. Inline firing from `/gsd` appends nothing; the master owns the numbered human menu.
