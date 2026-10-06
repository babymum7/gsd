# Plan grammar

`validate-plan` is the executable authority; this file describes what it accepts.

Only `# Plan`, `## Feature`, `## Base`, `## Acceptance Criteria`, and `## Tasks` are required. Every other section below is optional and sections may appear in any order; write an optional section only when it carries information. A present section keeps its exact grammar. The validator rejects missing required, duplicate, unknown, malformed, empty, or vague sections, and any line between the title and its first section. UTF-8/LF only.

```markdown
# Plan
## Feature
`<feature>`
## Base
`<base>`
## Repos
| Repo | Path | Base |
| --- | --- | --- |
| <name> | `.` | `<base>` |
| <name> | `<relative path such as ../api>` | `<branch>` |
## Summary
<one concrete outcome>
## Context
<bounded context>
## Domain Impact
- **Classification:** <none|change-existing-context|introduce-context|change-context-boundary>
- **Contexts:** <none|sorted comma-space-separated context slugs>
- **Documentation:** <none|update-existing|bootstrap-feature-context>
- **Broad bootstrap:** <not-offered|declined|selected>
- **Evidence:** <concrete code/schema/contract evidence>
## Scope
- <included behavior>
## Acceptance Criteria
### AC-1: <title>
- **State:** active
- **Outcome:** <optional concrete behavior>
- **Action:** <optional concrete operation>
- **Expected:** <optional observable result>
- **Scenario:** GIVEN <concrete precondition> WHEN <concrete operation> THEN <observable result>
## Decisions
None.
## Invariants
- **I-1:** <must remain true>
## Non-goals
- **NG-1:** <explicit exclusion>
## Interfaces
| Criterion | Seam | Path | Lower-seam reason |
| --- | --- | --- | --- |
| AC-1 | <public seam> | `<repository-relative path>` | none |
## Tasks
### T1: <short task>
- **Satisfies:** AC-1
- **Repo:** <name from Repos; optional>
- **Files:**
  - `<path>` — <create|modify|delete>: <concise contract intent>
- **Test:** `<focused command or none>`
- **Status:** pending
```

Decisions is exact `None.` or sequential blocks of `### D-1: <title>`, `- **Decision:** <value>`, `- **Rationale:** <value>`.

- `## Feature` equals the `.scratch/<feature>` directory name. Backticks on Feature and Base are canonical but optional.
- A task that serves several criteria lists them comma-separated: `- **Satisfies:** AC-1, AC-2`.
- AC and task IDs are positive sequential integers in heading order. Only `active` criteria execute; a replacement gets a new ID and the former becomes `superseded`.
- Every active criterion carries one concrete `GIVEN/WHEN/THEN` Scenario, and the optional Outcome, Action, and Expected, when present, appear in that order and stay concrete. A whole value or clause of `TBD`, `TODO`, `<placeholder>`, `works correctly`, `run tests`, `valid`, `covered`, or `success` is invalid; the same words inside real text (a todo list, a `<form>` element) are fine.
- A present `Domain Impact` uses the exact five fields; an absent one makes no domain claim. `none` requires no contexts or documentation; `introduce-context` requires `bootstrap-feature-context`; Broad bootstrap is `not-offered` whenever the domain index exists.
- A present Interfaces table pins each listed active AC at most once, and a task spanning several pinned ACs may pin each at its own seam. A lower seam needs a concrete reason.
- Every active AC appears in at least one non-superseded task `Satisfies`; live tasks satisfy only `active` criteria.
- `Repos` is only for a plan that touches more than one repository. It lists every repository once, including this one as path `.` with the plan's Base; a task's `Repo` names a row, its `Files` are relative to that repository, and a task without `Repo` belongs to this repository.
- Every task owns at least one unique safe relative path with one `create|modify|delete` operation and a concise intent, plus one focused command; `none` is only for non-observable mechanical work. A task `Status` is `pending`, `in_progress`, `done`, or `superseded` (`complete` and `completed` read as `done`); a `superseded` task never runs. Only `superseded` changes behavior: progress lives in `state.toon`, so finishing a task needs no `Status` edit. Paths under test directories or `*.test.*` / `*.spec.*` count as observation-only for shard ownership.

Full validation blocks only at binding, at resume (so each amendment revalidates), and at the terminal gate; drafts in between are not revalidated.
