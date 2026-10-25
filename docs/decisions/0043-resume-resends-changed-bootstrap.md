# 0043 — A resume re-sends the bootstrap when GSD now renders a different one

- **Status:** Accepted
- **Date:** 2026-10-25

## Decision

Every bootstrap injection on Codex, dsh, and Claude Code writes the sha256 of the rendered bootstrap to the session's `bootstrap-emitted` marker. On a resume, Codex and dsh inject only the capsule, or nothing, when the marker holds the digest of the current render, and otherwise the current bootstrap, then the capsule when there is one. Claude Code keeps leaving a resume of an unknown session to its next prompt, and re-sends the bootstrap on a resume whose marker holds another digest. This supersedes 0041.

## Rationale

A marker that only records that a bootstrap was sent cannot tell a current bootstrap from one naming a sub-agent model the user has since replaced with `gsd config set`. A resumed Codex session kept scout `a6/glm-5.3-flash` after the user changed it, and three `spawn_agent` calls failed as unknown models. Comparing digests re-sends only when the bytes changed, so an unchanged resume stays as free as under 0041. Markers written before this change hold no digest, so each such session gets one bootstrap on its next resume.
