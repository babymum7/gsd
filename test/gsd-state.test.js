import { test } from "bun:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, writeFileSync, readFileSync, mkdirSync, readdirSync, rmSync, existsSync, symlinkSync } from "node:fs";
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
  schema: "v4",
  feature: "test-feature",
  phase: "approved",
  next_action: "start task T1",
  plan_path: ".scratch/test-feature/plan.md",
  plan_sha256: "9f442276796394adad4621299c7dc29d70e910975e8f065d5bff894686d4d386",
  base_ref: "main",
  wip_branch: "wip/test-feature",
  last_green_task: "none",
  last_green_commit: "none",
  autosync: "none",
  cleanup_preference: "none",
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
    "schema:v4",
    "feature:test-feature",
    // phase missing
    "next_action:none",
    "plan_path:.scratch/test-feature/plan.md",
    "plan_sha256:9f442276796394adad4621299c7dc29d70e910975e8f065d5bff894686d4d386",
    "base_ref:main",
    "wip_branch:wip/test-feature",
    "last_green_task:none",
    "last_green_commit:none",
    "autosync:none",
    "cleanup_preference:none",
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
    "schema:v4",
    "phase:approved",
    "next_action:start task T1",
    "plan_path:.scratch/test-feature/plan.md",
    "plan_sha256:9f442276796394adad4621299c7dc29d70e910975e8f065d5bff894686d4d386",
    "base_ref:main",
    "wip_branch:wip/test-feature",
    "last_green_task:none",
    "last_green_commit:none",
    "autosync:none",
    "cleanup_preference:none",
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
    "schema:v4",
    "feature:test-feature",
    "phase:approved",
    "plan_hash:some-hash",  // unknown key
    "next_action:start task T1",
    "plan_path:.scratch/test-feature/plan.md",
    "plan_sha256:9f442276796394adad4621299c7dc29d70e910975e8f065d5bff894686d4d386",
    "base_ref:main",
    "wip_branch:wip/test-feature",
    "last_green_task:none",
    "last_green_commit:none",
    "autosync:none",
    "cleanup_preference:none",
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
    "schema:v4",
    "feature:INVALID_FEATURE",
    "phase:approved",
    "next_action:start task T1",
    "plan_path:.scratch/test-feature/plan.md",
    "plan_sha256:9f442276796394adad4621299c7dc29d70e910975e8f065d5bff894686d4d386",
    "base_ref:main",
    "wip_branch:wip/test-feature",
    "last_green_task:none",
    "last_green_commit:none",
    "autosync:none",
    "cleanup_preference:none",
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
    "schema:v4",
    "feature:test-feature",
    "phase:approved",
    "next_action:start task T1",
    "plan_path:.scratch/test-feature/plan.md",
    "plan_sha256:9f442276796394adad4621299c7dc29d70e910975e8f065d5bff894686d4d386",
    "base_ref:main",
    "wip_branch:wip/wrong-feature",
    "last_green_task:none",
    "last_green_commit:none",
    "autosync:none",
    "cleanup_preference:none",
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
  writeFileSync(join(scratch, "state.toon"), "schema:v4\n\nfeature:test-feature\n");
  const r = cli(["validate-state", "--path", join(scratch, "state.toon")]);
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /blank lines are not allowed/);
});

test("rejects carriage return line endings", () => {
  const { scratch } = tmpFeatureDir();
  writeFileSync(join(scratch, "state.toon"), "schema:v4\r\nfeature:test-feature\r\n");
  const r = cli(["validate-state", "--path", join(scratch, "state.toon")]);
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /carriage return rejected/);
});

// ─── Canonical v4 write/readback ──────────────────────────────────────

