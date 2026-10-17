---
name: gsd-brainstorming
description: "Use before designing new/changed behavior, a module or public interface, an architecture audit, or domain terms and bounded contexts; converges acceptance, then plans it."
produces: [docs/decisions/NNNN-slug.md]
consumes: []
---

# GSD Brainstorming

Use for new or changed behavior, a supplied design to stress-test, a selected architecture candidate, an unbound draft plan to finalize, or a Spec-gap returned from execution. Not for read-only questions, mechanical edits, or a known fix. Before binding, the only durable writes are a decision record for a settled tradeoff, an accepted domain bootstrap, and `parts.md`. When acceptance or the target is unclear, ask one recommended question before inspecting further.

## Scope discipline

Match exploration to the prompt: read named areas and their dependencies first; walk broadly only for explicit whole-codebase architecture intent. Stay within Git-tracked projects; skip nested repos, vendored tools, submodules, dependencies, outputs, and ignored paths.

## Tracked issue

Issues or tickets the user points to, in any tracker or file, are read with their comments, since a comment can change the body. Those that state acceptance criteria are converged input: rewrite each criterion as a `GIVEN/WHEN/THEN` scenario with its seam and go to the Convergence transition without discovery questions.
- How several issues map to work is your recommendation, not the tracker's: one feature, parts, or separate features, and within a feature a task per issue runs on its own sub-agent when the tasks qualify for one wave.
- An open question or ambiguity in it is asked as usual, unless the repository's instructions say not to ask back: then pick your recommendation, record it as the next `D-n` decision, and state the choice where those instructions say.
- Work you cannot do yourself (a manual step, an outside approval) becomes a non-goal and is reported.

## Discovery and stress-test

