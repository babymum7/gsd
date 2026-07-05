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
- `CONTEXT.md` — the glossary (**this skill is its sole writer**; others read it for vocabulary). Single context at root; if `CONTEXT-MAP.md` exists, multiple contexts (map points to each).
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
