`renderReport` in `src/report.js` has grown into one long function that parses the timesheet text, groups the rows by team, and lays out the table, all in a single body. Please refactor it into three functions exported from `src/report.js` and make `renderReport` call them:

- `parseRows(text)` returns an array of `{ name, team, hours }` objects, one for each row `renderReport` currently keeps, in input order. `name` and `team` are the trimmed text and `hours` is a number.
- `groupByTeam(rows)` takes that array and returns an array of `{ team, rows, total }` objects sorted by team name. Each `rows` holds that team's `{ name, team, hours }` objects sorted by hours, highest first, with equal hours keeping their input order, and `total` is the sum of that team's hours.
- `formatTable(groups)` takes what `groupByTeam` returns and returns the report text. For an empty array it returns `No data`.

`renderReport` stays exported, and `renderReport(text)` must return exactly `formatTable(groupByTeam(parseRows(text)))`. This is a pure refactor: the output has to stay byte-for-byte identical for every input, so don't change which rows it keeps, how it orders them, or how the table looks.
