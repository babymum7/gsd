# 0016 — Independent wave review is a spawned read-only reviewer

- **Status:** Accepted
- **Date:** 2026-09-19

## Decision

The independent review of a reconciled wave is defined by what the host can do, not by
whether it ships a reviewer agent definition.

1. Where the host can spawn an isolated sub-agent, the wave review runs as that host's
   reviewer sub-agent: `gsd-reviewer`, shipped read-only by tool grant on Claude Code and by
   `sandbox_mode = "read-only"` on Codex, or one isolated read-only reviewer task on OMP,
   whose sub-agents are spawned from a prompt rather than selected from a definition
   directory.
2. Every spawned reviewer carries the same canonical brief defined by
   `skills/gsd-verify/SKILL.md` § Standalone review — the Standards and Intent axes,
   `path:line` evidence, and an advisory bar that blocks only on bound plan text or a red
   deterministic check. The brief is not re-specified per host.
3. Only a host that can neither publish a read-only reviewer definition nor spawn an
   isolated sub-agent falls back to the owner running the `gsd-verify` standalone review
   itself.

Canon `REFERENCE.md` § Wave dispatch states the invariant ("a reviewer sub-agent where the
host can spawn one, otherwise the standalone review of `gsd-verify`"); `adapters/README.md`
carries the per-host mechanism; and the domain install workflow publishes a reviewer
definition only where the host selects reviewers by definition.

Rationale: OMP is the primary host and can spawn isolated sub-agents, so the earlier wording
"where the host provides one" silently routed it to the owner-run fallback and left the
primary host without an independent reviewer.
