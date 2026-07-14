---
name: gsd-improve-codebase-architecture
description: "Use when the user asks to audit or refactor architecture, or when diagnosis identifies an architectural cause requiring scoped deepening candidates. Do not use for one named interface design or unrelated broad exploration."
triggers: explicit architecture audit or refactor; architectural cause returned by diagnosis
produces: []
consumes: [docs/domain/index.md, docs/domain/<scope>.md]
---

# Improve Codebase Architecture

> **Invocation guard** — automatic selection loads this skill for explicit architecture intent or an architectural diagnosis result. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract: select an Invocation Mode below before validating only that row's Required artifacts, then follow its Missing required action. A missing Optional artifact never reroutes the invocation.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Standalone architecture audit | — | `docs/domain/index.md`; relevant domain shards | — | — |
| Post-diagnosis architecture audit | — | `docs/domain/index.md`; relevant domain shards | — | — |

Standalone audit starts from the user's requested area. Post-diagnosis mode starts from the diagnosis specifics already established in the active conversation, then surveys only the relevant code.

Surface architectural friction and propose **deepening opportunities** — refactors turning shallow modules into deep ones. Aim: testability + AI-navigability.

Built on `gsd-codebase-design` vocabulary (**module/interface/depth/seam/adapter/leverage/locality**) and, when relevant, the settled language in indexed `docs/domain/<scope>.md` shards. Use those terms exactly; settled decisions in relevant shards are not re-litigated.

## 1. Explore

Survey the **relevant area** for friction—not the whole tree. Stay within Git-tracked files; skip nested repos, vendored tools, submodules, dependency/build/output directories, and ignored paths. If the user named an area, walk only it and direct dependencies. Note friction such as one concept bouncing across shallow modules, leaky seams, call-site coupling hidden by extracted pure functions, or behavior that cannot be tested through a stable interface.

Domain documentation is scoped input, not an entry sweep. When the selected area already reveals a durable domain signal, read `docs/domain/index.md`, map that signal to the minimum relevant bounded-context rows, and read only those shards. Missing domain docs are normal. Never load all shards to start an audit or create a domain scaffold.

### Optional context signal

The area survey is not itself a domain harvest. Reuse candidate files, direct dependencies, and relevant docs already needed by the audit. Trigger `gsd-domain-modeling` only when those sources reveal a recurring project-specific term or an explicit decision with rationale; generic module vocabulary, one-off names, code shape without rationale, feature-local wording, and reversible preferences are no-op. This skill never writes domain artifacts.

Before approval, material meaning/ownership/trade-off ambiguity follows domain modeling's one-focused-question-and-no-write rule. Inside approved execution, ask zero documentation questions: load-bearing ambiguity returns to `gsd-executing-plans` as Spec escalation; anything else skips the documentation write.

## 2. Present candidates — terminal default, lavish offer when eligible
Do NOT write manual HTML files. Compile the candidates and present them in the terminal by default. Before plan approval, when the architecture audit/comparison is offer-eligible and both Fire gate checks in [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Lavish opt-in gate taxonomy hold (and post-approval pipeline no-offer mode is not active), you MUST surface the lavish option — folded into the candidate presentation, never a second prompt. An offer is not launch consent: launch `gsd-lavish` only after explicit opt-in; otherwise keep the deliverable in terminal.

Each candidate carries: recommendation strength (`Strong`/`Worth exploring`/`Speculative`) + dependency category (`in-process`/`local-substitutable`/`remote but owned`/`true external`), the files, a before/after sketch, the friction (one sentence), the deepen plan (one sentence), wins in exact glossary terms (locality, leverage, testability), and a decision callout if reopening one. Terminal renders this as prose/Mermaid; the visual card layout (badge colors, cross-sections) lives in the `gsd-lavish` `comparison`/`diagram` playbooks and only matters when the user explicitly opts into the browser surface.

In Standalone architecture-audit mode and pre-approval Post-diagnosis architecture-audit mode (the follow-up from a standalone diagnosis), do not propose interfaces or write code yet: present the candidates, surface the optional lavish review only under the pre-approval gate above, and ask the user to pick one. In Post-diagnosis architecture-audit mode inside approved execution, the same candidates are report-only: ask no question and offer no lavish review. If deepening is required to satisfy the current approved AC/fix, return a Spec-escalation blocker; otherwise recommend the strongest future candidate and return to `gsd-executing-plans` without selection, grilling, or refactoring.

## 3. Grilling loop
A Standalone or pre-approval Post-diagnosis user pick → load `gsd-brainstorming` to walk the design tree (constraints, dependencies, the deepened module's shape, what survives behind the seam, what tests survive). Post-diagnosis mode never enters this grilling loop inside post-approval auto-pilot. Keep the model current via `gsd-domain-modeling` inline only under Optional context signal: a certain durable term may update the mapped glossary; a decision may update/write a decision row only when all three gates and its rationale are evidenced, after checking related decisions for dedupe. Explore alternative interfaces via `gsd-codebase-design` design-it-twice.

 ## Contextual disclosure (see gsd Conventions). Example:
 ```
 Next steps:
 - Discuss the chosen candidate or save progress.
 ```
