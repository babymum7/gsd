# 0031 — The plan validator reports every defect and drops rules that only cost reruns

- **Status:** Accepted
- **Date:** 2026-10-06

## Decision

`validate-plan` (and every command that validates a plan) reports every independent rejection in one run: the first as `error:`/`line:`/`help:` as before, each further one as numbered `error_N`/`line_N`/`help_N` rows, and an `errors:` count. The title and section skeleton stay fail-fast, each task block is checked on its own, and a whole-plan rule (criterion coverage, domain-shard ownership) runs only when every task parsed, so a dropped task never reads as a coverage gap.

Four grammar rules are relaxed because they rejected plans whose meaning was unambiguous:
- Feature and Base may be written without backticks.
- `Satisfies` accepts criteria separated by spaces as well as commas.
- Task `Status` reads `complete` and `completed` as `done`.
- A task spanning several pinned criteria may pin each at its own seam. This replaces the identical-pin clause of decision 0003.

## Rationale

The one session that ran GSD end to end spent 14 calls on seven validator runs in a row, each failing on a different rule, and degraded three plans to satisfy the identical-pin rule: it widened one pin to a whole package and moved another to a different package, only so the rows matched. A validator that names every defect turns those runs into one edit. The relaxed rules guarded no behavior: a bare slug or branch name parses the same way, an ID holds no space, `complete` has one meaning, and a task's `Test` command can run more than one seam. Every rule that protects data, ownership, or the merge target is unchanged.
