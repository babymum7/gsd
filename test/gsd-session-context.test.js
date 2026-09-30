import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectCandidates, writeStateAtomic } from "../lib/gsd-state.mjs";
import {
  composeRecoveryCapsule,
  createMarkerStore,
  renderPacketNotes,
  renderRecoveryCapsule,
  sessionOwnerToken,
  withCurrentRequest,
} from "../lib/gsd-session-context.mjs";

const CLI = join(import.meta.dir, "..", "tools", "gsd-state.mjs");

function retiredState(feature, owner) {
  return [
    "schema:v0.0.2",
    `feature:${feature}`,
    `owner:${owner}`,
    "phase:executing",
    "next_action:start/continue task",
    `plan_path:.scratch/${feature}/plan.md`,
    `plan_sha256:${"a".repeat(64)}`,
    "base_ref:main",
    `wip_branch:wip/${feature}`,
    "last_green_task:none",
    "last_green_commit:none",
    "checkpoint_revision:3",
    "",
  ].join("\n");
}

function workspace(packets) {
  const root = mkdtempSync(join(tmpdir(), "gsd-session-context-"));
  for (const [feature, state] of Object.entries(packets)) {
    mkdirSync(join(root, ".scratch", feature), { recursive: true });
    writeFileSync(join(root, ".scratch", feature, "plan.md"), "# Plan\n");
    writeFileSync(join(root, ".scratch", feature, "state.toon"), state);
  }
  return root;
}

