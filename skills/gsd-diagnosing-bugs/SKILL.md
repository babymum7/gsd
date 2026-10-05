---
name: gsd-diagnosing-bugs
description: "Use for a non-obvious bug, regression, intermittent failure, performance problem, or failed execution repair needing root-cause evidence."
produces: []
consumes: [docs/domain/index.md, docs/domain/<scope>.md]
---

# Diagnosing Bugs

A discipline for hard bugs, run inline by the session owner. It produces root-cause evidence and never implements or commits the fix; a prompt that already names the file, line, or exact failure is a quick fix instead. Afterwards the owner fixes a confirmed non-architectural cause with a focused regression test (after the quick-fix `derive-base` check), and an architectural cause goes to `gsd-brainstorming` first.

Two entries: standalone (from the catalog), and inside bound execution when a red check has no located cause. Inside execution ask the user nothing: missing access, a missing artifact, or an ambiguous criterion is Spec escalation, and the evidence returns to `gsd-executing-plans` for inline repair. Standalone may ask one focused question where a phase says so. Skip a phase only with explicit justification.

## Phase 1 — Build a feedback loop (this is the skill)

Build a tight, red-capable pass/fail signal for this bug before hypothesizing. Seam preference: failing test at the right seam → curl/HTTP script → CLI plus fixture snapshot → headless browser (only without a cheaper seam) → replay/trace → throwaway harness → property/fuzz → `git bisect run` → differential loop → human-in-the-loop last.

**Scout:** to locate an unfamiliar failure path across many files, spawn one read-only scout sub-agent (the bootstrap's `scout` profile when listed); the owner builds and runs the loop and re-reads every location it relies on.

**Tighten:** faster, sharper symptom assertion, deterministic (pin time, seed, filesystem, network). A flaky bug gets its reproduction rate raised until it is debuggable.

**Done when** one command (script, test, curl), run once, drives the bug path, asserts the user's exact symptom, and is deterministic, fast, and agent-runnable. No such command means no Phase 2; standalone asks one question for the missing access, artifact, or permission to instrument.

## Phase 2 — Reproduce and minimize

Observe red and confirm it is the user's failure, not a nearby one. Cut inputs, callers, and config one at a time, re-running after each, until every remaining element is load-bearing.

## Phase 3 — Hypothesize

List 3–5 ranked, falsifiable hypotheses before testing any: "If X is the cause, changing Y makes the bug disappear." Discard unfalsifiable ones. Report the list as progress, never as a required question.

## Phase 4 — Instrument

Each probe tests one prediction, one variable at a time: a debugger or REPL breakpoint first, then targeted logs at seams that tell hypotheses apart, never "log everything and grep". Tag debug logs `[DEBUG-xxxx]`. For performance, measure a baseline, then bisect.

## Phase 5 — Root cause and regression seam

Isolate the confirmed cause and propose a regression test seam that exercises the real bug pattern at its call site, turning the minimized repro into the proposed failing test. No correct seam is itself a finding: an architectural cause that prevents a clean seam or fix goes to `gsd-brainstorming` before repair.

## Phase 6 — Cleanup and evidence

- [ ] Every `[DEBUG-...]` line, throwaway harness, and probe is removed.
- [ ] The confirmed cause, falsified alternatives, minimal repro command, and proposed seam (or missing-seam finding) are reported.

Read `docs/domain/index.md` and its relevant shards only when the evidence signals domain impact; diagnosis never writes domain docs.
