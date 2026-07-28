# Design system contract

The contract this prototype obeys, and one worked example of a structure that satisfies
it. Keep the obligations; adapt the file layout to what this prototype actually grows
into, then keep this document describing what exists.

Agent instructions live in the repository-root `AGENTS.md`, not here. This file is a
design artifact: it records the structure and standards of this directory so any agent
or design tool driving it produces the same shape. It is written to be supplied as context
to an external design tool, directly usable as a system prompt.

Any design tool may produce these files; this directory constrains what it leaves behind,
not how it is invoked. Design work here is governed by the root `AGENTS.md` together with
this file, whether the agent works from the repository root or from inside this directory.
Every generated design artifact is committed under this directory and nowhere else, and the
tool's own runtime output stays uncommitted. A single-file result is an input, not a resting
state: it is decomposed into the structure below before a surface locks.

Two layers live in this file. The **obligations** are product-neutral and
framework-neutral: declared tokens instead of inline literals, repeated markup extracted
into one component, a headless test per component and per state a surface renders, one
document per surface, and a real structure rather than one page of markup. Another project
adopts those unchanged. The **mechanics** under each heading below — DTCG JSON, CSS custom
properties, light-DOM custom elements, stylelint — are how this dependency-free web
template satisfies the obligations. A project on a component framework keeps the
obligations and uses that framework instead.

Nothing here names a product, a domain, or one specific screen. Product-neutral rules
belong in this file and in `docs/interaction-rules.md`; anything true of one surface only
belongs in that surface's document under `docs/`.

## The prototype is used like a real app

From the first commit this directory is exercised the way the shipped product will be:
real navigation, real state transitions, real keyboard and screen-reader behavior. The
only differences are that no backend exists and none of this code ships to production.

That is why it carries a real structure rather than one page of markup:

- one file per concern, not one file holding the whole surface;
- repeated markup extracted into a component under `primitives/`;
- visual values in `tokens/`, never inline literals;
- one document per surface under `docs/`.

A single-file artifact is an **input**, not a resting state, whatever produced it, and this
directory is not one page.
Decompose it into the structure above before the surface locks: split the markup into its
surfaces, lift repeated parts into primitives, extract every literal into a token, and
write the surface document. A locked surface is never one undifferentiated file.

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

One-off page composition stays plain markup consuming those primitives, and needs no
test of its own.

## Surfaces are documented by their states

Each surface has one document under `docs/`, shaped like `docs/surface-example.md`,
listing every reachable state and every flow between them. The prototype renders each
one; prose alone never substitutes for a rendered state.

A decision that only applies to that surface stays in its document. A rule that holds
for every comparable surface belongs in `docs/interaction-rules.md` as the next
numbered `IR-<n>` entry, with the trigger that fires it and the behavior it requires.
Read that ledger before designing a surface: its rules are already binding.

Each surface document also declares the production paths it governs, in a machine-read
`## Production surfaces` section holding claim lines only. Every claim names one
production file and what it converts from this document, sorted and claimed by exactly one
surface; before conversion the whole body is the single line `none`. That claim is what
makes drift detectable in both directions: without it, neither a prototype change awaiting
conversion nor production markup that moved ahead of its locked surface can be seen.

A second machine-read section, `## Conversion`, holds one token: `converted` once
production has been converted from that surface, or `pending` while it still owes the
conversion. A locked surface starts `pending`, and returns to `pending` whenever its design
changes again, so the queue of surfaces awaiting conversion is countable rather than a
judgment over rendered differences.

## One deterministic check loop

`npm run check:fast` builds tokens, lints, and runs the headless tests. It is deterministic
and browser-free, so it runs after every change and is also the lock gate: this prototype
has no second, slower suite.

Because the gate is headless, coverage is what makes it sufficient. Every state a surface
document lists carries a headless test asserting the observable behavior of that state, so
locking proves each reachable state rather than a screenshot of one of them.

## Scope discipline

Build the smallest surface that satisfies the states being locked. No speculative
theming, configuration, or extensibility that no locked state requires.
