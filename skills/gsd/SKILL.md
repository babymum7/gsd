---
name: gsd
description: "Master entry point for all coding tasks. Routes, starts, resumes, and coordinates sub-skills automatically — new features, debugging, code review, architecture/refactoring, testing, domain modeling. One skill, one command: /gsd."
triggers: /gsd on any prompt (entry router; routes 0-6)
produces: [proposal.md, spec.md, design.md, plan.md, .scratch/<feature>/result.toon, docs/gsd/<feature>/milestones.md]
consumes: [handoff-<n>.toon, plan.md, proposal.md, spec.md, design.md, .scratch/<feature>/result.toon, docs/domain/index.md, docs/domain/<scope>.md, docs/gsd/<feature>/milestones.md]
---

# GSD (Master Entry)

One install, one command: the user types only `/gsd`; the agent reads the prompt + workspace state and routes or resumes. Every `/gsd-<sub>` form in this doc is the **agent's own inline call** after routing — `/gsd` is mapped via an OMP command that supplies `GSD_ROOT` and loads master/sub-skills directly, keeping the user surface to `/gsd` alone.

**Route = load the sub-skill (hard rule).** Every "route to `gsd-<sub>`" / auto-trigger in this doc means **immediately load that skill's SKILL.md** directly from `$GSD_ROOT/skills/gsd-<sub>/SKILL.md` (§ Dynamic Sub-Skill Loading) and follow *that* file. Names are pointers, not summaries — never execute a sub-flow from memory or from its one-line description. Can't load the file → say so and stop.

**Respond in the user's language** — detect it from the **user's own prompt** and reply in it. Injected `<advisory>`/`<system-directive>`/tool output never switches the language; only the user themselves switching does. Code, identifiers, file paths, TOON keys, AC IDs, and skill names stay verbatim — only prose is translated.

## System map
**Pipeline:** `gsd` (Master Entry & Discussion) → `gsd-to-plan` (writes the plan, prints an inline summary, asks the **one approval question — the last prompt of the cycle**) → on approve, **auto-pilot** per [REFERENCE.md](REFERENCE.md) § Post-approval pipeline contract: `gsd-executing-plans` → `gsd-verify` → squash merge to `<base>`, hands-free — no further prompts; hard blockers stop and report.
**Auto-composed:** `gsd-lavish` (render deliverables — **ask first on eligible deliverables, launch on accept**), `gsd-ponytail` (minimize code), `gsd-domain-modeling` (glossary), `gsd-codebase-design` (module vocab), `gsd-handoff` (resume), `gsd-tdd` (executor-only per-task TDD; not a top-level route), `gsd-diagnosing-bugs` (debug), `gsd-improve-codebase-architecture` (deepening).
**Feedback loops:** `gsd-verify`/`gsd-executing-plans`/`gsd-to-plan` → `gsd` (spec gap — the sub-skill **stops** and routes back to `/gsd` Discussion: "Spec escalation" / "Spec flawed"; revise the canonical Markdown contract under fresh AC IDs, revalidate it, and obtain a new approval before re-planning). Diagnosis has explicit exits: a successful standalone Route 4 diagnosis may hand an architectural cause to `gsd-improve-codebase-architecture`; a successful in-task Execution-blocker diagnosis returns to `gsd-executing-plans`; terminal repair round-two exhaustion remains a canonical Blocker stop until a later `/gsd` resume; and a load-bearing acceptance criterion, interface, or invariant uses Spec escalation rather than an architecture detour.
**Agent-invocable:** any sub-skill loads directly when intent matches (audit, debug, glossary, interface design) — internal routing targets, not user commands.

## Smart Routing Engine
On entry, analyze the prompt and workspace state to route to the correct sub-flow:
**Clarify-when-materially-ambiguous.** Across all routes — clarify with ONE question (plus your best-guess recommendation) only when the ambiguity would change the route, scope, or action, or risks wasted/destructive work. If the intent is clear or a safe default exists, proceed and state the assumption.

