---
name: gsd-cleanup
description: "Explicit only: inventory junk files, unreferenced files, dead code, and unused dependencies with evidence, approve once, then remove them."
disable-model-invocation: true
disableModelInvocation: true
produces: [plan.md]
consumes: []
---

# Cleanup

Runs only when the user asks for it: `/gsd:gsd-cleanup`, or a request to clean up this repository. Works in any Git repository, with or without GSD. Nothing is deleted before the one approval below, and nothing outside the approved list is ever deleted.

## Inventory

Read-only. For broad repositories, spawn one read-only scout sub-agent (the bootstrap's `scout` profile when listed) per area, and re-check every finding you keep.

- **Junk files:** tracked build outputs, logs, temp and backup files (`*.orig`, `*.rej`, `*.bak`, `*.tmp`, `*~`, `.DS_Store`, editor swap files), stray one-off scripts, and generated files committed by mistake. List untracked and ignored paths with `git status --porcelain --ignored`; never open a file that may hold secrets (`.env`, keys, local databases).
- **Unreferenced files:** a tracked file that no import, build or CI config, package script, Dockerfile, route convention, doc link, or test names. Prove it with a search for its path and basename across the repository.
- **Dead code and dependencies:** use the repository's own ecosystem tool when it is installed or its package manager runs it without changing tracked files: `knip` for JavaScript and TypeScript, `deadcode` (golang.org/x/tools) for Go, `cargo machete` for Rust, `vulture` for Python. Otherwise rely on search evidence.
- **Stale leftovers:** commented-out code blocks, unused config keys and environment variables, unused feature flags, merged local branches (`git branch --merged`), and in a GSD repository `.scratch/` folders that hold no `state.toon`, which are listed as doubtful and left unselected. A packet with a `state.toon` is never a candidate.

A tool's "unused" is a candidate, not proof: reflection, dynamic imports, framework file conventions, plugins loaded by name, build tags, and a library's public API all hide real callers. Keep a candidate only when a search confirms nothing uses it.

## Approval

Present one list, grouped by action (delete file, remove code, remove dependency, untrack and ignore, delete branch). Each row gives the path or symbol, the evidence, and your recommendation; doubtful rows are marked and left unselected. In the same message ask the Delivery question from `gsd-brainstorming`. The user approves all, a subset, or an edited list once; after that the run asks nothing more.

## Run

- **Tracked changes** (deleted files, removed code, removed dependencies with their lockfile updated by the package manager, files untracked and ignored) become one plan: read `GSD_ROOT/skills/gsd-to-plan/SKILL.md` and plan feature `cleanup-<area>`, each criterion stating that the repository's build, lint, and tests stay green with the item gone, and the approved Delivery recorded. Then follow `gsd-executing-plans` and `gsd-verify` to the end.
- **Approved untracked or ignored paths** have no diff, so they are removed outside the plan, with `rm` on each named path only, and listed in the final report. Never run `git clean`, and never remove a path the approval did not name.
- Without GSD in the repository, add `.scratch/` to `.git/info/exclude` before writing the plan, so the cleanup itself adds no tracked file.

The final report lists what was removed, what was skipped and why, and any decision made on the way.
