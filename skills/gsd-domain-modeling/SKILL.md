---
name: gsd-domain-modeling
description: Internal GSD sub-skill (routed via /gsd). Build/sharpen the project's domain model — challenge terms, sharpen fuzzy language, capture decisions to `CONTEXT.md`/ADR. Auto-triggered when a durable term/decision crystallizes; also invokable directly to sharpen the glossary.
triggers: durable term/decision crystallizes (auto); invokable directly
produces: [CONTEXT.md, CONTEXT-MAP.md, docs/context/<area>/CONTEXT.md, docs/adr/]
consumes: [CONTEXT.md, CONTEXT-MAP.md, docs/context/<area>/CONTEXT.md, docs/adr/]
---

# Domain Modeling

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract: select an Invocation Mode below before validating only that row's Required artifacts, then follow its Missing required action. A missing Optional artifact never reroutes the invocation.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| First-run domain modeling | — | `CONTEXT.md`; `CONTEXT-MAP.md`; `docs/context/<area>/CONTEXT.md`; `docs/adr/` | `CONTEXT.md`; `CONTEXT-MAP.md`; `docs/context/<area>/CONTEXT.md`; `docs/adr/` (all lazy and evidence-gated) | — |
| Existing-model update | — | `CONTEXT.md`; `CONTEXT-MAP.md`; `docs/context/<area>/CONTEXT.md`; `docs/adr/` | `CONTEXT.md`; `CONTEXT-MAP.md`; `docs/context/<area>/CONTEXT.md`; `docs/adr/` (updated lazily) | — |

Both invocation modes are evidence-driven. Existing-model update lazily reads and updates only the relevant artifacts that exist. First-run starts from available route evidence and creates only an artifact with content to persist; missing docs are normal, and it never fabricates prior definitions or empty scaffolds.

This skill is the **sole writer** of every domain artifact in its catalog. Other skills may notice a signal and invoke it, but never edit `CONTEXT.md`, `CONTEXT-MAP.md`, an area context, or an ADR themselves.

Triggered by `gsd`, `gsd-executing-plans`, or a scope-bounded caller only after the selected route's already-relevant work reveals a durable term or decision signal; also invokable directly to sharpen the glossary.

## Conservative context harvest
Run this flow only **after the caller selects its route and Invocation Mode**:

0. **Confirm write authority first.** The selected invocation must be write-authorized before this skill may reach a certain-write outcome. Explicit first-run or existing-model domain work and write-authorized non-trivial caller modes remain eligible. A standalone advisory/read-only Route 0, Standalone review (Route 2), or Nano caller is a report-only no-op for domain artifacts even when its input contains strong evidence: report the observation to the caller, but do not create or mutate a project artifact.
1. **Start with selected-route evidence.** Reuse the prompt, spec/task brief, and code or docs already needed for that route. Their evidence must establish project meaning or state an actual decision and why; raw occurrence counts are not evidence.
2. **Require a durable signal before extra reads.** A candidate is a recurring project-specific concept whose meaning matters across the work, or an explicit architectural decision/rationale signal. Only after that signal may you make narrow reads of the code/docs that bear on it, consult the existing context ownership map, or inspect related ADRs.
3. **Reject weak signals.** Generic vocabulary, a one-off identifier, implementation detail, code shape without stated rationale, reversible preference, and absent or contradictory evidence are **no-op**. Do not scan the repository to try to upgrade them into candidates.
4. **Choose exactly one outcome.**
   - **No-op** — the invocation lacks write authority, has no durable signal, has immaterial uncertainty, or has insufficient evidence: write nothing and continue the caller; make no extra read when the signal itself is absent.
   - **Certain write** — only after write authority passes, evidence establishes the term's meaning and ownership or establishes every ADR gate and rationale: create/update only the selected artifact.
   - **One ambiguity question** — before plan approval only, material uncertainty about meaning, ownership, or the trade-off: ask exactly one focused question for this harvest pass and write nothing until the answer resolves it. Do not ask about immaterial uncertainty.

### Glossary scenario matrix
| Scenario | Evidence and phase | Deterministic outcome |
|---|---|---|
| Certain recurring domain term | Already-relevant code/docs use one project-specific concept repeatedly and establish one meaning; no map assigns it elsewhere | Create or update exactly one root `CONTEXT.md` glossary entry |
| Mapped multi-context term | `CONTEXT-MAP.md` exists and assigns the evidenced term to the route's area | Consult the map first; create or update only that area's `docs/context/<area>/CONTEXT.md` entry |
| Ambiguous overloaded term | Before approval, evidence supports materially different meanings or owners | Ask one focused meaning/ownership question; write nothing until resolved |

