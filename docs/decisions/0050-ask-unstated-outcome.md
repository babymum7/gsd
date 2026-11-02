# 0050 — The bootstrap asks for an unstated outcome before editing

- **Status:** Accepted
- **Date:** 2026-11-02

## Decision

1. **The ask rule leads Routing.** The first route in `skills/gsd/SKILL.md` reads: on any path, when the request leaves a result a test would pin unstated (format, rule, threshold, wording), end the turn with one question proposing defaults, before editing; a default you pick and state is still a guess; never ask what the request or code settles. It replaces the last route, `Unclear intent`, and binds to no single route, because the agent that needed it took no route's steps.
2. **A stated default is a guess.** The rule names that case outright, since an agent that notices the gap otherwise announces a default and builds it.
3. **The cap rises to 545.** Turn economy, the skill-read sentence, and Canon lose 8 words, and the bootstrap cap of decision 0045 rises from 520 to 545 words for the rule's remaining 25. The budget in `test/skills-word-budget.test.js` stays the cap's only owner. Decision 0045 kept the Routing text's bytes; this rule is the first change to them since.

## Rationale

The intent benchmark of decision 0049 first ran `claude-haiku-5-5` with the previous bootstrap, and its GSD arm asked on none of the four vague requests: on three it built its own design, was corrected, and rebuilt, and on the fourth it guessed the transliteration rule right. Its transcripts show it skipping the brainstorming route and the quick fix's `derive-base` and editing straight after reading the code, so a rule on either route never fired. A first wording of this rule, placed first, changed nothing: haiku wrote that the request "doesn't say the page-parameter shape, so I'll pick a backward-compatible default and state it", which is why a stated default is named a guess.

With the rule as worded above, `test/eval/intent-report.json` holds one session per fixture, agent, and arm, both arms run together on the same harness:

| Agent | Asked first, GSD | Asked first, vanilla | Asked on a clear request | Passed | Agent turns, GSD / vanilla | Tokens, GSD vs vanilla |
|---|---|---|---|---|---|---|
| `claude-haiku-5-5` | 3/4 | 0/4 | 0 | 12/12 | 9 / 9 | −22% |
| `claude-sonnet-5-5` | 3/4 | 0/4 | 0 | 12/12 | 9 / 9 | +15% |
| `claude-opus-5-5` | 3/4 | 0/4 | 0 | 12/12 | 9 / 9 | −6% |
| `dsh:default` | 3/4 | 0/3 valid | 0 | 11/11 valid | 9 / 7 | not comparable |
| `codex:gpt-6-luna` | 4/4 | 0/4 | 0 | 12/12 | 10 / 9 | +52% |

Every GSD arm asked before building on at least three of the four vague requests, and no vanilla arm asked on any; no arm asks on a clear request, and every valid session passes. The Claude and dsh arms all passed `slug-vietnamese` on the first turn, because the common transliteration convention is the one the fixture wants; Codex with GSD asked there too and paid one more turn. Turn counts are otherwise equal, so the rule changes what the first turn does, a question instead of a design the user then rejects, not how many turns a request takes. On these small fixtures it saves no tokens: the Claude differences run from −22% to +15%, and an earlier full run of the same cells, discarded for a dsh sandbox leak, put them between −4% and +25%, so they are run-to-run spread. Codex with GSD spent 52% more tokens and 135% more wall time than vanilla. In every vanilla dsh session inspected, the agent searched the machine and the web for the spec, and one session ran out its 20 minutes without replying, so its tokens measure that search. Each cell ran once.

Decision 0045 measured the bootstrap at 1–4% of a GSD session's tokens. The 25 words buy an agent that asks for the deciding detail before writing code on every agent measured.
