# Design It Twice

Use this method for a named seam or user-selected architecture candidate when materially different interfaces are plausible. The session owner runs the comparison inline; it dispatches no child design work.

Use the vocabulary in [SKILL.md](SKILL.md) and dependency categories in [DEEPENING.md](DEEPENING.md).

## Frame the problem

State once:

- owning production capability and bounded context;
- callers, invariants, data ownership, failure semantics, and transaction boundary;
- dependencies and their categories;
- code that should sit behind the seam;
- public behavior tests that must survive;
- backend/frontend boundary effects when both participate.

Use mapped domain terms when `docs/domain/index.md` exists. If it does not, use evidenced production behavior and user-confirmed business language; never fabricate terminology.

## Independent passes

Reset assumptions before each pass. Produce three self-contained shapes:

1. **Minimum hard surface** — one to three high-leverage entry points hiding the most complexity.
2. **Variation boundary** — support only evidenced caller, adapter, or policy variation.
3. **Common-path locality** — make the dominant caller trivial while preserving invariants and failure semantics.

For each shape provide:

- signatures, parameters, invariants, ordering, error modes, and performance commitments;
- one caller example;
- implementation hidden behind the seam;
- dependency, mapping, and adapter placement;
- transaction and state ownership;
- leverage, locality, testability, compatibility, and migration tradeoffs.

Do not manufacture a fourth shape by renaming types or adding speculative configuration.

## Compare

Compare the proposals by:

- caller knowledge and interface size;
- behavior hidden and reused;
- domain-policy locality;
- dependency direction;
- adapter count and justification;
- test stability;
- migration and rollback cost.

Recommend the strongest shape. A hybrid is valid only when it removes a demonstrated weakness without expanding the hard interface or introducing a hypothetical seam.
