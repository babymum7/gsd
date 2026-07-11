# GSD Reference — load-on-demand payloads

Not needed at routing time. Load this file when the matching flow below fires (it sits next to `SKILL.md`; resolve the path per SKILL.md § Dynamic Sub-Skill Loading).

## Artifact Contract

This is the single canonical runtime meaning of skill artifacts. Frontmatter stays deliberately flat and parseable:

- `consumes: [...]` is the catalog union of repository artifacts that any invocation mode of the skill may read, including Optional and Fallback artifacts.
- `produces: [...]` is the catalog union of repository artifacts that any invocation mode may create, update, or delete.

Those arrays are discovery metadata, not runtime preconditions. Do not add nested workflow YAML, a manifest, or a parser. Runtime requirements belong to the selected mode's local table.

Artifact roles are evaluated per Invocation Mode:

- **Required** — authentic state that must exist before that mode can run. If it is absent, use the row's recovery, reconstruction, or blocker path; never invent the artifact or its contents.
- **Optional** — useful context when present. Absence is normal: continue without it, and never redirect to `/gsd` merely because it is missing.
- **Produced** — state the mode is authorized to create, update, or delete. It need not exist on entry and may be created lazily when the mode actually has content to persist. Deletion is authorized only when that selected mode explicitly names deletion.
- **Fallback** — durable evidence explicitly named by a recovery path to reconstruct missing Required state. Use it only for that documented reconstruction; if it cannot establish the state, block or recover through `/gsd` rather than fabricate it.

Apply the contract in this order:

1. Select the target skill and its **Invocation Mode** from explicit intent and entry context. On resume, preserve the handoff's open `mode` and `phase` values. Artifact presence may inform routing, but presence of an artifact alone does not select a mode (and milestone-ledger presence alone never selects milestone mode).
2. Load the skill and validate only that mode's **Required** artifacts.
3. Treat missing **Optional** and not-yet-created **Produced** artifacts as normal.
4. For a missing **Required** artifact, execute the row's **Missing required** action. Reconstruction may use a named **Fallback**; otherwise recover once or stop with a blocker. No skill synthesizes workflow state to make validation pass.

Every local invocation-mode table uses this interface exactly:

| Mode | Required | Optional | Produced | Missing required |
|---|---|---|---|---|
| `<mode selected from the invocation>` | `<artifacts or —>` | `<artifacts or —>` | `<artifacts or —>` | `<recovery, reconstruction, blocker, or —>` |

The rows are instance data only; this section owns their semantics. Tables list repository artifacts, use `—` for none, and name any Fallback inside **Missing required**.

## proposal.toon, spec.toon, design.toon — template & rules (Route 6 convergence)

### proposal.toon
```toon
schema:v1
feature:<feature-slug>
summary:"<One-line feature summary>"
why:"<Short explanation of need>"
scope[count]{kind,item}:
  include,<scope-item-1>
impact[count]{area,change}:
  <area-1>,<change-1>
questions[count]{id,question,status,resolution}:
```

### spec.toon
```toon
schema:v1
feature:<feature-slug>
context:"<Context description>"
proposal:proposal.toon
design:<design.toon|null>
milestone_ledger:<docs/gsd/<feature>/milestones.toon|null>
criteria[count]{id,state,outcome,action,expected}:
  AC-1,active,"<outcome-1>",<action-1>,<expected-1>
invariants[count]{id,text}:
  I-1,"<invariant-1>"
non_goals[count]{id,text}:
  NG-1,"<non-goal-1>"
interfaces[count]{criterion,seam,path,lower_seam_reason}:
  AC-1,<seam>,<path>,<lower_seam_reason>
```

### design.toon
```toon
schema:v1
feature:<feature-slug>
decisions[count]{id,question,decision,rationale}:
  D-1,"<question>","<decision>","<rationale>"
alternatives[count]{decision_id,option,rejected_because}:
  D-1,"<option>","<rejected_because>"
risks[count]{id,risk,mitigation}:
  R-1,"<risk>","<mitigation>"
```

Rules:
- Generated packet files use UTF-8 and LF only, no blank lines, exact scalar/table order, exact declared row counts and field order, exactly two spaces before each row, canonical minimal TOON quoting/escaping, and parse-then-serialize byte identity. Unknown, missing, reordered, duplicate, or non-canonically encoded fields fail closed; producers rewrite rather than normalize consumer input. Every declared zero-count table remains present in its canonical position.
- Every criterion is checkable: `outcome` states the observable contract, while separate concrete `action` and `expected` fields form its acceptance-check sketch. Empty values, `TBD`, `TODO`, topic labels, and vague placeholder prose are ineligible. The exact runnable command is finalized from this sketch in the dispatch-time task brief; no downstream consumer invents an oracle.
- Criterion IDs are stable and match `AC-N`, where `N` is a positive base-10 integer without leading zeroes. `state` is exactly `active` or `superseded`. A revision issues a fresh ID for each replacement and retains the replaced row with `state=superseded`; duplicate IDs, an ID represented in both states, unknown states, malformed IDs, or missing/nonconcrete fields are blockers. Planning, execution, and verification use only active criteria; superseded rows are read-only history.
- Every active criterion has exactly one `interfaces` row with the same `criterion` ID and its highest deterministic existing public `seam`, repository-relative `path`, and `lower_seam_reason` (`none` at the highest seam). Missing, duplicate, unknown, superseded-only, or conflicting active pins are blockers. A lower seam is valid only when the recorded concrete reason establishes that the higher boundary is absent or cannot deterministically isolate the criterion.
- `spec.toon` contains `invariants` and `non_goals` rows. `design.toon` is conditional: create it only when Discussion resolves a load-bearing design decision, alternative, or risk; it records those resolved facts, not speculative implementation steps. Otherwise write `design:null` and do not create an empty ceremonial file. Its absence means "none" and is not a license to infer design details downstream.
- This `spec.toon`'s `milestone_ledger` field is the sole durable publication-entry proof carried through plan approval, handoff/resume, execution, and verify. Only the exact `milestone_ledger` scalar in `spec.toon` is the candidate; its value must parse to the active root feature's exact ledger path or null. Ordinary prose mentions do not count. `gsd-to-plan` derives the expected ledger path from exactly one of two mutually exclusive sources: that durable `milestone_ledger` field for Normal root publication, or explicit milestone-entry intent plus the first-pending row of the authoritative base ledger for Milestone planning (which has `milestone_ledger:null`).

## JIT task-brief attempt TOON — template & rules

### a<N>.toon
Every dispatched task attempt generates a JIT task brief in TOON format at `.scratch/<feature>/tasks/<Tn>/a<N>.toon`.

