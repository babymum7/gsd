---
name: gsd-brainstorming
description: "Converge non-trivial new/changed product behavior into acceptance, then load gsd-to-plan."
produces: []
consumes: []
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Do-not-load: read-only questions, pure mechanical edits, known single-spot quick fix
- Transition: on convergence load `gsd-to-plan`

# GSD Brainstorming

> **Invocation guard** — this skill owns pre-approval discovery and convergence only. It creates no artifact. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract after selecting an invocation mode. Read-only questions, Nano edits, known single-spot fixes, bounded delegated tasks, and already-converged approved work do not enter this skill.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| New behavior discovery | explicit non-trivial behavior intent | relevant code/docs/domain context | converged conversational contract | ask one target question only when the target itself is missing |
| Supplied design stress-test | supplied proposal or design claims | relevant implementation seams | sharpened conversational contract | ask for the missing proposal |
| Spec-gap revision | exact blocker and affected acceptance/interface/invariant | current plan and evidence | revised conversational contract | preserve the blocker and stop |
| Selected architecture candidate | user-selected candidate | audit evidence and bounded area | converged candidate contract | return to `gsd-codebase-architecture` for candidate selection |

## Scope discipline

Match exploration breadth to the prompt. Read the named area and direct dependencies first; walk broadly only for explicit whole-codebase architecture intent. Stay within the Git-tracked project; skip nested repos, vendored tools, submodules, dependencies, build/output, and ignored paths. Reuse already-read evidence; do not run a repository-wide glossary/architecture sweep merely because brainstorming is active.


## Discovery and stress-test

- **Discovery:** inspect only the bounded existing behavior and public seams; ask clarifying questions; present 2–3 materially different approaches with tradeoffs and a recommendation.
- **Stress-test:** challenge supplied decisions for observable risks, edge cases, missing constraints, hidden assumptions, irreversible choices, and conflicting acceptance behavior.
- Recommend an answer for every question. Batch independent questions; ask dependent questions sequentially, one decision branch at a time.
- Ask only when the answer changes behavior, scope, an interface, a destructive action, or a load-bearing tradeoff. Otherwise choose the conservative default and state it.
- Right-size the result. Recommend the smallest design that satisfies the ask. Do not invent retries, telemetry, configuration, extensibility, or abstractions.
- Ask acceptance-impact questions; park coarse items. Prioritize criteria-unblockers.
- Preserve same-session continuity: settled decisions stay settled unless new evidence conflicts or the user reopens them.

## Acceptance and interface convergence

Convergence fixes behavior before planning. Every active acceptance criterion must have a concrete observable **Outcome**, executable **Action**, and deterministic **Expected** result, plus the invariants and non-goals that constrain it. Unresolved or future ideas remain one concise discussion note; they never become vague criteria or speculative tasks.

Pin exactly one existing public test seam per active criterion before convergence.
- Prefer the highest deterministic existing **fast** boundary that observes production behavior: local public module, contract, or in-process CLI/API harness first.
- A Fast TDD Check is required for observable criteria: no browser or GUI, external network, long-lived server, large fixture, or material machine cost during implementation.
- If no fast public seam exists, the contract must explicitly add the smallest real fast public seam as product work.
- Never approve a source-text assertion, private helper probe, duplicated implementation, test-only backdoor, or resource-heavy browser/E2E seam as the implementation-task acceptance boundary.

## Conservative context harvest and Domain Impact

Domain impact is mandatory for every converged feature:

1. Classify it as exactly `none`, `change-existing-context`, `introduce-context`, or `change-context-boundary`. Record sorted affected context slugs, required documentation action, broad-bootstrap disposition, and concrete code/schema/contract evidence. `none` is valid only when the evidence shows no production semantics, terms, invariants, workflow, outcome, relationship, or policy changes.
2. When `docs/domain/index.md` exists, validate it and read only mapped shards for the affected contexts. Do not offer or suggest a broad codebase/domain scan. Existing unrelated contexts stay unread.
3. When `docs/domain/index.md` is absent and the feature changes production semantics, feature-scoped context bootstrap is mandatory. After bounding that required context, offer one independent broad-bootstrap choice. If declined, still load `gsd-domain-modeling` for the required feature-scoped context; declining broad bootstrap never skips affected-context documentation.
4. Reuse only evidence already needed for the selected design. Generic vocabulary, one-off identifiers, reversible preferences, and code shape without production meaning are no-op. Existing docs are navigation hints, not authority over production code, schemas, contracts, or tests.
5. Load `gsd-domain-modeling` as sole writer for every non-`none` classification. Before approval, material ambiguity about meaning, ownership, or a boundary asks one focused question and writes nothing. Otherwise it returns the exact affected paths for the eventual owning code task and writes no future behavior; any preapproval documentation write may describe only behavior already shipped.
6. After approval, load-bearing ambiguity returns through the session owner's Spec-gap transition. Non-load-bearing prose uncertainty never widens scope, but required current-behavior documentation remains part of the owning task.

## Large-feature decomposition

Use a Milestone Ledger only when the converged work has independently releasable milestones or explicitly requires portable multi-session publication. Each milestone must have a user-visible outcome and dependency order; do not split by file, layer, or arbitrary task count. Set the eventual plan's `## Publication` to the exact `docs/gsd/<feature>/milestones.md` path only for an intentional publication whose slug equals `## Feature`; otherwise use `null`.

Do not create the ledger here. `gsd-to-plan` owns the canonical plan and binds any intentional publication. A ledger is completion metadata, never pre-approval design authority.

## Convergence transition

When requirements, tradeoffs, criteria, invariants, non-goals, and test seams are converged, load `gsd-to-plan` in its initial converged-creation or spec-gap-revision mode. Pass the conversational contract; write no Markdown yourself. `gsd-to-plan` remains the sole `plan.md` writer and the sole owner of the approval question.

Before that transition, summarize the current recommendation and expose only the next human decision; do not add a separate command menu or technical skill names as user choices here.
