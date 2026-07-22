---
name: gsd-domain-modeling
description: "Use when already-bounded work reveals a durable project-specific term or an evidenced architectural decision requiring the canonical domain model. Do not scan for terminology proactively or write during read-only or Nano work."
triggers: explicit domain-model work or a durable term or decision found in already-bounded evidence
produces: [docs/domain/index.md, docs/domain/<scope>.md]
consumes: [docs/domain/index.md, docs/domain/<scope>.md]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: helper
- Helper-when: must load when a durable domain candidate is certain; cannot be skipped while that condition holds
- Do-not-load: proactive repository scans; uncertain candidates
- Transition: return exact changed domain paths to the session owner

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

Shard by a stable **bounded context**, never by feature, ticket, package path, or individual term. Create a new scope only when evidence establishes durable vocabulary/decisions with ownership distinct from every indexed scope. Use lowercase kebab-case scope slugs; `shared` is only for genuinely cross-cutting concepts, not a dump.

The index stays small—one row per bounded context. After a domain signal, read the index then the minimum relevant shards. Never open all shards by default or merge unrelated scopes into one growing file.

## Conservative context harvest

Run only **after the caller selects its owner and Invocation Mode**:

0. Confirm write authority (explicit domain work / write-authorized non-trivial modes). Standalone advisory/read-only, Standalone review, and Nano are report-only no-ops.
1. Start with selected-owner evidence already in hand. Raw occurrence counts are not evidence.
2. Require a durable signal: recurring project-specific concept across features, or an explicit architectural decision with evidenced rationale.
3. Map to exactly one indexed bounded context; create a scope only when evidence proves distinct durable ownership.
4. Reject weak signals (generic vocabulary, one-offs, implementation details, feature-local wording, reversible preferences, code shape without rationale) as `none`.
5. Choose exactly one outcome: **none** (write nothing), **candidate** (pre-approval only: one focused question, write nothing), or **write** (update exactly one shard; index only when creating that scope).


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

Domain docs are Git-tracked durable documentation, never scratch/runtime state. After a certain write, return every exact changed path. Creating a scope returns `docs/domain/index.md` and its shard; updating returns only that shard. Pre-approval writes stay intentional until one plan task owns them; post-approval writes commit with the owning task. Never invent a generic documentation commit or drop a valid domain write.
