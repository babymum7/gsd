---
name: gsd-domain-modeling
description: Internal GSD sub-skill (routed via /gsd). Build/sharpen the project's domain model — challenge terms, sharpen fuzzy language, capture decisions to `CONTEXT.md`/ADR. Auto-triggered when a durable term/decision crystallizes; also invokable directly to sharpen the glossary.
triggers: durable term/decision crystallizes (auto); invokable directly
produces: [CONTEXT.md, CONTEXT-MAP.md, docs/adr/]
consumes: [CONTEXT.md]
---

# Domain Modeling

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Invoked standalone with its `consumes:` artifacts missing → load the `gsd` skill and enter through its router (it detects workspace state); don't improvise missing context.

The *active* discipline: challenge terms, invent edge-case scenarios, and write the glossary/decisions down the moment they crystallize. (Merely reading `CONTEXT.md` for vocabulary is a one-line habit any skill does — this skill is for *changing* the model.)

Triggered by `gsd` / `gsd-executing-plans` / `gsd-improve-codebase-architecture` when a durable term or decision surfaces; also invokable directly to sharpen the glossary.

## Files (lazy — create only when you have something to write)
- `CONTEXT.md` — the glossary (**this skill is its sole writer**; others read it for vocabulary). Single context at root — most projects never need more.
- `CONTEXT-MAP.md` — the index of contexts, created **only** when a second context appears (two areas legitimately define the same term differently — e.g. `Order` in Sales vs Fulfilment). Until then there is one root `CONTEXT.md` and no map. When you split: create `docs/context/<area>/CONTEXT.md` per area, then write the map at root pointing at each. Format — a table of area → path → the terms it owns; keep it in sync when a context is added, moved, or a term changes owner:
  ```
  # Context Map
  | Context | Glossary | Owns |
  |---------|----------|------|
  | Sales | docs/context/sales/CONTEXT.md | Order, Customer, Quote |
  | Fulfilment | docs/context/fulfilment/CONTEXT.md | Order, Shipment, Pick |
  ```
  A term defined in two contexts (`Order` above) is expected — the map is what makes the clash explicit; each context's own `CONTEXT.md` defines its meaning. **Read/selection rule**: when `CONTEXT-MAP.md` exists, consult it first and pick the relevant area's `docs/context/<area>/CONTEXT.md` before using or editing a term; a new area-specific glossary means adding/updating its row.
- `docs/adr/` — architectural decisions.

## During discussion
- **Challenge against the glossary** — a term conflicting with `CONTEXT.md`? Call it out now.
- **Sharpen fuzzy language** — propose a precise canonical term ("'account' — Customer or User?").
- **Stress-test with concrete scenarios** — probe edge cases at concept boundaries.
- **Cross-reference code** — if stated behavior contradicts the code, surface it.
- **Update `CONTEXT.md` inline** as terms resolve — don't batch.

## `CONTEXT.md` — glossary only
No implementation details, no specs, no scratch. **Project-specific terms only** — general programming concepts (timeouts, error types, utility patterns) don't belong even if the code uses them. Be opinionated: pick ONE word per concept, list synonyms under `_Avoid_`, define what it IS (1-2 sentences) not what it does. Entry: `**Order**: <what it is, 1-2 sentences>. _Avoid_: Purchase, transaction.`

## Offer an ADR only when ALL three hold
1. Hard to reverse.
2. Surprising without context (a future reader asks "why?").
3. The result of a real trade-off.
Missing any → skip the ADR. Otherwise write `docs/adr/NNNN-slug.md` (sequential, created lazily): `# {title}` + 1-3 sentences (context, decision, why). Optional sections (Status, Considered Options, Consequences) only when they add value — most ADRs are one paragraph.
