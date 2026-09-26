import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectCandidates } from "../lib/gsd-state.mjs";
import { composeRecoveryCapsule, renderPacketNotes, renderRecoveryCapsule } from "../lib/gsd-session-context.mjs";

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
