# GSD host adapters

GSD keeps one harness-generic core and one thin adapter per host. The core is
`lib/` plus `skills/`: it renders the session bootstrap, the recovery capsule, and
the current-request note, and it names no host identifier. Everything that names a
host's events, configuration, binaries, or feature flags lives in exactly one
directory under `adapters/`. This is the seam decision 0012 extracts and decision
0009 §1 still guards.

Adding a host means adding one directory here. It must never edit the core or a
sibling adapter.

## Adapters

| Adapter | Status | Coupling surface |
| --- | --- | --- |
| `adapters/plugin/` | Shipped | Cross-host CLI, generated plugin bundle, and local marketplace |
| `adapters/omp/` | Shipped (M7) | OMP session lifecycle events, context injection, compaction hooks, `sendMessage`, task isolation |
| `adapters/claude-code/` | Shipped (M1) | Claude Code lifecycle hooks and `additionalContext` injection |
| `adapters/codex/` | Shipped (M2) | Codex hooks and `additionalContext` injection |

The OMP adapter body is `adapters/omp/gsd-context.js` and its public types are
`adapters/omp/gsd-context.d.ts`. The `extensions/gsd-context.js` and
`extensions/gsd-context.d.ts` paths stay as thin re-exports for importers while
every host-specific identifier lives under `adapters/`.

## Plugin packaging

The unified CLI in `bin/gsd.mjs` builds one self-contained local bundle through
`adapters/plugin/gsd-plugin-packager.mjs`, defaulting to `~/.gsd/marketplace/gsd`. The bundle
keeps `lib/` at its root, canonical skills and tools under `core/`, and only the
visible skill catalog in the host-facing `skills/` directory. A `.gsd-plugin`
marker tells each copied adapter to resolve its canonical root from `core/`, so
hidden runtime skills never enter host skill discovery.

Each host receives its native registration:

| Host | Bundle surface | Native install |
| --- | --- | --- |
| OMP | `package.json` with `omp.extensions` | `omp plugin link <bundle>` |
| Claude Code | `.claude-plugin/plugin.json`, `skills/`, `hooks/claude.json` | local marketplace plus `claude plugin install` |
| Codex | `.codex-plugin/plugin.json`, `skills/`, `hooks/codex.json` (no root `plugin.json`, which Codex would prefer) | local marketplace plus `codex plugin add` |

The local marketplace is generated beside the bundle and named `gsd-local`.
Uninstall delegates only to each host's native plugin uninstall command. The CLI
removes the generated bundle after no recorded agent still uses it and never
inspects unrelated host files.

### Sub-agent profiles

`gsd config set <profile>.<host> <value>` records user choices in
`<GSD home>/settings.json` (`GSD_HOME`, default `~/.gsd`); `gsd config get` and
`gsd config list` read them back, and uninstall keeps the file. Profiles are `scout`
(read-only exploration) and `worker` (dispatched implementation). The plugin ships no model names: an absent file, or a host with
no values, leaves the bootstrap byte-identical and every spawn on the host default.
Otherwise each adapter appends a `## Sub-agent profiles` block naming that host's
values inside the bootstrap, and the skills pass them at spawn time. An invalid file
never blocks the bootstrap; `gsd config list` reports it.

## Capability map

Every adapter declares which host feature it uses for each GSD need. A need a host
cannot satisfy takes the named fallback; it is never faked.

| GSD need | OMP | Claude Code | Codex |
| --- | --- | --- | --- |
| Session bootstrap at session start | Message injected at the `context` boundary | `SessionStart` hook `hookSpecificOutput.additionalContext` | `SessionStart` hook `hookSpecificOutput.additionalContext` |
| Recovery capsule across compaction | Capsule staged on the pre-compaction hook, delivered next turn after compaction | `SessionStart` with `source: "compact"` or `"resume"`, which fires before the next request | `SessionStart` with `source: "compact"` or `"resume"`, which fires before the next request |
| Current-request preservation | Extracted from the pre-compaction message list | The prompt stashed on `UserPromptSubmit` and attached to the capsule | Not needed: the live next prompt follows the continuing `SessionStart` |
| Plan mode | Read-only plan mode with a plan todo list; the canonical `plan.md` is the only authority | Presentation only; a host plan file beside `plan.md` asks one question and never binds | `/plan` toggles host plan mode; the canonical `plan.md` is the only authority |
| Goals | None; the canonical `plan.md` acceptance criteria are the goal record | `/goal` runs a host completion condition judged by a separate evaluator; GSD never treats it as the goal record | `/goal` runs a persistent host goal with its own completion criteria; GSD never treats it as the goal record |
| Sub-agent implementation | One task per isolated sub-agent, serial fallback | Agent-tool subagents with the host's default agent; GSD ships no agent definitions | `spawn_agent` threads collected by the main thread; GSD ships no agent definitions |
| Isolated task workspaces | Per-task isolated workspaces with `merge: branch` | Subagent `isolation` when available, else serial in plan order | Per-agent `sandbox_mode`; a `Worktree` environment isolates a chat, while subagents share the parent environment, so a wave without a per-task workspace runs serially |
| Sub-agent profiles | Values name OMP agents, passed as the task tool `agent`; each agent's model role picks the model | Agent-tool model aliases (`sonnet`, `opus`, `haiku`, ...) passed as the Agent tool `model` | Model ids passed as `spawn_agent` `model` |

