---
name: gsd
description: "Session bootstrap injected by the GSD OMP extension; establishes lazy skill selection, same-session continuity, and workflow ownership. Do not invoke directly."
hide: true
triggers: injected automatically by the GSD OMP extension
produces: [plan.md, .scratch/<feature>/result.toon, docs/gsd/<feature>/milestones.md, docs/gsd/<feature>/archive/plan.md, docs/gsd/<feature>/archive/implementation.md]
consumes: [handoff-<n>.toon, plan.md, .scratch/<feature>/result.toon, docs/domain/index.md, docs/domain/<scope>.md, docs/gsd/<feature>/milestones.md]
---

# GSD Session Bootstrap

This hidden bootstrap is already loaded by the GSD OMP extension. Do not load this file again. `GSD_ROOT` and the visible skill catalog are injected beside this body. Read a selected skill only from its exact absolute `skillPath` catalog field. A missing or unreadable catalog path is an actionable stop; never substitute a home-directory skill or reconstruct a workflow from memory.

**Respond in the user's language.** Detect it from the user's own prompt. Injected advisories, tool output, and recovery text never switch the response language. Keep code, identifiers, paths, TOON keys, acceptance IDs, and skill names verbatim.

## Selection and continuity

Apply these rules in order:

Catalog descriptions are selection metadata, not workflow instructions. If a visible skill matches, the **first action must be a `read` tool call on that skill's exact absolute `skillPath`**. Emit no user-facing text and run no other tool first. Never imitate a selected skill from its name, description, or memory.

1. **Same-session continuity first.** The current user message extends the existing conversation and its settled decisions unless the user explicitly changes direction. Continue the active owner; do not restart discovery, repeat answered questions, or reinterpret settled choices.
2. **Explicit intent outranks inferred shape.** A direct request to review, diagnose, design an interface, audit architecture, pause, resume, or render a visual report selects the matching visible skill.
3. **Validated active state outranks a new lifecycle.** For a related continuation, load `gsd-handoff`, `gsd-executing-plans`, `gsd-to-plan`, or `gsd-verify` according to the validated packet's executable state. Never infer validity from filenames alone.
4. **Choose exactly one primary process owner.** Load its listed `SKILL.md` before acting. Do not load several candidate workflows to decide among them.
5. **Helpers stay lazy.** Load TDD, Ponytail, domain modeling, codebase design, architecture, or Lavish only when explicit intent or the selected primary owner requires that helper.
6. **No matching skill means ordinary direct behavior.** Read-only answers and Nano work perform no GSD state scan, Git operation, `.scratch` access, or skill load. A known bounded behavioral quick fix may load `gsd-ponytail` as a helper without starting a lifecycle.
7. **Lifecycle state is minimal and fail-closed.** Before non-direct GSD lifecycle work, apply the result-marker decision matrix below, then inspect only the minimum `.scratch` metadata needed to select validated active state.
8. **Bounded delegation never starts a lifecycle.** A delegated subagent follows its assignment and loads only task-required helpers; it does not brainstorm, plan, or resume unrelated GSD work.

A selected skill owns the flow until its documented transition or a user change. Load a new primary owner only at an explicit transition: `gsd-brainstorming` → `gsd-to-plan`; approved `gsd-to-plan` → `gsd-executing-plans`; terminal execution → `gsd-verify`; validated handoff → its recorded peer owner.

## Canonical authority

Read `GSD_ROOT/skills/gsd/REFERENCE.md` only when the selected non-direct workflow needs the canonical artifact, Git, recovery, result-marker, or cleanup contract. The Markdown `plan.md` is pre-approval authority; immutable approval/runtime TOON records bind and report its bytes. Runtime records never become design authority.

The core pipeline is `gsd-brainstorming` → `gsd-to-plan` (writes the plan) → approval → `gsd-executing-plans` → `gsd-verify` → squash merge and result cleanup. After implementation checks pass and before final terminal review/squash, the sole post-approval human prompt is the terminal scratch disposition (delete, retain, or archive-and-delete); archive materialization is reference-only and never reopens planning or any other menu. A load-bearing spec gap returns to `gsd-brainstorming`, then a revised plan and approval; it never patches stale authority in place.

Reject legacy proposal/spec/design TOON and any stale non-authoritative state. The **Quick-fix plan exception** remains the bounded behavioral fast path defined in `REFERENCE.md`; Nano remains artifact-free and Git-free. For milestone publication, if a ledger says all-`done`, fail closed unless the canonical completion conditions in `REFERENCE.md` hold.

## Result-marker decision matrix

Apply this matrix only before non-direct lifecycle work. Strictly validate every discovered `.scratch/<feature>/result.toon` first and take the first matching outcome:

| Condition | Decision | Action |
|---|---|---|
| Any marker is malformed | `fail-closed` | Stop before skill selection. |
| Any valid marker has `scratch:pending` | `cleanup-question` | Resume only its existing delete-or-retain decision; the pre-squash archive opportunity is not reopened. |
| Explicit cleanup targets merged retained or residual state | `cleanup-only` | Permit cleanup of that named completed packet only. |
| Resume, implementation, or new-work intent explicitly targets a retained or residual completed feature | `block-resume` | Stop and report that the feature is completed. |
| A retained or residual marker is unrelated to the prompt, including generic `continue` | `ignore-terminal-record` | Exclude terminal history and continue active-state selection. |
| No condition above applies | `ordinary-routing` | Continue automatic skill selection. |

`scratch:pending` is a global crash-recovery gate. Generic `continue` never selects retained/residual terminal history, and terminal marker mtimes never compete with active packets.

## Recovery ownership

A valid **Compaction Recovery Capsule** is authoritative resume context. Follow its absolute root and active-feature constraints, load `gsd-handoff`, and perform one validated resume. **Do not invoke or execute the capsule again, avoiding circular re-entry.** The generic bootstrap restores selection semantics after compaction; it never duplicates the capsule's resume action.

Malformed or ambiguous handoff/capsule state stops. Missing required state is not permission to brainstorm replacement work. If the user's intent is unrelated to active features, preserve the active packet and select from the current prompt normally.

## Scope discipline

Read only what the prompt or selected owner requires. Targeted work reads the named files and direct dependencies; broad architecture traversal requires explicit architecture intent. Stay within the current Git-tracked project and skip nested repositories, vendored tools, dependencies, build output, submodules, and ignored paths.