test("a retired-schema packet is reported only to the session that owns it", () => {
  const root = workspace({ mine: retiredState("mine", "s1"), theirs: retiredState("theirs", "s2") });
  try {
    const scan = detectCandidates(root, { faultTolerant: true, owner: "s1" });
    assert.deepEqual(scan.candidates, []);
    assert.deepEqual(scan.retired, ["mine"]);
    assert.equal(
      renderRecoveryCapsule("/gsd", root, "s1"),
      "[GSD Packet Notes]\nGSD packets on a retired state schema (read-state names the rebind): mine\nGSD_SESSION: s1",
    );
    assert.equal(renderRecoveryCapsule("/gsd", root, "s3"), null, "no owned packet means no capsule");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a malformed packet is named as a stop and never listed as resumable", () => {
  const root = workspace({ broken: "schema:v0.0.3\nfeature:broken\n" });
  try {
    const scan = detectCandidates(root, { faultTolerant: true, owner: "s1" });
    assert.deepEqual(scan.candidates, []);
    assert.deepEqual(scan.malformed, ["broken"]);
    const capsule = renderRecoveryCapsule("/gsd", root, "s1");
    assert.match(capsule, /^Malformed GSD packets \(stop before resuming these and report the defect\): broken$/m);
    assert.doesNotMatch(capsule, /GSD features owned by this session/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("packet notes cap their lists and stay silent when nothing was skipped", () => {
  assert.equal(renderPacketNotes({}), null);
  assert.equal(composeRecoveryCapsule(null, "/gsd", "s1"), null);
  const notes = renderPacketNotes({ malformed: ["a", "b", "c", "d", "e", "f", "g"] });
  assert.match(notes, /: a, b, c, d, e \(and 2 more\)$/);
});

test("reading a retired schema names the rebind instead of the flag list", () => {
  const root = workspace({ demo: retiredState("demo", "s1") });
  try {
    const result = spawnSync(process.execPath, [CLI, "read-state", "--path", ".scratch/demo/state.toon"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /unsupported schema: v0\.0\.2/);
    assert.match(result.stdout, /^help: "state schema v0\.0\.2 is retired: revalidate plan\.md, delete this state\.toon, then rebind with .* set --feature-dir/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The capsule has a size budget and the adapters README promises the request is truncated to
// 500 bytes, so a long prompt must not ride past the cap just because it is appended after.
test("the preserved request is truncated to 500 bytes on a character boundary", () => {
  const capsule = "[GSD Recovery Capsule]\nfeature: demo";
  const long = "é".repeat(400);
  const out = withCurrentRequest(capsule, long);
  const request = out.slice(`${capsule}\n[GSD Current Request]\n`.length);
  assert.ok(Buffer.byteLength(request, "utf8") <= 500);
  assert.equal(request, "é".repeat(250));
  assert.equal(withCurrentRequest(capsule, "continue"), `${capsule}\n[GSD Current Request]\ncontinue`);
});

test("a marker store that cannot write degrades to a miss instead of throwing", () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-marker-"));
  const blocker = join(base, "file");
  writeFileSync(blocker, "not a directory");
  const store = createMarkerStore(join(blocker, "state"), "s1");
  try {
    store.write("bootstrap-emitted");
    assert.equal(store.read("bootstrap-emitted"), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a session id of dots stays inside the marker root and markers are private", () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-marker-"));
  try {
    for (const id of ["..", "."]) {
      const store = createMarkerStore(join(base, "root"), id);
      store.write("last-request", "private prompt");
      assert.equal(store.dir.startsWith(join(base, "root") + "/"), true, `${id} resolves below the root`);
      assert.equal(existsSync(join(base, "last-request")), false);
      assert.equal(statSync(join(store.dir, "last-request")).mode & 0o077, 0, "file is owner-only");
      assert.equal(statSync(store.dir).mode & 0o077, 0, "directory is owner-only");
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("distinct session ids never share a marker directory or an owner token", () => {
  // Both names replaced unsafe characters and cut long ids, so `a/b` and `a_b` (or two ids
  // sharing a long prefix) mapped to one directory and one owner: one session's "already
  // bootstrapped" marker silenced another, and each claimed the other's packets.
  const base = mkdtempSync(join(tmpdir(), "gsd-marker-"));
  try {
    const long = "x".repeat(200);
    const ids = ["a/b", "a_b", "a b", `${long}1`, `${long}2`, "..", "_"];
    const dirs = new Set(ids.map((id) => createMarkerStore(base, id).dir));
    assert.equal(dirs.size, ids.length, "every id gets its own marker directory");
    const tokens = new Set(ids.map((id) => sessionOwnerToken("claude", id)));
    assert.equal(tokens.size, ids.length, "every id gets its own owner token");
    for (const id of ids) {
      assert.ok(createMarkerStore(base, id).dir.split("/").at(-1).length <= 128);
      const token = sessionOwnerToken("claude", id);
      assert.ok(token.length <= 160);
      assert.match(token, /^[A-Za-z0-9._:-]+$/);
    }
    // A host id that needs no rewriting keeps its plain names, so existing markers and
    // packet owners stay valid.
    const uuid = "7cec5e02-332a-41f3-953c-5a9c0c35361a";
    assert.equal(createMarkerStore(base, uuid).dir, join(base, uuid));
    assert.equal(sessionOwnerToken("claude", uuid), `claude-${uuid}`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

function validState(feature, owner) {
  return {
    schema: "v0.0.3",
    feature,
    owner,
    phase: "executing",
    next_action: "start/continue task",
    plan_path: `.scratch/${feature}/plan.md`,
    base_ref: "main",
    wip_branch: `wip/${feature}`,
    last_green_task: "none",
    last_green_commit: "none",
    checkpoint_revision: "1",
  };
}

// A feature directory holding more entries than a packet may is one bad packet. It used to
// abort the whole scan, and the recovery capsule swallowed the abort, so another session's
// bulky directory erased this session's recovery.
test("an oversized feature directory is named as a stop without hiding other packets", () => {
  const root = workspace({});
  try {
    for (const [feature, owner] of [["mine", "s1"], ["bulky", "s2"]]) {
      const dir = join(root, ".scratch", feature);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "plan.md"), "# Plan\n");
      writeStateAtomic(dir, validState(feature, owner));
    }
    for (let index = 0; index < 130; index += 1) {
      writeFileSync(join(root, ".scratch", "bulky", `note-${index}.txt`), "x");
    }

    const scan = detectCandidates(root, { faultTolerant: true, owner: "s1" });
    assert.deepEqual(scan.candidates, ["mine"]);
    assert.deepEqual(scan.malformed, ["bulky"]);
    assert.match(scan.defects.join("\n"), /bulky.*entries/);
    assert.match(renderRecoveryCapsule("/gsd", root, "s1"), /GSD features owned by this session: mine/);

    assert.throws(() => detectCandidates(root), /entry limit/, "default discovery still fails closed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
