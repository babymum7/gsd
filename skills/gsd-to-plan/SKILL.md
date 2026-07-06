---
name: gsd-to-plan
description: Internal GSD sub-skill (routed via /gsd). Produce an implementation plan from a converged design — no interview, just write the plan. Triggered by `gsd` when the spec/design converges; outputs task-decomposed plan(s) to `.scratch/<feature>/plan.toon`.
triggers: spec converged, no plan yet (gsd Route 3)
produces: [plan.toon]
consumes: [spec.md]
---

# To Plan

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Invoked standalone with its `consumes:` artifacts missing → load the `gsd` skill and enter through its router (it detects workspace state); don't improvise missing context.

Turn a converged design into an executable implementation plan. No interview — the design is settled (`gsd` did that). Read `.scratch/<feature>/spec.md` for the acceptance criteria this plan must deliver. Write the plan.

 ## Output (AXI TOON Format)
 Write a single consolidated plan file to `.scratch/<feature>/plan.toon`. This format is highly token-efficient, omitting braces, quotes, and markdown boilerplate. The first line declares the schema version (`schema:v1`); the second line is `base:<base>` (the repo's default branch captured per [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Git/base/WIP/scratch mechanics; already on `wip/<feature>` from a pre-plan portable resume? read the `base` row from the latest handoff `settings[]`, never the wip branch itself); consumers read from the `plan[` table.


 
 Format:
 ```
schema:v1
base:<base>
plan[count]{id,task,satisfies,files,test,status}:
  T1,<task description>,AC-1|AC-2,src/auth.ts|src/user.ts,tests/auth.test.ts,pending
  T2,<task description>,AC-3,src/router.ts,none,pending
 ```
 
 Columns:
 - `id` — T1, T2, etc. (numbered sequentially).
 - `task` — short task description (5-8 words).
 - `satisfies` — pipe-separated list of AC IDs from `spec.md`.
 - `files` — pipe-separated list of affected files.
- `test` — unit test file/path for TDD, or `none` if test-exempt. Test-exempt covers ONLY docs/comments/metadata or mechanically verifiable non-behavioral changes; anything that alters runtime behavior (including config) names a unit/integration test or a self-check command. `none` on logic-bearing code is a planning error.
 - `status` — `pending`, `in_progress`, `done`, or `superseded` (for spec revisions).
 
Escaping — `,` separates columns and `|` separates values within a field (GSD's sub-separator; canonical TOON also allows `"quoted"` fields — see [spec](https://toonformat.dev/reference/spec.html)). For `plan.toon` keep it simple: a `task` needing a comma or pipe is the wrong shape — rephrase it (5-8 words) or split the task. File paths containing either are unsupported.

Tasks run sequentially — `gsd-executing-plans` dispatches one `task` subagent at a time, in `id` order. Order the tasks so each runs after what it depends on; the sequence itself carries the dependencies.

## Plan summary + approval gate (mandatory, right after writing plan.toon)
Immediately after writing `plan.toon`, print an inline human-readable summary in the terminal — the user never has to open the file. The summary contains:
- One line per task: `T<n> — <task> (satisfies AC-x|AC-y; files; test or test:none)`.
- A footer: task count, `base:` branch, and AC coverage (`all ACs covered` or the gap — a gap means the plan is incomplete, fix before asking).
Then ask **one approval question** using [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates → Direct sub-skill Next steps adapted as the approval gate: approve → execute; or revise the plan first. **This approval is the last prompt of the cycle**; on approve, route to `gsd-executing-plans` and follow [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Post-approval pipeline contract. Local responsibility here is only to make the final prompt explicit and block approval until AC coverage is complete. "Revise" edits `plan.toon` and re-presents the summary + the same single approval ask.

## Auto-triggers
- `gsd-codebase-design` — when a task involves designing/redesigning a module interface.
- `gsd-lavish` — a non-trivial finalized `plan.toon` is an offer-eligible deliverable only before approval: follow [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Lavish opt-in gate taxonomy, and launch lavish only after explicit opt-in plus the Fire gate. After the approval question is answered, post-approval pipeline no-offer mode begins.

## Rules
- Decompose by what an implementer can do in one focused pass, not by file type.
- **Rows are pointers, not payloads.** Detail lives in `spec.md` ACs (what must be true) and the dispatch-time task-brief `gsd-executing-plans` composes from the *current* code state (how) using the deterministic task-brief template — never pre-written into the plan, where it goes stale after the first diff lands. A task needing a paragraph to describe is two tasks.
- **Right-size the plan.** Task count proportional to the ask: quick-fix 1-2, typical feature 3-7. A plan pushing past ~10 tasks or containing independently-shippable chunks is a milestone smell — STOP, route back to `gsd` (Discussion) to split into milestone features (`<feature>-m1`, `-m2`, …), each with its own spec→plan→verify→merge cycle. Never one giant plan on one long-lived branch.
- **Cover every AC.** Each AC in `spec.md` MUST appear in some task's `satisfies`. Before finishing, cross-check the union of all `satisfies` against the AC list — a missing AC is an incomplete plan, not a verify-time surprise.
- Encode every inter-task dependency in the task order — a dependent task gets a later `id`. Never bury a sequencing constraint in `task` prose.
- If the design has a gap that blocks planning, STOP — route back to `gsd` (Discussion) → revise `spec.md` → re-plan. Do not invent scope to fill it.
- No interviews, no scope expansion. The plan reflects the design; it doesn't renegotiate it.

## Contextual disclosure
Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. This skill's standalone terminal surface is the plan summary + approval gate: one approval question, then no further menus or offers after approval. Inline firing appends nothing.
