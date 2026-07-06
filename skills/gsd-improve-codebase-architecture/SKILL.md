---
name: gsd-improve-codebase-architecture
description: Internal GSD sub-skill (routed via /gsd). Scan the codebase for deepening opportunities, present candidates (terminal by default; lavish visual opt-in), then grill through the one you pick. Triggered as gsd-diagnosing-bugs terminal, or for upkeep.
triggers: architecture/refactor (gsd Route 5); upkeep; gsd-diagnosing-bugs terminal
produces: []
consumes: [CONTEXT.md, docs/adr/]
---

# Improve Codebase Architecture

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Invoked standalone with its `consumes:` artifacts missing → load the `gsd` skill and enter through its router (it detects workspace state); don't improvise missing context.

Surface architectural friction and propose **deepening opportunities** — refactors turning shallow modules into deep ones. Aim: testability + AI-navigability.

Built on `gsd-codebase-design` vocabulary (**module/interface/depth/seam/adapter/leverage/locality**) and the domain language in `CONTEXT.md`. Use those terms exactly — don't drift to "component/service/API/boundary". ADRs in `docs/adr/` are not re-litigated.

## 1. Explore
Read `CONTEXT.md` + ADRs in the area first (if they exist). Then survey the **relevant area** for friction (Explore subagent) — not the whole tree. Scope the walk: stay within the project's git-tracked files; skip non-git subtrees (nested repos, vendored tools, submodules with their own `.git`), dependency/build/output dirs (`node_modules`, `dist`, `build`, …), and `.gitignore`'d paths. If the user named an area, walk only it and its direct dependencies. Note friction: understanding one concept bounces across many small modules; shallow modules (interface ≈ implementation complexity); pure functions extracted only for testability while bugs hide in call-site coupling; seams that leak; untested/hard-to-test parts. Apply the **deletion test**: deleting it concentrates complexity (good) or just moves it (shallow, drop).

## 2. Present candidates — terminal default, lavish offer when eligible
Do NOT write manual HTML files. Compile the candidates and present them in the terminal by default. Before plan approval, when the architecture audit/comparison is offer-eligible and both Fire gate checks in [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Lavish opt-in gate taxonomy hold (and post-approval pipeline no-offer mode is not active), you MUST surface the lavish option — folded into the candidate presentation, never a second prompt. An offer is not launch consent: launch `gsd-lavish` only after explicit opt-in; otherwise keep the deliverable in terminal.

Each candidate carries: recommendation strength (`Strong`/`Worth exploring`/`Speculative`) + dependency category (`in-process`/`local-substitutable`/`adapter seam`/`mock`), the files, a before/after sketch, the friction (one sentence), the deepen plan (one sentence), wins in exact glossary terms (locality, leverage, testability), and an ADR callout if reopening one. Terminal renders this as prose/Mermaid; the visual card layout (badge colors, cross-sections) lives in the `gsd-lavish` `comparison`/`diagram` playbooks and only matters when the user explicitly opts into the browser surface.

Do NOT propose interfaces or write code yet. Present the candidates (terminal default; `gsd-lavish` only after opt-in and Fire gate pass) and ask the user to pick one.

## 3. Grilling loop
User picks → run `/gsd` (Discussion) to walk the design tree (constraints, dependencies, the deepened module's shape, what survives behind the seam, what tests survive). Keep the model current via `/gsd-domain-modeling` inline: name a deepened module after a concept not in `CONTEXT.md` → add it; sharpen a fuzzy term → update `CONTEXT.md`; user rejects with a load-bearing reason → offer an ADR (only if a future explorer would need it to avoid re-suggesting); explore alternative interfaces → `/gsd-codebase-design` design-it-twice.

 ## Contextual disclosure (see gsd Conventions). Example:
 ```
 Next steps:
 - /gsd (to discuss the chosen candidate or save progress)
 ```
