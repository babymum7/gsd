---
name: gsd-verify
description: "Diff/PR review or planned terminal gate."
produces: [state.toon, plan.md]
consumes: [plan.md, state.toon, docs/domain/index.md, docs/domain/<scope>.md, AGENTS.md]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Intent: review a diff/PR, or prove a planned feature conforms before asking to merge
- Do-not-load: invent completion without deterministic gates; per-task terminal verification
- Transition: a green terminal gate sets `phase=ready` and asks whether to merge or open a pull request

# Verify

> **Invocation guard** — automatic selection loads diff review; an active owner loads the terminal gate. The session owner does both itself; never spawn a reviewer sub-agent.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Diff review | a diff, branch, or PR | plan or request context | — | Ask which diff to review |
| Terminal gate | `plan.md`; bound `state.toon` | affected domain shards; `AGENTS.md` | `state.toon`; amended `plan.md` | Stop and name the missing or malformed file |

## Diff review

Read-only; no branch or merge authority. Supplied context informs, never approves. Report two axes separately:
- **Standards** — cite documented-standard violations; smells are judgement only, standards win.
- **Intent** — cite request, plan, or context mismatches: missing, partial, scope creep.

A finding cites a file and line. Do not cross-rank the axes.

## Terminal gate

1. Run `bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md --expected-sha256 <state.plan_sha256> --expected-base <state.base_ref>`. Exit 0 continues. A hash mismatch means bytes moved: revalidate and rebind under [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Plan amendment. A malformed plan or base mismatch stops as Spec escalation. Exit 2 corrects invocation.
2. Review the whole diff of `wip/<feature>` against `base_ref` yourself (in a plan with `## Repos`, each repository's `wip/<feature>` against its row's Base), in plan order: every active acceptance criterion is covered by a completed task, every changed path is owned by a task, and the diff honors the plan's decisions, invariants, and non-goals.
3. Check `Domain Impact`: `none` needs concrete evidence that no domain meaning changed; otherwise the affected shards must describe current production behavior. Skip this in any repository without `docs/domain/index.md`.
4. Validate each owned decision or design record with `bun "<GSD_ROOT>/tools/gsd-record.mjs" validate --path <record> --kind decisions|design`.
5. Run the focused checks, whole-branch builds, and the feature-affected slow/E2E suite on the unchanged commit. Start any server as a supervised named process with an observed readiness condition, and tear it down afterwards.
6. Only a red check, an uncovered criterion, an unowned path, domain drift, or a contradiction of bound plan text blocks. Taste and style never block. A blocker sets `phase=repair`; repair plan-owned source, rerun the affected checks, and repeat this gate from step 2.
7. On green, run `bun "<GSD_ROOT>/tools/gsd-git.mjs" preflight --feature-dir .scratch/<feature>` unpiped. Only `status: ready` proceeds; `status: blocked` stops as Spec escalation.
8. Write `phase=ready` and `next_action=ask merge or pull request` with `bun "<GSD_ROOT>/tools/gsd-state.mjs" set --feature-dir .scratch/<feature> ...`, then ask one question: merge `wip/<feature>` into `base_ref`, or open a pull request from it. A cross-repo plan asks once for all repositories.

The merge target is exactly the recorded `base_ref` (§ Base derivation and merge target); never widen to repository defaults. On merge, check out `base_ref`, run `git merge --no-ff wip/<feature>`, then delete `wip/<feature>` with `git branch -d`, the retired task branches, and `.scratch/<feature>/`. A cross-repo plan repeats the merge in each listed repository against its row's Base. On pull request, push `wip/<feature>` (in every listed repository) and open the PR with the host's tooling; keep the branch and scratch until the user says it merged.

## Contextual disclosure

Use [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates. The terminal gate reports progress or blockers only; diff review uses its report surface.
