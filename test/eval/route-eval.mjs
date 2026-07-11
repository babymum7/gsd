#!/usr/bin/env node
// Live-LLM routing eval for the gsd master skill.
//
// The string-contract suite (test/skills.test.js) proves the skill SAYS the right
// thing; this eval proves a model READING it DOES the right thing. Two modes per
// fixture (workspace state + user prompt):
//   classify — model returns {"route","skill"} JSON; asserts the routing decision.
//   trace    — model returns the FIRST LINE of its first response; asserts the
//              documented route-trace contract (`Route N → target`). Meta fixtures
//              (pause/catalog) have no numbered trace and are skipped here.
//
// Opt-in and network-bound — NEVER wired into `node --test`. Skips (exit 0) unless
// an OpenAI-compatible endpoint is configured:
//   GSD_EVAL_KEY   (or OPENAI_API_KEY)  — bearer token           [required]
//   GSD_EVAL_URL   — base URL            (default https://api.openai.com/v1)
//   GSD_EVAL_MODEL — model name          (default gpt-4o-mini)
//
// Usage: node test/eval/route-eval.mjs [--mode classify|trace|both] [--only <fixture-id>]
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseClassifyResponse, parseTraceResponse, responseMatchesFixture, validateFixtureSet,
} from "./route-eval-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8"));
const skill = readFileSync(join(here, "..", "..", "skills", "gsd", "SKILL.md"), "utf8");
const skillsDir = join(here, "..", "..", "skills");
const installedSkills = new Set(
  readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("gsd"))
    .map((entry) => entry.name),
);
const fixtureValidation = validateFixtureSet(fixtures, installedSkills);
if (!fixtureValidation.ok) {
  console.error(`invalid fixtures.json: ${fixtureValidation.detail}`);
  process.exit(2);
}
let MODE = "both";
let ONLY = null;
const seenOptions = new Set();
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const name = argv[index];
  if (name !== "--mode" && name !== "--only") {
    console.error(`unknown argument ${name}; use --mode <classify|trace|both> and --only <fixture-id>`);
    process.exit(2);
  }
  if (seenOptions.has(name)) {
    console.error(`duplicate option ${name}`);
    process.exit(2);
  }
  const value = argv[index + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    console.error(`missing value for ${name}`);
    process.exit(2);
  }
  seenOptions.add(name);
  if (name === "--mode") MODE = value;
  else ONLY = value;
  index += 1;
}
const modes = MODE === "both" ? ["classify", "trace"] : [MODE];
if (modes.some((mode) => !["classify", "trace"].includes(mode))) {
  console.error(`unknown --mode ${MODE} (classify|trace|both)`);
  process.exit(2);
}
const run = ONLY ? fixtures.filter(({ id }) => id === ONLY) : fixtures;
if (ONLY && run.length === 0) {
  console.error(`unknown --only fixture ${ONLY}`);
  process.exit(2);
}

const KEY = process.env.GSD_EVAL_KEY || process.env.OPENAI_API_KEY;
const BASE = (process.env.GSD_EVAL_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const MODEL = process.env.GSD_EVAL_MODEL || "gpt-4o-mini";

if (!KEY) {
  console.log("skip: GSD_EVAL_KEY / OPENAI_API_KEY not set — live routing eval not run.");
  process.exit(0);
}


const PREAMBLE = [
  "You are a coding agent. Exactly one skill is loaded: the gsd master entry below.",
  "Given the workspace state and the user prompt, apply its Smart Routing Engine and decide the route.",
];
const SYSTEMS = {
  classify: [
    ...PREAMBLE,
    'Reply with ONLY a JSON object: {"route": "<0|1|2|3|4|5|6|meta>", "skill": "<the gsd-* skill you would load next; \\"none\\" when you answer directly / enter Discussion; \\"catalog\\" for the skill-catalog action>"}.',
    "No prose, no markdown fence.",
    "",
    skill,
  ].join("\n"),
  trace: [
    ...PREAMBLE,
    "Reply with ONLY the exact trace line `Route <route> → <target>`, where target is the selected skill, `none`, or `catalog`. Nothing else.",
    "",
    skill,
  ].join("\n"),
};

async function ask(system, fx) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Workspace state: ${fx.state}\n\nUser prompt:\n${fx.prompt}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body.choices?.[0]?.message?.content ?? "";
}

const checks = {
  async classify(fx) {
    const text = await ask(SYSTEMS.classify, fx);
    const parsed = parseClassifyResponse(text, installedSkills);
    if (!parsed.ok) return { pass: false, detail: parsed.detail };
    const pass = responseMatchesFixture(parsed.value, fx);
    return {
      pass,
      detail: `want ${fx.route}->${fx.skill}, got ${parsed.value.route}->${parsed.value.skill}`,
    };
  },
  async trace(fx) {
    if (fx.route === "meta") return { pass: true, detail: "meta — no numbered trace, skipped" };
    const text = await ask(SYSTEMS.trace, fx);
    const parsed = parseTraceResponse(text, installedSkills);
    if (!parsed.ok) return { pass: false, detail: parsed.detail };
    const pass = responseMatchesFixture(parsed.value, fx);
    return {
      pass,
      detail: `want Route ${fx.route} → ${fx.skill}, got Route ${parsed.value.route} → ${parsed.value.skill}`,
    };
  },
};


// Small concurrency pool: fast without hammering the endpoint.
const jobs = modes.flatMap((mode) => run.map((fx) => ({ mode, fx })));
const queue = [...jobs];
const results = new Map();
await Promise.all(
  Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let job; (job = queue.shift()); ) {
      const key = `${job.mode}:${job.fx.id}`;
      try {
        results.set(key, await checks[job.mode](job.fx));
      } catch (err) {
        results.set(key, { pass: false, detail: String(err.message ?? err) });
      }
    }
  }),
);

let failed = 0;
for (const { mode, fx } of jobs) {
  const { pass, detail } = results.get(`${mode}:${fx.id}`);
  failed += pass ? 0 : 1;
  console.log(`${pass ? "ok  " : "FAIL"} [${mode}] ${fx.id}: ${detail}`);
}
console.log(`\n${jobs.length - failed}/${jobs.length} checks pass (model: ${MODEL})`);
process.exit(failed ? 1 : 0);
