---
name: gsd-lavish
description: Turn complex/visual agent responses into rich, reviewable HTML artifacts via the local lavish-axi CLI. Auto-fires at substantial deliverables (spec, comparison, verify report) — never on inline Q&A.
triggers: substantial deliverable (spec/plan/verify report/audit) — auto
produces: []
consumes: []
---

# Lavish

Render a substantial deliverable as a reviewable HTML artifact the user annotates and feeds back on. Heavyweight (HTML artifact + local express server + browser surface + long-poll loop) — fire only on real reviewable deliverables.

**Guard — do not fire on inline conversational Q&A.** It breaks discussion rhythm with browser sessions.

## Workflow
1. Create the HTML artifact (default `.gsd-lavish/<name>.html`).
 2. `node tools/lavish-axi/dist/cli.mjs <html-file>` — open/resume the review session in the browser.
 3. `node tools/lavish-axi/dist/cli.mjs poll <html-file>` — long-poll for annotations, queued prompts, browser-reported `layout_warnings`. Stays silent until the user acts or the browser reports fresh warnings — **leave it running, never kill it**. If the harness limits foreground runtime, run it as a background task; if killed, just re-run (queued feedback is never lost).
 4. If poll returns `layout_warnings`, fix overflow/clipped/overlapping content and re-check before involving the user.
 5. Apply feedback, then `node tools/lavish-axi/dist/cli.mjs poll <html-file> --agent-reply "<message>"` to reply in-browser and keep the loop going.
 6. `node tools/lavish-axi/dist/cli.mjs end <html-file>` when finished.
 
 If `lavish-axi` output shows a follow-up command, run it using the local path `node tools/lavish-axi/dist/cli.mjs ...`.

## Playbooks (open each matching one before writing HTML)
 `node tools/lavish-axi/dist/cli.mjs playbook <id>` — one artifact often combines several:
- `diagram` — flows, architecture, state, sequence (use Mermaid, not hand-built boxes)
- `table` — dense records → scan-friendly
- `comparison` — options, tradeoffs, current vs target
- `plan` — product/technical plan
- `code` — source, diffs, before/after
- `input` — collecting user decisions/choices/preferences from within the artifact
- `slides` — deliberate presentation

## Visual guidance
- Visual hierarchy makes decisions/risks/tradeoffs/next-actions obvious at a glance.
- Use sections, cards, tables, diagrams, side-by-side comparisons over long prose.
- Prevent horizontal overflow at every nesting level: nested grid/flex children need `minmax(0,1fr)` tracks and `min-width:0`, especially with wide pixel/monospace fonts.

## Asset rules
Lavish serves the HTML via a local express server. Reference other filesystem assets (images, CSS, fonts, scripts) by copying them next to the HTML and using **relative** paths — never root paths (leading `/`).

## Design direction (no auto-injected design system)
Artifacts stay portable (render identically opened directly). Priority: (1) user asked for a specific look → use it; (2) else inspect the project the artifact is about and match its design system (Tailwind/theme, design tokens, component lib, brand assets).
