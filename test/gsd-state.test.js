import { test } from "bun:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  readStateFile,
  writeStateAtomic,
  parseState,
  serializeState,
  validateState,
  STATE_FIELD_ORDER,
  detectCandidates,
  DEFAULT_PHASE_NEXT_ACTIONS,
  defaultNextActionForPhase,
} from "../lib/gsd-state.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "tools", "gsd-state.mjs");

const VALID_STATE = {
  schema: "v0.0.3",
  feature: "test-feature",
  owner: "none",
  phase: "approved",
  next_action: "start task T1",
  plan_path: ".scratch/test-feature/plan.md",
  base_ref: "main",
  wip_branch: "wip/test-feature",
  last_green_task: "none",
  last_green_commit: "none",
  checkpoint_revision: "1",
};

function tmpFeatureDir(feature = "test-feature") {
  const dir = mkdtempSync(join(tmpdir(), "gsd-state-test-"));
  const scratch = join(dir, ".scratch", feature);
  mkdirSync(scratch, { recursive: true });
  writeFileSync(join(dir, ".scratch", feature, "plan.md"), "# Plan\n");
  return { dir, scratch };
}

function cli(args) {
  try {
    const result = execFileSync(process.execPath, [CLI, ...args], {
      cwd: tmpdir(),
      encoding: "utf8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { exitCode: 0, stdout: result, stderr: "" };
  } catch (err) {
    return {
      exitCode: err.status,
      stdout: err.stdout || "",
      stderr: err.stderr || "",
    };
  }
}

// ─── Malformed input rejection ────────────────────────────────────────

test("rejects = separator (legacy malformed format)", () => {
  const { scratch } = tmpFeatureDir();
  writeFileSync(join(scratch, "state.toon"), "feature=bad\nphase=wrong\n");
  const r = cli(["validate-state", "--path", join(scratch, "state.toon")]);
  assert.equal(r.exitCode, 1, "should exit 1 on malformed input");
  assert.match(r.stdout, /malformed row/);
});

test("rejects missing required field", () => {
  const { scratch } = tmpFeatureDir();
  const content = [
    "schema:v0.0.3",
    "feature:test-feature",
    "owner:none",
    // phase missing
    "next_action:none",
    "plan_path:.scratch/test-feature/plan.md",
    "base_ref:main",
    "wip_branch:wip/test-feature",
    "last_green_task:none",
    "last_green_commit:none",
    "checkpoint_revision:1",
  ].join("\n");
  writeFileSync(join(scratch, "state.toon"), content);
  const r = cli(["validate-state", "--path", join(scratch, "state.toon")]);
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /missing required field: phase/);
});

test("rejects wrong field order", () => {
  const { scratch } = tmpFeatureDir();
  const content = [
    "feature:test-feature",  // schema missing, wrong position
    "schema:v0.0.3",
    "owner:none",
    "phase:approved",
    "next_action:start task T1",
    "plan_path:.scratch/test-feature/plan.md",
    "base_ref:main",
    "wip_branch:wip/test-feature",
    "last_green_task:none",
    "last_green_commit:none",
    "checkpoint_revision:1",
  ].join("\n");
  writeFileSync(join(scratch, "state.toon"), content);
  const r = cli(["validate-state", "--path", join(scratch, "state.toon")]);
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /canonical order/);
});

test("rejects unknown key", () => {
  const { scratch } = tmpFeatureDir();
  const content = [
    "schema:v0.0.3",
    "feature:test-feature",
    "owner:none",
    "phase:approved",
    "plan_hash:some-hash",  // unknown key
    "next_action:start task T1",
    "plan_path:.scratch/test-feature/plan.md",
    "base_ref:main",
    "wip_branch:wip/test-feature",
    "last_green_task:none",
    "last_green_commit:none",
    "checkpoint_revision:1",
  ].join("\n");
  writeFileSync(join(scratch, "state.toon"), content);
  const r = cli(["validate-state", "--path", join(scratch, "state.toon")]);
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /unknown key: plan_hash/);
});

test("rejects invalid feature slug", () => {
  const { scratch } = tmpFeatureDir();
  // Write raw TOON with invalid feature (serializeState would reject, so write directly)
  const content = [
    "schema:v0.0.3",
    "feature:INVALID_FEATURE",
    "owner:none",
    "phase:approved",
    "next_action:start task T1",
    "plan_path:.scratch/test-feature/plan.md",
    "base_ref:main",
    "wip_branch:wip/test-feature",
    "last_green_task:none",
    "last_green_commit:none",
    "checkpoint_revision:1",
  ].join("\n");
  writeFileSync(join(scratch, "state.toon"), content);
  const r = cli(["validate-state", "--path", join(scratch, "state.toon")]);
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /invalid feature slug/);
});

