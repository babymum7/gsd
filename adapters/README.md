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
| `adapters/omp/` | Shipped (M7) | OMP session lifecycle events, context injection, compaction hooks, `sendMessage`, task isolation |
| `adapters/claude-code/` | Shipped (M1) | Claude Code lifecycle hooks, `additionalContext` injection, skills and subagent files |
| `adapters/codex/` | Shipped (M2) | Codex `hooks.json`, `AGENTS.md`, `.codex/agents/*.toml`, `~/.agents/skills` |

The OMP adapter body is `adapters/omp/gsd-context.js`, its public types are
`adapters/omp/gsd-context.d.ts`, and its installer is `adapters/omp/install.sh`.
The `extensions/gsd-context.js` and `extensions/gsd-context.d.ts` paths stay as
thin re-exports, and the root `install.sh` stays as a thin entry that runs the
adapter installer, so the OMP entry paths are unchanged while every host-specific
identifier lives under `adapters/`.

## Capability map

Every adapter declares which host feature it uses for each GSD need. A need a host
cannot satisfy takes the named fallback; it is never faked.

| GSD need | OMP | Claude Code | Codex |
| --- | --- | --- | --- |
| Session bootstrap at session start | Message injected at the `context` boundary | `SessionStart` hook `hookSpecificOutput.additionalContext` | `SessionStart` hook `hookSpecificOutput.additionalContext` |
| Recovery capsule across compaction | Capsule staged on the pre-compaction hook, delivered next turn after compaction | `SessionStart` with `source: "compact"` or `"resume"`, which fires before the next request | `SessionStart` with `source: "compact"` or `"resume"`, which fires before the next request |
| Current-request preservation | Extracted from the pre-compaction message list | The prompt stashed on `UserPromptSubmit` and attached to the capsule | Not needed: the live next prompt follows the continuing `SessionStart` |
| Plan mode | Read-only plan mode with a plan todo list; the canonical `plan.md` is the only authority | Presentation only; a host plan file beside `plan.md` asks one question and never binds | `/plan` toggles host plan mode; the canonical `plan.md` is the only authority |
| Goals | None; milestone ledger is the goal record | `/goal` runs a host completion condition judged by a separate evaluator; GSD never treats it as the goal record | `/goal` runs a persistent host goal with its own completion criteria; GSD never treats it as the goal record |
| Sub-agent implementation | One task per isolated sub-agent, serial fallback | Agent-tool subagents from `.claude/agents/*.md` | Spawned agent threads from `.codex/agents/*.toml`, collected by the main thread |
| Isolated task workspaces | Per-task isolated workspaces with `merge: branch` | Subagent `isolation` when available, else serial in plan order | Per-agent `sandbox_mode`; a `Worktree` environment isolates a chat, while subagents share the parent environment, so a wave without a per-task workspace runs serially |
| Independent review | One isolated read-only reviewer sub-agent task carrying the `gsd-verify` standalone-review brief | `gsd-reviewer` subagent (read-only) | `gsd-reviewer` subagent (`sandbox_mode = "read-only"`) |

A reconciled wave of two or more tasks runs one independent read-only review of the
merged diff, as canon `REFERENCE.md` § Wave dispatch requires. The review is
advisory: the deterministic gates stay the terminal authority, and a finding blocks
only by citing bound plan text or a red deterministic check. Each adapter uses the
host feature in its row above and the named fallback when the host has none: Claude
Code and Codex publish a `gsd-reviewer` definition whose read-only guarantee the host
enforces, OMP dispatches one isolated sub-agent task carrying the same `gsd-verify`
standalone-review brief, and a host that can do neither falls back to the owner
running that standalone review.

Codex spills `additionalContext` larger than a per-handler budget into a saved file
plus a head-and-tail preview. The Codex adapter pins `additionalContextLimit` above
the rendered bootstrap's size, so the bootstrap and recovery capsule arrive whole.
Claude Code names no equivalent per-message cap, so its adapter emits the same bytes
without one.

Subagent contracts come from Claude Code sub-agents
<https://code.claude.com/docs/en/sub-agents> (the Agent tool, and `isolation: worktree`
for an isolated repository copy) and Codex subagents
<https://learn.chatgpt.com/docs/agent-configuration/subagents> (custom agents in
`.codex/agents/*.toml` that inherit the parent's sandbox, permission, and environment
unless the file overrides them). Codex `/plan` and `/goal` are defined in the slash
commands reference <https://learn.chatgpt.com/docs/reference/slash-commands>, and
the Claude Code `/goal` completion condition in
<https://code.claude.com/docs/en/goal>.

Official host references for these contracts: Claude Code hooks
<https://code.claude.com/docs/en/hooks> (`SessionStart` matched on `source` with
`compact` and `resume` values, and `hookSpecificOutput.additionalContext`) and Codex
hooks <https://learn.chatgpt.com/docs/hooks> (`hooks.json`, the same
`additionalContext` shape, and `additionalContextLimit` whose 2,500-token default the
adapter raises so the bootstrap is not spilled into a saved file plus preview). Codex
also requires a non-managed hook to be reviewed and trusted before it runs; the Codex
installer reports that requirement instead of assuming the hook is live.

## Depth ladder mapping

Triage picks a depth from ambiguity, blast radius, reversibility, and acceptance clarity,
as canon `REFERENCE.md` § Triage and depth ladder defines. Each adapter maps that depth
onto the host features above, and never fakes a feature the host lacks:

| Depth | OMP | Claude Code | Codex |
| --- | --- | --- | --- |
| `direct` | No skill, artifact, or host feature: the ordinary prompt is answered as-is | Same | Same |
| `quick` | The session-owned Quick-fix plan and its `gsd-verify` gate | Same | Same |
| `plan` | Canonical `plan.md`; the host plan and its todo list stay display-only | Plan mode is presentation-only, so a host plan file beside `plan.md` asks one question and never binds | Canonical `plan.md` only; a host `/plan` artifact stays non-authoritative |
| `milestone` | Canonical `plan.md` plus the milestone ledger | Same; the host `/goal` evaluator is not the goal record | Same; the host `/goal` runs a persistent goal of its own, and the ledger is the goal record |

So `direct` and `quick` add no host-specific setup on any host; only `plan` and
`milestone` reach dispatch, isolation, milestone, and review features.

Host plan and goal features are affordances, not authority (decision 0017). The
adapter names the affordance in the recommendation it hands the owner, and the host
artifact stays context: OMP plan mode and its plan todo list stay read-only display
state, Codex recommends `/plan` to shape a multi-step change, Claude Code plan mode
is presentation that lifecycle work leaves first, and the Claude Code and Codex
`/goal` completion condition is judged by a separate evaluator rather than by the
work it gates. On every host `plan.md`, the milestone ledger, and the deterministic
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
   surface; the hidden `gsd` master and `gsd-ponytail` context never appear
   there.

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

The installers are checked end to end too: `test/adapters-claude-code-install.test.js`
and `test/adapters-codex-install.test.js` run the exact command each installer
registered, from a copied checkout whose path contains a space, and require the core's
bootstrap bytes back. A quoting or root-derivation bug fails there instead of in a
live session.
