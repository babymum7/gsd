# 0020 — The canon is read by named section

- **Status:** Accepted
- **Date:** 2026-09-19

## Decision

Decision 0014 moved policy out of the injected bootstrap into the on-demand canon, but
it left the read itself unbounded: the bootstrap said to read `REFERENCE.md` "for
canonical contracts", and the canon's own first line said to load "this file". A flow
that followed either literally paid for the whole 50 kB canon — about 11,000 tokens —
when every owner already cites the handful of sections it applies.

The canon is now read by named section, and the bound is enforced rather than assumed.

1. The injected bootstrap reads `GSD_ROOT/skills/gsd/REFERENCE.md` by named `§` section,
   whole only when no step names a required contract. The clause is the escape hatch:
   when a contract a flow must apply is named nowhere, reading the file whole is still
   correct, so the rule narrows the common read without inventing a failure mode.
2. The canon's own header states the same rule, so the instruction holds at the point of
   use and not only in the always-present bootstrap.
3. A test computes, per visible owner, the byte span of every `§` section that owner
   names and caps the widest at 10,000 bytes. The widest today is `gsd-to-plan` at 8,645
   bytes across 7 sections, or 17% of the file; the cap leaves room to grow a section
   without allowing a return to a wholesale read.
4. The rule is safe because decision 0014's citation layer already resolves every canon
   citation to a real heading. A renamed or deleted section still fails the build, so
   section-targeted reading cannot silently orphan a pointer.

Measured on the shipped bytes: the whole canon is 50,330 bytes, about 10,966 tokens,
while the heaviest owner's named set is 8,645 bytes, about 1,879 tokens. A lifecycle
session therefore saves roughly 9,000 tokens at the top end and 5,000-9,000 typically,
against zero added bootstrap words. The activation evaluator's canon scope already
models exactly this behavior: it supplies the single named section
`### Completed-state and cleanup matrix`, not the file, and that scope is the one that
scores 119/120 rather than the bootstrap-only lower bound's 109/120.

Rejected alternatives: splitting the canon into one file per topic (the byte cap and the
citation layer already give the same guarantee for far less churn, and a per-topic split
would multiply the paths an owner must resolve), and trimming the injected catalog
descriptions to pay for the new clause (measured at 65 tokens, 2.8% of the bootstrap,
in exchange for the signal that selects an owner).

## Consequences

The bootstrap stays inside its cap at 1,119 of 1,120 source words: the clause added ten
words and six were tightened out of two duplicated sentences, so the lean tier did not
grow to buy the rule. Canon source words fell by 2. Any future owner that needs more
canon must fit the 10,000-byte budget or state a reason to raise it.
