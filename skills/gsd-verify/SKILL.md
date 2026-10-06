---
name: gsd-verify
description: "Use to review a diff, branch, or PR, or to run the planned terminal gate before merge."
produces: [state.toon, plan.md]
consumes: [plan.md, state.toon, docs/domain/index.md, docs/domain/<scope>.md, AGENTS.md]
---

# Verify

Two modes, both done by the session owner itself (never a spawned reviewer): **diff review** of a supplied diff, branch, or PR (ask which one when none is named), and the **terminal gate** an active owner loads for a bound plan (a missing or malformed `plan.md` or `state.toon` stops and names the file). Completion is never claimed without the gate's deterministic checks.

## Diff review

Read-only; no branch or merge authority. Supplied context informs, never approves. Report two axes separately:
- **Standards** — cite documented-standard violations; smells are judgement only, standards win.
- **Intent** — cite request, plan, or context mismatches: missing, partial, scope creep.

A finding cites a file and line. Do not cross-rank the axes.

When the user asks for comments on a PR, post the same findings as one PR review with the host's tooling: an inline comment at each cited line, prefixed by its axis. Never post unasked, and never approve or request changes unless the user says so.

## Terminal gate

1. Set `phase=verifying` (`set` with `owner=<GSD_SESSION>`, as in every state write), then run `bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md --expected-base <state.base_ref>`. Exit 0 continues. A malformed plan or base mismatch stops as Spec escalation. Exit 2 corrects invocation.
2. Review the whole diff of `wip/<feature>` against `base_ref` yourself (in a plan with `## Repos`, each repository's `wip/<feature>` against its row's Base), in plan order: every active acceptance criterion is covered by a completed task, every changed path is owned by a task, and the diff honors the plan's decisions, invariants, and non-goals.
3. Check `Domain Impact`: `none` needs concrete evidence that no domain meaning changed; otherwise the affected shards must describe current production behavior. Skip this in any repository without `docs/domain/index.md`.
4. Validate each record this feature added, listed by `git diff --name-only --diff-filter=A <base_ref> -- docs/decisions docs/design`, with `bun "<GSD_ROOT>/tools/gsd-record.mjs" validate --path <record> --kind decisions|design` (the kind is its directory). A record only edited or renamed keeps its existing shape and is not validated.
5. Run the focused checks, whole-branch builds, and the feature-affected slow/E2E suite on the unchanged commit. Start any server as a supervised named process with an observed readiness condition, and tear it down afterwards.
6. Only a red check, an uncovered criterion, an unowned path, domain drift, or a contradiction of bound plan text blocks. Taste and style never block. A blocker sets `phase=repair`; repair plan-owned source, rerun the affected checks, and repeat this gate from step 2.
7. On green, run `bun "<GSD_ROOT>/tools/gsd-git.mjs" preflight --feature-dir .scratch/<feature>` unpiped. Only `status: ready` proceeds. `code: base-advanced` merges `base_ref` into `wip/<feature>` and repeats this gate from step 2; any other block stops as Spec escalation.
8. Write `phase=ready` and `next_action=ask merge or pull request` with `bun "<GSD_ROOT>/tools/gsd-state.mjs" set --feature-dir .scratch/<feature> owner=<GSD_SESSION> ...`, then ask one question: merge `wip/<feature>` into `base_ref`, or open a pull request from it. A cross-repo plan asks once for all repositories.

The merge target is exactly the recorded `base_ref` under § Base derivation and merge target.
- Message: `bun "<GSD_ROOT>/tools/gsd-contract.mjs" merge-message --path .scratch/<feature>/plan.md --expected-base <state.base_ref> > .scratch/<feature>/merge-message.txt`. It carries the Summary and active criteria past the scratch deletion.
- Merge: check out `base_ref` and run `git merge --no-ff -F <absolute path of merge-message.txt> wip/<feature>`; a cross-repo plan merges each listed repository against its row's Base first, with the same message file, and this repository last. Only after every merge landed, clean up under § Feature cleanup.
- Pull request: push `wip/<feature>` (in every listed repository) and open the PR with the host's tooling, using the message after its first line as the body; keep the branch and scratch until the user says it merged.

The terminal gate reports progress or blockers only.
