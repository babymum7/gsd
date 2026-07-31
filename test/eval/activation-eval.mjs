#!/usr/bin/env node
// Optional live-LLM activation evaluation for the exact production GSD bootstrap.
//
// Backend selection (see selectEvalBackend):
//   the local `omp` binary is preferred and needs no key; it runs one isolated
//   non-interactive print per fixture and its stdout is the model's raw reply.
//   GSD_EVAL_BACKEND  force `omp` or `http`
//   GSD_EVAL_KEY      (or OPENAI_API_KEY) bearer token for the http backend
//   GSD_EVAL_URL      OpenAI-compatible base URL (default https://api.openai.com/v1)
//   GSD_EVAL_MODEL    comma-separated model list; every model is evaluated
//
// Usage: node test/eval/activation-eval.mjs [--only <fixture-id>]
import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
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

let only = null;
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const name = argv[index];
  if (name !== "--only") {
    console.error(`unknown argument ${name}; use --only <fixture-id>`);
    process.exit(2);
  }
  if (only !== null) {
    console.error("duplicate option --only");
    process.exit(2);
  }
  const value = argv[index + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    console.error("missing value for --only");
    process.exit(2);
  }
  only = value;
  index += 1;
}

const run = only ? fixtures.filter(({ id }) => id === only) : fixtures;
if (only && run.length === 0) {
  console.error(`unknown --only fixture ${only}`);
  process.exit(2);
}

const ompPath = process.env.GSD_EVAL_OMP || resolveOmp(process.env.PATH);
const backend = selectEvalBackend(process.env, ompPath);
if (backend.kind === "skip") {
  console.log(`skip: ${backend.detail} — live activation eval not run.`);
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
await Promise.all(
  Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let job; (job = queue.shift()); ) {
      const { model, fixture } = job;
      const resultKey = `${model}|${fixture.id}`;
      try {
        const parsed = parseActivationResponse(await ask(model, fixture), installedSkills);
        if (!parsed.ok) {
          results.set(resultKey, { pass: false, detail: parsed.detail });
          continue;
        }
        results.set(resultKey, {
          pass: responseMatchesFixture(parsed.value, fixture),
          detail: `want ${fixture.decision}:${fixture.expectedAction}->${fixture.expectedPrimarySkill}, got ${parsed.value.decision}:${parsed.value.action}->${parsed.value.primarySkill}`,
        });
      } catch (error) {
        results.set(resultKey, { pass: false, detail: String(error.message ?? error) });
      }
    }
  }),
);

let failed = 0;
for (const model of backend.models) {
  let modelFailed = 0;
  console.log(`\n# ${backend.kind}: ${model}`);
  for (const fixture of run) {
    const { pass, detail } = results.get(`${model}|${fixture.id}`);
    modelFailed += pass ? 0 : 1;
    console.log(`${pass ? "ok  " : "FAIL"} ${fixture.id}: ${detail}`);
  }
  failed += modelFailed;
  console.log(`${run.length - modelFailed}/${run.length} checks pass (${model})`);
}
process.exit(failed ? 1 : 0);
