# 0021 — Lean six-skill surface

- **Status:** Accepted
- **Date:** 2026-09-19

## Decision

GSD's visible skill surface is reduced from nine skills to six primary owners: `gsd-brainstorming`, `gsd-to-plan`, `gsd-executing-plans`, `gsd-verify`, `gsd-handoff`, and `gsd-diagnosing-bugs`. `gsd-codebase-architecture`, `gsd-domain-modeling`, and `gsd-tdd` remain in the repository as hidden internal references rather than visible catalog entries. The injected bootstrap is capped at 800 words so ordinary prompts stay cheap while deep architecture, domain, and TDD guidance remains available on demand.

## Amendment

Amended 2026-10-05. Decision 0027 removed `gsd-handoff`, so the visible surface is five skills, and
the bootstrap cap is now 450 words (`test/bootstrap-first-action.test.js`). Keeping the
architecture, domain, and TDD guidance hidden and read on demand stands.

Amended again 2026-10-05. `gsd-to-plan` is now a hidden reference too: `gsd-brainstorming` reads it
by path once acceptance converges, and an unbound draft plan to finalize routes to
`gsd-brainstorming`. The visible surface is four skills. Each skill now opens with its trigger and
handoff instead of restating its canon matrix row, canon § Contextual disclosure templates and the
matrix's Helper-when column are gone, and the quick-fix route covers mechanical refactors,
docs-only edits, and version bumps proven by the existing suite or build.
