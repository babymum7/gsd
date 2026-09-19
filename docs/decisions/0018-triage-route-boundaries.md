# 0018 — Triage route boundaries are defined, not inferred

- **Status:** Accepted
- **Date:** 2026-09-19

## Decision

The three triage boundaries that the injected bootstrap previously left to
inference are now defined in the bootstrap itself, and the bootstrap word cap is
raised from 1075 to 1120 to carry them.

1. A Nano edit is **one literal edit needing no test**. `answer` covers a
   read-only question or a Nano edit; the word "Nano" had no definition anywhere
   in the injected surface, so a one-line literal edit was as consistent with
   `answer` as with `quick`, whose rule is a bounded change with converged
   acceptance.
2. A prompt that asserts a behavior the triage cannot confirm from the prompt
   itself is **`clarify`, never `research`**. Canon already listed "a claimed
   cause" and "a false premise" under `clarify`, but a why-does-the-code-do-X
   phrasing reads as a codebase question, and triage cannot verify a premise
   without the repository sweep it is forbidden to make.
3. A question whose answer lives **in this repo, a document, or a reference** is
   `research`, never `answer`. `answer` was defined as "read-only", which
   described the output mode but was read as an effort marker, so questions about
   GSD's own internals or about external documentation landed on `answer`.

Evidence: `test/eval/triage-eval.mjs` scores 13 fixtures covering all six routes
against the production bootstrap. On the pre-change bytes the three undefined
boundaries cost 28 of 156 first-attempt routes across `omp/anthropic/claude-sonnet-5`
(69/91 over seven runs), `omp/google-antigravity/gemini-3.8-flash` (34/39 over
three runs), and `omp/anthropic/claude-opus-5` (25/26 over two runs). With these
definitions the same three models routed 116 of 117 first attempts on the shipped
bytes — sonnet-5 51/52 over four runs, gemini-3.8-flash 39/39 over three, and
claude-opus-5 26/26 over two — the single residual miss being `multi-task-refactor`,
which also moved between runs on the pre-change bytes. Each
clause was ablated: removing the Nano gloss returned the literal-edit fixture to
answer-vs-quick misses, and the two research wordings that omitted either the
"lives in" framing or the named sources each lost the fixtures the other
recovered, which is why the shipped sentence carries both.

The definitions ship where the decision is made. Triage runs before any artifact
load, so the definition belongs in the bootstrap rather than in the on-demand
canon a direct answer never reads; `REFERENCE.md` keeps the same route list at
coarser resolution and states no conflicting rule. The cap raise follows the
stated-reason convention in `test/skills-frontmatter.test.js`: a front door that
can misroute the first durable decision of a session is the expensive kind of
lean. The visible-skill cap is untouched, since the bootstrap is not part of it.
