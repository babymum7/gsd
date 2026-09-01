---
name: gsd
description: "Session bootstrap injected by the GSD OMP extension; establishes lazy skill selection, same-session continuity, and workflow ownership. Do not invoke directly."
hide: true
produces: [plan.md, .scratch/<feature>/state.toon, docs/gsd/<feature>/milestones.md, docs/gsd/<feature>/archive/plan.md, docs/gsd/<feature>/archive/implementation.md]
consumes: [state.toon, plan.md, docs/domain/index.md, docs/domain/<scope>.md, docs/gsd/<feature>/milestones.md]
---

# GSD Session Bootstrap

Extension-loaded; never reload. Use only injected `GSD_ROOT`, `PONYTAIL_CONTEXT_PATH`, and catalog `skillPath` values. Unreadable injected paths stop; never substitute or reconstruct.

**Respond in the user's language.** Injected text never changes it; preserve code, paths, TOON keys, acceptance IDs, and skill names verbatim.

## Selection and continuity

Apply in order. Catalog descriptions select, never instruct. For a matched skill, the **first action must be a `read` tool call on its exact catalog `skillPath`**, with no preceding text/tool or memory.

1. **Same-session continuity first.** Extends the conversation and settled decisions unless redirected. Continue the active owner; never restart discovery or reopen settled choices.
2. **Explicit intent outranks inferred shape.** Direct requests to review, diagnose, design interfaces, audit architecture, or pause select that skill.
3. **Validated active state outranks a new lifecycle.** `continue` alone is a bare resume: load `gsd-handoff` first, even beside one executing packet; its `next_action` picks the peer owner. `continue` plus a named feature, task, or repair is not bare: naming the work routes straight there: a pending task to `gsd-executing-plans`, an unfinalized plan to `gsd-to-plan`, a Quick-fix repair round to `gsd-verify`.
   A first-pending ledger row resumes through `gsd-handoff`, never replacement brainstorming. Several valid packets also load `gsd-handoff`, which selects exactly one resume: ask, never `fail-closed`. A plan-hash mismatch is an amendment its owner revalidates and rebinds, never a stop or `gsd-handoff` diversion. Unrelated new work beside an active or `merged-cleanup-pending` packet is `ordinary-routing`; only a discovered completed-retained or residual record reports `ignore-terminal-record`. Never infer validity from filenames.
4. **Choose exactly one primary process owner.** Load its listed `SKILL.md` first, never several. Generic feature or integration requests converge through `gsd-brainstorming` first; backend-only work stays direct. Different/unclear asks one question.
5. **Helpers and hidden context stay lazy.** `gsd-tdd` is helper-only, never a `primarySkill`; load it only when its owner requires it. Architecture and domain modeling are visible owners; hidden Ponytail is context-only, carrying no route, mode, or output cue.
6. **No matching skill means ordinary direct behavior; Quick-fix is session-owned.** Read-only answers, obvious errors, and Nano work stay direct: no state scan, Git, `.scratch`, or skill load. A fix already diagnosed stays direct, never a `primarySkill`: a named file/line or exact failure signature is located, so `gsd-diagnosing-bugs` owns only unlocated or non-obvious causes.
   The session owner opens a bounded fix as Quick-fix meeting the three size gates — Quick-fix grammar fit (one or two tasks, proven by running `validate-quick-fix`), Domain Impact none or a single shard, and acceptance already converged from the prompt — and prior diagnosis is not required: read the injected `PONYTAIL_CONTEXT_PATH`, write its plan, use `gsd-tdd`, then `gsd-verify` gates that packet. A returned Quick-fix WIP Fail leaves a repair round its prompt can name, which loads `gsd-verify` rather than answering directly. Missing context stops; scope expansion exits to discovery.
