# Domain Scope

## Scope

`gsd`

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| Artifact Contract | The canonical rule that classifies repository artifacts per Invocation Mode as Required, Optional, Produced, or Fallback. Flat frontmatter `consumes:`/`produces:` arrays are catalog unions of what any mode may read or write, not runtime preconditions; missing Optional state is normal, while missing Required state follows the mode's recovery, reconstruction, or blocker path. | dependency list, mandatory consumes |
| Context Harvest | Scope-bounded inspection of code and docs already relevant to the currently selected workflow to identify durable project terms or architectural decisions. It updates the relevant `docs/domain/<scope>.md` shard only when evidence clears the domain thresholds; absence or uncertainty never triggers a broad repository scan. | documentation bootstrap, full-repo glossary scan |
| Deferred Slow E2E | A browser, GUI, external-service, long-lived-server, large-fixture, or otherwise resource-heavy feature journey run only after every implementation task and fast check is green. Failures enter focused repair and affected-test reruns; the complete feature-affected slow suite reruns only after focused failures clear. | task focused check, per-task browser test |
| Execution Model Binding | The approval-time OMP binding of one executor model and one distinct reviewer model. The selectors survive task, repair, session, and machine boundaries; live agent identities are process-local and may be reused only while reachable, then recreated from the same selectors. | model switch, persisted agent identity |
| Fast TDD Check | A deterministic local test command suitable for repeated RED→GREEN use: no browser or GUI, external network, long-lived server, large fixture, or material machine cost. It may be unit, contract, local integration, CLI, HTTP, or lightweight E2E. | final acceptance suite, slow E2E |
| Invocation Mode | A named execution path through one skill with its own artifact requirements, fallback behavior, output authority, and prompt policy—for example standalone review versus the post-approval WIP gate. It is selected from explicit intent and entry context before Required-artifact validation; artifact presence alone never determines it, and handoff mode/phase values remain open and opaque. | dispatch label |
| Milestone Ledger | The minimal Git-tracked `docs/gsd/<feature>/milestones.md` contract that carries precise, user-approved milestone goals and durable pending/done state across otherwise independent GSD cycles. Sequential ID/position, not potentially duplicate goal text, is identity. The ledger records state but does not itself select, recover, or complete milestones or authorize merges. It is not a task tracker or speculative roadmap: detailed acceptance criteria stay in the canonical plan. | roadmap, cross-milestone plan, task ledger |
| Planning Prototype Session | An optional pre-approval Lavish session built from a completed draft plan for any feature type. Its annotations return to the plan owner, selected artifacts may be referenced from the draft, and neither the session nor its artifacts become execution authority or terminal acceptance evidence. | running-feature visual gate, terminal prototype gate |
| Resumable State Snapshot | The single atomic `.scratch/<feature>/state.toon` record of the latest resumable lifecycle checkpoint. It binds the approved plan and current Git/model/review state without preserving numbered transition history or duplicating task authority. | handoff history, task attempt |

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

### D-gsd-6: Require fast TDD and defer resource-heavy E2E

- **Decision:** Every task with observable behavior must load `gsd-tdd` and use a Fast TDD Check for RED→GREEN→refactor. Planning adds the smallest real fast public seam when none exists. Do not dispatch `gsdReviewer` per task. Deferred Slow E2E / the complete feature-affected slow suite runs only after all implementation tasks and fast checks are green; begin whole-diff review only after the complete feature-affected slow suite is green. Failures are fixed at their source and rerun through the smallest affected subset until clear, then the complete feature-affected slow suite reruns, then whole-diff re-review. Repeat that progress-guarded loop until green.
- **Rationale:** Fast feedback preserves test-first correctness during implementation, while deferred focused browser/E2E repair avoids repeatedly paying the highest machine and latency cost.

### D-gsd-7: Keep visible skill contracts concise and deterministic

- **Decision:** Every visible skill must state exact load, do-not-load, owner/helper, prerequisite, and transition conditions. Shared semantics live once in `REFERENCE.md`; skill files keep only mode-specific rules. Shortening may remove duplication but must not change behavior.
- **Rationale:** One canonical vocabulary reduces injected tokens and gives different models the same mandatory dispatch interpretation.

### D-gsd-8: Independent review is terminal-only

- **Decision:** Do not dispatch `gsdReviewer` per task. After all tasks and fast checks pass, make the complete feature-affected slow suite green, then review the whole WIP diff; any review repair reruns affected fast checks and slow acceptance before whole-diff re-review. Terminal completion requires both the complete feature-affected slow suite and `gsdReviewer` whole-diff verdict to be green on the final reviewed bytes.
- **Rationale:** This matches E2E-like cadence while retaining a fail-closed independent terminal gate over the final bytes.

### D-gsd-9: Keep Lavish prototypes pre-approval and reference-only

- **Decision:** After every complete draft plan, offer one optional `Build prototype` action backed by Lavish for any feature type. Session feedback returns to the plan owner and may revise the draft before approval; selected artifacts may become bounded prototype references inside the feature scratch packet. After approval, prototype requests follow normal Spec escalation rather than creating an execution or terminal gate.
- **Rationale:** Interactive visualization can clarify UI, API, CLI, workflow, data, and architecture plans, but implementation quality still comes from approved acceptance criteria, Fast TDD, Deferred Slow E2E, and independent terminal review.

### D-gsd-10: Collapse runtime history into one resumable snapshot

- **Decision:** Keep canonical `plan.md` plus one atomic `state.toon` checkpoint. Bind the plan digest at approval and verify it only at approval, resume, terminal entry, and pre-squash. Derive reload behavior from lifecycle state, dispatch task slices directly from the validated plan, and persist only approval, green task, pause/context-pressure, terminal verdict, and merge-cleanup checkpoints.
- **Rationale:** Numbered handoffs, task-attempt files, reload manifests, repeated agent identity fields, and historical transition validation duplicate authority already present in the plan and Git. One deep state interface improves locality and resume speed while preserving fail-closed plan binding, portable sync, test gates, and review convergence.

### D-gsd-11: Clean transient feature artifacts after green merge

- **Decision:** Delete the feature scratch packet automatically after a green merge unless the user explicitly selects retain or archive-and-delete before final review. During final green cleanup, keep project-root `.gsd-lavish/` and delete only regular direct-child artifacts carrying the exact current-feature prefix `${feature}.`; leave every other feature and non-feature artifact untouched, and fail closed on matching symlinks or non-regular entries. Persist merged-cleanup-pending only for crash recovery; do not add a mandatory terminal cleanup prompt.
- **Rationale:** Scratch and feature-scoped Lavish sessions are machine-local runtime artifacts whose authority ends after a successful merge, but `.gsd-lavish/` can concurrently contain unrelated reviews or other features. Exact feature-prefix ownership removes only the completed feature's files without following unsafe paths, erasing neighboring sessions, or adding a blocking round-trip.
