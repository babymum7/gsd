# 0026 — User sub-agent profiles

- **Status:** Accepted
- **Date:** 2026-09-26

## Decision

GSD names two sub-agent profiles — `scout` for bounded read-only exploration and `worker` for dispatched implementation — and never ships a model name for any of them. The user maps each profile per host in one file, `<GSD home>/settings.json` (`GSD_HOME`, default `~/.gsd`), written and read through `gsd config set|get|list` with schema validation: version `1`, profiles `scout|worker`, hosts `claude|codex|omp`, one single-token string value each. Claude Code values are the model aliases its Agent tool accepts (`sonnet`, `opus`, `haiku`, ...), because that parameter takes no raw model id; Codex values are model ids; OMP values are agent names, because the OMP task tool selects an agent and the agent's model role selects the model.

Profiles apply at spawn time, not in agent definitions: each host adapter appends one `## Sub-agent profiles` line for its own host inside the injected bootstrap, and the skills tell the owner to pass that value as the Agent tool `model` (Claude Code), `spawn_agent` `model` (Codex), or task tool `agent` (OMP). The bootstrap source carries no profile text, so an absent file, a host without values, or an invalid file leaves the injected bootstrap byte-identical to the core render and every spawn on the host default.

A scout is used only when exploration spans many files, unfamiliar areas, or external references; one or two known reads stay inline. Scout output is unverified: the owner re-reads every fact a decision rests on. Diagnosis stays inline — a scout only locates code. This keeps the owner's context for convergence with the user while the host default, rather than GSD, remains the fallback for every spawn.
