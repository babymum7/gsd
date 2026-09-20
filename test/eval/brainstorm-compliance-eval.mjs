#!/usr/bin/env bun
// Optional live-LLM behavior evaluation for gsd-brainstorming after the required skill read.
//
// Usage: GSD_EVAL_MODEL=<model> bun test/eval/brainstorm-compliance-eval.mjs
//          [--only <fixture-id>] [--report-path <file>]
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describeEvalBackendError, evalSurfaceFingerprint, selectEvalBackend } from "./activation-eval-contract.mjs";
import { parseBrainstormComplianceEvents } from "./brainstorm-compliance-eval-contract.mjs";
import { createBootstrap, discoverSkillCatalog } from "../../extensions/gsd-context.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const fixtures = JSON.parse(readFileSync(join(here, "brainstorm-fixtures.json"), "utf8"));
const catalog = discoverSkillCatalog(repoRoot);
const bootstrap = createBootstrap(repoRoot);
const fingerprint = evalSurfaceFingerprint({ bootstrap, repoRoot });
const brainstorm = catalog.find(({ name }) => name === "gsd-brainstorming");
if (!brainstorm) {
  console.error("gsd-brainstorming must stay in the visible catalog");
  process.exit(2);
}
const brainstormSkill = readFileSync(brainstorm.skillPath, "utf8");
const brainstormSkillSha256 = createHash("sha256").update(brainstormSkill).digest("hex");

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

const run = only ? fixtures.filter(({ id }) => id === only) : fixtures;
if (only && run.length === 0) {
  console.error(`unknown --only brainstorm fixture ${only}`);
  process.exit(2);
}

function resolveOmp(pathEnv) {
  for (const dir of String(pathEnv ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, "omp");
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}

const ompPath = process.env.GSD_EVAL_OMP || resolveOmp(process.env.PATH);
const backend = selectEvalBackend(process.env, ompPath);
if (backend.kind === "skip") {
  console.log(`skip: ${backend.detail} — live brainstorm compliance eval not run.`);
  process.exit(0);
}
if (backend.kind !== "omp") {
  console.error("brainstorm compliance evaluation only supports the omp backend");
  process.exit(2);
}

const system = `${bootstrap}

# Brainstorm evaluation contract

First visible action: one exact \`read\` call on ${brainstorm.skillPath}. Do not reason first.
After its result: make no other tool call and immediately return only this JSON object:
{"question":string|null,"recommendedAnswer":string|null,"approaches":[{"name":string,"tradeoffs":string,"recommended":boolean}],"implementationStarted":boolean}

The response must start with an opening brace and end with a closing brace. Do not wrap it in Markdown or backticks.
Ask one question with a recommended answer when acceptance is unclear. Otherwise provide at least two approaches with tradeoffs and exactly one recommendation. Keep every string under 25 words. Never start implementation in this evaluation.`;
const askUser = (fixture) => `Workspace state: ${fixture.state}\n\nUser prompt:\n${fixture.prompt}`;
const timeoutSeconds = Number(process.env.GSD_EVAL_MAX_TIME || 45);

function askOmp(model, fixture) {
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
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`omp exit ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      resolve(stdout);
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
      try {
        results.set(
          `${model}|${fixture.id}`,
          parseBrainstormComplianceEvents(await askOmp(model, fixture), brainstorm.skillPath),
        );
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
  scope: "bootstrap + brainstorm skill (behavior compliance axis)",
  bootstrap_sha256: fingerprint.bootstrap_sha256,
  bootstrap_words: fingerprint.bootstrap_words,
  canon_sha256: fingerprint.canon_sha256,
  canon_words: fingerprint.canon_words,
  brainstorm_skill_sha256: brainstormSkillSha256,
  pass: {},
  failures: {},
};

let failed = 0;
console.log(`Bootstrap: ${fingerprint.bootstrap_sha256.slice(0, 12)} (${fingerprint.bootstrap_words} rendered words)`);
for (const model of backend.models) {
  let modelFailed = 0;
  const failures = [];
  console.log(`\n# ${backend.kind} brainstorm compliance: ${model}`);
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

const output = reportPath ?? join(here, "brainstorm-compliance-report.json");
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Report: ${output}`);
process.exit(failed ? 1 : 0);
