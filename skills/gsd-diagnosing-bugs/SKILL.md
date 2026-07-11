---
name: gsd-diagnosing-bugs
description: Internal GSD sub-skill (routed via /gsd). Diagnosis loop for hard bugs and performance regressions. Triggered when gsd-executing-plans hits a real bug/regression, or on explicit "diagnose/debug". Six phases — skip only when justified.
triggers: hard bug / regression / non-obvious error (gsd Route 4); gsd-executing-plans blocker
produces: []
consumes: [docs/domain.toon]
---

# Diagnosing Bugs

> **Direct invocation guard** — internal GSD sub-skill; `/gsd` routes here. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract: select an Invocation Mode below before validating only that row's Required artifacts, then follow its Missing required action. A missing Optional artifact never reroutes the invocation.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Route 4 diagnosis | — | `docs/domain.toon` | — | — |
| Execution-blocker diagnosis | — | `docs/domain.toon` | — | — |

A discipline for hard bugs. After selecting the diagnosis mode, read `docs/domain.toon` if it exists. Skip phases only when explicitly justified.

## Phase 1 — Build a feedback loop (THIS is the skill)
Everything else is mechanical. A **tight** pass/fail signal that goes red on *this* bug → you'll find the cause. No loop → no amount of staring saves you. Be aggressive, creative, refuse to give up.

Ways to construct one (try roughly in order): failing test at the right seam → curl/HTTP script → CLI+fixture snapshot diff → headless browser script → replay a captured trace → throwaway harness → property/fuzz loop → bisection harness (`git bisect run`) → differential loop (old vs new) → HITL bash script (last resort — scaffold: [scripts/hitl-loop.template.sh](scripts/hitl-loop.template.sh)).

**Tighten** the loop: faster, sharper signal (assert the exact symptom, not "didn't crash"), more deterministic (pin time, seed RNG, isolate FS, freeze network). Non-deterministic → raise the reproduction rate (loop 100×, parallelize, inject stress) until debuggable.

**Done when** you can name ONE command (script/test/curl), already run once, that is red-capable (drives the bug path, asserts the user's exact symptom), deterministic, fast, agent-runnable. No red-capable command → no Phase 2, and do not hypothesize without a loop. In Route 4 diagnosis, STOP and ask one focused question for the missing environment access, captured artifact, or permission for temporary instrumentation. In Execution-blocker diagnosis, ask no question: emit the canonical post-approval Blocker stop naming the exact unavailable access or artifact, and return the blocker evidence to `gsd-executing-plans` as its caller; this stops the current pipeline and does not resume execution. A later `/gsd` resume, after the external prerequisite is available, uses state detection to return to `gsd-executing-plans`. Preserve `explicit_level` and set `auto_scope=none`.

## Phase 2 — Reproduce + minimize
Run it, watch red. Confirm it's the *user's* failure (not a nearby one) and reproducible. Then shrink to the smallest scenario that still goes red — cut inputs/callers/config one at a time, re-running after each. Done when every remaining element is load-bearing.

## Phase 3 — Hypothesize
Generate **3–5 ranked hypotheses** before testing any (single-hypothesis anchors). Each **falsifiable**: "If <X> is the cause, <changing Y> makes the bug disappear." Can't state a prediction → it's a vibe, discard. Surface the ranked list as non-blocking progress, never as a required question. In Route 4 diagnosis the user may volunteer a re-ranking while work continues. In Execution-blocker diagnosis, report the list and immediately proceed to instrumentation; never ask, wait for a re-ranking, or pause post-approval auto-pilot.

## Phase 4 — Instrument
Each probe maps to a Phase-3 prediction. **One variable at a time.** Preference: debugger/REPL breakpoint > targeted logs at hypothesis-distinguishing seams > never "log everything and grep". Tag every debug log `[DEBUG-xxxx]` (cleanup = one grep). **Perf branch**: establish a baseline measurement, then bisect — measure first, fix second.

## Phase 5 — Fix + regression test
Write the regression test **before** the fix — but only if a **correct seam** exists (one exercising the real bug pattern at the call site). No correct seam → that *is* the finding; note it (architecture prevents locking the bug down). If a seam exists: turn the minimized repro into a failing test → fail → fix → pass → re-run the Phase-1 loop on the original scenario.

## Phase 6 — Cleanup + post-mortem
- [ ] Original repro no longer reproduces.
- [ ] Regression test passes (or missing seam documented).
- [ ] All `[DEBUG-...]` removed (grep the prefix).
- [ ] Throwaway prototypes deleted.
- [ ] Correct hypothesis stated in the commit message.

In standalone Route 4 only, ask what would have prevented this. After a successful Route 4 diagnosis, an architectural cause may hand off to `gsd-improve-codebase-architecture` as a pre-approval post-diagnosis architecture audit, after the fix. In Execution-blocker diagnosis, ask no post-mortem question. After a successful in-task Execution-blocker diagnosis, return to `gsd-executing-plans` immediately with the fixed repro evidence and preserve `explicit_level` while setting `auto_scope=none`. An Execution-blocker diagnosis entered after terminal repair exhaustion with `terminal_repair_round=2` never opens another repair even when it identifies the cause: retain the evidence, emit the canonical Blocker stop, and wait for a later `/gsd` resume to begin a genuinely new gate. If architecture is load-bearing for a current acceptance criterion, interface, or invariant, use Spec escalation; otherwise pass only a report-only future candidate through `gsd-improve-codebase-architecture` and return, with no selection, lavish offer, or refactor.

## Optional context signal
Diagnosis harvest is optional and bounded to the minimized bug path. Reuse only the prompt/trace, reproduction, hypotheses, and code/docs already relevant to the diagnosis; never widen into a repository glossary/decision scan or create missing scaffolds. Trigger `gsd-domain-modeling` only if that evidence reveals a recurring project-specific term or explicit decision/rationale signal. Generic error vocabulary, a one-off identifier, implementation detail, and code shape without rationale are no-op. Diagnosis never writes domain artifacts itself.

In Route 4 pre-approval work, domain modeling may ask its one focused question only for material meaning/ownership/trade-off ambiguity. In Execution-blocker diagnosis, approval has already happened: ask zero documentation questions; send load-bearing AC/interface/invariant ambiguity to `gsd-executing-plans`' Spec escalation, otherwise skip the documentation write and continue the diagnosis.

 ## Contextual disclosure (see gsd Conventions). Example:
 ```
 Next steps:
 - /gsd (to resume execution or address codebase restructuring)
 ```
