---
name: gsd-improve-codebase-architecture
description: Internal GSD sub-skill (routed via /gsd). Scan the codebase for deepening opportunities, present candidates (terminal by default; ask first for a lavish visual review when eligible, launch on accept), then grill through the one you pick. Triggered as gsd-diagnosing-bugs terminal, or for upkeep.
triggers: architecture/refactor (gsd Route 5); upkeep; gsd-diagnosing-bugs terminal
produces: []
consumes: [CONTEXT.md, docs/adr/]
---

# Improve Codebase Architecture

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract: select an Invocation Mode below before validating only that row's Required artifacts, then follow its Missing required action. A missing Optional artifact never reroutes the invocation.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Route 5 architecture audit | — | `CONTEXT.md`; `docs/adr/` | — | — |
| Post-diagnosis architecture audit | — | `CONTEXT.md`; `docs/adr/` | — | — |

Route 5 starts from the user's requested area. Post-diagnosis mode starts from the diagnosis specifics already established in the active conversation, then surveys only the relevant code.

Surface architectural friction and propose **deepening opportunities** — refactors turning shallow modules into deep ones. Aim: testability + AI-navigability.

Built on `gsd-codebase-design` vocabulary (**module/interface/depth/seam/adapter/leverage/locality**) and the domain language in `CONTEXT.md`. Use those terms exactly — don't drift to "component/service/API/boundary". ADRs in `docs/adr/` are not re-litigated.

## 1. Explore
Read `CONTEXT.md` + ADRs in the area first (if they exist). Then survey the **relevant area** for friction (Explore subagent) — not the whole tree. Scope the walk: stay within the project's git-tracked files; skip non-git subtrees (nested repos, vendored tools, submodules with their own `.git`), dependency/build/output dirs (`node_modules`, `dist`, `build`, …), and `.gitignore`'d paths. If the user named an area, walk only it and its direct dependencies. Note friction: understanding one concept bounces across many small modules; shallow modules (interface ≈ implementation complexity); pure functions extracted only for testability while bugs hide in call-site coupling; seams that leak; untested/hard-to-test parts. Apply the **deletion test**: deleting it concentrates complexity (good) or just moves it (shallow, drop).

### Optional context signal
The area survey is not a domain harvest. Missing context/ADR docs are normal; do not scan beyond the requested area to find terms or create scaffolds. Reuse the candidate files, direct dependencies, and relevant docs already needed by this audit. Trigger `gsd-domain-modeling` only when those sources reveal a recurring project-specific term or an explicit decision/rationale signal; generic module vocabulary, one-off names, code shape without rationale, and reversible preferences are no-op. This skill never writes a domain artifact itself.

Before approval, material meaning/ownership/trade-off ambiguity follows domain modeling's one-focused-question-and-no-write rule. A post-diagnosis audit running inside approved execution asks zero documentation questions: load-bearing AC/interface/invariant ambiguity returns to `gsd-executing-plans`' Spec escalation; anything else skips the documentation write.

## 2. Present candidates — terminal default, lavish offer when eligible
Do NOT write manual HTML files. Compile the candidates and present them in the terminal by default. Before plan approval, when the architecture audit/comparison is offer-eligible and both Fire gate checks in [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Lavish opt-in gate taxonomy hold (and post-approval pipeline no-offer mode is not active), you MUST surface the lavish option — folded into the candidate presentation, never a second prompt. An offer is not launch consent: launch `gsd-lavish` only after explicit opt-in; otherwise keep the deliverable in terminal.

Each candidate carries: recommendation strength (`Strong`/`Worth exploring`/`Speculative`) + dependency category (`in-process`/`local-substitutable`/`adapter seam`/`mock`), the files, a before/after sketch, the friction (one sentence), the deepen plan (one sentence), wins in exact glossary terms (locality, leverage, testability), and an ADR callout if reopening one. Terminal renders this as prose/Mermaid; the visual card layout (badge colors, cross-sections) lives in the `gsd-lavish` `comparison`/`diagram` playbooks and only matters when the user explicitly opts into the browser surface.

Do NOT propose interfaces or write code yet. Present the candidates (terminal default; ask first for a lavish visual review when eligible, launch `gsd-lavish` only after accept + Fire gate pass) and ask the user to pick one.

## 3. Grilling loop
User picks → run `/gsd` (Discussion) to walk the design tree (constraints, dependencies, the deepened module's shape, what survives behind the seam, what tests survive). Keep the model current via `gsd-domain-modeling` inline only under Optional context signal: a certain durable term may update the mapped glossary; a decision may update/write an ADR only when all three gates and its rationale are evidenced, after checking related ADRs for dedupe. Explore alternative interfaces via `gsd-codebase-design` design-it-twice.

 ## Contextual disclosure (see gsd Conventions). Example:
 ```
 Next steps:
 - /gsd (to discuss the chosen candidate or save progress)
 ```