```toon
schema:v1
task:T1
attempt:1
task_base:abc123fed456
title:"Implement single OMP command"
ponytail:ultra
criteria[1]{id,outcome,action,expected}:
  AC-1,"OMP install",run,success
constraints[1]{kind,text}:
  invariant,"no external dependencies"
targets[1]{layer,path,interface,change}:
  installer,install.sh,main,write
checks[1]{criterion,seam,command,expected}:
  AC-1,highest-existing-public,"bash install.sh",success
safety[1]{mode,obligation}:
  none,"no safety risks"
```

Rules:
- Attempt files are JIT task-brief packets written exactly once to `.scratch/<feature>/tasks/<Tn>/a<N>.toon` immediately after recording `TASK_BASE` and before dispatching attempt `N` (where `N` is a positive sequential integer `1`, `2`, ... starting at `1`).
- The bytes of a written attempt TOON are completely immutable. No actor (implementer, reviewer, or fixer) may overwrite or mutate a written attempt file. Re-dispatch writes a fresh next positive sequential attempt file.
- Gaps in attempt numbers (e.g. `a1` then `a3`), duplicate attempts, malformed attempt names, mismatched task/attempt identities, or noncanonical TOON bytes must fail closed.
- The JIT creator must fsync, close, and read back the exact written bytes from disk (instruction-level semantics are fine). Bind a digest or byte buffer of the read-back bytes, and pass those exact read-back bytes—not reconstructed objects or prose—to the implementer, per-task reviewer, and any finding fixer for that attempt. Reviewer and fixer identity must reference the same task, attempt, and digest.
- `attempt` is a native positive integer and must be serialized unquoted (e.g., `attempt:1`).
- Template placeholders that may require quoting must state that the producer canonical-encodes concrete values rather than presenting invalid literal examples.
- The JIT task brief maps deep tables: `criteria` contains verbatim matching active criteria from the spec; `constraints` contains rows for relevant invariants, non-goals, design, runtime-root, lower-seam reason, or done obligations; `targets` contains each owned path, layer, interface, and change type; `checks` contains the criterion ID, pinned public test seam, concrete command (the green verification obligation), and expected outcome; `safety` contains the Expand/Migrate/Contract obligations.
## spec.md — bootstrap conversion input only

This section defines the retired Markdown format solely so the self-host T2 cutover can validate and convert the byte-preserved bootstrap input, and so negative fixtures can prove fail-closed behavior. After activation, normal planning, execution, handoff, resume, and verification must reject an active `spec.md`; they read `spec.toon` only.

### T2 bootstrap activation and recovery contract

| Scenario | Inputs / Conditions | Target / Staging | Action | Safety & Validation |
|---|---|---|---|---|
| Standard start | T2 `in_progress` in `plan.toon`; `spec.md` present; no active root TOON finals (`proposal.toon`/`spec.toon`/`design.toon`) | `.scratch/<feature>/staging/` | Start T2 activation: read/capture `SPEC_INPUT` and `PLAN_INPUT` in memory; generate/validate staging; move staged TOONs to root; unlink `spec.md` LAST | MUST NOT write to `spec.md` or `plan.toon`; validate full legacy-source -> TOON equivalence while `spec.md` is present; unlink `spec.md` LAST as the logical activation seam. |
| Mixed / Interrupted state | T2 `in_progress` in `plan.toon`; both `spec.md` and any root TOON finals present | None | Block routing: no dispatch or resume. Rollback delete-only required | Mixed state blocks all ordinary tasks. Rollback by deleting only generated staged/root TOON files; re-read and compare bytes. |
| Finish recovery | T2 `in_progress` in `plan.toon`; `spec.md` absent; all required root TOON finals present | Root | Finish recovery: strictly parse/round-trip and satisfy internal/cross-file invariants for required root finals; allow execution to proceed | `spec.md` deletion-last proves pre-unlink source equivalence already ran. Incomplete/invalid finals block with no rollback. |
| Rollback | T2 `in_progress` in `plan.toon`; mixed state; rollback triggered | Root | Delete only generated staged/root TOON files | Capture current `spec.md`/`plan.toon` bytes at recovery start, delete only staged/root TOON artifacts, re-read and compare before/after. |
| Post-activation | T2 `done` or beyond T2; root TOON files present; `spec.md` absent | Root | TOON-only execution: downstream/terminal consumers read only TOON files | No runtime parser, fallback, or compatibility shim for legacy `spec.md` is permitted. |
| Mixed / Active spec.md | Outside T2 `in_progress` (e.g. `done` or not in T2); `spec.md` present | None | Block: reject active `spec.md` | Any mixed or active `spec.md` outside the exact T2 bootstrap window blocks all routing and execution. |

#### Exact transaction rules
1. **Preservation & Isolation:** Standard start reads/captures the exact `SPEC_INPUT` and `PLAN_INPUT` bytes in memory. The transaction MUST NOT write to either source file. All intermediate generated TOON files (`proposal.toon`, `spec.toon`, `design.toon`) MUST be written to `.scratch/<feature>/staging/` for validation.
2. **Equivalence & Validation:** Validate full legacy-source -> TOON equivalence while `spec.md` is still present. Required finals are derived from parsed `spec.toon.design`: `proposal.toon` and `spec.toon` (and no design file) when `design:null`; all three (`proposal.toon`, `spec.toon`, `design.toon`) when `design:design.toon`. Validate all cross-file references.
3. **Logical Activation Seam:** Once staging is verified-green, the staged TOON files are moved to the feature root first. `spec.md` MUST be unlinked LAST as the logical activation point (never call it filesystem-atomic).
4. **In-Process Failure Rollback:** Any exception, syntax error, or equivalence mismatch during the generation/validation phase MUST trigger an immediate cleanup: remove only generated staged/root TOON files, re-read `spec.md` and `plan.toon` bytes from the filesystem, and compare them byte-for-byte with the in-memory captures to verify no writes occurred, then stop. Do not use restore wording.
5. **Cross-Process Mixed Rollback:** Rollback of an interrupted/mixed state is possible because the transaction never writes source files. Capture current `spec.md` and `plan.toon` bytes at recovery start, delete only staged/root TOON artifacts, and re-read and compare bytes before/after to prove they are identical. Do not claim an unavailable original backup or restore.
6. **Finish Recovery:** If `spec.md` is absent, finish recovery ONLY when the complete required root set strictly parses/round-trips and satisfies all internal/cross-file invariants. Do NOT say "match source" (the source `spec.md` is unavailable). The `spec.md` deletion-last check proves pre-unlink source equivalence already ran. Incomplete or invalid finals block permanently with no rollback.
7. **No Compatibility Shims:** Outside the exact T2 `in_progress` bootstrap window, any mixed or active `spec.md` blocks all routing and execution. Downstream/terminal consumers are TOON-only, with no runtime parser or compatibility shims.
### Template

