---
name: gsd-domain-modeling
description: "Use when Domain Impact changes production semantics or explicit domain-model work needs current bounded-context documentation."
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

> **Invocation guard** — Active owner supplies bounded Domain Impact or explicit domain-model intent. Validate only selected mode row. Existing documentation is a navigation hint; production code, schemas, contracts, and tests are authoritative on conflict.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
| --- | --- | --- | --- | --- |
| Pre-binding affected mapping | bounded non-`none` Domain Impact | valid index; affected mapped shards; `AGENTS.md` | exact affected paths | ambiguous ownership returns one focused question; malformed supplied documentation fails closed |
| Existing-index execution update | valid `docs/domain/index.md`; every mapped affected shard | `AGENTS.md` | affected shards; canonical AGENTS sections | malformed index, missing mapped shard, orphan shard, or any other partial directory fails closed |
| Absent-index feature bootstrap | bounded non-`none` Domain Impact | `AGENTS.md` | index; required feature-scoped shards; canonical AGENTS sections | ambiguous context ownership returns one pre-binding question or post-binding Spec escalation |
| Absent-index broad bootstrap | explicit `Broad bootstrap: selected` plus bounded feature impact | `AGENTS.md` | index; required feature shards; additional evidenced context shards; canonical AGENTS sections | no explicit selection means feature-scoped bootstrap only |

This skill is the **sole writer** of `docs/domain/index.md`, `docs/domain/<scope>.md`, and canonical GSD sections in `AGENTS.md`. Other skills classify impact and invoke it, never editing these contracts.

## Domain lifecycle

1. Consume exact `Domain Impact`: classification, sorted contexts, documentation action, broad-bootstrap disposition, and evidence. `none` writes nothing, justifying why production semantics are unchanged.
2. When `docs/domain/index.md` exists, validate grammar and check unrelated mappings using file metadata; never read unrelated shard bodies. Read and update only mapped affected shards. Never offer or suggest a broad codebase/domain scan. New affected contexts require evidence proving a real boundary change.
3. When `docs/domain/index.md` is absent, every non-`none` impact bootstraps required feature-scoped context docs. Only in this absence case may brainstorming offer a broad bootstrap. Declining broad bootstrap never waives or skips required affected-context documentation.
4. If broad bootstrap is selected, inspect only tracked production code, schemas, contracts, and tests; skip dependencies, build output, vendored code, nested repos, and ignored paths. Create only evidenced stable contexts without altering feature acceptance scope.
5. Before binding, return the exact affected paths and write no target behavior; pre-binding bootstrap describes only shipped production behavior. During execution, update those paths to current production behavior in the same task as implementing code, never preserving obsolete behavior as history.
6. Upsert `## Domain documentation`, `## Decisions`, and `## Design` sections in `AGENTS.md`: preserve unrelated instructions, replace existing canonical sections, and never append duplicates.
7. Prove the whole model before returning: run `bun "<GSD_ROOT>/tools/gsd-domain.mjs" validate --index docs/domain/index.md --agents AGENTS.md`. Exit 0 reports a complete, sorted, well-formed model; exit 1 indicates a malformed or inconsistent model to fix before returning.

## Bounded-context rules

Shard by stable production capability and language ownership, never by feature, ticket, package, page, layer, or term. A bounded context is not inherently a service, frontend area, package, or database. Use lowercase kebab-case slugs; `shared` is reserved for cross-cutting semantics.

Keep the index sorted and small. Never read unrelated shards, merge unrelated contexts, or shift a boundary without `change-context-boundary` evidence. Domain docs record production meaning, not dependencies, framework patterns, refactor rationale, or future design.

## Markdown contracts

All domain files are UTF-8/LF Markdown with exact headings and one terminal newline, permitting no trailing whitespace, duplicate terms/policy IDs, unknown sections, empty required values, or literal `|` in table cells.

`docs/domain/index.md`:

```markdown
# Domain Model

## Scopes

| Scope | File | Purpose |
| --- | --- | --- |
| billing | `billing.md` | Invoicing, settlement, and payment ownership. |
```

Rows are sorted by `Scope`. `File` is exactly `<scope>.md`; each row resolves to one shard and each shard has one row. `Purpose` states the durable production responsibility, not a feature list.

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

Headings appear exactly in the shown order. Terms are sorted lexicographically. Actors and invariants are concrete bullets. Workflows describe current triggers, state transitions, and outcomes. Commands and events name actor and observable outcome. Relationships define semantic ownership between contexts. Policies are sequential `P-<scope>-N` blocks with `Policy` then `Reason`, capturing enduring business rules rather than technical decisions. Non-applicable sections contain exactly `None.`; each shard must describe current production behavior.

## Tracked-document lifecycle

Return all exact changed or reserved paths. Creating domain docs returns `docs/domain/index.md`, created shards, and `AGENTS.md` if its canonical section changed. Updating returns only affected shards plus `AGENTS.md` if upsert modified it. Before binding, path reservation returns exact affected paths and writes no target behavior; created prose describes only current production behavior. Reserved paths become structured plan file intents, committing in the same owning task as implementing code. Never create a generic documentation-only task or drop a required domain write.
