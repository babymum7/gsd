# 0021 — Lean six-skill surface

- **Status:** Accepted
- **Date:** 2026-09-19

## Decision

GSD's visible skill surface is reduced from nine skills to six primary owners: `gsd-brainstorming`, `gsd-to-plan`, `gsd-executing-plans`, `gsd-verify`, `gsd-handoff`, and `gsd-diagnosing-bugs`. `gsd-codebase-architecture`, `gsd-domain-modeling`, and `gsd-tdd` remain in the repository as hidden internal references rather than visible catalog entries. The injected bootstrap is capped at 800 words so ordinary prompts stay cheap while deep architecture, domain, and TDD guidance remains available on demand.