test("rejects wip_branch feature mismatch", () => {
  const { scratch } = tmpFeatureDir();
  const content = [
    "schema:v0.0.3",
    "feature:test-feature",
    "owner:none",
    "phase:approved",
    "next_action:start task T1",
    "plan_path:.scratch/test-feature/plan.md",
    "base_ref:main",
    "wip_branch:wip/wrong-feature",
    "last_green_task:none",
    "last_green_commit:none",
    "checkpoint_revision:1",
  ].join("\n");
  writeFileSync(join(scratch, "state.toon"), content);
  const r = cli(["validate-state", "--path", join(scratch, "state.toon")]);
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /wip_branch feature mismatch/);
  assert.match(r.stdout, /wip\/test-feature/, "error must name the expected branch");
});

test("rejects blank lines", () => {
  const { scratch } = tmpFeatureDir();
  writeFileSync(join(scratch, "state.toon"), "schema:v0.0.3\n\nfeature:test-feature\n");
  const r = cli(["validate-state", "--path", join(scratch, "state.toon")]);
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /blank lines are not allowed/);
});

test("rejects carriage return line endings", () => {
  const { scratch } = tmpFeatureDir();
  writeFileSync(join(scratch, "state.toon"), "schema:v0.0.3\r\nfeature:test-feature\r\n");
  const r = cli(["validate-state", "--path", join(scratch, "state.toon")]);
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /carriage return rejected/);
});

// ─── Canonical v0.0.3 write/readback ──────────────────────────────────────

test("writeStateAtomic produces canonical TOON format", () => {
  const { scratch } = tmpFeatureDir();
  const _result = writeStateAtomic(scratch, VALID_STATE);
  const raw = readFileSync(join(scratch, "state.toon"), "utf8");

  const lines = raw.trim().split("\n");
  assert.equal(lines.length, 11, "should have exactly 11 fields");
  for (const line of lines) {
    assert.match(line, /^[a-z0-9_]+:.+/, `line should be key:value format: ${line}`);
    assert.ok(!line.includes("="), `should not use = separator: ${line}`);
  }

  const expectedOrder = [
    "schema", "feature", "owner", "phase", "next_action", "plan_path",
    "base_ref", "wip_branch", "last_green_task", "last_green_commit", "checkpoint_revision",
  ];
  const actualOrder = lines.map(l => l.split(":")[0]);
  assert.deepEqual(actualOrder, expectedOrder, "fields must be in canonical order");
});

test("writeStateAtomic readback matches input", () => {
  const { scratch } = tmpFeatureDir();
  const written = writeStateAtomic(scratch, VALID_STATE);
  const read = readStateFile(join(scratch, "state.toon"));
  assert.deepEqual(read, written);
  assert.equal(read.schema, "v0.0.3");
  assert.equal(read.feature, "test-feature");
  assert.equal(read.wip_branch, "wip/test-feature");
});

test("readStateFile roundtrip preserves all fields", () => {
  const { scratch } = tmpFeatureDir();
  writeStateAtomic(scratch, VALID_STATE);
  const raw = readFileSync(join(scratch, "state.toon"), "utf8");
  const parsed = parseState(raw);

  for (const [key, value] of Object.entries(VALID_STATE)) {
    assert.equal(parsed[key], value, `field ${key} should roundtrip`);
  }
});

test("CLI read-state outputs valid JSON", () => {
  const { scratch } = tmpFeatureDir();
  writeStateAtomic(scratch, VALID_STATE);
  const r = cli(["read-state", "--path", join(scratch, "state.toon")]);
  assert.equal(r.exitCode, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.schema, "v0.0.3");
  assert.equal(parsed.feature, "test-feature");
});

test("CLI validate-state outputs valid JSON", () => {
  const { scratch } = tmpFeatureDir();
  writeStateAtomic(scratch, VALID_STATE);
  const r = cli(["validate-state", "--path", join(scratch, "state.toon")]);
  assert.equal(r.exitCode, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.phase, "approved");
});

test("CLI write-state creates valid file and outputs JSON", () => {
  const { scratch } = tmpFeatureDir();
  const r = cli([
    "write-state",
    "--feature-dir", scratch,
    "--json", JSON.stringify(VALID_STATE),
  ]);
  assert.equal(r.exitCode, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.schema, "v0.0.3");
  assert.equal(parsed.feature, "test-feature");

  const raw = readFileSync(join(scratch, "state.toon"), "utf8");
  assert.ok(raw.startsWith("schema:v0.0.3\n"), "file should start with schema:v0.0.3");
  assert.ok(!raw.includes("="), "file should not contain = separator");
});

