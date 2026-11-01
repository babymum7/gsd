#!/usr/bin/env bun
// Optional live intent benchmark (decision 0049). Each fixture runs once per agent and arm in a
// real agent CLI under bwrap, vanilla and with GSD. After every agent turn the tree is graded
// against hidden tests and a deterministic simulated user answers, corrects, or stops. Rows land
// in the report as sessions finish; a rerun drops rows measured on other bytes and runs only the
// missing cells, so agents and fixtures can be added in small batches.
//
// Usage: GSD_EVAL_AGENTS=<backend:model>[,<backend:model>] bun test/eval/intent-eval.mjs
//          [--only <fixture-id>[,<fixture-id>]] [--arms <arm>[,<arm>]] [--report-path <file>]
//          [--fixtures <dir>] [--keep-runs]
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { buildPluginBundle } from "../../adapters/plugin/gsd-plugin-packager.mjs";
import { skillsDirNames, writeSkillsDir } from "../../adapters/plugin/gsd-skills-dir.mjs";
import {
  DEFAULT_INTENT_FIXTURES_DIR,
  DEFAULT_INTENT_REPORT_PATH,
  INTENT_ARMS,
  MAX_AGENT_TURNS,
  buildIntentReport,
  buildRow,
  buildTurn,
  cellKey,
  containsBootstrapMarker,
  firstPrompt,
  keepMatchingRows,
  loadIntentFixtures,
  nextUserMessage,
  parseAgents,
  parseTurn,
  turnAsks,
  validateIntentReport,
} from "./intent-eval-contract.mjs";
import { checkFixture, gitIdentityEnv, gradeSandboxArgs, gradeWorkspace, resolveCommand, sandboxEnv } from "./outcome-eval-contract.mjs";

// Caps per session, across all its turns. Only Claude reports cost, so only Claude enforces it.
const SESSION_MAX_COST_USD = 1;
const MIN_TURN_BUDGET_USD = 0.05;
const SESSION_MAX_MS = 20 * 60_000;
const SESSION_CONCURRENCY = 2;
// Session files larger than this are not scanned for bootstrap evidence.
const EVIDENCE_FILE_MAX_BYTES = 20 * 1024 * 1024;
const HARNESS_FILES = ["intent-eval.mjs", "intent-eval-contract.mjs"];
const DSH_BEGIN = "# gsd:dsh-hooks begin";
const DSH_END = "# gsd:dsh-hooks end";
// Shared temp dirs and the user's runtime dir are hidden in every session sandbox.
const HIDDEN_DIRS = ["/tmp", "/var/tmp", "/run/user"];
// Variables of the session that launched the runner, which must not leak into the measured one.
const DROPPED_ENV = /^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_JOB_DIR|GSD_SESSION|XDG_RUNTIME_DIR|DSH_HOME|TMPDIR)$/;

const here = dirname(fileURLToPath(import.meta.url));
const root = realpathSync(join(here, "..", ".."));
const home = homedir();

function fail(message) {
  console.error(message);
  process.exit(2);
}

const options = { "--only": null, "--arms": null, "--report-path": null, "--fixtures": null };
let keepRuns = false;
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const name = argv[index];
  if (name === "--keep-runs") {
    keepRuns = true;
    continue;
  }
  if (!(name in options)) fail(`unknown argument ${name}; use --only, --arms, --report-path, --fixtures, or --keep-runs`);
  if (options[name] !== null) fail(`duplicate option ${name}`);
  const value = argv[index + 1];
  if (value === undefined || value === "" || value.startsWith("--")) fail(`missing value for ${name}`);
  options[name] = value;
  index += 1;
}
const list = (value) => value?.split(",").map((item) => item.trim()).filter(Boolean) ?? null;
const arms = list(options["--arms"]) ?? INTENT_ARMS;
const badArm = arms.find((arm) => !INTENT_ARMS.includes(arm));
if (badArm) fail(`unknown --arms value ${badArm}; use ${INTENT_ARMS.join(", ")}`);
const reportPath = resolve(options["--report-path"] ?? join(root, DEFAULT_INTENT_REPORT_PATH));
const fixturesDir = resolve(options["--fixtures"] ?? join(root, DEFAULT_INTENT_FIXTURES_DIR));