```
# <feature>
## Context
<context>
## Design & Invariants (Optional)
- **Constraints/Invariants**: <invariants>
- **Non-Goals**: <non_goals>
## Acceptance Criteria
- AC-1: <verifiable outcome>
  - Check: <action → expected outcome>
```

### Rules

- **ACs pin the final behavior — the convergence contract.** Each AC states an observable outcome (a user-visible result, a return value, a state transition) precise enough that any implementer, regardless of model or approach, converges to the *same* end behavior even if the code differs. Creativity belongs in Discussion (exploring approaches, suggesting design); once an AC is written it is a fixed target, not a suggestion. Vague ACs are the root cause of divergent results across agents — sharpen the AC, don't over-specify the implementation.
- Every AC is checkable and pairs each AC with a Check action and expected outcome. A reviewer reading only the AC knows how to confirm it.
- **Every AC carries a concrete Check — the bootstrap conversion gate.** Before an AC is accepted from `spec.md`, its indented `Check:` must use canonical `action → expected observable result` form. Both sides must be concrete; empty text, `TBD`, `TODO`, labels, and vague placeholder prose are not checks. If a concrete expected result cannot be sketched, stop and sharpen the source before activation. The one-time T2 converter writes the two sides to that criterion's structured `action` and `expected` fields in `spec.toon`; downstream task briefs and gates read those fields only.
- AC IDs are stable. A spec revision issues a fresh ID for each replacement and preserves the replaced entry with the one canonical bootstrap lifecycle grammar:
  - Active AC header: `- AC-N: <outcome>`.
  - Superseded AC header: `- AC-N [superseded]: <former outcome>`.
  Parse canonical AC list-item headers only under the exact `## Acceptance Criteria` section, up to the next heading of equal or higher level, and outside fenced code. `N` is a positive base-10 integer without leading zeroes. Preserve the original indented `Check:` beneath a superseded entry as history, but exclude that entry from conversion output.
- Any AC-like header or check that does not match that complete canonical bootstrap form blocks conversion; never infer or normalize its state. This parser exists only inside the one-time T2 `spec.md` → `spec.toon` activation transaction. After activation, all runtime planning, execution, handoff/resume, TDD, and verification paths parse only the structured `criteria` and `interfaces` tables from `spec.toon`; they never read `spec.md`.

## Planning decomposition & precision contract

Discussion inspects the existing test layout already relevant to the feature and pins the **highest deterministic existing public seam** that can observe each criterion through production behavior. Use an existing browser/CLI/HTTP boundary harness when it exists and can deterministically isolate the criterion; otherwise use the highest existing public module API. `spec.toon` records exactly one `interfaces` row per active criterion with the same `criterion` ID, its selected `seam`, repository-relative `path`, and `lower_seam_reason=none` when highest. A lower seam is valid only when the higher boundary is absent or cannot deterministically isolate that criterion, and the row records that concrete reason. Never create a lower public or test-only interface merely to make a test easier. An internal test interface is not public merely because tests can import it.

Resolve multiple usable harnesses at the same highest tier deterministically. First keep the harness for the production entrypoint named by the criterion's `action` (browser versus CLI versus HTTP). If several harnesses observe that entrypoint, prefer the repository's canonical existing harness/project convention; then prefer greater coverage of the production path with no test-only bypass. If candidates remain tied, stop in Discussion as materially ambiguous rather than choosing by array order, filename, or convenience.

At dispatch, parse the exact `interfaces[count]{criterion,seam,path,lower_seam_reason}` table. Every active criterion must have exactly one pin, and each satisfied criterion's `path` must match the plan row's existing `test` exactly. If one row satisfies several criteria, all pins must share the exact `seam`, `path`, and `lower_seam_reason`. A missing, duplicate, unknown, superseded-only, conflicting, or mismatched pin is a spec/plan blocker: stop to re-plan or revise the spec. Never invent behavior, manufacture a reason, or silently substitute another seam.

The lower-seam reason must match the live cause: state absence only when no existing public higher-boundary harness exists; otherwise state its nondeterminism or deterministic-isolation failure. A stale or contradictory cause is a spec gap, not an acceptable copied explanation.

Each non-superseded plan row's `satisfies` contains only known, unique active criterion IDs parsed from the exact `criteria[count]{id,state,outcome,action,expected}` table in `spec.toon`. Missing IDs, duplicates, unknown IDs, and extra or conflicting interface pins are plan/spec defects. If one task satisfies several criteria, every criterion must have the same exact pinned seam, path, and lower-seam reason. Otherwise split the behaviors into separate sequential rows; one `test` cell and one task brief must never collapse conflicting seam decisions. The union of all non-superseded rows must cover every active criterion; superseded plan rows and superseded criteria are historical only.

Ordinary implementation is decomposed into **vertical behavior slices**. Derive the required behavior layers from the AC and live codebase; UI/API/domain/storage are examples, never a universal architecture template. The emitted task must cover exactly every required layer, own at least one affected file for each required layer, include the focused automated check at the selected seam, and land green. Rows named only for a layer (`add DB`, `add service`, `add API`, `write all tests`) or a slice omitting a required layer are rejected and rewritten around behavior unless that row independently exposes and verifies a real public contract. Each behavior task is independently runnable where possible; the existing explicit acceptance deferral is an exceptional bridge to a named later task/gate, not permission to normalize a partial horizontal slice.

Use **Expand → Migrate → Contract** only for a blast-radius mechanical contract/API/schema refactor that cannot move all callers atomically while remaining green. `Expand` must be backward-compatible. Every bounded `Migrate` row must keep both old and new seams working. `Contract` may remove the old seam only after a complete caller/reference inventory proves repository references are gone and all owned and external consumers are migrated, or a precise compatibility/deprecation obligation is completed. If external consumers exist without that evidence, or consumer ownership is unknown, do not emit `Contract` now: retain the old seam and place `Contract` behind a later precise milestone/evidence gate. Its focused check must explicitly perform the caller/reference inventory and expect zero stale references. At planning, every Vertical, Expand, Migrate, and Contract row defines its concrete focused check and mandatory green-verification obligation; it never predicts a future pass. Execution runs that check and supplies the verified-green fact before the row can land or the next stage can proceed. When a candidate row/stage result is evaluated, false or missing green state fails. These semantic safety and result facts remain in the validated spec/task brief and execution review, not new `plan.toon` columns. Ordinary features never receive this sequence as ceremony.
For `Expand` and every `Migrate`, the focused action affirmatively invokes or exercises each old and new seam; merely naming, mentioning, omitting, or excluding one is not evidence. Its expected side names a positive observed result from each seam. Negative or ambiguous states do not become safe because they also contain words such as “both” or “working.”

