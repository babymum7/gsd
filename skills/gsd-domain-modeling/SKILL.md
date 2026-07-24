---
name: gsd-domain-modeling
description: "Use when Domain Impact changes production semantics or explicit domain-model work needs current bounded-context documentation. Writes only affected contexts; broad bootstrap is possible only when the index is absent."
triggers: non-none Domain Impact or explicit domain-model work
produces: [docs/domain/index.md, docs/domain/<scope>.md, AGENTS.md]
consumes: [docs/domain/index.md, docs/domain/<scope>.md, AGENTS.md]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: helper
- Helper-when: must load when Domain Impact is not `none` or explicit domain-model work is selected; cannot be skipped while that condition holds
- Do-not-load: read-only or Nano work; uncertain or unrelated contexts
- Transition: return exact changed domain and AGENTS paths to the session owner

# Domain Modeling

> **Invocation guard** — the active owner supplies bounded Domain Impact or explicit domain-model intent. Select one mode before validating only that row. Existing documentation is a navigation hint; production code, schemas, contracts, and tests are authoritative when facts conflict.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
| --- | --- | --- | --- | --- |
| Existing-index affected update | valid `docs/domain/index.md`; every mapped affected shard | `AGENTS.md` | affected shards; canonical AGENTS section | malformed index, missing mapped shard, orphan shard, or any other partial directory fails closed |
| Absent-index feature bootstrap | bounded non-`none` Domain Impact | `AGENTS.md` | index; required feature-scoped shards; canonical AGENTS section | ambiguous context ownership returns one pre-approval question or post-approval Spec escalation |
| Absent-index broad bootstrap | explicit `Broad bootstrap: selected` plus bounded feature impact | `AGENTS.md` | index; required feature shards; additional evidenced context shards; canonical AGENTS section | no explicit selection means feature-scoped bootstrap only |

This skill is the **sole writer** of `docs/domain/index.md`, `docs/domain/<scope>.md`, and the canonical GSD section in `AGENTS.md`. Other skills classify impact and invoke it but never edit these contracts.

## Domain lifecycle

1. Consume exact `Domain Impact`: classification, sorted contexts, documentation action, broad-bootstrap disposition, and evidence. `none` writes nothing and must justify why production semantics are unchanged.
2. When `docs/domain/index.md` exists, validate the index and all referenced files, then read and update only mapped affected shards. Never offer or suggest a broad codebase/domain scan. A new affected context is allowed only when evidence proves a real boundary change.
3. When `docs/domain/index.md` is absent, every non-`none` impact bootstraps the required feature-scoped context docs. Only in this absence case may brainstorming offer a broad bootstrap. `declined` remains a valid choice; declining broad bootstrap never waives or skips required affected-context documentation.
4. If broad bootstrap is selected, inspect only tracked production code, schemas, contracts, and tests; skip dependencies, generated output, vendored code, nested repositories, and ignored paths. Create only evidenced stable contexts. Broad selection never changes the feature's acceptance scope.
5. Write target behavior before approval only when certain. During execution, update the same shards to current production behavior in the same task as the implementing code. Never preserve obsolete behavior as history.
6. Upsert one `## Domain documentation` section in the applicable `AGENTS.md`: preserve unrelated instructions, replace the existing canonical section when present, and never append a duplicate.

## Bounded-context rules

Shard by stable production capability and language ownership, never by feature, ticket, package, page, layer, or individual term. A bounded context is not automatically a service, frontend area, backend package, or database. Use lowercase kebab-case slugs; `shared` is only for genuinely cross-cutting semantics.

The index remains sorted and small. Do not read unrelated shards, merge unrelated contexts, or move a boundary without `change-context-boundary` evidence. Domain docs record production meaning, not dependency choices, framework patterns, refactor rationale, or future design.

## Markdown contracts

All domain files are UTF-8/LF Markdown with exact headings and one terminal newline. They permit no trailing whitespace, duplicate terms/policy IDs, unknown sections, empty required values, or literal `|` inside table cells.

`docs/domain/index.md`:

```markdown
# Domain Model

## Scopes

| Scope | File | Purpose |
| --- | --- | --- |
| billing | `billing.md` | Invoicing, settlement, and payment ownership. |
```

Rows are sorted by `Scope`. `File` is exactly `<scope>.md`; every row resolves to one shard and every shard has one row. `Purpose` states the durable production responsibility, not a feature list.

`docs/domain/<scope>.md`:

```markdown
# Domain Scope

## Scope

`billing`

## Purpose and responsibilities

Own invoice lifecycle, settlement rules, and payment outcomes.

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| Settlement | Final application of captured funds to an invoice. | payment completion |

## Actors

- Billing operator — corrects invoices within policy.

## Invariants

- A settled invoice cannot return to unpaid.

## Workflows and state transitions

### Settle an invoice

1. Receive captured-funds evidence.
2. Move an eligible invoice from payable to settled.

## Commands, events, and outcomes

| Command or event | Actor | Outcome |
| --- | --- | --- |
| Settle invoice | Billing service | Invoice is settled or rejected by an invariant. |

## Context relationships

| Context | Relationship |
| --- | --- |
| payments | Supplies captured-funds facts; billing owns settlement meaning. |

## Domain policies

### P-billing-1: Settlement is final

- **Policy:** A settled invoice never returns to unpaid.
- **Reason:** Reopening settlement would contradict the recorded funds outcome.
```

Headings appear exactly in the shown order. Terms are lexicographically sorted. Actors and invariants are concrete bullets. Workflows describe current triggers, state transitions, and outcomes. Commands/events name their actor and observable outcome. Relationships state semantic ownership between contexts. Policies are sequential `P-<scope>-N` blocks with `Policy` then `Reason`; they capture enduring business or workflow rules, not technical architecture decisions. A non-applicable content section may contain exactly `None.`, but each shard must describe real current production behavior.

## Tracked-document lifecycle

Return every exact changed path. Creating domain documentation returns `docs/domain/index.md`, each created shard, and `AGENTS.md` when its canonical section changed. Updating returns only affected shards plus `AGENTS.md` if upsert changed it. Pre-approval paths become exact structured plan file intents; post-approval changes commit in the same owning task as code. Never create a generic documentation-only task or drop a required domain write.
