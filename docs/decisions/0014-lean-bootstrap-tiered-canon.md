# 0014 — Lean bootstrap with a tiered canon

- **Status:** Accepted
- **Date:** 2026-09-19

## Decision

The injected session bootstrap (`skills/gsd/SKILL.md`) carries only what every prompt
needs: triage and routing, selection and continuity, the transition rule, and a pointer
plus the decision-name list for the completed-state matrix. Policy that only non-direct
lifecycle work reads — the full completed-state matrix, the packet grammar, the wave
dispatch gate, the runtime state contract, and the cleanup mechanics — lives in
`skills/gsd/REFERENCE.md`, which is loaded on demand.

The bootstrap names each delegated block by its canonical `§` heading, and the citation
test keeps those pointers resolving, so leaning the bootstrap never orphans the canon it
delegates to. Moving the completed-state matrix out of the bootstrap first ported the one
phrase the reference copy lacked — that a full malformed packet outranks a prompt naming
another valid feature — so the move removed duplication without dropping a row.

The result: a direct answer is classified from the lean bootstrap alone, while lifecycle
work pays one on-demand reference read for the matrix and the policies it actually uses.
