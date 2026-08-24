---
name: gsd-brainstorming
description: "Converge non-trivial new/changed product behavior into acceptance, then load gsd-to-plan."
produces: [docs/decisions/NNNN-slug.md]
consumes: []
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Do-not-load: read-only questions, pure mechanical edits, known single-spot quick fix
- Transition: on convergence load `gsd-to-plan`

# GSD Brainstorming

> **Invocation guard** — pre-binding discovery and convergence only. Creates no plan, state, or TOON artifact; sole durable write is a decision record for a settled tradeoff. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract after selecting an invocation mode. Read-only questions, Nano edits, known fixes, delegated tasks, and bound work do not enter.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| New behavior discovery | non-trivial behavior intent | code/docs context | converged contract | ask target question if missing |
| Supplied design stress-test | supplied proposal or claims | implementation seams | sharpened contract | ask for missing proposal |
| Spec-gap revision | blocker and affected criterion/invariant | current plan | revised contract | preserve blocker and stop |
| Selected architecture candidate | user-selected candidate | audit evidence | converged candidate contract | return to `gsd-codebase-architecture` for candidate selection |

## Scope discipline

Match exploration breadth to prompt: read named areas and dependencies first; walk broadly only for explicit whole-codebase architecture intent. Stay within Git-tracked projects; skip nested repos, vendored tools, submodules, dependencies, outputs, and ignored paths. Reuse read evidence; never sweep repositories merely because brainstorming is active.

## Discovery and stress-test

- **Discovery:** inspect bounded behavior and public seams; clarify questions; present 2–3 approaches with tradeoffs and a recommendation.
- **Stress-test:** challenge decisions for risks, edge cases, missing constraints, hidden assumptions, irreversible choices, and conflicting acceptance.
- Recommend answers for all questions. Batch independent questions; ask dependent questions sequentially by branch.
- Ask only when answers change behavior, scope, interfaces, destructive actions, or tradeoffs; otherwise state conservative defaults.
- Right-size designs: recommend smallest solutions satisfying asks without unrequested retries, telemetry, config, extensibility, or abstractions.
- Ask acceptance-impact questions; park coarse items; prioritize criteria-unblockers.
- Preserve same-session continuity: settled decisions stay settled unless evidence conflicts or user reopens them.

## Acceptance and interface convergence

Convergence fixes behavior before planning. Active criteria require observable **Outcome**, executable **Action**, and deterministic **Expected** results, bounded by invariants and non-goals. Unresolved ideas remain one concise note, never vague criteria or speculative tasks.

Pin one existing public test seam per active criterion before convergence:
- Prefer the highest deterministic **fast** boundary observing production behavior: local module, contract, or in-process harness first.
- Fast TDD Check required for observable criteria: no browser, GUI, network, server, large fixture, or material cost during implementation.
- If no fast public seam exists, explicitly add the smallest real fast seam as product work.
- Never approve source assertions, private helper probes, duplicated logic, test backdoors, or slow browser/E2E seams as acceptance boundaries.

## Durable decision records

When a load-bearing tradeoff settles, write one `docs/decisions/NNNN-slug.md` record using the header from [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Durable decision and design records. Records may precede implementation; `## Decision` states locked choices and `Status` is `Accepted`, `Rejected`, or `Superseded by NNNN`.

## Conservative context harvest and Domain Impact

Domain impact is mandatory for every converged feature:

1. Classify as exactly `none`, `change-existing-context`, `introduce-context`, or `change-context-boundary`. Record sorted context slugs, documentation actions, broad-bootstrap disposition, and evidence. `none` requires evidence showing no production semantics, terms, invariants, workflows, outcomes, relationships, or policy changes.
2. When `docs/domain/index.md` exists, validate it and read only mapped shards for affected contexts. Do not offer or suggest a broad scan. Unrelated contexts stay unread.
3. When `docs/domain/index.md` is absent and the feature changes production semantics, feature-scoped context bootstrap is mandatory. After bounding that required context, offer one independent broad-bootstrap choice. If declined, still load `gsd-domain-modeling` for the required feature-scoped context; declining broad bootstrap never skips affected-context documentation.
4. Reuse only evidence needed for the selected design. Generic terms, identifiers, preferences, and code shape without production meaning are no-ops. Existing docs are navigation hints, not authority over code, schemas, contracts, or tests.
5. Load `gsd-domain-modeling` as sole writer for non-`none` classifications. Before binding, material ambiguity asks one focused question and writes nothing. Otherwise it returns exact affected paths for the eventual owning code task and writes no future behavior; pre-binding documentation describes only shipped behavior.
6. After binding, load-bearing ambiguity returns through the Spec-gap transition. Prose uncertainty never widens scope; required current-behavior documentation remains part of the owning task.

## Large-feature decomposition

Use Milestone Ledgers only when converged work has independently releasable milestones or requires portable multi-session publication. Milestones require user-visible outcomes and dependency order; never split by file, layer, or task count. Set plan `## Publication` to `docs/gsd/<feature>/milestones.md` only when publication slug equals `## Feature`; otherwise use `null`.

Do not create ledgers here: `gsd-to-plan` owns canonical plans and binds intentional publications. Ledgers are completion metadata, not pre-binding design authority.

## Convergence transition

When requirements, tradeoffs, criteria, invariants, non-goals, and test seams converge, load `gsd-to-plan` in converged-creation or spec-gap-revision mode. Pass conversational contracts; write no Markdown. `gsd-to-plan` remains sole `plan.md` writer; after binding, execution starts automatically.

Before transitioning, summarize recommendations and expose only the next human decision; never present command menus or technical skill names as user choices.