test("writeStateAtomic produces canonical TOON format", () => {
  const { scratch } = tmpFeatureDir();
  const _result = writeStateAtomic(scratch, VALID_STATE);
  const raw = readFileSync(join(scratch, "state.toon"), "utf8");

  const lines = raw.trim().split("\n");
  assert.equal(lines.length, 13, "should have exactly 13 fields");
  for (const line of lines) {
    assert.match(line, /^[a-z0-9_]+:.+/, `line should be key:value format: ${line}`);
    assert.ok(!line.includes("="), `should not use = separator: ${line}`);
  }

  const expectedOrder = [
    "schema", "feature", "phase", "next_action", "plan_path", "plan_sha256",
    "base_ref", "wip_branch", "last_green_task", "last_green_commit",
    "autosync", "cleanup_preference", "checkpoint_revision",
  ];
  const actualOrder = lines.map(l => l.split(":")[0]);
  assert.deepEqual(actualOrder, expectedOrder, "fields must be in canonical order");
});

test("writeStateAtomic readback matches input", () => {
  const { scratch } = tmpFeatureDir();
  const written = writeStateAtomic(scratch, VALID_STATE);
  const read = readStateFile(join(scratch, "state.toon"));
  assert.deepEqual(read, written);
  assert.equal(read.schema, "v4");
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
  assert.equal(parsed.schema, "v4");
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
  assert.equal(parsed.schema, "v4");
  assert.equal(parsed.feature, "test-feature");

  const raw = readFileSync(join(scratch, "state.toon"), "utf8");
  assert.ok(raw.startsWith("schema:v4\n"), "file should start with schema:v4");
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
    "--json", JSON.stringify({ schema: "v4", feature: "test-feature" }),
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
  writeFileSync(alias, "schema:v4\n");
  const r = cli(["validate-state", "--path", alias]);
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /expected state\.toon/);
});

test("CLI validate-state reports a legacy packet without migrating it; read-state migrates", () => {
  const { scratch } = tmpFeatureDir();
  const statePath = join(scratch, "state.toon");
  const legacyV3 = [
    "schema:v3",
    "feature:test-feature",
    "phase:executing",
    "next_action:continue task T1",
    "plan_path:.scratch/test-feature/plan.md",
    "plan_sha256:9f442276796394adad4621299c7dc29d70e910975e8f065d5bff894686d4d386",
    "base_ref:main",
    "wip_branch:wip/test-feature",
    "last_green_task:none",
    "last_green_commit:none",
    "autosync:none",
    "ponytail_level:none",
    "cleanup_preference:none",
    "checkpoint_revision:1",
    "",
  ].join("\n");
  writeFileSync(statePath, legacyV3);

  const validated = cli(["validate-state", "--path", statePath]);
  assert.equal(validated.exitCode, 0, validated.stderr);
  assert.equal(JSON.parse(validated.stdout).schema, "v4", "validate-state reports the migrated shape");
  assert.equal(readFileSync(statePath, "utf8"), legacyV3, "validate-state must never write");

  const migrated = cli(["read-state", "--path", statePath]);
  assert.equal(migrated.exitCode, 0, migrated.stderr);
  assert.match(readFileSync(statePath, "utf8"), /^schema:v4\n/, "read-state migrates in place");
});

test("CLI --help shows usage", () => {
  const r = cli(["--help"]);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /read-state/);
  assert.match(r.stdout, /write-state/);
  assert.match(r.stdout, /validate-state/);
});

test("CLI write-state --help documents every canonical v4 field", () => {
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
  assert.ok(result.startsWith("schema:v4\n"));
  assert.ok(result.endsWith("checkpoint_revision:1\n"));
});

test("validateState rejects invalid phase", () => {
  assert.throws(
    () => validateState({ ...VALID_STATE, phase: "invalid-phase" }),
    /unsupported phase/,
  );
});

// ─── Guard: all skill state-write paths use CLI ───────────────────────


const SKILLS_DIR = join(__dirname, "..", "skills");
const GSD_SKILL_DIR = join(SKILLS_DIR, "gsd");

function getSkillNames() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

