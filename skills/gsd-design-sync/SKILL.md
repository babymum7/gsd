---
name: gsd-design-sync
description: "Use to audit drift between the design/ prototype and the codebase and route each chosen sync direction to its owner."
produces: []
consumes: [design/docs/<surface>.md, design/docs/interaction-rules.md, docs/domain/index.md, docs/domain/<scope>.md, AGENTS.md]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Do-not-load: repositories with no `design/` directory; drift already located and owned by an active packet
- Transition: route each user-chosen direction to `gsd-brainstorming` or `gsd-prototyping`

# Design Sync

> **Invocation guard** — this skill reads both sides and writes no production file, no `design/` file, and no lifecycle artifact. Select an Invocation Mode before validating its Required artifacts, then apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Repository drift audit | `design/docs/` with its surface documents and `design/docs/interaction-rules.md` | affected domain shards | a per-plane verdict report | no `design/` directory: report that and stop, since there is no design side to compare |
| Named surface audit | the `design/docs/<surface>.md` the prompt names, inside a `design/docs/` that carries `interaction-rules.md` | its declared production paths | that surface's per-plane verdict report | ask which surface to audit |
| Direction routing | a reported verdict the user chose a direction for | — | the loaded peer owner | ask which plane and direction to act on |

## Planes

Both audit modes run `node "<GSD_ROOT>/tools/gsd-contract.mjs" validate-design-map --path design/docs` before comparing anything. Exit 1 is a Blocker: an unresolvable map cannot attribute drift to a surface, so report the named failure and stop. `Direction routing` consumes an already reported verdict and revalidates nothing.

The same run reports `pending`: how many surfaces still owe a production conversion is the queue, so this audit keeps no list of its own.

Each plane has its own authority pair and its own verdict. A plane is compared only against its own pair, and one plane's verdict never overrides another's:

- **spec** — `docs/domain/<scope>.md` against the production code, schemas, and tests for that context. Drift here is a semantic disagreement about what the product does.
- **ux** — `design/docs/interaction-rules.md` against `design/docs/<surface>.md`: every rule the ledger records must hold in each surface that cites it, and every `IR-<n>` a surface cites must exist. Drift here is a rule the surface contradicts or a citation nothing records.
- **ui** — the prototype artifacts under `design/` against the production markup and styling in that surface's declared `## Production surfaces` paths. Drift here is a rendered difference: a state, flow, token, or component that one side has and the other does not.

The declared `## Conversion` state is a claim this audit can contradict. Report a `converted` surface whose `ui` plane reads `design-ahead`, and a `pending` surface whose `ui` plane reads `aligned`, as evidence of a wrong declaration. Neither reading proves the declaration: the `ui` plane judges rendered differences, so it can contradict a claim but never confirm it deterministically.

Unclaimed production UI is evidence, not a validator failure: name the file and the surface it appears to belong to, and let the user decide whether it needs a claim.

## Verdicts

Report exactly one verdict per plane:

- `aligned` — both sides agree; nothing to route.
- `design-ahead` — the locked prototype or the shard carries behavior production has not converted yet.
- `code-ahead` — production carries behavior its design side never recorded.
- `conflict` — both sides changed and neither is a superset of the other.

## Routing

Direction is a product decision, so the audit never picks a winner and never edits either side. Every `code-ahead` and `conflict` plane asks the user for its direction first; only the chosen direction routes:

- `design-ahead` loads `gsd-brainstorming`: production converts from the locked prototype, so the change becomes a normal feature packet with the prototype as its fixed UI behavior.
- `code-ahead` asks whether production is the intended behavior, then loads `gsd-prototyping` in `Existing surface change`: the prototype is back-ported to what production already renders, then re-locked before any further conversion.
- `conflict` asks which side is authoritative for that plane, then routes as the chosen direction.
- `aligned` routes nowhere.

Ask per plane, never once for the whole report: the same audit may route one plane and leave another alone.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Report the per-plane verdict, its evidence, and the routing question only.
