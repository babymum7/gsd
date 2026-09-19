# 0019 — Reference-repo alignment is verified, not asserted

- **Status:** Accepted
- **Date:** 2026-09-19

## Decision

GSD tracks three upstream references and takes one named idea from each. The
README's claims about them are checked against upstream source files, not
paraphrase, and every deliberate difference is stated beside the borrowed idea.
No upstream workflow, skill body, or file layout is adopted whole.

1. **mattpocock/skills — align before building.**
   `skills/productivity/grilling/SKILL.md` states three rules: each question
   carries the agent's recommended answer, finding facts is the agent's job
   rather than the user's, and the session ends only when the frontier of open
   decisions is empty. `.out-of-scope/question-limits.md` explicitly refuses any
   cap on question count ("some plans need three questions, some need fifty").
   GSD takes the first two into `gsd-brainstorming` ("Recommend answers for all
   questions. Batch independent questions; ask dependent questions sequentially
   by branch") and deliberately differs at the triage front door, where an
   ambiguous prompt receives exactly one question instead of a round.
2. **obra/superpowers — hook-injected activation.** `hooks/hooks.json` registers
   one `SessionStart` handler matched on `startup|clear|compact`, and
   `hooks/session-start` injects the whole `using-superpowers` skill as
   `hookSpecificOutput.additionalContext`. That skill's rule is to invoke a
   relevant skill before any response, including clarifying questions. GSD takes
   the injection idea and each host's own context field (upstream documents the
   same trap GSD's adapters avoid: Cursor reads `additional_context`, Claude Code
   reads `hookSpecificOutput.additionalContext` without deduplication, and the
   SDK standard is a top-level `additionalContext`, so a run must emit exactly
   the field its host consumes). GSD deliberately differs in what the injection
   carries: an explicit catalog whose selected owner must read the named
   `skillPath`, instead of tool-based skill discovery, and it takes none of
   Superpowers' workflow or skill bodies.
3. **Fission-AI/openspec — schema'd change proposals.** One folder per change
   holds `proposal.md`, `specs/` deltas written as `## ADDED Requirements` then
   `### Requirement:` and `#### Scenario:` (WHEN/THEN), `design.md`, and
   `tasks.md`, archived into a durable spec corpus after merge. GSD keeps the
   one-folder change and the durable corpus but folds the contract into the single
   canonical `plan.md` (`Scope`, `Acceptance Criteria`, `Interfaces`,
   `Invariants`, `Non-goals`) plus the `docs/domain/*.md` behavior shards.
   Domain Impact classification (`none`, `change-existing-context`,
   `introduce-context`, `change-context-boundary`) is GSD's stand-in for the
   ADDED/MODIFIED/REMOVED deltas, and plan amendment keeps superseded criteria
   inert (decision 0002) rather than reprinting a spec corpus.
4. **The counter-position stays visible.** The mattpocock/skills README names GSD
   directly among approaches that "try to help by owning the process" and, in
   doing so, "take away your control and make bugs in the process hard to
   resolve". GSD answers that with the shape of this revamp rather than with
   prose: triage keeps the common case direct and artifact-free, there is exactly
   one plan authority instead of a parallel spec tree, skills stay plain editable
   repository files, and ordinary prompts cost nothing per turn because the
   adapters inject at session boundaries only.

Re-verification is a fetch of the exact upstream paths named above
(`skills/productivity/grilling/SKILL.md`, `.out-of-scope/question-limits.md`,
`hooks/hooks.json`, `hooks/session-start`, `skills/using-superpowers/SKILL.md`,
and the OpenSpec README's change walkthrough). A README claim that upstream no
longer supports is drift and is corrected in the same change that finds it; a
deliberate difference that quietly becomes agreement is also drift.