**Step 0 — Canonical contract check.** Before ordinary routing, glob `.scratch/*/` for Markdown and runtime artifacts. A converged pre-plan feature has valid `proposal.md` and `spec.md` plus optional same-feature `design.md`; route it to `gsd-to-plan`, the sole `plan.md` author. An approved/executing feature additionally has a valid `plan.md` and complete source-set SHA-256 binding; a mismatch is a Spec escalation. Any root `proposal.toon`, `spec.toon`, `design.toon`, or `plan.toon` is stale non-authoritative state: never read it for scope, task order, or acceptance; stop with actionable re-convergence unless the approved `markdown-canonical-contracts` bootstrap binding explicitly authorizes T1, T2, or T3. T3 MUST remove its legacy packet before ordinary routing resumes.

**Step 0 — Detect result.toon marker first.** Before ordinary scratch proposal/spec/plan routing, check if `.scratch/<feature>/result.toon` exists. If present, strictly validate it under the exact schema and enums in [REFERENCE.md](REFERENCE.md) § Squash and cleanup result marker contract. A malformed marker fails closed immediately. A valid marker always blocks implementation resume. If scratch status is `pending` (indicating a crash-visible pending state), resume only the one cleanup decision (prompting the user exactly once for delete or retain) and never resume implementation. If scratch status is `retained` and status is `merged`, allow only explicit packet deletion (abandon/cleanup). If status is `merged_cleanup_residual`, allow only explicit residual cleanup. This blocks all other proposal/spec/plan routing, while preserving separate active-feature abandon semantics without creating a second postmerge cleanup flow.

**Step 0 — Detect state first (before matching routes).** Glob `.scratch/*/` for `proposal.md` / `spec.md` / `design.md` / `plan.md` / `handoff-*.toon`, and scan the prompt for a pasted diff/PR. Workspace state — not just the prompt's wording — drives Routes 1/2/3: a "continue"/"resume" prompt with a live `handoff-*.toon` is Route 1 even when it reads like new work; a feature ask **related to** an existing feature with a `plan.md` is Route 3; an **unrelated** feature ask with a `plan.md` is Route 6 (new work), not Route 3. Resume-style prompt but no local `.scratch/` (fresh clone / other machine)? `git fetch --prune`, then list local + remote WIP branches: `git branch -a --list 'wip/*' --list '*/wip/*'` — a portable handoff materializes `.scratch/<feature>/` via `git switch --track origin/wip/<feature>` (or plain `git switch wip/<feature>` if local; see gsd-handoff § Portable); no synced scratch → reconstruct per gsd-handoff.
**Domain documentation is lazy context, not routing state.** Do not scan `docs/domain/` at entry, infer a model, trigger `gsd-domain-modeling`, propose an artifact, or write one at entry. Missing domain docs are normal. A selected downstream skill may read `docs/domain/index.md` only after its already-bounded work reveals a durable domain signal, then load only the relevant indexed shard(s).
**Step 0 — milestone-ledger presence is metadata-only.** For a named feature, check only whether the exact `docs/gsd/<feature>/milestones.md` path exists; do not open it, select work from it, or infer large-feature mode solely from presence during entry routing. Missing ledger state is normal, and ordinary or single-milestone work requires no ledger.
**Artifact validation — mode before requirements.** Route and load the target skill, then select its Invocation Mode from explicit intent and entry context before validating artifacts. On resume preserve the handoff's open `mode` and `phase` values; never infer a mode solely from `spec.md` or `plan.md` presence. Validate only the selected row's Required artifacts and follow its Missing required action. Flat `consumes:`/`produces:` remain catalog unions, and missing Optional artifacts never redirect. Load [REFERENCE.md](REFERENCE.md) § Artifact Contract for the canonical roles and ordering.
**Git repo guard.** Route 0 Direct/read-only and Nano are completely git-free: do not run any git subprocess, and do not initialize, branch, diff, stage, or commit. Pasted-diff review (Route 2) also works without git. For every branch-backed workspace write/commit path (quick-fix, resume/execute/verify), run `git rev-parse --is-inside-work-tree`; not in a repo → `git init` before writing.
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
| list skills / capabilities / "what can you do" / discover internal skills | meta · **skill catalog** — enumerate the GSD skills (System map names → load each frontmatter directly from $GSD_ROOT/skills/gsd-<target>/SKILL.md or glob $GSD_ROOT/skills/gsd-*/SKILL.md if not present), present the catalog + a recommendation. Never answer from this file's System map alone. |

