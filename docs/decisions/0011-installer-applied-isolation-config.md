# 0011 — Installer asks, then applies approved isolation settings

- **Status:** Accepted
- **Date:** 2026-09-14

## Decision

Supersedes only the advisory-only installer rule in decision 0010 §3. Everything
else in 0010 stands unchanged: the per-request isolation instantiation, the
serial fallback as the default path on stock config, and the measurement method.
After publishing the extension, when the effective global `task.isolation` triple
differs from the GSD-isolated default (`enabled=true`, `merge=branch`,
`apply=false`) and the run is interactive with `omp` on PATH, the installer asks
exactly one question — `Set them now via omp? [y/N]` — defaulting to No.

1. **Applied change:** On an explicit yes, the installer sets only the deviating
   keys through `omp config set`, then re-reads the effective config file — never
   trusting omp's exit status — and requires every target value to have landed.
   It then prints the exact change record: each changed key as `old -> new`, the
   config file written, the effect scope, and one revert command per changed key.

2. **Declined or unattended:** Any other answer (No, empty, EOF), a non-TTY
   stdin, or a missing `omp` binary leaves the previous advisory-only behavior
   verbatim: print the manual commands, change nothing, and the install still
   succeeds with exit 0.

3. **Honest failure:** An apply that does not land on the re-read is a hard
   failure naming the key and the config file, exit 1 — a user-approved change
   is never silently dropped, even though publication itself already succeeded.

4. **Bounded mutation:** Keys already matching the default are never rewritten,
   and no other config keys are read or written. The question is asked at most
   once per install run.
