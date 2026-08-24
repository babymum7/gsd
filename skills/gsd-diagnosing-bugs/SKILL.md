---
name: gsd-diagnosing-bugs
description: "Use for a non-obvious bug, regression, intermittent failure, performance problem, or failed execution repair needing root-cause evidence."
produces: []
consumes: [docs/domain/index.md, docs/domain/<scope>.md]
---

## Dispatch contract
Canonical row: [Visible skill mandatory-use matrix](../gsd/REFERENCE.md#visible-skill-mandatory-use-matrix).
- Role: owner
- Do-not-load: a located failure whose prompt names the file/line or exact failure signature
- Transition: return evidence to the session-owner execution flow, or hand an architectural cause to `gsd-codebase-architecture`

# Diagnosing Bugs

> **Invocation guard** — catalog selection loads this skill. Under [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract, select an Invocation Mode below and validate only its Required artifacts; missing Optional artifacts never reroute invocation.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| standalone diagnosis | — | `docs/domain/index.md`; relevant domain shards | — | — |
| Execution-blocker diagnosis | — | `docs/domain/index.md`; relevant domain shards | — | — |

A discipline for hard bugs. Read `docs/domain/index.md` only if bug evidence signals domain impact; load only relevant indexed shards. Missing domain docs are normal. Skip phases only with explicit justification.

## Phase 1 — Build a feedback loop (THIS is the skill)
Build a **tight** red-capable pass/fail signal for *this* bug before hypothesizing. Seam preference: failing test at right seam → curl/HTTP script → CLI+fixture snapshot → headless browser (if no cheaper seam) → replay/trace → throwaway harness → property/fuzz → bisection (`git bisect run`) → differential loop → HITL last resort.

**Tighten**: faster, sharper symptom assertion, deterministic (pin time/seed/FS/network). Non-deterministic → raise reproduction rate until debuggable.

**Done when** naming ONE command (script/test/curl), run once, that is red-capable (drives bug path, asserts user's exact symptom), deterministic, fast, agent-runnable.
- No red-capable command → no Phase 2; do not hypothesize without a loop.
- In standalone diagnosis, STOP and ask one focused question for missing environment access, captured artifact, or permission for temporary instrumentation.
- In Execution-blocker diagnosis, ask no question: emit canonical post-binding Blocker stop naming the exact unavailable access or artifact; return the blocker evidence to `gsd-executing-plans` as its caller (stops pipeline; does not resume execution).
- A later validated resume, once external prerequisites are available, may re-enter diagnosis.

## Phase 2 — Reproduce + minimize
Run it, observe red, and verify it reproduces the *user's* failure (not a nearby one). Shrink to minimal red scenario: cut inputs/callers/config one-by-one, re-running after each. Done when every remaining element is load-bearing.

## Phase 3 — Hypothesize
Generate **3–5 ranked hypotheses** before testing any (single-hypothesis anchors). Each must be **falsifiable**: "If <X> is the cause, <changing Y> makes the bug disappear." Unfalsifiable predictions are vibes; discard them. Surface ranked hypotheses as non-blocking progress, never as required questions. In standalone diagnosis, user may volunteer re-ranking during work. In Execution-blocker diagnosis, report the list and proceed to instrumentation without asking, waiting, or pausing post-binding auto-pilot.

## Phase 4 — Instrument
Each probe maps to a Phase-3 prediction (**one variable at a time**). Preference: debugger/REPL breakpoint > targeted logs at hypothesis-distinguishing seams > never "log everything and grep". Tag debug logs `[DEBUG-xxxx]` (cleanup = one grep). **Perf branch**: establish baseline measurement, then bisect — measure first, fix second.

## Phase 5 — Fix + regression test
Write regression test **before** fixing — only if a **correct seam** exists (exercising real bug pattern at call site). No correct seam is a finding to note (architecture prevents locking down the bug). If a seam exists: turn minimized repro into a failing test → fail → fix → pass → re-run Phase-1 loop on original scenario.

## Phase 6 — Cleanup + post-mortem
- [ ] Original repro no longer reproduces.
- [ ] Regression test passes, or the missing seam is documented.
- [ ] All `[DEBUG-...]` instrumentation is removed.
- [ ] Original Phase-1 signal is green.
- [ ] Throwaway harnesses and prototypes are deleted.
- [ ] The commit message records the confirmed hypothesis and root cause.

In standalone diagnosis only, ask what would have prevented the bug. Architectural causes may transition to `gsd-codebase-architecture` post-fix. In Execution-blocker mode, ask no post-mortem question: session owner returns immediately to `gsd-executing-plans` with fixed repro evidence, writing no repair-round/helper-preference field. Load-bearing AC/interface/invariant ambiguities require Spec escalation, not diagnosis guesses. Diagnosis is always performed inline in the top-level session.

## Optional context signal
Diagnosis harvest is optional and bounded to the minimized bug path. Reuse only prompt/trace, reproduction, hypotheses, and relevant code/docs; never widen into repository glossary/decision scans or create missing scaffolds. Trigger `gsd-domain-modeling` only if evidence reveals recurring project-specific terms or explicit decision/rationale signals. Generic error vocabulary, one-off identifiers, implementation details, and unreasoned code shapes are no-ops. Diagnosis never writes domain artifacts itself.

In standalone pre-binding work, domain modeling may ask its one focused question only for material meaning/ownership/trade-off ambiguity. In Execution-blocker diagnosis, binding has occurred: ask zero documentation questions; send load-bearing AC/interface/invariant ambiguities to `gsd-executing-plans`' Spec escalation, otherwise skip documentation writes and continue diagnosis.

## Contextual disclosure (see [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Contextual disclosure templates). Example:
```
Next steps:
- Resume the active execution or examine the architectural cause.
```