*TDD / ponytail / YAGNI / minimal are execution preferences, not routes — capture in Discussion/plan or apply during Route 0/3. On an offer-eligible deliverable lavish must *ask first* (the ask rides an existing surface — a menu line or one inline "review visually?"); **launching** the browser flow waits for the user to accept — an explicit request ("use lavish", "visual report") or picking the offer satisfies it. Never auto-launch. The 2-part Gate (Triggers §) still applies.*
0. **Direct / Trivial (check first)**:
   - A simple question, advisory, or read-only targeted lookup → answer directly.
   - For a write, classify before acting: **Nano** is purely mechanical and non-behavioral (typo, formatting, import cleanup, or a literal/rename that does not alter behavior) and stays direct with no Ponytail load; line count alone is insufficient. **Real quick-fix** is a behavioral small code change in at most one module, with no design work and a known single spot/root cause that needs no investigation; it always loads `gsd-ponytail` and then uses the existing quick-fix fast path. A one-line behavioral correction such as a known off-by-one is Real quick-fix, not Nano. An obvious failing-test/error fix belongs here only when it meets that real quick-fix boundary. **Do NOT explore broadly or trigger architecture skills.**
   - **No-signal contract:** a typo, read-only fixture, nano-fix, or other trivial Route 0 task with no durable domain/decision signal performs no domain-document metadata or content read and proposes or writes nothing under `docs/domain/`.

**Route 0 classifier (normative).**
| Class | Deterministic boundary | Route | Skill | Activation cue |
|---|---|---|---|---|
| Direct/read-only | Question, advisory, or targeted lookup with no write | `0` | `none` | `none` |
| Nano | Purely mechanical and non-behavioral: typo, formatting, import cleanup, or a literal/rename that does not alter behavior; line count alone is insufficient | `0` | `none` | `none` |
| Real quick-fix | Behavioral small code change; at most one module; no design; known single spot/root cause; no investigation, including a one-line known-root-cause fix | `0` | `gsd-ponytail` | `Ponytail: full — scoped to this quick-fix.` when no explicit toggle is active; an active explicit toggle uses its level and the session-scope cue from `gsd-ponytail` |
1. **Resume**:
   - If `.scratch/<feature>/handoff-<n>.toon` exists or is passed → Read the handoff file's `mode` and `phase`, automatically load the required sub-skills, and execute the `next_action` directly.
   - If no usable local handoff, plan, or spec can satisfy the continue intent (when `.scratch/` is absent or lacks these files) and the user intent is explicitly to continue/resume:
     - Scan tracked base-branch canonical Milestone Ledger paths (`docs/gsd/<feature>/milestones.md`) only after scratch/handoff/plan/spec recovery cannot satisfy the continue intent.
     - Strictly parse each candidate under [REFERENCE.md](REFERENCE.md) § Convergence Ledger publication contract: exact headings/table, feature equal to the path slug, valid Base, sequential unique IDs, unique kebab-case slugs, a `done` prefix followed by a non-empty `pending` suffix, and no extra rows or columns.
     - If the feature is explicitly named, select only that exact valid ledger. If absent, report no ledger and stop; if malformed, Base-mismatched, or all-`done`, fail closed and name the path.
     - If no feature is named and exactly one valid open ledger exists, auto-select it.
     - If no feature is named and multiple valid open ledgers exist, ask exactly one feature-selection question listing them; make no selection or write.
     - If no feature is named and no ledger exists, report no ledger without inventing work. Any scanned malformed, Base-mismatched, or all-`done` residual fails closed rather than being skipped or reported complete.
     - Tracked canonical goals are approved authority and must not be re-run through precision or approval gates during recovery.
     - Once selected, choose the first `pending` row, enter Discussion/reconstruction, and output only its slug and goal. Do not detail later rows, mutate ledger bytes, mark completion, start execution, or authorize a merge. Missing `.scratch/`, handoff, and plan are non-blocking only for this recovery mode.
