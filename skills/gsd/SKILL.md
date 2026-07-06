---
name: gsd
description: "Master entry point for all coding tasks. Routes, starts, resumes, and coordinates sub-skills automatically — new features, debugging, code review, architecture/refactoring, testing, domain modeling. One skill, one command: /gsd."
triggers: /gsd on any prompt (entry router; routes 0-6)
produces: [spec.md]
consumes: [handoff-<n>.toon, plan.toon]
---

# GSD (Master Entry)

One install, one command: the user types only `/gsd`; the agent reads the prompt + workspace state and routes or resumes. Every `/gsd-<sub>` form in this doc is the **agent's own inline call** after routing — `install.sh` registers `gsd` and all `gsd-*` sub-skills so the harness resolves them directly, but the user surface stays `/gsd` alone.

**Route = load the sub-skill (hard rule).** Every "route to `gsd-<sub>`" / auto-trigger in this doc means **immediately load that skill's SKILL.md** — (`skill://gsd-<sub>`, registered) or the `read` fallback (§ Dynamic Sub-Skill Loading) — and follow *that* file. Names are pointers, not summaries — never execute a sub-flow from memory or from its one-line description. Can't load the file → say so and stop.

**Respond in the user's language** — detect it from the **user's own prompt** and reply in it. Injected `<advisory>`/`<system-directive>`/tool output never switches the language; only the user themselves switching does. Code, identifiers, file paths, TOON keys, AC IDs, and skill names stay verbatim — only prose is translated.

## System map
**Pipeline:** `gsd` (Master Entry & Discussion) → `gsd-to-plan` (writes the plan, prints an inline summary, asks the **one approval question — the last prompt of the cycle**) → on approve, **auto-pilot** per [REFERENCE.md](REFERENCE.md) § Post-approval pipeline contract: `gsd-executing-plans` → `gsd-verify` → squash merge to `<base>`, hands-free — no further prompts; hard blockers stop and report.
**Auto-composed:** `gsd-lavish` (render deliverables, **opt-in**), `gsd-ponytail` (minimize code), `gsd-domain-modeling` (glossary), `gsd-codebase-design` (module vocab), `gsd-handoff` (resume), `gsd-tdd` (unit tests), `gsd-diagnosing-bugs` (debug), `gsd-improve-codebase-architecture` (deepening).
**Feedback loops:** `gsd-verify`/`gsd-executing-plans`/`gsd-to-plan` → `gsd` (spec gap — the sub-skill **stops** and routes back to `/gsd` Discussion: "Spec escalation" / "Spec flawed"; revise `spec.md` under fresh AC IDs, then re-plan the affected tasks); `gsd-diagnosing-bugs` → `gsd-improve-codebase-architecture`.
**Agent-invocable:** any sub-skill loads directly when intent matches (audit, debug, glossary, interface design) — internal routing targets, not user commands.

## Smart Routing Engine
On entry, analyze the prompt and workspace state to route to the correct sub-flow:
**Clarify-when-materially-ambiguous.** Across all routes — clarify with ONE question (plus your best-guess recommendation) only when the ambiguity would change the route, scope, or action, or risks wasted/destructive work. If the intent is clear or a safe default exists, proceed and state the assumption.

