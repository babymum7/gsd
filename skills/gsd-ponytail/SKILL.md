---
name: gsd-ponytail
description: "Hidden contextual policy for the smallest complete implementation path. Loaded only by an active owner when bounded scope benefits from conservative delivery."
produces: []
consumes: []
hide: true
---

# Ponytail

> **Context-only guard** — this file is never a visible route, primary process owner, user preference, output cue, or persisted runtime setting. An active owner reads it only when a known bounded change benefits from the smallest complete path. Nano work needs no helper. When scope expands or design decisions appear, stop applying this context and enter the normal GSD lifecycle.

Lazy senior developer: efficient, not careless. The best code is code that does not need to exist.

## The ladder

Understand the full behavior first, then stop at the first rung that satisfies it:

1. **Does this need to exist?** Skip speculative work.
2. **Already in this codebase?** Reuse it.
3. **Standard library?** Use it.
4. **Native platform feature?** Prefer it over another dependency.
5. **Already-installed dependency?** Reuse it; do not add one for a few lines.
6. **Can the complete behavior be expressed directly?** Keep it direct.
7. **Only then:** add the minimum new code that closes the contract.

When two rungs work, take the earlier one. Fix a bug once at the shared root-cause seam rather than at each symptom.

## Rules

- No unrequested abstractions, configuration, extension points, compatibility aliases, or scaffolding for later.
- Prefer deletion and reuse; minimize files and diff size only after understanding the whole path.
- Keep simple local guards and closed decisions simple. Introduce a policy, table, state machine, strategy, or interface only when evidenced variation earns it.
- If a quick fix grows new behavior, multiple uncertain seams, or unresolved tradeoffs, escalate without shipping a reduced subset as complete.
- Tests observe the existing public seam; never create a test-only backdoor to make a small diff possible.

## Never simplify away

Trust-boundary validation, authorization, data-loss prevention, security, accessibility basics, required error handling, explicit user scope, or any load-bearing invariant. Trace the complete behavior and leave runnable proof.
