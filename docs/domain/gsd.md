# Domain Scope

## Scope

`gsd`

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| Artifact Contract | The canonical rule that classifies repository artifacts per Invocation Mode as Required, Optional, Produced, or Fallback. Flat frontmatter `consumes:`/`produces:` arrays are catalog unions of what any mode may read or write, not runtime preconditions; missing Optional state is normal, while missing Required state follows the mode's recovery, reconstruction, or blocker path. | dependency list, mandatory consumes |
| Context Harvest | Scope-bounded inspection of code and docs already relevant to the current route to identify durable project terms or architectural decisions. It updates the relevant `docs/domain/<scope>.md` shard only when evidence clears the domain thresholds; absence or uncertainty never triggers a broad repository scan. | documentation bootstrap, full-repo glossary scan |
| Invocation Mode | A named execution path through one skill with its own artifact requirements, fallback behavior, output authority, and prompt policy—for example standalone review versus the post-approval WIP gate. It is selected from explicit intent and entry context before Required-artifact validation; artifact presence alone never determines it, and handoff mode/phase values remain open and opaque. | route |
| Milestone Ledger | The minimal Git-tracked `docs/gsd/<feature>/milestones.md` contract that carries precise, user-approved milestone goals and durable pending/done state across otherwise independent GSD cycles. Sequential ID/position, not potentially duplicate goal text, is identity. The ledger records state but does not itself select, recover, or complete milestones or authorize merges. It is not a task tracker or speculative roadmap: detailed acceptance criteria stay in each milestone's local spec and plan. | roadmap, cross-milestone plan, task ledger |

## Decisions

### D-gsd-1: Keep artifact discovery flat and requirements mode-aware

- **Decision:** Keep flat `consumes:`/`produces:` frontmatter as catalog unions; let each skill's selected Invocation Mode define Required, Optional, Produced, and Fallback behavior.
- **Rationale:** Selecting the mode from explicit intent and entry context before artifact validation preserves lazy loading and the existing parser while avoiding nested frontmatter workflow syntax, executable manifests, duplicated guard semantics, and fabricated state.
