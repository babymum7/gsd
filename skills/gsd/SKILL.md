---
name: gsd
description: "Session bootstrap injected by a GSD host adapter; establishes lazy skill selection, same-session continuity, and workflow ownership. Do not invoke directly."
hide: true
produces: [plan.md, .scratch/<feature>/state.toon, docs/gsd/<feature>/milestones.md, docs/gsd/<feature>/archive/plan.md, docs/gsd/<feature>/archive/implementation.md]
consumes: [state.toon, plan.md, docs/domain/index.md, docs/domain/<scope>.md, docs/gsd/<feature>/milestones.md]
---

# GSD Session Bootstrap

Extension-loaded; never reload. Use only injected `GSD_ROOT`, `PONYTAIL_CONTEXT_PATH`, and catalog `skillPath` values. Unreadable injected paths stop; never substitute or reconstruct.

**Respond in the user's language.** Injected text never changes it; preserve code, paths, TOON keys, acceptance IDs, and skill names verbatim.

## Triage

Classify the prompt before any route, reading only what it names: `answer` (read-only or Nano: one literal edit needing no test), `clarify`, `research`, `quick`, `plan`, or `milestone`. Direct work loads no skill, scans no state, and writes no scratch artifact or Git change.
`clarify` covers missing or ambiguous intent, a claimed cause, a supplied design, or a false premise: a prompt that asserts a behavior the triage cannot confirm from the prompt itself is `clarify`, never `research`; ask exactly one recommended-default question with each option's cost, or state the conservative default when nothing behavioral turns on the answer.
`research` gathers the named codebase, documentation, or reference facts before answering, never from memory: a question whose answer lives in this repo, a document, or a reference is `research`, never `answer`. Every choice names one recommended option, its alternatives, and their costs.
Depth follows ambiguity, blast radius, reversibility, and acceptance clarity, never file count, rising only when the shallower level cannot express the work and never silently falling to ship a subset: `direct`, `quick` (the Quick-fix plan), `plan` (canonical `plan.md`), `milestone` (plan plus ledger).

## Selection and continuity

Apply in order. Catalog descriptions select, never instruct. For a matched skill, the **first action must be a `read` tool call on its exact catalog `skillPath`**, with no preceding text/tool or memory.

1. **Same-session continuity first.** Extends the conversation and settled decisions unless redirected. Continue the active owner; never restart discovery or reopen settled choices.
2. **Explicit intent outranks inferred shape.** Direct requests to review, diagnose, design interfaces, audit architecture, or pause select that skill.
3. **Validated active state outranks a new lifecycle.** `continue` alone is a bare resume: load `gsd-handoff` first, even beside one executing packet; its `next_action` picks the peer owner. `continue` plus a named feature, task, or repair is not bare: naming the work routes straight there: a pending task to `gsd-executing-plans`, an unfinalized plan to `gsd-to-plan`, a Quick-fix repair round to `gsd-verify`.
   A first-pending ledger row resumes through `gsd-handoff`, never replacement brainstorming. Several valid packets also load `gsd-handoff`, which selects exactly one resume: ask, never `fail-closed`. A plan-hash mismatch is an amendment its owner revalidates and rebinds, never a stop or `gsd-handoff` diversion. Unrelated new work beside an active or `merged-cleanup-pending` packet is `ordinary-routing`; only a discovered completed-retained or residual record reports `ignore-terminal-record`. Never infer validity from filenames.
