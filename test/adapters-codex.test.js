import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createBootstrap, sanitizeBootstrapError } from "../lib/gsd-bootstrap.mjs";
import { renderRecoveryCapsule } from "../lib/gsd-session-context.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, "adapters", "codex", "gsd-context.mjs");
// Same contract as every adapter: the emitted payload is the core's own render for the same
// inputs, byte for byte. The hook realpaths its own location, so the comparison root does too.
const CORE_ROOT = realpathSync(ROOT);

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

function projectWithActiveFeature() {
  const project = mkdtempSync(join(tmpdir(), "gsd-codex-project-"));
  const featureDir = join(project, ".scratch", "demo");
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, "plan.md"), "# Plan\n");
  writeFileSync(
    join(featureDir, "state.toon"),
    [
      "schema:v4",
      "feature:demo",
      "phase:approved",
      "next_action:start task",
      "plan_path:.scratch/demo/plan.md",
      `plan_sha256:${"a".repeat(64)}`,
      "base_ref:main",
      "wip_branch:wip/demo",
      "last_green_task:none",
      "last_green_commit:none",
      "autosync:none",
      "cleanup_preference:none",
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
    createBootstrap(CORE_ROOT),
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
  assert.equal(first, createBootstrap(CORE_ROOT), "a startup source carries the bootstrap bytes");
  assert.doesNotMatch(first, /\[GSD Recovery Capsule\]/, "a capsule is compaction or resume only");

  const explicit = parseContext(
    run(
      { hook_event_name: "SessionStart", session_id: "c6", cwd: project, source: "startup" },
      project,
      stateRoot,
    ),
    "SessionStart",
  );
  assert.equal(explicit, createBootstrap(CORE_ROOT), "an explicit startup source is the same");
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
    createBootstrap(CORE_ROOT),
    "the fallback path injects the same core bytes as SessionStart",
  );

  const second = run(
    { hook_event_name: "UserPromptSubmit", session_id: "c2", cwd: project, prompt: "more" },
    project,
    stateRoot,
  );
  assert.equal(second, "", "the bootstrap is not injected twice");
});

test("a compact SessionStart delivers the recovery capsule instead of the bootstrap", () => {
  const project = projectWithActiveFeature();
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-codex-state-"));

  const after = parseContext(
    run(
      { hook_event_name: "SessionStart", session_id: "c3", cwd: project, source: "compact" },
      project,
      stateRoot,
    ),
    "SessionStart",
  );
  const coreCapsule = renderRecoveryCapsule(CORE_ROOT, project);
  assert.equal(
    after,
    coreCapsule,
    "the compact payload is the core capsule, byte for byte, and never the bootstrap",
  );
  assert.doesNotMatch(after, /<GSD_BOOTSTRAP>/);
});

test("a resume SessionStart refreshes the recovery capsule when work is active", () => {
  const project = projectWithActiveFeature();
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-codex-state-"));

  const resumed = parseContext(
    run(
      { hook_event_name: "SessionStart", session_id: "c4", cwd: project, source: "resume" },
      project,
      stateRoot,
    ),
    "SessionStart",
  );
  assert.equal(
    resumed,
    renderRecoveryCapsule(CORE_ROOT, project),
    "a resume renders the core capsule, byte for byte",
  );
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
