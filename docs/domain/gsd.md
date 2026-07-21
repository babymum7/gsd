# Domain Scope

## Scope

`gsd`

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| Artifact Contract | The canonical rule that classifies repository artifacts per Invocation Mode as Required, Optional, Produced, or Fallback. Flat frontmatter `consumes:`/`produces:` arrays are catalog unions of what any mode may read or write, not runtime preconditions; missing Optional state is normal, while missing Required state follows the mode's recovery, reconstruction, or blocker path. | dependency list, mandatory consumes |
| Context Harvest | Scope-bounded inspection of code and docs already relevant to the currently selected workflow to identify durable project terms or architectural decisions. It updates the relevant `docs/domain/<scope>.md` shard only when evidence clears the domain thresholds; absence or uncertainty never triggers a broad repository scan. | documentation bootstrap, full-repo glossary scan |
| Deferred Slow E2E | A browser, GUI, external-service, long-lived-server, large-fixture, or otherwise resource-heavy feature journey run only after every implementation task and fast check is green, independent whole-diff review has reached reviewer PASS on the current commit, and any offered/selected Terminal Visual Review has been resolved (Continue or explicit visual acceptance). Failures enter parent-mediated executor repair with affected fast checks; any changed bytes invalidate prior review and selected visual acceptance and require whole-diff re-review, reviewer PASS, and refreshed visual acceptance when applicable before the complete feature-affected slow suite reruns. | task focused check, per-task browser test |
| Execution Model Binding | The approval-time OMP binding of one executor model and one distinct reviewer model. The selectors survive task, repair, session, and machine boundaries; live agent identities are process-local and may be reused only while reachable, then recreated from the same selectors. | model switch, persisted agent identity |
| Fast TDD Check | A deterministic local test command suitable for repeated RED→GREEN use: no browser or GUI, external network, long-lived server, large fixture, or material machine cost. It may be unit, contract, local integration, CLI, HTTP, or lightweight E2E. | final acceptance suite, slow E2E |
| Invocation Mode | A named execution path through one skill with its own artifact requirements, fallback behavior, output authority, and prompt policy—for example standalone review versus the post-approval WIP gate. It is selected from explicit intent and entry context before Required-artifact validation; artifact presence alone never determines it, and handoff mode/phase values remain open and opaque. | dispatch label |
| Milestone Ledger | The minimal Git-tracked `docs/gsd/<feature>/milestones.md` contract that carries precise, user-approved milestone goals and durable pending/done state across otherwise independent GSD cycles. Sequential ID/position, not potentially duplicate goal text, is identity. The ledger records state but does not itself select, recover, or complete milestones or authorize merges. It is not a task tracker or speculative roadmap: detailed acceptance criteria stay in the canonical plan. | roadmap, cross-milestone plan, task ledger |
| Planning Prototype Session | An optional pre-approval Lavish session built from a completed draft plan for any feature type. Its annotations return to the plan owner, selected artifacts may be referenced from the draft, and neither the session nor its artifacts become execution authority or terminal acceptance evidence. | running-feature visual gate, terminal prototype gate |
| Resumable State Snapshot | The single atomic `.scratch/<feature>/state.toon` record of the latest resumable lifecycle checkpoint. It binds the approved plan and current Git/model/review state without preserving numbered transition history or duplicating task authority. | handoff history, task attempt |
| Terminal Visual Review | An optional post-review, pre-E2E Lavish inspection of the actual completed deliverable. Its offer is mandatory when the approved plan contains UI/UX work and eligibility-gated for other substantial deliverables; accepting the offer makes annotations a gate until explicit visual acceptance. In-scope feedback returns through the parent to the executor, and changed bytes require affected fast checks, whole-diff reviewer PASS, and a refreshed visual artifact before E2E. | planning prototype, automatic browser launch, post-merge demo |

## Decisions

### D-gsd-1: Keep artifact discovery flat and requirements mode-aware