2. **Review/Diff**:
   - If the prompt contains a diff, PR description, or asks for code review → route to `gsd-verify`.
3. **Spec/Plan**:
   - If a spec has been created but no plan exists → route to `gsd-to-plan`.
   - If `plan.md` plus an approval/runtime handoff exist and the prompt relates to that feature's unfinished runtime work → route to `gsd-executing-plans`; that skill selects the Invocation Mode and validates the complete binding, so drift reaches its Spec-escalation path instead of changing the route. Select `Milestone plan execution` only from explicit milestone intent/entry context, then require active plan/scratch/WIP slug, canonical root path, first-pending base row, and exact-once plan ownership to agree; otherwise Normal mode or fail closed when milestone mode was explicitly claimed. (An unrelated prompt falls through to Route 4/5/6 — an existing plan is not a claim on every prompt.)
   - Normal mode has no milestone-completion authority. It may publish an authorized convergence-time ledger only under [REFERENCE.md](REFERENCE.md) § Convergence Ledger publication contract: the approved `spec.md` `## Publication` value must be the exact active root ledger path (not `null`), and one non-superseded `plan.md` task must own that exact path once in Files. The source binding, pending-only append/create bytes, owner-task commit evidence, and ordinary review/build/acceptance gates still apply. Ledger presence, changed bytes, or context cannot infer authority.
   - Publication never selects Milestone mode, changes a ledger row to `done`, or starts a milestone. Any ledger-shaped Files token not byte-for-byte equal to the authorized canonical path blocks before dispatch.
4. **Issue/Bug**:
   - A **hard/obscure** bug — non-obvious cause, hard to reproduce, a real regression, or a failure the per-task fix loop can't resolve → route to `gsd-diagnosing-bugs`. (Obvious single-spot failures were caught by Route 0.)
5. **Codebase Exploration**:
   - If user asks about architecture, design, or deep module refactoring → route to `gsd-improve-codebase-architecture` or `gsd-codebase-design`. Rule: **audit the system → improve; design one interface → codebase-design.**
6. **New Work / Vague Input**:
   - If starting a new feature or receiving a vague one-liner → route to **Discussion** to stress-test or discover requirements.

## Routing rules
- **Signals precede Route 0.** Check the intent-signal table first; if a signal matches, skip Route 0. Otherwise evaluate routes 0→6 in order and take the first match.
- **Multiple features in flight.** Routes 1/3 key off `.scratch/<feature>/`. Several feature dirs and the prompt doesn't name one → resume the **most-recently-modified** (dir mtime) relevant feature and name it in your first line so the user can redirect. If `.scratch/` is absent and we fall back to Milestone Ledger recovery with no named feature: if exactly one open ledger exists, auto-select it; if multiple open ledgers exist, ask exactly one feature-selection question and select none; if zero open ledgers exist, report complete/no ledger. Unrelated to all features → Route 6. **To list/switch**: glob `.scratch/*/spec.md` and resume the named one.
- **Route trace.** State the chosen route + target skill in one line at the top of your first response (e.g. `Route 4 → gsd-diagnosing-bugs`). When a target skill exists, loading it (`$GSD_ROOT/skills/gsd-<sub>/SKILL.md` directly) is your **very next tool call** — trace then load, before any other action. Route 0 Direct/read-only and Nano instead emit `Route 0 → none` and perform no skill load; Route 0 Real quick-fix targets and immediately loads `gsd-ponytail`. Meta actions follow their named non-numbered surface. These explicit branches keep routing auditable without inventing a skill.
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

Domain harvesting happens **after route selection**, never as an entry scan. Its only purpose is to reuse evidence already bounded by the selected route and preserve certain, durable project language or decisions without turning every task into documentation work.

