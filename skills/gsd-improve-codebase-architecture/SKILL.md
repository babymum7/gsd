---
name: gsd-improve-codebase-architecture
description: Scan the codebase for deepening opportunities, present them as a visual HTML report, then grill through the one you pick. Triggered as gsd-diagnosing-bugs terminal, or for upkeep.
triggers: architecture/refactor (gsd Route 5); upkeep; gsd-diagnosing-bugs terminal
produces: []
consumes: [CONTEXT.md, docs/adr/]
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors turning shallow modules into deep ones. Aim: testability + AI-navigability.

Built on `gsd-codebase-design` vocabulary (**module/interface/depth/seam/adapter/leverage/locality**) and the domain language in `CONTEXT.md`. Use those terms exactly — don't drift to "component/service/API/boundary". ADRs in `docs/adr/` are not re-litigated.

## 1. Explore
Read `CONTEXT.md` + ADRs in the area first (if they exist). Then survey the **relevant area** for friction (Explore subagent) — not the whole tree. Scope the walk: stay within the project's git-tracked files; skip non-git subtrees (nested repos, vendored tools, submodules with their own `.git`), dependency/build/output dirs (`node_modules`, `dist`, `build`, …), and `.gitignore`'d paths. If the user named an area, walk only it and its direct dependencies. Note friction: understanding one concept bounces across many small modules; shallow modules (interface ≈ implementation complexity); pure functions extracted only for testability while bugs hide in call-site coupling; seams that leak; untested/hard-to-test parts. Apply the **deletion test**: deleting it concentrates complexity (good) or just moves it (shallow, drop).

 ## 2. Present candidates — Lavish visual review
 Do NOT write manual HTML files. Compile the candidates and present them in the terminal by default. Offer a `gsd-lavish` artifact (using the `comparison` and `diagram` playbooks) only if the user opts in — lavish is opt-in, never assumed.
 
 Each candidate card in the Lavish interface must show:
 - **Badge row** — Recommendation strength (`Strong` = emerald, `Worth exploring` = amber, `Speculative` = slate), plus dependency category (`in-process`, `local-substitutable`, `ports & adapters`, `mock`).
 - **Files** — Monospaced list.
 - **Before / After diagram** — Side-by-side comparison using Mermaid or HTML cross-sections.
 - **Problem** — One sentence description of friction/leakage.
 - **Solution** — One sentence description of consolidate/deepen plan.
 - **Wins** — Bulleted list of benefits (locality, leverage, testability) using exact glossary terms.
 - **ADR callout** — One line alert if reopening an existing ADR.
 
 Do NOT propose interfaces or write code yet. Present the candidates (terminal default; `gsd-lavish` if opted in) and ask the user to pick one.

## 3. Grilling loop
User picks → run `/gsd` (Discussion) to walk the design tree (constraints, dependencies, the deepened module's shape, what survives behind the seam, what tests survive). Keep the model current via `/gsd-domain-modeling` inline: name a deepened module after a concept not in `CONTEXT.md` → add it; sharpen a fuzzy term → update `CONTEXT.md`; user rejects with a load-bearing reason → offer an ADR (only if a future explorer would need it to avoid re-suggesting); explore alternative interfaces → `/gsd-codebase-design` design-it-twice.

 ## Contextual disclosure (AXI Style)
Append this `Next steps:` block **only when you are the terminal/standalone response** (directly invoked or the last skill in the chain) — never when firing **inline** inside another skill's response; only the outermost response shows next-steps (`gsd` Conventions → Contextual disclosure). Example:
 ```
 Next steps:
 - /gsd (to discuss the chosen candidate or save progress)
 ```
