---
name: gsd-ponytail
description: "Use for a real known-scope quick fix that should take the smallest behavioral path, or when the user explicitly sets ponytail lite, full, ultra, or normal mode. Do not select the primary lifecycle; its preference scope and handoff persistence remain explicit."
triggers: real known-scope quick fix; explicit ponytail lite, full, ultra, or normal preference
produces: []
consumes: []
---

# Ponytail

> **Invocation guard** — load only for a real known-scope quick fix or an explicit Ponytail preference change. Apply [../gsd/REFERENCE.md](../gsd/REFERENCE.md) § Artifact Contract: select an Invocation Mode below before validating only that row's Required artifacts, then follow its Missing required action. A missing Optional artifact never reroutes the invocation.

## Invocation modes

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| Quick-fix auto-fire | — | — | — | — |
| Explicit session toggle | — | — | — | — |

Select Quick-fix auto-fire only for a real known-scope quick fix. Select Explicit session toggle only for an explicit ponytail lite/full/ultra request or the stop/normal-mode request. Both modes are runtime policy transitions with no artifact requirements or writes; Nano never loads this skill.

Lazy senior dev: efficient, not careless. The best code is the code never written. The runtime keeps two distinct fields: `explicit_level` is exactly `none|lite|full|ultra`, and `auto_scope` is exactly `none|quick-fix`. **Auto-fire** is scoped to that fix only: it expires when the real quick-fix lands/merges, hits a hard-blocker or verify-fail stop, or stops being the active prompt, and never silently minimizes the next, unrelated prompt. **Explicit toggle** (a ponytail lite/full/ultra request, omitted level = **full**) is session state until an explicit "stop ponytail" or "normal mode" request. Nano work never loads this skill.
Only an active **explicit** `lite|full|ultra` toggle survives a session reset, and only via a `gsd-handoff` `settings[]` row; auto-fire is never serialized. A hard reset without a handoff loses the explicit level like any unsaved scratch — set it again explicitly to restore it.

## State transitions (normative)
`<current>` is the current `explicit_level`, `<scope>` is the current `auto_scope`, `<level>` is an explicitly supplied accepted level, `<invalid>` is a supplied value outside that domain, and `<level-or-full>` resolves an omitted toggle level to `full`. Accepted explicit toggle levels (normative): `lite|full|ultra`. Apply this table exactly. Every Inputs cell names the event and the required pre-transition state/input; a row whose Inputs do not match must not apply. Outputs marked `none` produce no cue, `n/a` means the scenario performs no handoff operation, and `omit` means a handoff write has no `ponytail_level` row.

| Scenario | Inputs | Next state | Owner/action | Skill/load | Output | Handoff row |
|---|---|---|---|---|---|---|
| Nano | `event=nano;explicit_level=<current>;auto_scope=<scope>` | `explicit_level=<current>;auto_scope=none` | `0` | `none` | `none` | `n/a` |
| Quick-fix without explicit toggle | `event=quick-fix;explicit_level=none;auto_scope=none` | `explicit_level=none;auto_scope=quick-fix` | `0` | `gsd-ponytail` | `Ponytail: full — scoped to this quick-fix.` | `n/a` |
| Quick-fix with explicit toggle | `event=quick-fix;explicit_level=<level>;auto_scope=none` | `explicit_level=<level>;auto_scope=none` | `0` | `gsd-ponytail` | `Ponytail: <level> — explicit session scope; applied to this quick-fix.` | `n/a` |
| Fix lands/merges | `event=fix-landed;explicit_level=<current>;auto_scope=<scope>` | `explicit_level=<current>;auto_scope=none` | `none` | `none` | `none` | `n/a` |
| Hard-blocker or verify-fail stop | `event=blocker-stop;explicit_level=<current>;auto_scope=<scope>` | `explicit_level=<current>;auto_scope=none` | `none` | `none` | `none` | `n/a` |
| Unrelated prompt | `event=unrelated-prompt;explicit_level=<current>;auto_scope=<scope>` | `explicit_level=<current>;auto_scope=none` | `none` | `none` | `none` | `n/a` |
| Explicit toggle | `event=toggle;explicit_level=<current>;auto_scope=<scope>;level=<level-or-full>` | `explicit_level=<level-or-full>;auto_scope=none` | `none` | `gsd-ponytail` | `Ponytail: <level-or-full> — explicit session scope.` | `n/a` |
| Invalid explicit toggle | `event=toggle;explicit_level=<current>;auto_scope=<scope>;level=<invalid>` | `explicit_level=<current>;auto_scope=none` | `none` | `none` | `Ponytail level must be lite, full, or ultra.` | `n/a` |
| Stop or normal mode | `event=stop;explicit_level=<current>;auto_scope=<scope>` | `explicit_level=none;auto_scope=none` | `none` | `none` | `Ponytail: none — normal mode.` | `n/a` |
| Fresh task dispatch | `event=dispatch;explicit_level=<current>;auto_scope=<scope>` | `explicit_level=<current>;auto_scope=none` | `none` | `none` | `Ponytail Level: <current>` | `n/a` |
| Handoff write with explicit toggle | `event=handoff-write;explicit_level=<level>;auto_scope=<scope>` | `explicit_level=<level>;auto_scope=none` | `none` | `none` | `none` | `ponytail_level,<level>` |
| Handoff write without explicit toggle | `event=handoff-write;explicit_level=none;auto_scope=<scope>` | `explicit_level=none;auto_scope=none` | `none` | `none` | `none` | `omit` |
| Handoff restore with explicit toggle | `event=handoff-restore;explicit_level=<current>;auto_scope=<scope>;row=ponytail_level,<level>` | `explicit_level=<level>;auto_scope=none` | `none` | `none` | `none` | `ponytail_level,<level>` |
| Handoff restore without explicit toggle | `event=handoff-restore;explicit_level=<current>;auto_scope=<scope>;row=missing` | `explicit_level=none;auto_scope=none` | `none` | `none` | `none` | `omit` |
| Handoff restore with invalid explicit toggle | `event=handoff-restore;row=ponytail_level,<invalid>` | no transition | `1` | `gsd-handoff` | `Blocker: invalid handoff settings.` | preserve invalid handoff |
| Handoff restore with duplicate explicit toggle | `event=handoff-restore;row=duplicate` | no transition | `1` | `gsd-handoff` | `Blocker: invalid handoff settings.` | preserve invalid handoff |

