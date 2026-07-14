#!/usr/bin/env node
// Optional live-LLM activation evaluation for the exact production GSD bootstrap.
//
// Configuration:
//   GSD_EVAL_KEY   (or OPENAI_API_KEY)  bearer token [required]
//   GSD_EVAL_URL   OpenAI-compatible base URL (default https://api.openai.com/v1)
//   GSD_EVAL_MODEL model name (default gpt-4o-mini)
//
// Usage: node test/eval/activation-eval.mjs [--only <fixture-id>]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseActivationResponse,
  responseMatchesFixture,
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

const key = process.env.GSD_EVAL_KEY || process.env.OPENAI_API_KEY;
const base = (process.env.GSD_EVAL_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const model = process.env.GSD_EVAL_MODEL || "gpt-4o-mini";
if (!key) {
  console.log("skip: GSD_EVAL_KEY / OPENAI_API_KEY not set — live activation eval not run.");
  process.exit(0);
}

const system = [
  "You are a coding agent. The exact production GSD session bootstrap is loaded below.",
  "Given the workspace state and current user prompt, apply its result-marker decision matrix and lazy skill-selection policy.",
  "Choose only the primary process owner. Helper skills such as gsd-ponytail are not represented in primarySkill.",
  'Reply with ONLY exact JSON: {"decision":"<ordinary-routing|ignore-terminal-record|cleanup-question|cleanup-only|block-resume|fail-closed>","action":"<load|direct|stop>","primarySkill":"<visible gsd-* skill>" or null}.',
  "Use load with one visible primary skill, direct with null when no primary skill applies, and stop with null for every cleanup/block/fail-closed decision.",
  "No prose. No markdown fence.",
  "",
  bootstrap,
].join("\n");

async function ask(fixture) {
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Workspace state: ${fixture.state}\n\nUser prompt:\n${fixture.prompt}` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${await response.text()}`);
  const body = await response.json();
  return body.choices?.[0]?.message?.content ?? "";
}

const queue = [...run];
const results = new Map();
await Promise.all(
  Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let fixture; (fixture = queue.shift()); ) {
      try {
        const parsed = parseActivationResponse(await ask(fixture), installedSkills);
        if (!parsed.ok) {
          results.set(fixture.id, { pass: false, detail: parsed.detail });
          continue;
        }
        const pass = responseMatchesFixture(parsed.value, fixture);
        results.set(fixture.id, {
          pass,
          detail: `want ${fixture.decision}:${fixture.expectedAction}->${fixture.expectedPrimarySkill}, got ${parsed.value.decision}:${parsed.value.action}->${parsed.value.primarySkill}`,
        });
      } catch (error) {
        results.set(fixture.id, { pass: false, detail: String(error.message ?? error) });
      }
    }
  }),
);

let failed = 0;
for (const fixture of run) {
  const { pass, detail } = results.get(fixture.id);
  failed += pass ? 0 : 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${fixture.id}: ${detail}`);
}
console.log(`\n${run.length - failed}/${run.length} checks pass (model: ${model})`);
process.exit(failed ? 1 : 0);
