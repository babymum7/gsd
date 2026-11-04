import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createBootstrap, sanitizeBootstrapError } from "../lib/gsd-bootstrap.mjs";
import { renderRecoveryCapsule, withCurrentRequest, sessionOwnerToken, withSessionOwner } from "../lib/gsd-session-context.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Byte identity holds against an empty GSD home: user sub-agent profiles in the real
// ~/.gsd/settings.json would otherwise append to the bootstrap every hook emits.
process.env.GSD_HOME = mkdtempSync(join(tmpdir(), "gsd-empty-home-"));
const HOOK = join(ROOT, "adapters", "claude-code", "gsd-context.mjs");
// The adapter contract is byte identity, not resemblance: every payload the hook emits must
// be the core's own render for the same inputs. The hook resolves its root through
// realpathSync, so the comparison root is normalized the same way.
const CORE_ROOT = realpathSync(ROOT);
const owner = (session) => sessionOwnerToken("claude", session);
const bootstrapFor = (session) => withSessionOwner(createBootstrap(CORE_ROOT), owner(session));

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

function projectWithActiveFeature(owner = "none", feature = "demo", project = mkdtempSync(join(tmpdir(), "gsd-cc-project-"))) {
  const featureDir = join(project, ".scratch", feature);
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, "plan.md"), "# Plan\n");
  writeFileSync(
    join(featureDir, "state.toon"),
    [
      "schema:v0.0.3",
      `feature:${feature}`,
      `owner:${owner}`,
      "phase:approved",
      "next_action:start task",
      `plan_path:.scratch/${feature}/plan.md`,
      "base_ref:main",
      `wip_branch:wip/${feature}`,
      "last_green_task:none",
      "last_green_commit:none",
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
    bootstrapFor("s1"),
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
  assert.equal(first, bootstrapFor("s6"), "a startup source carries the bootstrap bytes");
  assert.doesNotMatch(first, /\[GSD Recovery Capsule\]/, "a capsule is compaction or resume only");

  const defaulted = parseContext(
    run({ hook_event_name: "SessionStart", session_id: "s7", cwd: project }, project, stateRoot),
    "SessionStart",
  );
  assert.equal(defaulted, bootstrapFor("s7"), "a missing source is a startup");
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
    bootstrapFor("s2"),
    "the fallback path injects the same core bytes as SessionStart",
  );

  const second = run(
    { hook_event_name: "UserPromptSubmit", session_id: "s2", cwd: project, prompt: "more" },
    project,
    stateRoot,
  );
  assert.equal(second, "", "the bootstrap is not injected twice");
});

// Compaction drops hook-injected context along with the transcript, so the bootstrap that
// carried routing and the skill catalog must come back with the capsule, not be replaced by it.
test("a compact SessionStart delivers the bootstrap, then the capsule with the preserved request", () => {
  const project = projectWithActiveFeature(owner("s3"));
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
    `${bootstrapFor("s3")}\n\n${withCurrentRequest(renderRecoveryCapsule(CORE_ROOT, project, owner("s3")), "continue")}`,
    "the compact payload is the core bootstrap, then the capsule with the preserved request, byte for byte",
  );
});

// Claude Code continues a transcript under a new session id, so the GSD hook outputs at its
// head carry the earlier token and the packets recorded under it are the continued session's.
function transcriptWith(records) {
  const file = join(mkdtempSync(join(tmpdir(), "gsd-cc-transcript-")), "session.jsonl");
  writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  return file;
}