A `Contract` row that planning emitted without surfacing blocking evidence stays bound to this same gate at execution: `gsd-executing-plans` reruns the caller/reference inventory after implementation and retains the old seam whenever an owned or external consumer is still unmigrated without a completed obligation. Planning-time deferral and this execution-time gate are one retain-until-proven rule, applied at whichever phase the blocker first surfaces.


Large-feature Discussion applies a precision gate before milestones, ledger rows, or specs. A candidate is eligible only when it states a materially answerable precise question (not a topic label) or at least one checkable criterion with concrete `action` and `expected` fields. Empty/TBD/TODO/vague values remain unchecked. Otherwise retain exactly one concise fog/future/out-of-scope note and create no ledger row, detailed speculative spec, or task; do not introduce a separate plan column, progress frontier, or local state tracker. The separate ledger is not a plan column, progress frontier, or local tracker, and does not weaken this prohibition. Revisit only when new evidence sharpens it. A precise question may keep a future milestone eligible for Discussion, but writing `spec.toon` still requires at least one checkable active criterion. For mixed candidates, persist only materially precise, user-approved milestone goals, write only the checkable active criteria, and collapse every unchecked remainder into one fog/future/out-of-scope note; unchecked text never becomes a ledger row, criterion, spec, or task.
A materially answerable question identifies the exact decision/property to resolve and the constraint, choice, or threshold that makes the answer determinate. Domain nouns plus a copula, an open-ended “what should we do,” or a topic merely “worth discussing” remain topic labels. Precision alone does not imply approval: a ledger row requires the user to approve that precise goal and its order.


### Executable planning policy scenarios (normative)

Match the explicit `Inputs`, then apply every output column. `Migrate+` means one or more bounded sequential rows. `highest-existing-deterministic-public` means the seam ladder and same-tier tie-break above, not a newly invented test API. At planning time, `each-row-focused-and-green` requires a concrete focused check plus the obligation to run it; it never requires or predicts a pass. Execution supplies the verified-green fact after implementation and blocks landing or the next stage when that candidate result is false or missing. The planning artifacts named here are the existing `plan.toon` and `spec.toon`; the large-feature milestone ledger is governed separately below, and `none` creates nothing.

| Scenario | Inputs | Output | Proposal handling | Tasks/order | Test seam | Lower seam | Green/check | Artifact |
|---|---|---|---|---|---|---|---|---|
| Cross-layer user behavior | `phase=plan;kind=behavior;proposal=cross-layer;wide-refactor=no` | `vertical-behavior-slice` | `accept` | `Vertical:all-required-layers` | `highest-existing-deterministic-public` | `concrete-reason-required` | `each-row-focused-and-green` | `plan.toon` |
| Ordinary three-layer proposal | `phase=plan;kind=behavior;proposal=horizontal-layers;wide-refactor=no` | `vertical-behavior-slice` | `reject-and-rewrite` | `Vertical:all-required-layers` | `highest-existing-deterministic-public` | `concrete-reason-required` | `each-row-focused-and-green` | `plan.toon` |
| Blast-radius mechanical refactor | `phase=plan;kind=mechanical-refactor;blast-radius=wide;atomic-green=no` | `ordered-expand-migrate-contract` | `allowed-only-for-unavoidable-wide-refactor` | `Expand:backward-compatible-new-seam;Migrate+:bounded-callers;Contract:remove-old-seam` | `highest-existing-deterministic-public` | `concrete-reason-required` | `each-row-focused-and-green` | `plan.toon` |
| Precise future milestone | `phase=discussion;kind=future;precision=question-or-criterion-check` | `precise-milestone-or-spec` | `eligible; ledger row only when user-approved` | `none` | `pin-at-convergence` | `not-applicable` | `precise-question-or-concrete-action+expected; unchecked-remainder-one-note` | `milestones.toon-if-user-approved-goal; proposal.toon+spec.toon-if-checkable-criterion` |
| Vague future area | `phase=discussion;kind=future;precision=vague` | `one-fog/future/out-of-scope-note` | `hold-until-new-evidence` | `none` | `none` | `not-applicable` | `one-note-no-task` | `none` |

## Milestones — large features

An ask that converges to many independently-shippable chunks (or would plan past ~10 tasks) is split at convergence: `.scratch/<feature>-m1/`, `-m2/`, … — each milestone a full spec→plan→verify→merge cycle landing on `<base>` before the next is specced in detail. Short-lived branches beat one giant plan; later milestones are specced against the merged reality, not a prediction. (`gsd-to-plan` enforces the same smell from its side: a plan pushing past ~10 tasks routes back here to split.)

**Milestone Ledger — canonical tracked state.** A large-feature split persists every materially precise, user-approved milestone goal in one exact Git-tracked `docs/gsd/<feature>/milestones.toon` file using the canonical schema and order, while vague future areas create no ledger row/spec/task. Create or update this file only when a large feature is split and at least one milestone goal is both materially precise and user-approved; ordinary or single-milestone work requires no ledger. The ledger is durable cross-milestone state, distinct from the transient, git-ignored `.scratch/<feature>-mN/plan.toon` that records task progress inside one milestone. The separate `docs/gsd/<feature>/milestones.toon` tracked artifact is never a plan column or progress tracker. When the current milestone intentionally creates/updates that path, exactly one current plan row owns the exact path in `files`, and that sole owner is `status=pending`; zero, duplicate (including repeated in one row), or non-pending ownership blocks before summary/approval. Likewise, when no ledger write is intentional, zero matching `docs/gsd/*/milestones.toon` file tokens are permitted; any such token is invented ownership and blocks before approval.
When convergence intentionally creates or appends the ledger, set the `milestone_ledger` field in `spec.toon` to the active root feature's exact path; set it to null when no ledger write is intentional. `gsd-to-plan` derives the expected ledger path from exactly one of two mutually exclusive sources: that durable `milestone_ledger` field for Normal root publication, or explicit milestone-entry intent plus the first-pending row of the authoritative base ledger for Milestone planning (which has `milestone_ledger:null`). It binds the resulting path to one pending plan owner and exposes marker provenance in the root plan's approval summary. With neither source, no ledger path may appear in the plan; both sources together are a blocker.