**Authority gate (before every domain write).** Derive domain-write authority from the selected route and Invocation Mode before considering any write outcome. Standalone advisory/read-only Route 0, Standalone review (Route 2), and Nano are domain no-op modes even when inspected input contains strong evidence: they may report an observation but never mutate or create domain documentation. Write-authorized non-trivial routes remain eligible for the evidence-gated outcomes below.

1. Reuse the code, docs, task brief, spec, and relevant domain shards already read for the selected route. Do not add a repository-wide glossary or decision sweep.
2. A candidate exists only when that evidence reveals a recurring project-specific term or an explicit architectural decision with rationale. Only then may the flow make targeted reads that bear on that candidate, read `docs/domain/index.md`, and load the minimum relevant indexed shards. Generic vocabulary, one-off identifiers, implementation details, code shape without rationale, reversible preferences, and absent evidence are no-op.
3. **Write-authorized outcomes.** Invoke `gsd-domain-modeling` as the sole writer only for a real candidate after the authority gate passes. Certain evidence creates or updates one owning `docs/domain/<scope>.md` shard and creates/updates `docs/domain/index.md` only when scope membership changes. Before approval, material uncertainty about meaning, ownership, or trade-offs asks exactly one focused question and writes nothing until resolved; immaterial uncertainty is no-op.
4. After plan approval, documentation ambiguity asks zero questions. If it changes an AC, interface, or invariant, or prevents correct implementation, use `gsd-executing-plans`' existing Spec-escalation blocker; otherwise skip the documentation write and continue.

Missing `docs/domain/index.md` is normal. Before a new decision is proposed, related decisions in the minimum relevant existing shards must be checked for dedupe, update, or no-op.

### Executable policy scenario matrix (normative)

This ordered table is the decision oracle for context harvest. Match the explicit inputs, then apply every outcome column exactly; `none` means no action. A pre-approval write returns its exact path(s) for the convergence ownership gate rather than authorizing a commit by itself.

| Scenario | Inputs | Route | Reads | Writes | Questions | Escalation | Owning task |
|---|---|---|---|---|---|---|---|
| Entry typo read-only | `phase=entry;authority=read-only;mode=typo;signal=none` | `0:direct` | `none` | `none` | `0` | `none` | `none` |
| Nano no-domain-write | `phase=entry;authority=no-domain-write;mode=nano;signal=none` | `0:direct` | `none` | `none` | `0` | `none` | `none` |
| Standalone review read-only | `phase=selected-route;authority=read-only;mode=standalone-review;signal=decision` | `2:gsd-verify` | `selected-route-evidence,relevant-supplied-domain-context` | `none` | `0` | `none` | `none` |
| Certain recurring domain term, new scope | `phase=pre-approval;authority=write-authorized;signal=term;certainty=certain;map=absent` | `5:gsd-domain-modeling` | `selected-route-evidence,targeted-term-evidence` | `docs/domain/index.md,docs/domain/<scope>.md` | `0` | `none` | `return=<write-paths>;state=pending-transfer` |
| Certain term, mapped scope | `phase=pre-approval;authority=write-authorized;signal=term;certainty=certain;map=mapped` | `5:gsd-domain-modeling` | `selected-route-evidence,docs/domain/index.md,relevant-shards,targeted-term-evidence` | `docs/domain/<scope>.md` | `0` | `none` | `return=<write-path>;state=pending-transfer` |
| Material pre-approval ambiguity | `phase=pre-approval;authority=write-authorized;signal=term;certainty=material-ambiguous;map=unresolved` | `5:gsd-domain-modeling` | `selected-route-evidence,targeted-term-evidence` | `none` | `1` | `none` | `none` |
| Fully evidenced domain decision | `phase=pre-approval;authority=write-authorized;signal=decision;reversibility=hard;surprise=yes;tradeoff=real;rationale=evidenced` | `5:gsd-domain-modeling` | `selected-route-evidence,docs/domain/index.md,relevant-shards` | `docs/domain/<scope>.md` | `0` | `none` | `return=<write-path>;state=pending-transfer` |
| Reversible preference | `phase=pre-approval;authority=write-authorized;signal=decision;reversibility=reversible` | `5:gsd-domain-modeling` | `selected-route-evidence` | `none` | `0` | `none` | `none` |
| Post-approval load-bearing ambiguity | `phase=post-approval;authority=write-authorized;signal=domain;certainty=material-ambiguous;loadBearing=yes` | `3:gsd-executing-plans` | `selected-route-evidence,targeted-domain-evidence` | `none` | `0` | `spec` | `none` |
| Post-approval non-load-bearing ambiguity | `phase=post-approval;authority=write-authorized;signal=domain;certainty=material-ambiguous;loadBearing=no` | `3:gsd-executing-plans` | `selected-route-evidence,targeted-domain-evidence` | `none` | `0` | `none` | `none` |
| Pre-approval write ownership | `phase=convergence;authority=write-authorized;intentionalWrite=yes;changedPaths=returned;ownership=assigned` | `3:gsd-to-plan` | `returned-changed-paths` | `none` | `0` | `none` | `task=<task-id>;files=<changed-paths>;commit=with-task` |

