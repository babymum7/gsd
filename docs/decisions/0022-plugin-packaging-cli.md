# 0022 — Plugin packaging through one CLI

- **Status:** Superseded by 0023
- **Date:** 2026-09-19

## Decision

GSD will provide one CLI for host installation and uninstallation. The CLI selects `omp`, `claude-code`, `codex`, or `all`, builds one self-contained local plugin bundle, and registers it through each host's native plugin system. Claude Code and Codex consume a local marketplace; OMP consumes a package extension manifest. The generated bundle keeps canonical hidden skills under an internal core directory and publishes only the visible skill catalog to host skill discovery. Existing adapter installers remain compatibility entry points.