The file has exactly this shape:

```
schema:v1
feature:<feature>
base:<base>
milestones[count]{id,slug,goal,status}:
M1,<feature>-m1,<concise precise user-approved goal>,pending
```

`milestones[...]` has exactly the ordered fields `id,slug,goal,status`. Rows preserve user-approved order; IDs are sequential `M1` through `Mn`, and each slug is exactly `<feature>-m<n>` for the same one-based number. `goal` is concise, materially precise, and user-approved. `status` is exactly `pending` or `done`. Every newly written row starts with `status=pending`, including rows appended by a later ledger update; existing rows may remain `done`.
`goal` must round-trip the exact approved wording. When it contains the active comma delimiter, quotes, backslashes, control characters, or other TOON structural characters, use canonical double-quoted TOON string syntax and escape only `\\`, `\"`, `\n`, `\r`, `\t`, or `\uXXXX` as required; decoding restores the original string. Never rephrase or reject an otherwise precise approved goal merely to avoid a delimiter.

During convergence-time creation/update, the existing row prefix is immutable: preserve each row in its current position with its current ID, slug, goal, and status, then append newly approved goals in user-approved order with the next sequential ID/slug and `status=pending`. Sequential ID/position is row identity; goal text need not be unique and must never be used to deduplicate rows or inherit an earlier row's status. This section owns serialization only—it does not select or recover the next milestone, mark a row complete, or authorize a merge.
Update input contains only newly proposed additions; the tracked existing prefix is the source of truth and is neither resubmitted nor re-evaluated through the precision/approval gate.
### Convergence Ledger publication contract

A Milestone Ledger created or appended during convergence is an authorized pre-approval domain write, not a completed milestone and not evidence for selecting Milestone mode. It must first land on `<base>` through the root feature's ordinary Normal plan execution and Planned WIP gate before any `<feature>-mN` plan enters the terminal lifecycle below.
- **Entry authorization**: Evaluate a changed ledger as publication only when the selected verify invocation is Planned WIP and the raw approved root `spec.toon` contains a non-null `milestone_ledger` field whose path equals the root feature's exact ledger path and the sole plan owner's path. A ledger diff, path presence, conversational/context boolean, ordinary Planned WIP, or Quick-fix WIP cannot infer this entry. The field value plus approved plan is necessary but never sufficient; all raw ownership, byte, and evidence checks below still gate publication.

- **Raw ownership**: Parse the canonical raw `plan.toon` without normalization. The exact root ledger path must occur in `files` exactly once, no other `docs/gsd/*/milestones.toon` token may occur, its sole owner must be `done` (never `superseded`), and every plan row must be terminal before merge.
- **Allowed bytes**: For initial creation, authoritative base evidence is explicit path absence and every created row is canonical and `pending`. For an update, parse the authoritative base and WIP ledgers, preserve every existing row byte-for-byte in order and status, append at least one canonical sequential row, and require every appended row to be `pending`. Publication never changes an existing status or writes `done`.
- **Commit and gate evidence**: Exactly one raw WIP task commit must include the ledger path once, identify the sole plan owner, and directly change the authoritative base bytes (or explicit absent value) to the exact WIP bytes. `reviewedDiff[<path>]` and staged `squashInput[<path>]` must each contain those exact WIP bytes. Missing/mismatched evidence, any Critical/Important finding, red/missing build/test/acceptance/E2E evidence, or any conflict blocks the merge and preserves the authoritative base bytes/absence.
- **Path-set integrity**: In the raw plan `files` cells, every raw WIP commit's complete changed-path list, the `reviewedDiff` keys, and the staged `squashInput` keys, every path matching `docs/gsd/*/milestones.toon` must equal the one canonical root ledger path. Any other ledger-looking path is a blocker. The canonical path must occur in exactly one WIP task commit—the sole owner's direct publication commit.
  Scan raw, untrimmed path tokens. If a token contains a ledger-shaped path but is not byte-for-byte the canonical path—including whitespace-padded, prefixed, or suffixed variants—reject it; never trim or normalize it into acceptance.
- **Base revision evidence**: Capture the raw `<base>` commit OID used for review and recapture it immediately before the shared squash sequence. Missing or unequal OIDs block publication and require the full review/build/acceptance/E2E and ledger-evidence gates to rerun against the advanced base, even when no textual conflict exists.
- **Boundary**: Publication uses the ordinary shared squash sequence and reports no next milestone. Only after the canonical pending ledger is committed on `<base>` may recovery select its first pending row and reconstruct a milestone plan. The terminal lifecycle below therefore always compares a milestone transition against an authoritative pending base ledger.

### Milestone Ledger recovery contract

When explicit continue or resume intent is received but no usable local handoff, plan, or spec can satisfy it, perform a read-only Milestone Ledger recovery:
- **Prerequisite check**: Scan tracked base-branch canonical ledger paths `docs/gsd/<feature>/milestones.toon` only after scratch/handoff/plan/spec recovery cannot satisfy the continue intent.
- **Fail-closed read-only**: This recovery only reads and selects; it must not mutate ledger files, change milestone statuses, mark any milestone complete, start execution, or authorize any merge.
- **Validation and errors**: If any scanned or selected ledger is malformed, lacks required fields, or has a base mismatch (the `base:` field in the ledger does not match the active base branch), the recovery must fail closed, make no selection, and stop with an error.
- **Ledger selection**:
  - If a feature is explicitly named:
    - If that feature's ledger exists and is open, select it.
    - If that feature's ledger is absent, report that no ledger exists and never fall through to other features.
    - If that feature's ledger exists but all milestones are done, report that all work is complete.
  - If no feature is named:
    - If exactly one open ledger (a ledger containing at least one row with `status=pending` on the base branch) exists, auto-select that feature ledger.
    - If multiple open ledgers exist, emit exactly one feature-selection question listing the options and select/update/advance none.
    - If no ledgers exist on disk (empty ledger set), report that no ledger exists.
    - If ledgers exist but all are fully completed (zero open ledgers), report that all work is complete.
    - Invent no work.
- **Milestone selection**:
  - Once a ledger is selected, parse its canonical rows, order, and status. Choose the first milestone row with `status=pending` (never `done`). Done rows are never resumed or reverted.
  - Tracked canonical goals in the ledger are authoritative and must not be re-evaluated or re-run through the precision or approval gates during recovery.
  - Make the missing `.scratch/` directory, handoff file, and plan file non-blocking only for this valid ledger-recovery mode. Retain existing blocker behaviors and requirements for explicitly claimed execution resumes where a plan or handoff is missing but execution has already started.
  - Enter Discussion/reconstruction mode for the selected milestone. Output its milestone slug (e.g., `<feature>-m2`) and precise goal; do not detail or spec any later milestone rows in the ledger.

