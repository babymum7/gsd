# Agent instructions

This directory is the prototype for the product's user-facing surfaces. It exists to
lock UI behavior before requirements converge, so the prototype is the reference for
what a surface does, and `DESIGN.md` is the contract it obeys.

## Design documentation

- Read `DESIGN.md` before changing anything under this directory.
- Every color, spacing, radius, and font size comes from a token custom property.
  A raw hex color or px/rem length in a rule is a defect, not a shortcut: add or reuse
  a token in `tokens/color.json` or `tokens/dimension.json`, run the token build, then
  reference the emitted custom property.
- Use longhand `border-width`/`border-color` and `outline-width`/`outline-color`.
  The `border` and `outline` shorthands pack a width and a color into one declaration
  that the strict-value lint cannot decompose.
- Markup repeated across surfaces becomes a light-DOM custom element under
  `primitives/`, styled only through token custom properties. See
  `primitives/button.js` and `primitives/button.css`.
- Every primitive ships a headless behavior test beside it, like
  `primitives/button.test.js`. One-off page composition needs no test.
- Each surface has one document under `docs/`, shaped like
  `docs/surface-example.md`, listing every reachable state and flow.
- Read `docs/interaction-rules.md` before changing a surface: its numbered `IR-<n>`
  rules already constrain every comparable surface. When review accepts feedback that
  holds beyond one surface, append it there as the next `IR-<n>` with its trigger and
  required behavior; a decision about one screen stays in that screen's document.
- Keep this file and `DESIGN.md` true as the prototype changes. A path named here that
  does not exist is a broken contract. The layout above is this scaffold's example, not
  a required shape: adapt the paths to what your design tool produces, then keep both
  files describing what actually exists.

## Checks

- `npm run check:fast` is the prototype loop: token build, stylelint, and the headless
  primitive tests. It stays deterministic and browser-free, so run it after every
  change.
- `npm run check:slow` is the lock gate: it runs the browser suite through Playwright.
  Run it when a surface is ready to lock, not during the edit loop.

A surface is locked only when every reachable state renders, every flow between those
states works in the prototype, both checks are green, and the surface document matches
what the prototype renders.
