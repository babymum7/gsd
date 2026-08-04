import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
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
} from "../extensions/gsd-context.js";

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
    const result = execFileSync("node", [CLI, ...args], {
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
  assert.match(r.stderr, /malformed row/);
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
  assert.match(r.stderr, /missing required field: phase/);
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
  assert.match(r.stderr, /canonical order/);
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
  assert.match(r.stderr, /unknown key: plan_hash/);
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
  assert.match(r.stderr, /invalid feature slug/);
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
  assert.match(r.stderr, /wip_branch feature mismatch/);
  assert.match(r.stderr, /expected "wip\/test-feature"/, "error must name the expected branch");
});

test("rejects blank lines", () => {
  const { scratch } = tmpFeatureDir();
  writeFileSync(join(scratch, "state.toon"), "schema:v4\n\nfeature:test-feature\n");
  const r = cli(["validate-state", "--path", join(scratch, "state.toon")]);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /blank lines are not allowed/);
});

test("rejects carriage return line endings", () => {
  const { scratch } = tmpFeatureDir();
  writeFileSync(join(scratch, "state.toon"), "schema:v4\r\nfeature:test-feature\r\n");
  const r = cli(["validate-state", "--path", join(scratch, "state.toon")]);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /carriage return rejected/);
});

// ─── Canonical v4 write/readback ──────────────────────────────────────

test("writeStateAtomic produces canonical TOON format", () => {
  const { scratch } = tmpFeatureDir();
  const result = writeStateAtomic(scratch, VALID_STATE);
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
  assert.match(r.stderr, /invalid JSON/);
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
  assert.match(r.stderr, /--path is required/);
});

test("CLI missing command gives usage error", () => {
  const r = cli([]);
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /missing command/);
});

test("CLI flag without a value gives a naming usage error", () => {
  for (const flag of ["--path", "--feature-dir", "--json", "--json-file"]) {
    const r = cli(["write-state", flag]);
    assert.equal(r.exitCode, 2, `${flag} without value must be a usage error`);
    assert.match(r.stderr, new RegExp(`\\${flag} requires a value`), `${flag} must be named`);
  }
});

test("CLI validate-state rejects a path whose basename is not state.toon", () => {
  const { scratch } = tmpFeatureDir();
  const alias = join(scratch, "state.toon.bak");
  writeFileSync(alias, "schema:v4\n");
  const r = cli(["validate-state", "--path", alias]);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /expected state\.toon/);
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
  assert.match(r.stderr, /ENOENT/, "error must forward the underlying cause");
  assert.match(r.stderr, /nonexistent\.json/, "error must name the offending file");
});

test("CLI write-state --json-file rejects non-JSON content", () => {
  const { scratch } = tmpFeatureDir();
  const jsonPath = join(scratch, ".state-input.json");
  writeFileSync(jsonPath, "{broken, not json");
  const r = cli(["write-state", "--feature-dir", scratch, "--json-file", jsonPath]);
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /invalid JSON/);
  assert.match(r.stderr, /state-input\.json/, "error must name the offending file");
  assert.equal(existsSync(join(scratch, "state.toon")), false, "no state.toon may be written");
});

test("CLI write-state --json and --json-file are mutually exclusive", () => {
  const { scratch } = tmpFeatureDir();
  const jsonPath = join(scratch, ".state-input.json");
  writeFileSync(jsonPath, JSON.stringify(VALID_STATE));
  const r = cli(["write-state", "--feature-dir", scratch, "--json", "{}", "--json-file", jsonPath]);
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /mutually exclusive/);
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
  assert.match(r.stderr, /--json or --json-file is required/);
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
