# 0028 — Plan authority is validated grammar, not hash-bound bytes

- **Status:** Accepted
- **Date:** 2026-09-26

## Decision

`state.toon` (schema `v0.0.3`) records `plan_path` and `base_ref` but no `plan_sha256`. Every consumer — resume, `analyze-waves`, the terminal gate, and the pre-merge preflight — revalidates the current `plan.md` with `--expected-base <base_ref>`; the `--expected-sha256` flag and the `sha256:` output line are gone, and a plan that fails validation blocks as `plan-invalid`. An amendment is an in-place edit plus revalidation with an incremented `checkpoint_revision`; there is no rebind step. An acceptance criterion requires only its State and a `GIVEN/WHEN/THEN` Scenario; Outcome, Action, and Expected are optional detail.

This replaces the "plan stays hash-bound bytes" clause of 0003 and the "each rebind" wording of 0027; the rest of both records stands.

## Rationale

The plan is meant to stay editable during execution, so every legitimate edit tripped the hash and cost a revalidate-and-rebind round that caught nothing the grammar check does not. The base check stays because it is the one binding that protects the merge target.
