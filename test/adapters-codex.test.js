import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createBootstrap, sanitizeBootstrapError } from "../lib/gsd-bootstrap.mjs";
import { renderRecoveryCapsule, sessionOwnerToken, withSessionOwner } from "../lib/gsd-session-context.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Byte identity holds against an empty GSD home: user sub-agent profiles in the real
// ~/.gsd/settings.json would otherwise append to the bootstrap every hook emits.
process.env.GSD_HOME = mkdtempSync(join(tmpdir(), "gsd-empty-home-"));
const HOOK = join(ROOT, "adapters", "codex", "gsd-context.mjs");
// Same contract as every adapter: the emitted payload is the core's own render for the same
// inputs, byte for byte. The hook realpaths its own location, so the comparison root does too.
const CORE_ROOT = realpathSync(ROOT);
const owner = (session) => sessionOwnerToken("codex", session);
const bootstrapFor = (session) => withSessionOwner(createBootstrap(CORE_ROOT), owner(session));

function run(payload, cwd, stateRoot) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd,
    env: { ...process.env, TMPDIR: stateRoot },
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
  const project = mkdtempSync(join(tmpdir(), "gsd-codex-project-"));
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

test("SessionStart injects the bootstrap once and ordinary prompts stay silent", () => {
  const project = mkdtempSync(join(tmpdir(), "gsd-codex-cwd-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-codex-state-"));

  const injected = parseContext(
    run(
      { hook_event_name: "SessionStart", session_id: "c1", cwd: project, source: "startup" },
      project,
      stateRoot,
    ),
    "SessionStart",
  );
  assert.equal(
    injected,
    bootstrapFor("c1"),
    "the hook injects the core's exact bootstrap bytes, never a rebuilt or decorated copy",
  );

  const prompt = run(
    { hook_event_name: "UserPromptSubmit", session_id: "c1", cwd: project, prompt: "fix a typo" },
    project,
    stateRoot,
  );
  assert.equal(prompt, "", "an ordinary prompt after SessionStart emits nothing");
});

// The same boundary as the Claude Code adapter: a fresh start carries the bootstrap even
// when the workspace has active work, because only a compaction or resume has a request to
// recover; an omitted source is the same startup case.
test("a fresh start with active work still delivers the bootstrap, never a capsule", () => {
  const project = projectWithActiveFeature();
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-codex-state-"));

  const first = parseContext(
    run({ hook_event_name: "SessionStart", session_id: "c5", cwd: project }, project, stateRoot),
    "SessionStart",
  );
  assert.equal(first, bootstrapFor("c5"), "a startup source carries the bootstrap bytes");
  assert.doesNotMatch(first, /\[GSD Recovery Capsule\]/, "a capsule is compaction or resume only");

  const explicit = parseContext(
    run(
      { hook_event_name: "SessionStart", session_id: "c6", cwd: project, source: "startup" },
      project,
      stateRoot,
    ),
    "SessionStart",
  );
  assert.equal(explicit, bootstrapFor("c6"), "an explicit startup source is the same");
});

test("UserPromptSubmit injects the bootstrap once when SessionStart did not run", () => {
  const project = mkdtempSync(join(tmpdir(), "gsd-codex-cwd-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-codex-state-"));

  const first = parseContext(
    run(
      { hook_event_name: "UserPromptSubmit", session_id: "c2", cwd: project, prompt: "build X" },
      project,
      stateRoot,
    ),
    "UserPromptSubmit",
  );
  assert.equal(
    first,
    bootstrapFor("c2"),
    "the fallback path injects the same core bytes as SessionStart",
  );

  const second = run(
    { hook_event_name: "UserPromptSubmit", session_id: "c2", cwd: project, prompt: "more" },
    project,
    stateRoot,
  );
  assert.equal(second, "", "the bootstrap is not injected twice");
});

// Compaction drops hook-injected context along with the transcript, so the bootstrap that
// carried routing and the skill catalog must come back with the capsule, not be replaced by it.
test("a compact SessionStart delivers the bootstrap followed by the recovery capsule", () => {
  const project = projectWithActiveFeature(owner("c3"));
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-codex-state-"));

  const after = parseContext(
    run(
      { hook_event_name: "SessionStart", session_id: "c3", cwd: project, source: "compact" },
      project,
      stateRoot,
    ),
    "SessionStart",
  );
  const coreCapsule = renderRecoveryCapsule(CORE_ROOT, project, owner("c3"));
  assert.equal(
    after,
    `${bootstrapFor("c3")}\n\n${coreCapsule}`,
    "the compact payload is the core bootstrap then the core capsule, byte for byte",
  );
});

