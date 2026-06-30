---
name: gsd
description: Master entry point for all agent actions. Automatically routes, starts, resumes, and coordinates all sub-skills (discussion, planning, executing, verify, handoff, diagnostics) based on user prompt.
triggers: /gsd on any prompt (entry router; routes 0-6)
produces: [spec.md, plan.toon]
consumes: [handoff-<n>.toon, plan.toon]
---

# GSD (Master Entry)

The single entry point for all workflows. The user invokes `/gsd` on any prompt, and the agent determines the appropriate sub-flow to execute or resume.

## System map
**Pipeline:** `gsd` (Master Entry & Discussion) → `gsd-to-plan` → `gsd-executing-plans` → `gsd-verify` → main.
**Auto-composed:** `gsd-lavish` (render deliverables, **opt-in**), `gsd-ponytail` (minimize code), `gsd-domain-modeling` (glossary), `gsd-codebase-design` (module vocab), `gsd-handoff` (resume), `gsd-tdd` (unit tests), `gsd-diagnosing-bugs` (debug), `gsd-improve-codebase-architecture` (deepening).
**Feedback loops:** `gsd-verify`/`gsd-executing-plans`/`gsd-to-plan` → `gsd` (spec gap — the sub-skill **stops** and routes back to `/gsd` Discussion: "Spec escalation" / "Spec flawed"; revise `spec.md` under fresh AC IDs, then re-plan the affected tasks); `gsd-diagnosing-bugs` → `gsd-improve-codebase-architecture`.
**Manual/proactive:** any skill is also directly invokable — `/gsd-improve-codebase-architecture` (audit deepening), `/gsd-diagnosing-bugs` (stuck), `/gsd-domain-modeling` (sharpen glossary), `/gsd-codebase-design` (interface design).

## Smart Routing Engine
On entry, analyze the prompt and workspace state to route to the correct sub-flow:
0. **Direct / Trivial (check first)**:
   - Simple question, advisory, a small targeted change (named file, ≤1 module, no design), OR an **obvious** failing-test/error fix (clear single-spot root cause, no investigation needed) → answer directly or `gsd-ponytail` quick-fix. **Do NOT explore broadly or trigger architecture skills.**
1. **Resume**:
   - If `.scratch/<feature>/handoff-<n>.toon` exists or is passed → Read the handoff file's `mode` and `phase`, automatically load the required sub-skills, and execute the `next_action` directly.
2. **Review/Diff**:
   - If the prompt contains a diff, PR description, or asks for code review → route to `gsd-verify`.
3. **Spec/Plan**:
   - If a spec has been created but no plan exists → route to `gsd-to-plan`.
   - If a plan exists and status is pending/in-progress → route to `gsd-executing-plans`.
4. **Issue/Bug**:
   - A **hard/obscure** bug — non-obvious cause, hard to reproduce, a real regression, or a failure the per-task fix loop can't resolve → route to `gsd-diagnosing-bugs`. (Obvious single-spot failures were caught by Route 0.)
