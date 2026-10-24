# 0040 — opencode v2 loads GSD as a native server plugin that sends synthetic messages

- **Status:** Accepted
- **Date:** 2026-10-25

## Decision

`gsd install --agent opencode` writes `<configDir>/plugins/gsd/server.mjs`, a marked shim that re-exports the bundle's `adapters/opencode/gsd-context.mjs`, and writes the visible and explicit-only skills without the `gsd` router into `<configDir>/skills`. The config directory is `$OPENCODE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode`; a missing directory or a `plugins/gsd` directory without the GSD marker stops the install before any change. The plugin sends the bootstrap as a `session.synthetic` message tagged `gsd/bootstrap` from the `prompt` hook when the root session's context holds no tagged message, and sends the bootstrap then the recovery capsule on `session.compaction.ended`, or from the next `prompt` hook when the context starts from a compaction and holds no tagged message; both surfaces send only while the context holds none. Child sessions get nothing, and opencode has no sub-agent profiles, like dsh.

## Rationale

opencode v2.1.4 auto-loads `server.mjs` from each directory under `<configDir>/plugins` and exposes no session-start hook with injected context. Live probes showed that a synthetic message sent from the `prompt` hook reaches the model of that same turn, that the tag in `session.context` survives a restart so a resumed session is not injected twice, that a compaction drops earlier synthetic messages and starts the context with a `compaction` entry, and that a synthetic message sent on `session.compaction.ended` reaches the next turn. Checking the context instead of an in-memory set keeps one injection per history across processes, and a shim keeps the user's config directory free of bundle code, so a reinstall only rewrites the bundle. opencode ignores the `hide` frontmatter, so hidden skills are never written there; it honors `disable-model-invocation` for the explicit-only skills.