### Milestone Ledger lifecycle contract

This canonical contract governs the Milestone Ledger during post-approval execution and verification.

- **Current milestone identity**: The current milestone slug (e.g., `<feature>-m1`) is determined by the first pending milestone row in the authoritative base ledger at `docs/gsd/<feature>/milestones.toon`, where `<feature>` is the root feature name (distinct from the milestone slug). Final means that the current milestone row is the last row in the ledger and that there is no later pending row after a valid sequence of completed milestones, which is distinct from merely having a single row or no pending rows in the WIP branch. Derive only from exact base bytes.
- **Preparation**: Before preparation, require that the authoritative base row is `pending`, and that all current plan tasks, code reviews, and focused checks are green. Milestone mode applies only when the current plan owns the exact canonical ledger path `docs/gsd/<feature>/milestones.toon`. Require the current plan/scratch/WIP feature slug to equal the first-pending row's milestone slug. The sole plan task owning the canonical ledger path must be `done`, never `superseded`, before preparation. For non-final milestones, prepare in the WIP branch exactly one cell transition (`pending → done`) in the current row of that Milestone Ledger, and commit this change in a dedicated final WIP commit containing only the canonical ledger file (no scratch/unrelated paths) before invoking verify. For the final milestone, prepare by deleting the ledger file via `git rm` making the WIP path absent, and commit this change in a dedicated final WIP commit containing only the canonical ledger deletion (no scratch/unrelated paths). Do not alter any other row, byte, or file-content in the ledger. The terminal diff must contain this committed transition or deletion.
- **Verification**: At the terminal verify gate, `gsd-verify` validates the milestone ledger path state depending on whether it is a non-final or final milestone. Independently parse the actual plan and the authoritative base ledger. The sole plan task owning the canonical path must be `done`, never `superseded`.
  - For non-final milestones: The WIP ledger path must be present. Require a dedicated final WIP commit containing only the canonical ledger file (no scratch/unrelated paths) before invoking verify. Require a canonical parse on both base and WIP ledgers. Verify that the active scratch/WIP slug matches the first pending base row, and that the exact canonical path `docs/gsd/<feature>/milestones.toon` appears exactly once in the plan task `files` cell. The path, root feature, base, row count, order, IDs, slugs, and goals must be identical between base and WIP, except that exactly the status of the current milestone row must change from `pending` to `done`. All other rows must be byte-for-byte and value-for-value identical.
  - For final milestones: The WIP ledger path must be absent. Require a dedicated final WIP commit that deletes the ledger file via `git rm` (no scratch/unrelated paths) making the WIP path absent. The parent commit's version of the ledger must equal the exact authoritative base-present bytes. Prove canonical WIP tree absence of the ledger file instead of parsing it.
  Any other status transition, multiple transitions, missing transition, or invalid format blocks the merge. If any verification fails, do not merge, leave the authoritative base ledger byte-for-byte unchanged, and stop with the Blocker stop.
- **Evidence binding**: Require the base and parent versions of the milestone ledger to be exact-shape present snapshots containing the exact authoritative base-present bytes (with state `present` and no extra fields). For non-final milestones, the final ledger-only WIP commit's result, the reviewer input (`reviewedDiff[<path>]`), and the squash input (`squashInput[<path>]`) must each be exact-shape present snapshots with the prepared WIP ledger bytes. For the final milestone, the final commit deletes the ledger file (commit name-status `D`), and the reviewer input and squash input must each contain the canonical path as an explicit canonical typed tombstone (state `absent` with no `bytes` field or other keys). Any other shape, raw string, omitted key, null or string absent value, or extra field blocks. Final milestone WIP alone may use WIP/reviewer/squash absence, while its base and parent must be present exact-shape snapshots. Convergence publication may use authoritative base absence only for initial creation, never WIP absence. Non-final Milestone WIP never accepts absence.
- **Path-set integrity**: In the raw plan `files` cells, every raw WIP commit's complete changed-path list, the `reviewedDiff` keys, and the staged `squashInput` keys, every path matching `docs/gsd/*/milestones.toon` must equal the canonical root ledger path. Any other ledger-looking path is a blocker. The canonical path must occur in exactly one WIP commit: the dedicated final ledger-only commit; its presence in any earlier WIP commit blocks the merge.
  Scan raw, untrimmed path tokens. If a token contains a ledger-shaped path but is not byte-for-byte the canonical path—including whitespace-padded, prefixed, or suffixed variants—reject it; never trim or normalize it into acceptance.
- **Plan evidence**: Parse the actual `plan.toon` from raw bytes without normalization: require LF-only line endings, no outer or blank-line whitespace, the documented two-space row indentation and canonical TOON field encoding, and IDs exactly `T1` through `TN` in row order. Malformed/noncanonical evidence is a blocker, not input to normalize.
- **Atomic merge**: The merge is gated behind zero Critical/Important reviewer findings, all build/tests/acceptance/E2E evidence green, conflicts exactly false, and a valid ledger transition. The code and ledger must merge atomically in the same squash commit. A prepared WIP `done` status is not durable completion until merged. For the final milestone, the squash merge commits code changes and deletion atomically with no follow-up base cleanup commit.
- **Next milestone reporting**: On a passing merge, read the merged base ledger: for non-final milestones, report the next first-pending milestone's slug and goal; for the final milestone, verify the expected absence of the merged base ledger path and report the root feature complete from that proven transition. Never auto-select, start, or spec the next milestone.
- **Blockers and failures**: Before a successful base commit, on any pre-squash failure or blocker (including red build/test/acceptance, E2E failure, reviewer findings, or invalid transition), the pipeline stops, returns the existing blocker report, makes no merge, and leaves the authoritative base ledger byte-for-byte unchanged. No next milestone is selected, started, or reported. After a successful base commit, a postcommit invariant or cleanup failure preserves the merged base state/deletion and writes T5 residual state without rolling back the commit.

## Post-approval pipeline contract

This is the canonical contract for the plan-approved pipeline. `gsd`, `gsd-to-plan`, `gsd-executing-plans`, and `gsd-verify` reference this section instead of restating the whole contract; each skill owns only its local implementation details.