test("compact and resume list packets owned by an earlier token the transcript head carries", () => {
  const project = projectWithActiveFeature(owner("old"), "old-feature");
  projectWithActiveFeature(owner("other"), "other-feature", project);
  const transcript = transcriptWith([
    {
      type: "attachment",
      attachment: {
        type: "hook_success",
        hookName: "SessionStart:compact",
        hookEvent: "SessionStart",
        stdout: JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: `<GSD_BOOTSTRAP>\nbody\nGSD_SESSION: ${owner("old")}\n</GSD_BOOTSTRAP>`,
          },
        }),
      },
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", content: `quoted GSD_SESSION: ${owner("other")}\n` }],
      },
    },
  ]);
  for (const source of ["compact", "resume"]) {
    const stateRoot = mkdtempSync(join(tmpdir(), "gsd-cc-state-"));
    const after = parseContext(
      run(
        { hook_event_name: "SessionStart", source, session_id: "new", cwd: project, transcript_path: transcript },
        project,
        stateRoot,
      ),
      "SessionStart",
    );
    const capsule = renderRecoveryCapsule(CORE_ROOT, project, owner("new"), [owner("old")]);
    assert.equal(
      after,
      source === "compact" ? `${bootstrapFor("new")}\n\n${capsule}` : capsule,
      `${source} payload is the core capsule, byte for byte`,
    );
    assert.match(after, new RegExp(`earlier token ${owner("old")}.*--takeover owner=${owner("new")}: old-feature`));
    assert.doesNotMatch(after, /other-feature/);
  }

  // A fork copies its parent's history, and the parent may still run, so a fork inherits nothing:
  // neither once its own fork hook output names it, nor after a fork start the hook saw itself.
  const forkHook = {
    type: "attachment",
    attachment: {
      type: "hook_success",
      hookName: "SessionStart:fork",
      hookEvent: "SessionStart",
      stdout: `{"additionalContext":"<GSD_BOOTSTRAP>\\nGSD_SESSION: ${owner("new")}\\n</GSD_BOOTSTRAP>"}`,
    },
  };
  const forked = transcriptWith([...JSON.parse(`[${readFileSync(transcript, "utf8").trim().split("\n").join(",")}]`), forkHook]);
  const fromTranscript = run(
    { hook_event_name: "SessionStart", source: "compact", session_id: "new", cwd: project, transcript_path: forked },
    project,
    mkdtempSync(join(tmpdir(), "gsd-cc-state-")),
  );
  assert.equal(parseContext(fromTranscript, "SessionStart"), bootstrapFor("new"));
  const forkState = mkdtempSync(join(tmpdir(), "gsd-cc-state-"));
  run({ hook_event_name: "SessionStart", source: "fork", session_id: "new", cwd: project }, project, forkState);
  const fromMarker = run(
    { hook_event_name: "SessionStart", source: "compact", session_id: "new", cwd: project, transcript_path: transcript },
    project,
    forkState,
  );
  assert.equal(parseContext(fromMarker, "SessionStart"), bootstrapFor("new"));

  // Without a readable transcript the capsule is exactly what it was before inheritance.
  const missing = run(
    { hook_event_name: "SessionStart", source: "resume", session_id: "new", cwd: project, transcript_path: join(project, "absent.jsonl") },
    project,
    mkdtempSync(join(tmpdir(), "gsd-cc-state-")),
  );
  assert.equal(missing, "", "no readable transcript and no owned packet is no capsule");
  const owned = projectWithActiveFeature(owner("new"));
  const plain = run(
    { hook_event_name: "SessionStart", source: "resume", session_id: "new", cwd: owned, transcript_path: join(owned, "absent.jsonl") },
    owned,
    mkdtempSync(join(tmpdir(), "gsd-cc-state-")),
  );
  assert.equal(parseContext(plain, "SessionStart"), renderRecoveryCapsule(CORE_ROOT, owned, owner("new")));
});

// Claude Code delivers a finished background task as a prompt that opens with
// `<task-notification>`; it is not what the user asked, so the capsule keeps the last real one.
test("a task notification prompt does not replace the preserved request", () => {
  const project = projectWithActiveFeature(owner("s9"));
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-cc-state-"));
  for (const prompt of ["continue", "<task-notification>\n<task-id>b1</task-id>\n</task-notification>"]) {
    run({ hook_event_name: "UserPromptSubmit", session_id: "s9", cwd: project, prompt }, project, stateRoot);
  }
  const after = parseContext(
    run({ hook_event_name: "SessionStart", session_id: "s9", cwd: project, source: "compact" }, project, stateRoot),
    "SessionStart",
  );
  assert.ok(after.endsWith("[GSD Current Request]\ncontinue"), "the request before the notification is kept");
});

test("a resume after the claude profiles changed re-sends the bootstrap, an unchanged one stays silent", () => {
  const project = mkdtempSync(join(tmpdir(), "gsd-cc-cwd-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "gsd-cc-state-"));
  const home = mkdtempSync(join(tmpdir(), "gsd-cc-home-"));
  const setScout = (model) =>
    writeFileSync(join(home, "settings.json"), JSON.stringify({ version: 1, profiles: { scout: { claude: model } } }));
  const start = (source) => run({ hook_event_name: "SessionStart", session_id: "s-p", cwd: project, source }, project, stateRoot);
  const previous = process.env.GSD_HOME;
  process.env.GSD_HOME = home;
  try {
    setScout("haiku");
    assert.match(parseContext(start("startup"), "SessionStart"), /scout `haiku`/);
    assert.equal(start("resume"), "");
    setScout("sonnet");
    assert.match(parseContext(start("resume"), "SessionStart"), /scout `sonnet`/);
    assert.equal(start("resume"), "");
  } finally {
    process.env.GSD_HOME = previous;
  }
});

test("a resume SessionStart refreshes an active capsule and stays silent otherwise", () => {
  const project = projectWithActiveFeature(owner("s4"));
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
    renderRecoveryCapsule(CORE_ROOT, project, owner("s4")),
    "a resume with no staged request is the core capsule, byte for byte",
  );
  assert.match(resumed, /\nGSD_SESSION: claude-s4$/, "the capsule repeats the owner token");

  // Another session in the same work tree never sees a packet it does not own.
  const other = run(
    { hook_event_name: "SessionStart", session_id: "s9", cwd: project, source: "resume" },
    project,
    stateRoot,
  );
  assert.equal(other, "", "a packet owned by another session yields no capsule");

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

// The marker only spares later prompts a repeat of the bootstrap. Losing it costs tokens;
// replacing the bootstrap with a filesystem error costs the whole workflow for that session.
test("an unwritable state directory still delivers the bootstrap", () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-cc-blocked-"));
  const stateRoot = join(base, "file");
  writeFileSync(stateRoot, "a file where the temp directory should be");
  const project = mkdtempSync(join(tmpdir(), "gsd-cc-project-"));
  const context = parseContext(
    run({ hook_event_name: "SessionStart", session_id: "s-blocked", cwd: project, source: "startup" }, project, stateRoot),
    "SessionStart",
  );
  assert.equal(context, bootstrapFor("s-blocked"));
});
