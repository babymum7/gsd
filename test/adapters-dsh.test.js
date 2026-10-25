import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { apply, name } from "../adapters/dsh/gsd-context.mjs";
import { createBootstrap } from "../lib/gsd-bootstrap.mjs";
import { renderRecoveryCapsule, sessionOwnerToken, withSessionOwner } from "../lib/gsd-session-context.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Byte identity holds against an empty GSD home unless a case sets its own.
process.env.GSD_HOME = mkdtempSync(join(tmpdir(), "gsd-empty-home-"));
// The adapter keeps its delivery markers under the temp directory, so each run gets its own.
process.env.TMPDIR = mkdtempSync(join(tmpdir(), "gsd-dsh-markers-"));
const ADAPTER = join(ROOT, "adapters", "dsh", "gsd-context.mjs");
// The injected text is the core's own render for the same inputs, byte for byte. The adapter
// resolves its root from its own (real) location, so the comparison root realpaths too.
const CORE_ROOT = realpathSync(ROOT);
const owner = (session) => sessionOwnerToken("dsh", session);
const bootstrapFor = (session) => withSessionOwner(createBootstrap(CORE_ROOT), owner(session));
const capsuleFor = (project, session) => renderRecoveryCapsule(CORE_ROOT, project, owner(session));

// A recording Cordis context: `on` stores listeners, the helpers fire them like dsh would.
function recordingContext() {
  const listeners = new Map();
  apply({
    on(event, fn) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
    },
  });
  return {
    created: (agent, source) => Promise.all(listeners.get("agent/created").map((fn) => fn({ agent, source }))),
    event: (session, type, extra = {}) => listeners.get("session/event").forEach((fn) => {
      fn(session, { type, ...extra });
    }),
    // The innermost `next` yields the decision dsh would have made.
    step: (agent, decision) => listeners.get("agent/pre-step")[0]({ agent, messages: [] }, async () => decision),
  };
}

function fakeAgent(id, cwd) {
  const injected = [];
  return { session: { header: { id, cwd } }, inject: (message) => injected.push(message), injected };
}

const enter = (...texts) => ({
  kind: "enter",
  messages: texts.map((text) => ({ role: "user", content: [{ type: "text", text }] })),
});
const textOf = (message) => message.content[0].text;
const isDeeplyFrozen = (message) =>
  Object.isFrozen(message) && Object.isFrozen(message.content) && message.content.every(Object.isFrozen);

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

test("startup injects one frozen user message holding the core bootstrap", async () => {
  const project = projectWithActiveFeature("dsh-abc");
  const dsh = recordingContext();
  const agent = fakeAgent("abc", project);

  await dsh.created(agent, "startup");

  assert.equal(name, "gsd");
  assert.equal(agent.injected.length, 1);
  const [message] = agent.injected;
  assert.equal(message.role, "user");
  assert.equal(message.content.length, 1);
  assert.equal(message.content[0].type, "text");
  assert.equal(textOf(message), bootstrapFor("abc"), "startup carries the core's exact bootstrap bytes, never a capsule");
  assert.doesNotMatch(textOf(message), /\[GSD Recovery Capsule\]/);
  assert.ok(isDeeplyFrozen(message));
});

// A resume replays the transcript, so a session that already got the bootstrap gets only what
// is new: the capsule, or nothing. A session the marker does not know gets the full set.
test("a resume after a delivered bootstrap injects the capsule or nothing, an unknown session the full set", async () => {
  const project = projectWithActiveFeature(owner("res-a"));
  const dsh = recordingContext();
  const started = fakeAgent("res-a", project);
  const idle = fakeAgent("res-b", project);
  await dsh.created(started, "startup");
  await dsh.created(idle, "startup");

  const resumed = fakeAgent("res-a", project);
  const resumedIdle = fakeAgent("res-b", project);
  const unknown = fakeAgent("res-c", projectWithActiveFeature(owner("res-c")));
  await dsh.created(resumed, "resume");
  await dsh.created(resumedIdle, "resume");
  await dsh.created(unknown, "resume");

  assert.match(capsuleFor(project, "res-a"), /\[GSD Recovery Capsule\]/);
  assert.deepEqual(resumed.injected.map(textOf), [capsuleFor(project, "res-a")]);
  assert.deepEqual(resumedIdle.injected, []);
  assert.deepEqual(unknown.injected.map(textOf), [`${bootstrapFor("res-c")}\n\n${capsuleFor(unknown.session.header.cwd, "res-c")}`]);
});

test("a resume after the delivered bootstrap changed injects the current bootstrap again", async () => {
  const project = mkdtempSync(join(tmpdir(), "gsd-dsh-cwd-"));
  const dsh = recordingContext();
  await dsh.created(fakeAgent("res-s", project), "startup");
  const resumed = fakeAgent("res-s", project);
  await dsh.created(resumed, "resume");
  assert.deepEqual(resumed.injected, [], "an unchanged bootstrap is not sent again");

  // The marker names an earlier bootstrap, as after a GSD update.
  writeFileSync(join(process.env.TMPDIR, "gsd-dsh", "res-s", "bootstrap-emitted"), "0".repeat(64));
  const stale = fakeAgent("res-s", project);
  await dsh.created(stale, "resume");
  assert.deepEqual(stale.injected.map(textOf), [bootstrapFor("res-s")]);
});

test("a compact source injects the bootstrap then the capsule, or the bootstrap alone", async () => {
  const project = projectWithActiveFeature(owner("abc"));
  const dsh = recordingContext();
  const owning = fakeAgent("abc", project);
  const other = fakeAgent("d9", project);

  await dsh.created(owning, "compact");
  await dsh.created(other, "compact");

  assert.deepEqual(owning.injected.map(textOf), [`${bootstrapFor("abc")}\n\n${capsuleFor(project, "abc")}`]);
  assert.deepEqual(other.injected.map(textOf), [bootstrapFor("d9")]);
});

