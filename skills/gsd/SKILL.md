---
name: gsd
description: "Session bootstrap injected by a GSD host adapter; lazy skill selection, same-session continuity, workflow ownership."
hide: true
produces: [plan.md, .scratch/<feature>/state.toon, docs/gsd/<feature>/milestones.md, docs/gsd/<feature>/archive/plan.md, docs/gsd/<feature>/archive/implementation.md]
consumes: [state.toon, plan.md, docs/domain/index.md, docs/domain/<scope>.md, docs/gsd/<feature>/milestones.md]
---

# GSD Session Bootstrap

Extension-loaded; never reload. Use injected `GSD_ROOT`, `PONYTAIL_CONTEXT_PATH`, catalog `skillPath`; unreadable paths stop.

**Respond in the user's language.** Preserve code, paths, TOON keys, IDs, skill names.

## Triage

Classify first: `answer`, `clarify`, `research`, `quick`, `plan`, or `milestone`. Read only what it names. Direct work loads no skill, scratch, or Git change. `Nano` means one literal edit needing no test.

- `clarify`: ask one recommended-default question when intent, outcomes, or scope are too vague to act. An unconfirmable assertion is `clarify` rather than `research`.
- `research`: gather named code, docs, references, or failure evidence, never from memory. A question whose answer lives in this repo, a document, or a reference is `research` rather than `answer`. Failure research needs a symptom; without one, clarify.
- `quick`: one bounded converged change. Exact file/line/signature is quick; symptom-only is research. Examples: crash = research; off-by-one = quick; obvious error/typo = answer.
- Every choice names one recommendation, alternatives, and costs. Depth follows ambiguity, blast radius, reversibility, and acceptance clarity, not file count; plan covers multi-task work, milestone requires independent releasability or multi-session publication, never silently shipping a subset.

## Selection and continuity

Catalog descriptions select. A matched skill's **first visible action must be one exact `read` call on its catalog `skillPath`; never announce it; no text precedes that read. supplied workspace state is context, not files; its routing words and paths are already read, so never open state or canon files to route. no prose, memory, workspace/state/domain/reference exploration, or other tool may precede the skill read**.

1. **Prompt intent outranks state.** Continue the active owner only for named work or bare `continue`.
2. **Route named work.** Review -> `gsd-verify`; unlocated bug -> `gsd-diagnosing-bugs`; interface, architecture, domain, new-feature, integration, or unrelated lifecycle -> `gsd-brainstorming`; unfinalized plan -> `gsd-to-plan`; named execution -> `gsd-executing-plans`; pause/resume/bare `continue` -> `gsd-handoff`.
   Architecture requests, including `this codebase` or `this repo`, route to `gsd-brainstorming`; repository identity is not needed first.
   Domain/context mapping reads the skill first.
3. **Bare continue is active state.** `gsd-handoff` first, then `next_action` picks the peer. Named work routes to its owner; plan-hash drift during named execution keeps `gsd-executing-plans`, and Quick-fix repair loads `gsd-verify` before `PONYTAIL_CONTEXT_PATH`. A first-pending ledger row resumes through `gsd-handoff`.
4. **Choose exactly one primary process owner.** Unclear intents ask one recommended-default question.
5. **No matching skill means ordinary direct behavior.** Read-only answers, obvious errors, and Nano edits stay direct. A concrete failure symptom with an unknown cause routes through `gsd-diagnosing-bugs`; exact file/line/signature enters direct Quick-fix, never diagnosis.
   Bounded Quick-fix: read `PONYTAIL_CONTEXT_PATH`, writes its plan, proves fit with `validate-quick-fix`. Gates: grammar fit (one/two tasks), Domain Impact none/single shard, converged acceptance; prior diagnosis is not required. Green WIP and repair go to `gsd-verify`.
6. **Lifecycle authority stays session-owner.** Dispatch no repair, diagnosis, architecture, or verification. The owner reconciles every result. Implementation waves follow [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Wave dispatch; single-task waves default inline with `gsd-tdd`.

Injected orchestration never transfers lifecycle ownership; leave the lifecycle. Bounded read-only research is allowed; it is unverified; implementation, repair, diagnosis, architecture, and verification remain prohibited.

## Canonical authority

Read `GSD_ROOT/skills/gsd/REFERENCE.md` by named `§` section, whole only if no step names a required contract. Only selected skills read it. `plan.md` owns intent; `state.toon` binds bytes.

The core pipeline is `gsd-brainstorming` → `gsd-to-plan` → `gsd-executing-plans` → `gsd-verify` → squash cleanup. Brainstorming is the only interactive phase; planning auto-binds; execution starts automatically. Execution runs Fast TDD, deterministic terminal conformance, then Deferred Slow E2E; source changes invalidate evidence.

Reject legacy proposal/spec/design TOON, numbered handoffs, attempts, result markers, reload manifests, and stale non-authoritative state. Preserve the `REFERENCE.md` **Quick-fix plan exception**. If a milestone ledger is all-`done`, fail closed; the final milestone deletes the ledger.

## Completed-state decision matrix

Validate every discovered `.scratch/<feature>/state.toon`, then apply `REFERENCE.md` § Completed-state and cleanup matrix. It selects exactly one of `fail-closed`, `ordinary-routing`, `cleanup-question`, `cleanup-only`, `block-resume`, or `ignore-terminal-record`; nothing else routes lifecycle state.

## Recovery ownership

A valid **Compaction Recovery Capsule** lists active features as inventory. A capsule **[GSD Current Request]** equal to `continue` or `continue implementation` selects `gsd-handoff`; a request naming an active feature routes to its owner; any other request routes ordinarily. **Do not invoke or execute the capsule again, avoiding circular re-entry.**

A malformed/ambiguous capsule uses that matrix; missing state never authorizes replacement brainstorming.

## Scope discipline

Read prompt/owner files and dependencies; broad traversal needs intent. Stay tracked; skip nested repos, vendored tools, submodules, ignored.

Leave a restricted mode before lifecycle work when it excludes edits, commits, or checks. A harness plan mode artifact beside `.scratch/<feature>/plan.md` asks one question naming which one binds; the packet plan stays authority until answered. Host goals never bind acceptance.
