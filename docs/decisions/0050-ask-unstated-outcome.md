# 0050 — The bootstrap asks for an unstated outcome before editing

- **Status:** Accepted
- **Date:** 2026-11-02

## Decision

1. **The ask rule leads Routing.** The first route in `skills/gsd/SKILL.md` reads: on any path, when the request leaves a result a test would pin unstated (format, rule, threshold, wording), end the turn with one question proposing defaults, before editing; a default you pick and state is still a guess; never ask what the request or code settles. It replaces the last route, `Unclear intent`, and binds to no single route, because the agent that needed it took no route's steps.
2. **A stated default is a guess.** The rule names that case outright, since an agent that notices the gap otherwise announces a default and builds it.
3. **The cap rises to 545.** Turn economy, the skill-read sentence, and Canon lose 8 words, and the bootstrap cap of decision 0045 rises from 520 to 545 words for the rule's remaining 25. The budget in `test/skills-word-budget.test.js` stays the cap's only owner. Decision 0045 kept the Routing text's bytes; this rule is the first change to them since.

## Rationale

The intent benchmark of decision 0049 ran `claude-haiku-5-5` once per fixture and arm. With the previous bootstrap the GSD arm asked on none of the four vague requests: on three it built its own design, was corrected, and rebuilt, and on the fourth it guessed the transliteration rule right. It passed all six fixtures in 9 agent turns with 1,950,279 tokens and 0.0817 USD, against vanilla's 9 turns, 1,591,705 tokens, and 0.0698 USD with the same three corrections. Its transcripts show it skipping the brainstorming route and the quick fix's `derive-base` and editing straight after reading the code, so a rule on either route never fired.

A first wording of this rule, placed first, changed nothing: haiku wrote that the request "doesn't say the page-parameter shape, so I'll pick a backward-compatible default and state it". With the wording above, the GSD arm stopped to ask on the same three vague requests instead of building, again guessed the fourth right, asked nothing on the two clear requests, and passed all six in 9 turns with 1,452,547 tokens and 0.0671 USD. The turn count did not change; the first turn of each vague request asked instead of building a design the user then rejected, so the GSD arm moved from 22.5% more tokens than vanilla to 8.7% fewer. Each cell ran once, so these are one sample per cell. Decision 0045 measured the bootstrap at 1–4% of a GSD session's tokens, with cost following the number of turns, so 25 words that remove a turn are worth carrying.
