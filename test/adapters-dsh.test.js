import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createBootstrap } from "../lib/gsd-bootstrap.mjs";
import { renderRecoveryCapsule, sessionOwnerToken, withSessionOwner } from "../lib/gsd-session-context.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Byte identity holds against an empty GSD home unless a case sets its own.
process.env.GSD_HOME = mkdtempSync(join(tmpdir(), "gsd-empty-home-"));
const HOOK = join(ROOT, "adapters", "dsh", "gsd-context.mjs");
// The emitted payload is the core's own render for the same inputs, byte for byte. The hook
// realpaths its own location, so the comparison root does too.
const CORE_ROOT = realpathSync(ROOT);
const owner = (session) => sessionOwnerToken("dsh", session);
const bootstrapFor = (session) => withSessionOwner(createBootstrap(CORE_ROOT), owner(session));

function run(payload, cwd, stateRoot, env = {}) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd,
    env: { ...process.env, TMPDIR: stateRoot, ...env },
  });
  assert.equal(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}

function parseContext(stdout, event) {
  assert.notEqual(stdout.trim(), "", "expected hook output");
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, event);
  return parsed.hookSpecificOutput.additionalContext;
}

function projectWithActiveFeature(owner = "none") {
  const project = mkdtempSync(join(tmpdir(), "gsd-dsh-project-"));
  const featureDir = join(project, ".scratch", "demo");
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, "plan.md"), "# Plan\n");
  writeFileSync(
    join(featureDir, "state.toon"),
    [
      "schema:v0.0.3",
      "feature:demo",
      `owner:${owner}`,
      "phase:approved",
      "next_action:start task",
      "plan_path:.scratch/demo/plan.md",
      "base_ref:main",
      "wip_branch:wip/demo",
      "last_green_task:none",
      "last_green_commit:none",
      "checkpoint_revision:1",
      "",
    ].join("\n"),
  );
  return project;
}

test("startup then compact deliver the bootstrap and the capsule, and a later prompt stays silent", () => {
  const project = projectWithActiveFeature("dsh-abc");
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-dsh-state-"));

  const startup = parseContext(
    run({ hook_event_name: "SessionStart", session_id: "abc", cwd: project, source: "startup" }, project, stateRoot),
    "SessionStart",
  );
  assert.equal(startup, bootstrapFor("abc"), "startup carries the core's exact bootstrap bytes, never a capsule");
  assert.doesNotMatch(startup, /\[GSD Recovery Capsule\]/);

  const compact = parseContext(
    run({ hook_event_name: "SessionStart", session_id: "abc", cwd: project, source: "compact" }, project, stateRoot),
    "SessionStart",
  );
  assert.equal(
    compact,
    `${bootstrapFor("abc")}\n\n${renderRecoveryCapsule(CORE_ROOT, project, "dsh-abc")}`,
    "compact is the core bootstrap then the core capsule, byte for byte",
  );

  const prompt = run(
    { hook_event_name: "UserPromptSubmit", session_id: "abc", cwd: project, prompt: "fix a typo" },
    project,
    stateRoot,
  );
  assert.equal(prompt, "", "an ordinary prompt after SessionStart emits nothing");
});

test("a resume SessionStart delivers the capsule only, and another session gets the bootstrap", () => {
  const project = projectWithActiveFeature(owner("d4"));
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-dsh-state-"));

  const resumed = parseContext(
    run({ hook_event_name: "SessionStart", session_id: "d4", cwd: project, source: "resume" }, project, stateRoot),
    "SessionStart",
  );
  assert.equal(resumed, renderRecoveryCapsule(CORE_ROOT, project, owner("d4")), "a resume renders the core capsule");

  const other = parseContext(
    run({ hook_event_name: "SessionStart", session_id: "d9", cwd: project, source: "resume" }, project, stateRoot),
    "SessionStart",
  );
  assert.equal(other, bootstrapFor("d9"), "a packet owned by another session yields no capsule");
});

test("UserPromptSubmit injects the bootstrap once when SessionStart did not run", () => {
  const project = mkdtempSync(join(tmpdir(), "gsd-dsh-cwd-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-dsh-state-"));
  // dsh-tui sends a bare uuid and headless sends `session-<uuid>`; both are opaque.
  const session = "session-0b6f5c1e-3f7a-4d2e-9a54-6a1d2c3e4f50";

  const first = parseContext(
    run({ hook_event_name: "UserPromptSubmit", session_id: session, cwd: project, prompt: "build X" }, project, stateRoot),
    "UserPromptSubmit",
  );
  assert.equal(first, bootstrapFor(session), "the fallback injects the same core bytes as SessionStart");

  const second = run(
    { hook_event_name: "UserPromptSubmit", session_id: session, cwd: project, prompt: "more" },
    project,
    stateRoot,
  );
  assert.equal(second, "", "the bootstrap is not injected twice");
});

// dsh gets no sub-agent profiles: `gsd config` hosts stay claude|codex|omp.
test("user sub-agent profiles for other hosts never change the dsh bootstrap", () => {
  const project = mkdtempSync(join(tmpdir(), "gsd-dsh-cwd-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-dsh-state-"));
  const home = mkdtempSync(join(tmpdir(), "gsd-dsh-home-"));
  writeFileSync(
    join(home, "settings.json"),
    JSON.stringify({
      version: 1,
      profiles: { scout: { codex: "gpt-x", claude: "haiku" }, worker: { codex: "gpt-y", claude: "sonnet" } },
    }),
  );

  const injected = parseContext(
    run(
      { hook_event_name: "SessionStart", session_id: "s1", cwd: project, source: "startup" },
      project,
      stateRoot,
      { GSD_HOME: home },
    ),
    "SessionStart",
  );
  assert.equal(injected, bootstrapFor("s1"), "the dsh bootstrap is the bare core render");
  assert.doesNotMatch(injected, /Sub-agent profiles/);
});
