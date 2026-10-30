# 0046 — A hard outcome fixture set can show a quality difference

- **Status:** Accepted
- **Date:** 2026-10-30

## Decision

`test/eval/outcome-fixtures-hard/` holds outcome fixtures whose criteria a plausible one-step change misses, so the vanilla and GSD arms of decision 0044 can differ in delivered quality, not only in cost.

1. **Its own set and report.** `bun test/eval/outcome-eval.mjs --fixtures test/eval/outcome-fixtures-hard --report-path test/eval/outcome-report-hard.json` runs the hard set through the unchanged harness. `test/eval/outcome-hard-set.mjs` owns both paths and the set's live fingerprint. The fixture-set test checks the hard fixtures like the default ones, and the eval-report test fails on a malformed hard report and warns when it is stale. No harness file changes, so the default set and its report keep their fingerprint.
2. **Three fixtures.** `feature-duration-criteria` asks for `parseDuration` with seven numbered criteria whose examples break the obvious parser. `bug-scattered-cause` reports a mixed-case login failure whose cause also breaks the password reset and the email change, which only the prompt's note about other account features hints at. `refactor-modernize-trap` asks to modernize and split an old-style summary while keeping exactly today's output for every input. Every hidden test checks a sentence of its prompt.
3. **Live budget and verdict.** One repeat of each fixture comes first, 6 sessions, then repeats 2 and 3, 12 sessions, and the owner stops and asks when a row is invalid, capped, or over its cap. Before the repeats, fixtures may be revised once, only for a mismatch between a prompt and a hidden test that would be fixed whichever arm exposed it, and a revision restarts the report. A fixture favors an arm when that arm's worst repeat passes at least as many hidden tests as the other arm's best repeat and its sum over the repeats is higher. GSD delivers higher quality on the hard set only when at least one fixture favors it and none favors vanilla, and the mirror rule holds for vanilla. Three fixtures at three repeats show a direction, not statistical significance.

## Rationale

Decision 0044's run and the rounds of decision 0045 had both arms pass every hidden test, so those fixtures can show a difference in tokens and turns but never in quality. Before any session ran, a plausible one-step change failed 6 of the bug fixture's 12 hidden tests by fixing only the login lookup, 6 of the feature's 32 by stripping spaces and accepting parts in any order, and 8 of the refactor's 18 by switching to `Number`, `??`, and a numeric sort, while each reference solution passes them all. Keeping the harness unchanged keeps the round-three report current, and fixing the verdict rule before the measurement keeps it from being chosen afterwards.
