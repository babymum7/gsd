---
name: gsd-lavish
description: Internal GSD sub-skill (routed via /gsd). Turn complex/visual agent responses into rich, reviewable HTML artifacts via the local lavish-axi CLI. Renders a substantial deliverable (spec, comparison, verify report) as a browser-reviewed artifact ONLY when its 2-part Fire gate holds — never on inline Q&A.
triggers: substantial deliverable (spec/plan/verify report/audit) — opt-in (2-part Fire gate; user must accept)
produces: []
consumes: []
---

# Lavish

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Invoked standalone with its `consumes:` artifacts missing → load the `gsd` skill and enter through its router (it detects workspace state); don't improvise missing context.

Render a substantial deliverable as a reviewable HTML artifact the user annotates and feeds back on. Heavyweight (HTML artifact + local express server + browser surface + long-poll loop) — fire only on real reviewable deliverables.

**Fire gate (both must hold):** (1) the artifact is a standalone, reviewable deliverable — not mid-conversation; AND (2) the user gains from annotating it in a browser surface. **Never on inline conversational Q&A** — it breaks discussion rhythm with browser sessions. **On ambiguity, default to terminal output and ask the user** — lavish is opt-in, never assumed.

## Path resolution (cross-project)
The CLI lives in the GSD repo, not the user's project. Resolve from the registered symlink (any cwd):
```
SKILLS_DIR="$(dirname "$(readlink ~/.agents/skills/gsd 2>/dev/null || echo ~/.agents/skills/gsd)")"
CLI="$SKILLS_DIR/../tools/lavish-axi/dist/cli.mjs"
```
Then every invocation below uses `node "$CLI"`.

## Workflow
1. Create the HTML artifact (default `.gsd-lavish/<name>.html`).
 2. `node "$CLI" <html-file>` — open/resume the review session in the browser.
 3. `node "$CLI" poll <html-file>` — long-poll for annotations, queued prompts, browser-reported `layout_warnings`. Stays silent until the user acts or the browser reports fresh warnings — **leave it running, never kill it**. If the harness limits foreground runtime, run it as a background task; if killed, just re-run (queued feedback is never lost).
 4. If poll returns `layout_warnings`, fix overflow/clipped/overlapping content and re-check before involving the user.
 5. Apply feedback, then `node "$CLI" poll <html-file> --agent-reply "<message>"` to reply in-browser and keep the loop going.
 6. `node "$CLI" end <html-file>` when finished.

 If `$CLI` output shows a follow-up command, run it with `node "$CLI" ...`.

## Playbooks (open each matching one before writing HTML)
 `node "$CLI" playbook <id>` — one artifact often combines several:
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