## Dynamic Sub-Skill Loading
All `gsd-*` sub-skills are loaded directly by absolute root paths from `$GSD_ROOT/skills/gsd-<target>/SKILL.md`. There is no internal registry schema, `.agents/skills/` symlink, or readlink loader fallback. A sub-skill selected directly applies its own invocation-mode table under [REFERENCE.md](REFERENCE.md) § Artifact Contract, not a blanket “missing `consumes:`” guard.
If `$GSD_ROOT` or the master skill is missing or moved, GSD must stop with an actionable error.
**Load timing:** the moment a route or trigger names `gsd-<sub>`, loading its SKILL.md from `$GSD_ROOT/skills/gsd-<sub>/SKILL.md` is the next action — before any plan, edit, or reply in that flow. Once loaded it stays in context; don't re-load per step.

## Entry — Discussion Mode
- Pastes plan/spec/diff → **stress-test**.
- Vague one-liner → **discovery**.
- Materially ambiguous → ONE disambiguating question (see Clarify principle above).
- Pure question/advisory/exploration (no code change intended) → **answer directly**; no spec/plan.
## Body
- **Discussion is where creativity lives.** Explore alternatives and resolve decisions here. Convergence ends it: the selected behavior and architecture become fixed Markdown ACs (`Outcome`, `Action`, `Expected`), invariants, non-goals, interface pins, and any load-bearing design decision. Downstream planning, execution, and verification converge on those same bound bytes; they do not recreate scope.
Recommend an answer for every question. One design branch at a time.
- **Independent Qs** → batch (each with a recommendation). **Dependent** → sequential. Never batch a dependent chain.
- **Discovery**: explore (targeted, git-scoped — see Scope discipline) → clarifying Qs → 2-3 approaches + tradeoffs + recommendation.
- **Stress-test**: break/sharpen the plan — risks, edge cases, missing decisions, hidden assumptions.
- **Right-size the recommendation**: recommend the smallest approach that meets the ask (ponytail-ladder thinking); a small ask converges to a 2-4-AC spec. Never pad a spec with speculative scope — retries, telemetry, config, abstractions nobody asked for are added when asked, not by default.
- **Pin the existing public test seam before convergence.** Inspect the test layout already relevant to the feature. Select the highest deterministic existing public interface or harness that observes the criterion through production behavior: an existing browser/CLI/HTTP boundary first, otherwise the highest existing public module API. At the same tier, first select the production entrypoint named by the criterion's `action`; then prefer the repository's canonical existing harness convention; then greater production-path coverage with no test-only bypass. A remaining tie is materially ambiguous: stop in Discussion rather than choose arbitrarily. For every active criterion, write exactly one `interfaces` row with the same `criterion` ID, its exact `seam`, repository-relative `path`, and `lower_seam_reason=none` when highest, or the concrete reason when a higher seam is absent or cannot deterministically isolate the criterion. Never invent a lower test-only interface because it is easier to exercise.

