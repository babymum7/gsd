# 0045 — GSD sessions spend few turns

- **Status:** Accepted
- **Date:** 2026-10-30

## Decision

1. **Turn economy.** The bootstrap carries a `## Turn economy` section: independent calls go in one message, a skill is read when its step is reached rather than ahead of time, skill commands run as written without `--help`, an unchanged file is never re-read, the session reports once the final checks pass without re-checking, and todo updates ride along with other calls. The bootstrap cap of decisions 0021 and 0042 rises from 450 to 520 words to carry it, and the Routing text keeps its bytes. The budget in `test/skills-word-budget.test.js` is the cap's only owner.
2. **One command per stage.** A lifecycle stage that only moves state runs as one `&&` command written in its skill. `gsd-to-plan` validates with `analyze-waves`, binds `phase=approved`, cuts `wip/<feature>`, and sets `phase=executing`. A task's commit and checkpoint are one command, and the last task's checkpoint also sets `phase=verifying`. `merge` delivery is preflight, `phase=ready`, the merge message, the merge, and feature cleanup. The phases, the `next_action` defaults, and the tools are unchanged, and the deterministic suite runs the three commands as written.
3. **Gate entry.** The terminal gate drops its separate `validate-plan`, because preflight validates the plan against `base_ref`, and runs its first preflight in the same message as the diff and the fast checks. Slow suites still start only after preflight reports ready, and the delivery command's preflight still guards the merge.
4. **Planning and diagnosis.** `gsd-to-plan` writes the plan in one write and no longer suggests `init-plan`. `gsd-diagnosing-bugs` treats its phases as a checklist rather than todo items, shrinks Phases 2 to 4 to one confirming probe when the first red run isolates the cause, and reads Git history only for a regression.

## Rationale

The outcome benchmark of decision 0044 ran 12 sessions per arm on gemini-3.8-flash. Both arms passed all 180 hidden tests, but the GSD arm used 15,508,312 tokens against vanilla's 8,913,308. Feature-criteria made up 84% of the gap. There a GSD run made 68.7 tool turns against 36, and 27.7 of those turns did only ceremony: five state writes, validation and preflight twice, `--help`, REFERENCE reads for cleanup, and re-checks after the merge. GSD also batched fewer calls than vanilla in every fixture.

The bootstrap itself is 1–4% of GSD tokens. Each turn resends the whole context, so cost follows the number of turns, and a rule that removes turns is worth more than the words it adds. Replaying the kept transcripts without the turns these rules remove estimated the GSD arm at about 8.54M tokens. The live result is recorded in `test/eval/outcome-report.json`.

Collapsing stages in skill text, rather than adding phases or tool commands, needs no new tool surface. `gsd-state.mjs set` already resolves `last_green_commit=HEAD` and fills `next_action` when the phase changes, and preflight already validates the plan.
