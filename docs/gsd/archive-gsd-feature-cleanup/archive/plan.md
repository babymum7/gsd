# Plan
## Feature
`archive-gsd-feature-cleanup`
## Base
`main`
## Summary
Add a terminal cleanup disposition that archives the approved plan and a durable implementation record into the reviewed squash commit before deleting the feature scratch packet.
## Context
The terminal result-marker flow currently distinguishes deleting or retaining the completed `.scratch/<feature>/` packet, but it does not offer a durable, human-readable record of the approved plan and completed implementation. The archive must survive scratch cleanup without becoming a second source of execution authority or a post-squash unreviewed commit.
## Scope
- Document a third terminal disposition: archive the exact approved plan plus an implementation summary under `docs/gsd/<feature>/archive/`, then remove `.scratch/<feature>/`.
- Require archive materialization before terminal review and squash so the archive is included in the same reviewed commit.
- Define the archive as historical reference only: the scratch `plan.md` remains execution authority, runtime TOON handoffs/attempts/results are not copied, existing archive files are never overwritten, and collisions fail closed.
- Extend the GSD contract test to guard the option, archive paths, timing, authority, and no-post-squash-commit invariants.
- Align both `gsd-to-plan` and `gsd-executing-plans` post-approval prompt promises with the sole terminal scratch disposition carve-out so no workflow contract can suppress the choice.
- Configure `modelRoles.gsdExecutor` and `modelRoles.gsdReviewer` only in this repository's `.omp/config.yml`; leave global OMP configuration untouched.
## Acceptance Criteria
### AC-1: Archive terminal disposition
- **State:** active
- **Outcome:** After implementation checks pass and before the final terminal review/squash, GSD offers archive-and-delete alongside delete and retain; selecting archive copies the exact approved `.scratch/<feature>/plan.md` to `docs/gsd/<feature>/archive/plan.md` and writes `implementation.md` with the feature outcome, changed paths, acceptance outcomes, and verification evidence.
- **Action:** Run the GSD skill-contract suite against the result-marker cleanup contract, planning approval contract, terminal verification contract, and archive guidance.
- **Expected:** The suite proves the sole terminal scratch prompt carve-out across workflow contracts, the archive option, exact destination files, pre-review/pre-squash timing, same-squash inclusion, scratch deletion after publication, and no post-merge follow-up commit.
### AC-2: Archive safety and authority
- **State:** active
- **Outcome:** Archive output is non-authoritative historical reference, excludes handoffs/attempts/result markers, preserves the approved plan bytes, and fails closed rather than overwriting an existing archive path.
- **Action:** Run the same contract suite against the safety and authority clauses.
- **Expected:** The suite proves scratch `plan.md` remains the only execution authority, runtime TOON files are excluded, archive collisions are preserved/fail-closed, and existing one-squash/clean-scratch invariants remain explicit.
### AC-3: Project-local dedicated model roles
- **State:** active
- **Outcome:** This repository resolves GSD execution through `modelRoles.gsdExecutor=xai-oauth/grok-4.5` and review through `modelRoles.gsdReviewer=openai-codex/gpt-5.5:high` without changing global OMP configuration.
- **Action:** Read the effective project OMP model-role configuration from this repository.
- **Expected:** Both custom roles resolve to the requested concrete models, built-in roles remain inherited, and `~/.omp/agent/config.yml` is unchanged.
## Decisions
### D-1: Archive in the reviewed squash
- **Decision:** Materialize archive files before terminal review and include them in the same squash commit; never create an unreviewed post-merge documentation commit.
- **Rationale:** Preserves the one-feature/one-squash invariant and makes the archive part of the terminal acceptance review.
### D-2: Use a separate historical archive directory
- **Decision:** Write `docs/gsd/<feature>/archive/plan.md` and `docs/gsd/<feature>/archive/implementation.md`.
- **Rationale:** Keeps the durable plan and implementation record together while avoiding confusion with the authoritative scratch packet or the milestone ledger path.
### D-3: Archive only human-readable durable evidence
- **Decision:** Copy the exact approved plan and a concise implementation record; do not copy runtime handoffs, immutable attempts, result markers, or machine-local scratch metadata.
- **Rationale:** Preserves future reference value without creating a second executable recovery plane or leaking transient runtime state.
### D-4: Keep model bindings project-local
- **Decision:** Add only the two custom GSD role overrides to `.omp/config.yml`; do not copy or rewrite the global role record.
- **Rationale:** Enables the dedicated installed agents for this repository while preserving the user's global OMP behavior.
## Invariants
- **I-1:** `.scratch/<feature>/plan.md` remains the sole execution/design authority during the active cycle; the archive is reference-only.
- **I-2:** Archive files are created and reviewed before squash; no post-squash follow-up commit is created.
- **I-3:** Existing archive files are never overwritten; collisions fail closed and preserve prior content.
- **I-4:** Runtime TOON files and `.scratch/<feature>/result.toon` are never copied into the archive.
- **I-5:** Existing result-marker, one-squash, branch cleanup, and scratch cleanup contracts remain intact.
- **I-6:** Global OMP configuration remains byte-for-byte unchanged; only project `.omp/config.yml` owns these custom role overrides.
- **I-7:** Approval remains the last normal prompt; the only later prompt is the terminal scratch disposition required after implementation checks and before final review/squash.
## Non-goals
- **NG-1:** Automatically archive every completed feature without an explicit terminal disposition.
- **NG-2:** Reopen archived features for execution or treat archived plans as active authority.
- **NG-3:** Create a second commit after squash solely for documentation.
- **NG-4:** Copy the full scratch packet, handoffs, attempts, result marker, or machine-local runtime state.
- **NG-5:** Change global OMP model roles or infer custom values from built-in task/advisor roles.
## Interfaces
| Criterion | Seam | Path | Lower-seam reason |
| --- | --- | --- | --- |
| AC-1 | Node GSD contract suite | `test/skills.test.js` | No executable cleanup prompt exists outside the Markdown skill contract; this is the highest existing deterministic seam. |
| AC-2 | Node GSD contract suite | `test/skills.test.js` | No executable archive publisher exists outside the Markdown skill contract; this suite guards the authoritative safety clauses. |
| AC-3 | OMP project config resolution | `.omp/config.yml` | none |
## Publication
null
## Tasks
### T1: Configure project-local GSD roles
- **Satisfies:** AC-3
- **Files:** `.omp/config.yml`
- **Test:** `omp config get modelRoles --json`
- **Status:** pending
### T2: Add archive disposition contract and tests
- **Satisfies:** AC-1, AC-2
- **Files:** `skills/gsd/REFERENCE.md`, `skills/gsd/SKILL.md`, `skills/gsd-to-plan/SKILL.md`, `skills/gsd-executing-plans/SKILL.md`, `skills/gsd-verify/SKILL.md`, `test/skills.test.js`
- **Test:** `node --test test/skills.test.js`
- **Status:** pending
