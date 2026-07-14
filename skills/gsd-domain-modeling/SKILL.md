---
name: gsd-domain-modeling
description: "Use when already-bounded work reveals a durable project-specific term or an evidenced architectural decision requiring the canonical domain model. Do not scan for terminology proactively or write during read-only or Nano work."
triggers: explicit domain-model work or a durable term or decision found in already-bounded evidence
produces: [docs/domain/index.md, docs/domain/<scope>.md]
consumes: [docs/domain/index.md, docs/domain/<scope>.md]
---

# Domain Modeling

> **Invocation guard** — automatic selection or an active owner loads this skill from the injected catalog. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract: select an Invocation Mode below before validating only that row's Required artifacts, then follow its Missing required action.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| First-run domain modeling | — | — | `docs/domain/index.md`; one `docs/domain/<scope>.md` shard, both only after an evidenced write | — |
| Existing-model update | `docs/domain/index.md`; every index-selected relevant shard | — | selected shard; index plus a new shard only for a new durable bounded context | Malformed/missing index or referenced shard fails closed; never reconstruct it by sweeping code |

Both modes are evidence-driven. Missing `docs/domain/` is normal until a certain write exists. First-run is valid only when `docs/domain/` is absent or empty; it creates the index and exactly one populated shard atomically. A pre-existing index without every indexed shard, an orphan shard, or any other partial directory fails closed and is never overwritten or reconstructed by sweeping code. Existing-model update reads the index, selects only scope rows relevant to evidence already in hand, and reads only those shards.

This skill is the **sole writer** of `docs/domain/index.md` and `docs/domain/<scope>.md`. Other skills may notice a signal and invoke it, but never edit the domain model themselves.

## Scaling boundary

Shard by a stable **bounded context**, never by feature, ticket, package path, or individual term. Many features reuse one context shard; a feature gets no file merely because it exists. Create a new scope only when evidence establishes durable vocabulary or decisions with an owner meaningfully distinct from every indexed scope. Use lowercase kebab-case scope slugs. A genuinely cross-cutting concept may use a `shared` scope, but `shared` is not a dumping ground.

The index stays small—one row per bounded context. A caller reads `docs/domain/index.md` only after a domain signal exists, then reads the minimum relevant shard set. Never open all shards by default, and never merge unrelated scopes back into one growing file.

## Conservative context harvest

Run this flow only **after the caller selects its owner and Invocation Mode**:

0. **Confirm write authority first.** Explicit domain work and write-authorized non-trivial caller modes remain eligible. Standalone advisory/read-only work, Standalone review, and Nano are report-only no-op modes even with strong evidence.
1. **Start with selected-owner evidence.** Reuse the prompt, spec/task brief, and code/docs already needed for that owner. Raw occurrence counts are not evidence.
2. **Require a durable signal before domain reads.** A candidate is a recurring project-specific concept whose meaning matters across features, or an explicit architectural decision with evidenced rationale.
3. **Resolve ownership.** Map the candidate to exactly one indexed bounded context. If no scope exists, create one only when the evidence proves a durable ownership boundary; otherwise the outcome is `candidate` or `none`.
4. **Reject weak signals.** Generic vocabulary, one-off identifiers, implementation details, feature-local wording, reversible preferences, and code shape without rationale are `none`.
5. **Choose exactly one outcome:**
   - **none** — no authority, durable signal, sufficient evidence, or stable scope; write nothing.
   - **candidate** — before approval only, material ambiguity about meaning, ownership, or trade-off; ask one focused question and write nothing.
   - **write** — evidence establishes the term/decision and owning scope; update exactly one shard, plus the index only when creating that scope.

### Glossary scenario matrix

| Scenario | Evidence and phase | Deterministic outcome |
|---|---|---|
| Certain recurring domain term | Relevant code/docs establish one durable meaning and one owning context | Write exactly one term row in the owning shard |
| Feature-local term | Meaning is confined to one feature and has no durable cross-feature role | `none`; do not create a feature shard |
| Ambiguous overloaded term | Before approval, evidence supports materially different meanings or owners | `candidate`; ask one focused question and write nothing |
| Missing domain directory | No domain signal exists | `none`; create no index or empty shard |
| New durable bounded context | Evidence establishes vocabulary/decisions with distinct long-lived ownership | Atomically add one sorted index row and one populated shard |

## Ambiguity by phase

- **Before approval:** material uncertainty requires exactly one focused question and no write until resolved.
- **After approval:** ask zero documentation questions. Load-bearing AC/interface/invariant ambiguity returns to `gsd-executing-plans` as Spec escalation; otherwise skip the domain write.

## Markdown contracts

All domain files are UTF-8/LF Markdown with exact headings and one terminal newline. They permit no trailing whitespace, duplicate IDs, duplicate terms, unknown sections, empty required values, or literal `|` inside a table cell.

`docs/domain/index.md`:

```markdown
# Domain Model

## Scopes

| Scope | File | Purpose |
| --- | --- | --- |
| billing | `billing.md` | Invoicing, settlement, and payment ownership. |
```

Index rows are sorted by scope. `Scope` is lowercase kebab-case, `File` is exactly `<scope>.md`, every row resolves to one shard, and every shard has one row. `Purpose` states the durable boundary, not a feature list.

`docs/domain/<scope>.md`:

```markdown
# Domain Scope

## Scope

`billing`

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| Settlement | The final application of captured funds to an invoice. | payment completion |

## Decisions

### D-billing-1: Keep settlement owned by billing

- **Decision:** Billing owns settlement state transitions.
- **Rationale:** The invoice lifecycle is the only boundary that can preserve settlement invariants.
```

Terms are sorted lexicographically by `Term`; stable identity is scope+term. Decisions are sequential within a shard as `D-<scope>-N`, and each contains exactly one non-empty `Decision` bullet followed by one non-empty `Rationale` bullet. Empty `Terms` or `Decisions` may contain exactly `None.`; a shard itself must contain at least one real term or decision.

## Decision capture

Write a decision only when all three gates hold:
1. hard to reverse;
2. surprising without context;
3. the result of a real trade-off.

Evidence must state what was chosen, the meaningful alternative or constraint, and why the trade-off favored the choice. Read only the owning shard's related decisions before dedupe/update. If the rationale already exists, no-op; if the same decision evolved, update it; otherwise append the next scope-local ID. Never duplicate rationale.

## Tracked-document lifecycle

The domain directory is Git-tracked durable documentation, never scratch or runtime state. After a certain write, return every exact changed path to the master. Creating a scope returns both `docs/domain/index.md` and its shard; updating a scope returns only that shard. Pre-approval writes remain intentional working-tree changes until one plan task owns every returned path. Post-approval in-scope writes commit with the task whose evidence owns them. Never create a generic documentation commit or silently exclude a valid domain write.
