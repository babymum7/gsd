# Agent instructions

GSD Core: the GSD workflow skills, their contract validators, and one session adapter per
host (`adapters/README.md` lists them). Bun, ES modules, no runtime dependencies.

## Map

- `skills/`: the skills, one `SKILL.md` each; `skills/gsd/REFERENCE.md` is the canonical reference.
- `lib/`: host-free core (grammars, state, bootstrap); `tools/`: the CLIs over it.
- `adapters/<host>/`: host glue; read `adapters/README.md` before changing an adapter.
- `bin/gsd.mjs`: the plugin CLI; `extensions/`: stable re-exports of the OMP adapter.
- `test/`: Bun tests; `test/eval/`: benchmark fixtures and reports.
- `docs/domain/`, `docs/decisions/`: see the sections below.
- Full layout: `README.md` § State and repository layout.

## Check

Check: `bun run test && bun run lint`

- Format a file: `bun run format -- <path>`. Install (owner only): `bun bin/gsd.mjs install --agent all`.

## Where facts go

- Product behaviour lives in `docs/domain/`, settled choices in `docs/decisions/`, usage and
  layout in `README.md`, adapter details in `adapters/README.md`, skill rules in `skills/`.
- Never put feature behaviour, current state or growing lists here; this file changes only
  when a policy changes.
- The `<!-- gsd:… -->` sections below are upserted by GSD's own skills: keep their headings
  and text as the skills write them.

## Domain documentation

<!-- gsd:domain-documentation -->
- Treat `docs/domain/index.md` and its mapped shards as concise descriptions of current production business behavior, not implementation plans or architecture journals.
- For every semantic change, update the affected `docs/domain/<scope>.md` in the same owning task. If there is no domain impact, record a concrete `No domain impact` justification in the plan.
- Existing domain docs are navigation hints; production code, schemas, contracts, and tests are authoritative when they conflict. Resolve drift before completion.
- When `docs/domain/index.md` exists, read only affected mapped contexts and do not propose a broad codebase/domain scan. A broad bootstrap may be offered only when the index is absent; declining it never skips required feature-scoped context documentation.
- Upsert this canonical `## Domain documentation` section once. Preserve unrelated instructions and never append a duplicate section.

## Decisions

<!-- gsd:decisions -->
- Treat `docs/decisions/NNNN-slug.md` as durable records of load-bearing decisions settled during convergence; read the relevant record before re-litigating a settled choice.
- A decision record may precede implementation; its `Status` is `Accepted`, `Rejected`, or `Superseded by NNNN`, and its non-empty `## Decision` section states the locked choice.

## Design

<!-- gsd:design -->
- Treat `docs/design/NNNN-slug.md` as durable records of UI/UX decisions settled during execution; read the relevant record before changing an accepted interaction.
- Measurement is optional; a record's mandatory part is its numbered title, `Status`, `Date`, and non-empty `## Decision` section.

## Code quality

<!-- gsd:code-quality -->
- Code in `lib/` never prints, reads stdin, or calls `process.exit`; output belongs to `tools/`, `bin/` and `adapters/`.
- Host glue lives in `adapters/<host>/`.
- No file in `lib/`, `tools/` or `adapters/` passes 1,500 lines; split it by concern before adding to it.
- A name, size, or truncation limit is a named constant in the module that owns it, never a second literal.
- Homes and config directories come from `GSD_HOME`, `DSH_HOME`, `OPENCODE_CONFIG_DIR`, or `XDG_CONFIG_HOME`, falling back to `os.homedir()`; code holds no user paths, hosts, or secrets.
- `adapters/*/gsd-context.*` and the `lib/` code they call make no network call and start no process other than `git`.
- A new refusal a tool prints names what is missing and the command or key that fixes it.
- Tests live in `test/<module>.test.js`, drive tools as `bun <tool>` subprocesses and modules through their exports, and write only under `tmpdir()`.
- Extend the test that already covers a behavior instead of adding a second one.
- The owner runs `bun bin/gsd.mjs install --agent all`, `bun run test` and `bun run lint` by hand; they keep their names and behavior.
- Every commit on `main` passes `bun run test` and `bun run lint`.
