---
name: gsd-to-plan
description: Internal GSD sub-skill (routed via /gsd). Produce an implementation plan from a converged design — no interview, just write the plan. Triggered by `gsd` when the spec/design converges; outputs task-decomposed plan(s) to `.scratch/<feature>/plan.toon`.
triggers: spec converged, no plan yet (gsd Route 3)
produces: [plan.toon]
consumes: [spec.md, handoff-<n>.toon]
---

# To Plan

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract: select an Invocation Mode below before validating only that row's Required artifacts, then follow its Missing required action. A missing Optional artifact never reroutes the invocation.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Converged planning | `spec.md` | `handoff-<n>.toon` (pre-plan portable base metadata only) | `plan.toon` | Missing `spec.md`: STOP and return to `/gsd` Discussion to recover or create a converged spec; never synthesize `spec.md` or a plan from unstated requirements |

Turn a converged design into an executable implementation plan. No interview — the design is settled (`gsd` did that). Read `.scratch/<feature>/spec.md` for the acceptance criteria this plan must deliver. Write the plan.

At intake, also accept the exact set of repository-relative pre-approval domain artifact paths returned by `gsd-domain-modeling`. This set is transient conversational or pre-plan handoff input, not a new state artifact; no returned paths (an empty or absent set) is normal. On a pre-plan resume, reuse the set only when those returned paths are still present in conversational/handoff state. If no returned-path set exists, use the empty set: do not invent paths, scan domain artifacts to reconstruct it, or infer domain changes from arbitrary dirty files.

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
- `test` — the focused automated test/path/self-check at the selected public seam; it may be a unit test, integration test, CLI check, or focused browser/HTTP check. Use `none` only when test-exempt. Test-exempt covers ONLY docs/comments/metadata or mechanically verifiable non-behavioral changes; anything that alters runtime behavior (including config) names an automated test path or focused self-check command. `none` on logic-bearing code is a planning error.
 - `status` — `pending`, `in_progress`, `done`, or `superseded` (for spec revisions).
 
