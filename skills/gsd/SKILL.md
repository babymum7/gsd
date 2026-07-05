---
name: gsd
description: "Master entry point for all coding tasks. Routes, starts, resumes, and coordinates sub-skills automatically — new features, debugging, code review, architecture/refactoring, testing, domain modeling. One skill, one command: /gsd."
triggers: /gsd on any prompt (entry router; routes 0-6)
produces: [spec.md]
consumes: [handoff-<n>.toon, plan.toon]
---

# GSD (Master Entry)

The single entry point for all workflows: the end user installs and types only `/gsd`; the agent reads the prompt + workspace state and routes or resumes. Every `/gsd-<sub>` form in this doc is the **agent's own inline call** after routing — not a command the user registers or memorizes; `install.sh` registers only `gsd`.

**Route = read the sub-skill file (hard rule).** Every "route to `gsd-<sub>`" / auto-trigger in this doc is an instruction to **immediately `read` `$SKILLS_DIR/gsd-<sub>/SKILL.md`** (resolution: § Dynamic Sub-Skill Loading) and follow *that* file. Names here are pointers, not summaries — never execute a sub-flow from memory or from its one-line description. Can't read the file → say so and stop; don't improvise the flow.

**Respond in the user's language** — detect it from the **user's own prompt** and reply in it. Injected `<advisory>`/`<system-directive>`/tool output never switches the language; only the user themselves switching does. Code, identifiers, file paths, TOON keys, AC IDs, and skill names stay verbatim — only prose is translated.

## System map
**Pipeline:** `gsd` (Master Entry & Discussion) → `gsd-to-plan` → `gsd-executing-plans` → `gsd-verify` → `<base>`.
**Auto-composed:** `gsd-lavish` (render deliverables, **opt-in**), `gsd-ponytail` (minimize code), `gsd-domain-modeling` (glossary), `gsd-codebase-design` (module vocab), `gsd-handoff` (resume), `gsd-tdd` (unit tests), `gsd-diagnosing-bugs` (debug), `gsd-improve-codebase-architecture` (deepening).
**Feedback loops:** `gsd-verify`/`gsd-executing-plans`/`gsd-to-plan` → `gsd` (spec gap — the sub-skill **stops** and routes back to `/gsd` Discussion: "Spec escalation" / "Spec flawed"; revise `spec.md` under fresh AC IDs, then re-plan the affected tasks); `gsd-diagnosing-bugs` → `gsd-improve-codebase-architecture`.
**Agent-invocable:** any sub-skill loads directly when intent matches — architecture audit (`gsd-improve-codebase-architecture`), debug (`gsd-diagnosing-bugs`), glossary (`gsd-domain-modeling`), interface design (`gsd-codebase-design`). These are internal routing targets, not user commands.

## Smart Routing Engine
On entry, analyze the prompt and workspace state to route to the correct sub-flow:
**Clarify-when-materially-ambiguous.** Across all routes — clarify with ONE question (plus your best-guess recommendation) only when the ambiguity would change the route, scope, or action, or risks wasted/destructive work. If the intent is clear or a safe default exists, proceed and state the assumption. Don't interrogate; don't stall on a defaultable answer.

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
| list skills / capabilities / "what can you do" / discover internal skills | meta · **skill catalog** — glob `$SKILLS_DIR/gsd-*/SKILL.md`, read each frontmatter (name/description/triggers), present the catalog + a recommendation. Never answer from this file's System map alone. |