- **Discovery:** inspect bounded behavior and public seams, clarify, and present 2–3 approaches with tradeoffs and a recommendation.
- **Scout:** when discovery spans many files, unfamiliar areas, or external references, spawn one read-only scout sub-agent (the bootstrap's `scout` profile when listed) with a bounded question returning paths, seams, and facts; one or two known reads stay inline. Re-read every fact a decision rests on.
- **Architecture:** for module boundaries, seams, or refactoring candidates, read `GSD_ROOT/skills/gsd-codebase-architecture/SKILL.md`.
- **Stress-test:** challenge risks, edge cases, missing constraints, hidden assumptions, irreversible choices, and conflicting acceptance.
- Ask only when the answer changes behavior, scope, interfaces, destructive actions, or tradeoffs; otherwise state the conservative default. Recommend an answer for every question; batch independent ones.
- Recommend the smallest design that satisfies the ask, without unrequested retries, telemetry, config, extensibility, or abstractions. Settled decisions stay settled unless evidence conflicts or the user reopens them.

## Acceptance and interface convergence

Each active criterion is one concrete `GIVEN/WHEN/THEN` scenario with an observable result, bounded by invariants and non-goals. Unresolved ideas stay one concise note, never vague criteria or speculative tasks.

Pin one existing public test seam per active criterion: the highest deterministic fast boundary that observes production behavior, under `GSD_ROOT/skills/gsd/REFERENCE.md` § Fast TDD and task-loop constraints. If none exists, add the smallest real fast seam as product work. Never accept source assertions, private probes, duplicated logic, test backdoors, or slow browser/E2E seams as acceptance boundaries.

## Decision records

When a load-bearing tradeoff settles, write one `docs/decisions/NNNN-slug.md` under `GSD_ROOT/skills/gsd/REFERENCE.md` § Durable decision and design records; it may precede implementation.

## Domain Impact

Domain docs apply only where `docs/domain/index.md` exists.
1. Without an index in any touched repository, omit `Domain Impact`. Offer a domain bootstrap once only when the feature introduces lasting business terms; a decline ends the topic.
2. With an index, classify as `none`, `change-existing-context`, `introduce-context`, or `change-context-boundary`, with sorted context slugs, documentation action, `Broad bootstrap: not-offered`, and evidence. `none` needs evidence that no production semantics change. Read only the shards mapped to affected contexts.
3. Generic terms, identifiers, and code shape without production meaning are no-ops; existing docs are hints, not authority over code, schemas, contracts, or tests.
4. For a non-`none` classification or an accepted bootstrap, read `GSD_ROOT/skills/gsd-domain-modeling/SKILL.md`; it returns the exact paths for the owning code task and writes no future behavior.

## Parts

When one feature needs several pieces that each need their own discussion, write `.scratch/<feature>/parts.md` as a plain checklist, one line per part in dependency order:

```markdown
Integration: `<feature>` from `<base>`
Delivery: `<merge|merge-push|pull-request|branch>`
- [ ] P1: <user-visible outcome>
  - GIVEN <precondition> WHEN <operation> THEN <observable result>
- [ ] P2: <user-visible outcome>
- [ ] Merge `<feature>` into `<base>`
```

Split by user-visible outcome, never by file, layer, or task count. In one brainstorm, converge every part you can and write its criteria under its line, and ask the Delivery question once for the whole list. Plan the next unchecked part as its own feature `<feature>-pN` from its recorded criteria. When that part merges or its pull request opens, tick it `[x]`.
After a pull request HEAD stays on its WIP branch, so before planning the next part check out `base_ref`, or have the user cut a non-WIP branch from the open part when the next one needs its code. The checklist has no validator or lifecycle authority.
- **Back to back:** once the list converged, start the next part as soon as one is ticked, without asking. A part whose criteria could not converge up front is brainstormed on arrival: decide by recommendation where a defensible default exists, and ask only a question that changes behavior, scope, or a destructive action.
- **Integration branch:** when the base is checked out in another worktree (another session works there), or the parts should land on the base together (the user wants fewer commits on the base, or one merge or push at the end), cut a non-WIP branch `<feature>` from the base before P1, in its own worktree when this one is busy (`git worktree add -b <feature> <dir> <base>`), and plan every part from there.
  `derive-base` then records `<feature>` as each part's Base, so a part merges without waiting for the base. Without one, omit the `Integration:` line and the closing line, and parts merge straight into the base.
- **Closing merge:** the last line merges the integration branch into its base, as the list's Delivery says; each part then delivers with `merge` into the integration branch. When every part is ticked, deliver it without asking, but only in the worktree holding the base once its session is idle; otherwise report it and leave it to the user. Without a recorded Delivery, ask the user. Before starting each part, merge the base into the integration branch if the base moved.

## Delivery question

Before the transition, ask one question with a recommendation, batched with any other open ones: how the finished work lands. `merge` merges into the base, `merge-push` also pushes the base, `pull-request` pushes the WIP branch and opens a pull request, and `branch` leaves the work on `wip/<feature>`. Offer the push and pull request only when `git remote` lists a remote.
When the user already named how it lands, record that answer without asking. When the repository's instructions say how work from the checked-out branch lands, record `merge` without asking: the plan merges into that branch, and `gsd-verify` then runs those landing steps. If they forbid merging into the checked-out branch, first cut the branch they prescribe, which `derive-base` then records. A general instruction to follow your recommendations may record `merge` or `branch` without asking, never a push or a pull request. Execution then runs to the end without check-in questions.

## Convergence transition

When requirements, tradeoffs, criteria, invariants, non-goals, test seams, and the Delivery converge, or the user asks to finalize an unbound draft `plan.md`, read `GSD_ROOT/skills/gsd-to-plan/SKILL.md` and follow it: it writes and validates `plan.md`, binds `state.toon`, and loads `gsd-executing-plans` without another prompt. A Spec-gap revision of a bound plan instead returns its revised contract to `gsd-executing-plans`, which amends `plan.md` under § Plan amendment.

Before transitioning, summarize recommendations and expose only the next human decision; never present command menus or skill names as user choices.