test("CLI write-state rejects invalid JSON", () => {
  const { scratch } = tmpFeatureDir();
  const r = cli([
    "write-state",
    "--feature-dir", scratch,
    "--json", "{bad json}",
  ]);
  assert.equal(r.exitCode, 2);
  assert.match(r.stdout, /invalid JSON/);
});

test("CLI write-state rejects incomplete state", () => {
  const { scratch } = tmpFeatureDir();
  const r = cli([
    "write-state",
    "--feature-dir", scratch,
    "--json", JSON.stringify({ schema: "v0.0.3", feature: "test-feature" }),
  ]);
  assert.equal(r.exitCode, 1);
});

test("CLI missing --path gives usage error", () => {
  const r = cli(["read-state"]);
  assert.equal(r.exitCode, 2);
  assert.match(r.stdout, /--path is required/);
});

test("CLI missing command gives usage error", () => {
  const r = cli([]);
  assert.equal(r.exitCode, 2);
  assert.match(r.stdout, /missing command/);
});

test("CLI flag without a value gives a naming usage error", () => {
  for (const flag of ["--path", "--feature-dir", "--json", "--json-file"]) {
    const r = cli(["write-state", flag]);
    assert.equal(r.exitCode, 2, `${flag} without value must be a usage error`);
    assert.match(r.stdout, new RegExp(`\\${flag} requires a value`), `${flag} must be named`);
  }
});

test("CLI validate-state rejects a path whose basename is not state.toon", () => {
  const { scratch } = tmpFeatureDir();
  const alias = join(scratch, "state.toon.bak");
  writeFileSync(alias, "schema:v0.0.3\n");
  const r = cli(["validate-state", "--path", alias]);
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /expected state\.toon/);
});

test("CLI rejects experimental schemas without rewriting them", () => {
  const { scratch } = tmpFeatureDir();
  const statePath = join(scratch, "state.toon");
  const experimental = [
    "schema:v4",
    "feature:test-feature",
    "owner:none",
    "phase:executing",
    "next_action:continue task T1",
    "plan_path:.scratch/test-feature/plan.md",
    "base_ref:main",
    "wip_branch:wip/test-feature",
    "last_green_task:none",
    "last_green_commit:none",
    "checkpoint_revision:1",
    "",
  ].join("\n");
  writeFileSync(statePath, experimental);

  const validated = cli(["validate-state", "--path", statePath]);
  assert.equal(validated.exitCode, 1, validated.stdout);
  assert.match(validated.stdout, /unsupported schema: v4/);
  assert.equal(readFileSync(statePath, "utf8"), experimental, "validate-state must never write");

  const read = cli(["read-state", "--path", statePath]);
  assert.equal(read.exitCode, 1, read.stdout);
  assert.match(read.stdout, /unsupported schema: v4/);
  assert.equal(readFileSync(statePath, "utf8"), experimental, "read-state must never rewrite");
});

test("CLI --help shows usage", () => {
  const r = cli(["--help"]);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /read-state/);
  assert.match(r.stdout, /write-state/);
  assert.match(r.stdout, /validate-state/);
});

test("CLI write-state --help documents every canonical v0.0.3 field", () => {
  const r = cli(["--help", "write-state"]);
  assert.equal(r.exitCode, 0);
  for (const field of STATE_FIELD_ORDER) {
    assert.match(r.stdout, new RegExp(`^\\s+${field}$`, "m"), `--help must list ${field}`);
  }
  // Constraints an agent cannot guess from the field name alone.
  assert.match(r.stdout, /wip\/<feature>/, "--help must state the wip_branch rule");
  assert.match(r.stdout, /"none"/, "--help must state the unset-field sentinel");
  assert.match(r.stdout, /--json-file/, "--help must prefer the shell-safe input");
});

test("CLI write-state --json-file creates valid file", () => {
  const { scratch } = tmpFeatureDir();
  const jsonPath = join(scratch, ".state-input.json");
  writeFileSync(jsonPath, JSON.stringify(VALID_STATE));
  const r = cli(["write-state", "--feature-dir", scratch, "--json-file", jsonPath]);
  assert.equal(r.exitCode, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.feature, "test-feature");
});

test("CLI write-state --json-file rejects missing file", () => {
  const { scratch } = tmpFeatureDir();
  const r = cli(["write-state", "--feature-dir", scratch, "--json-file", "/nonexistent.json"]);
  assert.equal(r.exitCode, 2);
  assert.match(r.stdout, /ENOENT/, "error must forward the underlying cause");
  assert.match(r.stdout, /nonexistent\.json/, "error must name the offending file");
});

