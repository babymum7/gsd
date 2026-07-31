#!/usr/bin/env node
// Two-pass activation eval: first-attempt accuracy + correction pass for failures.
//
// Usage:
//   GSD_EVAL_BACKEND=omp node test/eval/eval-models.mjs
//
// Pass 1: every model answers every fixture (first-attempt accuracy).
// Pass 2: failures get a correction hint ("your routing may be off, reconsider").
//         The hint does NOT reveal the correct answer.
import { spawn } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  parseActivationResponse,
  responseMatchesFixture,
  selectEvalBackend,
  validateFixtureSet,
} from "./activation-eval-contract.mjs";
import { createBootstrap, discoverSkillCatalog } from "../../extensions/gsd-context.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const fixtures = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8"));
const catalog = discoverSkillCatalog(repoRoot);
const bootstrap = createBootstrap(repoRoot);
const installedSkills = new Set(catalog.map(({ name }) => name));
const fixtureValidation = validateFixtureSet(fixtures, installedSkills);
if (!fixtureValidation.ok) {
  console.error(`invalid fixtures.json: ${fixtureValidation.detail}`);
  process.exit(2);
}

// --- --only / --report-path filters ---
let only = null;
let reportPath = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--only") {
    if (only !== null) { console.error("duplicate --only"); process.exit(2); }
    only = argv[i + 1];
    if (!only || only.startsWith("--")) { console.error("missing value for --only"); process.exit(2); }
    i += 1;
  } else if (argv[i] === "--report-path") {
    if (reportPath !== null) { console.error("duplicate --report-path"); process.exit(2); }
    reportPath = argv[i + 1];
    if (!reportPath || reportPath.startsWith("--")) { console.error("missing value for --report-path"); process.exit(2); }
    i += 1;
  } else { console.error(`unknown argument ${argv[i]}`); process.exit(2); }
}
const run = only ? fixtures.filter((f) => f.id === only) : fixtures;
if (only && run.length === 0) { console.error(`unknown fixture ${only}`); process.exit(2); }

// --- Backend setup ---
function resolveOmp(pathEnv) {
  for (const dir of String(pathEnv ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, "omp");
    try { if (statSync(candidate).isFile()) return candidate; } catch {}
  }
  return null;
}

const ompPath = process.env.GSD_EVAL_OMP || resolveOmp(process.env.PATH);
const backend = selectEvalBackend(process.env, ompPath);
if (backend.kind === "skip") {
  console.log(`skip: ${backend.detail}`);
  process.exit(0);
}
if (backend.kind !== "omp") {
  console.error("this script only supports the omp backend");
  process.exit(2);
}

// --- System prompt (identical to activation-eval.mjs) ---
const system = [
  "You are a GSD activation classifier. Do NOT perform, answer, or execute the user prompt. Classify only.",
  "The exact production GSD session bootstrap is loaded below.",
  "Given the workspace state and current user prompt, apply its result-marker decision matrix and lazy skill-selection policy.",
  "Choose only the primary process owner. Helper skills such as gsd-ponytail are not represented in primarySkill.",
  'Reply with ONLY exact JSON: {"decision":"<ordinary-routing|ignore-terminal-record|cleanup-question|cleanup-only|block-resume|fail-closed>","action":"<load|direct|stop>","primarySkill":"<visible gsd-* skill>" or null}.',
  "Use load with one visible primary skill, direct with null when no primary skill applies, and stop with null for every cleanup/block/fail-closed decision.",
  "ordinary-routing and ignore-terminal-record ALWAYS use load or direct. cleanup-question, cleanup-only, block-resume, and fail-closed ALWAYS use stop with null primarySkill.",
  "Plan-hash mismatch does not override the normal owner: bare continue still enters gsd-handoff; prompt-named pending execution work enters gsd-executing-plans. Bare 'continue' or generic resume with a validated active .scratch plan/state = gsd-handoff; named task/feature work with validated active plan = its owner skill, not gsd-handoff.",
  "Explicit diff or PR review prompt always loads gsd-verify, never direct. plan.md beside malformed state.toon fail-closes before any direct/nano routing.",
  "Your entire response must be exactly one raw JSON object. No prose, no explanation, no markdown fence, no tool_call tags, no wrapper of any kind. Any text besides the JSON object is a failure.",
  "",
  bootstrap,
].join("\n");

const askUser = (fixture) => `Workspace state: ${fixture.state}\n\nUser prompt:\n${fixture.prompt}`;

// Correction hint: suggests the model may be wrong without revealing the answer.
const CORRECTION_HINT = "\n\nNote: Your previous routing decision may be incorrect. Please carefully reconsider the workspace state and user prompt, then provide a corrected JSON response.";

const _parsedTimeout = parseInt(process.env.GSD_EVAL_JOB_TIMEOUT || "120000", 10);
const JOB_TIMEOUT_MS = Number.isFinite(_parsedTimeout) && _parsedTimeout >= 1000 ? _parsedTimeout : 120_000;

function askOmp(model, userMessage) {
  return new Promise((resolve, reject) => {
    let settled = false;
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
      userMessage,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killTimer = null;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000);
      reject(new Error(`omp timeout after ${JOB_TIMEOUT_MS}ms`));
    }, JOB_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("error", (err) => { if (!settled) { settled = true; clearTimeout(timer); clearTimeout(killTimer); reject(err); } });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`omp exit ${code}: ${stderr.trim() || stdout.trim()}`));
      else resolve(stdout.trim());
    });
  });
}

// --- Global job queue with configurable concurrency ---
const CONCURRENCY = Math.max(1, parseInt(process.env.GSD_EVAL_CONCURRENCY || "8", 10));

