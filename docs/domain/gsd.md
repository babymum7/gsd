# Domain Scope

## Scope

`gsd`

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| Artifact Contract | The canonical rule classifying repository artifacts per Invocation Mode as Required, Optional, Produced, or Fallback. Flat frontmatter arrays are catalog unions rather than runtime preconditions. | dependency list, mandatory consumes |
| Context Harvest | Scope-bounded inspection of code and docs already relevant to the selected workflow; durable terms or decisions are written only when evidence clears domain thresholds. | documentation bootstrap, full-repo glossary scan |
| Deferred Slow E2E | A browser, GUI, external-service, long-lived-server, large-fixture, or otherwise resource-heavy feature journey run only after current-commit deterministic conformance and resolution of any selected Terminal Visual Review. | task-loop check, pre-verification suite |
| Fast TDD Check | A deterministic local command suitable for repeated RED→GREEN use without browser, external network, long-lived server, large fixture, or material machine cost. | final acceptance suite, slow E2E |
| Invocation Mode | A named path through one skill with its own required artifacts, fallback behavior, output authority, and prompt policy. | dispatch label |
| Milestone Ledger | The minimal Git-tracked `docs/gsd/<feature>/milestones.md` contract carrying precise user-approved milestone goals and durable pending/done state. | roadmap, task ledger |
| Planning Prototype Session | An optional pre-approval Lavish session whose selected artifacts may become task-bound references but never execution authority or terminal evidence. | running-feature visual gate |
| Resumable State Snapshot | The atomic canonical `schema:v3` `.scratch/<feature>/state.toon` record binding plan bytes, Git identity, green checkpoint, preferences, and checkpoint revision without model or agent identity. | handoff history, task attempt |
| Session Owner | The current top-level session as the sole lifecycle authority. A later top-level session assumes the role only after canonical rehydration; the role is not a persisted identity. | persistent parent identity, model role |
| Terminal Conformance | Deterministic current-commit proof of plan/state binding, active-criterion/interface/task coverage, changed-path ownership, plan-ordered diffs, explicit decisions/invariants/non-goals, and focused-check evidence. | free-form verdict, subjective approval |
| Terminal Visual Review | An optional post-conformance, pre-E2E Lavish inspection of the actual completed deliverable. Poll transport is tracked and non-blocking; browser feedback handling is capture-only, while direct main-session instructions remain available. Source changes invalidate conformance and visual acceptance. | planning prototype, foreground polling, automatic source repair |

## Decisions

### D-gsd-1: Keep artifact discovery flat and requirements mode-aware

- **Decision:** Keep flat `consumes:`/`produces:` frontmatter as catalog unions; let each selected Invocation Mode define Required, Optional, Produced, and Fallback behavior.
- **Rationale:** Mode-first validation preserves lazy loading without duplicated workflow syntax or fabricated state.

### D-gsd-2: Escalate work that stops being a quick fix

- **Decision:** Clear bounded quick-fix scope and return to the normal lifecycle when requested work becomes complex or expands beyond known scope.
- **Rationale:** Silently reducing requested scope bypasses design and verification contracts.

### D-gsd-3: Make the session owner the sole lifecycle authority

- **Decision:** The current top-level session owns plan interpretation, implementation, repair, verification, feedback routing, E2E, Git, merge, and cleanup inline and sequentially.
- **Rationale:** One context avoids lossy handoff while canonical artifacts allow a later session to assume the role safely.

### D-gsd-4: Converge only through deterministic blockers

- **Decision:** Continue terminal repair only for a malformed binding, ownership/coverage mismatch, explicit contract contradiction, unresolved change, or red deterministic check; rerun invalidated evidence after source changes.
- **Rationale:** Objective evidence converges without random critique or a fixed repair-round counter.

### D-gsd-5: Rehydrate authority from canonical sources

- **Decision:** On resume, validate `schema:v3`, exact plan path/hash, base/WIP identity, last green task/commit, current tree, and required plan-referenced artifacts before rebuilding the active slice.
- **Rationale:** Portable continuation depends on canonical bytes and Git, not conversational summaries or persistent identities.

### D-gsd-6: Require fast TDD and defer resource-heavy E2E

- **Decision:** Every observable task loads `gsd-tdd` and runs RED→GREEN→refactor at the smallest real fast public seam. Deferred Slow E2E runs only after current-commit terminal conformance and any selected visual acceptance.
- **Rationale:** Fast feedback protects implementation while the expensive journey remains the final unchanged-commit gate.

### D-gsd-7: Keep visible skill contracts concise and deterministic

- **Decision:** Every visible skill states exact load, do-not-load, owner/helper, prerequisite, and transition conditions; shared semantics live once in `REFERENCE.md`.
- **Rationale:** One canonical vocabulary reduces context cost without behavior drift.

### D-gsd-8: Verify cumulative work by deterministic conformance

- **Decision:** After all tasks and fast checks are green, the session owner checks the cumulative WIP against the bound plan, task ownership, interfaces, decisions, invariants, non-goals, plan-ordered diffs, and current-commit check evidence.
- **Rationale:** Machine-checkable, plan-bound evidence preserves terminal quality without independent model authority.

### D-gsd-9: Separate planning prototypes from terminal implementation review

- **Decision:** Offer optional pre-approval prototypes and, after current-commit conformance, offer Terminal Visual Review for UI/UX and other eligible substantial deliverables. Terminal collection records feedback without source mutation until explicit `Start fixing`.
- **Rationale:** Prototype intent and actual implementation evidence serve different gates; explicit repair confirmation prevents accidental mutation.

### D-gsd-10: Collapse runtime history into one resumable snapshot

- **Decision:** Keep canonical `plan.md` plus one atomic `schema:v3` `state.toon`; persist only lifecycle, plan binding, Git identity, green checkpoint, preferences, and checkpoint revision.
- **Rationale:** Canonical plan bytes and Git make numbered history, task attempts, reload manifests, and persistent identities redundant.

### D-gsd-11: Clean transient feature artifacts after green merge

- **Decision:** Delete feature scratch automatically after a green merge unless retain or archive-and-delete was selected; clean only regular direct-child Lavish artifacts with the exact feature prefix.
- **Rationale:** Exact ownership removes completed runtime evidence without touching neighboring sessions.

### D-gsd-12: Gate terminal visual source repair on explicit confirmation

- **Decision:** Capture feedback in `.gsd-lavish/${feature}.feedback.json` without tracked-source mutation. Pending feedback offers only `Start fixing`/`Continue feedback`; zero pending plus current conformance offers `Accept visual result`/`Continue feedback`.
- **Rationale:** Separate collection, repair authorization, and acceptance preserve user intent and unchanged-commit evidence.

### D-gsd-13: Keep Lavish polling non-blocking and revision-aware

- **Decision:** Never occupy the main agent session with an indefinite Lavish poll. In a verified harness, keep at most one same-session tracked poll armed per canonical `HTML_FILE`; re-arm only after its completion is delivered or a clearly pre-delivery timeout is observed and required marker/ledger reconciliation succeeds. While that Lavish session remains open, each direct main-session turn also reconciles exact-target status non-blockingly; harnesses without tracked delivery use status/drain only. Relevant source changes refresh the associated artifact while irrelevant changes leave it untouched.
- **Rationale:** Alternating direct chat and browser review requires continuous timeout healing without duplicate polls, unmanaged processes, busy polling, concurrent source mutations, or blind application of stale visual feedback.