test("CLI write-state --json-file rejects non-JSON content", () => {
  const { scratch } = tmpFeatureDir();
  const jsonPath = join(scratch, ".state-input.json");
  writeFileSync(jsonPath, "{broken, not json");
  const r = cli(["write-state", "--feature-dir", scratch, "--json-file", jsonPath]);
  assert.equal(r.exitCode, 2);
  assert.match(r.stdout, /invalid JSON/);
  assert.match(r.stdout, /state-input\.json/, "error must name the offending file");
  assert.equal(existsSync(join(scratch, "state.toon")), false, "no state.toon may be written");
});

test("CLI write-state --json and --json-file are mutually exclusive", () => {
  const { scratch } = tmpFeatureDir();
  const jsonPath = join(scratch, ".state-input.json");
  writeFileSync(jsonPath, JSON.stringify(VALID_STATE));
  const r = cli(["write-state", "--feature-dir", scratch, "--json", "{}", "--json-file", jsonPath]);
  assert.equal(r.exitCode, 2);
  assert.match(r.stdout, /mutually exclusive/);
});

test("CLI write-state --json-file survives apostrophes and multiline JSON", () => {
  const { scratch } = tmpFeatureDir();
  const state = { ...VALID_STATE, next_action: "review user's fix for O'Brien" };
  const jsonPath = join(scratch, ".state-input.json");
  writeFileSync(jsonPath, JSON.stringify(state, null, 2) + "\n");
  const r = cli(["write-state", "--feature-dir", scratch, "--json-file", jsonPath]);
  assert.equal(r.exitCode, 0);
  const raw = readFileSync(join(scratch, "state.toon"), "utf8");
  assert.ok(raw.includes("review user's fix for O'Brien"), "apostrophes must survive round-trip");
});

test("CLI write-state --json-file rejects newline inside state field value", () => {
  const { scratch } = tmpFeatureDir();
  const state = { ...VALID_STATE, next_action: "start\ntask T1" };
  const jsonPath = join(scratch, ".state-input.json");
  writeFileSync(jsonPath, JSON.stringify(state));
  const r = cli(["write-state", "--feature-dir", scratch, "--json-file", jsonPath]);
  assert.equal(r.exitCode, 1, "literal newline in field value must be rejected");
  // Must not overwrite a valid state.toon — write the valid one first.
  const r2 = cli(["write-state", "--feature-dir", scratch, "--json", JSON.stringify(VALID_STATE)]);
  assert.equal(r2.exitCode, 0);
  const before = readFileSync(join(scratch, "state.toon"), "utf8");
  const r3 = cli(["write-state", "--feature-dir", scratch, "--json-file", jsonPath]);
  assert.equal(r3.exitCode, 1);
  const after = readFileSync(join(scratch, "state.toon"), "utf8");
  assert.equal(before, after, "rejected write must not replace existing valid state.toon");
});

test("CLI missing --json and --json-file gives usage error", () => {
  const { scratch } = tmpFeatureDir();
  const r = cli(["write-state", "--feature-dir", scratch]);
  assert.equal(r.exitCode, 2);
  assert.match(r.stdout, /--json or --json-file is required/);
});

// ─── Direct API tests (programmatic, no CLI) ──────────────────────────

test("parseState rejects = separator", () => {
  assert.throws(
    () => parseState("feature=bad\nphase=wrong"),
    /malformed row: feature=bad/,
  );
});

test("serializeState produces colon-separated output", () => {
  const result = serializeState(VALID_STATE);
  const lines = result.trim().split("\n");
  for (const line of lines) {
    assert.match(line, /^[a-z0-9_]+:.+/);
  }
  assert.ok(result.startsWith("schema:v0.0.3\n"));
  assert.ok(result.endsWith("checkpoint_revision:1\n"));
});

test("validateState rejects invalid phase", () => {
  assert.throws(
    () => validateState({ ...VALID_STATE, phase: "invalid-phase" }),
    /unsupported phase/,
  );
});

