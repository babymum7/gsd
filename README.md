# Agentic Flow & Skills (GSD Core)

A complete A-to-Z autonomous agent execution flow (Discussion/Grilling, Planning, Executing, Verifying/Reviewing) designed to run primarily via OMP agents.

Inspired by:
*   [mattpocock/skills](https://github.com/mattpocock/skills) (Action-oriented, discipline-enforcing Markdown skills)
*   [lavish-axi](https://github.com/kunchenguid/lavish-axi) (HTML-first visual reporting and human-in-the-loop review)
*   [ponytail](https://github.com/DietrichGebert/ponytail) (YAGNI/lazy-senior-dev principles to minimize code bloat)
*   [open-gsd/gsd-core](https://github.com/open-gsd/gsd-core) (Meta-prompting/context-engineering framework to prevent context rot)

---

## Installation

Install ONLY the `gsd` master entry — the single trigger that routes and coordinates every sub-skill from context. You never install sub-skills separately:

```bash
bash install.sh
```

`install.sh` symlinks **every** `skills/gsd*` directory into `~/.agents/skills/` (master + all sub-skills), initializes the `lavish-axi` submodule, and — when `pnpm` is available — builds the optional visual path automatically (no pnpm or a failed build → skills degrade to terminal). Registering all skills lets the agent load `skill://gsd-<sub>` directly — no path-resolution turn. Invoke `/gsd` on any prompt; it routes internally.

You only ever type `/gsd` (plus what you want, in plain language). The `/gsd-<sub>` names that appear in the skills are the agent's own internal calls after it routes — never commands you invoke yourself.

---

## The complete feature flow

One feature, from idea to merged commit. You drive it with plain language; the agent routes.

```mermaid
flowchart LR
    U["/gsd 'build X'"] --> D[Discussion<br/>questions + recommendation]
    D -->|converges| S[spec.md<br/>acceptance criteria]
    S --> P[plan.toon<br/>task table + inline summary]
    P -->|"approve (last prompt)"| E[Execute<br/>per-task loop on wip/]
    E --> V[Verify<br/>full-diff review + E2E]
    V -->|pass| M[squash → base]
    V -.fail.-> E
    V -.spec flawed.-> D
```

### 1. Discuss — `/gsd build feature X`
New work routes to **Discussion**. The agent explores the codebase (targeted, git-scoped — no tree-wide crawling), asks clarifying questions only when the answer changes route/scope/action, stress-tests the idea (risks, edge cases, missing decisions), and recommends the **smallest approach that meets the ask** — a small ask converges to a 2–4-AC spec, never padded with retries/telemetry/config nobody asked for.

When you pick an approach and open questions close, the agent writes `.scratch/<feature>/spec.md` — context plus **checkable acceptance criteria** (`AC-1`, `AC-2`, …). This file is the contract every downstream stage reads. A large feature (would exceed ~10 tasks) is split into milestone specs (`<feature>-m1`, `-m2`, …), each running its own full cycle.

### 2. Plan — automatic, summarized inline
`gsd-to-plan` turns the converged spec into `.scratch/<feature>/plan.toon` — a token-efficient task table (`id, task, satisfies, files, test, status`). Rows are pointers, not payloads: detail lives in the spec; every AC must appear in some task's `satisfies`. Docs/comments-only tasks get `test:none`; anything that alters runtime behavior names a test.

Right after writing the file, the agent prints an **inline plan summary** (one line per task + AC coverage) — you never open `plan.toon` — and asks **one approval question**. That approval is the **last prompt of the cycle**: everything after it runs hands-free.

### 3. Execute — per-task loop, hands-free
Once the plan is approved, `gsd-executing-plans` creates `wip/<feature>` (capturing your current branch as `base:` in `plan.toon`), then for each task — no questions, no menus, just progress reports:

1. **Dispatch** a fresh implementer subagent with just that task's brief.
2. **TDD** (`gsd-tdd`): one behavior test through the public interface → minimal code → green.
3. **Review**: a reviewer subagent checks the task diff — task-compliance AND code-quality. Critical/Important findings loop back until fixed.
4. **Commit** to `wip/<feature>` (code only) and mark the task `done` in the ledger.

Interrupt any time — the ledger plus `git log` mean a resumed session never redoes finished work.

### 4. Verify — the merge gate, auto-merge on pass
`gsd-verify` reviews the **whole branch diff** against the spec: every non-superseded AC met (spec-compliance) + universal code-quality, then the project's full build+test suite, then an **E2E gate** for user-facing features (real user path via browser or script). Any Critical/Important finding, red suite, or failing E2E **blocks the merge** — the pipeline stops and reports, never merging past a red gate. Pass → squash to a single commit on your base branch **automatically** (findings, build/E2E outcome, and the final commit are still reported); session artifacts never land there.

### 5. Next steps
Outside the post-approval pipeline, every response ends with numbered, non-technical choices — reply with a number:

```
Next steps (reply with number or text):
1. Generate the implementation plan
2. Audit codebase architecture
3. Pause & Save progress
```

After you approve the plan, no menu appears until the feature merges (or a hard blocker — spec flaw, unresolvable conflict, red gate — stops the run and reports why).

---

## Other entry paths

| You say | What happens |
|---|---|
| "fix this typo" | **Nano-fix** — in-place fix on the current branch; no scratch, no branch, no gate |
| "fix this small bug" | **Quick-fix** — ponytail mindset, minimal `plan.toon`, `wip/` branch, code-quality verify only |
| "review this diff/PR" | Standalone review — read-only, two verdicts, no merge mechanics |
| "why does X crash?" (hard bug) | `gsd-diagnosing-bugs` — feedback-loop-first diagnosis discipline |
| "audit the architecture" | `gsd-improve-codebase-architecture` — deepening opportunities, you pick one |
| "continue" / "resume" | Reads the latest handoff and picks up exactly where it stopped |
| "pause" / "save progress" | `gsd-handoff` — compacts state to `.scratch/<feature>/handoff-<n>.toon` |
| "abandon feature X" | Safe cleanup — confirm, delete `wip/` branch safely, remove scratch |

**Toggles** (persist across sessions via handoff `settings[]`):
- `/gsd ponytail lite|full|ultra` · `stop ponytail` — force the laziest solution that works.
- `/gsd autosync on|off` — tri-state: unset asks once at first pause, `on` always syncs, `off` = remembered decline. See cross-machine below.

---

## Working across machines

`.scratch/` is **git-ignored and machine-local** by default — that's what keeps multi-feature routing and branch switching safe. You never need to remember a special phrase: the **first time you pause** (with a remote configured and autosync unset), the agent asks once — *"Sync to the remote so you can resume on another machine? (yes / no / always)"* — answer `always` and every future "pause" syncs automatically. Two mechanisms underneath:

**Explicit portable handoff** — say "pause, I'll continue on my laptop": the agent writes the handoff, surfaces any uncommitted mid-task code (with your approval it becomes a `wip snapshot` commit, erased later by the squash), then syncs scratch onto the WIP branch (force-add + pathspec'd commit, unconditional push). On the other machine, `/gsd continue` fetches, finds `origin/wip/<feature>`, checks it out — code, scratch, and approved in-flight work all materialize. At merge time the verify gate strips scratch, so nothing ever lands on your base branch.

**Autosync** — answer `always` at the ask-once (or `/gsd autosync on` anytime), then forget it: after every pause *and* after every completed task, scratch re-syncs and `wip/<feature>` is pushed. Answering `no` records the decline and never asks again (`/gsd autosync on` re-enables). Sync points are pauses and task boundaries — close the laptop mid-task **without pausing** and the other machine resumes from the last pushed task; pausing surfaces in-flight code and offers the snapshot (never committed without your OK). Requires a git remote (absent → stays machine-local and says so). The choice travels in the handoff's `settings[]`, so it holds after the switch.

---

## State Management & Resume Contract

1.  **Handoff Artifacts**: On pause, conversation context is compacted into `.scratch/<feature>/handoff-<n>.toon` — active `mode`, `phase`, resolved decisions, open questions, `next_action`, skills to reload, and active toggles (`settings[]`).
2.  **Progress Ledger**: Task plans and completion statuses live in `.scratch/<feature>/plan.toon` (`schema:v1`, `base:<branch>`). The executor reads this ledger plus `git log` on start and never redoes finished tasks.
3.  **Branch Isolation**: Every feature runs on an isolated `wip/<feature>` branch; the squash merge delivers exactly one commit to base.
4.  **No Re-litigation**: On resume the agent adopts the documented state and jumps to `next_action` — no re-inferring decisions, no re-interviewing.
5.  **Broken/missing state**: With no handoff, the agent reconstructs from durable artifacts — `plan.toon` (intended), `git log` (committed), `git status`/`diff` (uncommitted), `spec.md` (intent) — and resumes at the divergence.

---

## Workspace Structure

```
skills/
├── gsd/                              # Master Entry: routing, discussion & requirements
│   ├── SKILL.md
│   └── REFERENCE.md                  # Load-on-demand payloads (spec template, milestones, cleanup)
├── gsd-to-plan/                      # Spec decomposition & task-planning
├── gsd-executing-plans/              # Task execution & subagent dispatching
├── gsd-verify/                       # Terminal quality & compliance gate
├── gsd-handoff/                      # Handoff contracts, portable/autosync cross-machine sync
├── gsd-tdd/                          # Red-Green-Refactor & vertical slices (+ tests/mocking/refactoring docs)
├── gsd-ponytail/                     # Enforcing the YAGNI ladder & lazy code
├── gsd-diagnosing-bugs/              # Hard bugs & regressions diagnosis loop
├── gsd-domain-modeling/              # Aligning glossary & domain logic (CONTEXT.md)
├── gsd-codebase-design/              # Defining deep modules & interface design
├── gsd-improve-codebase-architecture/ # Deepening scans & architecture audits
└── gsd-lavish/                       # Visual HTML reporting & HITL (opt-in)
```

All skills are registered, but `/gsd` is the orchestrator: sub-skills carry a **direct-invocation guard** — selected standalone with their consumed artifacts missing, they route back through `gsd` instead of improvising. Partial/old installs degrade gracefully: `gsd` resolves its own symlink and reads siblings directly:

```bash
SKILLS_DIR="$(dirname "$(readlink ~/.agents/skills/gsd)")"   # → …/this-repo/skills
```

### Auto-Update
All skills are symlinked, so any edit or `git pull` here applies instantly. Re-run `bash install.sh` only if you move the repo or a new sub-skill directory appears.

### Vendored Tool: Lavish Editor (`tools/lavish-axi`)
The Lavish Editor CLI is tracked as a **git submodule** pointing to [kunchenguid/lavish-axi](https://github.com/kunchenguid/lavish-axi). `bash install.sh` initializes the submodule and builds the CLI automatically when `pnpm` is available. No pnpm? Build once manually (skills degrade to terminal until then):

```bash
cd tools/lavish-axi && pnpm install && pnpm run build
```

To pull upstream changes:

```bash
git submodule update --remote tools/lavish-axi
cd tools/lavish-axi && pnpm install && pnpm run build
```

### Tests
The skill set is a **string contract** — the suite pins routing rules, artifact formats, gates, and degradation paths:

```bash
node --test test/skills.test.js
```

A second, **opt-in** harness proves a model *reading* the master skill actually routes correctly: 13 workspace-state + prompt fixtures, checked in two modes (`classify` — route/skill decision as JSON; `trace` — the literal `Route N → gsd-*` first line). It calls an OpenAI-compatible endpoint and is never part of `node --test`:

```bash
GSD_EVAL_KEY=sk-... node test/eval/route-eval.mjs   # GSD_EVAL_URL / GSD_EVAL_MODEL to override
```
