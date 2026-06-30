# Agentic Flow & Skills (GSD Core)

A complete A-to-Z autonomous agent execution flow (Discus/Grilling, Planning, Executing, Verifying/Reviewing) designed to run primarily via OMP agents. 

Inspired by:
*   [mattpocock/skills](https://github.com/mattpocock/skills) (Action-oriented, discipline-enforcing Markdown skills)
*   [lavish-axi](https://github.com/kunchenguid/lavish-axi) (HTML-first visual reporting and human-in-the-loop review)
*   [ponytail](https://github.com/DietrichGebert/ponytail) (YAGNI/lazy-senior-dev principles to minimize code bloat)
*   [open-gsd/gsd-core](https://github.com/open-gsd/gsd-core) (Meta-prompting/context-engineering framework to prevent context rot)

---

## Workspace Structure

All skills have been consolidated into the `skills/` folder and retain the `gsd-` prefix to explicitly show they are part of the GSD core execution flow:

```
skills/
├── gsd-codebase-design/              # Defining deep modules & interface design
│   ├── SKILL.md
│   ├── DEEPENING.md
│   └── DESIGN-IT-TWICE.md
├── gsd-diagnosing-bugs/              # Hard bugs & regressions diagnosis loop
│   ├── SKILL.md
│   └── scripts/hitl-loop.template.sh
├── gsd-domain-modeling/              # Aligning glossary & domain logic (CONTEXT.md)
│   └── SKILL.md
├── gsd-executing-plans/              # Task execution & subagent dispatching
│   └── SKILL.md
 ├── gsd/                              # Master Entry: routing, discussion & requirements
│   └── SKILL.md
├── gsd-handoff/                      # Handoff contracts & context compaction
│   └── SKILL.md
├── gsd-improve-codebase-architecture/ # Deepening scans & visual review
│   └── SKILL.md
├── gsd-lavish/                       # Visual HTML plan reporting & HITL
│   └── SKILL.md
├── gsd-ponytail/                     # Enforcing the YAGNI ladder & lazy code
│   └── SKILL.md
├── gsd-verify/                       # Terminal quality & compliance gate
│   └── SKILL.md
├── gsd-tdd/                          # Red-Green-Refactor & vertical slices
│   ├── SKILL.md
│   ├── tests.md
│   ├── mocking.md
│   └── refactoring.md
└── gsd-to-plan/                      # Spec decomposition & task-planning
    └── SKILL.md
```

---

## State Management & Resume Contract

To enable seamless session resuming and prevent context rot, the system operates on a structured state ledger and git isolation:

 1.  **Handoff Artifacts**: On pause, conversation context is compacted into `.scratch/<feature>/handoff-<n>.toon`. This file uses AXI's token-efficient TOON format and contains the active `mode`, `phase`, `resolved decisions`, `open questions`, `next_action`, and `skills` to reload.
 2.  **Progress Ledger**: Task plans and completion statuses are consolidated into `.scratch/<feature>/plan.toon`. The executor agent reads this ledger and `git log` on start to avoid repeating finished tasks.
 3.  **Branch Isolation**: Every feature run executes on an isolated `wip/<feature>` branch. If a session crashes or gets interrupted, the agent reconstructs the active state by comparing the git diff with the `plan.toon`.
 4.  **No Re-litigation**: Upon reading the handoff file, the agent immediately adopts the documented state and resumes from the `next_action` without re-inferring decisions or re-interviewing the user.

---

## Current State of the Project

 *   **Consolidation**: Complete. The master entry `gsd/` and all supporting sub-skills are grouped under `/skills/`.
 *   **Prefix Retention**: Complete. All directory names, skill frontmatter metadata, and internal references/cross-triggers contain the `gsd-` prefix (with the master entry named `gsd`).
*   **Branch status**: Ready for execution.

---

## Installation

Install ONLY the `gsd` master entry — the single trigger that routes and coordinates every sub-skill from context. You never install sub-skills separately:

```bash
bash install.sh
```

`install.sh` symlinks `skills/gsd` into `~/.agents/skills/gsd`, removes any stray sub-skill links from older installs, and initializes the `lavish-axi` submodule (the optional visual path — skip building it and skills degrade to terminal). Invoke `/gsd` on any prompt; it routes internally and loads the right sub-skill on demand.

### How sub-skills load (cross-project)
Sub-skills are NOT registered skills — they live as siblings of `gsd` in this repo. `/gsd` finds them by resolving its own symlink, so it works from any working directory:

```bash
SKILLS_DIR="$(dirname "$(readlink ~/.agents/skills/gsd)")"   # → …/this-repo/skills
```

then reads `$SKILLS_DIR/gsd-<sub>/SKILL.md`. No sub-skill registration needed.

### Auto-Update
`gsd` is symlinked, so any edit or `git pull` here applies instantly. Re-run `bash install.sh` only if you move the repo.

### Vendored Tool: Lavish Editor (`tools/lavish-axi`)
The Lavish Editor CLI is tracked as a **git submodule** pointing to [kunchenguid/lavish-axi](https://github.com/kunchenguid/lavish-axi). To pull upstream changes:

```bash
git submodule update --remote tools/lavish-axi
cd tools/lavish-axi && pnpm install && pnpm run build
```

`bash install.sh` initializes the submodule for you. The visual path is opt-in — to enable it, build the CLI once (skills degrade to terminal if you don't):
```bash
cd tools/lavish-axi && pnpm install && pnpm run build
```
