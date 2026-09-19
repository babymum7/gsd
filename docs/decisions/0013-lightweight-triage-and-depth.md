# 0013 — Triage front door and right-sized depth

- **Status:** Accepted
- **Date:** 2026-09-19

## Decision

GSD gains one lightweight triage step ahead of every route, and the former
two-way full-plan/Quick-fix split becomes a four-level depth ladder. Lightweight
means the common case loads nothing: no state scan, no Git work, no scratch
artifact, and no skill body for a direct answer. The existing pipeline
(`gsd-brainstorming` -> `gsd-to-plan` -> `gsd-executing-plans` -> `gsd-verify`)
keeps its names and authority; triage only chooses how deep to enter it.

1. **Triage first, always.** Before any lifecycle work the session owner
   classifies the prompt into exactly one route: `answer` (read-only or Nano),
   `clarify` (missing or ambiguous intent), `research` (facts must be gathered
   before answering), `quick`, `plan`, or `milestone`. Classification reads the
   prompt and only the context the prompt names; it never sweeps the repository.
   The boundaries between these routes are defined in
   [0018](0018-triage-route-boundaries.md), not inferred.
2. **Clarify, never stall.** When intent is missing or ambiguous, ask exactly one
   question that carries a recommended default and the consequence of each
   option. When nothing behavioral turns on an answer, state the conservative
   default and proceed instead of asking. Suspicion about a claimed cause, a
   supplied design, or a prompt built on a false premise is a `clarify`, not a
   silent assumption.
3. **Research before answering.** When the answer depends on codebase facts,
   external documentation, or a reference repository, gather that evidence first;
   never answer a research question from memory. Bounded read-only delegation is
   allowed and its result carries no authority, so the owner re-verifies every
   fact against canonical sources before acting on it.
4. **Every choice carries a recommendation.** Questions, tradeoffs, and
   menu-like output name one recommended option and why, with the alternatives
   and their costs beside it. The recommendation is the smallest option that
   fully satisfies the ask; unrequested retries, telemetry, configuration,
   extension points, and abstractions stay out.
5. **Depth is chosen, not assumed.** Depth is decided by ambiguity, blast
   radius, reversibility, and acceptance clarity, never by file count:
   - `direct` — read-only answers and Nano edits: no scratch, branch, commit, or
     skill.
   - `quick` — one bounded change with acceptance already converged from the
     prompt: the Quick-fix plan.
   - `plan` — multi-task behavior whose acceptance must be written down: the
     canonical `plan.md`.
   - `milestone` — independently releasable outcomes or portable multi-session
     publication: the full plan plus the milestone ledger.
   A deeper level is chosen only when the shallower one cannot express the work.
   Depth may rise mid-flight under plan amendment; it may never silently fall to
   ship a subset as complete.
6. **Sub-agent implementation, independent review.** Implementable work is
   dispatched to sub-agents on hosts that support them, and every wave of two or
   more reconciled tasks additionally runs an independent read-only review of the
   merged diff — a reviewer sub-agent where the host provides one, otherwise the
   standalone review of `gsd-verify`. Review is advisory: the deterministic gates
   remain the only terminal authority, and a finding blocks only by citing bound
   plan text or a red deterministic check.
7. **Durable and temporary knowledge stay split, with one plan authority.**
   Durable knowledge stays `docs/decisions/`, `docs/design/`, and
   `docs/domain/`. Resumable temporary knowledge stays
   `.scratch/<feature>/{plan.md,state.toon}`. There is no parallel `spec.md`
   authority: the concrete contract OpenSpec-style tools put in a spec already
   lives in the schema of `plan.md` (`Scope`, `Acceptance Criteria`, `Interfaces`,
   `Invariants`, `Non-goals`). A brainstorm may keep at most one non-authoritative
   research note beside the packet, but acceptance and task order live only in
   `plan.md`.
