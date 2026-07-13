# Agentic Flow & Skills (GSD Core)

A complete A-to-Z autonomous agent execution flow (Discussion/Grilling, Planning, Executing, Verifying/Reviewing) designed to run primarily via OMP agents.

Inspired by:
*   [mattpocock/skills](https://github.com/mattpocock/skills) (Action-oriented, discipline-enforcing Markdown skills)
*   [lavish-axi](https://github.com/kunchenguid/lavish-axi) (HTML-first visual reporting and human-in-the-loop review)
*   [ponytail](https://github.com/DietrichGebert/ponytail) (YAGNI/lazy-senior-dev principles to minimize code bloat)
*   [open-gsd/gsd-core](https://github.com/open-gsd/gsd-core) (Meta-prompting/context-engineering framework to prevent context rot)

---

## Installation

Install the GSD command for OMP. You never install sub-skills separately:

```bash
bash install.sh
```

`install.sh` registers the GSD master entry point as a user command under `~/.omp/agent/commands/gsd.md` (which maps `/gsd`), cleans up legacy skill symlinks, creates the single direct symlink `~/.omp/agent/extensions/gsd-context.js` to the current checkout’s tracked `extensions/gsd-context.js` (with no wrapper; unmanaged existing files or symlinks to other sources fail closed as collisions), refreshes every configured git submodule from its remote tip with a detached checkout (`git submodule update --init --remote --checkout --recursive`), and — when `pnpm` is available — rebuilds the optional lavish visual path when the submodule tip changed or `dist/cli.mjs` is missing (no pnpm, network/git failure, or a failed build → skills degrade to terminal). Install never commits the parent submodule pointer. The command supplies the absolute `GSD_ROOT` path, allowing GSD to load all master and sub-skills directly from the checkout. Invoke `/gsd` on any prompt; it routes internally. Start a new OMP session after install or update to load the extension and updated command.

You only ever type `/gsd` (plus what you want, in plain language). The `/gsd-<sub>` names that appear in the skills are the agent's own internal calls after it routes — never commands you invoke yourself.
---

## The complete feature flow

One feature, from idea to merged commit. You drive it with plain language; the agent routes.

```mermaid
flowchart LR
    U["/gsd 'build X'"] --> D[Discussion<br/>questions + recommendation]
    D -->|converges| P[plan.md<br/>acceptance criteria + task headings + inline summary]
    P -->|"approve (last prompt)"| E[Execute<br/>per-task loop on wip/]
    E --> V[Verify<br/>full-diff review + E2E]
    V -->|pass| M[squash → base]
    V -.fail.-> E
    V -.plan flawed.-> D
```

### 1. Discuss — `/gsd build feature X`
New work routes to **Discussion**. The agent explores the codebase (targeted, git-scoped — no tree-wide crawling), asks clarifying questions only when the answer changes route/scope/action, stress-tests the idea (risks, edge cases, missing decisions), and recommends the **smallest approach that meets the ask** — a small ask converges to a 2–4-AC plan, never padded with retries/telemetry/config nobody asked for.

When you pick an approach and open questions close, the agent writes `.scratch/<feature>/plan.md`. This human-readable Markdown source carries checkable ACs with a concrete action and expected observable result. A vague AC returns to Discussion; downstream stages read the exact same approved bytes. Large work splits into milestone features, each with its own cycle.
### 2. Plan — automatic, summarized inline
`gsd-to-plan` validates the converged plan and writes `.scratch/<feature>/plan.md`: ordered tasks with exact AC ownership, files, focused public-seam tests, and status. It prints the inline summary, records the SHA-256 hash for the plan.md source, then asks one approval question. Approval is the last prompt of the cycle and immediately writes the first immutable execution handoff containing that binding, so execution and crash recovery never depend on conversation memory.

### 3. Execute — per-task loop, hands-free
Once approved, `gsd-executing-plans` creates `wip/<feature>` from the Base recorded in `plan.md`, then for each task — no questions, no menus, just progress reports:

1. **Dispatch** a fresh immutable JIT attempt TOON packet bound to the approved Markdown hashes.
2. **TDD** (`gsd-tdd`): one behavior test through the public interface → minimal code → green.
3. **Review and acceptance**: the reviewer checks task compliance and code quality; targeted runnable acceptance proves the AC.
4. **Commit and handoff**: commit green task-owned changes and record completion/next action in a fresh immutable runtime handoff; the approved Markdown packet remains unchanged.

Interrupt any time — immutable runtime handoffs plus `git log` mean a resumed session never redoes finished work.

`gsd-verify` reviews the **whole branch diff** against the plan: every non-superseded AC met (plan-compliance) + universal code-quality, then the project's full build+test suite, then an **acceptance/E2E gate** — the end-to-end user path for user-facing features (real user path via browser or script) *plus* an acceptance check for every non-superseded AC that is runtime-observable, absorbing any per-task `Acceptance Check: deferred`. Any Critical/Important finding, red suite, or failing acceptance/E2E **blocks the merge** — the pipeline stops and reports, never merging past a red gate. Pass → squash to a single commit on your base branch **automatically** (findings, build/E2E outcome, and the final commit are still reported); session artifacts never land there. An automated terminal state machine handles the squash commit, force-with-lease remote cleanup, local branch deletion, and writes a canonical `result.toon` marker to `.scratch/` to manage the post-merge lifecycle and block any implementation resume.

### 5. Next steps
Outside the post-approval pipeline, every response ends with numbered, non-technical choices — reply with a number:

```
Next steps (reply with number or text):
1. Generate the implementation plan
2. Audit codebase architecture
3. Pause & Save progress
```

After you approve the plan, no menu appears until the feature merges (or a hard blocker — plan flawed, unresolvable conflict, red gate — stops the run and reports why).

---

## Other entry paths

| You say | What happens |
|---|---|
| "fix this typo" | **Nano-fix** — in-place, completely git-free fix; no scratch, branch, commit, or gate |
| "fix this small bug" | **Quick-fix** — ponytail mindset, minimal `plan.md`, `wip/` branch, code-quality verify only |
| "review this diff/PR" | Standalone review — read-only, two verdicts, no merge mechanics |
| "why does X crash?" (hard bug) | `gsd-diagnosing-bugs` — feedback-loop-first diagnosis discipline |
| "audit the architecture" | `gsd-improve-codebase-architecture` — deepening opportunities, you pick one |
| "continue" / "resume" | Reads the latest handoff and picks up exactly where it stopped |
| "pause" / "save progress" | `gsd-handoff` — compacts state to `.scratch/<feature>/handoff-<n>.toon` |
| "abandon feature X" | Safe cleanup — confirm, delete `wip/` branch safely, remove scratch |

**Toggles** (persist across sessions via handoff `settings[]`):
- `/gsd ponytail lite|full|ultra` · `stop ponytail` — force the laziest solution that works.
- `/gsd autosync on|off` — tri-state: unset asks once at the first user-requested pause when a remote exists; `on` syncs only at safe sync points; `off` is a remembered decline with no re-ask. See cross-machine below.

---

## Working across machines

`.scratch/` is **git-ignored and machine-local** by default — that's what keeps multi-feature routing and branch switching safe. At the **first user-requested pause** with a remote configured and autosync unset, the agent asks once — *"Sync to the remote so you can resume on another machine? (yes / no / always)"*. `always` persists autosync `on`, but synchronization still occurs only at the safe points below. Two mechanisms underneath:

**Explicit portable handoff** — say "pause, I'll continue on my laptop": the agent writes the handoff and lists any uncommitted mid-task paths. It asks exactly *"Snapshot these listed paths before portable sync? (yes / no)"*; only `yes` creates a `wip snapshot` commit, while `no` leaves those dirty paths local. It then syncs scratch and committed WIP state onto the WIP branch (force-add + pathspec'd commit, unconditional push). On the other machine, `/gsd continue` fetches, finds `origin/wip/<feature>`, and checks it out. At merge time the verify gate strips scratch, so nothing under `.scratch/` lands on the base branch.

**Autosync** — `on` runs only at safe sync points: a user-requested pause or portable handoff, or a completed task commit with a clean non-scratch tree. If the tree is dirty at a completed-task boundary, sync and push are deferred locally without asking. An automatic context-pressure handoff during uncommitted task work also stays machine-local even when autosync is `on`; a user-requested portable pause uses the exact snapshot consent above. `off` records the decline and never asks again (`/gsd autosync on` re-enables). No remote means machine-local operation with an explicit notice. The choice travels in the handoff's `settings[]`, so it survives the switch.
A user-requested non-portable pause never snapshots unrelated work: dirty paths stay local without a snapshot question, and autosync carries only committed state plus scratch. The dirty-snapshot question is reserved for an explicit portable-resume request.

---

## State Management & Resume Contract

1.  **Handoff Artifacts**: On pause, conversation context is compacted into `.scratch/<feature>/handoff-<n>.toon` — active `mode`, `phase`, resolved decisions, open questions, `next_action`, skills to reload, and active toggles (`settings[]`).
2.  **Runtime progress**: Immutable attempt and handoff TOON records completed tasks, verified evidence, and next action; the approved Markdown packet remains byte-for-byte unchanged.
3.  **Branch Isolation**: Every feature runs on an isolated `wip/<feature>` branch; the squash merge delivers exactly one commit to base.
4.  **No Re-litigation**: On resume the agent verifies the Markdown source binding, adopts runtime state, and jumps to `next_action`.
5.  **Broken/missing state**: Missing, malformed, or hash-mismatched packet state is a Plan escalation; runtime state never reconstructs human requirements.
6.  **Milestone Ledger**: Large features split work through the human-readable `docs/gsd/<feature>/milestones.md` contract. Non-final milestones update only the current row from `pending` to `done`; the final milestone atomically deletes the ledger in the same green squash commit, so an all-done ledger never remains.

---

## Workspace Structure

```
skills/
├── gsd/                              # Master Entry: routing, discussion & requirements
│   ├── SKILL.md
│   └── REFERENCE.md                  # Load-on-demand payloads (plan template, milestones, cleanup)
├── gsd-to-plan/                      # Plan decomposition & task-planning
├── gsd-executing-plans/              # Task execution & subagent dispatching
├── gsd-verify/                       # Terminal quality & compliance gate
├── gsd-handoff/                      # Handoff contracts, portable/autosync cross-machine sync
├── gsd-tdd/                          # Red-Green-Refactor & vertical slices (+ tests/mocking/refactoring docs)
├── gsd-ponytail/                     # Enforcing the YAGNI ladder & lazy code
├── gsd-diagnosing-bugs/              # Hard bugs & regressions diagnosis loop
├── gsd-domain-modeling/              # Bounded-context glossary & decisions (docs/domain/*.md)
├── gsd-codebase-design/              # Defining deep modules & interface design
├── gsd-improve-codebase-architecture/ # Deepening scans & architecture audits
└── gsd-lavish/                       # Visual HTML reporting & HITL (opt-in)
```

All sub-skills carry a **direct-invocation guard** — selected standalone with their consumed artifacts missing, they route back through `/gsd` instead of improvising. Since the OMP command supplies the absolute `GSD_ROOT`, GSD loads master and sub-skills directly by absolute path from the checkout.

### Auto-Update
All master and sub-skills are loaded directly from the checkout path, so any edit or `git pull` of GSD skill text applies instantly. Re-run `bash install.sh` after moving the repo, or whenever you want install to refresh vendored tool submodules from upstream, update the `~/.omp/agent/extensions/gsd-context.js` symlink to the current checkout's tracked `extensions/gsd-context.js`, and rebuild lavish when needed. Start a new OMP session after install or update so OMP loads the extension.
### Vendored Tool: Lavish Editor (`tools/lavish-axi`)
The Lavish Editor CLI is tracked as a **git submodule** pointing to [kunchenguid/lavish-axi](https://github.com/kunchenguid/lavish-axi). **Primary path:** `bash install.sh` updates configured submodules from remote (detached checkout) and rebuilds the CLI when the tip SHA changes or `dist/cli.mjs` is missing and `pnpm` is available. That may leave the parent repo's submodule gitlink dirty until you choose to commit a pin — install never auto-commits it.

No pnpm? Build once manually (skills degrade to terminal until then):

```bash
cd tools/lavish-axi && pnpm install && pnpm run build
```

Optional manual pin (refresh upstream and commit the parent gitlink yourself — install never does this):

```bash
git submodule update --init --remote --checkout tools/lavish-axi
cd tools/lavish-axi && pnpm install && pnpm run build && cd ../..
git add tools/lavish-axi
git commit -m "Pin tools/lavish-axi submodule tip"
```

### Tests
The skill set is a **string contract** — the suite pins routing rules, artifact formats, gates, and degradation paths:

```bash
node --test test/*.test.js
```

A second, **opt-in** harness proves a model *reading* the master skill actually routes correctly: 31 workspace-state + prompt fixtures, checked in two modes (`classify` — explicit pre-route decision plus nullable route/skill as JSON; `trace` — the literal `Route N → gsd-*` first line when the decision reaches numbered routing). It calls an OpenAI-compatible endpoint and is never part of `node --test`:

```bash
GSD_EVAL_KEY=sk-... node test/eval/route-eval.mjs   # GSD_EVAL_URL / GSD_EVAL_MODEL to override
```
