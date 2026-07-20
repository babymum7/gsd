# Domain Scope

## Scope

`gsd`

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| Artifact Contract | The canonical rule that classifies repository artifacts per Invocation Mode as Required, Optional, Produced, or Fallback. Flat frontmatter `consumes:`/`produces:` arrays are catalog unions of what any mode may read or write, not runtime preconditions; missing Optional state is normal, while missing Required state follows the mode's recovery, reconstruction, or blocker path. | dependency list, mandatory consumes |
| Context Harvest | Scope-bounded inspection of code and docs already relevant to the currently selected workflow to identify durable project terms or architectural decisions. It updates the relevant `docs/domain/<scope>.md` shard only when evidence clears the domain thresholds; absence or uncertainty never triggers a broad repository scan. | documentation bootstrap, full-repo glossary scan |
| Deferred Slow E2E | A browser, GUI, external-service, long-lived-server, large-fixture, or otherwise resource-heavy feature journey run only after every implementation task and fast check is green. Failures enter focused repair and affected-test reruns; the complete feature-affected slow suite reruns only after focused failures clear. | task focused check, per-task browser test |
| Execution Model Binding | The approval-time OMP binding of one executor model and one distinct reviewer model to an execution generation. The bound selectors and persistent agent identities survive task boundaries and repair rounds; they never silently fall back to the active planning model. | model switch, preferred model |
| Fast TDD Check | A deterministic local test command suitable for repeated RED→GREEN use: no browser or GUI, external network, long-lived server, large fixture, or material machine cost. It may be unit, contract, local integration, CLI, HTTP, or lightweight E2E. | final acceptance suite, slow E2E |
| Invocation Mode | A named execution path through one skill with its own artifact requirements, fallback behavior, output authority, and prompt policy—for example standalone review versus the post-approval WIP gate. It is selected from explicit intent and entry context before Required-artifact validation; artifact presence alone never determines it, and handoff mode/phase values remain open and opaque. | dispatch label |
| Manual UI Review Gate | An optional running-feature inspection at the terminal pre-E2E boundary for subjective layout, hierarchy, copy, interaction-feel, or responsive judgment; it supplements Fast TDD, Deferred Slow E2E, and terminal whole-diff review. | visual artifact review |
| Milestone Ledger | The minimal Git-tracked `docs/gsd/<feature>/milestones.md` contract that carries precise, user-approved milestone goals and durable pending/done state across otherwise independent GSD cycles. Sequential ID/position, not potentially duplicate goal text, is identity. The ledger records state but does not itself select, recover, or complete milestones or authorize merges. It is not a task tracker or speculative roadmap: detailed acceptance criteria stay in the canonical plan. | roadmap, cross-milestone plan, task ledger |

## Decisions

### D-gsd-1: Keep artifact discovery flat and requirements mode-aware

- **Decision:** Keep flat `consumes:`/`produces:` frontmatter as catalog unions; let each skill's selected Invocation Mode define Required, Optional, Produced, and Fallback behavior.
- **Rationale:** Selecting the mode from explicit intent and entry context before artifact validation preserves lazy loading and the existing parser while avoiding nested frontmatter workflow syntax, executable manifests, duplicated guard semantics, and fabricated state.

### D-gsd-2: Escalate work that stops being a quick fix

- **Decision:** Clear bounded quick-fix scope and return to the normal lifecycle when requested work becomes complex or expands beyond known scope.
- **Rationale:** Quick-fix speed depends on bounded behavior; silently reducing requested scope bypasses design and verification contracts.

### D-gsd-3: Bind persistent OMP executor and reviewer roles

- **Decision:** At approval, bind custom OMP `modelRoles.gsdExecutor` through the installer-managed `gsd-executor` agent to one persistent primary executor and bind the distinct custom `modelRoles.gsdReviewer` through the installer-managed `gsd-reviewer` agent to one persistent terminal reviewer. Never read, override, or fall back to built-in `modelRoles.task` or `modelRoles.advisor`. Reuse the primary executor for every task and repair, allow it to fan out validated dependency-independent and path-disjoint attempts to bounded OMP child agents when isolation/model evidence is safe, reuse the reviewer for every terminal re-review, and keep orchestration, Git, handoff, merge, and cleanup authority in the parent.
- **Rationale:** Dedicated custom roles isolate GSD model selection from generic OMP task and advisor behavior. Installer-managed global agent definitions make those roles available across repositories while preserving project-local model overrides, hub revival, and bounded parallel execution without requiring every project to duplicate agent files.

### D-gsd-4: Replace the fixed repair cap with a progress guard

- **Decision:** Continue terminal repair without a fixed round count only while findings or the relevant diff demonstrably change; stop on a repeated blocking fingerprint or no relevant repair diff.
- **Rationale:** This honors convergence-to-green while preventing non-terminating model churn and unbounded no-progress cost.

### D-gsd-5: Allow same-model successor generations only after identity loss

- **Decision:** If an OMP process or session boundary makes a bound agent unreachable, create exactly one active successor at a time on the same bound model from validated handoff and attempt evidence, record the generation change, and invalidate the old identity.
- **Rationale:** OMP agent revival is process-scoped, while GSD handoffs support restart and portable resume; strict identity reuse across a dead process is impossible, but silent model substitution is avoidable.

### D-gsd-6: Require fast TDD and defer resource-heavy E2E

- **Decision:** Every task with observable behavior must load `gsd-tdd` and use a Fast TDD Check for RED→GREEN→refactor. Planning adds the smallest real fast public seam when none exists. Do not dispatch `gsdReviewer` per task. Deferred Slow E2E / the complete feature-affected slow suite runs only after all implementation tasks and fast checks are green; begin whole-diff review only after the complete feature-affected slow suite is green. Failures are fixed at their source and rerun through the smallest affected subset until clear, then the complete feature-affected slow suite reruns, then whole-diff re-review. Repeat that progress-guarded loop until green.
- **Rationale:** Fast feedback preserves test-first correctness during implementation, while deferred focused browser/E2E repair avoids repeatedly paying the highest machine and latency cost.

### D-gsd-7: Keep visible skill contracts concise and deterministic

- **Decision:** Every visible skill must state exact load, do-not-load, owner/helper, prerequisite, and transition conditions. Shared semantics live once in `REFERENCE.md`; skill files keep only mode-specific rules. Shortening may remove duplication but must not change behavior.
- **Rationale:** One canonical vocabulary reduces injected tokens and gives different models the same mandatory dispatch interpretation.

### D-gsd-8: Independent review is terminal-only

- **Decision:** Do not dispatch `gsdReviewer` per task. After all tasks and fast checks pass, make the complete feature-affected slow suite green, then review the whole WIP diff; any review repair reruns affected fast checks and slow acceptance before whole-diff re-review. Terminal completion requires both the complete feature-affected slow suite and `gsdReviewer` whole-diff verdict to be green on the final reviewed bytes.
- **Rationale:** This matches E2E-like cadence while retaining a fail-closed independent terminal gate over the final bytes.
### D-gsd-9: Keep Manual UI Review optional and additive

- **Decision:** Manual UI Review is enabled only by explicit choice or a planning question triggered by materially subjective visual acceptance; it runs once after all tasks and Fast TDD Checks are green and before Deferred Slow E2E and terminal whole-diff review, and runtime opt-in adds `manual_ui_review,on` without plan reapproval.
- **Rationale:** Subjective running-feature judgment is valuable for UI/UX but cannot replace deterministic tests, slow journeys, independent review, or immutable plan authority; keeping the gate optional preserves auto-pilot for technical work.
