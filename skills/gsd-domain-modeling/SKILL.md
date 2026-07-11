---
name: gsd-domain-modeling
description: Internal GSD sub-skill (routed via /gsd). Build/sharpen the project's domain model — challenge terms, sharpen fuzzy language, capture decisions to `docs/domain.toon`. Auto-triggered when a durable term/decision crystallizes; also invokable directly to sharpen the glossary.
triggers: durable term/decision crystallizes (auto); invokable directly
produces: [docs/domain.toon]
consumes: [docs/domain.toon]
---

# Domain Modeling

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract: select an Invocation Mode below before validating only that row's Required artifacts, then follow its Missing required action. A missing Optional artifact never reroutes the invocation.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| First-run domain modeling | — | `docs/domain.toon` | `docs/domain.toon` (lazy and evidence-gated) | — |
| Existing-model update | — | `docs/domain.toon` | `docs/domain.toon` (updated lazily) | — |

Both invocation modes are evidence-driven. Existing-model update lazily reads and updates only `docs/domain.toon` if it exists. First-run starts from available route evidence and creates only `docs/domain.toon` when there is content to persist; missing `docs/domain.toon` is normal/no-op, and it never fabricates prior definitions or empty scaffolds.

This skill is the **sole writer** of `docs/domain.toon`. Other skills may notice a signal and invoke it, but never edit or write `docs/domain.toon` themselves.

Triggered by `gsd`, `gsd-executing-plans`, or a scope-bounded caller only after the selected route's already-relevant work reveals a durable term or decision signal; also invokable directly to sharpen the glossary.

## Conservative context harvest
Run this flow only **after the caller selects its route and Invocation Mode**:

0. **Confirm write authority first.** The selected invocation must be write-authorized before this skill may reach a certain-write outcome. Explicit first-run or existing-model domain work and write-authorized non-trivial caller modes remain eligible. A standalone advisory/read-only Route 0, Standalone review (Route 2), or Nano caller is a report-only no-op for domain artifacts even when its input contains strong evidence: report the observation to the caller, but do not create or mutate `docs/domain.toon`.
1. **Start with selected-route evidence.** Reuse the prompt, spec/task brief, and code or docs already needed for that route. Their evidence must establish project meaning or state an actual decision and why; raw occurrence counts are not evidence.
2. **Require a durable signal before extra reads.** A candidate is a recurring project-specific concept whose meaning matters across the work, or an explicit architectural decision/rationale signal. Only after that signal may you make narrow reads of the code/docs that bear on it, or inspect `docs/domain.toon` if it exists.
3. **Reject weak signals.** Generic vocabulary, a one-off identifier, implementation detail, code shape without stated rationale, reversible preference, and absent or contradictory evidence are **none** (no-op). Do not scan the repository to try to upgrade them into candidates.
4. **Choose exactly one outcome.** Every harvest emits exactly one visible decision:
   - **none** (no-op) — the invocation lacks write authority, has no durable signal, has immaterial uncertainty, or has insufficient evidence: write nothing and continue the caller; make no extra read when the signal itself is absent.
   - **candidate** — before plan approval only, material uncertainty about meaning, ownership, or the trade-off: ask exactly one focused question for this harvest pass and write nothing until the answer resolves it. Do not ask about immaterial uncertainty.
   - **write** (certain write) — only after write authority passes, evidence establishes the term's meaning and ownership or establishes every decision gate and rationale: create or update only `docs/domain.toon`.

### Glossary scenario matrix
| Scenario | Evidence and phase | Deterministic outcome |
|---|---|---|
| Certain recurring domain term | Already-relevant code/docs use one project-specific concept repeatedly and establish one meaning | Emits `write` decision; create or update exactly one term row in `docs/domain.toon` |
| Ambiguous overloaded term | Before approval, evidence supports materially different meanings or owners | Emits `candidate` decision; ask one focused meaning/ownership question; write nothing until resolved |
| Missing domain.toon | Missing `docs/domain.toon` is normal/no-op until evidenced write | Emits `none` decision; do not create empty scaffold |

## Ambiguity by phase
- **Before approval:** material uncertainty requires exactly one focused question through the `candidate` decision outcome above, and write nothing until resolved. A resolved, evidence-backed answer may then produce the `write` decision; an unresolved answer remains `none` (no-op).
- **After approval:** ask **zero documentation questions**. If ambiguity changes an AC, interface, or invariant, or prevents correct implementation, return a load-bearing blocker to `gsd-executing-plans`' existing **Spec escalation** path. Otherwise skip the documentation write and continue with `none` decision. Never turn an uncertain inference into prose.

## File Invariants
- `docs/domain.toon` — the single canonical domain model. Strict UTF-8, LF line endings, no blank lines, ordered rows. Strict parsing fails closed on malformed existing content without creating a runtime parser.
  - Table: `terms[count]{scope,term,definition,avoid}` — project-specific glossary terms, sorted lexicographically by `scope` then `term`. No implementation details or utility programming concepts. Pick ONE word per concept, list synonyms under `avoid`, define what it IS in 1-2 sentences. Stable identity is scope+term.
  - Table: `decisions[count]{id,scope,decision,rationale}` — architectural decisions. Stable decision IDs are D-N in order.

## Decision capture — all gates plus evidence
Offer or write a decision row only when **all three** gates hold:
1. **Hard to reverse.**
2. **Surprising without context** (a future reader asks "why?").
3. **The result of a real trade-off.**

The selected-route evidence must also state the decision's rationale: what was chosen, the meaningful alternative or constraint, and why the trade-off favored this choice. Code shape alone cannot supply or invent that rationale. Missing any gate or rationale evidence is no-op.

After a decision signal, read only related existing decision rows in `docs/domain.toon` before proposing one. If `docs/domain.toon` already carries the rationale, no-op; if the same still-authoritative decision has materially evolved, update its rationale; create a new D-N row only for a distinct decision. Never duplicate rationale.

### Decision scenario matrix
| Scenario | Gate/evidence result | Deterministic outcome |
|---|---|---|
| Evidenced durable decision | Hard to reverse + surprising without context + real trade-off, with evidenced rationale; no existing decision row covers it | Emits `write` decision; write exactly one decision row |
| Reversible preference | Hard-to-reverse gate fails, regardless of code shape | Emits `none` decision; write no row |
| Ambiguous post-approval decision | Rationale or a gate is uncertain after approval | Emits `none` decision; zero prompts; Spec escalation only when load-bearing |

## Tracked-document lifecycle
The domain model `docs/domain.toon` is a tracked project artifact, **never scratch**. After every certain write, return the exact repository-relative changed path (`docs/domain.toon`) to the master; this is the ownership-transfer record, not commit authority. A certain pre-approval write stays as an intentional working-tree change and is carried into the approved WIP plan and work only after convergence assigns the returned path to exactly one named plan task's `files`. A certain post-approval, in-scope write is committed with the task whose evidence owns it. Never silently commit `<base>`, create an unplanned generic documentation commit, or exclude a valid domain write under “code only.”
