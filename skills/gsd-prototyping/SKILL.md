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

The prototype is real code under a repository-root `design/` directory, seeded from this skill's `template/` directory. Copy it once; never edit the template to serve one feature.

- Every color, spacing, radius, and type value comes from a DTCG token; a raw hex color or px length in prototype CSS is a defect, not a shortcut.
- Repeated markup becomes a light-DOM custom-element primitive consuming only token custom properties.
- Every primitive carries a headless behavior test; one-off page composition needs none.
- `check:fast` stays deterministic and browser-free for the prototype loop. Playwright, axe, and visual checks are `check:slow` and run only at lock.
- `design/AGENTS.md` and `design/DESIGN.md` govern any agent touching `design/`; keep both true as the prototype changes.
- Read `design/docs/interaction-rules.md` before changing a surface: its rules already constrain what that surface may do, so a new surface satisfies them instead of relitigating them.

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

Anything unresolved stays one concise discussion note. Do not invent configuration, theming, or extensibility that no locked state requires.

## Transition

On prototype lock, load `gsd-brainstorming` and pass the locked prototype as fixed UI behavior plus the exact prototype paths. The prototype constrains surface behavior; `plan.md` remains the sole pre-approval authority, and `gsd-to-plan` records the resulting `UI Impact` classification, surfaces, and prototype paths.

Prototype work is its own feature packet, then the implementation feature follows as a second packet; both reuse the existing resume, verification, and cleanup contracts, so no new `state.toon` phase value exists. Scope growth beyond the surface exits to `gsd-brainstorming` instead of widening the prototype.

Domain Impact is unchanged by prototype-only work: a prototype ships no production semantics, so classify it `none` unless the surface itself changes shipped behavior.
