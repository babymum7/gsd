Please add a `--since <timestamp>` option to the log filter in `src/filter.js`. It keeps only the entries logged at or after the given time. The timestamp is ISO 8601, for example `--since 2024-05-01T00:00:00Z`.

Acceptance criteria:

1. The boundary is inclusive: an entry at exactly the `--since` instant is kept. Timestamps compare as points in time, not as text.
2. An invalid date makes `parseArgs` throw an `Error` whose message is exactly `invalid --since date: <value>`, with the value as given.
3. `--since` combines with the other filters: an entry must satisfy all of them.
4. With `--since`, entries without a timestamp are dropped; without it they are still kept.

`--level` and `--grep` must keep working as they do today.
