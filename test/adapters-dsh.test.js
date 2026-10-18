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
    event: (session, type) => listeners.get("session/event").forEach((fn) => fn(session, { type })),
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

test("a resume injects the capsule only, and a session owning no packet gets the bootstrap", async () => {
  const project = projectWithActiveFeature(owner("abc"));
  const dsh = recordingContext();
  const resumed = fakeAgent("abc", project);
  const other = fakeAgent("d9", project);

  await dsh.created(resumed, "resume");
  await dsh.created(other, "resume");

  assert.match(capsuleFor(project, "abc"), /\[GSD Recovery Capsule\]/);
  assert.deepEqual(resumed.injected.map(textOf), [capsuleFor(project, "abc")]);
  assert.deepEqual(other.injected.map(textOf), [bootstrapFor("d9")]);
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

  const decision = await dsh.step(broken, enter("hi"));
  assert.equal(decision.messages.length, 2, "an unreadable step gains the sanitized error");
  assert.match(textOf(decision.messages[1]), /header/);
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