## Ambiguity by phase
- **Before approval:** material uncertainty requires exactly one focused question through the one-question outcome above, and write nothing until resolved. A resolved, evidence-backed answer may then produce the certain write; an unresolved answer remains no-op.
- **After approval:** ask **zero documentation questions**. If ambiguity changes an AC, interface, or invariant, or prevents correct implementation, return a load-bearing blocker to `gsd-executing-plans`' existing **Spec escalation** path. Otherwise skip the documentation write and continue. Never turn an uncertain inference into prose.

## Files (lazy — create only when you have something to write)
- `CONTEXT.md` — the glossary (**this skill is its sole writer**; others read it for vocabulary). Single context at root — most projects never need more.
- `CONTEXT-MAP.md` — the index of contexts, created **only** when a second context appears (two areas legitimately define the same term differently — e.g. `Order` in Sales vs Fulfilment). Until then there is one root `CONTEXT.md` and no map. When you split: create `docs/context/<area>/CONTEXT.md` per area, then write the map at root pointing at each. Format — a table of area → path → the terms it owns; keep it in sync when a context is added, moved, or a term changes owner:
  ```
  # Context Map
  | Context | Glossary | Owns |
  |---------|----------|------|
  | Sales | docs/context/sales/CONTEXT.md | Order, Customer, Quote |
  | Fulfilment | docs/context/fulfilment/CONTEXT.md | Order, Shipment, Pick |
  ```
  A term defined in two contexts (`Order` above) is expected — the map makes the clash explicit; each context's own `CONTEXT.md` defines its meaning. **Read/selection rule**: when `CONTEXT-MAP.md` exists, consult it first and pick the relevant area from its ownership row before choosing root versus `docs/context/<area>/CONTEXT.md`, then read or edit only the selected glossary. A certain new area means adding/updating its row; materially uncertain ownership follows the phase rule above.
- `docs/adr/` — architectural decisions.

## During discussion
- **Challenge against the glossary** — a term conflicting with `CONTEXT.md`? Call it out now.
- **Sharpen fuzzy language** — propose a precise canonical term ("'account' — Customer or User?").
- **Stress-test with concrete scenarios** — probe edge cases at concept boundaries.
- **Cross-reference code** — if stated behavior contradicts the code, surface it.
- **Update the selected glossary inline** only after the certain-write outcome resolves meaning and ownership — don't batch.

## `CONTEXT.md` — glossary only
No implementation details, no specs, no scratch. **Project-specific terms only** — general programming concepts (timeouts, error types, utility patterns) don't belong even if the code uses them. Be opinionated: pick ONE word per concept, list synonyms under `_Avoid_`, define what it IS (1-2 sentences) not what it does. Entry: `**Order**: <what it is, 1-2 sentences>. _Avoid_: Purchase, transaction.`

## ADR capture — all gates plus evidence
Offer or write an ADR only when **all three** gates hold:
1. **Hard to reverse.**
2. **Surprising without context** (a future reader asks "why?").
3. **The result of a real trade-off.**

The selected-route evidence must also state the decision's rationale: what was chosen, the meaningful alternative or constraint, and why the trade-off favored this choice. Code shape alone cannot supply or invent that rationale. Missing any gate or rationale evidence is no-op.

After a decision signal, read only related existing ADRs before proposing one. If an ADR already carries the rationale, no-op; if the same still-authoritative decision has materially evolved, update it; create `docs/adr/NNNN-slug.md` only for a distinct decision. Never duplicate rationale. A new ADR is sequential and lazy: `# {title}` plus 1–3 evidenced sentences (context, decision, why); optional sections only when they add value.

### ADR scenario matrix
| Scenario | Gate/evidence result | Deterministic outcome |
|---|---|---|
| Evidenced durable decision | Hard to reverse + surprising without context + real trade-off, with evidenced rationale; no existing ADR covers it | Write exactly one ADR |
| Reversible preference | Hard-to-reverse gate fails, regardless of code shape | No-op; write no ADR |
| Ambiguous post-approval decision | Rationale or a gate is uncertain after approval | Zero prompts; Spec escalation only when load-bearing, otherwise no-op |

## Tracked-document lifecycle
Domain documents are tracked project artifacts, **never scratch**. After every certain write, return the exact repository-relative changed paths to the master; this is the ownership-transfer record, not commit authority. A certain pre-approval write stays as an intentional working-tree change and is carried into the approved WIP plan and work only after convergence assigns each returned path to exactly one named plan task's `files`. A certain post-approval, in-scope write is committed with the task whose evidence owns it. Never silently commit `<base>`, create an unplanned generic documentation commit or any unowned documentation commit, exclude a valid domain write under “code only,” or create an empty artifact merely to record that harvesting ran.
