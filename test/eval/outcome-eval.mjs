#!/usr/bin/env bun
// Optional live outcome benchmark (decision 0044). Each fixture runs once per model, repeat, and
// arm in an omp session under bwrap, vanilla and with GSD, and the tree each session leaves is
// graded against hidden tests. Rows land in the report as sessions finish, and a rerun with a
// higher --repeats resumes into a report measured on the same bytes.
//
// Usage: GSD_EVAL_MODEL=<model>[,<model>] bun test/eval/outcome-eval.mjs [--repeats <n>]
//          [--only <fixture-id>[,<fixture-id>]] [--report-path <file>] [--fixtures <dir>] [--keep-runs]
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_FIXTURES_DIR,
  DEFAULT_REPORT_PATH,
  OUTCOME_ARMS,
  SESSION_CONCURRENCY,
  SESSION_KILL_GRACE_MS,
  SESSION_MAX_TIME_MS,
  WRAPPER_CONFIG_FILE,
  WRAPPER_FILE,
  buildOmpArgs,
  buildOverlay,
  buildReport,
  cellKey,
  checkFixture,
  classifyOutcome,
  fingerprintMismatches,
  gitIdentityEnv,
  gradeSandboxArgs,
  gradeWorkspace,
  loadFixtures,
  ompAgentDir,
  outcomeFingerprint,
  prepareBundle,
  resolveCommand,
  sandboxEnv,
  sessionSandboxArgs,
  summarizeOmpEvents,
  validateOutcomeReport,
} from "./outcome-eval-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = realpathSync(join(here, "..", ".."));
const options = { "--repeats": null, "--only": null, "--report-path": null, "--fixtures": null };
let keepRuns = false;
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const name = argv[index];
  if (name === "--keep-runs") {
    keepRuns = true;
    continue;
  }
  if (!(name in options)) {
    console.error(`unknown argument ${name}; use --repeats <n>, --only <fixture-id>, --report-path <file>, --fixtures <dir>, or --keep-runs`);
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
const repeats = options["--repeats"] === null ? 1 : Number(options["--repeats"]);
if (!Number.isInteger(repeats) || repeats < 1) {
  console.error(`--repeats must be a positive integer, got ${options["--repeats"]}`);
  process.exit(2);
}
const reportPath = resolve(options["--report-path"] ?? join(root, DEFAULT_REPORT_PATH));
const fixturesDir = resolve(options["--fixtures"] ?? join(root, DEFAULT_FIXTURES_DIR));

const backendChoice = String(process.env.GSD_EVAL_BACKEND ?? "").trim();
if (backendChoice && backendChoice !== "omp") {
  console.error(`the outcome eval runs omp sessions only (GSD_EVAL_BACKEND is ${backendChoice}); unset it or set GSD_EVAL_BACKEND=omp`);
  process.exit(2);
}
const bwrap = resolveCommand("bwrap", process.env.PATH);
if (!bwrap) {
  console.error("the outcome eval runs every session under bwrap, which is not on PATH; install bubblewrap (for example `apt install bubblewrap`) and rerun");
  process.exit(2);
}
const ompFound = process.env.GSD_EVAL_OMP || resolveCommand("omp", process.env.PATH);
if (!ompFound) {
  console.log("skip: no omp binary (set GSD_EVAL_OMP or put omp on PATH) — live outcome eval not run.");
  process.exit(0);
}
const models = String(process.env.GSD_EVAL_MODEL ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
if (models.length === 0) {
  console.error("the outcome eval spends real sessions, so it names its model explicitly: set GSD_EVAL_MODEL (for example GSD_EVAL_MODEL=google-antigravity/gemini-3.8-flash)");
  process.exit(2);
}

const loaded = loadFixtures(fixturesDir);
if (!loaded.ok) {
  console.error(`invalid outcome fixtures: ${loaded.detail}`);
  process.exit(2);
}
const only = options["--only"]?.split(",").map((id) => id.trim()).filter(Boolean) ?? null;
const unknown = only?.filter((id) => !loaded.fixtures.some((fixture) => fixture.id === id)) ?? [];
if (unknown.length > 0) {
  console.error(`unknown --only outcome fixture ${unknown.join(", ")}`);
  process.exit(2);
}
const fixtures = only ? loaded.fixtures.filter((fixture) => only.includes(fixture.id)) : loaded.fixtures;
if (fixtures.length === 0) {
  console.error(`no outcome fixtures in ${fixturesDir}; add one there or pass --fixtures <dir>`);
  process.exit(2);
}
const expected = new Map();
for (const fixture of fixtures) {
  const checked = checkFixture(fixture);
  if (!checked.ok) {
    console.error(`invalid outcome fixture: ${checked.detail}`);
    process.exit(2);
  }
  expected.set(fixture.id, checked);
}

const work = realpathSync(mkdtempSync(join(tmpdir(), "gsd-outcome-")));
const runsDir = join(work, "runs");
const bundleDir = join(work, "bundle");
mkdirSync(runsDir);
process.on("exit", () => {
  if (!keepRuns) rmSync(work, { recursive: true, force: true });
});
process.on("SIGINT", () => process.exit(130));

const bundle = prepareBundle(root, bundleDir);
const fingerprint = outcomeFingerprint(bundle, fixturesDir);
const ompPath = realpathSync(ompFound);
const versionRun = spawnSync(ompPath, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const ompVersion = String(versionRun.stdout ?? "").trim().split("\n")[0];
if (versionRun.status !== 0 || !ompVersion) {
  console.error(`${ompFound} --version failed: ${String(versionRun.stderr ?? "").trim()}`);
  process.exit(2);
}

let rows = [];
if (existsSync(reportPath)) {
  let existing;
  try {
    existing = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (error) {
    console.error(`${reportPath} is not JSON (${error.message}); move it aside or pass another --report-path`);
    process.exit(2);
  }
  const valid = validateOutcomeReport(existing);
  if (!valid.ok) {
    console.error(`${reportPath} is malformed (${valid.detail}); move it aside or pass another --report-path`);
    process.exit(2);
  }
  const mismatched = fingerprintMismatches(existing.fingerprint, fingerprint);
  if (existing.omp_version !== ompVersion) mismatched.push("omp_version");
  if (mismatched.length > 0) {
    console.error(`${reportPath} was measured on other bytes (${mismatched.join(", ")}); a run resumes only into a matching report, so pass a fresh --report-path`);
    process.exit(2);
  }
  rows = existing.rows;
}

const done = new Set(rows.map(cellKey));
const cells = [];
for (const model of models) {
  for (const fixture of fixtures) {
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      for (const arm of OUTCOME_ARMS) {
        if (!done.has(cellKey({ model, fixture: fixture.id, repeat, arm }))) cells.push({ model, fixture, repeat, arm });
      }
    }
  }
}
if (cells.length === 0) {
  console.log(`nothing to run: every requested session is already in ${reportPath}`);
  process.exit(0);
}

const realHome = homedir();
const agentDir = ompAgentDir(process.env);
const bunPath = realpathSync(process.execPath);
const bunDir = dirname(bunPath);

function initRepo(ws) {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...gitIdentityEnv() };
  for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "Initial commit"]]) {
    const result = spawnSync("git", args, { cwd: ws, env, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed in ${ws}: ${result.stderr}`);
  }
}

function spawnSession(args, env) {
  return new Promise((resolveSession) => {
    const child = spawn(bwrap, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, SESSION_MAX_TIME_MS + SESSION_KILL_GRACE_MS);
    const finish = (status, extra = "") => {
      clearTimeout(timer);
      resolveSession({
        status,
        killed,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8") + extra,
      });
    };
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => finish(null, `\n${error.message}`));
    child.on("close", (status) => finish(status));
  });
}

function countLines(path) {
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).length : 0;
}

// Both arms get the same files: the wrapper and its config sit in the vanilla run unused.
async function runCell({ model, fixture, repeat, arm }) {
  const runDir = join(runsDir, `${fixture.id}-${arm}-r${repeat}-${model.replace(/[^A-Za-z0-9._-]+/g, "-")}`);
  const ws = join(runDir, "ws");
  const harnessDir = join(runDir, "harness");
  const wrapperDir = join(runDir, "wrapper");
  for (const dir of [ws, harnessDir, wrapperDir, join(runDir, "home")]) mkdirSync(dir, { recursive: true });
  cpSync(join(fixture.root, "repo"), ws, { recursive: true });
  initRepo(ws);
  writeFileSync(join(harnessDir, "overlay.yml"), buildOverlay(model));
  writeFileSync(join(harnessDir, "empty-config.yml"), "{}\n");
  writeFileSync(join(harnessDir, "mcp.json"), '{ "mcpServers": {} }\n');
  const evidencePath = join(wrapperDir, "evidence.jsonl");
  cpSync(join(here, WRAPPER_FILE), join(wrapperDir, WRAPPER_FILE));
  writeFileSync(join(wrapperDir, WRAPPER_CONFIG_FILE), `${JSON.stringify({ adapter: bundle.adapterPath, evidence: evidencePath })}\n`);

  const ompArgs = buildOmpArgs({
    arm,
    model,
    ws,
    overlayPath: join(harnessDir, "overlay.yml"),
    wrapperPath: join(wrapperDir, WRAPPER_FILE),
    prompt: fixture.prompt,
  });
  const sandbox = sessionSandboxArgs({ realHome, runDir, agentDir, ompPath, bunDir, bundleDir, checkout: root, harnessDir });
  const started = Date.now();
  const session = await spawnSession([...sandbox, "--", ompPath, ...ompArgs], sandboxEnv({ realHome, bunDir, agentDir }));
  const wallMs = Date.now() - started;
  writeFileSync(join(runDir, "events.jsonl"), session.stdout);
  writeFileSync(join(runDir, "stderr.txt"), session.stderr);

  const usage = summarizeOmpEvents(session.stdout);
  const injections = arm === "gsd" ? countLines(evidencePath) : null;
  const grade = gradeWorkspace({
    fixture,
    expected: expected.get(fixture.id),
    runDir,
    sandbox: {
      bwrap,
      bun: bunPath,
      args: gradeSandboxArgs({ realHome, gradeDir: join(runDir, "grade"), bunDir, checkout: root }),
      env: sandboxEnv({ realHome, bunDir }),
    },
  });
  // A session that never reached the model measured nothing in either arm.
  const invalidReason =
    usage.turns === 0
      ? `omp produced no assistant turn (exit ${session.status ?? "by signal"})`
      : injections === 0
        ? "no bootstrap injection evidence from the wrapper"
        : null;
  return {
    fixture: fixture.id,
    kind: fixture.kind,
    arm,
    repeat,
    model,
    outcome: classifyOutcome({ status: session.status, killed: session.killed, wallMs }),
    exit_code: session.status,
    valid: invalidReason === null,
    invalid_reason: invalidReason,
    bootstrap_injections: injections,
    ...grade,
    ...usage,
    wall_ms: wallMs,
  };
}

function writeReport() {
  const report = buildReport({ fingerprint, ompVersion, rows });
  const valid = validateOutcomeReport(report);
  if (!valid.ok) {
    keepRuns = true;
    console.error(`the report failed its own contract (${valid.detail}); runs kept in ${runsDir}`);
    process.exit(2);
  }
  mkdirSync(dirname(reportPath), { recursive: true });
  const temp = `${reportPath}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(temp, reportPath);
}

let next = 0;
async function worker() {
  while (next < cells.length) {
    const cell = cells[next];
    next += 1;
    const row = await runCell(cell);
    rows = [...rows, row];
    writeReport();
    const invalid = row.valid ? "" : ` (invalid: ${row.invalid_reason})`;
    console.log(
      `${row.fixture} ${row.arm} r${row.repeat} ${row.model}: ${row.outcome}${invalid} hidden ${row.hidden.passed}/${row.hidden.total} regressions ${row.regressions.length} cost ${row.cost_usd.toFixed(4)} USD wall ${Math.round(row.wall_ms / 1000)}s`,
    );
  }
}
await Promise.all(Array.from({ length: Math.min(SESSION_CONCURRENCY, cells.length) }, worker));
console.log(`Report: ${reportPath}`);
if (keepRuns) console.log(`Runs kept: ${runsDir}`);
