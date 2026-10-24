# 0041 — A resumed Codex or dsh session gets only the capsule when it already holds the bootstrap

- **Status:** Accepted
- **Date:** 2026-10-25

## Decision

On a resume, the Codex and dsh adapters check the per-session `bootstrap-emitted` marker under `<tmpdir>/gsd-codex` or `<tmpdir>/gsd-dsh`. When the marker exists, the session already received the bootstrap and the resumed transcript replays it, so the adapter injects the recovery capsule when the session owns a packet and nothing otherwise. When the marker is absent, the adapter injects the bootstrap, then the capsule when there is one. Every injection of the bootstrap writes the marker.

## Rationale

Reviewed sessions showed a resume with no active work injecting a second full bootstrap into a transcript that already held one, which cost about 3,000 tokens per resume and repeated the routing rules mid-conversation. The Claude Code adapter already skips the bootstrap on a resume. Codex and dsh used the bootstrap as the fallback because they had no record of what the session received; the marker supplies that record. A session the marker does not know, such as one started before GSD was installed or on another machine, may lack the bootstrap, so it still gets the full set.
