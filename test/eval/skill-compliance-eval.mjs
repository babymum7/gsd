#!/usr/bin/env bun
// Optional live-LLM first-action compliance evaluation for the exact production GSD bootstrap.
//
// This is deliberately different from activation/triage classifiers: the model receives the
// production bootstrap and the user prompt, then may call only the OMP `read` tool. We score
// the first visible assistant action, so a model that merely names a skill but does not read
// its SKILL.md cannot pass.
//
// Usage: GSD_EVAL_MODEL=<model> bun test/eval/skill-compliance-eval.mjs
//          [--only <fixture-id>] [--report-path <file>]
//
// Exit codes: 0 all scored fixtures pass, 1 at least one fixture failed, 2 invalid usage or
// fixtures, 3 the backend failed before any fixture was scored.
import { spawn } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  describeEvalBackendError,
  evalSurfaceFingerprint,
  selectEvalBackend,
  validateFixtureSet,
} from "./activation-eval-contract.mjs";
import { parseSkillComplianceEvents } from "./skill-compliance-eval-contract.mjs";
import { createBootstrap, discoverSkillCatalog } from "../../extensions/gsd-context.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const fixtures = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8"));
const catalog = discoverSkillCatalog(repoRoot);
const bootstrap = createBootstrap(repoRoot);
const fingerprint = evalSurfaceFingerprint({ bootstrap, repoRoot });
const installedSkills = new Set(catalog.map(({ name }) => name));
const fixtureValidation = validateFixtureSet(fixtures, installedSkills);
if (!fixtureValidation.ok) {
  console.error(`invalid fixtures.json: ${fixtureValidation.detail}`);
  process.exit(2);
}

const skillPaths = new Map(catalog.map(({ name, skillPath }) => [name, skillPath]));
const complianceFixtures = fixtures.filter(({ expectedPrimarySkill }) => expectedPrimarySkill !== null);

let only = null;
let reportPath = null;
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const name = argv[index];
  if (name !== "--only" && name !== "--report-path") {
    console.error(`unknown argument ${name}; use --only <fixture-id> or --report-path <file>`);
    process.exit(2);
  }
  const current = name === "--only" ? only : reportPath;
  if (current !== null) {
    console.error(`duplicate option ${name}`);
    process.exit(2);
  }
  const value = argv[index + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    console.error(`missing value for ${name}`);
    process.exit(2);
  }
  if (name === "--only") only = value;
  else reportPath = value;
  index += 1;
}

const run = only ? complianceFixtures.filter(({ id }) => id === only) : complianceFixtures;
if (only && run.length === 0) {
  console.error(`unknown --only compliance fixture ${only}`);
  process.exit(2);
}

function resolveOmp(pathEnv) {
  for (const dir of String(pathEnv ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, "omp");
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not on this PATH entry
    }
  }
  return null;
}

const ompPath = process.env.GSD_EVAL_OMP || resolveOmp(process.env.PATH);
const backend = selectEvalBackend(process.env, ompPath);
if (backend.kind === "skip") {
  console.log(`skip: ${backend.detail} — live skill compliance eval not run.`);
  process.exit(0);
}
if (backend.kind !== "omp") {
  console.error("skill compliance evaluation only supports the omp backend");
  process.exit(2);
}

const system = bootstrap;
const askUser = (fixture) => `Workspace state: ${fixture.state}\n\nUser prompt:\n${fixture.prompt}`;
const timeoutSeconds = Number(process.env.GSD_EVAL_MAX_TIME || 20);

function askOmp(model, fixture, expectedPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(backend.command, [
      "-p",
      "--mode", "json",
      "--model", model,
      "--system-prompt", system,
      "--cwd", tmpdir(),
      "--thinking", "off",
      "--no-extensions",
      "--no-skills",
      "--no-rules",
      "--tools", "read",
      "--no-lsp",
      "--no-session",
      "--no-title",
      "--auto-approve",
      "--max-time", String(timeoutSeconds),
      askUser(fixture),
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let completeOutput = "";
    let buffer = "";
    let stderr = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) completeOutput += `${line}\n`;
        newlineIndex = buffer.indexOf("\n");

        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        const content = event?.type === "message_end" ? event.message?.content : null;
        if (
          event?.type === "message_end"
          && event.message?.role === "assistant"
          && Array.isArray(content)
          && content.some((item) => item?.type !== "thinking")
        ) {
          const verdict = parseSkillComplianceEvents(completeOutput, expectedPath);
          if (verdict.ok) {
            child.kill("SIGTERM");
            finish(completeOutput);
          }
        }
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", fail);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(`omp exit ${code}: ${stderr.trim() || completeOutput.trim()}`));
        return;
      }
      resolve(completeOutput);
    });
  });
}

const queue = backend.models.flatMap((model) => run.map((fixture) => ({ model, fixture })));
const results = new Map();
let backendFailure = null;
const concurrency = Math.min(4, queue.length);

await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (let job; (job = queue.shift()); ) {
      if (backendFailure) return;
      const { model, fixture } = job;
      const resultKey = `${model}|${fixture.id}`;
      try {
        const expectedPath = skillPaths.get(fixture.expectedPrimarySkill);
        const verdict = parseSkillComplianceEvents(await askOmp(model, fixture, expectedPath), expectedPath);
        results.set(resultKey, verdict);
      } catch (error) {
        if (!backendFailure) backendFailure = describeEvalBackendError(error.message ?? error);
      }
    }
  }),
);

if (backendFailure) {
  console.error(`eval aborted, no fixture was scored: ${backendFailure}`);
  process.exit(3);
}

const report = {
  scope: "bootstrap only (skill compliance axis)",
  bootstrap_sha256: fingerprint.bootstrap_sha256,
  bootstrap_words: fingerprint.bootstrap_words,
  pass: {},
  failures: {},
};

let failed = 0;
console.log(
  `Bootstrap: ${fingerprint.bootstrap_sha256.slice(0, 12)} (${fingerprint.bootstrap_words} rendered words)`,
);
for (const model of backend.models) {
  let modelFailed = 0;
  const failures = [];
  console.log(`\n# ${backend.kind} compliance: ${model}`);
  for (const fixture of run) {
    const verdict = results.get(`${model}|${fixture.id}`);
    modelFailed += verdict.pass ? 0 : 1;
    if (!verdict.pass) failures.push({ fixture: fixture.id, detail: verdict.detail });
    console.log(`${verdict.pass ? "ok  " : "FAIL"} ${fixture.id}: ${verdict.detail}`);
  }
  failed += modelFailed;
  const passed = run.length - modelFailed;
  const accuracy = run.length === 0 ? 0 : Math.round((passed / run.length) * 10000) / 100;
  report.pass[model] = { passed, total: run.length, accuracy };
  if (failures.length > 0) report.failures[model] = failures;
  console.log(`${passed}/${run.length} checks pass (${model})`);
}

const output = reportPath ?? join(here, "skill-compliance-report.json");
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Report: ${output}`);
process.exit(failed ? 1 : 0);