Escaping — `,` separates columns and `|` separates values within a field (GSD's sub-separator; canonical TOON also allows `"quoted"` fields — see [spec](https://toonformat.dev/reference/spec.html)). For `plan.toon` keep it simple: a `task` needing a comma or pipe is the wrong shape — rephrase it (5-8 words) or split the task. File paths containing either are unsupported.

Tasks run sequentially — `gsd-executing-plans` dispatches one `task` subagent at a time, in `id` order. Order the tasks so each runs after what it depends on; the sequence itself carries the dependencies.

Before writing rows, apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Planning decomposition & precision contract as the deterministic planning oracle. It changes task shape and the existing `test` value only; it never adds a plan column, dependency field, frontier, or tracker.

## Pre-approval domain-path ownership gate
During plan generation, add each returned path as an ordinary, exact `files` entry on the behavior-owning task — the task whose implementation or decision evidence owns the domain change. Never create a generic documentation task merely to carry these paths.

After writing the completed `plan.toon`, but **before printing the inline summary or asking approval**, parse every completed row in the `plan[...]` table. Split each row's `files` field on `|` and compare whole path tokens exactly; for every returned path, count its occurrences across all rows. The check passes only when each path occurs once and its sole owning row has `status=pending`. The empty returned-path set passes without adding or inferring work.

Zero occurrences, more than one occurrence (including repetition within one row), or a sole non-pending owner is a plan defect. Revise or redistribute the plan rows, rewrite `plan.toon`, then parse and run the entire check again. **Do not print the summary, ask the approval question, or launch plan review until the check passes.** Keep the path in the existing `files` field; this gate changes neither `schema:v1`, the columns, nor sequential task order, and creates no state artifact.

## Exact plan serialization gate
After all validated tasks are known, serialize them using the unchanged `schema:v1` columns and order, parse every generated row back, and compare exact `id`, `task`, `satisfies`, `files`, `test`, and `status` values with those validated tasks. Any row reorder, changed file/test, changed status, missing/duplicate/unknown AC ID, or other round-trip drift is a plan defect: rewrite and repeat the full parse/compare before summary or approval. For Expand/Migrate/Contract, the short task descriptions and row order must retain their respective `Expand`, `Migrate`, and `Contract` identity. Their semantic safety facts stay in the validated spec/task brief; never imply that safety lives in a new plan column. This gate changes neither `schema:v1`, its column order, sequential dependencies, nor the artifact inventory.

## Plan summary + approval gate (mandatory, only after the ownership and serialization gates pass)
After the ownership and exact serialization gates pass, print an inline human-readable summary in the terminal — the user never has to open the file. The summary contains:
- One line per task: `T<n> — <task> (satisfies AC-x|AC-y; files; test or test:none)`.
- A footer: task count, `base:` branch, and AC coverage (`all ACs covered` or the gap — a gap means the plan is incomplete, fix before asking).
Then ask **one approval question** using [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates → Direct sub-skill Next steps adapted as the approval gate: approve → execute; revise the plan first; or (when the `plan.toon` is lavish offer-eligible and the Fire gate holds) review the plan visually — the visual-review choice rides *inside* this one gate, it is not an extra prompt. **This approval is the last prompt of the cycle**; on approve, route to `gsd-executing-plans` and follow [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Post-approval pipeline contract. Local responsibility here is to make the final prompt explicit and block approval until both domain-path ownership and AC coverage are complete. "Revise" edits `plan.toon`, reruns both completeness checks, and re-presents the summary + the same single approval ask; picking visual review launches `gsd-lavish` on the plan, then returns to this same gate.

## Auto-triggers & visual-review ask
- `gsd-codebase-design` — when a task involves designing/redesigning a module interface.
- `gsd-lavish` — a non-trivial finalized `plan.toon` is an offer-eligible deliverable **only before approval**: follow [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Lavish opt-in gate taxonomy. When it is offer-eligible and the Fire gate holds, you MUST surface the visual-review option — folded into the single approval gate as one more choice (approve / revise / review the plan visually), never a second prompt. Launch lavish only after explicit opt-in (the user picks that choice) plus the Fire gate. After the approval question is answered, post-approval pipeline no-offer mode begins.

## Rules
- **Decompose ordinary work by complete observable behavior, not architectural layer or file type.** Derive the required layers from the AC and live codebase; UI/API/domain/storage are examples, not a required universal stack. One vertical task emits exactly all required behavior layers, owns at least one affected file per required layer, and includes its selected-seam focused check. Reject and rewrite ordinary rows named only `add DB`, `add service`, `add API`, or `write all tests`, and any slice omitting a required layer, unless the row independently exposes and verifies a real public contract.
- **Put the selected public seam in `test`.** For each behavior-bearing task, use the focused automated test/path/self-check for the highest deterministic existing public interface/harness pinned during Discussion: existing user/browser/CLI/HTTP boundary first, otherwise the highest existing public module API. Resolve a same-tier choice by the production entrypoint named by the AC/`Check:`, then the repository's canonical existing harness convention, then greater production-path coverage with no test-only bypass; an unresolved tie returns to Discussion as materially ambiguous. A lower seam requires the concrete recorded reason that the higher seam is absent or cannot deterministically isolate the AC. Never invent a test-only API or drop merely because a lower seam is easier.
- **One row has one seam decision.** A row may satisfy several ACs only when all of them pin the exact same `test` path and lower-seam reason. If their pins differ, split them into separate vertical behavior rows; the single existing `test` cell cannot represent conflicting seams.
- **Make green verification mandatory without predicting a pass.** Every Vertical, Expand, Migrate, and Contract row defines a concrete focused `action → expected observable result` check and the obligation to run it. Planning never fabricates the future green result: `gsd-executing-plans` runs the check after implementation and records the verified-green fact before the row lands or a later stage proceeds. When validating an already produced candidate row/stage result, false, missing, TBD/TODO, or placeholder green state fails. Explicit acceptance deferral may defer only the broader runtime acceptance action; the focused TDD test must still become green now. No result or safety fact becomes a plan column.
- **Reserve Expand → Migrate → Contract for unavoidable wide mechanical refactors.** Only when a blast-radius contract/API/schema change cannot migrate all callers atomically while green, emit sequential `Expand` (proved backward-compatible), one or more bounded `Migrate` rows (both seams proved working), then `Contract`. Contract is eligible only after a complete caller/reference inventory proves repository references gone and all owned/external consumers migrated, or a completed precise compatibility/deprecation obligation; its check explicitly performs that inventory and expects zero stale callers/references. External consumers without migration/obligation evidence, or unknown ownership, retain the old seam and defer Contract to a later precise milestone/evidence gate. Never force this sequence onto an ordinary feature as ceremony.
- **Validate Check semantics, not keyword padding.** A concrete action names the actual operation/input at the selected seam; its expected side names the observed subject and explicit state/value. A precise question names the exact decision/property plus a resolving constraint/choice. For every Expand/Migrate check, exercise old and new seams in separate affirmative clauses and expect a positive result from each; mentioning a seam or wording an unsafe state with positive-sounding nouns fails.
- **Rows are pointers, not payloads.** Detail lives in `spec.md` ACs and validated safety facts (what must be true) and the dispatch-time task-brief `gsd-executing-plans` composes from the *current* code state (how) using the deterministic task-brief template — never pre-written into the plan, where it goes stale after the first diff lands. A task needing a paragraph to describe is two tasks.
- **Right-size the plan.** Task count proportional to the ask: quick-fix 1-2, typical feature 3-7. A plan pushing past ~10 tasks or containing independently-shippable chunks is a milestone smell — STOP, route back to `gsd` (Discussion) to split into milestone features (`<feature>-m1`, `-m2`, …), each with its own spec→plan→verify→merge cycle. Never one giant plan on one long-lived branch.
- **Use only actual spec AC IDs and cover them all.** Every `satisfies` token must be a known, unique AC ID from `spec.md`; reject missing, duplicate, unknown (for example `AC-404`), or extra/conflicting pins. Cross-check the union of all `satisfies` against the non-superseded AC list before finishing — a missing AC is an incomplete plan, not a verify-time surprise.
- Encode every inter-task dependency in the task order — a dependent task gets a later `id`. Never bury a sequencing constraint in `task` prose.
- If the design has a gap that blocks planning, STOP — route back to `gsd` (Discussion) → revise `spec.md` → re-plan. Do not invent scope to fill it.
- No interviews, no scope expansion. The plan reflects the design; it doesn't renegotiate it.

## Contextual disclosure
Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. This skill's standalone terminal surface is the plan summary + approval gate: one approval question, then no further menus or offers after approval. Inline firing appends nothing.
