# Design system contract

The contract this prototype obeys, and an example of a structure that satisfies it. The
file layout and toolchain below are one worked example: keep the obligations, adapt the
layout to whatever your design tool produces. It is written to be usable directly as a
system prompt for an external design tool driving this directory.

## Tokens are the only source of visual values

Colors, spacing, radii, and font sizes live in `tokens/color.json` and
`tokens/dimension.json` in DTCG format: each entry declares `$value` and `$type`.
The token build emits them as CSS custom properties into `css/tokens.css`, which
`css/base.css` imports.

A rule may only reference those custom properties. A raw hex color or px/rem length is
a defect. Needing a value that no token provides means adding the token first.

Use longhand width and color declarations. The `border` and `outline` shorthands mix a
width, a style, and a color in one declaration, which hides the width from the lint.

## Primitives are light DOM

Repeated markup becomes a custom element under `primitives/`. Each primitive:

- extends `HTMLElement` and registers itself with `customElements.define`;
- stays light DOM. No `attachShadow`, because a shadow root cuts the element off from
  the token custom properties the page imports;
- owns behavior and state only. Its visual values live in a sibling stylesheet, like
  `primitives/button.css`;
- reflects state to attributes a test and a screen reader can both observe, such as
  `aria-disabled` and `aria-busy`;
- ships a headless behavior test beside it, like `primitives/button.test.js`.

One-off page composition stays plain markup consuming those primitives.

## Surfaces are documented by their states

Each surface has one document under `docs/`, shaped like `docs/surface-example.md`,
listing every reachable state and every flow between them. The prototype renders each
one; prose alone never substitutes for a rendered state.

A decision that only applies to that surface stays in its document. A rule that holds
for every comparable surface belongs in `docs/interaction-rules.md` as the next
numbered `IR-<n>` entry, with the trigger that fires it and the behavior it requires.
Read that ledger before designing a surface: its rules are already binding.

## Checks split by cost

`npm run check:fast` builds tokens, lints, and runs the headless primitive tests. It is
deterministic and browser-free, so it runs after every change.

`npm run check:slow` runs the Playwright browser suite. It is the lock gate, not part of
the edit loop.

## Scope discipline

Build the smallest surface that satisfies the states being locked. No speculative
theming, configuration, or extensibility that no locked state requires.
