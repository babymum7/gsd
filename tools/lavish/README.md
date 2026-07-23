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
bun tools/lavish/src/cli.ts open --url http://127.0.0.1:3000
bun tools/lavish/src/cli.ts open --file /absolute/path/to/fixture.html
bun tools/lavish/src/cli.ts sessions
bun tools/lavish/src/cli.ts feedback <session-id>
bun tools/lavish/src/cli.ts end <session-id>
```

The installer builds the same package and registers the resulting `lavish`
command in the OMP agent bin directory. Commands are non-interactive. Standard
output is bounded TOON data; standard error contains diagnostics only.

`open` owns the browser session and its tab. It does not start or stop the
application server. Sessions use a persistent browser profile outside the
repository, isolated by project root. Session metadata, feedback, and image
attachments are stored under the project-local ignored `.lavish/` directory.

## Review and feedback

The live app remains the review surface. The tool-owned toolbar has explicit
**Interact** and **Annotate** modes. Interact mode passes ordinary app pointer,
keyboard, scroll, and form events through. Annotate mode records a bounded DOM
anchor without activating the selected app control, then sends the comment.

Feedback accepts uploaded images, pasted clipboard images, and captures from
the current viewport. A dragged rectangle captures a viewport region. Captures
are PNG attachments and never replace or freeze the live page. Full-document
capture beyond the current viewport is not part of this milestone.

Feedback output contains creation-ordered records with comment, session, anchor,
attachment path, MIME type, byte size, dimensions, and SHA-256 metadata. Binary
contents are written to attachment files and are never embedded in TOON output.
Cookies, tokens, and browser profile data remain outside feedback/session
records.
