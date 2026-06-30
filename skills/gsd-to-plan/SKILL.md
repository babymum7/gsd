---
name: gsd-to-plan
description: Produce an implementation plan from a converged design — no interview, just write the plan. Triggered by `gsd` when the spec/design converges; outputs task-decomposed plan(s) to `.scratch/<feature>/plan.toon`.
triggers: spec converged, no plan yet (gsd Route 3)
produces: [plan.toon]
consumes: [spec.md]
---

# To Plan

Turn a converged design into an executable implementation plan. No interview — the design is settled (`gsd` did that). Read `.scratch/<feature>/spec.md` for the acceptance criteria this plan must deliver. Write the plan.

 ## Output (AXI TOON Format)
 Write a single consolidated plan file to `.scratch/<feature>/plan.toon`. This format is highly token-efficient, omitting braces, quotes, and markdown boilerplate.
 
 Format:
 ```
 plan[count]{id,task,satisfies,files,test,status}:
   T1,<task description>,AC-1|AC-2,src/auth.ts|src/user.ts,tests/auth.test.ts,pending
   T2,<task description>,AC-3,src/router.ts,none,pending
 ```
 
 Columns:
 - `id` — T1, T2, etc. (numbered sequentially).
 - `task` — short task description (5-8 words).
 - `satisfies` — pipe-separated list of AC IDs from `spec.md`.
 - `files` — pipe-separated list of affected files.
 - `test` — unit test file/path for TDD (or `none` if test-exempt).
 - `status` — `pending`, `in_progress`, `done`, or `superseded` (for spec revisions).
 
Escaping — `,` separates columns and `|` separates values within a field (GSD's sub-separator; canonical TOON also allows `"quoted"` fields — see [spec](https://toonformat.dev/reference/spec.html)). For `plan.toon` keep it simple: a `task` needing a comma or pipe is the wrong shape — rephrase it (5-8 words) or split the task. File paths containing either are unsupported.

Tasks run sequentially. Parallelism lives in how `gsd-executing-plans` dispatches `task` subagents (never on shared code) — never encoded in the plan.

## Auto-triggers
- `gsd-codebase-design` — when a task involves designing/redesigning a module interface.
- `gsd-lavish` — a non-trivial finalized `plan.toon` is a reviewable deliverable.

## Rules
- Decompose by what an implementer can do in one focused pass, not by file type.
- Mark inter-task dependencies explicitly; never hide a sequencing constraint inside a task.
- If the design has a gap that blocks planning, STOP — route back to `gsd` (Discussion) → revise `spec.md` → re-plan. Do not invent scope to fill it.
- No interviews, no scope expansion. The plan reflects the design; it doesn't renegotiate it.

 ## Contextual disclosure (AXI Style)
Append this `Next steps:` block **only when you are the terminal/standalone response** (directly invoked or the last skill in the chain) — never when firing **inline** inside another skill's response; only the outermost response shows next-steps (`gsd` Conventions → Contextual disclosure). Example:
 ```
 - /gsd (to start execution, resume work, or save progress)
 ```
