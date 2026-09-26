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

test("thinking is ignored and an immediate exact read passes", () => {
  const raw = [
    JSON.stringify({ type: "session_start" }),
    assistantEvent([
      { type: "thinking", text: "I should inspect the skill first." },
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: verifyPath } },
    ]),
  ].join("\n");

  assert.deepEqual(parseSkillComplianceEvents(raw, verifyPath), {
    ok: true,
    decided: true,
    pass: true,
    detail: `reached ${verifyPath} at action 1`,
  });
});

test("orienting reads before the skill still reach it within the budget", () => {
  const raw = [
    assistantEvent([{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "docs/domain/index.md" } }]),
    assistantEvent([
      { type: "text", text: "Now the skill." },
      { type: "toolCall", id: "call-2", name: "read", arguments: { path: verifyPath } },
    ]),
  ].join("\n");

  const verdict = parseSkillComplianceEvents(raw, verifyPath);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.detail, `reached ${verifyPath} at action 2`);
});

test("a text answer before the skill read fails and is decided", () => {
  const raw = [
    assistantEvent([{ type: "text", text: "Here is the answer without the skill." }]),
    assistantEvent([{ type: "toolCall", id: "call-1", name: "read", arguments: { path: verifyPath } }]),
  ].join("\n");

  const verdict = parseSkillComplianceEvents(raw, verifyPath);
  assert.equal(verdict.pass, false);
  assert.equal(verdict.decided, true);
  assert.match(verdict.detail, /answered before reading the skill/);
});

test("the action budget, wrong tools, and absent actions fail concretely", () => {
  const wandering = parseSkillComplianceEvents(
    [
      assistantEvent([{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "cat" } }]),
      assistantEvent([{ type: "toolCall", id: "c2", name: "read", arguments: { path: "/tmp/a.md" } }]),
      assistantEvent([{ type: "toolCall", id: "c3", name: "write", arguments: { path: "/tmp/b.md" } }]),
      assistantEvent([{ type: "toolCall", id: "c4", name: "read", arguments: { path: verifyPath } }]),
    ].join("\n"),
    verifyPath,
  );
  assert.equal(wandering.pass, false);
  assert.equal(wandering.decided, true);
  assert.match(wandering.detail, /not read in the first 3 actions: bash cat, read \/tmp\/a\.md, write \/tmp\/b\.md/);

  const unfinished = parseSkillComplianceEvents(
    assistantEvent([{ type: "toolCall", id: "c1", name: "read", arguments: { path: "/tmp/wrong.md" } }]),
    verifyPath,
  );
  assert.equal(unfinished.pass, false);
  assert.equal(unfinished.decided, false, "a streaming runner keeps listening after one wrong read");
  assert.match(unfinished.detail, /not read before the session ended: read \/tmp\/wrong\.md/);

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
