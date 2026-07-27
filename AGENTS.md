# Agent instructions

## Domain documentation

<!-- gsd:domain-documentation -->
- Treat `docs/domain/index.md` and its mapped shards as concise descriptions of current production business behavior, not implementation plans or architecture journals.
- For every semantic change, update the affected `docs/domain/<scope>.md` in the same owning task. If there is no domain impact, record a concrete `No domain impact` justification in the plan.
- Existing domain docs are navigation hints; production code, schemas, contracts, and tests are authoritative when they conflict. Resolve drift before completion.
- When `docs/domain/index.md` exists, read only affected mapped contexts and do not propose a broad codebase/domain scan. A broad bootstrap may be offered only when the index is absent; declining it never skips required feature-scoped context documentation.
- Upsert this canonical `## Domain documentation` section once. Preserve unrelated instructions and never append a duplicate section.

## Design documentation

<!-- gsd:design-documentation -->
- This root `AGENTS.md` is the only agent contract in this repository, for production code and for the prototype alike: it is supplied as the design tool agent's context rather than derived from where that agent runs, and a nested `design/` instruction file would compete with this section. Design *artifacts* live under `design/`; agent *instructions* live here.
- The prototype under `design/` is built and used like a real app from the first commit, only without a backend and without shipping to production. Apply the same architecture discipline: separate files per concern, repeated markup extracted into components, visual values from tokens, and one document per surface. `design/DESIGN.md` records the structure that directory actually uses.
- Keep prototype artifacts under `design/`. Never scatter tokens, primitives, or surface docs into production directories.
- A locked prototype is the source of truth for user-facing surface behavior. Production UI code converts from it, so change `design/` first, lock it, then convert; never let production markup and styling drift ahead of the prototype it came from.
- A plan touching user-facing surfaces declares its `UI Impact`, naming the `design/` prototype paths it works from; a plan converting a locked prototype into production code also names the production surfaces it converts to. Backend-only work has no design impact and declares `Classification: none`.
- Record an accepted review rule that constrains every comparable surface in `design/docs/interaction-rules.md`, and keep each surface's own states and flows in its own document under `design/docs/`.
- Any AI design tool may produce the prototype; this repository constrains what it leaves behind, not how it is invoked. An agent doing design work is governed by this file plus `design/DESIGN.md` as its standing context, whether it works from this repository root or from inside `design/`. Every generated design artifact is committed under `design/` and nowhere else, and each tool's own runtime output stays uncommitted. A single-file artifact is an input, not a resting state: decompose it into separate markup, styles, tokens, components, and surface documents before the surface locks. Never leave a locked surface as one undifferentiated file.
- Existing repositories adopt this flow for design-related work only; pure backend modules keep their current flow unchanged.
- Upsert this canonical `## Design documentation` section once. Preserve unrelated instructions and never append a duplicate section.
