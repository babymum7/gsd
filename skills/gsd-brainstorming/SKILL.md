---
name: gsd-brainstorming
description: "Use before designing new/changed behavior, a module or public interface, an architecture audit, or domain terms and bounded contexts; converges acceptance, then loads gsd-to-plan."
produces: [docs/decisions/NNNN-slug.md]
consumes: []
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Intent: resolve non-trivial new behavior or product/architecture tradeoffs into a concrete acceptance contract
- Do-not-load: read-only questions, pure mechanical edits, known single-spot quick fix
- Transition: on convergence load `gsd-to-plan`

# GSD Brainstorming

> **Invocation guard** — pre-binding discovery and convergence only. Creates no plan, state, or TOON artifact; sole durable writes are a decision record for a settled tradeoff or an accepted pre-binding domain bootstrap. When acceptance or target is unclear, ask one recommended question before further inspection. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract after selecting an invocation mode. Read-only questions, Nano edits, known fixes, delegated tasks, and bound work do not enter.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| New behavior discovery | non-trivial behavior intent | code/docs context | converged contract; settled-tradeoff `docs/decisions/NNNN-slug.md` | ask target question if missing |
| Supplied design stress-test | supplied proposal or claims | implementation seams | sharpened contract; settled-tradeoff `docs/decisions/NNNN-slug.md` | ask for missing proposal |
| Spec-gap revision | blocker and affected criterion/invariant | current plan | revised contract | preserve blocker and stop |
| Selected architecture candidate | user-selected candidate | audit evidence | converged candidate contract | return to `gsd-brainstorming` for candidate selection |

## Scope discipline

Match exploration breadth to prompt: read named areas and dependencies first; walk broadly only for explicit whole-codebase architecture intent. Stay within Git-tracked projects; skip nested repos, vendored tools, submodules, dependencies, outputs, and ignored paths. Reuse read evidence; never sweep repositories merely because brainstorming is active.

## Discovery and stress-test

- **Discovery:** inspect bounded behavior and public seams; clarify questions; present 2–3 approaches with tradeoffs and a recommendation.
- **Scout:** when discovery spans many files, unfamiliar areas, or external references, spawn one read-only scout sub-agent (the bootstrap's `scout` sub-agent profile when listed) with a bounded question returning paths, seams, and facts; do one or two known reads inline instead. Scout output is unverified: re-read every fact a decision rests on before presenting it.
- **Architecture:** for module boundaries, seams, or refactoring candidates, read `GSD_ROOT/skills/gsd-codebase-architecture/SKILL.md` and apply its vocabulary and deepening tests.
- **Stress-test:** challenge decisions for risks, edge cases, missing constraints, hidden assumptions, irreversible choices, and conflicting acceptance.
- Recommend answers for all questions. Batch independent questions; ask dependent questions sequentially by branch.
- Ask only when answers change behavior, scope, interfaces, destructive actions, or tradeoffs; otherwise state conservative defaults.
- Right-size designs: recommend smallest solutions satisfying asks without unrequested retries, telemetry, config, extensibility, or abstractions.
- Ask acceptance-impact questions; park coarse items; prioritize criteria-unblockers.
- Preserve same-session continuity: settled decisions stay settled unless evidence conflicts or user reopens them.

## Acceptance and interface convergence

Convergence fixes behavior before planning. Each active criterion is one concrete `GIVEN/WHEN/THEN` scenario with an observable result, bounded by invariants and non-goals. Unresolved ideas remain one concise note, never vague criteria or speculative tasks.

Pin one existing public test seam per active criterion before convergence:
- Prefer the highest deterministic **fast** boundary observing production behavior: local module, contract, or in-process harness first.
- Fast TDD Check required for observable criteria: no browser, GUI, network, server, large fixture, or material cost during implementation.
- If no fast public seam exists, explicitly add the smallest real fast seam as product work.
- Never approve source assertions, private helper probes, duplicated logic, test backdoors, or slow browser/E2E seams as acceptance boundaries.

## Durable decision records

When a load-bearing tradeoff settles, write one `docs/decisions/NNNN-slug.md` record using the header from [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Durable decision and design records. Records may precede implementation; the header requires `# NNNN — Title`, exactly one `- **Status:** Accepted|Rejected|Superseded by NNNN`, exactly one `- **Date:** YYYY-MM-DD`, and a non-empty `## Decision` section stating locked choices.

## Conservative context harvest and Domain Impact

Domain docs are opt-in per repository: they apply only where `docs/domain/index.md` exists.

1. When no touched repository has `docs/domain/index.md`, omit `Domain Impact` and write no domain docs. Offer a domain bootstrap once only when the feature introduces lasting business terms; a decline ends the topic.
2. When the index exists, classify as exactly `none`, `change-existing-context`, `introduce-context`, or `change-context-boundary`, with sorted context slugs, documentation action, broad-bootstrap disposition (`not-offered`), and evidence. `none` requires evidence that no production semantics, terms, invariants, workflows, outcomes, relationships, or policy change. Read only mapped shards for affected contexts; never offer a broad scan.
3. Reuse only evidence needed for the selected design. Generic terms, identifiers, preferences, and code shape without production meaning are no-ops. Existing docs are navigation hints, not authority over code, schemas, contracts, or tests.
4. Load `gsd-domain-modeling` as sole writer for non-`none` classifications or an accepted bootstrap. Before binding, material ambiguity asks one focused question and writes nothing. Otherwise it returns exact affected paths for the eventual owning code task and writes no future behavior.
5. After binding, load-bearing ambiguity returns through the Spec-gap transition. Prose uncertainty never widens scope.

## Parts

When one feature needs several pieces that each need their own discussion, write `.scratch/<feature>/parts.md` as a plain checklist, one line per part in dependency order:

```markdown
- [ ] P1: <user-visible outcome>
- [ ] P2: <user-visible outcome>
```

Split by user-visible outcome, never by file, layer, or task count. Converge only the next unchecked part, and plan it as its own feature `<feature>-pN` through the full cycle. When that part merges or its pull request opens, tick it `[x]` and ask whether to start the next part. The checklist has no validator and no lifecycle authority; `state.toon` of the current part stays the resume source.

## Convergence transition

When requirements, tradeoffs, criteria, invariants, non-goals, and test seams converge, load `gsd-to-plan` in converged-creation or spec-gap-revision mode. Pass conversational contracts; write no Markdown. `gsd-to-plan` remains sole `plan.md` writer; after binding, execution starts automatically.

Before transitioning, summarize recommendations and expose only the next human decision; never present command menus or technical skill names as user choices.