test("detectCandidates attributes discovery defects to feature directory in fault-tolerant and strict modes", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-defect-label-"));
  try {
    const scratch = join(dir, ".scratch", "label-check");
    mkdirSync(scratch, { recursive: true });
    writeFileSync(join(scratch, "plan.md"), "# Plan\n");
    writeFileSync(join(scratch, "state.toon"), "schema:v0.0.3\nnot-a-real-field: x\n");

    const result = detectCandidates(dir, { faultTolerant: true });
    assert.equal(result.candidates.length, 0);
    assert.equal(result.defects.length, 1);
    assert.match(result.defects[0], /^state\.toon \(label-check\):/);
    assert.match(result.defects[0], /unknown key: not-a-real-field/);

    assert.throws(
      () => detectCandidates(dir),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /^state\.toon \(label-check\):/);
        assert.match(err.message, /unknown key: not-a-real-field/);
        return true;
      }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectCandidates surfaces packet-directory defects in strict mode and skips vanishing directories (AC-1)", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-defect-dir-"));
  const scratch = join(dir, ".scratch");
  mkdirSync(scratch, { recursive: true });

  const escapeTarget = join(dir, "escape-target");
  mkdirSync(escapeTarget);

  const featureDir = join(scratch, "symlink-feat");
  mkdirSync(featureDir);
  writeFileSync(join(featureDir, "plan.md"), "# Plan\n");
  writeFileSync(join(featureDir, "state.toon"), "schema:v0.0.3\nfeature:symlink-feat\nphase:executing\n");

  const origLstat = fs.lstatSync;
  try {
    // 1. Symlink defect: feature directory swapped to symlink between listing and validation
    let swapped = false;
    fs.lstatSync = (p, ...args) => {
      if (p === featureDir && !swapped) {
        swapped = true;
        rmSync(featureDir, { recursive: true, force: true });
        symlinkSync(escapeTarget, featureDir);
      }
      return origLstat.call(fs, p, ...args);
    };

    // Strict mode must throw naming the feature and indicating symlink rejection
    assert.throws(
      () => detectCandidates(dir),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /^state\.toon: symlink-feat: featureDir symlink rejected/);
        return true;
      }
    );

    // Fault-tolerant mode must NOT throw on the same symlinked fixture
    const ftResult = detectCandidates(dir, { faultTolerant: true });
    assert.deepEqual(ftResult.candidates, []);

    // 2. Vanishing directory: feature directory removed between listing and validation
    const vanishDir = join(scratch, "vanish-feat");
    mkdirSync(vanishDir);
    writeFileSync(join(vanishDir, "plan.md"), "# Plan\n");
    writeFileSync(join(vanishDir, "state.toon"), "schema:v0.0.3\nfeature:vanish-feat\nphase:executing\n");

    let deleted = false;
    fs.lstatSync = (p, ...args) => {
      if (p === vanishDir && !deleted) {
        deleted = true;
        rmSync(vanishDir, { recursive: true, force: true });
      }
      return origLstat.call(fs, p, ...args);
    };

    // Strict mode must NOT throw when directory vanishes (ENOENT / does not exist)
    const vanishResult = detectCandidates(dir);
    assert.deepEqual(vanishResult.candidates, []);
  } finally {
    fs.lstatSync = origLstat;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── State set command & default next_action ─────────────────────────────

test("DEFAULT_PHASE_NEXT_ACTIONS defines required canonical defaults", () => {
  assert.equal(DEFAULT_PHASE_NEXT_ACTIONS.approved, "start/continue task");
  assert.equal(DEFAULT_PHASE_NEXT_ACTIONS.executing, "start/continue task");
  assert.equal(DEFAULT_PHASE_NEXT_ACTIONS.paused, "start/continue task");
  assert.equal(DEFAULT_PHASE_NEXT_ACTIONS.verifying, "enter terminal verification/repair");
  assert.equal(DEFAULT_PHASE_NEXT_ACTIONS.repair, "enter terminal verification/repair");
  assert.equal(DEFAULT_PHASE_NEXT_ACTIONS.ready, "ask merge or pull request");
  assert.equal(defaultNextActionForPhase("approved"), "start/continue task");
  assert.equal(defaultNextActionForPhase("unknown-phase"), null);
});

test("CLI set creates new approved packet with default next_action and matches write-state bytes (AC-4)", () => {
  const { scratch: scratchSet } = tmpFeatureDir("test-feature");
  const { scratch: scratchWrite } = tmpFeatureDir("test-feature");

  // 1. Invocation 1: set new approved packet omitting next_action
  const rSet1 = cli([
    "set",
    "--feature-dir", scratchSet,
    "phase=approved",
    "base_ref=main",
  ]);
  assert.equal(rSet1.exitCode, 0, `set failed: ${rSet1.stderr || rSet1.stdout}`);
  const parsedSet1 = JSON.parse(rSet1.stdout);
  assert.equal(parsedSet1.phase, "approved");
  assert.equal(parsedSet1.next_action, "start/continue task");
  assert.equal(parsedSet1.feature, "test-feature");
  assert.equal(parsedSet1.checkpoint_revision, "1");

  // Equivalent write-state for comparison
  const expectedState1 = {
    schema: "v0.0.3",
    feature: "test-feature",
    owner: "none",
    phase: "approved",
    next_action: "start/continue task",
    plan_path: ".scratch/test-feature/plan.md",
    base_ref: "main",
    wip_branch: "wip/test-feature",
    last_green_task: "none",
    last_green_commit: "none",
    checkpoint_revision: "1",
  };
  const rWrite1 = cli([
    "write-state",
    "--feature-dir", scratchWrite,
    "--json", JSON.stringify(expectedState1),
  ]);
  assert.equal(rWrite1.exitCode, 0);
  const rawSet1 = readFileSync(join(scratchSet, "state.toon"), "utf8");
  const rawWrite1 = readFileSync(join(scratchWrite, "state.toon"), "utf8");
  assert.equal(rawSet1, rawWrite1, "set and write-state must produce byte-identical state.toon for approved phase");

  // 2. Invocation 2: advance same packet to ready omitting next_action
  const rSet2 = cli([
    "set",
    "--feature-dir", scratchSet,
    "phase=ready",
  ]);
  assert.equal(rSet2.exitCode, 0, `set advance failed: ${rSet2.stderr || rSet2.stdout}`);
  const parsedSet2 = JSON.parse(rSet2.stdout);
  assert.equal(parsedSet2.phase, "ready");
  assert.equal(parsedSet2.next_action, "ask merge or pull request");
  assert.equal(parsedSet2.checkpoint_revision, "2");

  // Equivalent write-state for ready
  const expectedState2 = {
    ...expectedState1,
    phase: "ready",
    next_action: "ask merge or pull request",
    checkpoint_revision: "2",
  };
  const rWrite2 = cli([
    "write-state",
    "--feature-dir", scratchWrite,
    "--json", JSON.stringify(expectedState2),
  ]);
  assert.equal(rWrite2.exitCode, 0);
  const rawSet2 = readFileSync(join(scratchSet, "state.toon"), "utf8");
  const rawWrite2 = readFileSync(join(scratchWrite, "state.toon"), "utf8");
  assert.equal(
    rawSet2,
    rawWrite2,
    "set and write-state must produce byte-identical state.toon for ready phase"
  );
});

test("CLI set allows explicit next_action override", () => {
  const { scratch } = tmpFeatureDir("test-feature");
  const r = cli([
    "set",
    "--feature-dir", scratch,
    "phase=approved",
    "base_ref=main",
    "next_action=custom start action",
  ]);
  assert.equal(r.exitCode, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.next_action, "custom start action");
});

test("CLI set rejects unknown keys with usage error", () => {
  const { scratch } = tmpFeatureDir("test-feature");
  const r = cli([
    "set",
    "--feature-dir", scratch,
    "phase=approved",
    "unknown_key=foo",
  ]);
  assert.equal(r.exitCode, 2, "unknown key must exit 2 (usage error)");
  assert.match(r.stdout, /unknown key/);
});

test("CLI set rejects missing feature-dir", () => {
  const r = cli(["set", "phase=approved"]);
  assert.equal(r.exitCode, 2);
  assert.match(r.stdout, /--feature-dir is required/);
});

test("CLI set rejects argument without '='", () => {
  const { scratch } = tmpFeatureDir("test-feature");
  const r = cli(["set", "--feature-dir", scratch, "invalidarg"]);
  assert.equal(r.exitCode, 2);
  assert.match(r.stdout, /expected key=value/);
});

test("CLI set --help documents command usage", () => {
  const r = cli(["--help", "set"]);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /set --feature-dir/);
});

