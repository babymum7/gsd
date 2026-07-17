---
name: gsd-brainstorming
description: "Use before designing non-trivial new behavior or changing product behavior when requirements or tradeoffs must be resolved. Do not use for read-only questions, pure mechanical edits, or a known single-spot quick fix. Produces a converged acceptance contract and then loads gsd-to-plan."
triggers: non-trivial new behavior, unresolved product or architecture tradeoffs, spec-gap return, or explicit design stress-test
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
| Selected architecture candidate | user-selected candidate | audit evidence and bounded area | converged candidate contract | return to `gsd-improve-codebase-architecture` for candidate selection |

## Scope discipline

Match exploration breadth to the prompt. Read the named area and direct dependencies first; walk broadly only for explicit whole-codebase architecture intent. Stay within the Git-tracked project; skip nested repos, vendored tools, submodules, dependencies, build/output, and ignored paths. Reuse already-read evidence; do not run a repository-wide glossary/architecture sweep merely because brainstorming is active.


## Discovery and stress-test

- **Discovery:** inspect only the bounded existing behavior and public seams; ask clarifying questions; present 2–3 materially different approaches with tradeoffs and a recommendation.
- **Stress-test:** challenge supplied decisions for observable risks, edge cases, missing constraints, hidden assumptions, irreversible choices, and conflicting acceptance behavior.
- Recommend an answer for every question. Batch independent questions; ask dependent questions sequentially, one decision branch at a time.
- Ask only when the answer changes behavior, scope, an interface, a destructive action, or a load-bearing tradeoff. Otherwise choose the conservative default and state it.
- Right-size the result. Recommend the smallest design that satisfies the ask. Do not invent retries, telemetry, configuration, extensibility, or abstractions.
- Preserve same-session continuity: settled decisions stay settled unless new evidence conflicts or the user reopens them.

## Acceptance and interface convergence

Convergence fixes behavior before planning. Every active acceptance criterion must have a concrete observable **Outcome**, executable **Action**, and deterministic **Expected** result, plus the invariants and non-goals that constrain it. Unresolved or future ideas remain one concise discussion note; they never become vague criteria or speculative tasks.

Pin exactly one existing public test seam per active criterion before convergence. Prefer the highest deterministic existing **fast** boundary that observes production behavior: local public module, contract, or in-process CLI/API harness first. A Fast TDD Check is required for observable criteria: no browser or GUI, external network, long-lived server, large fixture, or material machine cost during implementation. If no fast public seam exists, the contract must explicitly add the smallest real fast public seam as product work. Never approve a source-text assertion, private helper probe, duplicated implementation, test-only backdoor, or resource-heavy browser/E2E seam as the implementation-task acceptance boundary.

## Conservative context harvest

Domain context is lazy and evidence-gated:

1. Reuse evidence already needed for the selected design. Generic vocabulary, one-off identifiers, code shape without rationale, reversible preferences, and missing docs are no-op.
2. A candidate exists only for a recurring project-specific term or an explicit architectural decision with evidenced rationale. Only then read `docs/domain/index.md` and the minimum relevant mapped shards.
3. Load `gsd-domain-modeling` as the sole writer only for a certain candidate. Before approval, material ambiguity about meaning, ownership, or tradeoffs asks one focused question and writes nothing. Certain pre-approval writes return exact changed paths for task ownership in the eventual plan.
4. A hard-to-reverse, surprising decision with a real tradeoff and evidenced rationale may become a domain decision. Reversible preferences do not.
5. After approval, this skill is no longer the owner: load-bearing ambiguity returns through the executor's spec-gap transition; non-load-bearing documentation ambiguity is skipped.

Missing `docs/domain/index.md` is normal. Check related existing decisions before proposing a new one.

## Large-feature decomposition

Use a Milestone Ledger only when the converged work has independently releasable milestones or explicitly requires portable multi-session publication. Each milestone must have a user-visible outcome and dependency order; do not split by file, layer, or arbitrary task count. Set the eventual plan's `## Publication` to the exact `docs/gsd/<feature>/milestones.md` path only for an intentional publication whose slug equals `## Feature`; otherwise use `null`.

Do not create the ledger here. `gsd-to-plan` owns the canonical plan and binds any intentional publication. A ledger is completion metadata, never pre-approval design authority.

## Convergence transition

When requirements, tradeoffs, criteria, invariants, non-goals, and test seams are converged, load `gsd-to-plan` in its initial converged-creation or spec-gap-revision mode. Pass the conversational contract; write no Markdown yourself. `gsd-to-plan` remains the sole `plan.md` writer and the sole owner of the approval question.

Before that transition, summarize the current recommendation and expose only the next human decision. Offer `gsd-lavish` only for a substantial reviewable deliverable when browser annotation adds value, and launch it only after explicit opt-in. Do not add a command menu or technical skill names as user choices.
