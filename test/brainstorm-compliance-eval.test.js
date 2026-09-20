import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkillCatalog } from "../extensions/gsd-context.js";
import { parseBrainstormComplianceEvents } from "./eval/brainstorm-compliance-eval-contract.mjs";

const catalog = discoverSkillCatalog(join(import.meta.dir, ".."));
const brainstormPath = catalog.find(({ name }) => name === "gsd-brainstorming").skillPath;

function assistantEvent(content) {
  return `${JSON.stringify({ type: "message_end", message: { role: "assistant", content } })}\n`;
}

function response(value) {
  return JSON.stringify(value);
}

test("an exact skill read followed by a recommended question passes", () => {
  const raw = [
    assistantEvent([
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: brainstormPath } },
    ]),
    assistantEvent([
      {
        type: "text",
        text: response({
          question: "Should OAuth stay provider-agnostic?",
          recommendedAnswer: "Yes, start with one provider and keep the boundary provider-agnostic.",
          approaches: [],
          implementationStarted: false,
        }),
      },
    ]),
  ].join("\n");

  const verdict = parseBrainstormComplianceEvents(raw, brainstormPath);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.pass, true);
  assert.match(verdict.detail, /recommended question/);
});

test("two approaches with one recommendation pass without a question", () => {
  const raw = [
    assistantEvent([
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: brainstormPath } },
    ]),
    assistantEvent([
      {
        type: "text",
        text: response({
          question: null,
          recommendedAnswer: null,
          approaches: [
            { name: "Boundary-first", tradeoffs: "Slower start, safer later", recommended: true },
            { name: "Provider-first", tradeoffs: "Faster start, harder migration", recommended: false },
          ],
          implementationStarted: false,
        }),
      },
    ]),
  ].join("\n");

  const verdict = parseBrainstormComplianceEvents(raw, brainstormPath);
  assert.equal(verdict.pass, true);
  assert.match(verdict.detail, /2 approaches with one recommendation/);
});

test("wrong first action, invalid JSON, and premature implementation fail concretely", () => {
  const wrongFirstAction = parseBrainstormComplianceEvents(
    assistantEvent([{ type: "text", text: "I will inspect the repo first." }]),
    brainstormPath,
  );
  assert.equal(wrongFirstAction.pass, false);
  assert.match(wrongFirstAction.detail, /first visible action was text/);

  const invalidResponse = parseBrainstormComplianceEvents(
    [
      assistantEvent([
        { type: "toolCall", id: "call-1", name: "read", arguments: { path: brainstormPath } },
      ]),
      assistantEvent([{ type: "text", text: "not json" }]),
    ].join("\n"),
    brainstormPath,
  );
  assert.equal(invalidResponse.pass, false);
  assert.match(invalidResponse.detail, /post-read response is not valid JSON/);

  const implementation = parseBrainstormComplianceEvents(
    [
      assistantEvent([
        { type: "toolCall", id: "call-1", name: "read", arguments: { path: brainstormPath } },
      ]),
      assistantEvent([
        {
          type: "text",
          text: response({
            question: null,
            recommendedAnswer: null,
            approaches: [],
            implementationStarted: true,
          }),
        },
      ]),
    ].join("\n"),
    brainstormPath,
  );
  assert.equal(implementation.pass, false);
  assert.match(implementation.detail, /implementationStarted must be false/);
});

test("the evaluator runs one isolated OMP session and writes a report", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-brainstorm-compliance-"));
  const fakeOmp = join(dir, "omp");
  const reportPath = join(dir, "report.json");
  const events = [
    assistantEvent([
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: brainstormPath } },
    ]),
    assistantEvent([
      {
        type: "text",
        text: response({
          question: "Should the interface stay versioned?",
          recommendedAnswer: "Yes, keep a versioned boundary.",
          approaches: [],
          implementationStarted: false,
        }),
      },
    ]),
  ].join("\n");
  writeFileSync(fakeOmp, `#!/bin/sh\nprintf '%s' '${events.replace(/'/g, "'\\''")}'\n`);
  chmodSync(fakeOmp, 0o755);

  const result = spawnSync(
    process.execPath,
    ["test/eval/brainstorm-compliance-eval.mjs", "--only", "public-api-interface", "--report-path", reportPath],
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

  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.scope, "bootstrap + brainstorm skill (behavior compliance axis)");
  assert.match(report.bootstrap_sha256, /^[0-9a-f]{64}$/);
  assert.match(report.brainstorm_skill_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(report.pass["fake-model"], { passed: 1, total: 1, accuracy: 100 });
});

test("a tool call after the required skill read fails the behavior evaluation", () => {
  const raw = [
    assistantEvent([
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: brainstormPath } },
    ]),
    assistantEvent([
      { type: "toolCall", id: "call-2", name: "read", arguments: {} },
    ]),
    assistantEvent([
      {
        type: "text",
        text: response({
          question: "Should this stay bounded?",
          recommendedAnswer: "Yes.",
          approaches: [],
          implementationStarted: false,
        }),
      },
    ]),
  ].join("\n");

  const verdict = parseBrainstormComplianceEvents(raw, brainstormPath);
  assert.equal(verdict.pass, false);
  assert.match(verdict.detail, /no tool call may follow the required skill read/);
});
