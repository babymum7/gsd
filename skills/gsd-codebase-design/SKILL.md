---
name: gsd-codebase-design
description: "Use when designing or improving one named module interface, seam, or deep-module boundary, either directly or as a helper. Do not use for a system-wide architecture audit."
triggers: explicit named module or interface design; bounded inline design support
produces: []
consumes: []
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: helper
- Helper-when: must load when designing one named module interface or seam; cannot be skipped while that condition holds
- Do-not-load: system-wide architecture audit
- Transition: return design result to the parent owner

# Codebase Design

> **Invocation guard** — automatic selection loads this skill from the injected catalog. This skill has no required artifacts (`consumes: []`), so a standalone interface-design invocation proceeds directly from the user-supplied area without fabricating workspace context. If no module, interface, or area is supplied, stop and ask one focused target question; never survey the repository or invent a target. A system-wide audit is not standalone interface design: load `gsd-improve-codebase-architecture`.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Standalone interface design | — | — | — | — |
| Inline design support | — | — | — | — |

Select Standalone for a named module/interface; Inline when another skill needs this vocabulary/design-it-twice process. No domain artifact opens or writes here.

Design **deep modules**: much behaviour behind a small interface at a clean seam, testable through that interface.

## Glossary

Use these terms exactly.

- **Module** — anything with an interface and an implementation (function, class, package, or tier-spanning slice).
- **Interface** — everything a caller must know: type signature, invariants, ordering, error modes, config, performance.
- **Implementation** — what's inside a module, its body of code. Distinct from **Adapter**: a thing can be a small adapter with a large implementation (a Postgres repo) or a large adapter with a small implementation (an in-memory fake). Reach for "adapter" when the seam is the topic; "implementation" otherwise.
- **Depth** — leverage at the interface: the amount of behaviour a caller (or test) can exercise per unit of interface they have to learn. A module is **deep** when a large amount of behaviour sits behind a small interface, **shallow** when the interface is nearly as complex as the implementation.
- **Seam** — stable boundary where behavior can be observed or substituted.
- **Adapter** — a concrete thing that satisfies an interface at a seam. Describes *role* (what slot it fills), not substance (what's inside).
- **Leverage** — what callers get from depth: more capability per unit of interface they learn. One implementation pays back across N call sites and M tests.
- **Locality** — change, bugs, knowledge, and verification concentrate behind the seam rather than across callers.

## Deep vs shallow

**Deep module** — small interface hiding large implementation; maximize leverage.
**Shallow module** (avoid) — large interface over thin pass-through; interface nearly as complex as implementation.
When designing: reduce methods/params; hide more complexity inside.

## Principles

- **Depth is a property of the interface, not the implementation.** A deep module may be composed of small internal parts that are not part of the external interface.
- **The deletion test.** Imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a seam unless at least two adapters are justified (typically production + test).
- **Internal seams vs external seams.** A deep module can have internal seams (private to its implementation, used by its own tests) as well as the external seam at its interface. Don't expose internal seams at the external interface.
- **Interface test surface.** Tests assert on observable outcomes through the interface, not internal state. Tests should survive internal refactors — they describe behaviour, not implementation. If a test has to change when the implementation changes, it's testing past the interface.

## Designing for testability

Good interfaces make testing natural: accept dependencies, return results, keep a small surface. Interface-test rules are under Principles.



## Rejected framings

- **Depth as ratio of implementation-lines to interface-lines** (Ousterhout): rewards padding the implementation. We use depth-as-leverage instead.
- **"Interface" as the TypeScript `interface` keyword or a class's public methods**: too narrow — interface here includes every fact a caller must know.
- **"Boundary"**: overloaded with DDD's bounded context. Say **seam** or **interface**.

## Going deeper
Design it twice: sketch at least two interfaces before committing. Prefer the deeper option with the smaller hard surface. Deepen only when friction is evidenced; return the chosen design to the parent owner.


- Deepening: [DEEPENING.md](DEEPENING.md). Design-it-twice: [DESIGN-IT-TWICE.md](DESIGN-IT-TWICE.md).
