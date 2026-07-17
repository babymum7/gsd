# Implementation

## Outcome
Added an explicit terminal scratch disposition for delete, retain, or archive-and-delete. Archive-and-delete preserves the approved plan and a durable implementation record under `docs/gsd/<feature>/archive/`, reviews those files with the implementation, then deletes the machine-local scratch packet after publication.

## Changed paths
- `.omp/config.yml`
- `skills/gsd/REFERENCE.md`
- `skills/gsd/SKILL.md`
- `skills/gsd-to-plan/SKILL.md`
- `skills/gsd-executing-plans/SKILL.md`
- `skills/gsd-verify/SKILL.md`
- `test/skills.test.js`

## Acceptance outcomes
- **AC-1:** The terminal contract offers archive-and-delete after implementation checks and before terminal review/squash; it specifies the exact archive destinations, same-squash inclusion, post-publication scratch deletion, and no documentation-only follow-up commit.
- **AC-2:** The archive is reference-only, preserves exact approved plan bytes, excludes handoffs, attempts, result markers, and other runtime TOON metadata, and fails closed without overwriting an existing destination.
- **AC-3:** Project-local `gsdExecutor` and `gsdReviewer` roles resolve to the requested models while built-in roles remain inherited and the global configuration remains unchanged.

## Verification evidence
- Focused skill-contract suite: `node --test test/skills.test.js` — 20 tests passed, 0 failed.
- Project suite: `node --test test/*.test.js` — 85 tests passed, 0 failed.
- Effective project roles: `gsdExecutor=xai-oauth/grok-4.5`; `gsdReviewer=openai-codex/gpt-5.5:high`.
- Global OMP configuration SHA-256 remained `d314a68262bd5cb4d3f912cb95c94c6a0f65ecebbb390876005e3e630e5d80cb`.
- Approved plan and archived plan SHA-256: `6c592ccf240af1a2d3f9e7d0ee0bf9e926aff1480fc745f6908964aa0fe5814e`.

## Archive status
This directory is non-authoritative historical reference. The scratch plan remains the execution authority during the active cycle. Runtime handoffs, immutable attempts, result markers, and machine-local scratch metadata are intentionally not archived.