- **Approval is the last prompt.** `gsd-to-plan` prints the inline plan summary, asks one approval question, and treats approval as the final human gate for that cycle.
- **Hands-free after approval.** On approval, execution proceeds without further questions, confirmations, menus, or offers through `gsd-executing-plans`, the terminal `gsd-verify` gate, and final integration.
- **Pass merges automatically.** A passing terminal gate runs any required E2E check first, then squash-merges `wip/<feature>` to `<base>` as one commit; there is no manual post-verify merge prompt.
- **Blockers stop and report.** The pipeline stops, reports the blocker, and does not merge for spec flaws/escalations, unresolvable conflicts, non-converging task or verify fix loops, open Critical/Important review findings, a red build/test suite, or failing/unrunnable required E2E.
- **Visibility is not prompting.** Progress, verdicts, build/test results, E2E outcomes, blockers, and the final `<base>` commit are reported in terminal; reporting never asks the user to choose the next pipeline step.

## Contextual disclosure templates

These are the canonical templates for surfacing next actions. `gsd`, `gsd-to-plan`, `gsd-executing-plans`, `gsd-verify`, and `gsd-handoff` reference this section instead of inventing local menus. Pick exactly one surface; inline sub-skill firing appends nothing.

### Master end-session menu

Use only from `gsd` discussion/resume surfaces before plan approval:
```
Next steps (reply with number or text):
1. <human outcome, e.g. Generate the implementation plan>
2. <human outcome, e.g. Review the spec visually>
3. <human outcome, e.g. Audit codebase architecture>
4. <human outcome, e.g. Pause & Save progress>
```
Rules: choices are numbered, concrete, and non-technical; do not list skill commands; never include "Start executing tasks". When the just-produced deliverable is lavish offer-eligible (clears the 2-part Fire gate — a finalized spec, plan summary, verify report, or audit), one choice MUST be the visual review, folded into this menu — never a second prompt (per § Lavish opt-in gate taxonomy). After the plan approval question, this menu is suppressed until the pipeline merges to `<base>` or stops on a blocker.

### Direct sub-skill Next steps

Use only when a sub-skill is invoked directly/standalone and must hand control back:
```
Next steps:
- /gsd (to <resume/revise/save/continue the appropriate flow>)
```
Rules: `Next steps:` means technical commands; keep bullets minimal; do not show a numbered human menu; inline firing inside another skill's flow appends nothing.

### Post-approval pipeline progress

Use after `gsd-to-plan` approval while auto-pilot is running:
```
<phase>: <observable fact>. Next: <automatic next action>.
```
Rules: progress is status, not a choice. Do not emit `Next steps:`, numbered menus, offers, "Start executing tasks", or any prompt to continue/merge. On pass, report the squash merge to `<base>` as a completed fact.

### Blocker stop

Use when the post-approval pipeline must stop:
```
Blocked at <task/gate>: <why>.
Stopped before merge; <base> is unchanged.
Next steps:
- /gsd (to revise the spec, resume after the external fix, save progress, or choose a new path)
```
Rules: name the blocker category from the post-approval pipeline contract; never merge past it; do not add a numbered menu.

### Standalone review/report surface

Use for `gsd-verify` Route 2 or other standalone reports with no WIP merge authority:
```
Review report:
Verdict: <pass/fail/n/a>
Findings: <summary or none>
Next steps:
- /gsd (to plan fixes, save progress, or return to discussion)
```
Rules: review/report surfaces are read-only unless explicitly in the WIP-branch gate; never offer or ask to merge after a standalone report.

## Lavish opt-in gate taxonomy

This is the canonical taxonomy for `gsd-lavish` and every skill that may surface a browser-reviewed artifact. `gsd-lavish`, `gsd-to-plan`, `gsd-verify`, and `gsd-improve-codebase-architecture` reference this section instead of inventing local opt-in rules.

- **Explicit acceptance = launch consent.** The user directly asks for a lavish/browser/visual report, or accepts an offered one. Acceptance is what authorizes *launching the browser flow* — it is NOT a precondition for *asking*. The Fire gate must still hold before launch.
- **Offer-eligible deliverable → ask first, mandatory.** When a finalized standalone deliverable is offer-eligible (both Fire gate checks hold: reviewable outside the conversation AND browser annotation adds value), the surfacing skill MUST proactively ask whether to review it visually — it does not merely *may*, and it never stays silent waiting to be asked. Fold the question into the surface already being shown (the master end-session menu as one numbered choice, e.g. "Review the spec visually"; or a single inline "review this visually?" line when no menu is present) — never as a second, separate prompt. Launching waits for the user to accept; asking does not. Examples: substantial specs, finalized `plan.toon` summaries, standalone verify reports, architecture audits/comparisons. Inline Q&A, transient progress, and per-task diffs are never offer-eligible. Asking costs one menu line; the user ignores it at no cost. The failure mode this fixes: staying silent so lavish never appears unless explicitly demanded.
- **One prompt, not two.** The offer rides an existing surface; it never adds a prompt. In particular it never introduces a second question around `gsd-to-plan`'s approval — plan approval stays the last prompt of the cycle. Pre-approval, the offer is one option in the end-session menu; it is not a standalone gate.
- **Post-approval pipeline no-offer mode.** After `gsd-to-plan` approval, the post-approval pipeline contract wins: do not ask, offer, menu, or pause for lavish. Use terminal progress/blocker templates only. If the user explicitly opted into lavish before or during the same session, a skill may render the relevant report without adding any new prompt; otherwise stay terminal-only.
- **Graceful terminal degradation.** Lavish is optional. Missing CLI, unavailable browser, failed lavish build, or unsuitable Fire gate degrades to the same content in terminal prose; never block, fail, or weaken the deliverable because the visual path is unavailable.

### Fire gate

Both checks must hold before **launching** `gsd-lavish`: (1) the artifact is a standalone, reviewable deliverable — not mid-conversation; and (2) the user gains from annotating it in a browser surface. When both hold and the deliverable is offer-eligible, asking whether to review it visually is mandatory (per "Offer-eligible deliverable → ask first" above); launching still waits for the user to accept. On ambiguity about whether to *launch*, choose terminal output. Outside the post-approval no-offer mode, the ask rides the existing surface — never a second prompt.

## Git/base/WIP/scratch mechanics

This is the canonical mechanics reference for `gsd`, `gsd-to-plan`, `gsd-executing-plans`, `gsd-handoff`, and `gsd-verify`. Skill files reference this section instead of repeating fallback ladders; local sections may name only the step they own.