- **Decision:** Keep flat `consumes:`/`produces:` frontmatter as catalog unions; let each skill's selected Invocation Mode define Required, Optional, Produced, and Fallback behavior.
- **Rationale:** Selecting the mode from explicit intent and entry context before artifact validation preserves lazy loading and the existing parser while avoiding nested frontmatter workflow syntax, executable manifests, duplicated guard semantics, and fabricated state.

### D-gsd-2: Escalate work that stops being a quick fix

- **Decision:** Clear bounded quick-fix scope and return to the normal lifecycle when requested work becomes complex or expands beyond known scope.
- **Rationale:** Quick-fix speed depends on bounded behavior; silently reducing requested scope bypasses design and verification contracts.

### D-gsd-3: Bind persistent OMP executor and reviewer roles

- **Decision:** At approval, bind custom OMP `modelRoles.gsdExecutor` through the installer-managed `gsd-executor` agent and the distinct custom `modelRoles.gsdReviewer` through the installer-managed `gsd-reviewer` agent. Persist only the model selectors; reuse live agents within a process, and recreate them from those selectors after a process or machine boundary. Never read, override, or fall back to built-in `modelRoles.task` or `modelRoles.advisor`. Keep orchestration, Git, state, merge, and cleanup authority in the parent.
- **Rationale:** Model bindings affect execution quality across resumes, while live agent identities and generation counters are process-local implementation details. Persisting only selectors preserves dedicated roles and portable continuation without serializing identities that cannot survive another machine.

### D-gsd-4: Replace the fixed repair cap with a progress guard

- **Decision:** Continue terminal repair without a fixed round count only while findings or the relevant diff demonstrably change; stop on a repeated blocking fingerprint or no relevant repair diff.
- **Rationale:** This honors convergence-to-green while preventing non-terminating model churn and unbounded no-progress cost.

### D-gsd-5: Recreate process-local agents from bound models

- **Decision:** When a process, session, or machine boundary makes a live executor or reviewer unreachable, create one replacement from the persisted bound model selector and continue from the validated plan plus resumable state snapshot; do not persist agent identities or generation counters.
- **Rationale:** OMP agent revival is process-scoped, but model selection, Git commits, plan authority, and lifecycle checkpoints are portable. Reconstructing ephemeral identities adds validation work without improving recovery correctness.

### D-gsd-6: Require fast TDD and defer resource-heavy E2E until review passes

- **Decision:** Every task with observable behavior must load `gsd-tdd` and use a Fast TDD Check for RED→GREEN→refactor. Planning adds the smallest real fast public seam when none exists. The executor runs only deterministic local unit, integration, CLI, or contract checks during implementation and repair; it never runs browser, resource-heavy, slow, or E2E suites. After all tasks and fast checks are green, run independent whole-diff review first. After reviewer PASS, offer Terminal Visual Review for UI/UX plans and otherwise only for eligible substantial deliverables; when selected, complete its feedback, repair, re-review, and explicit visual-acceptance loop before running the complete feature-affected slow/E2E suite. Run the complete feature-affected slow/E2E suite only after reviewer PASS on the current commit and resolution of any selected Terminal Visual Review.
- **Rationale:** Fast feedback preserves test-first correctness, reviewer-first ordering rejects known-bad diffs before visual or E2E cost, and opt-in visual feedback validates the actual implementation before the most expensive automated gate. Revalidating changed bytes and keeping E2E last preserves correctness without redundant early full-suite runs.

### D-gsd-7: Keep visible skill contracts concise and deterministic

- **Decision:** Every visible skill must state exact load, do-not-load, owner/helper, prerequisite, and transition conditions. Shared semantics live once in `REFERENCE.md`; skill files keep only mode-specific rules. Shortening may remove duplication but must not change behavior.
- **Rationale:** One canonical vocabulary reduces injected tokens and gives different models the same mandatory dispatch interpretation.

### D-gsd-8: Keep independent review read-only and before E2E

