import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  RECORD_FILE_MAX_BYTES,
  RECORD_KINDS,
  RECORD_NUMBER_RE,
  RECORD_SLUG_RE,
  parseRecordHeader,
} from "../lib/gsd-record.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "tools", "gsd-record.mjs");

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

function tmpRecord(content) {
  const dir = mkdtempSync(join(tmpdir(), "gsd-record-"));
  const path = join(dir, "0001-example.md");
  writeFileSync(path, content);
  return { dir, path };
}

function sampleRecord({
  number = "0001",
  title = "Adopt durable record format",
  status = "Accepted",
  date = "2026-08-18",
  decision = "We will record architectural decisions in markdown.",
  extraSections = "",
} = {}) {
  return [
    `# ${number} \u2014 ${title}`,
    "",
    `- **Status:** ${status}`,
    `- **Date:** ${date}`,
    "",
    "## Decision",
    "",
    decision,
    extraSections,
  ].filter(Boolean).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Unit tests for constants and pure parseRecordHeader
// ---------------------------------------------------------------------------

test("RECORD_FILE_MAX_BYTES is 64 KiB", () => {
  assert.equal(RECORD_FILE_MAX_BYTES, 64 * 1024);
});

test("RECORD_KINDS includes decisions and design", () => {
  assert.ok(RECORD_KINDS.has("decisions"));
  assert.ok(RECORD_KINDS.has("design"));
  assert.equal(RECORD_KINDS.size, 2);
});

test("RECORD_NUMBER_RE validates decimal digits", () => {
  assert.ok(RECORD_NUMBER_RE.test("1"));
  assert.ok(RECORD_NUMBER_RE.test("0001"));
  assert.ok(RECORD_NUMBER_RE.test("42"));
  assert.ok(!RECORD_NUMBER_RE.test(""));
  assert.ok(!RECORD_NUMBER_RE.test("0001a"));
  assert.ok(!RECORD_NUMBER_RE.test("-1"));
});

test("RECORD_SLUG_RE validates lowercase kebab-case slug", () => {
  assert.ok(RECORD_SLUG_RE.test("durable-docs"));
  assert.ok(RECORD_SLUG_RE.test("record1"));
  assert.ok(RECORD_SLUG_RE.test("a-b-c"));
  assert.ok(!RECORD_SLUG_RE.test("Durable-Docs"));
  assert.ok(!RECORD_SLUG_RE.test("durable_docs"));
  assert.ok(!RECORD_SLUG_RE.test("-leading"));
  assert.ok(!RECORD_SLUG_RE.test("trailing-"));
  assert.ok(!RECORD_SLUG_RE.test("double--hyphen"));
});

test("parseRecordHeader parses a valid decisions record", () => {
  const content = sampleRecord();
  const parsed = parseRecordHeader(content, "decisions");
  assert.deepEqual(parsed, {
    kind: "decisions",
    number: "0001",
    title: "Adopt durable record format",
    status: "Accepted",
    date: "2026-08-18",
  });
});

test("parseRecordHeader parses a valid design record without optional sections", () => {
  const content = sampleRecord({ number: "0002", title: "Storage design" });
  const parsed = parseRecordHeader(content, "design");
  assert.deepEqual(parsed, {
    kind: "design",
    number: "0002",
    title: "Storage design",
    status: "Accepted",
    date: "2026-08-18",
  });
});

test("parseRecordHeader parses a valid design record with optional sections including Measured outcome", () => {
  const content = sampleRecord({
    number: "0003",
    title: "Performance caching",
    extraSections: [
      "",
      "## Context",
      "We need faster queries.",
      "",
      "## Consequences",
      "Memory usage increases.",
      "",
      "## Measured outcome",
      "Latency reduced by 40%.",
    ].join("\n"),
  });
  const parsed = parseRecordHeader(content, "design");
  assert.deepEqual(parsed, {
    kind: "design",
    number: "0003",
    title: "Performance caching",
    status: "Accepted",
    date: "2026-08-18",
  });
});

test("parseRecordHeader accepts Rejected and Superseded by NNNN statuses", () => {
  const rejected = parseRecordHeader(sampleRecord({ status: "Rejected" }), "decisions");
  assert.equal(rejected.status, "Rejected");

  const superseded = parseRecordHeader(sampleRecord({ status: "Superseded by 0042" }), "decisions");
  assert.equal(superseded.status, "Superseded by 0042");
});

test("parseRecordHeader rejects non-string content and carriage returns", () => {
  assert.throws(() => parseRecordHeader(null, "decisions"), /string/i);
  assert.throws(() => parseRecordHeader(123, "decisions"), /string/i);
  assert.throws(() => parseRecordHeader(sampleRecord().replace(/\n/g, "\r\n"), "decisions"), /carriage return/i);
});

test("parseRecordHeader rejects unknown kind", () => {
  assert.throws(() => parseRecordHeader(sampleRecord(), "unknown"), /kind/i);
  assert.throws(() => parseRecordHeader(sampleRecord(), ""), /kind/i);
});

test("parseRecordHeader rejects empty content", () => {
  assert.throws(() => parseRecordHeader("", "decisions"), /empty/i);
  assert.throws(() => parseRecordHeader("\n", "decisions"), /empty/i);
});

test("parseRecordHeader rejects malformed or missing first line / title", () => {
  // Hyphen instead of em-dash
  assert.throws(
    () => parseRecordHeader(sampleRecord().replace("# 0001 \u2014 Adopt", "# 0001 - Adopt"), "decisions"),
    /first line/i
  );
  // Missing number
  assert.throws(
    () => parseRecordHeader(sampleRecord().replace("# 0001 \u2014 Adopt", "# Adopt"), "decisions"),
    /first line/i
  );
  // Empty title
  assert.throws(
    () => parseRecordHeader(sampleRecord().replace("# 0001 \u2014 Adopt durable record format", "# 0001 \u2014 "), "decisions"),
    /first line|title/i
  );
});

test("parseRecordHeader rejects missing, duplicate, or invalid Status line", () => {
  // Missing Status
  const missingStatus = [
    "# 0001 \u2014 Example",
    "- **Date:** 2026-08-18",
    "## Decision",
    "Valid decision.",
  ].join("\n");
  assert.throws(() => parseRecordHeader(missingStatus, "decisions"), /Status/i);

  // Duplicate Status
  const duplicateStatus = [
    "# 0001 \u2014 Example",
    "- **Status:** Accepted",
    "- **Status:** Rejected",
    "- **Date:** 2026-08-18",
    "## Decision",
    "Valid decision.",
  ].join("\n");
  assert.throws(() => parseRecordHeader(duplicateStatus, "decisions"), /Status/i);

  // Invalid Status value
  const invalidStatus = [
    "# 0001 \u2014 Example",
    "- **Status:** Draft",
    "- **Date:** 2026-08-18",
    "## Decision",
    "Valid decision.",
  ].join("\n");
  assert.throws(() => parseRecordHeader(invalidStatus, "decisions"), /Status/i);
});

test("parseRecordHeader rejects missing, duplicate, or invalid Date line", () => {
  // Missing Date
  const missingDate = [
    "# 0001 \u2014 Example",
    "- **Status:** Accepted",
    "## Decision",
    "Valid decision.",
  ].join("\n");
  assert.throws(() => parseRecordHeader(missingDate, "decisions"), /Date/i);

  // Duplicate Date
  const duplicateDate = [
    "# 0001 \u2014 Example",
    "- **Status:** Accepted",
    "- **Date:** 2026-08-18",
    "- **Date:** 2026-08-19",
    "## Decision",
    "Valid decision.",
  ].join("\n");
  assert.throws(() => parseRecordHeader(duplicateDate, "decisions"), /Date/i);

  // Invalid Date format
  const invalidDate = [
    "# 0001 \u2014 Example",
    "- **Status:** Accepted",
    "- **Date:** 08-18-2026",
    "## Decision",
    "Valid decision.",
  ].join("\n");
  assert.throws(() => parseRecordHeader(invalidDate, "decisions"), /Date/i);
});

test("parseRecordHeader rejects missing or empty Decision section", () => {
  // Missing Decision heading
  const missingDecision = [
    "# 0001 \u2014 Example",
    "- **Status:** Accepted",
    "- **Date:** 2026-08-18",
    "## Context",
    "Some context.",
  ].join("\n");
  assert.throws(() => parseRecordHeader(missingDecision, "decisions"), /Decision/i);

  // Empty Decision body
  const emptyDecision = [
    "# 0001 \u2014 Example",
    "- **Status:** Accepted",
    "- **Date:** 2026-08-18",
    "## Decision",
    "",
    "## Consequences",
    "Some consequence.",
  ].join("\n");
  assert.throws(() => parseRecordHeader(emptyDecision, "decisions"), /Decision/i);

  // Trailing Decision with no content
  const trailingEmptyDecision = [
    "# 0001 \u2014 Example",
    "- **Status:** Accepted",
    "- **Date:** 2026-08-18",
    "## Decision",
  ].join("\n");
  assert.throws(() => parseRecordHeader(trailingEmptyDecision, "decisions"), /Decision/i);

  // Duplicate Decision heading
  const duplicateDecision = [
    "# 0001 \u2014 Example",
    "- **Status:** Accepted",
    "- **Date:** 2026-08-18",
    "## Decision",
    "Decision 1.",
    "## Decision",
    "Decision 2.",
  ].join("\n");
  assert.throws(() => parseRecordHeader(duplicateDecision, "decisions"), /Decision/i);
});

// ---------------------------------------------------------------------------
// CLI integration tests
// ---------------------------------------------------------------------------

test("CLI validate accepts a well-formed decisions record", () => {
  const { dir, path } = tmpRecord(sampleRecord());
  const result = run(["validate", "--path", path, "--kind", "decisions"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /status: valid/);
  assert.match(result.stdout, /kind: decisions/);
  assert.match(result.stdout, /number: 0001/);
  assert.match(result.stdout, /title: Adopt durable record format/);
  rmSync(dir, { recursive: true, force: true });
});

test("CLI validate accepts a well-formed design record with and without Measured outcome", () => {
  // Without Measured outcome
  const { dir: d1, path: p1 } = tmpRecord(sampleRecord({ number: "0005", title: "UI Architecture" }));
  const res1 = run(["validate", "--path", p1, "--kind", "design"]);
  assert.equal(res1.status, 0);
  assert.match(res1.stdout, /status: valid/);
  assert.match(res1.stdout, /kind: design/);
  assert.match(res1.stdout, /number: 0005/);
  assert.match(res1.stdout, /title: UI Architecture/);
  rmSync(d1, { recursive: true, force: true });

  // With Measured outcome
  const { dir: d2, path: p2 } = tmpRecord(sampleRecord({
    number: "0006",
    title: "Cache Layer",
    extraSections: "\n## Measured outcome\n\nCache hit rate 95%.\n",
  }));
  const res2 = run(["validate", "--path", p2, "--kind", "design"]);
  assert.equal(res2.status, 0);
  assert.match(res2.stdout, /status: valid/);
  assert.match(res2.stdout, /kind: design/);
  assert.match(res2.stdout, /number: 0006/);
  assert.match(res2.stdout, /title: Cache Layer/);
  rmSync(d2, { recursive: true, force: true });
});

test("CLI validate reports invalid-record (exit 1) on missing title", () => {
  const { dir, path } = tmpRecord([
    "# 0001 \u2014 ",
    "- **Status:** Accepted",
    "- **Date:** 2026-08-18",
    "## Decision",
    "Content.",
  ].join("\n"));
  const result = run(["validate", "--path", path, "--kind", "decisions"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /status: error/);
  assert.match(result.stdout, /code: invalid-record/);
  assert.match(result.stdout, /error: /);
  assert.match(result.stdout, /help: /);
  rmSync(dir, { recursive: true, force: true });
});

test("CLI validate reports invalid-record (exit 1) on missing Status", () => {
  const { dir, path } = tmpRecord([
    "# 0001 \u2014 Title",
    "- **Date:** 2026-08-18",
    "## Decision",
    "Content.",
  ].join("\n"));
  const result = run(["validate", "--path", path, "--kind", "decisions"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /status: error/);
  assert.match(result.stdout, /code: invalid-record/);
  assert.match(result.stdout, /error: /);
  assert.match(result.stdout, /help: /);
  rmSync(dir, { recursive: true, force: true });
});

test("CLI validate reports invalid-record (exit 1) on missing Date", () => {
  const { dir, path } = tmpRecord([
    "# 0001 \u2014 Title",
    "- **Status:** Accepted",
    "## Decision",
    "Content.",
  ].join("\n"));
  const result = run(["validate", "--path", path, "--kind", "decisions"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /status: error/);
  assert.match(result.stdout, /code: invalid-record/);
  assert.match(result.stdout, /error: /);
  assert.match(result.stdout, /help: /);
  rmSync(dir, { recursive: true, force: true });
});

test("CLI validate reports invalid-record (exit 1) on missing or empty Decision section", () => {
  const { dir, path } = tmpRecord([
    "# 0001 \u2014 Title",
    "- **Status:** Accepted",
    "- **Date:** 2026-08-18",
    "## Decision",
    "",
  ].join("\n"));
  const result = run(["validate", "--path", path, "--kind", "decisions"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /status: error/);
  assert.match(result.stdout, /code: invalid-record/);
  assert.match(result.stdout, /error: /);
  assert.match(result.stdout, /help: /);
  rmSync(dir, { recursive: true, force: true });
});

test("CLI validate reports usage error (exit 2) for missing flags or invalid kind", () => {
  // No command
  const res0 = run([]);
  assert.equal(res0.status, 2);
  assert.match(res0.stdout, /code: usage/);

  // Unknown command
  const resUnknown = run(["foo"]);
  assert.equal(resUnknown.status, 2);
  assert.match(resUnknown.stdout, /code: usage/);

  // Missing --path
  const res1 = run(["validate", "--kind", "decisions"]);
  assert.equal(res1.status, 2);
  assert.match(res1.stdout, /code: usage/);

  // Missing --kind
  const res2 = run(["validate", "--path", "some/path.md"]);
  assert.equal(res2.status, 2);
  assert.match(res2.stdout, /code: usage/);

  // Invalid --kind value
  const res3 = run(["validate", "--path", "some/path.md", "--kind", "invalid-kind"]);
  assert.equal(res3.status, 2);
  assert.match(res3.stdout, /code: usage/);

  // Flag missing value
  const res4 = run(["validate", "--path"]);
  assert.equal(res4.status, 2);
  assert.match(res4.stdout, /code: usage/);

  // Unknown flag
  const res5 = run(["validate", "--path", "some/path.md", "--kind", "decisions", "--bogus"]);
  assert.equal(res5.status, 2);
  assert.match(res5.stdout, /code: usage/);
});

test("CLI validate reports io-error (exit 1) for unreadable path", () => {
  const result = run(["validate", "--path", "/nonexistent/directory/0001-record.md", "--kind", "decisions"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /status: error/);
  assert.match(result.stdout, /code: io-error/);
  assert.match(result.stdout, /error: /);
  assert.match(result.stdout, /help: /);
});

test("CLI validate reports invalid-record (exit 1) for file exceeding RECORD_FILE_MAX_BYTES", () => {
  const oversized = sampleRecord({
    decision: "A".repeat(RECORD_FILE_MAX_BYTES + 100),
  });
  const { dir, path } = tmpRecord(oversized);
  const result = run(["validate", "--path", path, "--kind", "decisions"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /status: error/);
  assert.match(result.stdout, /code: invalid-record/);
  rmSync(dir, { recursive: true, force: true });
});

test("CLI --help exits 0 and prints usage", () => {
  const result = run(["validate", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--path/);
  assert.match(result.stdout, /--kind/);
});
