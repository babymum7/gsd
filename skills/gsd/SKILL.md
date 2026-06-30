---
name: gsd
description: Master entry point for all agent actions. Automatically routes, starts, resumes, and coordinates all sub-skills (discussion, planning, executing, verify, handoff, diagnostics) based on user prompt.
---

# GSD (Master Entry)

The single entry point for all workflows. The user invokes `/gsd` on any prompt, and the agent determines the appropriate sub-flow to execute or resume.

## System map
**Pipeline:** `gsd` (Master Entry & Discussion) → `gsd-to-plan` → `gsd-executing-plans` → `gsd-verify` → main.
**Auto-composed:** `gsd-lavish` (render deliverables), `gsd-ponytail` (minimize code), `gsd-domain-modeling` (glossary), `gsd-codebase-design` (module vocab), `gsd-handoff` (resume), `gsd-tdd` (unit tests), `gsd-diagnosing-bugs` (debug), `gsd-improve-codebase-architecture` (deepening).
**Feedback loops:** `gsd-verify`/`gsd-executing-plans`/`gsd-to-plan` → `gsd` (spec gap); `gsd-diagnosing-bugs` → `gsd-improve-codebase-architecture`.
**Manual/proactive:** any skill is also directly invokable — `/gsd-improve-codebase-architecture` (audit deepening), `/gsd-diagnosing-bugs` (stuck), `/gsd-domain-modeling` (sharpen glossary), `/gsd-codebase-design` (interface design).

## Smart Routing Engine
On entry, analyze the prompt and workspace state to route to the correct sub-flow:
0. **Direct / Trivial (check first)**:
   - Simple question, advisory, or a small targeted change (named file, ≤1 module, no design) → answer directly or `gsd-ponytail` quick-fix. **Do NOT explore broadly or trigger architecture skills.**
1. **Resume**:
   - If `.scratch/<feature>/handoff-<n>.toon` exists or is passed → Read the handoff file's `mode` and `phase`, automatically load the required sub-skills, and execute the `next_action` directly.
2. **Review/Diff**:
   - If the prompt contains a diff, PR description, or asks for code review → route to `gsd-verify`.
3. **Spec/Plan**:
   - If a spec has been created but no plan exists → route to `gsd-to-plan`.
   - If a plan exists and status is pending/in-progress → route to `gsd-executing-plans`.
4. **Issue/Bug**:
   - If user reports an error, stack trace, or failing test → route to `gsd-diagnosing-bugs`.
5. **Codebase Exploration**:
   - If user asks about architecture, design, or deep module refactoring → route to `gsd-improve-codebase-architecture` or `gsd-codebase-design`.
6. **New Work / Vague Input**:
   - If starting a new feature or receiving a vague one-liner → route to **Discussion** to stress-test or discover requirements.

## Scope discipline — read only what the prompt needs
Match exploration breadth to prompt complexity; over-exploration drifts from the ask and burns the budget.
- **Trivial/targeted prompt** → read the named file(s) + their direct imports only. No whole-tree scan, no architecture skill.
- **Whole-codebase work** — an explicit "audit / map / refactor the architecture" — is the ONLY case you walk broadly (scoped per the rules below).
- **Stay in git scope.** Operate on the current project's git-tracked tree only. Skip non-git subtrees (nested repos, vendored tools, submodules carrying their own `.git`) and dependency/build/output dirs (`node_modules`, `dist`, `build`, `.next`, `target`, …) and anything `.gitignore`'d. These are noise — never the subject of a simple prompt.
- Locate with `grep`/`glob`; load with `read` (offset/limit). Never open a directory hoping. One relevant file beats ten speculative reads.
- **Delegating exploration** (Explore subagent) → pass these bounds in its prompt; an unscoped explore subagent walks everything.

## Dynamic Sub-Skill Loading
To keep startup context light, only `/gsd` is registered/loaded; sub-skills are NOT separate skills. When `/gsd` routes to one, resolve this skill's real directory once, then read the sibling sub-skill:
```
  SKILLS_DIR="$(dirname "$(readlink ~/.agents/skills/gsd)")"
  # then: read "$SKILLS_DIR/gsd-<sub-skill>/SKILL.md"
```
This follows this skill's own symlink to its real location, so it works from any working directory — no need to register the sub-skills.

