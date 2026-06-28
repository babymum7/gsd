---
name: gsd-grilling
description: Interview to sharpen a plan/design (stress-test) or draw a vague idea into a spec (discovery), then route to plan/gsd-handoff. Primary entry of the skills system; auto-composes supporting skills.
---

# Grilling

Relentless interview → spec or sharper plan → route to `gsd-to-plan` or `gsd-handoff`. Primary entry; composes supporting skills automatically.

## System map
**Pipeline:** `gsd-grilling` → `gsd-to-plan` → `gsd-executing-plans` → `gsd-review` → main.
**Auto-composed:** `gsd-lavish` (render deliverables), `gsd-ponytail` (minimize code), `gsd-domain-modeling` (glossary), `gsd-codebase-design` (module vocab), `gsd-handoff` (resume), `gsd-tdd` (unit tests), `gsd-diagnosing-bugs` (debug), `gsd-improve-codebase-architecture` (deepening).
**Feedback loops:** `gsd-review`/`gsd-executing-plans`/`gsd-to-plan` → `gsd-grilling` (spec gap); `gsd-diagnosing-bugs` → `gsd-improve-codebase-architecture`.
**Manual/proactive:** any skill is also directly invokable — `/gsd-improve-codebase-architecture` (audit deepening), `/gsd-diagnosing-bugs` (stuck), `/gsd-domain-modeling` (sharpen glossary), `/gsd-codebase-design` (interface design).

## Entry — mode routing
- Pastes plan/spec/diff → **stress-test**.
- Vague one-liner → **discovery**.
- Ambiguous → ONE disambiguating question.
- **Resume**: gsd-handoff file passed → read its `Mode`, jump to Next action. Never re-infer.
- Pure question/advisory/exploration (no code change intended) → **answer directly**; no spec/plan.

## Body
Recommend an answer for every question. One design branch at a time.
- **Independent Qs** → batch (each with a recommendation). **Dependent** → sequential. Never batch a dependent chain.
- **Discovery**: explore → clarifying Qs → 2-3 approaches + tradeoffs + recommendation.
- **Stress-test**: break/sharpen the plan — risks, edge cases, missing decisions, hidden assumptions.

## Auto-triggers (supporting skills fire automatically)
- `gsd-lavish` — at a substantial deliverable (approach comparison, crystallized spec). Never on individual Qs.
- `gsd-ponytail` — quick-fix entry → short-circuit to fast-path below, skip the body.
- `gsd-domain-modeling` — durable term/decision crystallizes → capture to `CONTEXT.md`/ADR.
- `gsd-codebase-design` — a module-interface / deepening decision is in play.
- `gsd-handoff` — pause/breakpoint (user-triggered or context-pressure).

## End-menu
Converged → present, recommend by state:
- **plan** → write `.scratch/<feature>/spec.md` (acceptance criteria: an **IDed** "done when…" checklist — AC1, AC2… — so plans can reference each criterion) → then `gsd-to-plan`. (Quick-fix fast-path skips the spec — trivial.)
- **gsd-handoff** → pause (just stopping).
- **answer** → direct (non-build: question/advisory/exploration resolved without code).
- nothing.

## Quick-fix fast-path
Trivial/medium fix (no design, ≤1 module) → set gsd-ponytail, fix directly, tiny plan, commit to `wip/<feature>` → `/gsd-review` (code-quality only, no `spec.md`) → main. Skips the gsd-grilling body, not the gsd-review gate.

## Conventions
`<feature>` = the feature slug. All artifacts live under `.scratch/<feature>/` (`spec.md`, `plans/`, `ledger.md`, `handoff-*.md`); the working branch is `wip/<feature>`.
Assumes a git repo — `git init` if the project is brand-new.
Skill references — `skill`: refer to or route to a skill (trigger lists, control flow); `/skill`: invoke a skill inline within a step.