For a supplied toggle, only the accepted domain can enter `explicit_level`; omission means `full`. An invalid level preserves the prior `explicit_level`, clears `auto_scope`, emits exactly the table's concise allowed-level feedback, and never becomes state. Stop/normal sets both fields to `none`.
On every valid handoff restore, initialize `explicit_level=none` and `auto_scope=none` before inspecting `settings[]`. A valid `ponytail_level,lite|full|ultra` row overrides only `explicit_level`; an absent row leaves both fields at `none`. `gsd-handoff` validation runs first: an invalid or duplicate row blocks the entire resume and never reaches this state transition. Auto scope is never restored.
A hard-blocker or verify-fail stop preserves `explicit_level` and clears `auto_scope`. A later resume of the same fix reclassifies it and may auto-fire anew rather than inheriting stale state. Landing/merge and an unrelated prompt apply the same clearing rule.
Auto-fire never becomes explicit state, never reaches a fresh task brief, and never appears in `settings[]`. Every real quick-fix loads this skill and emits exactly one table cue; an explicit level takes precedence without setting `auto_scope`. Append no menu, question, or prompt.

## The ladder (stop at the first rung that holds — after you understand the problem, not instead of it)
1. **Does this need to exist?** Speculative → skip, say so. (YAGNI)
2. **Already in this codebase?** Reuse the helper/pattern a few files over.
3. **Stdlib does it?** Use it.
4. **Native platform feature?** `<input type="date">` over a picker lib, CSS over JS, DB constraint over app code.
5. **Already-installed dependency?** Use it. Never add one for what a few lines do.
6. **Can it be one line?** One line.
7. **Only then:** the minimum code that works.

Two rungs work → take the higher. Bug fix = root cause (grep every caller; fix once at the shared function, not a guard per caller).

## Rules
- No unrequested abstractions (one-impl interface, one-product factory, never-changing config).
- No boilerplate/scaffolding "for later".
- Deletion over addition. Boring over clever.
- Fewest files. Shortest working diff wins — once you understand the problem.
- Complex request? Ship the lazy version + question it in the same response ("Did X; Y covers it. Need full X?"). Never stall on a defaultable answer.
- Mark deliberate simplifications `// gsd-ponytail: <what + ceiling + upgrade path>`.

## Output
`[code] → skipped: [X], add when [Y].` No essays unless the user asked for a report/walkthrough.

## Intensity
| Level | Behavior |
|---|---|
| **lite** | Build what's asked; name the lazier alternative in one line. User picks. |
| **full** (default) | Ladder enforced. Stdlib/native first. Shortest diff + shortest explanation. |
| **ultra** | YAGNI extremist. Deletion before addition. Ship the one-liner, challenge the rest. |

## Never simplify away
Input validation at trust boundaries, data-loss-preventing error handling, security, accessibility basics, anything explicitly requested. Never lazy about *understanding* — trace the whole flow before picking a rung. Non-trivial logic leaves one runnable self-check behind (an `assert` `demo()`/`__main__`, or one small `test_*`).