5. **Codebase Exploration**:
   - If user asks about architecture, design, or deep module refactoring → route to `gsd-improve-codebase-architecture` (surface friction / audit candidates) or `gsd-codebase-design` (design or redesign one module's interface). Rule: **audit the system → improve; design one interface → codebase-design.**
6. **New Work / Vague Input**:
   - If starting a new feature or receiving a vague one-liner → route to **Discussion** to stress-test or discover requirements.

## Routing rules
- **First match wins.** Evaluate routes 0→6 in order and take the first match; Route 0 is the trivial guard — never let a simple prompt fall through to exploration.
- **Multiple features in flight.** Routes 1/3 key off `.scratch/<feature>/`. If more than one feature dir exists and the prompt doesn't name one, resume the **most-recently-modified** (dir mtime) and name it in your first line so the user can redirect with one word — never silently pick an arbitrary feature. **To list/switch**: glob `.scratch/*/spec.md` (or `ls .scratch/`) and resume the named one.
- **Route trace.** State the chosen route + target skill in one line at the top of your first response (e.g. `Route 4 → gsd-diagnosing-bugs`). Makes routing auditable — the user catches an over-eager route instantly and redirects.
- **Route 0↔4 boundary.** Route 0 if you can name the single spot and write the fix without investigation; otherwise Route 4. Unsure → start at Route 0; if the fix loop fails twice, escalate to Route 4 (don't keep retrying the same one-spot guess).

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
  LINK=~/.agents/skills/gsd
  SKILLS_DIR="$(dirname "$(readlink "$LINK" 2>/dev/null || echo "$LINK")")"
  # then: read "$SKILLS_DIR/gsd-<sub-skill>/SKILL.md"
```
`readlink` follows this skill's own symlink to its real location, so it works from any working directory. Fallback: if `~/.agents/skills/gsd` is a real directory (not a symlink — e.g. copied, not `install.sh`'d), `|| echo "$LINK"` uses it directly. If a sibling `gsd-<sub-skill>/SKILL.md` then can't be read, the install is incomplete — re-run `install.sh` (it symlinks the repo, bringing the siblings) rather than guessing.

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
- The fix fast-paths (below) carry no `spec.md` — quick-fix goes through `gsd-verify` (code-quality only); nano-fix verifies inline (no gate).

## Triggers (supporting skills fire automatically — except lavish, which is opt-in)
 - `gsd-lavish` — the exclusive visual surface for substantial deliverables (approach comparison, a crystallized `spec.md`, a non-trivial finalized `plan.toon`, the `gsd-verify` report, an architecture audit). **Opt-in, never auto-fired** — even when the gate holds, the user must accept before a browser launches; default to terminal, ask first. **Gate (both must hold):** (1) the artifact is a standalone, reviewable deliverable — not mid-conversation; AND (2) the user gains from annotating it in a browser surface. Never on inline Qs or mid-execution per-task diffs (those flow through the terminal verify gate).
- `gsd-ponytail` — quick-fix entry → short-circuit to fast-path below, skip the body.
- `gsd-domain-modeling` — durable term/decision crystallizes → capture to `CONTEXT.md`/ADR.
- `gsd-codebase-design` — a module-interface / deepening decision is in play.
- `gsd-handoff` — pause/breakpoint (user-triggered or context-pressure).

## Fix fast-paths (skip the Discussion body)
- **Nano-fix** — a one-line / purely mechanical change (typo, literal, import, rename, format): fix in place, commit to the current branch, verify **inline** ("the diff does exactly what the prompt asked, nothing more"). No `.scratch/`, no `plan.toon`, no `wip/` branch, no `gsd-verify` gate. The shortest path — don't dress up a one-liner.
- **Quick-fix** — a real but small fix (no design, ≤1 module): set `gsd-ponytail`, fix directly, write a minimal `plan.toon` (1-2 tasks) to `.scratch/<feature>/`, commit to `wip/<feature>` → `/gsd-verify` (code-quality only, no `spec.md`) → main. Skips the Discussion body, not the `gsd-verify` gate.

## Conventions
`<feature>` = the feature slug. All artifacts live under `.scratch/<feature>/` — create with `mkdir -p .scratch/<feature>/` before first write. Artifacts: `spec.md`, `plan.toon`, `handoff-<n>.toon`. The working branch is `wip/<feature>`.
Assumes a git repo — `git init` if the project is brand-new.
Skill references — `skill`: refer to or route to a skill (trigger lists, control flow); `/skill`: invoke a skill inline within a step.
AXI/TOON — **AXI** (Agent eXperience Interface) is the registered `axi` skill (`skill://axi`): ergonomic standards for agent-facing CLI output. **TOON** (Token-Oriented Object Notation, [spec](https://toonformat.dev/reference/spec.html)) is its token-efficient format (~40% smaller than JSON): `table[count]{fields}:` then one comma-separated row per line. `plan.toon` and `handoff-<n>.toon` are TOON; GSD adds `|` as a sub-separator for multi-value fields (e.g. `AC-1|AC-2`) within a field.
`CONTEXT.md` — project glossary at repo root (sole writer: `gsd-domain-modeling`); `CONTEXT-MAP.md`, if present, indexes multiple contexts. `docs/adr/` holds ADRs. Other skills read these for vocabulary; none but `gsd-domain-modeling` writes `CONTEXT.md`.
Contextual disclosure — two end-of-response surfaces, never both at once: (a) the **master** appends non-technical **End-session choices** (numbered human actions, below); (b) a **directly-invoked sub-skill** appends its own **technical triggers** (`Next steps:` + skill commands). A sub-skill firing **inline** inside another skill's response appends nothing — only the outermost response shows, avoiding duplicates. Label cue: `Next steps:` = technical (sub-skill); numbered list = human (master).
Graceful degradation — optional capabilities (the browser surface, lavish) are assumed absent by default; if unavailable (unbuilt submodule, no browser tool), fall back to terminal output silently, never error. A missing lavish path degrades to terminal, not failure.

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
