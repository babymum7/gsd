# 0001 — Bun replaces Node as the GSD runtime

- **Status:** Accepted
- **Date:** 2026-08-19

## Decision

GSD switches entirely to Bun as its single runtime. Tools, tests, and scripts run under `bun`, `bun test`, and `bunx`; the test runner migrates from `node:test` to `bun:test`; and Node is no longer a runtime prerequisite. `node:` builtin module specifiers remain, because Bun implements them natively. Error-message contracts are re-pinned to Bun's deterministic wording.

## Context

GSD is a harness that agents invoke in foreign workspaces, so its runtime must be assumed present; today that runtime is Node ≥ 20. Bun 1.3.14 is available and runs the tools and most of the suite, but five deterministic tests diverge: Bun's `node:test` shim does not implement nested `t.test` subtests (they throw `NotImplementedError`), and Bun's UTF-8 decode and module-resolution error messages differ from Node's. Keeping `node:test` would silently drop 26 subtests, so the suite must migrate to native `bun:test` rather than rely on the shim.

## Consequences

- Foreign workspaces require Bun ≥ 1.3.14 instead of Node ≥ 20.
- `t.test` subtests in the extension contract suite are restructured into `describe`/`test`.
- io-error and module-not-found assertions are re-pinned to Bun's messages.