// A resume replays the transcript, so a session that already got the bootstrap gets only what
// is new: the capsule, or nothing. A session the marker does not know gets the full set.
test("a resume SessionStart after a delivered bootstrap emits the capsule or nothing", () => {
  const project = projectWithActiveFeature(owner("c4"));
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-codex-state-"));
  const start = (session_id, source) =>
    run({ hook_event_name: "SessionStart", session_id, cwd: project, source }, project, stateRoot);

  start("c4", "startup");
  assert.equal(
    parseContext(start("c4", "resume"), "SessionStart"),
    renderRecoveryCapsule(CORE_ROOT, project, owner("c4")),
    "a resume renders the core capsule, byte for byte",
  );

  start("c9", "startup");
  assert.equal(start("c9", "resume"), "", "a resumed session owning no packet already holds its bootstrap");

  // A session this machine never bootstrapped has nothing to replay.
  assert.equal(
    parseContext(start("c4-elsewhere", "resume"), "SessionStart"),
    bootstrapFor("c4-elsewhere"),
    "a packet owned by another session yields no capsule",
  );
  const unknownOwner = projectWithActiveFeature(owner("c7"));
  assert.equal(
    parseContext(
      run({ hook_event_name: "SessionStart", session_id: "c7", cwd: unknownOwner, source: "resume" }, unknownOwner, stateRoot),
      "SessionStart",
    ),
    `${bootstrapFor("c7")}\n\n${renderRecoveryCapsule(CORE_ROOT, unknownOwner, owner("c7"))}`,
  );
});

// A resume after `gsd config set` changed a sub-agent model re-sends the bootstrap, since the
// transcript still holds the old model; an unchanged one stays out.
test("a resume after the codex profiles changed re-sends the bootstrap with the new model", () => {
  const project = mkdtempSync(join(tmpdir(), "gsd-codex-cwd-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-codex-state-"));
  const home = mkdtempSync(join(tmpdir(), "gsd-codex-home-"));
  const setScout = (model) =>
    writeFileSync(join(home, "settings.json"), JSON.stringify({ version: 1, profiles: { scout: { codex: model } } }));
  const start = (source) => run({ hook_event_name: "SessionStart", session_id: "c-p", cwd: project, source }, project, stateRoot);
  const previous = process.env.GSD_HOME;
  process.env.GSD_HOME = home;
  try {
    setScout("old-model");
    assert.match(parseContext(start("startup"), "SessionStart"), /scout `old-model`/);
    assert.equal(start("resume"), "", "an unchanged bootstrap is not sent again");
    setScout("new-model");
    const resumed = parseContext(start("resume"), "SessionStart");
    assert.match(resumed, /scout `new-model`/);
    assert.match(resumed, /^<GSD_BOOTSTRAP>/);
    assert.equal(start("resume"), "", "the re-sent bootstrap is now the delivered one");
  } finally {
    process.env.GSD_HOME = previous;
  }
});

// Contract rule 4, the Codex side of the same check as the Claude Code adapter: a
// broken core must surface the core's own diagnostic, not a host-adapted version.
test("a broken core fails closed with the core's own diagnostic, never a host rewrite", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "gsd-codex-broken-"));
  const hookDir = join(sandbox, "adapters", "codex");
  mkdirSync(hookDir, { recursive: true });
  copyFileSync(HOOK, join(hookDir, "gsd-context.mjs"));
  symlinkSync(join(ROOT, "lib"), join(sandbox, "lib"), "dir");
  const brokenHook = join(hookDir, "gsd-context.mjs");

  const project = mkdtempSync(join(tmpdir(), "gsd-codex-cwd-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-codex-state-"));
  const result = spawnSync(process.execPath, [brokenHook], {
    input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "broken", cwd: project }),
    encoding: "utf8",
    cwd: project,
    env: { ...process.env, TMPDIR: stateRoot },
  });
  assert.equal(result.status, 0, `a broken core must leave the host running: ${result.stderr}`);

  const context = parseContext(result.stdout, "SessionStart");
  const shape = context.match(
    /^\[GSD bootstrap unavailable\] ([\s\S]*)\. Do not improvise a GSD workflow; continue with the host's ordinary behavior\.$/,
  );
  assert.ok(shape, `the hook must emit the core's fail-closed sentence, got: ${context}`);
  assert.equal(
    context,
    sanitizeBootstrapError(new Error(shape[1])),
    "the diagnostic is the core sanitizer's exact bytes, not a host-side rewrite",
  );
  assert.doesNotMatch(context, /\bOMP\b|Claude|Codex/, "the shared core diagnostic names no host");
});
