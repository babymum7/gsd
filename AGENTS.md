# Agent instructions

## Domain documentation

<!-- gsd:domain-documentation -->
- Treat `docs/domain/index.md` and its mapped shards as concise descriptions of current production business behavior, not implementation plans or architecture journals.
- For every semantic change, update the affected `docs/domain/<scope>.md` in the same owning task. If there is no domain impact, record a concrete `No domain impact` justification in the plan.
- Existing domain docs are navigation hints; production code, schemas, contracts, and tests are authoritative when they conflict. Resolve drift before completion.
- When `docs/domain/index.md` exists, read only affected mapped contexts and do not propose a broad codebase/domain scan. A broad bootstrap may be offered only when the index is absent; declining it never skips required feature-scoped context documentation.
- Upsert this canonical `## Domain documentation` section once. Preserve unrelated instructions and never append a duplicate section.

## Decisions

<!-- gsd:decisions -->
- Treat `docs/decisions/NNNN-slug.md` as durable records of load-bearing decisions settled during convergence; read the relevant record before re-litigating a settled choice.
- A decision record may precede implementation; its `Status` is `Accepted`, `Rejected`, or `Superseded by NNNN`, and its non-empty `## Decision` section states the locked choice.

## Design

<!-- gsd:design -->
- Treat `docs/design/NNNN-slug.md` as durable records of UI/UX decisions settled during execution; read the relevant record before changing an accepted interaction.
- Measurement is optional; a record's mandatory part is its numbered title, `Status`, `Date`, and non-empty `## Decision` section.