## Entry — Discussion Mode
- Pastes plan/spec/diff → **stress-test**.
- Vague one-liner → **discovery**.
- Ambiguous → ONE disambiguating question.
- Pure question/advisory/exploration (no code change intended) → **answer directly**; no spec/plan.
## Body
Recommend an answer for every question. One design branch at a time.
- **Independent Qs** → batch (each with a recommendation). **Dependent** → sequential. Never batch a dependent chain.
- **Discovery**: explore (targeted, git-scoped — see Scope discipline) → clarifying Qs → 2-3 approaches + tradeoffs + recommendation.
- **Stress-test**: break/sharpen the plan — risks, edge cases, missing decisions, hidden assumptions.

## Convergence — write `spec.md`
When Discovery/stress-test converges (the user picks an approach and open questions close), write `.scratch/<feature>/spec.md` BEFORE routing to `gsd-to-plan`. It is the contract every downstream skill reads — `gsd-to-plan` maps each task's `satisfies` to these AC IDs; `gsd-verify` checks every AC is met.

Format:
```
# <feature>
## Context
<1-3 sentences: why this exists, current pain>
## Acceptance Criteria
- AC-1: <one verifiable outcome a reviewer can check in isolation>
- AC-2: <...>
```

Rules:
- Every AC is **checkable** ("endpoint returns 200 with `{ok:true}`", "user sees the badge") — never a task ("implement logging"). A reviewer reading only the AC knows how to confirm it.
- AC IDs are stable: `gsd-to-plan`/`gsd-verify` reference them. A spec revision re-issues fresh ACs and marks the replaced ones superseded.
- Quick-fix fast-path (below) has no `spec.md` — `gsd-verify` then judges code-quality only.

## Auto-triggers (supporting skills fire automatically)
 - `gsd-lavish` — the exclusive visual surface for substantial deliverables: an approach comparison, a crystallized `spec.md`, a non-trivial finalized `plan.toon`, the `gsd-verify` report, an architecture audit. Never on inline Qs or mid-execution per-task diffs (those flow through the terminal verify gate).
- `gsd-ponytail` — quick-fix entry → short-circuit to fast-path below, skip the body.
- `gsd-domain-modeling` — durable term/decision crystallizes → capture to `CONTEXT.md`/ADR.
- `gsd-codebase-design` — a module-interface / deepening decision is in play.
- `gsd-handoff` — pause/breakpoint (user-triggered or context-pressure).

## Quick-fix fast-path
Trivial/medium fix (no design, ≤1 module) → set gsd-ponytail, fix directly, write a minimal `plan.toon` (1-2 tasks) to `.scratch/<feature>/`, commit to `wip/<feature>` → `/gsd-verify` (code-quality only, no `spec.md`) → main. Skips the Discussion body, not the gsd-verify gate.

## Conventions
`<feature>` = the feature slug. All artifacts live under `.scratch/<feature>/` — create with `mkdir -p .scratch/<feature>/` before first write. Artifacts: `spec.md`, `plan.toon`, `handoff-<n>.toon`. The working branch is `wip/<feature>`.
Assumes a git repo — `git init` if the project is brand-new.
Skill references — `skill`: refer to or route to a skill (trigger lists, control flow); `/skill`: invoke a skill inline within a step.
AXI/TOON — **AXI** (Agent eXperience Interface) is the registered `axi` skill (`skill://axi`): ergonomic standards for agent-facing CLI output. **TOON** (Token-Oriented Object Notation, [spec](https://toonformat.dev/reference/spec.html)) is its token-efficient format (~40% smaller than JSON): `table[count]{fields}:` then one comma-separated row per line. `plan.toon` and `handoff-<n>.toon` are TOON; GSD adds `|` as a sub-separator for multi-value fields (e.g. `AC-1|AC-2`) within a field.
Contextual disclosure — a skill that produces a **standalone terminal response** appends a `Next steps:` block; a skill that fires **inline** inside another skill's response does not (avoids duplicate next-steps).

 ## End-session Suggestions (Human Actions)
 At the end of every response/discussion, instead of listing technical skill commands, present concrete, non-technical choices for the user to select. E.g.:
 ```
 Next steps (reply with number or text):
 1. Generate the implementation plan (routes to /gsd-to-plan)
 2. Start executing tasks (routes to /gsd-executing-plans)
 3. Audit codebase architecture (routes to /gsd-improve-codebase-architecture)
 4. Pause & Save progress (routes to /gsd-handoff)
 ```

 When the user replies with a choice, `/gsd` intercepts the input and triggers the corresponding sub-skill.
