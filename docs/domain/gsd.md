# Domain Scope

## Scope

`gsd`

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| Artifact Contract | The canonical rule that classifies repository artifacts per Invocation Mode as Required, Optional, Produced, or Fallback. Flat frontmatter `consumes:`/`produces:` arrays are catalog unions of what any mode may read or write, not runtime preconditions; missing Optional state is normal, while missing Required state follows the mode's recovery, reconstruction, or blocker path. | dependency list, mandatory consumes |
| Context Harvest | Scope-bounded inspection of code and docs already relevant to the currently selected workflow to identify durable project terms or architectural decisions. It updates the relevant `docs/domain/<scope>.md` shard only when evidence clears the domain thresholds; absence or uncertainty never triggers a broad repository scan. | documentation bootstrap, full-repo glossary scan |
| Execution Model Binding | The approval-time OMP binding of one executor model and one distinct reviewer model to an execution generation. The bound selectors and persistent agent identities survive task boundaries and repair rounds; they never silently fall back to the active planning model. | model switch, preferred model |
| Invocation Mode | A named execution path through one skill with its own artifact requirements, fallback behavior, output authority, and prompt policy—for example standalone review versus the post-approval WIP gate. It is selected from explicit intent and entry context before Required-artifact validation; artifact presence alone never determines it, and handoff mode/phase values remain open and opaque. | dispatch label |
| Milestone Ledger | The minimal Git-tracked `docs/gsd/<feature>/milestones.md` contract that carries precise, user-approved milestone goals and durable pending/done state across otherwise independent GSD cycles. Sequential ID/position, not potentially duplicate goal text, is identity. The ledger records state but does not itself select, recover, or complete milestones or authorize merges. It is not a task tracker or speculative roadmap: detailed acceptance criteria stay in the canonical plan. | roadmap, cross-milestone plan, task ledger |

## Decisions

### D-gsd-1: Keep artifact discovery flat and requirements mode-aware

- **Decision:** Keep flat `consumes:`/`produces:` frontmatter as catalog unions; let each skill's selected Invocation Mode define Required, Optional, Produced, and Fallback behavior.
- **Rationale:** Selecting the mode from explicit intent and entry context before artifact validation preserves lazy loading and the existing parser while avoiding nested frontmatter workflow syntax, executable manifests, duplicated guard semantics, and fabricated state.

### D-gsd-2: Escalate work that stops being a quick fix

- **Decision:** Clear bounded quick-fix scope and return to the normal lifecycle when requested work becomes complex or expands beyond known scope.
- **Rationale:** Quick-fix speed depends on bounded behavior; silently reducing requested scope bypasses design and verification contracts.

### D-gsd-3: Bind persistent OMP executor and reviewer roles

- **Decision:** At approval, bind OMP `modelRoles.task` to one persistent primary executor and the distinct `modelRoles.advisor` to one persistent terminal reviewer. Reuse the primary executor for every task and repair, allow it to fan out validated dependency-independent and path-disjoint attempts to bounded OMP child agents when isolation/model evidence is safe, reuse the reviewer for every terminal re-review, and keep orchestration, Git, handoff, merge, and cleanup authority in the parent.
- **Rationale:** OMP supports per-spawn model overrides, idle-agent revival, and bounded parallel task execution. Binding those native roles preserves the active model for discovery and planning, retains primary execution context across tasks, permits safe concurrency without overlapping writes, gives the merge gate an independent model, and avoids both mandatory serial execution and a second non-OMP configuration mechanism.

### D-gsd-4: Replace the fixed repair cap with a progress guard

- **Decision:** Continue terminal repair without a fixed round count only while findings or the relevant diff demonstrably change; stop on a repeated blocking fingerprint or no relevant repair diff.
- **Rationale:** This honors convergence-to-green while preventing non-terminating model churn and unbounded no-progress cost.

### D-gsd-5: Allow same-model successor generations only after identity loss

- **Decision:** If an OMP process or session boundary makes a bound agent unreachable, create exactly one active successor at a time on the same bound model from validated handoff and attempt evidence, record the generation change, and invalidate the old identity.
- **Rationale:** OMP agent revival is process-scoped, while GSD handoffs support restart and portable resume; strict identity reuse across a dead process is impossible, but silent model substitution is avoidable.