- **Artifacts and branch names.** `<feature>` is the feature slug. `.scratch/<feature>/` lives at the git repo root and contains `proposal.toon`, `spec.toon`, conditionally `design.toon`, `plan.toon`, and `handoff-<n>.toon`. The WIP branch is `wip/<feature>`. `.scratch/` is git-ignored and machine-local by default; ensure the ignore entry before first scratch write.
- **Base detection.** `<base>` is the integration branch for the feature. Capture it before creating `wip/<feature>` with `BASE=$(git branch --show-current)`. If that is empty (detached HEAD) or already a `wip/*` branch, never self-reference the WIP branch; fall back in order to the `base` row in the latest handoff `settings[]` (pre-plan portable pause), `git symbolic-ref --short refs/remotes/origin/HEAD` with `origin/` stripped, `git config init.defaultBranch`, then `main`, checking for a non-empty value at each tier. Persist the chosen value as `base:<branch>` immediately after `schema:v1` in `plan.toon`; on resume, execution, and verify, `base:` is authoritative. Nano-fix has no branch/merge and needs no `<base>`.
- **WIP branch lifecycle.** `gsd-to-plan` writes `plan.toon` with `schema:v1` then `base:<base>`. `gsd-executing-plans` checks out an existing `wip/<feature>` on resume/rerun; otherwise it creates `wip/<feature>` from the authoritative `base:` (`git checkout -b wip/<feature> <base>`). If an old plan lacks `base:`, capture `<base>` with the canonical ladder and insert it immediately after `schema:v1` before continuing. During execution, commit only to `wip/<feature>`; never commit `<base>` until `gsd-verify` passes.
- **Scratch sync and strip.** Portable handoff is the only intentional path that tracks `.scratch/`: commit `.scratch/<feature>/` on `wip/<feature>` with `git add -f` and a pathspec'd handoff commit, then always `git push -u origin wip/<feature>` so code commits travel even when scratch is clean. Autosync uses that same path after handoff writes and task commits: sync scratch iff dirty, but push unconditionally. Review diffs exclude scratch (`':(exclude).scratch'`). Before the final squash commit, `gsd-verify` strips portable scratch with `git rm -r --cached --ignore-unmatch .scratch/<feature>` and confirms nothing under `.scratch/` is staged, so scratch never lands on `<base>`.
- **Final integration.** A passing WIP gate runs the required E2E check first, then squash-merges `wip/<feature>` to `<base>` as one commit using the exact local sequence owned by `gsd-verify`: checkout `<base>`, `git merge --squash wip/<feature>`, strip cached scratch, confirm staged scratch is empty, then `git commit`.
- **Conflict handling.** Merge/cherry-pick/apply conflicts are not code bugs. Locate conflicted files with `git status`, inspect markers with the `read` tool's `:conflicts` selector, and do not route to `gsd-diagnosing-bugs`; resolve with `edit` while removing `<<<<<<<`, `=======`, and `>>>>>>>`, then `git add` resolved files. If the conflict is too tangled to resolve mechanically, abort the operation when possible and stop with the canonical Blocker stop; do not force the merge. After resolving a stale-`<base>` rebase/merge, rerun `gsd-verify` and any required E2E before final integration.


## Feature cleanup

For an active feature, cleanup is automated via the squash result and scratch lifecycle terminal state machine in § Squash and cleanup result marker contract.
For manual drop/abandon of an active feature:
"abandon/drop/delete feature X" → confirm name → read `<base>` from plan.toon → `git checkout <base>` (can't delete a branch you're on) → `git branch -d wip/<feature>` (safe delete; only `-D` after explicit force-confirm if unmerged) → `rm -rf .scratch/<feature>/`. If `git status --short` is dirty, warn before proceeding.


## Squash and cleanup result marker contract

Once the squash integration passes all verify checks, the terminal state machine executes the squash, remote cleanup, local cleanup, and scratch folder cleanup:
1. **Pre-merge gate**: Before checkout/squash, bind the reviewed base OID, the local WIP branch ref `wip/<feature>` OID (WIP_TIP), the upstream remote tracking branch ref `refs/remotes/<remote>/wip/<feature>` OID when configured, and the reviewed non-scratch tree bytes/path set. Immediately recapture these values from the git repository right before checkout/squash and require them to match the bound values exactly; also, the initial upstream tip must equal WIP_TIP. Any mismatch halts execution, leaving base untouched, and writing no result marker or cleanup files.
2. **Squash commit**: Squash `wip/<feature>` to `<base>` branch. A pre-commit command failure (e.g. merge conflict or index failure) may clean only uncommitted squash state back to the still-unchanged base. Post-commit verification requires the new commit's parent to equal the old base OID and the non-scratch committed tree to be byte-identical to the reviewed WIP tree. Never run post-commit `reset --hard` or undo a successful merge commit. If a post-commit invariant or any later cleanup step fails, preserve base and report the actual residual state canonically.
3. **Remote branch deletion**: If a remote tracking branch is configured, push to delete it using exactly `git push --force-with-lease=refs/heads/wip/<feature>:<WIP_TIP> <remote> :refs/heads/wip/<feature>`. If no upstream remote tracking branch is configured, record `remote_branch` as `none`. If a remote expected-tip race or push failure occurs, do not delete the local branch; preserve all local and remote WIP refs, write a residual retained marker, and ask no scratch deletion question.
4. **Local branch deletion**: After the remote branch is deleted or is none, recapture the local WIP ref `wip/<feature>` and verify it remains unchanged (equal to WIP_TIP). If it has changed, do not delete it, and record `local_branch` as `residual`. Otherwise, delete it using `git branch -D wip/<feature>`. Any branch deletion command failure records the local branch as `residual`, otherwise `deleted`. Write the atomic canonical result marker `.scratch/<feature>/result.toon` with actual states and squash/wip OIDs. Never claim the remote branch is deleted when none.
5. **Scratch cleanup**:
   - On full success (merged, all cleanup successful), write `scratch: pending` in `result.toon` and prompt the user exactly once. If the user chooses delete, remove the entire `.scratch/<feature>/` folder. If they choose retain, atomically rewrite `result.toon` with `scratch: retained` and never prompt again.
   - On residual state (merged_cleanup_residual, cleanup failed), write `scratch: retained` in `result.toon` immediately with zero scratch prompt, allowing explicit cleanup only. A crash-visible `pending` state (where the agent exited before prompt completion) may resume only the one cleanup decision, never implementation.

The result marker file `result.toon` must strictly follow this exact schema and scalar order:
```
schema:v1
status:<merged|merged_cleanup_residual>
feature:<slug>
base:<branch>
commit:<squash-oid>
wip_tip:<reviewed-wip-oid>
local_branch:<none|deleted|residual>
remote_branch:<none|deleted|residual>
scratch:<pending|retained>
```
Status is merged|merged_cleanup_residual. Strict canonical UTF-8/LF/no blank/order/count/parse→serialize; validate marker fail-closed.
