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

## Dynamic Sub-Skill Loading
To keep the agent context lightweight at startup, only `/gsd` is loaded initially. When `/gsd` routes to a sub-skill, the agent MUST dynamically load that sub-skill's instructions from disk (e.g., reading `skills/<sub-skill-name>/SKILL.md` using the `read` tool or through `skill://<sub-skill-name>`) before executing that sub-flow.

## Entry — Discussion Mode
- Pastes plan/spec/diff → **stress-test**.
- Vague one-liner → **discovery**.
- Ambiguous → ONE disambiguating question.
- Pure question/advisory/exploration (no code change intended) → **answer directly**; no spec/plan.
## Body
Recommend an answer for every question. One design branch at a time.
- **Independent Qs** → batch (each with a recommendation). **Dependent** → sequential. Never batch a dependent chain.
- **Discovery**: explore → clarifying Qs → 2-3 approaches + tradeoffs + recommendation.
- **Stress-test**: break/sharpen the plan — risks, edge cases, missing decisions, hidden assumptions.

## Auto-triggers (supporting skills fire automatically)
 - `gsd-lavish` — at a substantial deliverable (approach comparison, crystallized spec). Never on inline Qs. This is the **exclusive** visual interface for the user to review deliverables, preventing large text dumps in chat.
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
