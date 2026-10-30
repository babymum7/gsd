# mercato

The backend of a small marketplace: accounts and handles, a product catalog with search, mentions and notifications, checkout, and shipping rates.

## Layout

- `src/accounts/`: sign-up, handles, and sessions.
- `src/catalog/`: products, product URLs, and search.
- `src/messaging/`: mentions and hourly notifications.
- `src/orders/`: checkout totals and money helpers.
- `src/shipping/`: shipping rates.
- `src/text/`: text helpers, also published for plugins (see Published packages).
- `docs/domain/`: the business rules of each area, indexed in `docs/domain/index.md`.
- `docs/decisions/`: settled decisions, one record per file.

## Development

Run the tests with `bun test`.

## Published packages

Two entry points under `src/text/` are also published for plugins, and both stay compatible for every release before 2.0:

| Package | Entry point |
| --- | --- |
| `@mercato/text` | `src/text/index.js` |
| `@mercato/text/legacy` | `src/text/legacy.js` |

Plugins written against the 1.0 release of `@mercato/text` import these names directly, so each stays exported from `src/text/index.js`:

- `toSlug(text)`: turns text into a URL slug. Accents are dropped, letters are lower-cased, the runs of ASCII letters and digits are joined with single dashes, and a slug longer than `SLUG_MAX` is cut back to its last whole word.
- `slugify(text)`: the 1.0 name of `toSlug`, returning the same slug.
- `SLUG_MAX`: the longest slug `toSlug` returns, 48 characters.
- `titleCase(text)`: capitalizes the first letter of each word and lower-cases the rest, except that `a`, `an`, `and`, `of`, and `the` stay lower case unless they come first.
