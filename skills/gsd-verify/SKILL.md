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

From step 1 on, the gate never edits `plan.md` for bookkeeping (`Files`, `Status`, wording): `.scratch` is deleted after the merge, and the merge message reads only the Summary and criteria. Only a material amendment under § Plan amendment edits it, recorded as a decision.

1. Set `phase=verifying` (`set` with `owner=<GSD_SESSION>`, as in every state write), then run `bun "<GSD_ROOT>/tools/gsd-contract.mjs" validate-plan --path .scratch/<feature>/plan.md --expected-base <state.base_ref>`. Exit 0 continues. A malformed plan or base mismatch stops as Spec escalation. Exit 2 corrects invocation.
   Then run `bun "<GSD_ROOT>/tools/gsd-git.mjs" preflight --feature-dir .scratch/<feature>` once before any check, so nothing it finds costs a rerun of the slow suites: `dirty-worktree` commits the feature's own paths on `wip/<feature>` (asking about any it does not own), `base-advanced` merges `base_ref` into `wip/<feature>`, `wip-missing` follows its message, and any other block stops as Spec escalation.
2. Review the whole diff of `wip/<feature>` against `base_ref` yourself (in a plan with `## Repos`, each repository's `wip/<feature>` against its row's Base), in plan order: every active acceptance criterion is covered by a task the branch completed (through `last_green_task` in state, not the plan's `Status`), every changed path serves the plan's scope, and the diff honors the plan's decisions, invariants, and non-goals.
   A changed path outside every task's `Files` blocks only when it serves no active criterion or crosses a non-goal; an in-scope supporting path is named in the report, not written into `plan.md`. Preflight's `outside_files:` lines list those paths; judge them rather than recomputing the list.
3. Check `Domain Impact`: `none` needs concrete evidence that no domain meaning changed; otherwise the affected shards must describe current production behavior. Skip this in any repository without `docs/domain/index.md`.
4. Validate each record this feature added, listed by `git diff --name-only --diff-filter=A <base_ref> -- docs/decisions docs/design`, with `bun "<GSD_ROOT>/tools/gsd-record.mjs" validate --path <record> --kind decisions|design` (the kind is its directory). A record only edited or renamed keeps its existing shape and is not validated.
5. Run the focused checks, whole-branch builds, and the feature-affected slow/E2E suite on the unchanged commit. Start any server as a supervised named process with an observed readiness condition, and tear it down afterwards.
6. Only a red check, an uncovered criterion, an out-of-scope path, domain drift, or a contradiction of bound plan text blocks. Taste and style never block. A blocker sets `phase=repair`; repair plan-owned source, rerun the affected checks, and repeat this gate from step 2.
   An out-of-scope path has two exits: revert it in repair, or, when it serves the request, keep it as a material amendment under § Plan amendment.
7. On green, run `bun "<GSD_ROOT>/tools/gsd-git.mjs" preflight --feature-dir .scratch/<feature>` unpiped again. Only `status: ready` proceeds. `code: base-advanced` merges `base_ref` into `wip/<feature>` and repeats this gate from step 2; `code: base-checked-out-elsewhere` stops delivery and asks the user, never merging inside the worktree that holds the base; any other block stops as Spec escalation.
8. Write `phase=ready` with `bun "<GSD_ROOT>/tools/gsd-state.mjs" set --feature-dir .scratch/<feature> owner=<GSD_SESSION> phase=ready`, which fills `next_action=deliver merge or pull request`. Then deliver as `plan.md` § Delivery says, without asking, in every listed repository:
   - `merge`: Merge below, then § Feature cleanup, then the landing steps the repository's instructions give for that branch, if any (for example, push it and open its review).
   - `merge-push`: Merge below, then `git push <remote> <base_ref>` to the base's upstream remote, or the only remote when the base has no upstream, then § Feature cleanup.
   - `pull-request`: Pull request below.
   - `branch`: leave the work on `wip/<feature>` and report the branch; `.scratch/<feature>/` stays until the user merges or abandons it.
   A push the Delivery needs with no remote to choose (none listed, or several and no upstream), or a rejected push, is missing access: stop and report it, never a silent local merge or a force push.
   Without `## Delivery`, ask one question: merge `wip/<feature>` into `base_ref`, or open a pull request from it. Offer the pull request only when `git remote` lists a remote (in every listed repository); without one, ask only to confirm the merge. A cross-repo plan asks once for all repositories.

The merge target is exactly the recorded `base_ref` under § Base derivation and merge target.
- Message: `bun "<GSD_ROOT>/tools/gsd-contract.mjs" merge-message --path .scratch/<feature>/plan.md --expected-base <state.base_ref> > .scratch/<feature>/merge-message.txt`. It carries the Summary and active criteria past the scratch deletion.
- Merge: check out `base_ref` and run `git merge --no-ff -F <absolute path of merge-message.txt> wip/<feature>`; a cross-repo plan merges each listed repository against its row's Base first, with the same message file, and this repository last. Only after every merge landed, clean up under § Feature cleanup.
- Pull request: push `wip/<feature>` (in every listed repository) and open the PR with the host's tooling, using the message after its first line as the body; keep the branch and scratch until the user says it merged.

When this feature is one part of a parts checklist (the Parts section of `gsd-brainstorming`), delivery does not end the turn: tick its line and start the next unchecked part in the same turn, as its Back to back rule says; only the closing merge waits for the worktree holding the base.

The terminal gate reports progress or blockers only. Its final report lists the decisions the owner made on its own under § Plan amendment.
