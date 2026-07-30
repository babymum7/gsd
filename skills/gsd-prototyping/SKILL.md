---
name: gsd-prototyping
description: "Use to lock explicit new or changed user-facing surface intent, a named screen, page, or UI, in a tested design prototype before requirements converge."
produces: []
consumes: [docs/domain/index.md, docs/domain/<scope>.md, AGENTS.md]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Do-not-load: a generic feature or integration request naming no surface; backend-only work; production surface edits (reuse-prototype conversion)
- Transition: on prototype lock ask the conversion cadence, then load `gsd-brainstorming` only for convert now

# Prototyping

> **Invocation guard** — this skill owns prototype-first surface convergence only. It writes prototype files under `design/` and authors no lifecycle artifact itself; `plan.md`, `state.toon`, and `wip/<feature>` stay owned by the peers it transitions into. Design-first is the default order for surface work, not a gate: a locked surface is changed again in `Existing surface change`, and a different or unclear order asks one question. Select an Invocation Mode before validating its Required artifacts, then apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| New surface prototype | explicit new user-facing surface intent | existing `design/` directory; affected domain shards | `design/` prototype files and surface docs | ask one question naming the missing surface |
| Existing surface change | the current `design/` prototype for that surface | affected domain shards | changed prototype files and surface docs | prototype absent for a shipped surface: prototype it first in `New surface prototype` |
| Prototype review | the current `design/` prototype | supplied screenshots or feedback | changed prototype files and surface docs | ask which surface to review |

## Design standard

The prototype is real code under a repository-root `design/` directory, seeded from this skill's `template/` directory. Copy it once; never edit the template to serve one feature. The repository-root `AGENTS.md` is the only agent contract and governs `design/` too; `design/DESIGN.md` is a design artifact recording the structure that directory uses, never a second instruction file.

The bound obligations are outcomes, not one tool's invocation: any design tool may produce the surface, every generated design artifact is committed under `design/` while the tool's own runtime output stays uncommitted, and the result is decomposed rather than one file. Mechanics named beside an obligation are this template's example, never the rule. Reading the interaction-rule ledger below is required by the rules already recorded in it, which constrain every surface change whether or not an obligation applies.

- Every color, spacing, radius, and type value comes from a declared token, never an inline literal. The template declares them as CSS custom properties in `css/tokens.css` with JSON reference sources under `tokens/`; any equivalent token layer satisfies this.
- Repeated markup becomes one extracted component consuming only those token values. The template extracts light-DOM custom elements because it is dependency-free; a project on a component framework uses that framework instead.
- Every extracted component carries a headless behavior test; one-off page composition needs none.
- One deterministic check loop: `check:fast` lints CSS for inline literals and runs headless component tests; it is browser-free, runs after every change, and is also the lock gate, so the prototype carries no second slower suite. Coverage is what makes a headless gate sufficient, so every state a surface document lists carries a headless test of its own.
- The prototype is built and used like a real app from the first commit, without a backend and without shipping to production, so it carries a real structure: separate files per concern, extracted components, and one document per surface.
- Design work is governed by the root `AGENTS.md` plus `design/DESIGN.md` whether the agent works from the repository root or from inside `design/`; a single-file result is still an input, so decompose it into that structure before lock.
- Read `design/docs/interaction-rules.md` before changing a surface: its rules already constrain what that surface may do, so a new surface satisfies them instead of relitigating them. Keep every rule product-neutral so the ledger stays reusable across projects.

## Prototype review

Review turns the user's reaction into artifacts. For every accepted feedback item, record it in the same turn as the prototype change it causes, never as a promise for later:

- A rule that holds beyond this surface is system-wide: append it to `design/docs/interaction-rules.md` as the next `IR-<n>`, with its observable trigger and required behavior. Keep existing ids stable; never renumber or reuse one.
- A decision that binds only this surface is surface-specific: record it in that surface's document under `design/docs/`.
- A rejected or deferred item is recorded nowhere; it stays one concise discussion note.

Cite the id when a later surface follows an existing rule, and amend that rule's entry rather than duplicating it when review changes what it requires.

## Lock criteria

A surface is locked when all of these hold:

1. Every state a user can reach is rendered: empty, loading, populated, error, and each permission variant the surface exposes.
2. Every flow between those states is reachable in the prototype, not described in prose.
3. `check:fast` is green on the current prototype bytes, and a headless test covers each state criterion 1 lists.
4. The surface document under `design/docs/` lists those states and flows, matching what the prototype renders.
5. No accepted review feedback is unrecorded: every accepted system-wide rule exists as an `IR-<n>` entry and every accepted surface-specific decision exists in the surface document.
6. The surface is decomposed, not one undifferentiated file: markup, styles, tokens, components, and its document are separate artifacts under `design/`.
7. The surface document declares its `## Production surfaces`: the sorted production paths converted from it, or exactly `none` before conversion, declares its `## Conversion` state as `converted` or `pending`, and every `IR-<n>` it cites exists in `design/docs/interaction-rules.md`. `node "<GSD_ROOT>/tools/gsd-contract.mjs" validate-design-map --path design/docs` exits 0.

Anything unresolved stays one concise discussion note. Do not invent configuration, theming, or extensibility that no locked state requires.

## Transition

On prototype lock, ask the user one question: convert this surface into production now, or hold it for a later batch conversion. Ask it once, with both options named, and take the answer as given.

For convert now, load `gsd-brainstorming` and pass the locked prototype as fixed UI behavior plus the exact prototype paths. The prototype constrains surface behavior; `plan.md` remains the sole pre-approval authority, and `gsd-to-plan` records the resulting `UI Impact` classification, surfaces, and prototype paths.

For a later batch, stop here: report the surface as locked and awaiting conversion, and author no lifecycle artifact, since nothing is being planned yet.

Both answers leave the surface document's `## Conversion` state as `pending`, so deferring records nothing the immediate path would not have written. That declared state is the queue: `node "<GSD_ROOT>/tools/gsd-contract.mjs" validate-design-map --path design/docs` counts how many surfaces still read `pending`, so a held surface is rediscoverable without a second file to keep in sync.

Prototype work is its own feature packet, then the implementation feature follows as a second packet; both reuse the existing resume, verification, and cleanup contracts, so no new `state.toon` phase value exists. A prototype-only packet has no production journey to exercise, so it carries no Deferred Slow E2E stage: the one browser-free check loop is its whole gate. Scope growth beyond the surface exits to `gsd-brainstorming` instead of widening the prototype.

Domain Impact is unchanged by prototype-only work: a prototype ships no production semantics, so classify it `none` unless the surface itself changes shipped behavior.
