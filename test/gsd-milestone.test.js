import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "tools", "gsd-milestone.mjs");

function ledgerContent(feature, base, rows) {
  return [
    "# Milestones",
    "",
    "## Feature",
    "",
    `\`${feature}\``,
    "",
    "## Base",
    "",
    `\`${base}\``,
    "",
    "## Milestones",
    "",
    "| ID | Slug | Goal | Status |",
    "| --- | --- | --- | --- |",
    ...rows.map(([id, slug, goal, status]) => `| ${id} | ${slug} | ${goal} | ${status} |`),
  ].join("\n") + "\n";
}

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

function tmpLedger(rows, { feature = "demo-feature", base = "main" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gsd-milestone-"));
  const path = join(dir, "milestones.md");
  writeFileSync(path, ledgerContent(feature, base, rows));
  return { dir, path };
}

test("validate accepts a done-prefix/pending-suffix ledger and reports first pending", () => {
  const { path } = tmpLedger([
    ["M1", "auth-login", "Add password login", "done"],
    ["M2", "auth-mfa", "Add MFA enrollment", "pending"],
    ["M3", "auth-recovery", "Add account recovery", "pending"],
  ]);
  const result = run(["validate", "--path", path, "--expected-feature", "demo-feature", "--expected-base", "main"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /status: valid/);
  assert.match(result.stdout, /feature: demo-feature/);
  assert.match(result.stdout, /base: main/);
  assert.match(result.stdout, /milestones: M1,M2,M3/);
  assert.match(result.stdout, /first_pending: M2/);
  rmSync(dirname(path), { recursive: true, force: true });
});

test("validate rejects a done row after a pending row", () => {
  const { path } = tmpLedger([
    ["M1", "auth-login", "Add password login", "pending"],
    ["M2", "auth-mfa", "Add MFA enrollment", "done"],
  ]);
  const result = run(["validate", "--path", path]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /code: invalid-ledger/);
  assert.match(result.stdout, /done row may not follow a pending row/);
  rmSync(dirname(path), { recursive: true, force: true });
});

test("validate rejects an all-done ledger as a stale residual", () => {
  const { path } = tmpLedger([["M1", "auth-login", "Add password login", "done"]]);
  const result = run(["validate", "--path", path]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /stale lifecycle residual/);
  rmSync(dirname(path), { recursive: true, force: true });
});

test("validate rejects feature and base mismatch", () => {
  const { path } = tmpLedger([["M1", "one", "First", "pending"]]);
  const feature = run(["validate", "--path", path, "--expected-feature", "other-feature"]);
  assert.equal(feature.status, 1);
  assert.match(feature.stdout, /## Feature is/);
  const base = run(["validate", "--path", path, "--expected-base", "develop"]);
  assert.equal(base.status, 1);
  assert.match(base.stdout, /## Base is/);
  rmSync(dirname(path), { recursive: true, force: true });
});

test("validate rejects malformed rows: non-sequential ID, bad slug, and extra columns", () => {
  const nonSequential = tmpLedger([["M2", "one", "First", "pending"]]);
  const a = run(["validate", "--path", nonSequential.path]);
  assert.equal(a.status, 1);
  assert.match(a.stdout, /must be sequential/);

  const badSlug = tmpLedger([["M1", "Not-Kebab", "First", "pending"]]);
  const b = run(["validate", "--path", badSlug.path]);
  assert.equal(b.status, 1);
  assert.match(b.stdout, /not a valid milestone row/);

  const extraColumnDir = mkdtempSync(join(tmpdir(), "gsd-milestone-"));
  const extraColumn = join(extraColumnDir, "milestones.md");
  writeFileSync(extraColumn, ledgerContent("demo-feature", "main", [["M1", "one", "First", "pending"]]).replace(
    /\| M1 \| one \| First \| pending \|\n$/,
    "| M1 | one | First | pending | extra |\n",
  ));
  const c = run(["validate", "--path", extraColumn]);
  assert.equal(c.status, 1);
  assert.match(c.stdout, /not a valid milestone row/);

  rmSync(dirname(nonSequential.path), { recursive: true, force: true });
  rmSync(dirname(badSlug.path), { recursive: true, force: true });
  rmSync(extraColumnDir, { recursive: true, force: true });
});

test("complete marks exactly the first pending row done and preserves every other byte", () => {
  const { path } = tmpLedger([
    ["M1", "auth-login", "Add password login", "done"],
    ["M2", "auth-mfa", "Add MFA enrollment", "pending"],
    ["M3", "auth-recovery", "Add account recovery", "pending"],
  ]);
  const before = readFileSync(path, "utf8");
  const result = run(["complete", "--path", path, "--expected-feature", "demo-feature", "--expected-base", "main"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /status: done/);
  assert.match(result.stdout, /done: M2/);
  const after = readFileSync(path, "utf8");
  // Only the M2 status cell changed; the done row count grows by exactly one.
  assert.notEqual(after, before);
  assert.equal((after.match(/\| done \|/g) ?? []).length, 2);
  assert.equal((after.match(/\| pending \|/g) ?? []).length, 1);
  assert.match(after, /\| M2 \| auth-mfa \| Add MFA enrollment \| done \|/);
  assert.match(after, /\| M3 \| auth-recovery \| Add account recovery \| pending \|/);
  rmSync(dirname(path), { recursive: true, force: true });
});

test("complete deletes the ledger when the first pending row is the final milestone", () => {
  const { dir, path } = tmpLedger([
    ["M1", "auth-login", "Add password login", "done"],
    ["M2", "auth-mfa", "Add MFA enrollment", "pending"],
  ]);
  const result = run(["complete", "--path", path]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /status: deleted/);
  assert.match(result.stdout, /deleted: M2/);
  assert.equal(existsSync(path), false);
  rmSync(dir, { recursive: true, force: true });
});

test("complete on an invalid ledger fails without mutating the file", () => {
  const { dir, path } = tmpLedger([["M1", "auth-login", "Add password login", "done"]]);
  const before = readFileSync(path, "utf8");
  const result = run(["complete", "--path", path]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /stale lifecycle residual/);
  assert.equal(readFileSync(path, "utf8"), before);
  rmSync(dir, { recursive: true, force: true });
});

test("usage errors exit 2 and help exits 0", () => {
  const missing = run(["validate"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stdout, /code: usage/);

  const unknown = run(["nope", "--path", "x"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stdout, /unknown command/);

  const help = run(["validate", "--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Commands:/);
});