## Convergence — canonical Markdown packet
When Discovery converges, write `.scratch/<feature>/proposal.md`, `spec.md`, and conditional `design.md` under [REFERENCE.md](REFERENCE.md) § Canonical Markdown contract, then route to `gsd-to-plan`. These Markdown sources are the only pre-approval authority. Every active AC has a concrete Outcome, Action, Expected, invariant/non-goal context, and one pinned public seam. Keep unresolved or future work as one concise Discussion note; never convert it into a vague AC or task.

For an intentional approved Milestone Ledger publication, set optional `## Publication` in `spec.md` to the exact canonical ledger path; otherwise omit it or use `null`. The marker proves only planned publication intent, never completion authority. `gsd-to-plan` assigns every certain pre-approval domain write returned by `gsd-domain-modeling` to exactly one task Files field. Quick fixes carry their minimal `plan.md` only; Nano stays entirely git-free and needs no feature packet.
## Triggers (supporting skills fire automatically; lavish must *ask first*, launches only on accept)
 - `gsd-lavish` — visual surface for substantial, standalone deliverables (spec, comparison, finalized `plan.md`, verify report, audit). **You MUST proactively ask before launching, and launch only when the user accepts** (per [REFERENCE.md](REFERENCE.md) § Lavish opt-in gate taxonomy): when the deliverable is offer-eligible and the **Gate (both must hold)** clears — (1) a reviewable deliverable, not mid-conversation; AND (2) annotating it in a browser adds value — surface the option folded into the surface already shown (one numbered end-session menu choice, e.g. "Review the spec visually"; or a single inline "review this visually?" line) — never a second prompt, never a new question around plan approval. Launching the browser flow waits for the user to accept. Never auto-launch, never on inline Qs or per-task diffs. Silently skipping the offer on an eligible deliverable is the bug this fixes.
- `gsd-ponytail` — every real quick-fix entry loads the skill and short-circuits to the fast path below; Nano never loads it. **Explicit toggle**: `/gsd ponytail [lite|full|ultra]` sets `explicit_level` (omitted level = `full`), clears `auto_scope`, and acknowledges exactly `Ponytail: <level> — explicit session scope.`; "stop ponytail"/"normal mode" sets both `explicit_level=none` and `auto_scope=none` and acknowledges `Ponytail: none — normal mode.` No routing menu or follow-up prompt.
- `gsd-domain-modeling` — after routing, when already-relevant evidence reveals a durable project-specific term or evidenced decision/rationale signal → apply Conservative context harvest; missing docs or no signal is no-op.
- `gsd-codebase-design` — a module-interface / deepening decision is in play.
- `gsd-handoff` — pause/breakpoint (user-triggered or context-pressure). **Manual toggle**: `/gsd autosync [on|off]` → persist the explicit row (`autosync,on` / `autosync,off` — `off` is a remembered decline, never cleared back to unset) and acknowledge, per `gsd-handoff` § Runtime settings and § Portable and autosync. When on, only a user-requested pause/portable handoff or a completed task commit with a clean non-scratch tree auto-syncs scratch to the `wip/` remote for cross-machine resume; an automatic context-pressure handoff with uncommitted work stays machine-local.
  At a user-requested non-portable pause with autosync `on`, non-scratch dirty paths stay local without a snapshot question; sync only committed state plus scratch. Dirty-code snapshot consent exists only for an explicit portable-resume request.

