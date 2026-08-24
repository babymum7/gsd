---
name: gsd-verify
description: "Diff/PR review or planned/quick-fix terminal gate."
produces: [docs/gsd/<feature>/milestones.md, docs/gsd/<feature>/archive/plan.md, docs/gsd/<feature>/archive/implementation.md, state.toon]
consumes: [plan.md, state.toon, docs/domain/index.md, docs/domain/<scope>.md, AGENTS.md, docs/gsd/<feature>/milestones.md]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Do-not-load: invent completion without deterministic gates; per-task terminal verification
- Transition: planned or Quick-fix green path performs squash, automatic cleanup, and optional retain/archive

# Verify

> **Invocation guard** — automatic selection loads standalone review; active owners load planned/quick-fix/milestone gates. Select an Invocation Mode and validate only Required state under [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Post-plan pipeline contract and § Artifact Contract.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Standalone review | — | Markdown packet context | — | — |
| Planned WIP gate | `plan.md`; bound `state.toon` | authorized ledger | `state.toon`; authorized ledger; amended `plan.md` | Stop before review/merge only if `plan.md` or `state.toon` is missing/malformed |
| Milestone WIP gate | Planned state; authoritative ledger | — | `state.toon`; milestone ledger lifecycle state | Missing source/binding is Spec escalation; missing ledger evidence is Blocker |
| Quick-fix WIP gate | exact Quick-fix `plan.md`; bound `state.toon` | affected domain shards; `AGENTS.md` | `state.toon`; amended `plan.md` | Missing/malformed grammar, state, or binding blocks; recover real plan, never fabricate it |

## Planned and milestone WIP gate

At terminal entry, validate canonical `schema:v4`, exact plan hash/binding, base/WIP identity, last green checkpoint, current tree, and required artifacts; rebuild terminal slice including `Domain Impact`. Malformed grammar, feature mismatch, missing artifacts, or Git drift is Spec escalation. Repeat digest guard before squash. Select `Milestone WIP gate` when `plan.md` `## Publication` is non-`null`; otherwise `Planned WIP gate`.

Terminal entry never blocks on moved plans: changed plan bytes revalidate and rebind under [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Plan amendment; conformance proves amended plans on unchanged commits. Amend here only to record what the work actually did; a material change or drift the owner cannot account for asks one question first. Rebinding after pre-squash guards requires rerunning them.

At terminal entry and before squash run `bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md --expected-sha256 <state.plan_sha256> --expected-base <state.base_ref>`. Exit 0 must report bound feature, hash, and base before cumulative proof continues; exit 1 on malformed grammar or base mismatch blocks as Spec escalation; hash mismatches route to § Plan amendment. Exit 2 corrects invocation; use unbound forms only to revalidate amendments before rebinding.

After all tasks and Fast TDD Checks are green, the session owner performs deterministic cumulative conformance before Deferred Slow E2E:

1. Prove every active AC maps exactly once to one completed task and one public interface pin; every changed path is task-owned. Read task diffs in plan order against explicit Decisions, invariants, non-goals, file intents, and focused-check evidence on the unchanged current commit.
2. Prove `Domain Impact` against cumulative diff: `none` requires concrete evidence that no term, invariant, workflow, outcome, relationship, policy, or bounded-context meaning changed. Every non-`none` classification requires exact affected shards and index/AGENTS upserts owned by the same tasks as code; with an existing index, broad-bootstrap offers/selections are contradictory.
3. Compare affected domain shards with production code, schemas, contracts, and tests: they must describe current production behavior, contain no obsolete or future target state, and leave unrelated contexts untouched. Domain drift blocks completion as a Blocker.
4. Prove every owned durable decision and design record carries mandatory minimal headers: run `bun "<GSD_ROOT>/tools/gsd-record.mjs" validate --path <record> --kind decisions|design` on each owned `docs/decisions/NNNN-slug.md` and `docs/design/NNNN-slug.md`; exit 0 proves records, exit 1 blocks as a Blocker. See [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Durable decision and design records.
5. Only a malformed binding, ownership/coverage mismatch, explicit contract contradiction, domain drift, unresolved change, or red deterministic check blocks. No free-form critique or model-generated verdict is terminal authority; green is current-commit conformance, never persisted prose.
6. A blocker keeps `phase=repair` and `next_action=enter terminal verification/repair`; repair only plan-owned source, run affected Fast TDD Checks, and repeat invalidated proofs. Any source change invalidates prior conformance.
7. Run the complete feature-affected Deferred Slow E2E suite only after current-commit conformance. Any needed server, watcher, or daemon starts as a supervised named process with observed readiness condition (never a bare shell launch), torn down before the merge gate. Failure returns to repair, affected fast checks, invalidated conformance, then the complete slow suite. Merge requires full slow/E2E GREEN on the same unchanged commit.

For squash, scratch disposition, archive, and cleanup use § Git/base/WIP/scratch mechanics and § Feature cleanup. Archive-and-delete materializes bound plan and outcome before conformance: canonical archive destinations are terminal-cleanup-owned lifecycle paths in changed-path proof; every other changed path must be task-owned.

The merge target is exactly the recorded `state.toon` `base_ref`; never ask whether to merge into `main` and never widen to repo defaults. Before squash run `bun "<GSD_ROOT>/tools/gsd-git.mjs" preflight --feature-dir .scratch/<feature>`: only `status: ready` proceeds, proving no path outside `.scratch/` is staged, modified, or untracked, so squashes carry only reviewed bytes; any `status: blocked` code is Spec escalation that stops the gate instead of retargeting the merge. Promoting that base onward is separate user-owned work after this packet ends green.

After green merge, write state fields to `.scratch/<feature>/.state-input.json`, then use `bun "<GSD_ROOT>/tools/gsd-state.mjs" write-state --feature-dir .scratch/<feature> --json-file .scratch/<feature>/.state-input.json` to atomically write `phase=merged-cleanup-pending` (never the `write` tool directly); delete `.state-input.json` after CLI success or failure.

For `Milestone WIP gate`, prove ledger matches packet and remains sequential:
- Validate: `bun "<GSD_ROOT>/tools/gsd-milestone.mjs" validate --path docs/gsd/<feature>/milestones.md --expected-feature <state.feature> --expected-base <state.base_ref>` must exit 0, reporting matching feature/base with first `pending` row as selected milestone.
- Complete: run `bun "<GSD_ROOT>/tools/gsd-milestone.mjs" complete --path docs/gsd/<feature>/milestones.md --expected-feature <state.feature> --expected-base <state.base_ref>` once per remaining pending milestone in plan order; each non-final invocation marks exactly that row `done`; the final milestone deletes the ledger.
Include every mutation in reviewed squash; red gates change no base ledger state; changed prefixes, other rows, appends, reorders, or wrong rows block.

## Standalone review

Read-only; no branch/result/merge authority. Supplied context informs, never approves. Report separate bounded-read-only axes: **Standards** — cite documented-standard violations; smells are judgement only, standards win. **Intent** — cite request/plan/context mismatches: missing, partial, scope creep. Do not cross-rerank; summarize per axis.

## Quick-fix WIP gate

Quick fixes have the exact minimal `plan.md` grammar from `REFERENCE.md`, not a full feature packet.
- Parse its exact five-field `Domain Impact` before review.
- `none` requires concrete evidence that no term, invariant, workflow, outcome, relationship, policy, or bounded-context meaning changed.
- Every non-`none` classification requires exactly one semantic-code task owning each affected shard; `Broad bootstrap` must always be `not-offered`.
- An absent domain index keeps the fix bounded and bootstraps the feature-scoped shard inline; only an explicitly requested broad bootstrap exits Quick-fix for normal discovery.
- Compare affected domain prose with production code, schemas, contracts, and tests; missing, obsolete, future, or unrelated prose is domain drift and blocks completion as a Blocker.
- Run code-quality, recorded focused behavior commands, whole-branch builds where available, and applicable E2E before normal squash/cleanup.

Before reviewing a Quick-fix run `bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-quick-fix --path .scratch/<feature>/plan.md`. Exit 0 must report `kind: quick-fix` and matching feature; exit 1 blocks malformed Quick-fix authority; exit 2 corrects invocation. This command takes no `--expected-sha256`: compare the returned hash with recorded `state.toon` `plan_sha256`. Differences mean plan bytes moved after the last checkpoint; rebind under § Plan amendment before review rather than reviewing unrecorded bytes.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. Pipeline mode reports progress or blockers only; standalone review may use its report surface.
