`src/inventory.js` is written in an old style. Please modernize it and split `summarize` into three functions exported from `src/inventory.js`, with `summarize` calling them:

- `normalizeItem(item)` returns `{ name, qty, price, sku }` holding the values `summarize` uses today for that item, or `null` for an item `summarize` skips.
- `formatLine(entry)` takes what `normalizeItem` returns for a kept item and returns that item's line.
- `formatFooter(entries)` takes the kept entries in input order and returns the `SKUs:` and `Total:` lines joined by a newline.

Use `const` and `let` instead of `var`, template literals instead of string concatenation, and array methods where they read better. This is a pure refactor: `summarize` must return exactly the same text as today for every input, including odd ones such as missing fields, quantities written as text, and SKUs of different lengths.