## Fix fast-paths (skip the Discussion body)
- **Nano-fix** — a purely mechanical, non-behavioral change (typo, formatting, import cleanup, or a literal/rename that does not alter behavior): fix in place with no git subprocess or commit, then verify **inline** by re-reading the changed lines and running a focused non-git check when one exists ("the change does exactly what the prompt asked, nothing more"). Line count alone is insufficient, and any behavioral correction is not Nano. No git initialization/diff/stage/commit, `gsd-ponytail`, `.scratch/`, `plan.md`, `wip/` branch, or `gsd-verify` gate.
- **Quick-fix** — a real but small behavioral code fix (no design, ≤1 module, known single spot/root cause), including a one-line known-root-cause correction: load `gsd-ponytail` before changing code. Use the active `explicit_level` when it is `lite|full|ultra` and leave `auto_scope=none`; otherwise keep `explicit_level=none` and set `auto_scope=quick-fix` for this fix only. Emit exactly one cue — `Ponytail: full — scoped to this quick-fix.` for auto-fire, or `Ponytail: <level> — explicit session scope; applied to this quick-fix.` for an explicit toggle — with no menu or prompt. Then fix directly, capture `<base>` (`git branch --show-current`), write the exact minimal Markdown Quick-fix plan from [REFERENCE.md](REFERENCE.md) § Quick-fix plan exception (`# Quick-fix Plan`, Feature, Base, Tasks; every task names Files and focused Test) to `.scratch/<feature>/plan.md`, `git checkout -b wip/<feature>`, commit → `gsd-verify` (code-quality only, no convergence packet) → `<base>`. On landing/merge, a hard blocker or verify failure, or a changed/unrelated prompt, preserve `explicit_level` and set `auto_scope=none`. A later resume of the same unlanded fix reclassifies it and may set `auto_scope=quick-fix` anew; it never inherits stale auto scope. The explicit toggle, if any, remains session state until stopped. This skips the Discussion body, not the WIP/verify gate.

### Quick-fix terminal finding repair
A `Quick-fix WIP Fail` returned by `gsd-verify` re-enters the same active `gsd-verify` gate invocation; it is never fresh Quick-fix setup and never reruns the ordinary entry paragraph above. Require the complete terminal finding set and full WIP diff plus exactly one `terminal_repair_round=<1|2>` from that gate. A missing, invalid, or duplicate counter is a canonical Blocker stop, not permission to reset the loop.

Keep the existing `wip/<feature>` branch, the authoritative `## Base` value, and the unchanged minimal `plan.md`; never recapture `<base>`, never rewrite the plan, and never run `git checkout -b`. Preserve `explicit_level`, keep `auto_scope=none`, and record `QUICK_FIX_REPAIR_BASE=$(git rev-parse HEAD)` before dispatching one fresh `task` subagent with only the finding-owned repair scope, exact evidence, affected paths, and focused acceptance check. Run that focused check, then review `git diff $QUICK_FIX_REPAIR_BASE -- . ':(exclude).scratch'`; out-of-scope changes or an unresolved Critical/Important finding block. Commit only the reviewed repair, then return automatically to the same active `gsd-verify` gate with the counter unchanged, without reinitializing or incrementing it. No question or menu interrupts this repair.

## Feature cleanup
Cleanup is automated via the squash branch result scratch lifecycle terminal state machine in [REFERENCE.md](REFERENCE.md) § Squash and cleanup result marker contract. For manual drop/abandon:
"abandon/drop/delete feature X" → follow the safe flow in [REFERENCE.md](REFERENCE.md) § Feature cleanup: confirm name → `git checkout <base>` → safe-delete the `wip/` branch → remove `.scratch/<feature>/`; never force-delete unmerged work without explicit confirm; warn if `git status` is dirty.
## Conventions
`<feature>` = feature slug. Git/base/WIP/scratch mechanics are canonicalized in [REFERENCE.md](REFERENCE.md) § Git/base/WIP/scratch mechanics: Markdown packets live under `.scratch/<feature>/`, the branch is `wip/<feature>`, and `.scratch/` is git-ignored and machine-local. `<base>` is recorded in `plan.md`; portable scratch is stripped before squash.



TOON remains runtime-only: immutable task attempts, handoffs, result markers, and runtime counters/state. It never stores human-approved goals, plans, milestone ledgers, glossary prose, or architectural decisions.
Durable project documentation is strict Markdown: the canonical proposal/spec/design/plan packet, bounded-context domain knowledge under `docs/domain/`, and optional milestone ledgers under `docs/gsd/<feature>/milestones.md`.
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