if (!String(process.env.GSD_EVAL_AGENTS ?? "").trim()) {
  fail(
    "the intent eval spends real agent sessions, so it names them explicitly: set GSD_EVAL_AGENTS (for example GSD_EVAL_AGENTS=claude:claude-haiku-5-5,dsh:default,codex:gpt-6-luna)",
  );
}
const parsed = parseAgents(process.env.GSD_EVAL_AGENTS);
if (!parsed.ok) fail(`GSD_EVAL_AGENTS: ${parsed.detail}`);
const cli = {};
for (const backend of new Set(parsed.agents.map((agent) => agent.backend))) {
  const found = resolveCommand(backend, process.env.PATH);
  if (found) cli[backend] = realpathSync(found);
  else console.log(`skip: ${backend} is not on PATH, so its agents are not run`);
}
const agents = parsed.agents.filter((agent) => cli[agent.backend]);
if (agents.length === 0) {
  console.log("nothing to run: no named agent CLI is on PATH");
  process.exit(0);
}
const bwrap = resolveCommand("bwrap", process.env.PATH);
if (!bwrap) fail("the intent eval runs every session under bwrap, which is not on PATH; install bubblewrap (for example `apt install bubblewrap`) and rerun");

const loaded = loadIntentFixtures(fixturesDir);
if (!loaded.ok) fail(`invalid intent fixtures: ${loaded.detail}`);
const only = list(options["--only"]);
const unknown = only?.filter((id) => !loaded.fixtures.some((fixture) => fixture.id === id)) ?? [];
if (unknown.length > 0) fail(`unknown --only intent fixture ${unknown.join(", ")}`);
const fixtures = only ? loaded.fixtures.filter((fixture) => only.includes(fixture.id)) : loaded.fixtures;
if (fixtures.length === 0) fail(`no intent fixtures in ${fixturesDir}; add one there or pass --fixtures <dir>`);
const expected = new Map();
for (const fixture of fixtures) {
  const checked = checkFixture(fixture);
  if (!checked.ok) fail(`invalid intent fixture: ${checked.detail}`);
  expected.set(fixture.id, checked);
}

function listFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isDirectory()) files.push(...listFiles(path));
    else if (stat.isFile()) files.push(path);
  }
  return files;
}

function treeDigest(dir) {
  const hash = createHash("sha256");
  for (const path of listFiles(dir)) {
    hash.update(relative(dir, path));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const work = realpathSync(mkdtempSync(join(tmpdir(), "gsd-intent-")));
const runsDir = join(work, "runs");
mkdirSync(runsDir);
process.on("exit", () => {
  if (!keepRuns) rmSync(work, { recursive: true, force: true });
});
process.on("SIGINT", () => process.exit(130));

const { pluginRoot } = buildPluginBundle(root, join(work, "bundle"));
const bundleDigest = treeDigest(pluginRoot);
const codexHome = process.env.CODEX_HOME || join(home, ".codex");
const dshHome = process.env.DSH_HOME || join(home, ".dsh");
const codexPlugin = join(codexHome, "plugins", "cache", "gsd-local", "gsd");
const fingerprintBase = {
  harness_sha256: createHash("sha256")
    .update(HARNESS_FILES.map((name) => readFileSync(join(here, name), "utf8")).join("\0"))
    .digest("hex"),
  bundle: { claude: bundleDigest, dsh: bundleDigest, codex: existsSync(codexPlugin) ? treeDigest(codexPlugin) : null },
  fixtures: Object.fromEntries(loaded.fixtures.map((fixture) => [fixture.id, treeDigest(fixture.root)])),
  versions: Object.fromEntries(
    Object.entries(cli).map(([backend, path]) => [
      backend,
      String(spawnSync(path, ["--version"], { encoding: "utf8" }).stdout ?? "").trim().split("\n")[0] || null,
    ]),
  ),
};
function liveFingerprint(row) {
  return {
    fixture_sha256: fingerprintBase.fixtures[row.fixture] ?? null,
    harness_sha256: fingerprintBase.harness_sha256,
    cli_version: fingerprintBase.versions[row.backend] ?? null,
    bundle_sha256: row.arm === "gsd" ? (fingerprintBase.bundle[row.backend] ?? null) : null,
  };
}

let rows = [];
if (existsSync(reportPath)) {
  let existing;
  try {
    existing = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (error) {
    fail(`${reportPath} is not JSON (${error.message}); move it aside or pass another --report-path`);
  }
  const valid = validateIntentReport(existing);
  if (!valid.ok) fail(`${reportPath} is malformed (${valid.detail}); move it aside or pass another --report-path`);
  // A row for an agent or fixture this run does not name stays as it is.
  const named = (row) => agents.some((agent) => agent.backend === row.backend && agent.model === row.model) && cli[row.backend];
  const { kept, dropped } = keepMatchingRows(existing.rows, (row) => (named(row) ? liveFingerprint(row) : row));
  if (dropped > 0) console.log(`dropped ${dropped} row(s) measured on other bytes; their cells run again`);
  rows = kept;
}

const done = new Set(rows.map(cellKey));
const cells = [];
for (const agent of agents) {
  for (const fixture of fixtures) {
    for (const arm of arms) {
      const cell = { ...agent, fixture: fixture.id, arm };
      if (!done.has(cellKey(cell))) cells.push({ agent, fixture, arm });
    }
  }
}
if (cells.length === 0) {
  console.log(`nothing to run: every requested session is already in ${reportPath}`);
  process.exit(0);
}

function git(args, cwd, extraEnv = {}) {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...gitIdentityEnv(), ...extraEnv };
  return spawnSync("git", args, { cwd, env, encoding: "utf8" });
}

function initRepo(ws) {
  for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "Initial commit"]]) {
    const result = git(args, ws);
    if (result.status !== 0) throw new Error(`git ${args[0]} failed in ${ws}: ${result.stderr}`);
  }
}

