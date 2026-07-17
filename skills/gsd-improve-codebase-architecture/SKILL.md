---
name: gsd-improve-codebase-architecture
description: "Use when the user asks to audit or refactor architecture, or when diagnosis identifies an architectural cause requiring scoped deepening candidates. Do not use for one named interface design or unrelated broad exploration."
triggers: explicit architecture audit or refactor; architectural cause returned by diagnosis
produces: []
consumes: [docs/domain/index.md, docs/domain/<scope>.md]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Do-not-load: one named interface design without architecture scope
- Transition: return recommendations into discussion/plan ownership

# Improve Codebase Architecture

> **Invocation guard** — automatic selection loads this skill for explicit architecture intent or an architectural diagnosis result. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract: select an Invocation Mode below before validating only that row's Required artifacts, then follow its Missing required action. A missing Optional artifact never reroutes the invocation.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Standalone architecture audit | — | `docs/domain/index.md`; relevant domain shards | — | — |
| Post-diagnosis architecture audit | — | `docs/domain/index.md`; relevant domain shards | — | — |

Standalone audit starts from the user's requested area. Post-diagnosis mode starts from the diagnosis specifics already established in the active conversation, then surveys only the relevant code.

Surface architectural friction and propose **deepening opportunities** (shallow→deep modules) for testability/AI-navigability. Use `gsd-codebase-design` vocabulary (**module/interface/depth/seam/adapter/leverage/locality**) and relevant `docs/domain/<scope>.md` terms exactly; do not re-litigate settled decisions.

## 1. Explore

Survey the **relevant area** for friction—not the whole tree. Stay within Git-tracked files; skip nested repos, vendored tools, submodules, dependency/build/output directories, and ignored paths. If the user named an area, walk only it and direct dependencies. Note friction such as one concept bouncing across shallow modules, leaky seams, call-site coupling hidden by extracted pure functions, or behavior that cannot be tested through a stable interface.

When a durable domain signal already appears, read `docs/domain/index.md` and only the minimum mapped shards (missing docs are normal). Trigger `gsd-domain-modeling` only for certain durable terms/decisions; never write domain artifacts here. Before approval, material meaning/ownership/trade-off ambiguity follows domain modeling's one-focused-question-and-no-write rule. Inside approved execution, ask zero documentation questions: load-bearing AC/interface/invariant ambiguity returns to `gsd-executing-plans` as Spec escalation; otherwise skip the documentation write.


## 2. Present candidates — terminal default, lavish offer when eligible
Do NOT write manual HTML. Present candidates in the terminal by default. Before plan approval, when the audit/comparison is offer-eligible and both Fire gate checks in [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Lavish opt-in gate taxonomy hold (and post-approval pipeline no-offer mode is not active), MUST surface the lavish option folded into the presentation—never a second prompt. Offer ≠ launch: launch `gsd-lavish` only after explicit opt-in; otherwise keep terminal prose.

Each candidate carries: recommendation strength (`Strong`/`Worth exploring`/`Speculative`) + dependency category (`in-process`/`local-substitutable`/`remote but owned`/`true external`), the files, a before/after sketch, the friction (one sentence), the deepen plan (one sentence), wins in exact glossary terms (locality, leverage, testability), and a decision callout if reopening one. Terminal renders this as prose/Mermaid.

In Standalone architecture-audit mode and pre-approval Post-diagnosis architecture-audit mode (the follow-up from a standalone diagnosis), do not propose interfaces or write code yet: present the candidates, surface the optional lavish review only under the pre-approval gate above, and ask the user to pick one. In Post-diagnosis architecture-audit mode inside approved execution, the same candidates are report-only: ask no question and offer no lavish review. If deepening is required to satisfy the current approved AC/fix, return a Spec-escalation blocker; otherwise recommend the strongest future candidate and return to `gsd-executing-plans` without selection, grilling, or refactoring.

## 3. Grilling loop
Standalone or pre-approval Post-diagnosis user pick → load `gsd-brainstorming` for the design tree (constraints, dependencies, deepened shape, seam survivors, surviving tests). Post-diagnosis inside post-approval auto-pilot never enters grilling. Keep domain current via `gsd-domain-modeling` only for certain durable terms/decisions (three gates + rationale; dedupe related decisions). Explore alternatives via `gsd-codebase-design` design-it-twice.

## Contextual disclosure — [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates.
```
Next steps:
- Discuss the chosen candidate or save progress.
```
