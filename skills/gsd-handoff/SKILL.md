---
name: gsd-handoff
description: Compact the current conversation into a resume-aware gsd-handoff document for another agent/session. Triggered at pauses/breakpoints; read back on resume.
---

# Handoff

 Compacts the conversation into `.scratch/<feature>/handoff-<n>.toon` so another session (or a fresh context) can resume without re-deriving state. Triggered at pauses, breakpoints, or context-pressure.
 
 ## Write — the resume contract (AXI TOON Format)
 A gsd-handoff file MUST use the following token-efficient TOON format:
 
 ```
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
 ```

## Read (on resume)
 If no file is passed, read the highest-numbered `handoff-<n>.toon` in `.scratch/<feature>/`. Open it, read `mode` and `phase` explicitly, and jump to `next_action`. Never re-infer the mode or re-litigate resolved decisions. If resuming `gsd-executing-plans`, also read `.scratch/<feature>/plan.toon` (task status) + `git log` — the handoff says what/next, the `plan.toon` says what's done.
 Before `next_action`, restore any `settings[]` values (e.g. `ponytail_level`) so session toggles survive the resume.
 **No gsd-handoff exists** (interrupted without one, or state looks broken): reconstruct from durable artifacts — `.scratch/<feature>/plan.toon` (intended status) + `git log wip/<feature>` (committed) + `git status`/`git diff` (uncommitted/broken) + `spec.md` (intent). Compare actual vs. plan.toon to find the divergence and resume there; if the working state is broken, route to `gsd-diagnosing-bugs`.

Forks the conversation — you open a new session referencing the file. `/compact` continues in place; `gsd-handoff` forks.

 ## Contextual disclosure (AXI Style)
 At the end of every response, always suggest next actions using the `/gsd` master entry point:
 ```
 Next steps:
 - /gsd (to resume work, start planning, or begin execution)
 ```
