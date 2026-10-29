# 0044 — The outcome benchmark compares sandboxed omp sessions with and without GSD

- **Status:** Accepted
- **Date:** 2026-10-30

## Decision

`test/eval/outcome-eval.mjs` measures whether GSD changes what a session delivers. It runs each fixture in a vanilla arm and a GSD arm on `omp -p --mode json`, then grades the tree each session leaves checked out against hidden tests.

1. **Arms.** Both launches share every flag, environment variable, and bound path. Only the GSD arm adds `-e` with a wrapper extension that loads the omp adapter from a plugin bundle built from the checkout. omp's JSON events never carry injected context, so the wrapper records each outgoing request that contains the bootstrap. A GSD row without that evidence is invalid and stays out of the sums, and a bootstrap-error payload is not evidence.
2. **One model.** `--model`, `--smol`, `--slow`, `--plan`, and a config overlay pin every model role to the measured model at `--thinking high`. `--no-prewalk` and the overlay keep prewalk, the advisor, and memories off. The user's `config.yml`, task agents, extensions, and personality file are hidden, so no user setting enters either arm. Both arms pass `--wait-async`; without it print mode aborts background sub-agents at exit.
3. **Sandbox.** Sessions and grading run under `bwrap`. The home directory is replaced by a scratch directory; `/tmp`, `/var/tmp`, `/run/user`, and the checkout are hidden; the docker socket is masked; and the PID namespace is private. Only the run directory is writable, plus the omp agent directory without `sessions/` and `terminal-sessions/`, so auth refreshes in place. A missing bind is fixed by binding that one path, never by exposing the home directory. Without `bwrap` the runner refuses.
4. **Grading.** Hidden tests reach the workspace only after the session ends. Edited visible tests are named and restored before the visible suite counts regressions. Grading runs without network and with a harness-owned bun config.
5. **Outcomes and cost.** `ok`, `cost-cap`, `time-cap`, and `error` are distinct outcomes, and a capped row stays in the report and is graded. Cost and tokens add the parent's assistant usage to each task sub-agent's final usage. omp writes the cost of titling sub-agent sessions only to its debug log, so it is excluded.
6. **Report.** `test/eval/outcome-report.json` keeps one raw row per session plus per-arm counts and sums, and makes no aggregate improvement claim. Its fingerprint binds the bootstrap, bundle, fixture, and harness bytes, and the runner resumes only into a report with the same fingerprint. The committed report fails the deterministic suite when malformed and warns when stale.
7. **Live budget.** The first live run is one repeat per cell: 8 sessions on `google-antigravity/gemini-3.8-flash`, capped at 1 USD and 20 minutes each. If any pilot row is capped, invalid, or costs more than the cap, the owner stops and asks before the repeats. Otherwise the runner fills repeats 2 and 3, 16 more sessions. A harness change or a higher cap after the pilot needs fresh approval.

## Rationale

Every earlier evaluator scores one classification turn, so none shows whether GSD's lifecycle changes the delivered result. Probes on 2026-10-30 shaped each rule above:

- The bootstrap the adapter injected never appeared in the event stream.
- A user's model roles sent task sub-agents and the advisor to other models.
- Without `--wait-async`, a task sub-agent was aborted when print mode exited.
- The docker socket was reachable from a plain read-only bind.

Hiding the home directory is a validity rule as well as a safety rule: transcripts there hold fixture solutions.
