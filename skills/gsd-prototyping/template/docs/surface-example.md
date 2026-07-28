# Surface: Invoice list

Example of a locked surface document. One file per surface, named after the surface.
It records what the prototype actually renders, so a reader never has to guess which
states exist. Replace this content; keep the section shape.

## States

| State | Reached when | Renders |
| --- | --- | --- |
| empty | The account has no invoices yet | Explanatory copy and a single primary action |
| loading | A fetch is in flight | Skeleton rows and a busy primary action |
| populated | At least one invoice exists | The invoice table with per-row actions |
| error | The fetch failed | Inline error copy and a retry action |
| read-only | The viewer lacks the settle permission | The populated table with actions disabled |

## Flows

1. empty → loading → populated: the user creates the first invoice.
2. populated → loading → populated: the user settles an invoice and the list refreshes.
3. loading → error → loading: the fetch fails and the user retries.
4. populated → read-only: a viewer without the settle permission opens the same list.

Every row above is reachable in the prototype. A state described here but not rendered
blocks the lock, and so does a rendered state missing from this table.

The two sections below are machine-read, so each holds its entries only and no prose.
`## Production surfaces` holds claim lines: the production files converted from this
surface, sorted, each claimed by exactly one surface document. Before conversion its whole
body is the single line `none`. `## Conversion` holds one token: `converted` once production
has been converted from this surface, or `pending` while it still owes that conversion. A
locked surface starts `pending`, and it returns to `pending` whenever its design changes
again, so `validate-design-map` can count how many surfaces are still queued.

## Production surfaces

- `src/invoices/invoice-list.tsx` — converts the empty, loading, populated, and error states
- `src/invoices/invoice-row.tsx` — converts the per-row actions and their read-only state

## Conversion

pending

## Primitives

- `primitives/button.js` — every action on this surface, including its disabled and
  busy states.

## Open questions

None. Unresolved questions stay here as one concise line each; they never become
speculative prototype states.