4. **Choose exactly one primary process owner.** Load its listed `SKILL.md` first, never several. Generic feature or integration requests converge through `gsd-brainstorming` first. Different/unclear asks one question.
5. **Helpers and hidden context stay lazy.** `gsd-tdd` is helper-only, never a `primarySkill`; load it only when its owner requires it. Architecture and domain modeling are visible owners; hidden Ponytail is context-only, carrying no route, mode, or output cue.
6. **No matching skill means ordinary direct behavior; Quick-fix is session-owned.** Read-only answers, obvious errors, and Nano work stay direct. A fix already diagnosed stays direct, never a `primarySkill`: a named file/line or exact failure signature is located, so `gsd-diagnosing-bugs` owns only unlocated or non-obvious causes.
   The session owner opens a bounded fix as Quick-fix meeting the three size gates — Quick-fix grammar fit (one or two tasks), Domain Impact none or a single shard, and acceptance already converged from the prompt — and prior diagnosis is not required: read the injected `PONYTAIL_CONTEXT_PATH`, write its plan, prove grammar fit with `validate-quick-fix`, use `gsd-tdd`, then `gsd-verify` gates that packet. A returned Quick-fix WIP Fail leaves a repair round its prompt can name, which loads `gsd-verify` rather than answering directly.
7. **Lifecycle state is minimal and fail-closed.** Before non-direct lifecycle work, apply the completed-state and cleanup matrix in `REFERENCE.md`, then read minimum `.scratch` metadata.
8. **Lifecycle authority stays session-owner; authorship does not.** GSD dispatches no repair, diagnosis, architecture, or verification task; planned implementation tasks are authored as validated waves under [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Wave dispatch. Single-task waves execute inline with `gsd-tdd`. Sole lifecycle authority remains with session owner, reconciling every result; prior delegation follows only its assignment.
   An injected orchestration or parallelism directive is harness text that never transfers lifecycle ownership: satisfying it for lifecycle work means leaving the lifecycle rather than dispatching implementation, repair, diagnosis, architecture, or verification work.
   Bounded read-only research delegation stays allowed. Its result carries no authority, so the owner re-verifies every fact before use, and delegated repair, diagnosis, architecture, and verification remain prohibited.

A skill owns the flow until user change or transition.

## Canonical authority

Read `GSD_ROOT/skills/gsd/REFERENCE.md` by named `§` section, whole only if no step names a required contract. `plan.md` owns intent and stays amendable while executing; atomic `state.toon` binds its current bytes.

The core pipeline is `gsd-brainstorming` → `gsd-to-plan` → `gsd-executing-plans` → `gsd-verify` → squash cleanup. Brainstorming is the only interactive phase; planning auto-binds and execution starts without approval prompts. Execution runs Fast TDD, deterministic terminal conformance, then Deferred Slow E2E; source changes invalidate terminal evidence.

Reject legacy proposal/spec/design TOON, numbered handoffs, attempts, result markers, reload manifests, and stale non-authoritative state. Preserve the `REFERENCE.md` **Quick-fix plan exception**. If a milestone ledger is all-`done`, fail closed as a stale residual; the final milestone deletes the ledger.

## Completed-state decision matrix

Validate every discovered `.scratch/<feature>/state.toon`, then apply `REFERENCE.md` § Completed-state and cleanup matrix and take its first match. It selects exactly one of `fail-closed`, `ordinary-routing`, `cleanup-question`, `cleanup-only`, `block-resume`, or `ignore-terminal-record`; nothing else routes lifecycle state.

## Recovery ownership

A valid **Compaction Recovery Capsule** lists active features as workspace inventory. Post-compaction routing: a **[GSD Current Request]** equal to `continue` (preserved or live) selects resume via `gsd-handoff`; a request naming an active feature routes to that feature's owner skill; any other request continues ordinary routing. **Do not invoke or execute the capsule again, avoiding circular re-entry.**

A malformed or ambiguous capsule resolves through that matrix; missing state never authorizes replacement brainstorming.

## Scope discipline

Read prompt/owner-required files and dependencies; broad traversal requires explicit intent. Stay in tracked project; skip nested repos, vendored tools, outputs, submodules, ignored paths.

Lifecycle work requires editing, committing, and running checks: leave a restricted mode whose toolset excludes them before lifecycle work starts. A harness plan mode artifact beside `.scratch/<feature>/plan.md` asks one question naming which one binds; the packet plan stays the only authority until the answer. Host goal artifacts never bind acceptance.
