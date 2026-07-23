# Lavish

Lavish is the root-owned interactive feedback tool for GSD. It runs on Bun and
uses the native Chromium DevTools Protocol (CDP) WebSocket API; it does not
proxy application traffic or depend on Playwright, Puppeteer, or an extension.

## Prerequisites

- Bun `>=1.2`
- A Chromium-family browser discoverable as `google-chrome`, `chromium`,
  `chromium-browser`, or `google-chrome-stable`
- An already-running application URL or a local HTML file

Build the tracked tool with:

```bash
bun run --cwd tools/lavish build
```

## Commands

Run the source CLI directly during development:

```bash
bun tools/lavish/src/cli.ts prototype /absolute/path/to/fixture.html
bun tools/lavish/src/cli.ts app http://127.0.0.1:3000
bun tools/lavish/src/cli.ts sessions
bun tools/lavish/src/cli.ts poll <session-id> --after 0 --after-reply 0
bun tools/lavish/src/cli.ts poll <session-id> --after <cursor> --after-reply <reply-cursor> --agent-reply "Applied the requested changes."
bun tools/lavish/src/cli.ts feedback <session-id>
bun tools/lavish/src/cli.ts end <session-id>
```

The installer builds the same package and registers `lavish` in the OMP agent
bin directory. Commands are non-interactive. Standard output is bounded TOON;
standard error contains diagnostics only.

`prototype` serves one regular local HTML file. `app` opens an already-running
HTTP or HTTPS application directly in its real Chromium tab; Lavish never
iframes the app and does not start or stop its server. Both session types share
one injected editor. Sessions use a persistent browser profile outside the
repository, isolated by project root. Session metadata, feedback, and image
attachments stay under the project-local ignored `.lavish/` directory.

## Attached feedback loop

The session-opening result includes the exact initial `poll` command. Start
that completion-aware poll before reporting that feedback is monitored.
**Queue** stores drafts privately in the daemon session and never wakes the
poll. **Send now** atomically commits queued annotations followed by the current
composer message, clears the committed queue, advances the delivery cursor,
and immediately resolves the waiting poll.

After handling a delivery, publish a concise browser-visible reply and reattach
in one command:

```bash
bun tools/lavish/src/cli.ts poll "$SESSION_ID" \
  --after "$CURSOR" \
  --after-reply "$REPLY_CURSOR" \
  --agent-reply "Applied the requested changes."
```

`poll` output provides the next cursors and exact continuation command.
`feedback` reads the complete delivered/reply history for audit; it is not a
wake path. Keep the session open through the review loop and use `end`
explicitly when review is complete.

## Review editor

The live page remains the review surface. A collapsible 360 px conversation
drawer provides **Interact** and **Annotate** modes, ordered history, removable
queue pills, image controls, and a sticky composer. Interact mode passes
ordinary app pointer, keyboard, scroll, and form events through. Annotate mode
highlights hovered elements and selected text, opens a contextual annotation
card, and does not activate the selected app control.

Enter queues feedback, Shift+Enter inserts a newline, and Ctrl/Cmd+Enter uses
Send now. Images may be uploaded, pasted, captured from the current viewport,
or captured from a dragged viewport region. Captures never replace or freeze
the live page. Full-document capture is unavailable.

Delivered feedback contains ordered comments, sanitized anchors, and bounded
attachment metadata: path, MIME type, byte size, dimensions, and SHA-256.
Binary contents stay in attachment files and are never embedded in TOON.
Cookies, URL credentials/query data, tokens, and browser profile data do not
enter feedback records.
