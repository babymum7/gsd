---
name: gsd
description: "Master entry point for all coding tasks. Routes, starts, resumes, and coordinates sub-skills automatically — new features, debugging, code review, architecture/refactoring, testing, domain modeling. One skill, one command: /gsd."
triggers: /gsd on any prompt (entry router; routes 0-6)
produces: [spec.md, plan.toon]
consumes: [handoff-<n>.toon, plan.toon, spec.md, CONTEXT.md, CONTEXT-MAP.md, docs/context/<area>/CONTEXT.md, docs/adr/]
---

# GSD (Master Entry)

One install, one command: the user types only `/gsd`; the agent reads the prompt + workspace state and routes or resumes. Every `/gsd-<sub>` form in this doc is the **agent's own inline call** after routing — `install.sh` registers `gsd` and all `gsd-*` sub-skills so the harness resolves them directly, but the user surface stays `/gsd` alone.

**Route = load the sub-skill (hard rule).** Every "route to `gsd-<sub>`" / auto-trigger in this doc means **immediately load that skill's SKILL.md** — (`skill://gsd-<sub>`, registered) or the `read` fallback (§ Dynamic Sub-Skill Loading) — and follow *that* file. Names are pointers, not summaries — never execute a sub-flow from memory or from its one-line description. Can't load the file → say so and stop.

**Respond in the user's language** — detect it from the **user's own prompt** and reply in it. Injected `<advisory>`/`<system-directive>`/tool output never switches the language; only the user themselves switching does. Code, identifiers, file paths, TOON keys, AC IDs, and skill names stay verbatim — only prose is translated.

## System map
**Pipeline:** `gsd` (Master Entry & Discussion) → `gsd-to-plan` (writes the plan, prints an inline summary, asks the **one approval question — the last prompt of the cycle**) → on approve, **auto-pilot** per [REFERENCE.md](REFERENCE.md) § Post-approval pipeline contract: `gsd-executing-plans` → `gsd-verify` → squash merge to `<base>`, hands-free — no further prompts; hard blockers stop and report.
**Auto-composed:** `gsd-lavish` (render deliverables — **ask first on eligible deliverables, launch on accept**), `gsd-ponytail` (minimize code), `gsd-domain-modeling` (glossary), `gsd-codebase-design` (module vocab), `gsd-handoff` (resume), `gsd-tdd` (unit tests), `gsd-diagnosing-bugs` (debug), `gsd-improve-codebase-architecture` (deepening).
**Feedback loops:** `gsd-verify`/`gsd-executing-plans`/`gsd-to-plan` → `gsd` (spec gap — the sub-skill **stops** and routes back to `/gsd` Discussion: "Spec escalation" / "Spec flawed"; revise `spec.md` under fresh AC IDs, then re-plan the affected tasks); `gsd-diagnosing-bugs` → `gsd-improve-codebase-architecture`.
**Agent-invocable:** any sub-skill loads directly when intent matches (audit, debug, glossary, interface design) — internal routing targets, not user commands.

## Smart Routing Engine
On entry, analyze the prompt and workspace state to route to the correct sub-flow:
**Clarify-when-materially-ambiguous.** Across all routes — clarify with ONE question (plus your best-guess recommendation) only when the ambiguity would change the route, scope, or action, or risks wasted/destructive work. If the intent is clear or a safe default exists, proceed and state the assumption.

