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
├── gsd-improve-codebase-architecture/ # Deepening scans & HTML reporting
│   ├── SKILL.md
│   └── HTML-REPORT.md
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

## Installation & Updates

To clean up old skills and link ONLY the `gsd` master skill (keeping the startup context lightweight):

```bash
# 1. Clean old skills
rm -rf ~/.agents/skills && mkdir -p ~/.agents/skills

# 2. Link only the gsd master entry
ln -s ~/Documents/getrich/gsd/skills/gsd ~/.agents/skills/gsd
```

### Dynamic Sub-Skill Loading
All other sub-skills (TDD, plan execution, debugging, etc.) are kept inside the `/skills/` folder of this repository. When you run `/gsd`, the agent will dynamically load the instructions of those sub-skills from your workspace as needed using the `read` tool.

### Auto-Update
Since the `gsd` skill is symlinked, any updates to the master entry in this repository (e.g. from `git pull` or manual edits) are **automatically and instantly applied** to `~/.agents/skills/gsd` without any manual commands needed.

### Vendored Tool: Lavish Editor (`tools/lavish-axi`)
The Lavish Editor CLI is tracked as a **git submodule** pointing to [kunchenguid/lavish-axi](https://github.com/kunchenguid/lavish-axi). To pull upstream changes:

```bash
git submodule update --remote tools/lavish-axi
cd tools/lavish-axi && pnpm install && pnpm run build
```

First-time clone requires initializing submodules:
```bash
git clone --recurse-submodules <repo-url>
# or after clone:
git submodule update --init --recursive
cd tools/lavish-axi && pnpm install && pnpm run build
```
