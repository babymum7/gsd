#!/usr/bin/env bun
// Optional live-LLM evaluation of lifecycle answers the owner skills and REFERENCE state.
// `--root` points the bootstrap, the owner skills, and REFERENCE at another checkout, so a
// trimmed canon can be compared against the tree before the trim on the same fixtures.
//
// Usage: GSD_EVAL_MODEL=<model> bun test/eval/canon-compliance-eval.mjs
//          [--root <skills tree checkout>] [--only <fixture-id>] [--report-path <file>]
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEvalAgentEnv, createEvalCwd, describeEvalBackendError, evalSurfaceFingerprint, selectEvalBackend } from "./activation-eval-contract.mjs";
import { parseCanonComplianceEvents, validateCanonFixtureSet } from "./canon-compliance-eval-contract.mjs";
import { createBootstrap } from "../../extensions/gsd-context.js";

const here = dirname(fileURLToPath(import.meta.url));
const options = { "--root": null, "--only": null, "--report-path": null };
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const name = argv[index];
  if (!(name in options)) {
    console.error(`unknown argument ${name}; use --root <dir>, --only <fixture-id>, or --report-path <file>`);
    process.exit(2);
  }
  if (options[name] !== null) {
    console.error(`duplicate option ${name}`);
    process.exit(2);
  }
  const value = argv[index + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    console.error(`missing value for ${name}`);
    process.exit(2);
  }
  options[name] = value;
  index += 1;
}

const root = realpathSync(resolve(options["--root"] ?? join(here, "..", "..")));
const referencePath = join(root, "skills", "gsd", "REFERENCE.md");
if (!existsSync(referencePath)) {
  console.error(`--root ${root} has no skills/gsd/REFERENCE.md`);
  process.exit(2);
}
const skillNames = new Set(readdirSync(join(root, "skills")).filter((name) => existsSync(join(root, "skills", name, "SKILL.md"))));
const fixtures = JSON.parse(readFileSync(join(here, "canon-fixtures.json"), "utf8"));
const valid = validateCanonFixtureSet(fixtures, skillNames);
if (!valid.ok) {
  console.error(`invalid canon fixtures: ${valid.detail}`);
  process.exit(2);
}
const run = options["--only"] ? fixtures.filter(({ id }) => id === options["--only"]) : fixtures;
if (run.length === 0) {
  console.error(`unknown --only canon fixture ${options["--only"]}`);
  process.exit(2);
}

const bootstrap = createBootstrap(root);
const fingerprint = evalSurfaceFingerprint({ bootstrap, repoRoot: root, canonSection: readFileSync(referencePath, "utf8") });
// The owner skills carry most of the answers, so an edit to one makes the report stale too.
const ownerSkills = [...new Set(fixtures.map(({ skill }) => skill))].sort();
const ownerSkillsSha256 = createHash("sha256")
  .update(ownerSkills.map((name) => readFileSync(join(root, "skills", name, "SKILL.md"), "utf8")).join("\0"))
  .digest("hex");

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

const backend = selectEvalBackend(process.env, process.env.GSD_EVAL_OMP || resolveOmp(process.env.PATH));
if (backend.kind === "skip") {
  console.log(`skip: ${backend.detail} — live canon compliance eval not run.`);
  process.exit(0);
}
if (backend.kind !== "omp") {
  console.error("canon compliance evaluation only supports the omp backend");
  process.exit(2);
}

const evalCwd = createEvalCwd();
const evalEnv = createEvalAgentEnv();
const timeoutSeconds = Number(process.env.GSD_EVAL_MAX_TIME || 90);

const system = (fixture) => `${bootstrap}

# Canon evaluation contract

This session owns the feature the workspace state describes and has selected \`${fixture.skill}\`. Read ${join(root, "skills", fixture.skill, "SKILL.md")} before deciding, and any GSD file it cites that the decision needs. Use only the \`read\` tool; never touch the workspace.
Then answer with only this JSON object, starting with an opening brace and ending with a closing brace, without Markdown: {"choice":"A"|"B"|"C"|"D"}`;
const askUser = (fixture) => `Workspace state: ${fixture.state}

User prompt:
${fixture.prompt}

Which action does GSD require next?
${Object.entries(fixture.options).map(([letter, text]) => `${letter}. ${text}`).join("\n")}`;

function askOmp(model, fixture) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(backend.command, [
      "-p",
      "--mode", "json",
      "--model", model,
      "--system-prompt", system(fixture),
      "--cwd", evalCwd,
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
    ], { stdio: ["ignore", "pipe", "pipe"], env: evalEnv });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      // A fixture that ran out of time is the model's miss to score, not a dead backend.
      if (code !== 0 && !stdout.includes('"type":"agent_end"')) {
        reject(new Error(`omp exit ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

const queue = backend.models.flatMap((model) => run.map((fixture) => ({ model, fixture })));
const results = new Map();
let backendFailure = null;
await Promise.all(
  Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let job; (job = queue.shift()); ) {
      if (backendFailure) return;
      const { model, fixture } = job;
      try {
        results.set(`${model}|${fixture.id}`, parseCanonComplianceEvents(await askOmp(model, fixture), fixture, referencePath));
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
  scope: "bootstrap + owner skills + canon (canon compliance axis)",
  bootstrap_sha256: fingerprint.bootstrap_sha256,
  bootstrap_words: fingerprint.bootstrap_words,
  canon_sha256: fingerprint.canon_sha256,
  canon_words: fingerprint.canon_words,
  owner_skills_sha256: ownerSkillsSha256,
  pass: {},
  canon_reads: {},
  failures: {},
};

let failed = 0;
console.log(`Root: ${root}\nCanon: ${fingerprint.canon_sha256.slice(0, 12)} (${fingerprint.canon_words} words)`);
for (const model of backend.models) {
  const failures = [];
  let canonReads = 0;
  console.log(`\n# ${backend.kind} canon compliance: ${model}`);
  for (const fixture of run) {
    const verdict = results.get(`${model}|${fixture.id}`);
    canonReads += verdict.readCanon ? 1 : 0;
    if (!verdict.pass) failures.push({ fixture: fixture.id, detail: verdict.detail });
    const reads = (verdict.reads ?? []).map((path) => (path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path));
    console.log(`${verdict.pass ? "ok  " : "FAIL"} ${fixture.id}: ${verdict.detail}${reads.length ? ` [${reads.join(", ")}]` : ""}`);
  }
  failed += failures.length;
  const passed = run.length - failures.length;
  report.pass[model] = { passed, total: run.length, accuracy: Math.round((passed / run.length) * 10000) / 100 };
  report.canon_reads[model] = canonReads;
  if (failures.length > 0) report.failures[model] = failures;
  console.log(`${passed}/${run.length} checks pass, REFERENCE read in ${canonReads} (${model})`);
}

const output = options["--report-path"] ?? join(here, "canon-compliance-report.json");
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Report: ${output}`);
process.exit(failed ? 1 : 0);
