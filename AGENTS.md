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
- Read `design/AGENTS.md` and `design/DESIGN.md` before touching anything under `design/`; those files own the token, primitive, and check contracts for the prototype. If they are missing, first create or adapt them from the shipped example in `skills/gsd-prototyping/template/`, then follow them.
- Keep prototype artifacts under `design/`. Never scatter tokens, primitives, or surface docs into production directories.
- A locked prototype is the source of truth for user-facing surface behavior. Production UI code converts from it, so change `design/` first, lock it, then convert; never let production markup and styling drift ahead of the prototype it came from.
- A plan touching user-facing surfaces declares its `UI Impact`, naming the `design/` prototype paths it works from; a plan converting a locked prototype into production code also names the production surfaces it converts to. Backend-only work has no design impact and declares `Classification: none`.
- Record an accepted review rule that constrains every comparable surface in `design/docs/interaction-rules.md`, and keep each surface's own states and flows in its own document under `design/docs/`.
- Any AI design tool may write into `design/`; ignore its runtime output rather than committing it. The shipped template is a copyable example of clean structure, not a required file layout, so a tool that scaffolds a single HTML file is a valid starting point to grow from.
- Existing repositories adopt this flow for design-related work only; pure backend modules keep their current flow unchanged.
- Upsert this canonical `## Design documentation` section once. Preserve unrelated instructions and never append a duplicate section.