test("a clear source injects the bootstrap even when the session header has no cwd", async () => {
  const dsh = recordingContext();
  const cleared = fakeAgent("abc", undefined);

  await dsh.created(cleared, "clear");

  assert.deepEqual(cleared.injected.map(textOf), [bootstrapFor("abc")]);
});

test("compaction/end adds the bootstrap and capsule to the next entering step of that session once", async () => {
  const project = projectWithActiveFeature(owner("abc"));
  const dsh = recordingContext();
  const agent = fakeAgent("abc", project);
  const bystander = fakeAgent("d9", project);

  dsh.event(agent.session, "compaction/start");
  assert.deepEqual((await dsh.step(agent, enter("hi"))).messages.map(textOf), ["hi"], "only compaction/end marks a session");

  dsh.event(agent.session, "compaction/end");
  assert.deepEqual((await dsh.step(bystander, enter("hi"))).messages.map(textOf), ["hi"], "another session gains nothing");

  const decision = await dsh.step(agent, enter("hi", "again"));
  assert.equal(decision.kind, "enter");
  assert.equal(decision.messages.length, 3);
  assert.deepEqual(decision.messages.slice(0, 2).map(textOf), ["hi", "again"]);
  const added = decision.messages[2];
  assert.equal(added.role, "user");
  assert.equal(added.content.length, 1);
  assert.equal(textOf(added), `${bootstrapFor("abc")}\n\n${capsuleFor(project, "abc")}`);
  assert.ok(isDeeplyFrozen(added));

  assert.deepEqual((await dsh.step(agent, enter("later"))).messages.map(textOf), ["later"], "a later step gains nothing");
});

// dsh ends a failed compaction (a 504, or a request too large) with `compaction/end` and an
// `error`; the history was not compacted, so the bootstrap it still holds must not be repeated.
test("a compaction/end carrying an error adds nothing to the next step", async () => {
  const project = projectWithActiveFeature(owner("abc"));
  const dsh = recordingContext();
  const agent = fakeAgent("abc", project);

  dsh.event(agent.session, "compaction/end", { error: "504 gateway timeout" });

  assert.deepEqual((await dsh.step(agent, enter("hi"))).messages.map(textOf), ["hi"]);
});

test("after a compaction a session owning no packet gets the bootstrap alone", async () => {
  const project = mkdtempSync(join(tmpdir(), "gsd-dsh-cwd-"));
  const dsh = recordingContext();
  const agent = fakeAgent("abc", project);

  dsh.event(agent.session, "compaction/end");
  const decision = await dsh.step(agent, enter());

  assert.deepEqual(decision.messages.map(textOf), [bootstrapFor("abc")]);
});

test("a rejected step passes through untouched and keeps the mark for the next entering step", async () => {
  const project = projectWithActiveFeature(owner("abc"));
  const dsh = recordingContext();
  const agent = fakeAgent("abc", project);
  const reject = { kind: "reject" };

  dsh.event(agent.session, "compaction/end");
  assert.equal(await dsh.step(agent, reject), reject);

  const decision = await dsh.step(agent, enter());
  assert.deepEqual(decision.messages.map(textOf), [`${bootstrapFor("abc")}\n\n${capsuleFor(project, "abc")}`]);
});

// The core is fault tolerant for a bad cwd, so a session without a header is the honest way to
// fail inside a listener.
test("a failure inside the plugin injects the sanitized error and never throws into dsh", async () => {
  const dsh = recordingContext();
  const injected = [];
  const broken = { session: {}, inject: (message) => injected.push(message) };

  await dsh.created(broken, "startup");

  assert.equal(injected.length, 1);
  assert.match(textOf(injected[0]), /header/);
  assert.doesNotMatch(textOf(injected[0]), /\[GSD Recovery Capsule\]/);

  // Only a step that owes a compaction re-injection may carry an error; any other step passes
  // through untouched, or a broken session would gain the error on every step.
  const decision = await dsh.step(broken, enter("hi"));
  assert.equal(decision.messages.length, 1, "an unreadable step passes through untouched");
  assert.doesNotThrow(() => dsh.event({}, "compaction/end"));
});

test("the module loads under real node and exposes the plugin shape", () => {
  const url = pathToFileURL(ADAPTER).href;
  const result = spawnSync(
    "node",
    ["-e", `import(${JSON.stringify(url)}).then(m => { if (typeof m.apply !== 'function' || m.name !== 'gsd') process.exit(1) })`],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, `node exited ${result.status}: ${result.stderr}`);
});

// dsh gets no sub-agent profiles: `gsd config` hosts stay claude|codex|omp.
test("user sub-agent profiles for other hosts never change the dsh bootstrap", async () => {
  const project = mkdtempSync(join(tmpdir(), "gsd-dsh-cwd-"));
  const home = mkdtempSync(join(tmpdir(), "gsd-dsh-home-"));
  writeFileSync(
    join(home, "settings.json"),
    JSON.stringify({
      version: 1,
      profiles: { scout: { codex: "gpt-x", claude: "haiku" }, worker: { codex: "gpt-y", claude: "sonnet" } },
    }),
  );
  const previous = process.env.GSD_HOME;
  process.env.GSD_HOME = home;
  try {
    const dsh = recordingContext();
    const agent = fakeAgent("s1", project);
    await dsh.created(agent, "startup");
    const injected = textOf(agent.injected[0]);
    assert.equal(injected, bootstrapFor("s1"), "the dsh bootstrap is the bare core render");
    assert.doesNotMatch(injected, /Sub-agent profiles/);
  } finally {
    process.env.GSD_HOME = previous;
  }
});
