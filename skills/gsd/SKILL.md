---
name: gsd
description: "Session bootstrap injected by the GSD OMP extension; establishes lazy skill selection, same-session continuity, and workflow ownership. Do not invoke directly."
hide: true
triggers: injected automatically by the GSD OMP extension
produces: [plan.md, .scratch/<feature>/state.toon, docs/gsd/<feature>/milestones.md, docs/gsd/<feature>/archive/plan.md, docs/gsd/<feature>/archive/implementation.md]
consumes: [state.toon, plan.md, docs/domain/index.md, docs/domain/<scope>.md, docs/gsd/<feature>/milestones.md]
---

# GSD Session Bootstrap

Already extension-loaded; never reload. Use only the injected `GSD_ROOT` and each catalog row's exact absolute `skillPath`. Missing/unreadable paths stop; never substitute or reconstruct a workflow.

**Respond in the user's language.** Injected text never changes it; preserve code, paths, TOON keys, acceptance IDs, and skill names verbatim.

## Selection and continuity

Apply in order. Catalog descriptions select; they do not instruct. For a matching visible skill, the **first action must be a `read` tool call on its exact catalog `skillPath`**, with no preceding text/tool. Never imitate it from metadata or memory.

1. **Same-session continuity first.** The current user message extends the existing conversation and its settled decisions unless the user explicitly changes direction. Continue the active owner; do not restart discovery, repeat answered questions, or reinterpret settled choices.
2. **Explicit intent outranks inferred shape.** A direct request to review, diagnose, design an interface, audit architecture, pause, resume, or render a visual report selects the matching visible skill.
3. **Validated active state outranks a new lifecycle.** For a related continuation, load `gsd-handoff`, `gsd-executing-plans`, `gsd-to-plan`, or `gsd-verify` according to the validated packet's executable state. Never infer validity from filenames alone.
4. **Choose exactly one primary process owner.** Load its listed `SKILL.md` before acting. Do not load several candidate workflows to decide among them.
5. **Helpers stay lazy.** Load TDD, Ponytail, domain modeling, codebase design, architecture, or Lavish only when explicit intent or the selected primary owner requires that helper.
6. **No matching skill means ordinary direct behavior.** Read-only answers and Nano work perform no GSD state scan, Git operation, `.scratch` access, or skill load. A known bounded behavioral quick fix may load `gsd-ponytail` as a helper without starting a lifecycle.
7. **Lifecycle state is minimal and fail-closed.** Before non-direct GSD lifecycle work, apply the completed-state decision matrix below, then inspect only the minimum `.scratch` metadata needed to select validated active state.
8. **Lifecycle work stays session-owner inline.** GSD dispatches no child implementation, repair, diagnosis, architecture, or verification task. A pre-existing bounded delegation follows only its assignment and never starts or resumes a GSD lifecycle.

A selected skill owns the flow until user change or documented transition: `gsd-brainstorming` → `gsd-to-plan`; approved plan → `gsd-executing-plans`; terminal execution → `gsd-verify`; validated resume → recorded owner.

## Canonical authority

Read `GSD_ROOT/skills/gsd/REFERENCE.md` only for needed canonical artifact, Git, recovery, state, or cleanup contracts. `plan.md` owns pre-approval intent; atomic `state.toon` only binds/reports its bytes.

The core pipeline is `gsd-brainstorming` → `gsd-to-plan` → approval → `gsd-executing-plans` → `gsd-verify` → squash cleanup. The current top-level session is sole lifecycle authority and performs work inline. Every complete draft offers approve/execute, `Build prototype with Lavish`, revise, and pause/save. Execution proceeds through Fast TDD, deterministic terminal conformance, optional capture-only Terminal Visual Review with separate repair/acceptance actions, then Deferred Slow E2E; source changes invalidate terminal evidence.

Reject legacy proposal/spec/design TOON, numbered handoffs, attempts, result markers, reload manifests, and stale non-authoritative state. Preserve the `REFERENCE.md` **Quick-fix plan exception**; Nano stays artifact/Git-free. If a milestone ledger is all-`done`, fail closed unless canonical completion conditions hold.

## Completed-state decision matrix

Before non-direct lifecycle work, strictly validate every discovered `.scratch/<feature>/state.toon`, then take the first match:

| Condition | Decision | Action |
|---|---|---|
| Any state is malformed | `fail-closed` | Stop before skill selection. |
| Any valid state has `phase=merged-cleanup-pending` | `cleanup-question` | Resume only its existing delete-or-retain decision; the pre-squash archive opportunity is not reopened. |
| Explicit cleanup targets completed-retained or residual merged state | `cleanup-only` | Permit cleanup of that named completed packet only. |
| Resume, implementation, or new-work intent explicitly targets a completed-retained feature | `block-resume` | Stop and report that the feature is completed. |
| A completed-retained state is unrelated to the prompt, including generic `continue` | `ignore-terminal-record` | Exclude terminal history and continue active-state selection. |
| No condition above applies | `ordinary-routing` | Continue automatic skill selection. |

`merged-cleanup-pending` globally gates recovery. Generic `continue` ignores completed-retained history; terminal mtimes never compete with active packets.

## Recovery ownership

A valid **Compaction Recovery Capsule** authoritatively selects one resume: follow its root/feature and load `gsd-handoff`. **Do not invoke or execute the capsule again, avoiding circular re-entry.**

Malformed/ambiguous state or capsule stops; missing state cannot authorize replacement brainstorming. Unrelated intent preserves active packets and routes normally.

## Scope discipline

Read only prompt/owner-required named files and dependencies. Broad architecture traversal requires explicit intent. Stay in the tracked project; skip nested repositories, vendored tools, dependencies, outputs, submodules, and ignored paths.