test("CLI set updates checkpoint fields without phase change and preserves existing next_action", () => {
  const { scratch } = tmpFeatureDir("test-feature");
  const commit = "a".repeat(40);
  
  // Setup initial approved packet
  const rInit = cli([
    "set",
    "--feature-dir", scratch,
    "phase=approved",
    "base_ref=main",
    "next_action=custom action",
  ]);
  assert.equal(rInit.exitCode, 0);
  
  // Update last green task/commit without touching phase
  const rUpdate = cli([
    "set",
    "--feature-dir", scratch,
    "last_green_task=T1",
    `last_green_commit=${commit}`,
  ]);
  assert.equal(rUpdate.exitCode, 0);
  const parsed = JSON.parse(rUpdate.stdout);
  assert.equal(parsed.last_green_task, "T1");
  assert.equal(parsed.last_green_commit, commit);
  assert.equal(parsed.checkpoint_revision, "2");
  assert.equal(parsed.next_action, "custom action", "next_action should be preserved when phase is unchanged");
});

test("CLI set records the session owner and rejects a malformed owner token", () => {
  const { scratch } = tmpFeatureDir("test-feature");
  const r = cli(["set", "--feature-dir", scratch, "base_ref=main", "owner=claude-3f2a:9"]);
  assert.equal(r.exitCode, 0, r.stdout);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.phase, "approved", "a new packet starts approved");
  assert.equal(parsed.owner, "claude-3f2a:9");
  assert.equal(parsed.plan_path, ".scratch/test-feature/plan.md");
  assert.equal(parsed.wip_branch, "wip/test-feature");

  const bad = cli(["set", "--feature-dir", scratch, "--takeover", "owner=has space"]);
  assert.equal(bad.exitCode, 1);
  assert.match(bad.stdout, /invalid owner/);
});

