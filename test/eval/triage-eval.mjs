#!/usr/bin/env bun
// Optional live-LLM evaluation for the decision-0013 triage front door: classify a prompt
// into exactly one route (answer|clarify|research|quick|plan|milestone) from the exact
// production GSD bootstrap. The completed-state matrix keeps its own runner in
// activation-eval.mjs, so neither axis leaks the other's vocabulary into its prompt.
//
// Backend selection (see selectEvalBackend):
//   the local `omp` binary is preferred and needs no key; it runs one isolated
//   non-interactive print per fixture and its stdout is the model's raw reply.
//   GSD_EVAL_BACKEND  force `omp` or `http`
//   GSD_EVAL_KEY      (or OPENAI_API_KEY) bearer token for the http backend
//   GSD_EVAL_URL      OpenAI-compatible base URL (default https://api.openai.com/v1)
//   GSD_EVAL_MODEL    comma-separated model list; every model is evaluated
//
// Usage: bun test/eval/triage-eval.mjs [--only <fixture-id>] [--report-path <file>]
//
// Exit codes: 0 all scored fixtures pass, 1 at least one fixture failed, 2 invalid usage or
// fixtures, 3 the backend failed (bad credential, dead endpoint) so nothing was scored.
import { spawn } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  describeEvalBackendError,
  evalSurfaceFingerprint,
  parseTriageResponse,
  selectEvalBackend,
  triageResponseMatchesFixture,
  validateTriageFixtureSet,
} from "./activation-eval-contract.mjs";
import { createBootstrap } from "../../extensions/gsd-context.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const fixtures = JSON.parse(readFileSync(join(here, "triage-fixtures.json"), "utf8"));
const bootstrap = createBootstrap(repoRoot);
const fingerprint = evalSurfaceFingerprint({ bootstrap, repoRoot });
const fixtureValidation = validateTriageFixtureSet(fixtures);
if (!fixtureValidation.ok) {
  console.error(`invalid triage-fixtures.json: ${fixtureValidation.detail}`);
  process.exit(2);
}

let only = null;
let reportPath = null;
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const name = argv[index];
  if (name === "--only" || name === "--report-path") {
    const variable = name === "--only" ? only : reportPath;
    if (variable !== null) {
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
    continue;
  }
  console.error(`unknown argument ${name}; use --only <fixture-id> or --report-path <file>`);
  process.exit(2);
}

const run = only ? fixtures.filter(({ id }) => id === only) : fixtures;
if (only && run.length === 0) {
  console.error(`unknown --only fixture ${only}`);
  process.exit(2);
}

const ompPath = process.env.GSD_EVAL_OMP || resolveOmp(process.env.PATH);
const backend = selectEvalBackend(process.env, ompPath);
if (backend.kind === "skip") {
  console.log(`skip: ${backend.detail} — live triage eval not run.`);
  process.exit(0);
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

const system = [
  "You are a GSD triage classifier. Do NOT perform, answer, or execute the user prompt. Classify only.",
  "The exact production GSD session bootstrap is loaded below.",
  "Apply its Triage rule: classify the prompt into exactly one route before any lifecycle work, reading only the prompt and the context it names.",
  'Reply with ONLY exact JSON: {"route":"<answer|clarify|research|quick|plan|milestone>"}.',
  "answer = read-only question, or a Nano edit: one literal edit needing no test; clarify = missing, ambiguous, supplied-design, or false-premise intent, including a prompt that asserts a behavior it cannot confirm from the prompt itself, needing exactly one question; research = a question whose answer lives in this repo, a document, or a reference; quick = one bounded change whose acceptance already converged from the prompt; plan = multi-task behavior whose acceptance must be written down; milestone = independently releasable outcomes or portable multi-session publication.",
  "Your entire response must be exactly one raw JSON object. No prose, no explanation, no markdown fence, no tool_call tags, no wrapper of any kind. Any text besides the JSON object is a failure.",
  "",
  bootstrap,
].join("\n");

const askUser = (fixture) => `Workspace state: ${fixture.state}\n\nUser prompt:\n${fixture.prompt}`;

async function askHttp(model, fixture) {
  const response = await fetch(`${backend.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${backend.key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: askUser(fixture) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${await response.text()}`);
  const body = await response.json();
  return body.choices?.[0]?.message?.content ?? "";
}

// One isolated non-interactive print run per question. `--mode text` keeps stdout the
// model's raw reply, and the no-* flags plus a neutral cwd stop the local install from
// injecting its own extensions, skills, rules, tools, or the GSD bootstrap twice.
function askOmp(model, fixture) {
  return new Promise((resolve, reject) => {
    const child = spawn(backend.command, [
      "-p",
      "--mode", "text",
      "--model", model,
      "--system-prompt", system,
      "--cwd", tmpdir(),
      "--thinking", "off",
      "--no-extensions",
      "--no-skills",
      "--no-rules",
      "--no-tools",
      "--no-lsp",
      "--no-session",
      "--no-title",
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
      resolve(stdout.trim());
    });
  });
}

const ask = backend.kind === "omp" ? askOmp : askHttp;

// Every model answers every fixture, keyed per model so one model's verdict can never
// overwrite another's.
const queue = backend.models.flatMap((model) => run.map((fixture) => ({ model, fixture })));
const results = new Map();
// A thrown ask() is the backend failing, not a fixture the model answered wrong. Record it
// once, stop pulling jobs, and exit with a backend code so a broken key or dead endpoint is
// never scored as "0/N checks pass".
let backendFailure = null;
await Promise.all(
  Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let job; (job = queue.shift()); ) {
      if (backendFailure) return;
      const { model, fixture } = job;
      const resultKey = `${model}|${fixture.id}`;
      try {
        const parsed = parseTriageResponse(await ask(model, fixture));
        if (!parsed.ok) {
          results.set(resultKey, { pass: false, detail: parsed.detail });
          continue;
        }
        results.set(resultKey, {
          pass: triageResponseMatchesFixture(parsed.value, fixture),
          detail: `want route ${fixture.route}, got ${parsed.value.route}`,
        });
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

let failed = 0;
const report = { scope: "bootstrap only (triage axis)", ...fingerprint, pass: {}, failures: {} };
console.log(
  `Bootstrap: ${fingerprint.bootstrap_sha256.slice(0, 12)} (${fingerprint.bootstrap_words} rendered words)`,
);
for (const model of backend.models) {
  let modelFailed = 0;
  const failingIds = [];
  console.log(`\n# ${backend.kind} triage: ${model}`);
  for (const fixture of run) {
    const { pass, detail } = results.get(`${model}|${fixture.id}`);
    modelFailed += pass ? 0 : 1;
    if (!pass) failingIds.push(fixture.id);
    console.log(`${pass ? "ok  " : "FAIL"} ${fixture.id}: ${detail}`);
  }
  failed += modelFailed;
  const passed = run.length - modelFailed;
  report.pass[model] = {
    passed,
    total: run.length,
    accuracy: +((passed / run.length) * 100).toFixed(1),
  };
  if (failingIds.length > 0) report.failures[model] = failingIds;
  console.log(`${run.length - modelFailed}/${run.length} checks pass (${model})`);
}

reportPath = reportPath ?? join(here, "triage-report.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nReport: ${reportPath}`);
process.exit(failed ? 1 : 0);