There is no reviewer sub-agent: the session owner reviews the whole diff itself in the
`gsd-verify` terminal gate, on every host.

Codex spills `additionalContext` larger than a per-handler budget into a saved file
plus a head-and-tail preview. The Codex adapter pins `additionalContextLimit` above
the rendered bootstrap's size, so the bootstrap and recovery capsule arrive whole.
Claude Code names no equivalent per-message cap, so its adapter emits the same bytes
without one.

Subagent contracts come from Claude Code sub-agents
<https://code.claude.com/docs/en/sub-agents> (the Agent tool, and `isolation: worktree`
for an isolated repository copy) and Codex subagents
<https://learn.chatgpt.com/docs/agent-configuration/subagents> (spawned threads that
inherit the parent's sandbox, permission, and environment). Codex `/plan` and `/goal` are defined in the slash
commands reference <https://learn.chatgpt.com/docs/reference/slash-commands>, and
the Claude Code `/goal` completion condition in
<https://code.claude.com/docs/en/goal>.

Official host references for these contracts: Claude Code hooks
<https://code.claude.com/docs/en/hooks> (`SessionStart` matched on `source` with
`compact` and `resume` values, and `hookSpecificOutput.additionalContext`) and Codex
hooks <https://learn.chatgpt.com/docs/hooks> (`hooks.json`, the same
`additionalContext` shape, and `additionalContextLimit` whose 2,500-token default the
adapter raises so the bootstrap is not spilled into a saved file plus preview). Codex
also requires its native plugin trust flow before a hook runs; GSD leaves that
requirement to the host instead of assuming the hook is live.

## Depth ladder mapping

Triage picks a depth from ambiguity, blast radius, reversibility, and acceptance clarity,
as canon `REFERENCE.md` § Triage and depth ladder defines. Each adapter maps that depth
onto the host features above, and never fakes a feature the host lacks:

| Depth | OMP | Claude Code | Codex |
| --- | --- | --- | --- |
| `direct` | No skill, artifact, or host feature: the ordinary prompt is answered as-is | Same | Same |
| `quick` | A direct edit plus a focused test; no packet, plan, or commit | Same | Same |
| `plan` | Canonical `plan.md`; the host plan and its todo list stay display-only | Plan mode is presentation-only, so a host plan file beside `plan.md` asks one question and never binds | Canonical `plan.md` only; a host `/plan` artifact stays non-authoritative |

So `direct` and `quick` add no host-specific setup on any host; only `plan` reaches
dispatch and isolation features. A feature too large for one plan splits into parts,
each its own `plan`.

Host plan and goal features are affordances, not authority (decision 0017). The
adapter names the affordance in the recommendation it hands the owner, and the host
artifact stays context: OMP plan mode and its plan todo list stay read-only display
state, Codex recommends `/plan` to shape a multi-step change, Claude Code plan mode
is presentation that lifecycle work leaves first, and the Claude Code and Codex
`/goal` completion condition is judged by a separate evaluator rather than by the
work it gates. On every host `plan.md` and the deterministic
gates remain the only definition of done, and no host plan or goal artifact is ever
lifecycle state: triage still classifies the prompt.

OMP rows follow the host's own CLI help (`omp --help`), which names the read-only
plan mode, the plan todo list, `omp agents`, and `omp worktree`; Codex rows follow
the subagent and slash-command pages cited above.

## Adapter contract

An adapter must:

1. Inject the exact bytes the core renders; never paraphrase or rebuild them.
2. Deliver the bootstrap once per session and the capsule once after each
   compaction, using the host's own marker or a stash file keyed by session id.
3. Keep per-turn token cost at zero for ordinary prompts: emit nothing when the
   bootstrap is already present and no capsule is pending.
4. Fail closed with a visible diagnostic and leave the host's ordinary behavior
   intact when a payload cannot be validated.
5. Name the fallback for every capability the host lacks.
6. Publish exactly the core's visible skill catalog into the host's skill
   surface; the hidden `gsd` master and hidden helper skills never
   appear there.

Rule 1 is machine-checked, not aspirational. `test/gsd-context-extension.test.js`
(OMP), `test/adapters-claude-code.test.js`, and `test/adapters-codex.test.js`
compare every injected payload against the same root's `createBootstrap` or
`renderRecoveryCapsule` output, so a host-side paraphrase, prefix, or stray
newline fails the suite instead of silently reaching the model.

Rule 4 is pinned the same way: the Claude Code and Codex tests copy the hook into a
sandbox with no core, force `createBootstrap` to throw, and require the emitted
diagnostic to equal `sanitizeBootstrapError`'s own bytes. An adapter cannot reword,
localize, or de-brand the shared failure text any more than it can reword the
bootstrap.

The plugin bundle is checked end to end too: `test/gsd-plugin-packager.test.js`
builds the exact bundle layout and runs a bundled hook, requiring the core's
bootstrap bytes back. A quoting, root-derivation, or manifest bug fails there
instead of in a live session.
