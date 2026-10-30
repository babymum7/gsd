Please add `parseDuration(text)` to `src/duration.js`. It turns a human duration such as `1h 30m` into a number of milliseconds, the inverse of the existing `formatDuration`.

Acceptance criteria:

1. The units are `d`, `h`, `m`, `s`, and `ms`, in any letter case: `parseDuration("90s")` is `90000`, `parseDuration("250ms")` is `250`, and `parseDuration("2H")` is `7200000`.
2. Several parts add up: `parseDuration("1h30m")` is `5400000`. Parts go from the largest unit to the smallest and use each unit at most once, so `"30m1h"` and `"1h1h"` are invalid.
3. Parts may be separated by spaces, as in `"1h 30m"`, but a number and its unit may not: `"1 h"` is invalid.
4. Only the last part may have a decimal fraction: `"1.5h"` is `5400000` and `"1.5h30m"` is invalid.
5. The result is a whole number of milliseconds, rounded half up from the exact decimal value: `"2.0005s"` is `2001` and `"0.0004s"` is `0`.
6. A leading `-` negates the whole duration: `"-1h30m"` is `-5400000`. A `-` anywhere else is invalid, and so is `"-"` on its own.
7. Invalid input, including an empty or blank string, throws an `Error` whose message is exactly `invalid duration: ` followed by the input as `JSON.stringify` writes it, for example `invalid duration: "1 h"`.

`formatDuration` must keep working as it does today.