// Session A handed the packet to session B; A's next checkpoint must not silently take it back.
test("CLI set refuses to replace another session's owner without --takeover", () => {
  const { scratch } = tmpFeatureDir("test-feature");
  assert.equal(cli(["set", "--feature-dir", scratch, "base_ref=main", "owner=claude-a"]).exitCode, 0);
  const same = cli(["set", "--feature-dir", scratch, "owner=claude-a", "next_action=custom"]);
  assert.equal(same.exitCode, 0, same.stdout);
  const steal = cli(["set", "--feature-dir", scratch, "owner=codex-b"]);
  assert.equal(steal.exitCode, 1);
  assert.match(steal.stdout, /code: owner-mismatch/);
  assert.match(steal.stdout, /owned by claude-a, not codex-b/);
  assert.match(steal.stdout, /--takeover/);
  const taken = cli(["set", "--feature-dir", scratch, "--takeover", "owner=codex-b"]);
  assert.equal(taken.exitCode, 0, taken.stdout);
  assert.equal(JSON.parse(taken.stdout).owner, "codex-b");
  assert.match(cli(["set", "--feature-dir", scratch, "owner=claude-a"]).stdout, /owner-mismatch/);

  // The fallback writer is no way around the rule.
  const current = JSON.parse(cli(["read-state", "--path", join(scratch, "state.toon")]).stdout);
  const viaJson = cli(["write-state", "--feature-dir", scratch, "--json", JSON.stringify({ ...current, owner: "claude-a" })]);
  assert.equal(viaJson.exitCode, 1);
  assert.match(viaJson.stdout, /code: owner-mismatch/);
  assert.match(viaJson.stdout, /rerun this write-state with --takeover/);
  const viaJsonTaken = cli(["write-state", "--feature-dir", scratch, "--takeover", "--json", JSON.stringify({ ...current, owner: "claude-a" })]);
  assert.equal(viaJsonTaken.exitCode, 0, viaJsonTaken.stdout);
});

test("detectCandidates with an owner lists only that session's packets", () => {
  const root = mkdtempSync(join(tmpdir(), "gsd-owner-"));
  for (const [feature, owner] of [["mine-a", "omp-s1"], ["theirs", "omp-s2"], ["unowned", "none"], ["mine-b", "omp-s1"]]) {
    const dir = join(root, ".scratch", feature);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plan.md"), "# Plan\n");
    writeStateAtomic(dir, {
      ...VALID_STATE,
      feature,
      owner,
      plan_path: `.scratch/${feature}/plan.md`,
      wip_branch: `wip/${feature}`,
    });
  }
  assert.deepEqual(detectCandidates(root, { owner: "omp-s1" }).candidates, ["mine-a", "mine-b"]);
  assert.deepEqual(detectCandidates(root, { owner: "omp-s3" }).candidates, []);
  assert.deepEqual(detectCandidates(root).candidates, ["mine-a", "mine-b", "theirs", "unowned"]);
  rmSync(root, { recursive: true, force: true });
});

test("CLI set rejects invalid field values with artifact error (exit 1)", () => {
  const { scratch } = tmpFeatureDir("test-feature");
  const r = cli([
    "set",
    "--feature-dir", scratch,
    "phase=invalid_phase",
  ]);
  assert.equal(r.exitCode, 1, "validation failure should exit 1");
  assert.match(r.stdout, /unsupported phase/);
});

test("CLI set rejects --feature-dir without value (exit 2)", () => {
  const r = cli(["set", "--feature-dir"]);
  assert.equal(r.exitCode, 2);
  assert.match(r.stdout, /--feature-dir requires a value/);
});

