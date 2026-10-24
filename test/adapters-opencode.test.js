import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import plugin from "../adapters/opencode/gsd-context.mjs";
import { createBootstrap } from "../lib/gsd-bootstrap.mjs";
import { renderRecoveryCapsule, sessionOwnerToken, withSessionOwner } from "../lib/gsd-session-context.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Byte identity holds against an empty GSD home unless a case sets its own.
process.env.GSD_HOME = mkdtempSync(join(tmpdir(), "gsd-empty-home-"));
const ADAPTER = join(ROOT, "adapters", "opencode", "gsd-context.mjs");
const CORE_ROOT = realpathSync(ROOT);
const owner = (session) => sessionOwnerToken("opencode", session);
const bootstrapFor = (session) => withSessionOwner(createBootstrap(CORE_ROOT), owner(session));
const capsuleFor = (project, session) => renderRecoveryCapsule(CORE_ROOT, project, owner(session));

// A recording opencode plugin context. `sessions` maps an id to what `session.get` returns,
// the context of each session grows with every synthetic message, and `emit` feeds the event
// stream the plugin subscribed to.
async function recordingContext(sessions, directory = "/nowhere") {
  const sent = [];
  const contexts = new Map();
  const hooks = new Map();
  const queue = [];
  let wake = null;
  let signal = null;
  const ctx = {
    location: { directory, project: { id: "p", directory, canonical: directory } },
    session: {
      async hook(name, fn) {
        hooks.set(name, fn);
      },
      async get({ sessionID }) {
        return sessions[sessionID];
      },
      async context({ sessionID }) {
        return contexts.get(sessionID) ?? [];
      },
      async synthetic(input) {
        sent.push(input);
        const entry = { type: "synthetic", payload: { text: input.text, description: input.description, metadata: input.metadata } };
        contexts.set(input.sessionID, [...(contexts.get(input.sessionID) ?? []), entry]);
        return { id: `m${sent.length}`, ...entry };
      },
    },
    event: {
      subscribe(options) {
        signal = options.signal;
        return {
          async *[Symbol.asyncIterator]() {
            while (!signal.aborted) {
              if (queue.length === 0) await new Promise((resolve) => (wake = resolve));
              while (queue.length > 0) yield queue.shift();
            }
          },
        };
      },
    },
  };
  const dispose = await plugin.setup(ctx);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  return {
    sent,
    dispose,
    aborted: () => signal?.aborted === true,
    prompt: (sessionID) => hooks.get("prompt")({ sessionID, messageID: "x", prompt: { text: "hi", files: [] }, delivery: "immediate" }),
    // A compaction replaces the history with a summary, dropping earlier synthetic messages.
    async compact(sessionID, type = "session.compaction.ended") {
      contexts.set(sessionID, [{ type: "compaction" }]);
      queue.push({ type, data: { sessionID, reason: "auto", text: "summary" } });
      wake?.();
      await settle();
    },
  };
}

function projectWithActiveFeature(owner = "none") {
  const project = mkdtempSync(join(tmpdir(), "gsd-opencode-project-"));
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

test("the first prompt of a root session gets one tagged bootstrap, later prompts nothing", async () => {
  const oc = await recordingContext({ ses_a: { id: "ses_a" } });
  await oc.prompt("ses_a");
  await oc.prompt("ses_a");
  assert.equal(oc.sent.length, 1);
  assert.equal(oc.sent[0].sessionID, "ses_a");
  assert.equal(oc.sent[0].text, bootstrapFor("ses_a"));
  assert.match(oc.sent[0].text, /GSD_SESSION: opencode-ses_a/);
  assert.deepEqual(oc.sent[0].metadata, { "gsd/bootstrap": true });
  assert.equal(oc.sent[0].resume, false);
  await oc.dispose();
  assert.equal(oc.aborted(), true);
});

test("a child session gets nothing", async () => {
  const oc = await recordingContext({ ses_c: { id: "ses_c", parentID: "ses_a" } });
  await oc.prompt("ses_c");
  await oc.compact("ses_c");
  assert.equal(oc.sent.length, 0);
  await oc.dispose();
});

test("a compaction sends the bootstrap then the capsule once, and the next prompt adds nothing", async () => {
  const project = projectWithActiveFeature("opencode-ses_a");
  const oc = await recordingContext({ ses_a: { id: "ses_a", location: { directory: project } } });
  await oc.prompt("ses_a");
  await oc.compact("ses_a");
  await oc.prompt("ses_a");
  assert.equal(oc.sent.length, 2);
  const capsule = capsuleFor(project, "ses_a");
  assert.ok(capsule);
  assert.equal(oc.sent[1].text, `${bootstrapFor("ses_a")}\n\n${capsule}`);
  assert.deepEqual(oc.sent[1].metadata, { "gsd/bootstrap": true });
  await oc.dispose();
});

test("after a compaction a session owning no packet gets the bootstrap alone, from the plugin directory", async () => {
  const oc = await recordingContext({ ses_a: { id: "ses_a" } }, projectWithActiveFeature("someone-else"));
  await oc.compact("ses_a");
  assert.equal(oc.sent.length, 1);
  assert.equal(oc.sent[0].text, bootstrapFor("ses_a"));
  await oc.dispose();
});

test("a failed compaction sends nothing", async () => {
  const oc = await recordingContext({ ses_a: { id: "ses_a" } });
  await oc.compact("ses_a", "session.compaction.failed");
  assert.equal(oc.sent.length, 0);
  await oc.dispose();
});

test("a failure inside the plugin sends the sanitized error once and never throws into opencode", async () => {
  // A throwing `session.get` stands in for any core failure.
  const broken = await recordingContext({
    get ses_b() {
      throw new Error("boom");
    },
  });
  await broken.prompt("ses_b");
  await broken.prompt("ses_b");
  assert.equal(broken.sent.length, 1);
  assert.match(broken.sent[0].text, /^\[GSD bootstrap unavailable\] boom\./);
  await broken.dispose();
});

test("the module loads under real node and exposes the plugin shape", () => {
  const script = `import(${JSON.stringify(pathToFileURL(ADAPTER).href)}).then((m) => {
    if (m.default.id !== "gsd" || typeof m.default.setup !== "function") process.exit(1);
  });`;
  const result = spawnSync("node", ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
