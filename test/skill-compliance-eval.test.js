import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkillCatalog } from "../extensions/gsd-context.js";
import { parseSkillComplianceEvents } from "./eval/skill-compliance-eval-contract.mjs";

const catalog = discoverSkillCatalog(join(import.meta.dir, ".."));
const verifyPath = catalog.find(({ name }) => name === "gsd-verify").skillPath;

function assistantEvent(content) {
  return `${JSON.stringify({ type: "message_end", message: { role: "assistant", content } })}\n`;
}

test("thinking is ignored and the first visible exact read passes", () => {
  const raw = [
    JSON.stringify({ type: "session_start" }),
    assistantEvent([
      { type: "thinking", text: "I should inspect the skill first." },
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: verifyPath } },
    ]),
  ].join("\n");

  assert.deepEqual(parseSkillComplianceEvents(raw, verifyPath), {
    ok: true,
    pass: true,
    detail: `first action read ${verifyPath}`,
  });
});

test("the first visible action is scored, not a later correct read", () => {
  const raw = assistantEvent([
    { type: "text", text: "I will inspect the skill." },
    { type: "toolCall", id: "call-1", name: "read", arguments: { path: verifyPath } },
  ]);

  const verdict = parseSkillComplianceEvents(raw, verifyPath);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.pass, false);
  assert.match(verdict.detail, /first visible action was text/);
});

test("thinking-only assistant messages do not hide a later visible action", () => {
  const raw = [
    assistantEvent([{ type: "thinking", text: "private reasoning only" }]),
    assistantEvent([
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: verifyPath } },
    ]),
  ].join("\n");

  assert.deepEqual(parseSkillComplianceEvents(raw, verifyPath), {
    ok: true,
    pass: true,
    detail: `first action read ${verifyPath}`,
  });
});

test("wrong tools, wrong paths, and absent actions fail concretely", () => {
  const wrongTool = parseSkillComplianceEvents(
    assistantEvent([{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "cat" } }]),
    verifyPath,
  );
  assert.equal(wrongTool.pass, false);
  assert.match(wrongTool.detail, /wrong tool bash/);

  const wrongPath = parseSkillComplianceEvents(
    assistantEvent([{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "/tmp/wrong.md" } }]),
    verifyPath,
  );
  assert.equal(wrongPath.pass, false);
  assert.match(wrongPath.detail, /wrong path \/tmp\/wrong\.md/);

  const noAction = parseSkillComplianceEvents(
    assistantEvent([{ type: "thinking", text: "only private reasoning" }]),
    verifyPath,
  );
  assert.equal(noAction.pass, false);
  assert.match(noAction.detail, /no visible assistant action/);
});

test("the evaluator runs one isolated OMP JSON session and writes a report", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-skill-compliance-"));
  const fakeOmp = join(dir, "omp");
  const reportPath = join(dir, "report.json");
  const events = [
    JSON.stringify({ type: "message_start", message: { role: "assistant" } }),
    assistantEvent([
      { type: "thinking", text: "select the skill" },
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: verifyPath } },
    ]),
  ].join("\n");
  writeFileSync(fakeOmp, `#!/bin/sh\nprintf '%s' '${events.replace(/'/g, "'\\''")}'\n`);
  chmodSync(fakeOmp, 0o755);

  const result = spawnSync(
    process.execPath,
    ["test/eval/skill-compliance-eval.mjs", "--only", "review-diff", "--report-path", reportPath],
    {
      cwd: join(import.meta.dir, ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        GSD_EVAL_BACKEND: "omp",
        GSD_EVAL_OMP: fakeOmp,
        GSD_EVAL_MODEL: "fake-model",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1\/1 checks pass \(fake-model\)/);
  assert.match(result.stdout, /Bootstrap: [0-9a-f]{12} \(\d+ rendered words\)/);

  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.scope, "bootstrap only (skill compliance axis)");
  assert.match(report.bootstrap_sha256, /^[0-9a-f]{64}$/);
  assert.ok(report.bootstrap_words > 0);
  assert.deepEqual(report.pass["fake-model"], { passed: 1, total: 1, accuracy: 100 });
  assert.equal(report.failures["fake-model"], undefined);
});