async function runJobs(jobs) {
  // jobs: [{model, fixture, hint?}]
  const results = new Map(); // "model|fixtureId" -> result
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let job; (job = queue.shift()); ) {
      const { model, fixture, hint } = job;
      const key = `${model}|${fixture.id}`;
      try {
        const userMsg = askUser(fixture) + (hint || "");
        const raw = await askOmp(model, userMsg);
        const parsed = parseActivationResponse(raw, installedSkills);
        if (!parsed.ok) {
          results.set(key, { pass: false, detail: parsed.detail, raw });
          process.stderr.write(`  ✖ ${model} ${fixture.id}: parse error: ${parsed.detail}\n`);
          continue;
        }
        const matches = responseMatchesFixture(parsed.value, fixture);
        results.set(key, {
          pass: matches,
          detail: `want ${fixture.decision}:${fixture.expectedAction}->${fixture.expectedPrimarySkill ?? "null"}, got ${parsed.value.decision}:${parsed.value.action}->${parsed.value.primarySkill ?? "null"}`,
          raw,
          value: parsed.value,
        });
        process.stderr.write(`${matches ? "ok  " : "FAIL"} ${model} ${fixture.id}\n`);
      } catch (error) {
        results.set(key, { pass: false, detail: String(error.message ?? error), raw: "" });
        process.stderr.write(`  ERR ${model} ${fixture.id}: ${error.message ?? error}\n`);
      }
    }
  }));
  return results;
}

// --- Main ---
const models = backend.models;
console.log(`Models: ${models.join(", ")}`);
console.log(`Fixtures: ${run.length}`);
console.log(`Concurrency: ${CONCURRENCY}`);
console.log(`Backend: ${backend.kind} (${backend.command})`);
console.log("─".repeat(70));

// ═══ Pass 1: first-attempt (all models × fixtures in parallel) ═══
const pass1Jobs = run.flatMap((fixture) => models.map((model) => ({ model, fixture })));
console.log(`\n▶ Pass 1: ${pass1Jobs.length} jobs (${models.length} models × ${run.length} fixtures)`);
const pass1 = await runJobs(pass1Jobs);

// Per-model pass 1 stats
for (const model of models) {
  const passed = run.filter((f) => pass1.get(`${model}|${f.id}`)?.pass).length;
  console.log(`  ${model}: ${passed}/${run.length} (${(passed / run.length * 100).toFixed(1)}%)`);
}

// Collect failures for pass 2 (fixture-major interleaving)
const failureJobs = [];
for (const fixture of run) {
  for (const model of models) {
    const r = pass1.get(`${model}|${fixture.id}`);
    if (!r?.pass) {
      failureJobs.push({ model, fixture, hint: CORRECTION_HINT });
    }
  }
}

console.log(`\n${"─".repeat(70)}`);
console.log(`Pass 1 total failures: ${failureJobs.length}`);

if (failureJobs.length === 0) {
  console.log("\nAll models passed all fixtures on first attempt!");
  const report = { pass1: {}, pass2: {}, summary: {} };
  for (const model of models) {
    report.pass1[model] = { passed: run.length, total: run.length, accuracy: 100 };
    report.pass2[model] = { corrected: 0, stillFailing: 0, accuracy: 100 };
    report.summary[model] = { firstAttempt: 100, corrected: 100 };
  }
  writeFileSync(reportPath ?? (only ? join(here, `eval-report-${only}.json`) : join(here, "eval-report.json")), JSON.stringify(report, null, 2));
  process.exit(0);
}

// ═══ Pass 2: correction hint (all failures in parallel) ═══
console.log(`\n▶ Pass 2: ${failureJobs.length} correction jobs`);
const pass2 = await runJobs(failureJobs);

// ═══ Summary ═══
console.log(`\n${"═".repeat(70)}`);
console.log("SUMMARY");
console.log(`${"═".repeat(70)}`);

const report = { pass1: {}, pass2: {}, summary: {}, failures: {} };

for (const model of models) {
  const p1Passed = run.filter((f) => pass1.get(`${model}|${f.id}`)?.pass).length;
  const p2Passed = run.filter((f) => pass2.get(`${model}|${f.id}`)?.pass && !pass1.get(`${model}|${f.id}`)?.pass).length;
  const stillFailing = run.filter((f) => {
    const p1r = pass1.get(`${model}|${f.id}`);
    const p2r = pass2.get(`${model}|${f.id}`);
    return !p1r?.pass && p2r && !p2r.pass;
  });

  const p1Acc = (p1Passed / run.length * 100).toFixed(1);
  const correctedAcc = ((p1Passed + p2Passed) / run.length * 100).toFixed(1);

  console.log(`\n${model}:`);
  console.log(`  First-attempt:  ${p1Passed}/${run.length} (${p1Acc}%)`);
  console.log(`  After correct:  ${p1Passed + p2Passed}/${run.length} (${correctedAcc}%)`);
  if (stillFailing.length > 0) {
    console.log(`  Still failing:`);
    for (const f of stillFailing) {
      const r = pass2.get(`${model}|${f.id}`);
      console.log(`    ${f.id}: ${r.detail}`);
    }
  }

  report.pass1[model] = { passed: p1Passed, total: run.length, accuracy: +p1Acc };
  report.pass2[model] = { corrected: p2Passed, stillFailing: stillFailing.length, accuracy: +correctedAcc };
  report.summary[model] = { firstAttempt: +p1Acc, corrected: +correctedAcc };

  const failingIds = run.filter((f) => !pass1.get(`${model}|${f.id}`)?.pass).map((f) => f.id);
  if (failingIds.length > 0) report.failures[model] = failingIds;
}

reportPath = reportPath ?? (only ? join(here, `eval-report-${only}.json`) : join(here, "eval-report.json"));
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\n${"─".repeat(70)}`);
console.log(`Report: ${reportPath}`);
