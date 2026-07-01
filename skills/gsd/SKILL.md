---
name: gsd
description: Master entry point for all agent actions. Automatically routes, starts, resumes, and coordinates all sub-skills (discussion, planning, executing, verify, handoff, diagnostics) based on user prompt.
triggers: /gsd on any prompt (entry router; routes 0-6)
produces: [spec.md]
consumes: [handoff-<n>.toon, plan.toon]
---

# GSD (Master Entry)

The single entry point for all workflows. The user invokes `/gsd` on any prompt, and the agent determines the appropriate sub-flow to execute or resume.

**Respond in the user's language.** `gsd` is the entry prompt — detect the language of the **user's own prompt** and reply in it (questions, recommendations, spec/plan prose, end-session choices). The anchor is the user's established language: ignore the language of injected `<advisory>`/`<system-directive>`/tool output — they never switch your response language. Switch only when the **user themselves** writes in a different language. Keep code, identifiers, file paths, TOON keys, AC IDs, and skill names verbatim — only prose is translated.

## System map
**Pipeline:** `gsd` (Master Entry & Discussion) → `gsd-to-plan` → `gsd-executing-plans` → `gsd-verify` → `<base>`.
**Auto-composed:** `gsd-lavish` (render deliverables, **opt-in**), `gsd-ponytail` (minimize code), `gsd-domain-modeling` (glossary), `gsd-codebase-design` (module vocab), `gsd-handoff` (resume), `gsd-tdd` (unit tests), `gsd-diagnosing-bugs` (debug), `gsd-improve-codebase-architecture` (deepening).
**Feedback loops:** `gsd-verify`/`gsd-executing-plans`/`gsd-to-plan` → `gsd` (spec gap — the sub-skill **stops** and routes back to `/gsd` Discussion: "Spec escalation" / "Spec flawed"; revise `spec.md` under fresh AC IDs, then re-plan the affected tasks); `gsd-diagnosing-bugs` → `gsd-improve-codebase-architecture`.
**Agent-invocable:** any sub-skill loads directly when intent matches — architecture audit (`gsd-improve-codebase-architecture`), debug (`gsd-diagnosing-bugs`), glossary (`gsd-domain-modeling`), interface design (`gsd-codebase-design`). These are internal routing targets, not user commands.

**Invocation model.** The end user installs and types only `/gsd` (plus natural-language intent); `/gsd` reads the prompt + state and routes. The `/gsd-<sub>` forms above are the **agent's own inline calls** after routing — not commands the user registers or memorizes. `install.sh` registers only `gsd`.

## Smart Routing Engine
On entry, analyze the prompt and workspace state to route to the correct sub-flow:

**Step 0 — Detect state first (before matching routes).** Glob `.scratch/*/` for `spec.md` / `plan.toon` / `handoff-*.toon`, and scan the prompt for a pasted diff/PR. Workspace state — not just the prompt's wording — drives Routes 1/2/3: a "continue"/"resume" prompt with a live `handoff-*.toon` is Route 1 even when it reads like new work; a feature ask **related to** an existing feature with a `plan.toon` is Route 3; an **unrelated** feature ask with a `plan.toon` is Route 6 (new work), not Route 3.
**Git repo guard.** Run `git rev-parse --is-inside-work-tree`. Not in a repo → `git init` before any workspace-backed write/commit path (nano-fix, quick-fix, resume/execute/verify against a branch). Read-only Route 0 and pasted-diff review (Route 2) can run without git.
0. **Direct / Trivial (check first)**:
   - Simple question, advisory, a small targeted change (named file, ≤1 module, no design), OR an **obvious** failing-test/error fix (clear single-spot root cause, no investigation needed) → answer directly or `gsd-ponytail` quick-fix. **Do NOT explore broadly or trigger architecture skills.**
1. **Resume**:
   - If `.scratch/<feature>/handoff-<n>.toon` exists or is passed → Read the handoff file's `mode` and `phase`, automatically load the required sub-skills, and execute the `next_action` directly.
2. **Review/Diff**:
   - If the prompt contains a diff, PR description, or asks for code review → route to `gsd-verify`.
3. **Spec/Plan**:
   - If a spec has been created but no plan exists → route to `gsd-to-plan`.
   - If a plan exists and status is pending/in-progress AND the prompt relates to that feature's tasks → route to `gsd-executing-plans`. A prompt about a different concern (new feature, unrelated bug/question) falls through to Route 4/5/6 — an existing plan is not a claim on every prompt.