// Collect all lifecycle Markdown files: every skills/*/SKILL.md plus
// skills/gsd/REFERENCE.md and skills/gsd/SKILL.md (bootstrap).
function getLifecycleMarkdownFiles() {
  const files = [];
  for (const name of getSkillNames()) {
    const p = join(SKILLS_DIR, name, "SKILL.md");
    try { readFileSync(p, "utf8"); files.push(p); } catch {}
  }
  for (const extra of ["REFERENCE.md", "SKILL.md"]) {
    const p = join(GSD_SKILL_DIR, extra);
    try { readFileSync(p, "utf8"); files.push(p); } catch {}
  }
  return [...new Set(files)];
}

// Mutation verbs targeting state.toon, .scratch paths, or phase= writes.
// Bounded .{0,60}? between verb and target catches "Persist `key` in `state.toon`".
const STATE_WRITE_RE = /(?:atomically\s+)?(?:write|update|persist)\b.{0,60}?(?:`[^`]*`(?:\.scratch|\/state\.toon)|`[^`]*state\.toon|`phase=)/gi;
const ALLOWED_RE = /gsd-state\.mjs|write-state|gsd-handoff/gi;

// Scan lines in a file for unguarded state-write instructions.
// Table rows are split into cells and scanned independently to avoid
// cross-cell false positives while still catching per-cell mutations.
function findViolations(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```") || line.startsWith("    ")) continue;
    const cells = line.startsWith("|") ? line.split("|").filter(c => c.trim()) : [line];
    for (const cell of cells) {
      STATE_WRITE_RE.lastIndex = 0;
      if (STATE_WRITE_RE.test(cell)) {
        ALLOWED_RE.lastIndex = 0;
        if (!ALLOWED_RE.test(line)) {
          violations.push(`${i + 1}: ${line.trim()}`);
          break;
        }
      }
    }
  }
  return violations;
}

// Unit-test the detector against known fixture lines so the guard itself
// cannot silently regress due to regex or logic drift.
test("state-write detector catches bare mutation verbs", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-guard-"));
  const p = join(dir, "test.md");
  writeFileSync(p, [
    "Normal line",
    "Write atomic `.scratch/foo/state.toon`",        // should catch
    "atomically write `feature`/state.toon",          // should catch
    "update `bar`/state.toon directly",               // should catch
    "Persist `baz`/state.toon when chosen",           // should catch
    "write `phase=merged-cleanup-pending`",           // should catch
    "| foo | write `state.toon` directly | bar |",    // should catch (mutation in one cell)
    "| Pre-plan state write | — | `state.toon` |",    // should NOT catch (verb and target in different cells)
    "| Persist `cleanup_preference` in `state.toon` | via gsd-state.mjs |", // should NOT catch (allowed in same row)
    "Persist `cleanup_preference` in `state.toon` when chosen (via `gsd-state.mjs write-state`)", // should NOT catch (allowed)
    "write `phase=approved` via gsd-handoff",         // should NOT catch (allowed)
    "    write `x`/state.toon",                       // code block — skip
  ].join("\n"));
  const violations = findViolations(p);
  assert.deepEqual(violations, [
    "2: Write atomic `.scratch/foo/state.toon`",
    "3: atomically write `feature`/state.toon",
    "4: update `bar`/state.toon directly",
    "5: Persist `baz`/state.toon when chosen",
    "6: write `phase=merged-cleanup-pending`",
    "7: | foo | write `state.toon` directly | bar |",
  ]);
  rmSync(dir, { recursive: true, force: true });
});

test("every lifecycle Markdown file's state-write instructions use the CLI or delegate to gsd-handoff", () => {
  const violations = [];
  for (const filePath of getLifecycleMarkdownFiles()) {
    const rel = filePath.replace(SKILLS_DIR + "/", "");
    for (const v of findViolations(filePath)) {
      violations.push(`${rel}:${v}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Found state.toon write instructions without gsd-state.mjs/gsd-handoff:\n${violations.join("\n")}`
  );
});

test("detectCandidates surfaces a ledger-only feature for milestone recovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-milestone-discovery-"));
  const ledger = (rows) => [
    "# Milestones", "", "## Feature", "", "`demo-feature`", "", "## Base", "", "`main`", "",
    "## Milestones", "", "| ID | Slug | Goal | Status |", "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n") + "\n";
  const docsDir = join(dir, "docs", "gsd", "demo-feature");
  mkdirSync(docsDir, { recursive: true });

  // A pending ledger with no scratch packet is an incomplete feature to recover.
  writeFileSync(join(docsDir, "milestones.md"), ledger([
    "| M1 | auth-login | Add password login | done |",
    "| M2 | auth-mfa | Add MFA enrollment | pending |",
  ]));
  assert.deepEqual(detectCandidates(dir).candidates, ["demo-feature"]);

  // An all-done ledger is a stale residual, not an active candidate.
  writeFileSync(join(docsDir, "milestones.md"), ledger(["| M1 | auth-login | Add password login | done |"]));
  assert.deepEqual(detectCandidates(dir).candidates, []);

  // A ledger whose Feature slug does not match its directory is not authoritative.
  writeFileSync(join(docsDir, "milestones.md"), ledger(["| M1 | auth-login | Add password login | pending |"]).replace("`demo-feature`", "`other-feature`"));
  assert.deepEqual(detectCandidates(dir).candidates, []);

  // An existing scratch packet is the lifecycle authority and is never shadowed by a ledger.
  writeFileSync(join(docsDir, "milestones.md"), ledger(["| M1 | auth-login | Add password login | pending |"]));
  const scratch = join(dir, ".scratch", "demo-feature");
  mkdirSync(scratch, { recursive: true });
  writeFileSync(join(scratch, "plan.md"), "# Plan\n");
  assert.deepEqual(detectCandidates(dir).candidates, []);

  // Discovery from an explicit cwd different from process.cwd() still finds the ledger.
  const otherDir = mkdtempSync(join(tmpdir(), "gsd-milestone-other-"));
  const ledgerDir = join(otherDir, "docs", "gsd", "demo-feature");
  mkdirSync(ledgerDir, { recursive: true });
  writeFileSync(join(ledgerDir, "milestones.md"), ledger(["| M1 | auth-login | Add password login | pending |"]));
  const previousCwd = process.cwd();
  try {
    assert.deepEqual(detectCandidates(otherDir).candidates, ["demo-feature"]);
  } finally {
    rmSync(otherDir, { recursive: true, force: true });
    process.chdir(previousCwd);
  }

  rmSync(dir, { recursive: true, force: true });
});

test("detectCandidates attributes discovery defects to feature directory in fault-tolerant and strict modes", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-defect-label-"));
  try {
    const scratch = join(dir, ".scratch", "label-check");
    mkdirSync(scratch, { recursive: true });
    writeFileSync(join(scratch, "plan.md"), "# Plan\n");
    writeFileSync(join(scratch, "state.toon"), "schema:v9\nnot-a-real-field: x\n");

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
  writeFileSync(join(featureDir, "state.toon"), "schema:v4\nfeature:symlink-feat\nphase:executing\n");

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
    writeFileSync(join(vanishDir, "state.toon"), "schema:v4\nfeature:vanish-feat\nphase:executing\n");

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
  assert.equal(DEFAULT_PHASE_NEXT_ACTIONS.draft, "converge acceptance criteria");
  assert.equal(DEFAULT_PHASE_NEXT_ACTIONS.approved, "start/continue task");
  assert.equal(DEFAULT_PHASE_NEXT_ACTIONS.executing, "start/continue task");
  assert.equal(DEFAULT_PHASE_NEXT_ACTIONS.paused, "start/continue task");
  assert.equal(DEFAULT_PHASE_NEXT_ACTIONS.verifying, "enter terminal verification/repair");
  assert.equal(DEFAULT_PHASE_NEXT_ACTIONS.repair, "enter terminal verification/repair");
  assert.equal(
    DEFAULT_PHASE_NEXT_ACTIONS["merged-cleanup-pending"],
    "complete delete cleanup of the scratch packet and wip branch"
  );
  assert.equal(DEFAULT_PHASE_NEXT_ACTIONS["completed-retained"], "none");
  assert.equal(defaultNextActionForPhase("approved"), "start/continue task");
  assert.equal(defaultNextActionForPhase("unknown-phase"), null);
});

test("CLI set creates new approved packet with default next_action and matches write-state bytes (AC-4)", () => {
  const { scratch: scratchSet } = tmpFeatureDir("test-feature");
  const { scratch: scratchWrite } = tmpFeatureDir("test-feature");
  const sha = "9f442276796394adad4621299c7dc29d70e910975e8f065d5bff894686d4d386";

  // 1. Invocation 1: set new approved packet omitting next_action
  const rSet1 = cli([
    "set",
    "--feature-dir", scratchSet,
    "phase=approved",
    `plan_sha256=${sha}`,
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
    schema: "v4",
    feature: "test-feature",
    phase: "approved",
    next_action: "start/continue task",
    plan_path: ".scratch/test-feature/plan.md",
    plan_sha256: sha,
    base_ref: "main",
    wip_branch: "wip/test-feature",
    last_green_task: "none",
    last_green_commit: "none",
    autosync: "none",
    cleanup_preference: "none",
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

  // 2. Invocation 2: advance same packet to merged-cleanup-pending omitting next_action
  const rSet2 = cli([
    "set",
    "--feature-dir", scratchSet,
    "phase=merged-cleanup-pending",
  ]);
  assert.equal(rSet2.exitCode, 0, `set advance failed: ${rSet2.stderr || rSet2.stdout}`);
  const parsedSet2 = JSON.parse(rSet2.stdout);
  assert.equal(parsedSet2.phase, "merged-cleanup-pending");
  assert.equal(
    parsedSet2.next_action,
    "complete delete cleanup of the scratch packet and wip branch"
  );
  assert.equal(parsedSet2.checkpoint_revision, "2");

  // Equivalent write-state for merged-cleanup-pending
  const expectedState2 = {
    ...expectedState1,
    phase: "merged-cleanup-pending",
    next_action: "complete delete cleanup of the scratch packet and wip branch",
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
    "set and write-state must produce byte-identical state.toon for merged-cleanup-pending phase"
  );
});

test("CLI set allows explicit next_action override", () => {
  const { scratch } = tmpFeatureDir("test-feature");
  const sha = "9f442276796394adad4621299c7dc29d70e910975e8f065d5bff894686d4d386";
  const r = cli([
    "set",
    "--feature-dir", scratch,
    "phase=approved",
    `plan_sha256=${sha}`,
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
  const sha = "9f442276796394adad4621299c7dc29d70e910975e8f065d5bff894686d4d386";
  const commit = "a".repeat(40);
  
  // Setup initial approved packet
  const rInit = cli([
    "set",
    "--feature-dir", scratch,
    "phase=approved",
    `plan_sha256=${sha}`,
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

test("CLI set creates draft packet with draft defaults", () => {
  const { scratch } = tmpFeatureDir("test-feature");
  const r = cli([
    "set",
    "--feature-dir", scratch,
    "phase=draft",
  ]);
  assert.equal(r.exitCode, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.phase, "draft");
  assert.equal(parsed.next_action, "converge acceptance criteria");
  assert.equal(parsed.plan_path, "none");
  assert.equal(parsed.plan_sha256, "none");
  assert.equal(parsed.base_ref, "none");
  assert.equal(parsed.wip_branch, "none");
});

test("CLI set creates completed-retained packet with next_action=none", () => {
  const { scratch } = tmpFeatureDir("test-feature");
  const sha = "9f442276796394adad4621299c7dc29d70e910975e8f065d5bff894686d4d386";
  const rInit = cli([
    "set",
    "--feature-dir", scratch,
    "phase=approved",
    `plan_sha256=${sha}`,
    "base_ref=main",
  ]);
  assert.equal(rInit.exitCode, 0);

  const rRetained = cli([
    "set",
    "--feature-dir", scratch,
    "phase=completed-retained",
  ]);
  assert.equal(rRetained.exitCode, 0);
  const parsed = JSON.parse(rRetained.stdout);
  assert.equal(parsed.phase, "completed-retained");
  assert.equal(parsed.next_action, "none");
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