// What a turn changed outside `.scratch/`: the commit it stands on plus every path git reports.
function treeState(ws) {
  const head = git(["rev-parse", "HEAD"], ws).stdout.trim();
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"], ws)
    .stdout.split("\n")
    .filter((line) => line && !line.slice(3).startsWith(".scratch/"));
  return `${head}\n${status.join("\n")}`;
}

// The main checkout holds every worktree, the hidden tests, and the clarifications.
function checkoutRoot() {
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], root).stdout.trim();
  return common ? dirname(common) : root;
}
const hiddenCheckout = checkoutRoot();

// dsh reads its whole configuration from DSH_HOME, so each run gets its own: the user's entries
// linked, its own sessions, the patch without GSD's row, and in the GSD arm the bundle's row and
// skills instead of the installed ones.
function buildDshHome(runDir, arm) {
  const target = join(runDir, "dsh-home");
  mkdirSync(join(target, "sessions"), { recursive: true });
  mkdirSync(join(target, "skills"));
  const gsdSkills = new Set(skillsDirNames(join(pluginRoot, "core"), { router: false }));
  for (const name of existsSync(dshHome) ? readdirSync(dshHome) : []) {
    if (["sessions", "skills", "cordis.patch.yml"].includes(name)) continue;
    symlinkSync(join(dshHome, name), join(target, name));
  }
  const skillsSource = join(dshHome, "skills");
  for (const name of existsSync(skillsSource) ? readdirSync(skillsSource) : []) {
    if (!gsdSkills.has(name)) symlinkSync(join(skillsSource, name), join(target, "skills", name));
  }
  const patchPath = join(dshHome, "cordis.patch.yml");
  const original = existsSync(patchPath) ? readFileSync(patchPath, "utf8") : "";
  const lines = original.split("\n");
  const begin = lines.indexOf(DSH_BEGIN);
  const end = lines.indexOf(DSH_END);
  const stripped = begin >= 0 && end > begin ? [...lines.slice(0, begin), ...lines.slice(end + 1)] : lines;
  if (arm === "gsd") {
    const adapter = join(pluginRoot, "adapters", "dsh", "gsd-context.mjs");
    stripped.push(DSH_BEGIN, "- insert:", "    - id: gsd", `      name: ${JSON.stringify(adapter)}`, DSH_END, "");
    writeSkillsDir(join(pluginRoot, "core"), join(target, "skills"), { router: false });
  }
  writeFileSync(join(target, "cordis.patch.yml"), stripped.join("\n"));
  return target;
}