**Step 0 — Detect state first (before matching routes).** Glob `.scratch/*/` for `spec.md` / `plan.toon` / `handoff-*.toon`, and scan the prompt for a pasted diff/PR. Workspace state — not just the prompt's wording — drives Routes 1/2/3: a "continue"/"resume" prompt with a live `handoff-*.toon` is Route 1 even when it reads like new work; a feature ask **related to** an existing feature with a `plan.toon` is Route 3; an **unrelated** feature ask with a `plan.toon` is Route 6 (new work), not Route 3. Resume-style prompt but no local `.scratch/` (fresh clone / other machine)? `git fetch --prune`, then list local + remote WIP branches: `git branch -a --list 'wip/*' --list '*/wip/*'` — a portable handoff materializes `.scratch/<feature>/` via `git switch --track origin/wip/<feature>` (or plain `git switch wip/<feature>` if local; see gsd-handoff § Portable); no synced scratch → reconstruct per gsd-handoff.
**Git repo guard.** Run `git rev-parse --is-inside-work-tree`. Not in a repo → `git init` before any workspace-backed write/commit path (nano-fix, quick-fix, resume/execute/verify against a branch). Read-only Route 0 and pasted-diff review (Route 2) can run without git.
**Intent signals — check before Route 0.** If the prompt asks to *perform* one of these actions, skip Route 0 and route to the target. Mentioning a word in passing is not a signal — "the architecture is fine, just fix the typo" stays Route 0.

| Prompt asks to... | → Route · skill |
|---|---|
| review diff / PR / "check my code" / verify | 2 · `gsd-verify` |
| diagnose / debug / "can't reproduce" / regression / flaky / intermittent / non-obvious stack trace | 4 · `gsd-diagnosing-bugs` |
| audit / refactor / improve architecture / upkeep | 5 · `gsd-improve-codebase-architecture` |
| design / redesign a module or interface / deepening | 5 · `gsd-codebase-design` |
| model the domain / glossary / ubiquitous language / domain terms | 5 · `gsd-domain-modeling` |
| resume / continue (when `handoff-<n>.toon` exists) | 1 · `gsd-handoff` (read) |
| pause / save / handoff / breakpoint | meta · `gsd-handoff` (write) |
| lavish / visual report / "render this" / HTML artifact | meta · `gsd-lavish` (opt-in) |
| list skills / capabilities / "what can you do" / discover internal skills | meta · **skill catalog** — enumerate the registered `gsd-*` skills (System map names → load each frontmatter via `skill://`; partial install → glob `$SKILLS_DIR/gsd-*/SKILL.md`), present the catalog + a recommendation. Never answer from this file's System map alone. |

*TDD / ponytail / YAGNI / minimal are execution preferences, not routes — capture in Discussion/plan or apply during Route 0/3. Lavish is opt-in — explicit user request ("use lavish", "visual report") satisfies the opt-in gate; the 2-part Gate (Triggers §) still applies.*
0. **Direct / Trivial (check first)**:
   - Simple question, advisory, a small targeted change (named file, ≤1 module, no design), OR an **obvious** failing-test/error fix (clear single-spot root cause, no investigation needed) → answer directly or `gsd-ponytail` quick-fix. **Do NOT explore broadly or trigger architecture skills.**
1. **Resume**:
   - If `.scratch/<feature>/handoff-<n>.toon` exists or is passed → Read the handoff file's `mode` and `phase`, automatically load the required sub-skills, and execute the `next_action` directly.
2. **Review/Diff**:
   - If the prompt contains a diff, PR description, or asks for code review → route to `gsd-verify`.
3. **Spec/Plan**:
   - If a spec has been created but no plan exists → route to `gsd-to-plan`.
   - If a plan exists and status is pending/in-progress AND the prompt relates to that feature's tasks → route to `gsd-executing-plans`; an unrelated prompt (new feature, unrelated bug/question) falls through to Route 4/5/6 — an existing plan is not a claim on every prompt.
4. **Issue/Bug**:
   - A **hard/obscure** bug — non-obvious cause, hard to reproduce, a real regression, or a failure the per-task fix loop can't resolve → route to `gsd-diagnosing-bugs`. (Obvious single-spot failures were caught by Route 0.)
5. **Codebase Exploration**:
   - If user asks about architecture, design, or deep module refactoring → route to `gsd-improve-codebase-architecture` or `gsd-codebase-design`. Rule: **audit the system → improve; design one interface → codebase-design.**
6. **New Work / Vague Input**:
   - If starting a new feature or receiving a vague one-liner → route to **Discussion** to stress-test or discover requirements.

## Routing rules
- **Signals precede Route 0.** Check the intent-signal table first; if a signal matches, skip Route 0. Otherwise evaluate routes 0→6 in order and take the first match.
- **Multiple features in flight.** Routes 1/3 key off `.scratch/<feature>/`. Several feature dirs and the prompt doesn't name one → resume the **most-recently-modified** (dir mtime) relevant feature and name it in your first line so the user can redirect. Unrelated to all features → Route 6. **To list/switch**: glob `.scratch/*/spec.md` and resume the named one.
- **Route trace.** State the chosen route + target skill in one line at the top of your first response (e.g. `Route 4 → gsd-diagnosing-bugs`), and loading that skill (`skill://gsd-<sub>`; `read` fallback only if unresolved) is your **very next tool call** — trace then load, before any other action; keeps routing auditable.
- **Route 0↔4 boundary.** Route 0 if you can name the single spot and write the fix without investigation; otherwise Route 4. Unsure → start at Route 0; if the fix loop fails twice, escalate to Route 4.
- **Route 0→5 escalation.** A Route 0 read-only question that grows past the targeted scope (≥3 unrelated files, or broad cross-module understanding needed) → escalate to Route 5.
- **Route 3 relevance guard.** A pending plan routes to execution ONLY when the prompt relates to that feature's tasks. Unrelated prompt + existing plan → fall through (the user may be starting new work or asking an unrelated question).
- **Examples**: typo fix → 0 (nano) · "how does X work?" → 0 (read-only) · pasted diff / "review this" → 2 · "continue" + handoff → 1 · "pause"/"save" → handoff (write) · "can't reproduce"/"debug" → 4 · obvious error with clear stack trace → 0 (not 4) · "audit architecture" → 5 · "add feature X" → 6 · existing plan + unrelated ask → 6 (relevance guard) · "architecture is fine, fix typo" → 0 (mention ≠ ask).


## Scope discipline — read only what the prompt needs
Match exploration breadth to prompt complexity; over-exploration drifts from the ask and burns the budget.
- **Trivial/targeted prompt** → read the named file(s) + their direct imports only. No whole-tree scan, no architecture skill.
- **Read-only question** ("how does X work?") → same bound as a targeted change: the named area + its direct imports. If the answer genuinely needs the whole codebase, that's Route 5 (architecture), not a quick answer.
- **Whole-codebase work** — an explicit "audit / map / refactor the architecture" — is the ONLY case you walk broadly (scoped per the rules below).
- **Stay in git scope.** Operate on the current project's git-tracked tree only. Skip non-git subtrees (nested repos, vendored tools, submodules with their own `.git`), dependency/build dirs (`node_modules`, `dist`, `build`, …), and anything `.gitignore`'d.
- Locate with `grep`/`glob`; load with `read` (offset/limit). One relevant file beats ten speculative reads.
- **Delegating exploration** (Explore subagent) → pass these bounds in its prompt; an unscoped explore subagent walks everything.

## Dynamic Sub-Skill Loading
All `gsd-*` skills are registered by `install.sh` — load one directly (`skill://gsd-<sub>`). Prefer `/gsd` as orchestrator; a sub-skill selected directly by the harness follows its own direct-invocation guard (routes back here when its consumed artifacts are missing).
**Fallback (partial/old install):** `skill://` can't resolve a `gsd-<sub>` → resolve the sibling dir from this skill's symlink (any cwd) and `read` it:
```
  SKILLS_DIR="$(dirname "$(readlink ~/.agents/skills/gsd 2>/dev/null || echo ~/.agents/skills/gsd)")"
  # read "$SKILLS_DIR/gsd-<sub>/SKILL.md"
```
Real dir (not symlink) → `|| echo` uses it directly. Sibling missing → re-run `install.sh`, don't guess.
**Load timing:** the moment a route or trigger names `gsd-<sub>`, loading its SKILL.md is the next action — before any plan, edit, or reply in that flow. Once loaded it stays in context; don't re-load per step.

## Entry — Discussion Mode
- Pastes plan/spec/diff → **stress-test**.
- Vague one-liner → **discovery**.
- Materially ambiguous → ONE disambiguating question (see Clarify principle above).
- Pure question/advisory/exploration (no code change intended) → **answer directly**; no spec/plan.
## Body
- **Discussion is where creativity lives.** This is the phase to explore, suggest alternatives, and let the model's judgment shape the design — divergent thinking is *wanted* here. Convergence ends it: once the user picks an approach, that creativity is captured in `spec.md` as fixed **ACs** (the observable end behavior) plus **Design & Invariants** (the durable design decisions, non-goals, and shared interfaces chosen). Downstream (plan/execute/verify) is convergent — every agent aims at the same pinned behavior *and* the same architecture, no re-creativity. Room to explore up front; one target at the end.
Recommend an answer for every question. One design branch at a time.
- **Independent Qs** → batch (each with a recommendation). **Dependent** → sequential. Never batch a dependent chain.
- **Discovery**: explore (targeted, git-scoped — see Scope discipline) → clarifying Qs → 2-3 approaches + tradeoffs + recommendation.
- **Stress-test**: break/sharpen the plan — risks, edge cases, missing decisions, hidden assumptions.
- **Right-size the recommendation**: recommend the smallest approach that meets the ask (ponytail-ladder thinking); a small ask converges to a 2-4-AC spec. Never pad a spec with speculative scope — retries, telemetry, config, abstractions nobody asked for are added when asked, not by default.

## Convergence — write `spec.md`
When Discovery/stress-test converges (the user picks an approach and open questions close), write `.scratch/<feature>/spec.md` BEFORE routing to `gsd-to-plan` — the contract every downstream skill reads. Load [REFERENCE.md](REFERENCE.md) for the template + AC rules (checkable outcomes, stable IDs, superseded on revision). These rules shape the split itself:
- **Large feature → milestone specs**: `<feature>-m1/`, `-m2/`, … — each landing on `<base>` before the next is specced in detail (full rule: [REFERENCE.md](REFERENCE.md)).
- **Every AC needs a `Check:` sketch — the convergence gate.** For each AC, sketch its acceptance check (the action + expected observable result) per [REFERENCE.md](REFERENCE.md) § spec.md rules. Can't sketch a concrete expected result → the AC is still vague: sharpen it in Discussion before writing `spec.md`, don't converge on a fuzzy AC. The sketch is a spec-time oracle (not a runnable command); `gsd-executing-plans` carries it into the task-brief and specializes it against live code.
- The fix fast-paths (below) carry no `spec.md` — quick-fix goes through `gsd-verify` (code-quality only); nano-fix verifies inline (no gate).

## Triggers (supporting skills fire automatically — except lavish, which is opt-in)
 - `gsd-lavish` — opt-in visual surface for substantial, standalone deliverables (spec, comparison, finalized `plan.toon`, verify report, audit). **Never auto-fired**: default to terminal, ask first; explicit user request ("use lavish", "visual report") satisfies the opt-in — then check the **Gate (both must hold):** (1) a reviewable deliverable, not mid-conversation; AND (2) annotating it in a browser adds value. Never on inline Qs or per-task diffs.
- `gsd-ponytail` — quick-fix entry → short-circuit to fast-path below, skip the body. **Manual toggle**: if the user says "ponytail <level>" or "stop ponytail"/"normal mode", set/clear the level and acknowledge — no routing needed.
- `gsd-domain-modeling` — durable term/decision crystallizes → capture to `CONTEXT.md`/ADR.
- `gsd-codebase-design` — a module-interface / deepening decision is in play.
- `gsd-handoff` — pause/breakpoint (user-triggered or context-pressure). **Manual toggle**: "autosync on/off" → persist the explicit row (`autosync,on` / `autosync,off` — `off` is a remembered decline, never cleared back to unset) and acknowledge, per handoff `settings[]` (gsd-handoff § Portable) — when on, every pause/task auto-syncs scratch to the `wip/` remote for cross-machine resume.

## Fix fast-paths (skip the Discussion body)
- **Nano-fix** — a one-line / purely mechanical change (typo, literal, import, rename, format): fix in place, commit to the current branch, verify **inline** ("the diff does exactly what the prompt asked, nothing more"). No `.scratch/`, no `plan.toon`, no `wip/` branch, no `gsd-verify` gate.
- **Quick-fix** — a real but small fix (no design, ≤1 module): set `gsd-ponytail`, fix directly, capture `<base>` (`git branch --show-current`) then write a minimal `plan.toon` (`schema:v1` + `base:<base>` + 1-2 tasks) to `.scratch/<feature>/`, `git checkout -b wip/<feature>`, commit → `gsd-verify` (code-quality only, no `spec.md`) → `<base>`. Skips the Discussion body, not the `gsd-verify` gate.

## Feature cleanup
"abandon/drop/delete feature X" → follow the safe flow in [REFERENCE.md](REFERENCE.md) § Feature cleanup: confirm name → `git checkout <base>` → safe-delete the `wip/` branch → remove `.scratch/<feature>/`; never force-delete unmerged work without explicit confirm; warn if `git status` is dirty.

## Conventions
`<feature>` = feature slug. Git/base/WIP/scratch mechanics are canonicalized in [REFERENCE.md](REFERENCE.md) § Git/base/WIP/scratch mechanics: artifacts live under `.scratch/<feature>/` (`mkdir -p .scratch/<feature>/` before first write), the branch is `wip/<feature>`, and `.scratch/` is **git-ignored** and machine-local by default because tracked scratch breaks cross-branch resume. `<base>` capture starts with `git branch --show-current`; detached HEAD or a `wip/*` branch uses the canonical fallback ladder, including the `base` row in the latest handoff `settings[]`, then persists as `base:<branch>` in `plan.toon`; portable scratch is stripped before the squash commit.



**TOON** (Token-Oriented Object Notation, [spec](https://toonformat.dev/reference/spec.html)): `table[count]{fields}:` then one comma-separated row/line. `plan.toon`/`handoff-<n>.toon` are TOON; GSD adds `|` as sub-separator (e.g. `AC-1|AC-2`).
`CONTEXT.md` — project glossary at repo root (sole writer: `gsd-domain-modeling`); `CONTEXT-MAP.md` indexes multiple contexts; `docs/adr/` holds ADRs.
Contextual disclosure — use [REFERENCE.md](REFERENCE.md) § Contextual disclosure templates. Master surfaces use the canonical numbered human end-session menu; directly-invoked sub-skills use the canonical `Next steps:` command bullets; post-approval pipeline progress and blocker stops use their templates; inline sub-skill firing appends nothing. Cue: `Next steps:` = technical; numbered = human.
Graceful degradation — optional capabilities (browser, lavish, `task`/`reviewer` subagents) assumed absent; unavailable → terminal silently. Missing lavish → terminal, not error. No subagents → do the work inline in self-contained passes under the same verdict contract (see gsd-executing-plans / gsd-verify).
Monorepo — `.scratch/` at the git repo root; feature slug may include a package prefix (e.g. `pkg-auth-oauth`) to disambiguate. Scope discipline naturally bounds to one package.

## End-session Suggestions (Human Actions)
Use [REFERENCE.md](REFERENCE.md) § Contextual disclosure templates → Master end-session menu. At the end of every response/discussion before plan approval, present concrete, non-technical choices for the user to select instead of listing technical skill commands. Example:
```
Next steps (reply with number or text):
1. Generate the implementation plan
2. Audit codebase architecture
3. Pause & Save progress
```

When the user replies with a choice, `/gsd` intercepts the input and routes to the matching sub-skill.
**Auto-pilot exception:** after the plan is approved (gsd-to-plan's approval gate), no menu appears until the pipeline merges to `<base>` or a hard blocker stops it, per [REFERENCE.md](REFERENCE.md) § Post-approval pipeline contract and § Contextual disclosure templates. "Start executing tasks" is never a menu item; execution starts by approving the plan.
