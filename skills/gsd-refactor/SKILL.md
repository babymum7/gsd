---
name: gsd-refactor
description: "Explicit only: measure code quality, write agent rules into lint config and AGENTS.md, set up GSD when missing, then run a behavior-preserving refactor."
disable-model-invocation: true
disableModelInvocation: true
produces: [AGENTS.md, plan.md]
consumes: [AGENTS.md, CLAUDE.md, docs/domain/index.md]
---

# Refactor

Runs only when the user asks for it: `/gsd:gsd-refactor`, or a request to refactor this repository. Works in any Git repository, with or without GSD. It leaves two things behind: code that behaves the same but is easier to change, and rules that keep the next agent from undoing it.

## Measure

Read-only. Detect the stack from its manifests (`package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, and so on) and the repository's own linter, formatter, build, and test commands. For broad repositories, spawn one read-only scout sub-agent (the bootstrap's `scout` profile when listed) per area, and re-check every finding you keep. Each finding names paths and numbers:

- **Size:** the largest files and functions, against the linter's own defaults for file length, function length, and complexity.
- **Complexity:** deep nesting, long parameter lists, and branching hot spots, from the linter in report-only mode when it has such rules.
- **Hard-coding:** magic numbers, repeated literals, URLs, hosts, credentials, and environment-specific paths that belong in config or named constants.
- **Duplication:** repeated logic that one shared function or module should own.
- **Performance:** only on hot paths with evidence: queries inside loops, unbounded reads, missing pagination, blocking I/O in request paths, work recomputed on every render.
- **Organization:** files mixing concerns, layers reaching past each other, circular imports, and folders that will not scale as features grow; on the frontend, components that fetch, transform, and render at once.
- **Tests:** redundant tests (the same behavior asserted twice), tests pinned to implementation details instead of public behavior, slow tests in the fast suite, and refactor targets with no test at their public seam.
- **Leftovers:** the Inventory section of `GSD_ROOT/skills/gsd-cleanup/SKILL.md`.

For module boundaries and deepening candidates, read `GSD_ROOT/skills/gsd-codebase-architecture/SKILL.md`.

## Rules

- **Lint config:** every rule a tool can check goes into the repository's existing linter config. Confirm each rule name and option against the installed tool before writing it (`biome explain <rule>`, `ruff rule <code>`, `golangci-lint linters`, `npx eslint --print-config <file>`); never write a rule name from memory. Pick thresholds the code meets once the refactor lands. Adding a new linter is part of the approval.
- **`AGENTS.md`:** everything else goes into one `## Code quality` section, upserted once and kept short: one checkable rule per line, naming this repository's folders, config locations, and commands. Cover where new files go, where config and secrets live instead of literals, the hot-path performance rules, how tests are written (public seams, no duplicates), and backend and frontend specifics. Never duplicate what the linter already enforces.
- **`CLAUDE.md`:** some agents read only `CLAUDE.md`, so it must import the rules with a line `@AGENTS.md`. When one of the two files is a symlink to the other, write the section once into the real file and add no import. When only `CLAUDE.md` exists, create `AGENTS.md` with the section and add the import. When neither exists, create `AGENTS.md` and a `CLAUDE.md` holding only the import.

## GSD setup

When the repository has no GSD conventions yet: add `.scratch/` to `.gitignore`, upsert the `## Decisions` and `## Design` sections in `AGENTS.md` under `GSD_ROOT/skills/gsd/REFERENCE.md` § Durable decision and design records, and offer a domain bootstrap once by reading `GSD_ROOT/skills/gsd-domain-modeling/SKILL.md`; a decline ends the topic.

## Approval

Present in one message: the findings ranked by impact with their evidence, the proposed lint changes and the `## Code quality` text, the GSD setup, the cleanup candidates, the refactor split into parts, and the Delivery question from `gsd-brainstorming`. The user approves or edits once; after that the run asks nothing more.

## Run

- A refactor changes structure, never behavior: no feature or bug fix rides along. Before a target changes, a characterization test at its public seam pins its current behavior; the existing suite stays green after every task.
- Read `GSD_ROOT/skills/gsd-to-plan/SKILL.md` and plan feature `refactor-<area>`. The first task writes the rules files and the GSD setup; each lint rule lands in the task that makes the code pass it. Each criterion is a GIVEN/WHEN/THEN at a public seam showing behavior unchanged, or a lint rule passing.
- Several areas become parts as `gsd-brainstorming` describes, all converged in this one approval and run back to back.
- Then follow `gsd-executing-plans` and `gsd-verify` to the end and deliver as approved.

The final report lists the rules added, the refactors done with their measured before and after, and any decision made on the way.