function sessionSandboxArgs(runDir, stores) {
  const args = [
    "--ro-bind", "/", "/",
    "--dev", "/dev",
    "--proc", "/proc",
    "--unshare-pid", "--unshare-ipc", "--unshare-uts",
    "--new-session", "--die-with-parent",
  ];
  for (const dir of HIDDEN_DIRS) if (existsSync(dir)) args.push("--tmpfs", dir);
  args.push("--tmpfs", hiddenCheckout);
  // Agent homes stay writable for logins and session state.
  for (const rel of [".claude", ".claude.json", ".codex", ".dsh", ".cache", ".local/state", ".local/share/claude"]) {
    const path = join(home, rel);
    if (existsSync(path)) args.push("--bind", path, path);
  }
  // Past transcripts are replaced by this run's own store, which survives between its turns.
  for (const [store, dir] of stores) {
    mkdirSync(store, { recursive: true });
    if (existsSync(dir)) args.push("--bind", store, dir);
  }
  args.push("--bind", runDir, runDir, "--ro-bind", pluginRoot, pluginRoot, "--chdir", join(runDir, "ws"));
  return args;
}

const insideHidden = (path) => HIDDEN_DIRS.some((dir) => path === dir || path.startsWith(`${dir}/`));

// A version manager such as fnm puts its shims under /run/user, which the sandbox hides, so a
// PATH entry there is replaced by the directory it resolves to, or dropped when that is hidden too.
function sandboxPath(value) {
  const entries = [];
  for (const entry of String(value ?? "").split(":").filter(Boolean)) {
    if (!insideHidden(entry)) {
      entries.push(entry);
      continue;
    }
    try {
      const real = realpathSync(entry);
      if (!insideHidden(real)) entries.push(real);
    } catch {
      // a missing directory adds nothing to PATH
    }
  }
  return [...new Set(entries)].join(":");
}

function sessionEnv(extra) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !DROPPED_ENV.test(name)));
  return { ...env, PATH: sandboxPath(env.PATH), TMPDIR: "/tmp", NO_COLOR: "1", ...extra };
}