// gsd-executing-plans § Pause and resume: pause keeps the interrupted `next_action`, because a
// paused terminal-verification packet must resume into verification and a Spec-escalation must
// still name its blocker. A derived default is only for phases that do not keep the action.
test("CLI set phase=paused keeps the interrupted next_action", () => {
  for (const interrupted of ["enter terminal verification/repair", "Spec-escalation"]) {
    const { scratch } = tmpFeatureDir("test-feature");
    assert.equal(cli(["set", "--feature-dir", scratch, "phase=approved", "base_ref=main"]).exitCode, 0);
    const before = cli(["set", "--feature-dir", scratch, "phase=verifying", `next_action=${interrupted}`]);
    assert.equal(before.exitCode, 0, before.stderr || before.stdout);

    const paused = cli(["set", "--feature-dir", scratch, "phase=paused"]);
    assert.equal(paused.exitCode, 0, paused.stderr || paused.stdout);
    const state = JSON.parse(paused.stdout);
    assert.equal(state.phase, "paused");
    assert.equal(state.next_action, interrupted);

    const resumed = JSON.parse(cli(["set", "--feature-dir", scratch, "phase=executing"]).stdout);
    assert.equal(resumed.next_action, "start/continue task", "leaving pause derives the default again");
  }
});

// `fs.writeSync` may write fewer bytes than asked when a quota or a full disk interrupts it, and
// it throws on ENOSPC. The state file is renamed into place before it is read back, so an
// ignored short write replaced the last valid state with a truncated one, and a throw left a
// dot-temp file beside it.
function withPatchedWriteSync(patch, body) {
  const real = fs.writeSync;
  fs.writeSync = patch(real);
  try {
    return body();
  } finally {
    fs.writeSync = real;
  }
}

const leftoverTemps = (scratch) => fs.readdirSync(scratch).filter((name) => name.endsWith(".tmp"));

test("writeStateAtomic completes a short write instead of committing a truncated state", () => {
  const { scratch } = tmpFeatureDir("test-feature");
  let shortened = 0;
  const written = withPatchedWriteSync(
    (real) => (fd, data, ...rest) => {
      if (shortened === 0 && typeof data === "string" && data.length > 10) {
        shortened += 1;
        return real(fd, data.slice(0, 10), 0, "utf8");
      }
      if (shortened === 0 && Buffer.isBuffer(data) && data.length - rest[0] > 10) {
        shortened += 1;
        return real(fd, data, rest[0], 10, rest[2]);
      }
      return real(fd, data, ...rest);
    },
    () => writeStateAtomic(scratch, VALID_STATE),
  );
  assert.equal(shortened, 1, "the write was interrupted once");
  assert.equal(written.feature, "test-feature");
  assert.deepEqual(readStateFile(join(scratch, "state.toon")), written);
  assert.deepEqual(leftoverTemps(scratch), []);
});

test("writeStateAtomic keeps the previous state and leaves no temp file when the write fails", () => {
  const { scratch } = tmpFeatureDir("test-feature");
  writeStateAtomic(scratch, VALID_STATE);
  const before = readFileSync(join(scratch, "state.toon"), "utf8");

  assert.throws(
    () =>
      withPatchedWriteSync(
        () => () => {
          throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
        },
        () => writeStateAtomic(scratch, { ...VALID_STATE, checkpoint_revision: "2" }),
      ),
    /ENOSPC/,
  );
  assert.equal(readFileSync(join(scratch, "state.toon"), "utf8"), before);
  assert.deepEqual(leftoverTemps(scratch), []);
});

test("a write-side system failure is an io-error, not an invalid artifact", () => {
  // `sanitizeStateError` rebuilt every write failure as a bare Error, so a full disk or a
  // read-only directory reached the CLI labelled `invalid-artifact` and sent the caller to
  // repair a state file that was never the problem.
  const { scratch } = tmpFeatureDir("test-feature");
  writeStateAtomic(scratch, VALID_STATE);
  let failure;
  try {
    withPatchedWriteSync(
      () => () => {
        throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
      },
      () => writeStateAtomic(scratch, { ...VALID_STATE, checkpoint_revision: "2" }),
    );
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.contractFailure, "io-error");

  // A contract violation stays an artifact defect.
  let invalid;
  try {
    writeStateAtomic(scratch, { ...VALID_STATE, phase: "not-a-phase" });
  } catch (error) {
    invalid = error;
  }
  assert.ok(invalid, "an invalid phase is rejected");
  assert.equal(invalid.contractFailure, undefined);
});

test("CLI set reports io-error when the feature directory is read-only", () => {
  if (process.platform === "win32" || process.getuid?.() === 0) return;
  const { dir, scratch } = tmpFeatureDir("test-feature");
  writeStateAtomic(scratch, VALID_STATE);
  fs.chmodSync(scratch, 0o555);
  try {
    const r = cli(["set", "--feature-dir", scratch, "owner=claude-test", "phase=approved"]);
    assert.equal(r.exitCode, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /code: io-error/);
  } finally {
    fs.chmodSync(scratch, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});