**Step 0 — Detect state first (before matching routes).** Glob `.scratch/*/` for `spec.md` / `plan.toon` / `handoff-*.toon`, and scan the prompt for a pasted diff/PR. Workspace state — not just the prompt's wording — drives Routes 1/2/3: a "continue"/"resume" prompt with a live `handoff-*.toon` is Route 1 even when it reads like new work; a feature ask **related to** an existing feature with a `plan.toon` is Route 3; an **unrelated** feature ask with a `plan.toon` is Route 6 (new work), not Route 3. Resume-style prompt but no local `.scratch/` (fresh clone / other machine)? `git fetch --prune`, then list local + remote WIP branches: `git branch -a --list 'wip/*' --list '*/wip/*'` — a portable handoff materializes `.scratch/<feature>/` via `git switch --track origin/wip/<feature>` (or plain `git switch wip/<feature>` if local; see gsd-handoff § Portable); no synced scratch → reconstruct per gsd-handoff.
**Step 0 — domain artifacts are presence-only metadata.** In the same cheap entry pass, check only whether `CONTEXT.md`, `CONTEXT-MAP.md`, any `docs/context/<area>/CONTEXT.md`, and any `docs/adr/` entries exist (existence/glob metadata only). Do not open or sweep their contents, infer a domain model, trigger `gsd-domain-modeling`, propose an artifact, or write one at entry. Missing domain docs are normal.
**Artifact validation — mode before requirements.** Route and load the target skill, then select its Invocation Mode from explicit intent and entry context before validating artifacts. On resume preserve the handoff's open `mode` and `phase` values; never infer a mode solely from `spec.md` or `plan.toon` presence. Validate only the selected row's Required artifacts and follow its Missing required action. Flat `consumes:`/`produces:` remain catalog unions, and missing Optional artifacts never redirect. Load [REFERENCE.md](REFERENCE.md) § Artifact Contract for the canonical roles and ordering.
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

*TDD / ponytail / YAGNI / minimal are execution preferences, not routes — capture in Discussion/plan or apply during Route 0/3. On an offer-eligible deliverable lavish must *ask first* (the ask rides an existing surface — a menu line or one inline "review visually?"); **launching** the browser flow waits for the user to accept — an explicit request ("use lavish", "visual report") or picking the offer satisfies it. Never auto-launch. The 2-part Gate (Triggers §) still applies.*
0. **Direct / Trivial (check first)**:
   - A simple question, advisory, or read-only targeted lookup → answer directly.
   - For a write, classify before acting: **Nano** is purely mechanical and non-behavioral (typo, formatting, import cleanup, or a literal/rename that does not alter behavior) and stays direct with no Ponytail load; line count alone is insufficient. **Real quick-fix** is a behavioral small code change in at most one module, with no design work and a known single spot/root cause that needs no investigation; it always loads `gsd-ponytail` and then uses the existing quick-fix fast path. A one-line behavioral correction such as a known off-by-one is Real quick-fix, not Nano. An obvious failing-test/error fix belongs here only when it meets that real quick-fix boundary. **Do NOT explore broadly or trigger architecture skills.**
   - **No-signal contract:** a typo, read-only fixture, nano-fix, or other trivial Route 0 task with no durable domain/decision signal stops at the Step 0 presence check. Perform no glossary/ADR scan and propose or write no `CONTEXT.md`, `CONTEXT-MAP.md`, area context, or ADR.

**Route 0 classifier (normative).**
| Class | Deterministic boundary | Route | Skill | Activation cue |
|---|---|---|---|---|
| Direct/read-only | Question, advisory, or targeted lookup with no write | `0` | `none` | `none` |
| Nano | Purely mechanical and non-behavioral: typo, formatting, import cleanup, or a literal/rename that does not alter behavior; line count alone is insufficient | `0` | `none` | `none` |
| Real quick-fix | Behavioral small code change; at most one module; no design; known single spot/root cause; no investigation, including a one-line known-root-cause fix | `0` | `gsd-ponytail` | `Ponytail: full — scoped to this quick-fix.` when no explicit toggle is active; an active explicit toggle uses its level and the session-scope cue from `gsd-ponytail` |
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
- **Route 0↔4 boundary.** Route 0 real quick-fix if you can name the single spot and write the fix without investigation; load `gsd-ponytail` before changing code. Otherwise Route 4. Unsure → start at Route 0; if the fix loop fails twice, escalate to Route 4.
- **Route 0→5 escalation.** A Route 0 read-only question that grows past the targeted scope (≥3 unrelated files, or broad cross-module understanding needed) → escalate to Route 5.
- **Route 3 relevance guard.** A pending plan routes to execution ONLY when the prompt relates to that feature's tasks. Unrelated prompt + existing plan → fall through (the user may be starting new work or asking an unrelated question).
- **Examples**: typo fix → 0/`none` (nano) · "how does X work?" → 0/`none` (read-only) · obvious error with a known one-module stack spot → 0/`gsd-ponytail` (real quick-fix) · pasted diff / "review this" → 2 · "continue" + handoff → 1 · "pause"/"save" → handoff (write) · "can't reproduce"/"debug" → 4 · "audit architecture" → 5 · "add feature X" → 6 · existing plan + unrelated ask → 6 (relevance guard) · "architecture is fine, fix typo" → 0/`none` (mention ≠ ask).


## Scope discipline — read only what the prompt needs
Match exploration breadth to prompt complexity; over-exploration drifts from the ask and burns the budget.
- **Trivial/targeted prompt** → read the named file(s) + their direct imports only. No whole-tree scan, no architecture skill.
- **Read-only question** ("how does X work?") → same bound as a targeted change: the named area + its direct imports. If the answer genuinely needs the whole codebase, that's Route 5 (architecture), not a quick answer.
- **Whole-codebase work** — an explicit "audit / map / refactor the architecture" — is the ONLY case you walk broadly (scoped per the rules below).
- **Stay in git scope.** Operate on the current project's git-tracked tree only. Skip non-git subtrees (nested repos, vendored tools, submodules with their own `.git`), dependency/build dirs (`node_modules`, `dist`, `build`, …), and anything `.gitignore`'d.
- Locate with `grep`/`glob`; load with `read` (offset/limit). One relevant file beats ten speculative reads.
- **Delegating exploration** (Explore subagent) → pass these bounds in its prompt; an unscoped explore subagent walks everything.

## Conservative context harvest
Domain harvesting happens **after route selection**, never as an entry scan. Its fixed flow is:
`existence check → selected-route evidence → no-op | certain write | one ambiguity question`.

**Authority gate (before every domain write).** Derive domain-write authority from the selected route and Invocation Mode before considering any certain-write outcome. The selected invocation MUST be write-authorized before `gsd-domain-modeling` may create or update a project artifact. Standalone advisory/read-only Route 0 and Standalone review (Route 2) are domain no-op modes even when their inspected input contains strong term or decision evidence: they may report the observation, but must not mutate or create a domain artifact. Nano is also no-domain-write. This gate does not ban write-authorized non-trivial routes; those routes remain eligible for the evidence-gated outcomes below.

1. Reuse the code, docs, task brief, spec, and relevant existing domain artifacts already read to perform the selected route. Do not add a repository-wide glossary or ADR sweep.
2. A harvest candidate exists only when that evidence reveals a recurring project-specific term or an explicit architectural decision/rationale signal. Only then may the selected flow make targeted reads of code/docs that bear on that term, consult `CONTEXT-MAP.md` for ownership, or read related existing ADRs. Generic vocabulary, a one-off identifier, implementation detail, code shape without rationale, a reversible preference, and absent evidence are no-op.
3. **Write-authorized outcomes.** Invoke `gsd-domain-modeling` as the sole writer only for a real candidate and only after the authority gate passes. Certain evidence creates or updates the one appropriate artifact. Before plan approval, material uncertainty about meaning, ownership, or trade-off asks exactly one focused question and writes nothing until resolved; immaterial uncertainty is no-op.
4. After plan approval, documentation ambiguity asks zero questions. If it changes an AC, interface, or invariant, or prevents correct implementation, use `gsd-executing-plans`' existing Spec escalation blocker; otherwise skip the documentation write and continue.

Missing artifacts never create empty scaffolds. `CONTEXT-MAP.md` must be consulted before choosing root versus mapped area context, and related existing ADRs must be checked for dedupe/update/no-op before a new ADR is proposed.

### Executable policy scenario matrix (normative)
This ordered table is the decision oracle for context harvest. Match the explicit inputs, then apply every outcome column exactly; `meta:` reads are existence/glob metadata only, and `none` means no action. A pre-approval write returns its exact path for the convergence ownership gate rather than authorizing a commit by itself.

| Scenario | Inputs | Route | Reads | Writes | Questions | Escalation | Owning task |
|---|---|---|---|---|---|---|---|
| Entry typo read-only | `phase=entry;authority=read-only;mode=typo;signal=none` | `0:direct` | `meta:CONTEXT.md,meta:CONTEXT-MAP.md,meta:docs/context/<area>/CONTEXT.md,meta:docs/adr/` | `none` | `0` | `none` | `none` |
| Nano no-domain-write | `phase=entry;authority=no-domain-write;mode=nano;signal=none` | `0:direct` | `meta:CONTEXT.md,meta:CONTEXT-MAP.md,meta:docs/context/<area>/CONTEXT.md,meta:docs/adr/` | `none` | `0` | `none` | `none` |
| Standalone review read-only | `phase=selected-route;authority=read-only;mode=standalone-review;signal=decision` | `2:gsd-verify` | `selected-route-evidence,related-ADRs` | `none` | `0` | `none` | `none` |
| Certain recurring domain term | `phase=pre-approval;authority=write-authorized;signal=term;certainty=certain;map=absent` | `5:gsd-domain-modeling` | `selected-route-evidence,targeted-term-evidence` | `CONTEXT.md` | `0` | `none` | `return=<write-path>;state=pending-transfer` |
| Mapped multi-context term | `phase=pre-approval;authority=write-authorized;signal=term;certainty=certain;map=mapped` | `5:gsd-domain-modeling` | `selected-route-evidence,CONTEXT-MAP.md,targeted-term-evidence` | `docs/context/<area>/CONTEXT.md` | `0` | `none` | `return=<write-path>;state=pending-transfer` |
| Material pre-approval ambiguity | `phase=pre-approval;authority=write-authorized;signal=term;certainty=material-ambiguous;map=unresolved` | `5:gsd-domain-modeling` | `selected-route-evidence,CONTEXT-MAP.md,targeted-term-evidence` | `none` | `1` | `none` | `none` |
| Fully evidenced ADR | `phase=pre-approval;authority=write-authorized;signal=decision;reversibility=hard;surprise=yes;tradeoff=real;rationale=evidenced;existingADR=none` | `5:gsd-domain-modeling` | `selected-route-evidence,related-ADRs` | `<adr-path>` | `0` | `none` | `return=<write-path>;state=pending-transfer` |
| Reversible preference | `phase=pre-approval;authority=write-authorized;signal=decision;reversibility=reversible` | `5:gsd-domain-modeling` | `selected-route-evidence` | `none` | `0` | `none` | `none` |
| Post-approval load-bearing ambiguity | `phase=post-approval;authority=write-authorized;signal=domain;certainty=material-ambiguous;loadBearing=yes` | `3:gsd-executing-plans` | `selected-route-evidence,targeted-domain-evidence` | `none` | `0` | `spec` | `none` |
| Post-approval non-load-bearing ambiguity | `phase=post-approval;authority=write-authorized;signal=domain;certainty=material-ambiguous;loadBearing=no` | `3:gsd-executing-plans` | `selected-route-evidence,targeted-domain-evidence` | `none` | `0` | `none` | `none` |
| Pre-approval write ownership | `phase=convergence;authority=write-authorized;intentionalWrite=yes;changedPaths=returned;ownership=assigned` | `3:gsd-to-plan` | `returned-changed-paths` | `none` | `0` | `none` | `task=<task-id>;files=<changed-path>;commit=with-task` |

## Dynamic Sub-Skill Loading
All `gsd-*` skills are registered by `install.sh` — load one directly (`skill://gsd-<sub>`). Prefer `/gsd` as orchestrator; a sub-skill selected directly by the harness applies its own invocation-mode table under [REFERENCE.md](REFERENCE.md) § Artifact Contract, not a blanket “missing `consumes:`” guard.
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
- **Pin the existing public test seam before convergence.** Inspect the test layout already relevant to the feature. Select the highest deterministic existing public interface or harness that observes the AC through production behavior: an existing user/browser/CLI/HTTP boundary first, otherwise the highest existing public module API. At the same tier, first select the production entrypoint named by the AC/`Check:`; then prefer the repository's canonical existing harness convention; then greater production-path coverage with no test-only bypass. A remaining tie is materially ambiguous: stop in Discussion rather than choose arbitrarily. For every AC, record the exact selected seam/path and `Lower-Seam Reason: none` under `Design & Invariants` → `Shared Interfaces`, or record the concrete reason when a higher seam is absent or cannot deterministically isolate the AC. Never invent a lower test-only interface because it is easier to exercise.

## Convergence — write `spec.md`
When Discovery/stress-test converges (the user picks an approach and open questions close), write `.scratch/<feature>/spec.md` BEFORE routing to `gsd-to-plan` — the contract every downstream skill reads. Load [REFERENCE.md](REFERENCE.md) for the template + AC rules (checkable outcomes, stable IDs, superseded on revision). These rules shape the split itself:
- **Large feature → milestone specs**: `<feature>-m1/`, `-m2/`, … — each landing on `<base>` before the next is specced in detail (full rule: [REFERENCE.md](REFERENCE.md)).
- **Large-feature precision gate.** A materially answerable precise question—not a topic label—may keep a current/future milestone eligible for further Discussion; writing any `spec.md` requires at least one checkable AC with its `Check:` stated concretely. Anything with neither stays one concise fog/future/out-of-scope note on an existing Discussion/spec surface: create no plan task, detailed speculative spec, tracker/map artifact, or new skill. For a mixed candidate, only fully checked ACs enter `spec.md`; collapse all unchecked remainder into one such note, never speculative ACs/tasks. Revisit a note only after new evidence makes the question or AC + `Check:` precise.
- **Every AC needs a `Check:` sketch — the convergence gate.** For each AC, state its acceptance check in canonical `action → expected observable result` form per [REFERENCE.md](REFERENCE.md) § spec.md rules. Empty text, `TBD`, `TODO`, labels, and vague placeholders are not checks. Can't sketch a concrete expected result → the AC is still vague: sharpen it in Discussion before writing `spec.md`, don't converge on a fuzzy AC. The sketch is a spec-time oracle (not a runnable command); `gsd-executing-plans` carries it into the task-brief and specializes it against live code.
- **Concreteness is semantic, not word count.** The action names the actual operation/input at the pinned seam; the expected side names the observed subject plus an explicit state/value. Domain nouns padded around “do work”/“works correctly” remain vague. A precise future question names the exact decision/property and a constraint or choice that yields a determinate answer; a topic that is merely “worth discussing” does not.
- **Pre-approval domain-write transfer gate.** `gsd-domain-modeling` returns the exact repository-relative changed paths for every intentional pre-approval write. Before the plan approval question, assign every returned path to exactly one named owning plan task's `files`; do not ask for approval while any path is unowned or multiply owned. The named task commits that tracked project document on `wip/<feature>`. Never commit it on `<base>` and never use a generic or unowned documentation commit.
- The fix fast-paths (below) carry no `spec.md` — quick-fix goes through `gsd-verify` (code-quality only); nano-fix verifies inline (no gate).

## Triggers (supporting skills fire automatically; lavish must *ask first*, launches only on accept)
 - `gsd-lavish` — visual surface for substantial, standalone deliverables (spec, comparison, finalized `plan.toon`, verify report, audit). **You MUST proactively ask before launching, and launch only when the user accepts** (per [REFERENCE.md](REFERENCE.md) § Lavish opt-in gate taxonomy): when the deliverable is offer-eligible and the **Gate (both must hold)** clears — (1) a reviewable deliverable, not mid-conversation; AND (2) annotating it in a browser adds value — surface the option folded into the surface already shown (one numbered end-session menu choice, e.g. "Review the spec visually"; or a single inline "review this visually?" line) — never a second prompt, never a new question around plan approval. Launching the browser flow waits for the user to accept. Never auto-launch, never on inline Qs or per-task diffs. Silently skipping the offer on an eligible deliverable is the bug this fixes.
- `gsd-ponytail` — every real quick-fix entry loads the skill and short-circuits to the fast path below; Nano never loads it. **Explicit toggle**: `/gsd ponytail [lite|full|ultra]` sets `explicit_level` (omitted level = `full`), clears `auto_scope`, and acknowledges exactly `Ponytail: <level> — explicit session scope.`; "stop ponytail"/"normal mode" sets both `explicit_level=none` and `auto_scope=none` and acknowledges `Ponytail: none — normal mode.` No routing menu or follow-up prompt.
- `gsd-domain-modeling` — after routing, when already-relevant evidence reveals a durable project-specific term or evidenced decision/rationale signal → apply Conservative context harvest; missing docs or no signal is no-op.
- `gsd-codebase-design` — a module-interface / deepening decision is in play.
- `gsd-handoff` — pause/breakpoint (user-triggered or context-pressure). **Manual toggle**: "autosync on/off" → persist the explicit row (`autosync,on` / `autosync,off` — `off` is a remembered decline, never cleared back to unset) and acknowledge, per handoff `settings[]` (gsd-handoff § Portable) — when on, every pause/task auto-syncs scratch to the `wip/` remote for cross-machine resume.

## Fix fast-paths (skip the Discussion body)
- **Nano-fix** — a purely mechanical, non-behavioral change (typo, formatting, import cleanup, or a literal/rename that does not alter behavior): fix in place, commit to the current branch, verify **inline** ("the diff does exactly what the prompt asked, nothing more"). Line count alone is insufficient, and any behavioral correction is not Nano. No `gsd-ponytail`, `.scratch/`, `plan.toon`, `wip/` branch, or `gsd-verify` gate.
- **Quick-fix** — a real but small behavioral code fix (no design, ≤1 module, known single spot/root cause), including a one-line known-root-cause correction: load `gsd-ponytail` before changing code. Use the active `explicit_level` when it is `lite|full|ultra` and leave `auto_scope=none`; otherwise keep `explicit_level=none` and set `auto_scope=quick-fix` for this fix only. Emit exactly one cue — `Ponytail: full — scoped to this quick-fix.` for auto-fire, or `Ponytail: <level> — explicit session scope; applied to this quick-fix.` for an explicit toggle — with no menu or prompt. Then fix directly, capture `<base>` (`git branch --show-current`), write a minimal `plan.toon` (`schema:v1` + `base:<base>` + 1-2 tasks) to `.scratch/<feature>/`, `git checkout -b wip/<feature>`, commit → `gsd-verify` (code-quality only, no `spec.md`) → `<base>`. On landing/merge, a hard-blocker or verify-fail stop, or a changed/unrelated prompt, preserve `explicit_level` and set `auto_scope=none`. A later resume of the same unlanded fix reclassifies it and may set `auto_scope=quick-fix` anew; it never inherits stale auto scope. The explicit toggle, if any, remains session state until stopped. This skips the Discussion body, not the WIP/verify gate.

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
Use [REFERENCE.md](REFERENCE.md) § Contextual disclosure templates → Master end-session menu. At the end of every response/discussion before plan approval, present concrete, non-technical choices for the user to select instead of listing technical skill commands. When the just-produced deliverable is lavish offer-eligible (a finalized spec, plan summary, verify report, or audit that clears the 2-part Gate), one choice MUST offer the visual review — folded into this same menu, never a second prompt. Example:
```
Next steps (reply with number or text):
1. Generate the implementation plan
2. Review the spec visually
3. Audit codebase architecture
4. Pause & Save progress
```

When the user replies with a choice, `/gsd` intercepts the input and routes to the matching sub-skill.
**Auto-pilot exception:** after the plan is approved (gsd-to-plan's approval gate), no menu appears until the pipeline merges to `<base>` or a hard blocker stops it, per [REFERENCE.md](REFERENCE.md) § Post-approval pipeline contract and § Contextual disclosure templates. "Start executing tasks" is never a menu item; execution starts by approving the plan.
