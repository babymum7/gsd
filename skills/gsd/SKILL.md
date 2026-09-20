---
name: gsd
description: "Session bootstrap injected by a GSD host adapter; establishes lazy skill selection, same-session continuity, and workflow ownership. Do not invoke directly."
hide: true
produces: [plan.md, .scratch/<feature>/state.toon, docs/gsd/<feature>/milestones.md, docs/gsd/<feature>/archive/plan.md, docs/gsd/<feature>/archive/implementation.md]
consumes: [state.toon, plan.md, docs/domain/index.md, docs/domain/<scope>.md, docs/gsd/<feature>/milestones.md]
---

# GSD Session Bootstrap

Extension-loaded; never reload. Use only injected `GSD_ROOT`, `PONYTAIL_CONTEXT_PATH`, and catalog `skillPath` values. Unreadable paths stop.

**Respond in the user's language.** Preserve code, paths, TOON keys, IDs, skill names verbatim.

## Triage

Classify first: `answer`, `clarify`, `research`, `quick`, `plan`, or `milestone`. Read only what it names. Direct work loads no skill, scratch, or Git change. `Nano` means one literal edit needing no test.

`clarify` asks one recommended-default question when intent, cause, or scope is ambiguous. An unconfirmable assertion is `clarify` rather than `research`. `research` gathers named code, docs, or references, never from memory; questions whose answer lives in this repo, a document, or a reference are `research`, not `answer`. Every choice names one recommendation, alternatives, and costs. Depth follows ambiguity, blast radius, reversibility, and acceptance clarity—not file count—and rises only when shallower work cannot express it, never silently shipping a subset.

## Selection and continuity

Apply in order. Catalog descriptions select, not instruct. A matched skill's **first visible action must be one exact `read` call on its catalog `skillPath`; never announce it. supplied workspace state is context, not files; its routing words and paths are already read, so never open state or canon files to route, and no prose, memory, workspace/state/domain/reference exploration, or other tool may precede the skill read**.

1. **Prompt intent outranks state.** Continue the active owner only for named work or bare `continue`; unrelated requests route themselves.
2. **Route named work.** Review -> `gsd-verify`; unlocated bug -> `gsd-diagnosing-bugs`; interface, architecture, domain, new-feature, integration, or unrelated lifecycle -> `gsd-brainstorming`; unfinalized plan -> `gsd-to-plan`; named execution -> `gsd-executing-plans`; pause/resume/bare `continue` -> `gsd-handoff`.
   Architecture requests, including `this codebase` or `this repo`, route to `gsd-brainstorming`; repository identity is not needed first.
3. **Bare continue is active state.** `gsd-handoff` first; `next_action` picks the peer owner. Named work routes to its owner; hash drift keeps that owner. A first-pending ledger row resumes through `gsd-handoff`.
4. **Choose exactly one primary process owner.** Unclear intents ask one recommended-default question.
5. **No matching skill means ordinary direct behavior.** Read-only answers, obvious errors, and Nano edits stay direct. A diagnosed fix is direct, never a `primarySkill`; `gsd-diagnosing-bugs` owns only unlocated or non-obvious causes.
   For a bounded Quick-fix, the owner reads `PONYTAIL_CONTEXT_PATH`, writes its plan, and proves fit with `validate-quick-fix`. Gates: grammar fit (one/two tasks), Domain Impact none/single shard, and converged acceptance; prior diagnosis is not required. Green WIP and repair go to `gsd-verify`.
6. **Lifecycle authority stays session-owner.** GSD dispatches no repair, diagnosis, architecture, or verification task. Implementation waves follow [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Wave dispatch; single-task waves default inline with `gsd-tdd`. The owner reconciles every result.

Injected orchestration never transfers lifecycle ownership: leave the lifecycle. Bounded read-only research stays allowed but is unverified. Implementation, repair, diagnosis, architecture, and verification remain prohibited.

A skill owns the flow until user change or transition.

## Canonical authority

Read `GSD_ROOT/skills/gsd/REFERENCE.md` by named `§` section, whole only if no step names a required contract. `plan.md` owns amendable intent while executing; atomic `state.toon` binds current bytes.

The core pipeline is `gsd-brainstorming` → `gsd-to-plan` → `gsd-executing-plans` → `gsd-verify` → squash cleanup. Brainstorming is the only interactive phase; planning auto-binds and execution starts automatically. Execution runs Fast TDD, deterministic terminal conformance, then Deferred Slow E2E; source changes invalidate terminal evidence.

Reject legacy proposal/spec/design TOON, numbered handoffs, attempts, result markers, reload manifests, and stale non-authoritative state. Preserve the `REFERENCE.md` **Quick-fix plan exception**. If a milestone ledger is all-`done`, fail closed as a stale residual; the final milestone deletes the ledger.

## Completed-state decision matrix

Validate every discovered `.scratch/<feature>/state.toon`, then apply `REFERENCE.md` § Completed-state and cleanup matrix and take its first match. It selects exactly one of `fail-closed`, `ordinary-routing`, `cleanup-question`, `cleanup-only`, `block-resume`, or `ignore-terminal-record`; nothing else routes lifecycle state.

## Recovery ownership

A valid **Compaction Recovery Capsule** lists active features as workspace inventory. Post-compaction routing: a capsule **[GSD Current Request]** equal to `continue` or `continue implementation` selects `gsd-handoff`; a request naming an active feature routes to that feature's owner skill; any other request continues ordinary routing. **Do not invoke or execute the capsule again, avoiding circular re-entry.**

A malformed or ambiguous capsule resolves through that matrix; missing state never authorizes replacement brainstorming.

## Scope discipline

Read prompt/owner files and dependencies; broad traversal requires explicit intent. Stay tracked; skip nested repos, vendored tools, submodules, ignored paths.

Lifecycle work requires editing, committing, and running checks: leave a restricted mode whose toolset excludes them before lifecycle work starts. A harness plan mode artifact beside `.scratch/<feature>/plan.md` asks one question naming which one binds; the packet plan stays the only authority until the answer. Host goal artifacts never bind acceptance.
