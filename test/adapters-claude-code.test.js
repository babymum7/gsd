import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createBootstrap, sanitizeBootstrapError } from "../lib/gsd-bootstrap.mjs";
import { renderRecoveryCapsule, withCurrentRequest } from "../lib/gsd-session-context.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, "adapters", "claude-code", "gsd-context.mjs");
// The adapter contract is byte identity, not resemblance: every payload the hook emits must
// be the core's own render for the same inputs. The hook resolves its root through
// realpathSync, so the comparison root is normalized the same way.
const CORE_ROOT = realpathSync(ROOT);

// Each spawn gets a private temp root so the adapter's session markers never leak
// between cases; os.tmpdir() honors TMPDIR on the platforms this repo targets.
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
  const project = mkdtempSync(join(tmpdir(), "gsd-cc-project-"));
  const featureDir = join(project, ".scratch", "demo");
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, "plan.md"), "# Plan\n");
  writeFileSync(
    join(featureDir, "state.toon"),
    [
      "schema:v0.0.1",
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

test("SessionStart injects the shared bootstrap exactly once per session", () => {
  const project = mkdtempSync(join(tmpdir(), "gsd-cc-cwd-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-cc-state-"));

  const first = parseContext(
    run({ hook_event_name: "SessionStart", session_id: "s1", cwd: project }, project, stateRoot),
    "SessionStart",
  );
  assert.equal(
    first,
    createBootstrap(CORE_ROOT),
    "the hook injects the core's exact bootstrap bytes, never a rebuilt or decorated copy",
  );

  // A second prompt in the same session must not re-inject the large payload.
  const prompt = run(
    { hook_event_name: "UserPromptSubmit", session_id: "s1", cwd: project, prompt: "fix a typo" },
    project,
    stateRoot,
  );
  assert.equal(prompt, "", "an ordinary prompt after bootstrap emits nothing");
});

// A capsule belongs to compaction and resume. A fresh start already has the transcript and
// no preserved request, so it must carry the bootstrap even when the workspace has active
// work; an omitted source is the same startup case.
test("a fresh start with active work still delivers the bootstrap, never a capsule", () => {
  const project = projectWithActiveFeature();
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-cc-state-"));

  const first = parseContext(
    run({ hook_event_name: "SessionStart", session_id: "s6", cwd: project }, project, stateRoot),
    "SessionStart",
  );
  assert.equal(first, createBootstrap(CORE_ROOT), "a startup source carries the bootstrap bytes");
  assert.doesNotMatch(first, /\[GSD Recovery Capsule\]/, "a capsule is compaction or resume only");

  const defaulted = parseContext(
    run({ hook_event_name: "SessionStart", session_id: "s7", cwd: project }, project, stateRoot),
    "SessionStart",
  );
  assert.equal(defaulted, createBootstrap(CORE_ROOT), "a missing source is a startup");
});

test("UserPromptSubmit injects the bootstrap once when no SessionStart ran", () => {
  const project = mkdtempSync(join(tmpdir(), "gsd-cc-cwd-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-cc-state-"));

  const first = parseContext(
    run(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "s2",
        cwd: project,
        prompt: "build X",
      },
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
    { hook_event_name: "UserPromptSubmit", session_id: "s2", cwd: project, prompt: "more" },
    project,
    stateRoot,
  );
  assert.equal(second, "", "the bootstrap is not injected twice");
});

test("a compact SessionStart delivers the capsule with the preserved request", () => {
  const project = projectWithActiveFeature();
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-cc-state-"));

  parseContext(
    run(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "s3",
        cwd: project,
        prompt: "continue",
      },
      project,
      stateRoot,
    ),
    "UserPromptSubmit",
  );

  const after = parseContext(
    run(
      { hook_event_name: "SessionStart", session_id: "s3", cwd: project, source: "compact" },
      project,
      stateRoot,
    ),
    "SessionStart",
  );
  assert.equal(
    after,
    withCurrentRequest(renderRecoveryCapsule(CORE_ROOT, project), "continue"),
    "the compact payload is the core capsule with the preserved request appended, byte for byte",
  );
});

test("a resume SessionStart refreshes an active capsule and stays silent otherwise", () => {
  const project = projectWithActiveFeature();
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-cc-state-"));

  const resumed = parseContext(
    run(
      { hook_event_name: "SessionStart", session_id: "s4", cwd: project, source: "resume" },
      project,
      stateRoot,
    ),
    "SessionStart",
  );
  assert.equal(
    resumed,
    renderRecoveryCapsule(CORE_ROOT, project),
    "a resume with no staged request is the core capsule, byte for byte",
  );

  const quietProject = mkdtempSync(join(tmpdir(), "gsd-cc-cwd-"));
  const quietState = mkdtempSync(join(tmpdir(), "gsd-cc-state-"));
  const quiet = run(
    { hook_event_name: "SessionStart", session_id: "s5", cwd: quietProject, source: "resume" },
    quietProject,
    quietState,
  );
  assert.equal(
    quiet,
    "",
    "a resume with no active work reuses the replayed transcript bootstrap and emits nothing",
  );
});

// Contract rule 4: an adapter that cannot validate its payloads fails closed with a
// visible diagnostic and leaves the host's ordinary behavior intact. The hook is
// copied into a sandbox whose `skills/` is absent, so `createBootstrap` throws for
// real; the emitted sentence must be the core sanitizer's own bytes, because an
// adapter-side rewrite of the core's text is the same paraphrase rule 1 forbids.
test("a broken core fails closed with the core's own diagnostic, never a host rewrite", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "gsd-cc-broken-"));
  const hookDir = join(sandbox, "adapters", "claude-code");
  mkdirSync(hookDir, { recursive: true });
  copyFileSync(HOOK, join(hookDir, "gsd-context.mjs"));
  symlinkSync(join(ROOT, "lib"), join(sandbox, "lib"), "dir");
  const brokenHook = join(hookDir, "gsd-context.mjs");

  const project = mkdtempSync(join(tmpdir(), "gsd-cc-cwd-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-cc-state-"));
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
