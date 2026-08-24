---
name: gsd-codebase-architecture
description: "Use for a named module or interface design, a scoped architecture audit or refactor, or an architectural cause returned by diagnosis."
produces: []
consumes: [docs/domain/index.md, docs/domain/<scope>.md]
---

## Dispatch contract

Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).

- Role: owner
- Do-not-load: unrelated broad exploration or feature behavior whose architecture has no unresolved seam
- Transition: a selected candidate enters `gsd-brainstorming`; bound execution returns bounded evidence or Spec escalation to its session owner

# Codebase Architecture

> **Invocation guard** — automatic selection loads this skill for explicit interface/architecture intent or diagnosis-returned architectural evidence. Select one mode before validating only that row. Missing optional domain docs never invent authority or widen scope.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
| --- | --- | --- | --- | --- |
| Named seam design | named module, interface, seam, or bounded area | mapped domain context | recommendation | ask one focused target question; never survey the repository to invent a target |
| Standalone architecture audit | user-requested area or explicit whole-codebase intent | mapped domain context | ranked deepening candidates | ask one focused scope question only when no area is supplied |
| Post-diagnosis architecture | bounded root-cause evidence | mapped domain context | candidate or execution blocker | return to diagnosis when the architectural cause is not evidenced |

Named seam design reads target and direct callers/dependencies only. Scoped audits read requested areas and direct dependencies. Whole-codebase walks require explicit request. Stay in tracked production paths; skip nested repos, submodules, dependencies, build outputs, vendored code, and ignored files.

## Vocabulary

Use these terms exactly:

- **Module** — unit with interface and implementation: function, class, package, service, or domain slice.
- **Interface** — everything callers must know: signatures, invariants, ordering, failure modes, configuration, and performance commitments.
- **Implementation** — behavior hidden inside a module; distinct from an adapter's role at a seam.
- **Depth** — behavior and complexity hidden per unit of caller knowledge. A deep module gives high leverage behind a small interface.
- **Seam** — stable boundary where behavior is observed or substituted.
- **Adapter** — concrete implementation occupying a seam; a role, not a synonym for every wrapper.
- **Leverage** — capability reused across callers and tests per unit of interface learned.
- **Locality** — business knowledge, change, bugs, and verification concentrated behind the owning seam.

Prefer deep modules. A shallow module exposes an interface nearly as complex as its implementation or forwards calls without owning policy.

## Domain-aligned architecture

A bounded context is a semantic and language boundary, not automatically a service, package, frontend, backend, or database. Prefer vertical capability slices over horizontal buckets scattering domain behavior.

Default to a modular monolith. Recommend process/service boundaries only with evidenced independent ownership, deployment, scaling, security, or failure isolation.

### Backend

- Place business terms, invariants, policies, transitions, and calculations in their owning context.
- Use application services for orchestration, command/query handling, and transaction boundaries.
- Keep persistence entities and transport shapes behind mapping boundaries.
- Use explicit contracts or anti-corruption adapters between contexts.
- Emit domain events only for production facts with real consumers; never turn function calls into event infrastructure.

### Frontend

- Organize by user intent and domain capability, not only pages, components, hooks, and utilities.
- Separate server state, local UI state, and interaction/application state.
- Map API DTOs at boundaries; never share persistence entities as frontend models.
- Preserve backend authority for authorization and invariants; frontend policy shapes UI/interaction without replacing server enforcement.

### Framework independence

Keep domain/application policy independent of UI, transport, persistence, and framework APIs. Keep adapters idiomatic to the selected framework. Do not wrap stable framework APIs merely to appear framework-neutral.

## Seam discipline

- Apply the deletion test: if deleting the module spreads complexity back across callers, the module earns its interface; if complexity vanishes, it was pass-through ceremony.
- One production adapter alone is a hypothetical seam. Introduce an interface when at least one additional justified adapter or a real ownership/transport boundary exists.
- Keep internal test seams private. Tests observe the public interface and survive internal refactors.
- Prefer atomic caller migration. Use Expand → Migrate → Contract only when compatibility prevents atomic cutover and caller inventory is complete.

Optional dependency and testing guidance, read only when deepening a module: [DEEPENING.md](DEEPENING.md).

## Conditional logic

Conditionals are not architectural defects alone:

1. Keep simple validation and early exits as guard clauses.
2. Use exhaustive branching for small closed variant sets.
3. Name a policy/function when a business rule deserves domain language.
4. Use decision tables when independent conditions combine.
5. Use state machines when lifecycle transitions and invalid moves matter.
6. Use strategies/registries for open-ended variants.
7. Use polymorphism only when stable meaningful types own substantial distinct behavior.

Do not create class hierarchies, registries, or configuration to remove readable local branches.

## Explore and design

1. Identify production capability/context, callers, owned data, invariants, dependencies, and public test seam.
2. Locate evidenced friction: duplicated policy, concepts bouncing across shallow modules, leaky seams, wrong dependency direction, transport/persistence types escaping, or behavior without a stable test surface.
3. Classify each dependency as `in-process`, `local-substitutable`, `remote but owned`, or `true external`.
4. For a named seam or selected candidate, run the independent comparison in [DESIGN-IT-TWICE.md](DESIGN-IT-TWICE.md).
5. Recommend the smallest boundary change restoring locality. Do not refactor unrelated contexts.

## Candidate contract

Each candidate states:

- recommendation strength: `Strong`, `Worth exploring`, or `Speculative`;
- current domain/context boundary and production evidence;
- affected files and dependency category;
- friction and violated dependency direction;
- before/after sketch and target seam;
- migration shape, including compatibility and rollback;
- leverage, locality, and testability wins;
- backend and frontend effects;
- tests that survive;
- domain-documentation impact.

In standalone work, present ranked candidates and ask the user to select one before feature design or code changes. A selected candidate transitions to `gsd-brainstorming`.

Inside bound execution, candidates are report-only. If the current acceptance contract requires the architecture change but does not authorize it, return a Spec-escalation blocker. Otherwise record the strongest future candidate and resume execution without widening scope.

## Domain context

When `docs/domain/index.md` exists, read only mapped shards for the affected contexts and use their production terminology exactly. Do not suggest a broad domain scan. When the index is absent, absence is normal; feature transitions follow lifecycle feature-scoped bootstrap and optional broad-bootstrap decisions. Never invent domain docs or treat repository prose as production authority.