- **Decision:** Do not dispatch `gsdReviewer` per task. After all tasks and fast checks pass, give the read-only reviewer one reporting-only coverage manifest derived from the approved plan and Git: ordered task-to-commit mapping, owned paths, active ACs, interface pins, invariants, non-goals, and focused-check evidence. The reviewer evaluates the cumulative whole WIP diff, covers every changed human-written line, and traces changed public or cross-boundary values to their consumers and dispatch points; task commits are navigation context, never separate verdicts. It returns structured findings to the parent in one batch, and the parent sends blocking findings to the persistent executor for source repair and affected fast checks. After reviewer PASS, offer Terminal Visual Review according to eligibility; if selected, in-scope feedback returns through the parent to the executor and every changed commit must regain reviewer PASS and visual acceptance. Only then does the parent run the complete feature-affected slow/E2E suite. An E2E failure returns evidence to the executor; any repair that changes bytes invalidates the prior review and any selected visual acceptance, so the repaired commit must pass reviewer again before slow/E2E reruns and regain visual acceptance when selected. Merge requires reviewer PASS, selected visual acceptance when applicable, and complete slow/E2E GREEN on the same unchanged commit.
- **Rationale:** One cumulative, coverage-accounted review removes repeated setup and duplicate per-task verdicts while increasing holistic design, integration, and cross-boundary scrutiny. Keeping review independent and repair executor-owned preserves role separation; positioning opt-in visual feedback between reviewer PASS and E2E catches human-visible defects before the most expensive suite, and same-commit invalidation prevents stale evidence from authorizing merge.

### D-gsd-9: Separate planning prototypes from terminal implementation review

- **Decision:** After every complete draft plan, offer one optional `Build prototype` action backed by Lavish; its feedback may revise the draft before approval, and its artifacts never become execution authority. Separately, after implementation reaches whole-diff reviewer PASS and before slow/E2E, present a terminal action surface that always offers Lavish for UI/UX plans and offers it for other eligible substantial deliverables. Launch only after selection, render the actual completed implementation rather than a mock, return in-scope annotations through the parent for executor repair, and repeat fast checks, whole-diff review, and visualization until explicit visual acceptance. Scope, acceptance, interface, or invariant changes remain Spec escalation.
- **Rationale:** Planning prototypes clarify intent, while Terminal Visual Review validates the actual implementation and lets the user correct UI/UX or other visually reviewable outcomes before expensive E2E and merge. Keeping launch opt-in and revalidating every changed commit limits latency without weakening final evidence.

### D-gsd-10: Collapse runtime history into one resumable snapshot

- **Decision:** Keep canonical `plan.md` plus one atomic `state.toon` checkpoint. Bind the plan digest at approval and verify it only at approval, resume, terminal entry, and pre-squash. Derive reload behavior from lifecycle state, dispatch task slices directly from the validated plan, and persist only approval, green task, pause/context-pressure, terminal verdict, and merge-cleanup checkpoints.
- **Rationale:** Numbered handoffs, task-attempt files, reload manifests, repeated agent identity fields, and historical transition validation duplicate authority already present in the plan and Git. One deep state interface improves locality and resume speed while preserving fail-closed plan binding, portable sync, test gates, and review convergence.

### D-gsd-11: Clean transient feature artifacts after green merge

- **Decision:** Delete the feature scratch packet automatically after a green merge unless the user explicitly selects retain or archive-and-delete before final review. During final green cleanup, keep project-root `.gsd-lavish/` and delete only regular direct-child artifacts carrying the exact current-feature prefix `${feature}.`; leave every other feature and non-feature artifact untouched, and fail closed on matching symlinks or non-regular entries. Persist merged-cleanup-pending only for crash recovery; do not add a mandatory terminal cleanup prompt.
- **Rationale:** Scratch and feature-scoped Lavish sessions are machine-local runtime artifacts whose authority ends after a successful merge, but `.gsd-lavish/` can concurrently contain unrelated reviews or other features. Exact feature-prefix ownership removes only the completed feature's files without following unsafe paths, erasing neighboring sessions, or adding a blocking round-trip.
