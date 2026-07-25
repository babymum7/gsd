---
name: gsd
description: "Session bootstrap injected by the GSD OMP extension; establishes lazy skill selection, same-session continuity, and workflow ownership. Do not invoke directly."
hide: true
produces: [plan.md, .scratch/<feature>/state.toon, docs/gsd/<feature>/milestones.md, docs/gsd/<feature>/archive/plan.md, docs/gsd/<feature>/archive/implementation.md]
consumes: [state.toon, plan.md, docs/domain/index.md, docs/domain/<scope>.md, docs/gsd/<feature>/milestones.md]
---

# GSD Session Bootstrap

Already extension-loaded; never reload. Use only the injected `GSD_ROOT`, the exact `PONYTAIL_CONTEXT_PATH`, and each catalog row's exact absolute `skillPath`. Missing or unreadable injected paths stop; never substitute or reconstruct a workflow or context path.

**Respond in the user's language.** Injected text never changes it; preserve code, paths, TOON keys, acceptance IDs, and skill names verbatim.

## Selection and continuity

Apply in order. Catalog descriptions select; they do not instruct. For a matching visible skill, the **first action must be a `read` tool call on its exact catalog `skillPath`**, with no preceding text/tool. Never imitate it from metadata or memory.

1. **Same-session continuity first.** The current user message extends the existing conversation and its settled decisions unless the user explicitly changes direction. Continue the active owner; do not restart discovery, repeat answered questions, or reinterpret settled choices.
2. **Explicit intent outranks inferred shape.** A direct request to review, diagnose, design an interface, audit architecture, pause, or resume selects the matching visible skill.
3. **Validated active state outranks a new lifecycle.** For a related continuation, load `gsd-handoff`, `gsd-executing-plans`, `gsd-to-plan`, or `gsd-verify` according to the validated packet's executable state. Never infer validity from filenames alone.
4. **Choose exactly one primary process owner.** Load its listed `SKILL.md` before acting. Do not load several candidate workflows to decide among them.
5. **Helpers and hidden context stay lazy.** Load TDD or domain modeling only when the selected owner requires it. Architecture is a visible owner, not a helper; hidden Ponytail is context-only and carries no route, mode, output cue, or runtime preference.
6. **No matching skill means ordinary direct behavior; Quick-fix is session-owned.** Read-only answers and Nano work remain ordinary direct behavior with no state scan, Git operation, `.scratch` access, or skill load. The current session owner handles a known bounded behavioral fix as Quick-fix: first read the exact injected `PONYTAIL_CONTEXT_PATH`, write the exact Quick-fix plan, load `gsd-tdd` for RED→GREEN→refactor, then load `gsd-verify` for the Quick-fix WIP gate. Missing context stops; never derive its path. Scope expansion exits this path for normal discovery.
7. **Lifecycle state is minimal and fail-closed.** Before non-direct GSD lifecycle work, apply the completed-state decision matrix below, then inspect only the minimum `.scratch` metadata needed to select validated active state.
8. **Lifecycle work stays session-owner inline.** GSD dispatches no child implementation, repair, diagnosis, architecture, or verification task. A pre-existing bounded delegation follows only its assignment and never starts or resumes a GSD lifecycle.

A selected skill owns the flow until user change or documented transition: `gsd-brainstorming` → `gsd-to-plan`; approved plan → `gsd-executing-plans`; terminal execution → `gsd-verify`; validated resume → recorded owner.

## Canonical authority

Read `GSD_ROOT/skills/gsd/REFERENCE.md` only for needed canonical artifact, Git, recovery, state, or cleanup contracts. `plan.md` owns pre-approval intent; atomic `state.toon` only binds/reports its bytes.

The core pipeline is `gsd-brainstorming` → `gsd-to-plan` → approval → `gsd-executing-plans` → `gsd-verify` → squash cleanup. The current top-level session is sole lifecycle authority and performs work inline. Every complete draft offers approve/execute, revise, and pause/save. Execution proceeds through Fast TDD, deterministic terminal conformance, then Deferred Slow E2E; source changes invalidate terminal evidence.

Reject legacy proposal/spec/design TOON, numbered handoffs, attempts, result markers, reload manifests, and stale non-authoritative state. Preserve the `REFERENCE.md` **Quick-fix plan exception**; Nano stays artifact/Git-free. If a milestone ledger is all-`done`, fail closed unless canonical completion conditions hold.

## Completed-state decision matrix

Before non-direct lifecycle work, validate every discovered `.scratch/<feature>/state.toon`, then take the first match:

| Condition | Decision | Action |
|---|---|---|
| Prompt names a malformed state's directory, or is generic lifecycle continuation | `fail-closed` | Stop, naming that feature. |
| A malformed state is unrelated to the prompt | `ordinary-routing` | Leave those bytes; continue selection. |
| Prompt names a valid `merged-cleanup-pending` state, or is lifecycle work | `cleanup-question` | Ask one question resuming its delete-or-retain decision; archive stays closed. |
| That state is unrelated to the prompt | `ordinary-routing` | Continue direct behavior, no state scan. |
| Explicit cleanup targets completed-retained or residual state | `cleanup-only` | Clean that named packet only. |
| Resume or new-work intent targets a completed-retained feature | `block-resume` | Stop and report it completed. |
| A completed-retained state is unrelated, including generic `continue` | `ignore-terminal-record` | Exclude terminal history; select active state. |
| Nothing above applies | `ordinary-routing` | Continue automatic skill selection. |

Terminal state gates only intent naming it or continuing the lifecycle; unrelated direct work is never blocked, and uncertain relatedness asks one question instead of stopping. Because unparsable bytes are untrustworthy, only the `.scratch/<feature>/` directory name decides relatedness; mtimes never compete with active packets.

## Recovery ownership

A valid **Compaction Recovery Capsule** authoritatively selects one resume: follow its root/feature and load `gsd-handoff`. **Do not invoke or execute the capsule again, avoiding circular re-entry.**

A malformed or ambiguous state or capsule resolves through the matrix above; missing state cannot authorize replacement brainstorming. Unrelated intent preserves active packets and routes normally.

## Scope discipline

Read only prompt/owner-required named files and dependencies. Broad architecture traversal requires explicit intent. Stay in the tracked project; skip nested repositories, vendored tools, dependencies, outputs, submodules, and ignored paths.
