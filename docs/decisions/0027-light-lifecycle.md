# 0027 — Light lifecycle: suggestive routing, parts, light validation, cross-repo

- **Status:** Accepted
- **Date:** 2026-09-26

## Decision

GSD keeps one pipeline (`gsd-brainstorming` -> `gsd-to-plan` -> `gsd-executing-plans` -> `gsd-verify`) plus `gsd-diagnosing-bugs`, and makes every step lighter. A quick fix is a direct edit plus a test, with no skill.

- **Routing is suggestive.** The bootstrap names which skill fits each intent and forces no first action. Triage has five routes: answer, clarify, research, quick, plan. The milestone depth, its ledger, and its tooling are removed.
- **Parts replace milestones.** A feature too large for one plan lists its user-visible outcomes in `.scratch/<feature>/parts.md`, a plain unvalidated checklist; each part is planned and delivered as its own feature `<feature>-pN`.
- **Pause and resume live in `gsd-executing-plans`.** `gsd-handoff`, autosync, and cross-machine handoff are removed; state writes carry `owner=<GSD_SESSION>` and candidate discovery lists only packets the current session owns.
- **Validation is light.** A plan requires only Feature, Base, Acceptance Criteria, and Tasks; every other section is optional and order-free, `Publication` is gone, and each active criterion needs at least one task. Full validation blocks only at binding (and each rebind) and at the terminal gate.
- **The wave gate has two steps.** `verify-task-branch` mechanically proves each task branch, then every merged task's focused check reruns on `wip/<feature>` before the checkpoint. RED re-proof and the weakened-guard scan are dropped; the whole-diff review in `gsd-verify` catches weakened tests.
- **The session owner reviews.** No reviewer sub-agent exists; `gsd-verify` is the owner's single whole-diff review, and the end of the lifecycle asks whether to merge or open a pull request.
- **Cross-repo plans.** An optional `## Repos` table (`| Repo | Path | Base |`) lists every touched repository, this one as `.`; tasks name theirs with `- **Repo:**`. Each repository gets its own `wip/<feature>`, `.scratch/` and `state.toon` stay here, waves treat the same path in two repositories as disjoint, and preflight proves every repository.
- **Domain docs are opt-in** per repository through `docs/domain/index.md` or an accepted bootstrap.

## Rationale

The earlier lifecycle forced routing, validated every draft against a thirteen-section grammar, gated each wave in five layers, and spawned a reviewer, which cost more than the defects it caught. This record supersedes 0005, 0007, 0013, 0016, and 0018.