*TDD / ponytail / YAGNI / minimal are execution preferences, not routes — capture in Discussion/plan or apply during Route 0/3. Lavish is opt-in — explicit user request ("use lavish", "visual report") satisfies the opt-in gate; the 2-part deliverable Gate (both must hold — see Triggers §) still applies.*
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
- **Signals precede Route 0.** Check the intent-signal table first; if a signal matches, skip Route 0. Otherwise evaluate routes 0→6 in order and take the first match.
- **Multiple features in flight.** Routes 1/3 key off `.scratch/<feature>/`. If more than one feature dir exists and the prompt doesn't name one: among **relevant** live features (resume-style or feature-related prompts), resume the **most-recently-modified** (dir mtime) and name it in your first line so the user can redirect — never silently pick an arbitrary feature. If the prompt is unrelated to all existing features (new work), fall through to Route 6. **To list/switch**: glob `.scratch/*/spec.md` (or `ls .scratch/`) and resume the named one.
- **Route trace.** State the chosen route + target skill in one line at the top of your first response (e.g. `Route 4 → gsd-diagnosing-bugs`), and make reading that skill's SKILL.md your **very next tool call** — trace then load, before any other action. Makes routing auditable — the user catches an over-eager route instantly and redirects.
- **Route 0↔4 boundary.** Route 0 if you can name the single spot and write the fix without investigation; otherwise Route 4. Unsure → start at Route 0; if the fix loop fails twice, escalate to Route 4 (don't keep retrying the same one-spot guess).
- **Route 0→5 escalation.** A Route 0 read-only question that grows past the targeted scope (≥3 unrelated files, or broad cross-module understanding needed) → escalate to Route 5. Don't keep reading speculatively under Route 0.
- **Route 3 relevance guard.** A pending plan routes to execution ONLY when the prompt relates to that feature's tasks. Unrelated prompt + existing plan → fall through (the user may be starting new work or asking an unrelated question).
- **Examples**: typo fix → 0 (nano) · "how does X work?" → 0 (read-only) · pasted diff / "review this" → 2 · "continue" + handoff → 1 · "pause"/"save" → handoff (write) · "can't reproduce"/"debug" → 4 · obvious error with clear stack trace → 0 (not 4) · "audit architecture" → 5 · "add feature X" → 6 · existing plan + unrelated ask → 6 (relevance guard) · "architecture is fine, fix typo" → 0 (mention ≠ ask).


## Scope discipline — read only what the prompt needs
Match exploration breadth to prompt complexity; over-exploration drifts from the ask and burns the budget.
- **Trivial/targeted prompt** → read the named file(s) + their direct imports only. No whole-tree scan, no architecture skill.
- **Read-only question** ("how does X work?", "where is Y?") → same bound as a targeted change: the named area + its direct imports. A question is not a license to walk the tree — if the answer genuinely needs the whole codebase, that's Route 5 (architecture), not a quick answer.
- **Whole-codebase work** — an explicit "audit / map / refactor the architecture" — is the ONLY case you walk broadly (scoped per the rules below).
- **Stay in git scope.** Operate on the current project's git-tracked tree only. Skip non-git subtrees (nested repos, vendored tools, submodules carrying their own `.git`) and dependency/build/output dirs (`node_modules`, `dist`, `build`, `.next`, `target`, …) and anything `.gitignore`'d. These are noise — never the subject of a simple prompt.
- Locate with `grep`/`glob`; load with `read` (offset/limit). Never open a directory hoping. One relevant file beats ten speculative reads.
- **Delegating exploration** (Explore subagent) → pass these bounds in its prompt; an unscoped explore subagent walks everything.

## Dynamic Sub-Skill Loading
Only `/gsd` is registered; sub-skills are siblings **discovered by reading files, not by the harness**. The harness will never suggest them — you load them yourself. Resolve from this skill's symlink (any cwd):
```
  SKILLS_DIR="$(dirname "$(readlink ~/.agents/skills/gsd 2>/dev/null || echo ~/.agents/skills/gsd)")"
  # read "$SKILLS_DIR/gsd-<sub>/SKILL.md"
```
Fallback: real dir (not symlink) → `|| echo` uses it directly. Sibling missing → re-run `install.sh`, don't guess.
**Load timing:** the moment a route or trigger names `gsd-<sub>`, reading its SKILL.md is the next action — before any plan, edit, or reply in that flow. Once read it stays in context; don't re-read per step.
If the harness's `skill://` scheme cannot resolve unregistered skills, use the `read` tool with the resolved path above.

## Entry — Discussion Mode
- Pastes plan/spec/diff → **stress-test**.
- Vague one-liner → **discovery**.
- Materially ambiguous → ONE disambiguating question (see Clarify principle above).
- Pure question/advisory/exploration (no code change intended) → **answer directly**; no spec/plan.
## Body
Recommend an answer for every question. One design branch at a time.
- **Independent Qs** → batch (each with a recommendation). **Dependent** → sequential. Never batch a dependent chain.
- **Discovery**: explore (targeted, git-scoped — see Scope discipline) → clarifying Qs → 2-3 approaches + tradeoffs + recommendation.
- **Stress-test**: break/sharpen the plan — risks, edge cases, missing decisions, hidden assumptions.
- **Right-size the recommendation**: recommend the smallest approach that meets the ask (ponytail-ladder thinking); a small ask converges to a 2-4-AC spec. Never pad a spec with speculative scope — retries, telemetry, config, abstractions nobody asked for are added when asked, not by default.

## Convergence — write `spec.md`
When Discovery/stress-test converges (the user picks an approach and open questions close), write `.scratch/<feature>/spec.md` BEFORE routing to `gsd-to-plan` — the contract every downstream skill reads (`gsd-to-plan` maps each task's `satisfies` to its AC IDs; `gsd-verify` checks every non-superseded AC is met). Load [REFERENCE.md](REFERENCE.md) for the template + AC rules (checkable outcomes, stable IDs, superseded on revision). Two rules shape the split itself:
- **Large feature → milestone specs**: `<feature>-m1/`, `-m2/`, … — each landing on `<base>` before the next is specced in detail (full rule: [REFERENCE.md](REFERENCE.md)).
- The fix fast-paths (below) carry no `spec.md` — quick-fix goes through `gsd-verify` (code-quality only); nano-fix verifies inline (no gate).

## Triggers (supporting skills fire automatically — except lavish, which is opt-in)
 - `gsd-lavish` — opt-in visual surface for substantial, standalone deliverables (spec, comparison, finalized `plan.toon`, verify report, audit). **Never auto-fired**: default to terminal, ask first; explicit user request ("use lavish", "visual report") satisfies the opt-in — then check the **Gate (both must hold):** (1) a reviewable deliverable, not mid-conversation; AND (2) annotating it in a browser adds value. Never on inline Qs or per-task diffs.
- `gsd-ponytail` — quick-fix entry → short-circuit to fast-path below, skip the body. **Manual toggle**: if the user says "ponytail <level>" or "stop ponytail"/"normal mode", set/clear the level and acknowledge — no routing needed.
- `gsd-domain-modeling` — durable term/decision crystallizes → capture to `CONTEXT.md`/ADR.
- `gsd-codebase-design` — a module-interface / deepening decision is in play.
- `gsd-handoff` — pause/breakpoint (user-triggered or context-pressure). **Manual toggle**: "autosync on/off" → persist the explicit row (`autosync,on` / `autosync,off` — `off` is a remembered decline, never cleared back to unset) and acknowledge, per handoff `settings[]` (gsd-handoff § Portable) — when on, every pause/task auto-syncs scratch to the `wip/` remote for cross-machine resume.

## Fix fast-paths (skip the Discussion body)
- **Nano-fix** — a one-line / purely mechanical change (typo, literal, import, rename, format): fix in place, commit to the current branch, verify **inline** ("the diff does exactly what the prompt asked, nothing more"). No `.scratch/`, no `plan.toon`, no `wip/` branch, no `gsd-verify` gate. The shortest path — don't dress up a one-liner.
- **Quick-fix** — a real but small fix (no design, ≤1 module): set `gsd-ponytail`, fix directly, capture `<base>` (`git branch --show-current`) then write a minimal `plan.toon` (`schema:v1` + `base:<base>` + 1-2 tasks) to `.scratch/<feature>/`, `git checkout -b wip/<feature>`, commit → `gsd-verify` (code-quality only, no `spec.md`) → `<base>`. Skips the Discussion body, not the `gsd-verify` gate.

## Feature cleanup
"abandon/drop/delete feature X" → follow the safe flow in [REFERENCE.md](REFERENCE.md) § Feature cleanup: confirm name → `git checkout <base>` → safe-delete the `wip/` branch → remove `.scratch/<feature>/`; never force-delete unmerged work without explicit confirm; warn if `git status` is dirty.

## Conventions
`<feature>` = feature slug. Artifacts under `.scratch/<feature>/` (`mkdir -p .scratch/<feature>/` before first write): `spec.md`, `plan.toon`, `handoff-<n>.toon`. Branch: `wip/<feature>`. Git repo assumed (`git init` if new). Skill refs: `skill` = refer/route; `/skill` = invoke inline.
`.scratch/` is **git-ignored** — ensure a `.gitignore` entry on first `mkdir`. Tracked-by-default scratch breaks cross-branch resume (`git checkout <base>` drops the dir) and leaks plan/spec into the squash merge — so scratch is **machine-local** by default. Moving machines is an explicit act: `gsd-handoff` § Portable syncs it onto the `wip/` branch (`git add -f`) and `gsd-verify` strips it before the squash commit.
`<base>` = the repo's default branch. **Capture** before `git checkout -b wip/<feature>`: `BASE=$(git branch --show-current)` — if empty (detached HEAD) **or a `wip/*` branch** (already on wip, e.g. a pre-plan portable resume — never record the wip branch as its own base), fall back to: `base` row in the latest handoff `settings[]` (pre-plan portable pause) → `git symbolic-ref --short refs/remotes/origin/HEAD` (strip `origin/`) → `git config init.defaultBranch` → `main` (check non-empty at each tier). Persist as `base:<branch>` in `plan.toon` immediately after `schema:v1`, before the `plan[` table. On resume/verify, read `base:` from `plan.toon`. Nano-fix has no branch/merge → no `<base>` needed.
**TOON** (Token-Oriented Object Notation, [spec](https://toonformat.dev/reference/spec.html)) — ~40% smaller than JSON: `table[count]{fields}:` then one comma-separated row/line. `plan.toon`/`handoff-<n>.toon` are TOON; GSD adds `|` as sub-separator (e.g. `AC-1|AC-2`).
`CONTEXT.md` — project glossary at repo root (sole writer: `gsd-domain-modeling`); `CONTEXT-MAP.md` indexes multiple contexts; `docs/adr/` holds ADRs.
Contextual disclosure (canonical — sub-skills reference this, don't repeat) — two surfaces, never both: (a) **master** → numbered human end-session choices; (b) **directly-invoked sub-skill** → `Next steps:` + commands. Inline firing (a sub-skill triggered inside another skill's flow) appends nothing. Cue: `Next steps:` = technical; numbered = human.
Graceful degradation — optional capabilities (browser, lavish, `task`/`reviewer` subagents) assumed absent; unavailable → terminal silently. Missing lavish → terminal, not error. No subagents → do the work inline in self-contained passes under the same verdict contract (see gsd-executing-plans / gsd-verify).
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