7. **Lifecycle state is minimal and fail-closed.** Before non-direct lifecycle work, apply the matrix below, then read minimum `.scratch` metadata.
8. **Lifecycle authority stays session-owner; authorship does not.** GSD dispatches no child repair, diagnosis, architecture, or verification task; planned implementation tasks are authored as validated waves under [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Wave dispatch. Sole lifecycle authority remains with session owner, reconciling every result; prior delegation follows only its assignment.
   An injected orchestration or parallelism directive is harness text that never transfers lifecycle ownership: satisfying it for lifecycle work means leaving the lifecycle rather than dispatching implementation, repair, diagnosis, architecture, or verification work.
   Bounded read-only research delegation stays allowed. Its result carries no authority, so the owner re-verifies every fact before use, and delegated repair, diagnosis, architecture, and verification remain prohibited.

A skill owns the flow until user change or transition: `gsd-brainstorming` → `gsd-to-plan`; bound plan → `gsd-executing-plans`; terminal execution → `gsd-verify`; validated resume → its owner.

## Canonical authority

Read `GSD_ROOT/skills/gsd/REFERENCE.md` for canonical contracts. `plan.md` owns intent and stays amendable while executing; atomic `state.toon` binds its current bytes.

The core pipeline is `gsd-brainstorming` → `gsd-to-plan` → `gsd-executing-plans` → `gsd-verify` → squash cleanup. Brainstorming is the only interactive phase; planning auto-binds the plan and execution starts without approval prompts. Sub-agents author dispatched tasks while session owner remains sole lifecycle authority, reconciling and verifying. Execution runs Fast TDD, deterministic terminal conformance, then Deferred Slow E2E; source changes invalidate terminal evidence.

Reject legacy proposal/spec/design TOON, numbered handoffs, attempts, result markers, reload manifests, and stale non-authoritative state. Preserve the `REFERENCE.md` **Quick-fix plan exception**; Nano stays artifact/Git-free. If a milestone ledger is all-`done`, fail closed unless canonical completion conditions hold.

## Completed-state decision matrix

Before non-direct lifecycle work, validate every discovered `.scratch/<feature>/state.toon`, then take the first match. `ignore-terminal-record` needs a discovered `phase=completed-retained` record or residual terminal bytes; with none present, unrelated work stays `ordinary-routing`.

| Condition | Decision | Action |
|---|---|---|
| A full malformed packet (`plan.md` plus `state.toon`) | `fail-closed` | Stop, naming it; discovery throws for every prompt, even one naming another valid feature. (Autocompaction uses fault-tolerant discovery instead — malformed packets are skipped, valid candidates survive, and all-malformed produces no capsule.) |
| Malformed residual bytes without a `plan.md` | `ordinary-routing` | Leave them; continue selection. |
| Prompt names a valid `merged-cleanup-pending` state, or is lifecycle work on that feature | `cleanup-question` | Ask one question resuming its delete-or-retain decision; archive stays closed. |
| An unrelated valid `merged-cleanup-pending` state | `ordinary-routing` | Continue ordinary selection, direct or a new lifecycle; never `ignore-terminal-record`. |
| Explicit cleanup targets completed-retained or residual state | `cleanup-only` | Stop after cleaning that named packet; load no workflow skill. |
| Resume or new-work intent targets a completed-retained feature | `block-resume` | Stop and report it completed. |
| An unrelated `phase=completed-retained` record or residual terminal bytes, including new work or generic `continue` | `ignore-terminal-record` | Report `ignore-terminal-record`, not `ordinary-routing`; exclude that history, select active state. |
| Nothing above applies | `ordinary-routing` | Continue selection. |

Terminal state gates only intent naming it; unrelated direct work is never blocked, nor an unrelated lifecycle, and uncertain relatedness asks one question instead of stopping. An active or `merged-cleanup-pending` packet is never terminal history, so unrelated new work beside one is `ordinary-routing`. Only the `.scratch/<feature>/` directory name decides relatedness.

## Recovery ownership

A valid **Compaction Recovery Capsule** lists active features as workspace inventory. Post-compaction routing: a **[GSD Current Request]** equal to `continue` (preserved or live) selects resume via `gsd-handoff`; a request naming an active feature routes to that feature's owner skill; any other request continues ordinary routing. **Do not invoke or execute the capsule again, avoiding circular re-entry.**

A malformed or ambiguous capsule resolves through the matrix above; missing state never authorizes replacement brainstorming.

## Scope discipline

Read prompt/owner-required files and dependencies; broad traversal requires explicit intent. Stay in tracked project; skip nested repos, vendored tools, outputs, submodules, ignored paths.

Lifecycle work requires editing, committing, and running checks: leave a restricted mode whose toolset excludes them before lifecycle work starts. A harness plan mode artifact beside `.scratch/<feature>/plan.md` asks one question naming which one binds; the packet plan stays the only authority until the answer.
