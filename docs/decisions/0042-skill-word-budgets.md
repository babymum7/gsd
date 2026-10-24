# 0042 — Every skill file has a word budget

- **Status:** Accepted
- **Date:** 2026-10-25

## Decision

Every Markdown file under `skills/` has a word budget in `test/skills-word-budget.test.js`, counted as whitespace-separated words. The suite fails when a file exceeds its budget, when it sits more than 5% under its budget, which then must be lowered to the new size, and when a file has no budget. A new rule therefore displaces existing text or comes with an explicit budget raise in review. The bootstrap keeps the 450-word cap of decision 0021.

## Rationale

Only the bootstrap had a cap, and skill text grew from 13,245 to 15,395 words in the month after 2026-09-26 as each session review added rules; an earlier peak of 22,283 words in July had needed a dedicated cut. Agents pay for these words on every feature, and some models read a whole file instead of the cited section. A per-file budget makes growth visible in the diff that causes it, and the 5% ratchet keeps a cut from being spent again silently.