function spawnTurn(args, env, timeoutMs) {
  return new Promise((resolveTurn) => {
    const child = spawn(bwrap, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, Math.max(timeoutMs, 1000));
    const finish = (status, extra = "") => {
      clearTimeout(timer);
      resolveTurn({ status, killed, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") + extra });
    };
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => finish(null, `\n${error.message}`));
    child.on("close", (status) => finish(status));
  });
}

// Codex and dsh print no hook output; the session files they wrote show what the model saw.
function storeEvidence(dir) {
  if (!existsSync(dir)) return null;
  const files = listFiles(dir).filter((path) => lstatSync(path).size <= EVIDENCE_FILE_MAX_BYTES);
  if (files.length === 0) return null;
  return files.some((path) => containsBootstrapMarker(sessionText(path)));
}

// dsh compresses its session log with zstd; the cap bounds the decompressed text too.
function sessionText(path) {
  const bytes = readFileSync(path);
  if (!path.endsWith(".zstd")) return bytes.toString("utf8");
  try {
    return zstdDecompressSync(bytes, { maxOutputLength: EVIDENCE_FILE_MAX_BYTES }).toString("utf8");
  } catch {
    return "";
  }
}

function grade(fixture, runDir) {
  rmSync(join(runDir, "grade"), { recursive: true, force: true });
  const bunPath = realpathSync(process.execPath);
  const bunDir = dirname(bunPath);
  const result = gradeWorkspace({
    fixture,
    expected: expected.get(fixture.id),
    runDir,
    sandbox: {
      bwrap,
      bun: bunPath,
      args: gradeSandboxArgs({ realHome: home, gradeDir: join(runDir, "grade"), bunDir, checkout: root }),
      env: sandboxEnv({ realHome: home, bunDir }),
    },
  });
  return { result, passed: result.hidden.passed === result.hidden.total && result.regressions.length === 0 };
}

async function runCell({ agent, fixture, arm }) {
  const runDir = join(runsDir, `${fixture.id}-${arm}-${agent.backend}-${agent.model.replace(/[^A-Za-z0-9._-]+/g, "-")}`);
  const ws = join(runDir, "ws");
  mkdirSync(ws, { recursive: true });
  cpSync(join(fixture.root, "repo"), ws, { recursive: true });
  initRepo(ws);
  const extraEnv = {};
  const stores = [];
  let evidenceDir = null;
  if (agent.backend === "claude") stores.push([join(runDir, "store", "claude-projects"), join(home, ".claude", "projects")]);
  if (agent.backend === "codex") {
    evidenceDir = join(runDir, "store", "codex-sessions");
    stores.push([evidenceDir, join(codexHome, "sessions")]);
  }
  if (agent.backend === "dsh") {
    extraEnv.DSH_HOME = buildDshHome(runDir, arm);
    evidenceDir = join(extraEnv.DSH_HOME, "sessions");
  }
  const sandbox = sessionSandboxArgs(runDir, stores);
  const env = sessionEnv(extraEnv);

  const turns = [];
  let sessionId = agent.backend === "claude" ? randomUUID() : null;
  let message = firstPrompt(fixture);
  let disclosed = false;
  let recommended = false;
  let spent = 0;
  let last = null;
  const started = Date.now();
  for (let turn = 1; turn <= MAX_AGENT_TURNS; turn += 1) {
    const remainingMs = SESSION_MAX_MS - (Date.now() - started);
    const budgetUsd = Number((SESSION_MAX_COST_USD - spent).toFixed(2));
    if (remainingMs <= 0 || (agent.backend === "claude" && budgetUsd < MIN_TURN_BUDGET_USD)) break;
    const before = treeState(ws);
    const command = buildTurn({ ...agent, arm, message, sessionId, turn, bundle: { pluginRoot }, budgetUsd });
    const run = await spawnTurn([...sandbox, "--", cli[agent.backend], ...command.args], env, remainingMs);
    writeFileSync(join(runDir, `turn-${turn}.stdout`), run.stdout);
    writeFileSync(join(runDir, `turn-${turn}.stderr`), run.stderr);
    const parsedTurn = parseTurn(agent.backend, run.stdout);
    sessionId = parsedTurn.sessionId ?? sessionId;
    spent += parsedTurn.costUsd ?? 0;
    if (evidenceDir) parsedTurn.bootstrapSeen = storeEvidence(evidenceDir);
    last = grade(fixture, runDir);
    const changed = treeState(ws) !== before;
    // A turn the agent never answered leaves nobody to reply to.
    const decision = parsedTurn.replied
      ? nextUserMessage({ fixture, turn, passed: last.passed, text: parsedTurn.text, changed, disclosed, recommended })
      : { action: "stop" };
    turns.push({
      ...parsedTurn,
      changed,
      question: parsedTurn.replied && turnAsks({ text: parsedTurn.text, changed }),
      event: decision.action === "reply" ? decision.event : null,
      passed: last.passed,
    });
    if (decision.action === "stop" || run.killed || !sessionId) break;
    if (decision.event === "recommended") recommended = true;
    else disclosed = true;
    message = decision.message;
  }
  return buildRow({
    fixture,
    agent,
    arm,
    turns,
    grade: last?.result ?? { hidden: { passed: 0, total: expected.get(fixture.id).hidden.length, failing: [] }, regressions: [], visible_tests_edited: [] },
    wallMs: Date.now() - started,
    fingerprint: liveFingerprint({ fixture: fixture.id, backend: agent.backend, arm }),
  });
}

function writeReport() {
  const report = buildIntentReport({ rows });
  const valid = validateIntentReport(report);
  if (!valid.ok) {
    keepRuns = true;
    fail(`the report failed its own contract (${valid.detail}); runs kept in ${runsDir}`);
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
    const events = [row.asked && "asked", row.corrected && "corrected", row.recommended && "recommended"].filter(Boolean).join(",") || "-";
    const cost = row.cost_usd === null ? "n/a" : `${row.cost_usd.toFixed(4)} USD`;
    console.log(
      `${row.fixture} ${row.arm} ${row.backend}:${row.model}: ${row.passed ? "pass" : "fail"}${invalid} hidden ${row.hidden.passed}/${row.hidden.total} turns ${row.agent_turns} events ${events} tokens ${row.tokens} cost ${cost} wall ${Math.round(row.wall_ms / 1000)}s`,
    );
  }
}
await Promise.all(Array.from({ length: Math.min(SESSION_CONCURRENCY, cells.length) }, worker));
console.log(`Report: ${reportPath}`);
if (keepRuns) console.log(`Runs kept: ${runsDir}`);
