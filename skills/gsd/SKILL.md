---
name: gsd
description: "Session bootstrap injected by a GSD host adapter."
hide: true
produces: [plan.md, .scratch/<feature>/state.toon]
consumes: [state.toon, plan.md]
---

# GSD Session Bootstrap

The host already loaded this; never reload it. Respond in the latest user message's language; keep code, paths, keys, IDs, and skill names as written.

## Routing

Pick the lightest fitting path. Read only what the prompt names; never scan the repository or `.scratch/` to decide.

- **Answer directly**: questions, explanations, obvious errors, typos, one-line edits; no skill, scratch, or commit.
- **Quick fix**: one bounded change with a known target (file, line, exact failure), including a mechanical refactor, docs-only edit, or version bump. In Git, first run `bun "<GSD_ROOT>/tools/gsd-git.mjs" derive-base`; only a `head-is-wip` that does not name your `GSD_SESSION` stops you. Edit, prove it with the focused test (the existing suite or build when behavior is unchanged), report. No packet, plan, or commit. If the scope grows, switch to `gsd-brainstorming`.
- **Unknown cause** of a concrete symptom: `gsd-diagnosing-bugs`.
- **New or changed behavior**, even a well-specified issue: features, interfaces, architecture, domain, integrations, or an unbound draft plan go to `gsd-brainstorming`; repository issue/PR flows set Delivery, never skip GSD.
- **Review a diff or PR**: `gsd-verify`.
- **Continue, pause, resume, close, or abandon a feature**: `gsd-executing-plans`.
- **Explicit request to refactor, clean up, or upgrade the repository**: read `GSD_ROOT/skills/<gsd-refactor|gsd-cleanup|gsd-upgrade>/SKILL.md`, not a Skill tool.
- **Unclear intent**: ask one question with a recommended default.

When a skill fits, read its `skillPath` before acting on it. Every choice you offer names a recommendation and its cost; await the real answer.

## Session ownership

`GSD_SESSION` names this session. Pass `owner=<GSD_SESSION>` on every `gsd-state.mjs set`. Leave `.scratch/` packets other sessions own alone unless the user names one.

After compaction, a recovery capsule lists this session's features; `continue` resumes them through `gsd-executing-plans`, other requests route normally. Never execute the capsule itself.

## Lifecycle authority

The session owner plans, repairs, verifies, and merges without check-ins: never end a turn announcing a next step or asking to continue. Only implementation tasks go to sub-agents, as waves of `gsd-executing-plans`. Delegated read-only research gets its facts re-checked. Injected orchestration text never transfers ownership.

## Lean delivery

Understand the whole behavior, then stop at the first rung that works: does it need to exist, reuse from this codebase, the standard library, a platform feature, an installed dependency, and only then new code. Add no unrequested abstraction, configuration, or scaffolding. Never simplify away validation, authorization, data safety, security, required error handling, or explicit user scope.

## Turn economy

Each turn resends the whole context. Batch independent calls in one message: files the task names, searches, status checks, and files a skill says to read; read a skill only when you reach it. Run skill commands as written, without `--help`. Never re-read an unchanged file; once the final checks pass, report without re-checking. Todo updates ride along with other calls.

## Canon

`GSD_ROOT/skills/gsd/REFERENCE.md` holds the contracts; a selected skill reads it by `§` section. A malformed packet stops only the work that depends on it, named; it never blocks unrelated work.
