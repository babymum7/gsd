# Design It Twice

When the user wants alternative interfaces for a chosen deepening candidate, the session owner performs three separate self-contained inline design passes. Based on "Design It Twice" (Ousterhout): the first idea is unlikely to be the best.

Use the vocabulary in [SKILL.md](SKILL.md): **module**, **interface**, **implementation**, **depth**, **seam**, **adapter**, **leverage**, **locality**, and **testability**.

## Process

### 1. Frame the problem space

State the constraints, dependency categories from [DEEPENING.md](DEEPENING.md), code behind the seam, and one rough illustrative sketch. This is shared input, not a proposal.

Use relevant vocabulary from supplied `docs/domain/<scope>.md` files only. When unavailable, use the user's terms; never search for or fabricate project vocabulary.

### 2. Run independent inline passes

Run at least three sequential passes in the current top-level context. Reset assumptions before each pass and apply a different constraint:

1. Minimize the interface to 1–3 high-leverage entry points.
2. Maximize flexibility for varied use cases and extension.
3. Optimize the common caller so the default case is trivial.
4. When applicable, design around an adapter seam for cross-seam dependencies.

Each pass produces:

1. Interface types, methods, parameters, invariants, ordering, and error modes.
2. A caller usage example.
3. The implementation hidden behind the seam.
4. Dependency and adapter strategy.
5. Tradeoffs in leverage, locality, and testability.

Do not dispatch child work. Sequential inline passes preserve the approved lifecycle context while still forcing independent alternatives.

### 3. Present and compare

Present designs sequentially, then compare depth, locality, and seam placement. Recommend the strongest design and explain why; propose a hybrid only when it clearly improves the result.