4. **Issue/Bug**:
   - A **hard/obscure** bug — non-obvious cause, hard to reproduce, a real regression, or a failure the per-task fix loop can't resolve → route to `gsd-diagnosing-bugs`. (Obvious single-spot failures were caught by Route 0.)
5. **Codebase Exploration**:
   - If user asks about architecture, design, or deep module refactoring → route to `gsd-improve-codebase-architecture` (surface friction / audit candidates) or `gsd-codebase-design` (design or redesign one module's interface). Rule: **audit the system → improve; design one interface → codebase-design.**
6. **New Work / Vague Input**:
   - If starting a new feature or receiving a vague one-liner → route to **Discussion** to stress-test or discover requirements.

## Routing rules
- **First match wins.** Evaluate routes 0→6 in order and take the first match; Route 0 is the trivial guard — never let a simple prompt fall through to exploration.
- **Multiple features in flight.** Routes 1/3 key off `.scratch/<feature>/`. If more than one feature dir exists and the prompt doesn't name one: among **relevant** live features (resume-style or feature-related prompts), resume the **most-recently-modified** (dir mtime) and name it in your first line so the user can redirect — never silently pick an arbitrary feature. If the prompt is unrelated to all existing features (new work), fall through to Route 6. **To list/switch**: glob `.scratch/*/spec.md` (or `ls .scratch/`) and resume the named one.
- **Route trace.** State the chosen route + target skill in one line at the top of your first response (e.g. `Route 4 → gsd-diagnosing-bugs`). Makes routing auditable — the user catches an over-eager route instantly and redirects.
- **Route 0↔4 boundary.** Route 0 if you can name the single spot and write the fix without investigation; otherwise Route 4. Unsure → start at Route 0; if the fix loop fails twice, escalate to Route 4 (don't keep retrying the same one-spot guess).
- **Route 0→5 escalation.** A Route 0 read-only question that grows past the targeted scope (≥3 unrelated files, or broad cross-module understanding needed) → escalate to Route 5. Don't keep reading speculatively under Route 0.
- **Route 3 relevance guard.** A pending plan routes to execution ONLY when the prompt relates to that feature's tasks. Unrelated prompt + existing plan → fall through (the user may be starting new work or asking an unrelated question).

## Routing examples
Typo/named-spot fix → 0 (nano). "can't repro" bug → 4. "add feature X" → 6. "resume" + handoff → 1. Pasted diff → 2. "how does X work?" → 0 (read-only). "audit architecture" → 5. Existing plan + unrelated ask → 6 (relevance guard).

## Scope discipline — read only what the prompt needs
Match exploration breadth to prompt complexity; over-exploration drifts from the ask and burns the budget.
- **Trivial/targeted prompt** → read the named file(s) + their direct imports only. No whole-tree scan, no architecture skill.
- **Read-only question** ("how does X work?", "where is Y?") → same bound as a targeted change: the named area + its direct imports. A question is not a license to walk the tree — if the answer genuinely needs the whole codebase, that's Route 5 (architecture), not a quick answer.
- **Whole-codebase work** — an explicit "audit / map / refactor the architecture" — is the ONLY case you walk broadly (scoped per the rules below).
- **Stay in git scope.** Operate on the current project's git-tracked tree only. Skip non-git subtrees (nested repos, vendored tools, submodules carrying their own `.git`) and dependency/build/output dirs (`node_modules`, `dist`, `build`, `.next`, `target`, …) and anything `.gitignore`'d. These are noise — never the subject of a simple prompt.
- Locate with `grep`/`glob`; load with `read` (offset/limit). Never open a directory hoping. One relevant file beats ten speculative reads.
- **Delegating exploration** (Explore subagent) → pass these bounds in its prompt; an unscoped explore subagent walks everything.

## Dynamic Sub-Skill Loading
Only `/gsd` is registered; sub-skills are siblings loaded on demand. Resolve from this skill's symlink (any cwd):
```
  SKILLS_DIR="$(dirname "$(readlink ~/.agents/skills/gsd 2>/dev/null || echo ~/.agents/skills/gsd)")"
  # read "$SKILLS_DIR/gsd-<sub>/SKILL.md"
```
Fallback: real dir (not symlink) → `|| echo` uses it directly. Sibling missing → re-run `install.sh`, don't guess.
If the harness's `skill://` scheme cannot resolve unregistered skills, use the `read` tool with the resolved path above.

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
 - `gsd-lavish` — opt-in visual surface for substantial, standalone deliverables (spec, approach comparison, finalized `plan.toon`, verify report, architecture audit). **Never auto-fired**: default to terminal, ask first. **Gate (both must hold):** (1) a reviewable deliverable, not mid-conversation; AND (2) the user gains from annotating it in a browser. Never on inline Qs or per-task diffs.
- `gsd-ponytail` — quick-fix entry → short-circuit to fast-path below, skip the body.
- `gsd-domain-modeling` — durable term/decision crystallizes → capture to `CONTEXT.md`/ADR.
- `gsd-codebase-design` — a module-interface / deepening decision is in play.
- `gsd-handoff` — pause/breakpoint (user-triggered or context-pressure).

## Fix fast-paths (skip the Discussion body)
- **Nano-fix** — a one-line / purely mechanical change (typo, literal, import, rename, format): fix in place, commit to the current branch, verify **inline** ("the diff does exactly what the prompt asked, nothing more"). No `.scratch/`, no `plan.toon`, no `wip/` branch, no `gsd-verify` gate. The shortest path — don't dress up a one-liner.
- **Quick-fix** — a real but small fix (no design, ≤1 module): set `gsd-ponytail`, fix directly, write a minimal `plan.toon` (1-2 tasks) to `.scratch/<feature>/`, commit to `wip/<feature>` → `gsd-verify` (code-quality only, no `spec.md`) → `<base>`. Skips the Discussion body, not the `gsd-verify` gate.

## Feature cleanup
"abandon/drop/delete feature X" → confirm name → read `<base>` from plan.toon → `git checkout <base>` (can't delete a branch you're on) → `git branch -d wip/<feature>` (safe delete; only `-D` after explicit force-confirm if unmerged) → `rm -rf .scratch/<feature>/`. If `git status --short` is dirty, warn before proceeding.

## Conventions
`<feature>` = feature slug. Artifacts under `.scratch/<feature>/` (`mkdir -p .scratch/<feature>/` before first write): `spec.md`, `plan.toon`, `handoff-<n>.toon`. Branch: `wip/<feature>`. Git repo assumed (`git init` if new). Skill refs: `skill` = refer/route; `/skill` = invoke inline.
`<base>` = the repo's default branch. **Capture** before `git checkout -b wip/<feature>`: `BASE=$(git branch --show-current)` — if empty (detached HEAD), fall back to: `git symbolic-ref --short refs/remotes/origin/HEAD` (strip `origin/`) → `git config init.defaultBranch` → `main` (check non-empty at each tier). Persist as `base:<branch>` in `plan.toon` immediately after `schema:v1`, before the `plan[` table. On resume/verify, read `base:` from `plan.toon`. Nano-fix has no branch/merge → no `<base>` needed.
**TOON** (Token-Oriented Object Notation, [spec](https://toonformat.dev/reference/spec.html)) — ~40% smaller than JSON: `table[count]{fields}:` then one comma-separated row/line. `plan.toon`/`handoff-<n>.toon` are TOON; GSD adds `|` as sub-separator (e.g. `AC-1|AC-2`).
`CONTEXT.md` — project glossary at repo root (sole writer: `gsd-domain-modeling`); `CONTEXT-MAP.md` indexes multiple contexts; `docs/adr/` holds ADRs.
Contextual disclosure (canonical — sub-skills reference this, don't repeat) — two surfaces, never both: (a) **master** → numbered human end-session choices; (b) **directly-invoked sub-skill** → `Next steps:` + commands. Inline firing (a sub-skill triggered inside another skill's flow) appends nothing. Cue: `Next steps:` = technical; numbered = human.
Graceful degradation — optional capabilities (browser, lavish) assumed absent; unavailable → terminal silently. Missing lavish → terminal, not error.
Monorepo — `.scratch/` at the git repo root; feature slug may include a package prefix (e.g. `pkg-auth-oauth`) to disambiguate. Scope discipline naturally bounds to one package.

 ## End-session Suggestions (Human Actions)
 At the end of every response/discussion, instead of listing technical skill commands, present concrete, non-technical choices for the user to select. E.g.:
 ```
 Next steps (reply with number or text):
 1. Generate the implementation plan
 2. Start executing tasks
 3. Audit codebase architecture
 4. Pause & Save progress
 ```

 When the user replies with a choice, `/gsd` intercepts the input and routes to the matching sub-skill.
