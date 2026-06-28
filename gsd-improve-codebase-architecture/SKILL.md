---
name: gsd-improve-codebase-architecture
description: Scan the codebase for deepening opportunities, present them as a visual HTML report, then grill through the one you pick. Triggered as gsd-diagnosing-bugs terminal, or for upkeep.
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors turning shallow modules into deep ones. Aim: testability + AI-navigability.

Built on `gsd-codebase-design` vocabulary (**module/interface/depth/seam/adapter/leverage/locality**) and the domain language in `CONTEXT.md`. Use those terms exactly — don't drift to "component/service/API/boundary". ADRs in `docs/adr/` are not re-litigated.

## 1. Explore
Read `CONTEXT.md` + ADRs in the area first. Then walk the codebase (Explore subagent) noting friction: understanding one concept bounces across many small modules; shallow modules (interface ≈ implementation complexity); pure functions extracted only for testability while bugs hide in call-site coupling; seams that leak; untested/hard-to-test parts. Apply the **deletion test**: deleting it concentrates complexity (good) or just moves it (shallow, drop).

## 2. Present candidates — HTML report
Self-contained HTML to the OS temp dir (`$TMPDIR` or `/tmp`): `<tmpdir>/architecture-review-<timestamp>.html`. Tailwind+Mermaid via CDN; mix Mermaid (graph-shaped: call graphs, deps, sequences) with hand-built CSS/SVG (editorial). Open it (`open`/`xdg-open`/`start`), give the absolute path.

Each candidate card: **Files** · **Problem** · **Solution** · **Benefits** (locality/leverage/testability) · **Before/After diagram** · **Recommendation** (`Strong`/`Worth exploring`/`Speculative`). End with a **Top recommendation**. Use `CONTEXT.md` vocabulary for domain, `gsd-codebase-design` for architecture. ADR conflicts: surface only if friction is real enough to reopen, marked clearly. Full scaffold in [HTML-REPORT.md](HTML-REPORT.md).

Do NOT propose interfaces yet. Ask which candidate to explore.

## 3. Grilling loop
User picks → run `/gsd-grilling` to walk the design tree (constraints, dependencies, the deepened module's shape, what survives behind the seam, what tests survive). Keep the model current via `/gsd-domain-modeling` inline: name a deepened module after a concept not in `CONTEXT.md` → add it; sharpen a fuzzy term → update `CONTEXT.md`; user rejects with a load-bearing reason → offer an ADR (only if a future explorer would need it to avoid re-suggesting); explore alternative interfaces → `/gsd-codebase-design` design-it-twice.
