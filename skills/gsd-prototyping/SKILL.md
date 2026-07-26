---
name: gsd-prototyping
description: "Use to lock new or changed user-facing surface behavior in a tested design prototype before requirements converge."
produces: []
consumes: [docs/domain/index.md, docs/domain/<scope>.md, AGENTS.md]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Do-not-load: backend-only work; a surface already locked by a current `design/` prototype
- Transition: on prototype lock load `gsd-brainstorming`

# Prototyping

> **Invocation guard** — this skill owns prototype-first surface convergence only. It writes prototype files under `design/` and authors no lifecycle artifact itself; `plan.md`, `state.toon`, and `wip/<feature>` stay owned by the peers it transitions into. Select an Invocation Mode before validating its Required artifacts, then apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| New surface prototype | explicit new user-facing surface intent | existing `design/` directory; affected domain shards | `design/` prototype files and surface docs | ask one question naming the missing surface |
| Existing surface change | the current `design/` prototype for that surface | affected domain shards | changed prototype files and surface docs | prototype absent for a shipped surface: prototype it first in `New surface prototype` |
| Prototype review | the current `design/` prototype | supplied screenshots or feedback | changed prototype files and surface docs | ask which surface to review |

## Design standard

The prototype is real code under a repository-root `design/` directory, seeded from this skill's `template/` directory. Copy it once; never edit the template to serve one feature. The repository-root `AGENTS.md` is the only agent contract and governs `design/` too; `design/DESIGN.md` is a design artifact recording the structure that directory uses, never a second instruction file.

- Every color, spacing, radius, and type value comes from a declared token, never an inline literal. The template declares them as DTCG JSON built into CSS custom properties; any equivalent token layer satisfies this.
- Repeated markup becomes one extracted component consuming only those token values. The template extracts light-DOM custom elements because it is dependency-free; a project on a component framework uses that framework instead.
- Every extracted component carries a headless behavior test; one-off page composition needs none.
- Checks split by cost: a deterministic browser-free loop after every change, and a browser suite gating lock. The template names them `check:fast` and `check:slow`.
- The prototype is built and used like a real app from the first commit, without a backend and without shipping to production, so it carries a real structure: separate files per concern, extracted components, and one document per surface.
- Configure the design tool against this repository instead of assuming its defaults: its working directory is set to the repository root, its generated design files are targeted at `design/`, and the root `AGENTS.md` plus `design/DESIGN.md` are supplied as its context. Require a run whose agent writes files rather than one that returns a single inline artifact block, so the surface arrives separated; a single-file artifact is still an input, so decompose it into that structure before lock.
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
3. `check:fast` and `check:slow` are both green on the current prototype bytes.
4. The surface document under `design/docs/` lists those states and flows, matching what the prototype renders.
5. No accepted review feedback is unrecorded: every accepted system-wide rule exists as an `IR-<n>` entry and every accepted surface-specific decision exists in the surface document.
6. The surface is decomposed, not one undifferentiated file: markup, styles, tokens, components, and its document are separate artifacts under `design/`.

Anything unresolved stays one concise discussion note. Do not invent configuration, theming, or extensibility that no locked state requires.

## Transition

On prototype lock, load `gsd-brainstorming` and pass the locked prototype as fixed UI behavior plus the exact prototype paths. The prototype constrains surface behavior; `plan.md` remains the sole pre-approval authority, and `gsd-to-plan` records the resulting `UI Impact` classification, surfaces, and prototype paths.

Prototype work is its own feature packet, then the implementation feature follows as a second packet; both reuse the existing resume, verification, and cleanup contracts, so no new `state.toon` phase value exists. Scope growth beyond the surface exits to `gsd-brainstorming` instead of widening the prototype.

Domain Impact is unchanged by prototype-only work: a prototype ships no production semantics, so classify it `none` unless the surface itself changes shipped behavior.
