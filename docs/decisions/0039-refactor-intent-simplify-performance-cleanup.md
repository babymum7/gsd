# 0039 — Refactor keeps intent, simplifies, measures performance, and cleans up first

- **Status:** Accepted
- **Date:** 2026-10-25

## Decision

`gsd-refactor` reads the README, `AGENTS.md`, `docs/decisions/`, and the domain docs before measuring, and lists the repository's goals and deliberate choices. A finding that contradicts an accepted decision or a stated goal is shown as reopening that decision and is never planned on its own.

A Simplify finding names hand-written code the standard library, a platform feature, or an installed dependency already covers, abstraction with a single user, and configuration nothing sets, with line counts before and after.

Each performance change is its own task: a test pins its output, and a reproducible benchmark or profile at one seam is recorded before and after. The change stays only when the gain is clearly beyond run-to-run noise.

Approved cleanup rows are approved in `gsd-cleanup`'s form and removed by its Run section as the first part. Parts run cleanup first, then the refactor parts, then performance.

## Rationale

The owner asked for a repository that is as clean, small, and fast as possible while keeping its goals and character. Deliberate choices, such as intentional duplication or a slower but simpler path, look like defects to a measurement pass, so intent outranks a finding. Removing dead code first shrinks what needs characterization tests and moves, and a benchmark taken after the structure settles is not invalidated by a later move. An optimization without numbers adds complexity with no proof it helps.
