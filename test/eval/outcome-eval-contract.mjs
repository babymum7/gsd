// The outcome benchmark's contract (decision 0044): fixture loading and checking, the sandbox
// and launch arguments both arms share, event accounting, grading, and the committed report's
// shape. The runner in outcome-eval.mjs owns processes and output; this module returns values.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, join, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { buildPluginBundle } from "../../adapters/plugin/gsd-plugin-packager.mjs";
import { createBootstrap } from "../../lib/gsd-bootstrap.mjs";
import { resolveGsdRoot } from "../../lib/gsd-session-context.mjs";
import { evalSurfaceFingerprint } from "./activation-eval-contract.mjs";

export const OUTCOME_ARMS = ["vanilla", "gsd"];
export const FIXTURE_KINDS = ["bug", "feature", "refactor", "regression"];
export const OUTCOMES = ["ok", "cost-cap", "time-cap", "error"];
export const REPORT_SCOPE = "omp sessions with and without GSD (outcome axis)";
export const DEFAULT_FIXTURES_DIR = "test/eval/outcome-fixtures";
export const DEFAULT_REPORT_PATH = "test/eval/outcome-report.json";
export const SESSION_MAX_COST_USD = 1;
const SESSION_MAX_MINUTES = 20;
export const SESSION_MAX_TIME = `${SESSION_MAX_MINUTES}m`;
export const SESSION_MAX_TIME_MS = SESSION_MAX_MINUTES * 60_000;
// The runner kills a session this long after omp's own --max-time should have stopped it.
export const SESSION_KILL_GRACE_MS = 2 * 60_000;
export const SESSION_CONCURRENCY = 2;
const GRADE_TIMEOUT_MS = 2 * 60_000;
// omp's print mode exits 3 when --max-cost stops the session.
const OMP_COST_CAP_EXIT = 3;
export const THINKING_LEVEL = "high";
export const SESSION_TOOLS = ["read", "bash", "edit", "write", "grep", "glob", "task", "todo"];
// Every role omp can route a request to. The user's own roles sent sub-agents and the advisor
// to other models, so the overlay pins each one to the measured model.
export const MODEL_ROLES = ["default", "smol", "slow", "plan", "task", "vision", "designer", "commit", "advisor", "tiny"];
// Print mode has nobody to answer, so both arms get the same closing instruction.
export const AUTONOMY_SUFFIX =
  "Work autonomously until the task is finished: nobody will answer questions during this session, so whenever a choice comes up, take the option you would recommend. Leave the finished work in the checked-out working tree of this repository.";
export const WRAPPER_FILE = "outcome-eval-wrapper.js";
// The wrapper finds its config beside itself under the same name with a .json extension.
export const WRAPPER_CONFIG_FILE = WRAPPER_FILE.replace(/\.js$/, ".json");
const HARNESS_FILES = ["outcome-eval.mjs", "outcome-eval-contract.mjs", WRAPPER_FILE];
const FIXTURE_KEYS = ["id", "kind", "summary"];
const TEST_FILE_SUFFIX = ".test.js";
const COST_DECIMALS = 9;
const EVAL_GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "GSD Eval",
  GIT_AUTHOR_EMAIL: "eval@example.invalid",
  GIT_COMMITTER_NAME: "GSD Eval",
  GIT_COMMITTER_EMAIL: "eval@example.invalid",
};
// Shared temp dirs and the user's runtime dir (ssh-agent, keyring, D-Bus) are hidden in every
// sandbox. The home directory is replaced instead, so tools still find a writable $HOME.
const HIDDEN_DIRS = ["/tmp", "/var/tmp", "/run/user"];
const DOCKER_SOCKET = "/run/docker.sock";
const SYSTEM_PATH = ["/usr/local/bin", "/usr/bin", "/bin"];
// Agent-dir entries that would carry the user's history or setup into a session.
const HIDDEN_AGENT_DIRS = ["sessions", "terminal-sessions", "agents", "extensions"];
const REPORT_KEYS = ["scope", "fingerprint", "omp_version", "settings", "fixtures", "summary", "rows"];
const FINGERPRINT_KEYS = ["bootstrap_sha256", "bootstrap_words", "bundle_sha256", "fixtures_sha256", "harness_sha256"];
const SETTINGS_KEYS = ["thinking", "max_cost_usd", "max_time", "tools", "pinned_roles", "sandbox"];
const ROW_KEYS = [
  "fixture",
  "kind",
  "arm",
  "repeat",
  "model",
  "outcome",
  "exit_code",
  "valid",
  "invalid_reason",
  "bootstrap_injections",
  "hidden",
  "regressions",
  "visible_tests_edited",
  "tokens",
  "cost_usd",
  "turns",
  "tool_calls",
  "subagents",
  "wall_ms",
];
const TOKEN_KEYS = ["input", "output", "cache_read", "cache_write", "subagent", "total"];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function isText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isTextList(value) {
  return Array.isArray(value) && value.every(isText);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function roundCost(value) {
  return Number(value.toFixed(COST_DECIMALS));
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function resolveCommand(name, pathEnv) {
  for (const dir of String(pathEnv ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not in this directory
    }
  }
  return null;
}

// omp keeps auth, models, and session transcripts here.
export function ompAgentDir(env = process.env) {
  return env.PI_CODING_AGENT_DIR || join(homedir(), ".omp", "agent");
}

function testFiles(dir) {
  return isDirectory(dir) ? readdirSync(dir).filter((name) => name.endsWith(TEST_FILE_SUFFIX)).sort(compareText) : [];
}

// A fixture is `<id>/` with fixture.json, prompt.md, the starting repo, hidden tests written as
// if they sat in repo/test/, and a solution overlay. A missing fixture directory is an empty set.
export function loadFixtures(dir) {
  if (!existsSync(dir)) return { ok: true, fixtures: [] };
  const fixtures = [];
  for (const id of readdirSync(dir).sort(compareText)) {
    const root = join(dir, id);
    if (!isDirectory(root)) return { ok: false, detail: `${id}: a fixture must be a directory` };
    let meta;
    try {
      meta = JSON.parse(readFileSync(join(root, "fixture.json"), "utf8"));
    } catch (error) {
      return { ok: false, detail: `${id}/fixture.json: ${error.message}` };
    }
    if (!hasExactKeys(meta, FIXTURE_KEYS)) {
      return { ok: false, detail: `${id}/fixture.json must contain exactly ${FIXTURE_KEYS.join(", ")}` };
    }
    if (meta.id !== id) return { ok: false, detail: `${id}/fixture.json: id must be ${id}` };
    if (!FIXTURE_KINDS.includes(meta.kind)) {
      return { ok: false, detail: `${id}/fixture.json: kind must be one of ${FIXTURE_KINDS.join(", ")}` };
    }
    if (!isText(meta.summary)) return { ok: false, detail: `${id}/fixture.json: summary must be text` };
    const promptPath = join(root, "prompt.md");
    const prompt = existsSync(promptPath) ? readFileSync(promptPath, "utf8").trim() : "";
    if (!prompt) return { ok: false, detail: `${id}/prompt.md must hold the request` };
    for (const part of ["repo", "hidden", "solution"]) {
      if (!isDirectory(join(root, part))) return { ok: false, detail: `${id}/${part}/ is missing` };
    }
    const visible = testFiles(join(root, "repo", "test"));
    const hidden = testFiles(join(root, "hidden"));
    if (visible.length === 0) return { ok: false, detail: `${id}/repo/test/ holds no *${TEST_FILE_SUFFIX} file` };
    if (hidden.length === 0) return { ok: false, detail: `${id}/hidden/ holds no *${TEST_FILE_SUFFIX} file` };
    const shadowed = hidden.find((name) => visible.includes(name));
    if (shadowed) return { ok: false, detail: `${id}: hidden test ${shadowed} has a visible test's name` };
    fixtures.push({
      id,
      kind: meta.kind,
      prompt,
      root,
      visible: visible.map((name) => `test/${name}`),
      hidden: hidden.map((name) => `test/${name}`),
    });
  }
  return { ok: true, fixtures };
}

function decodeXml(text) {
  const named = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
  return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, code) => {
    if (code[0] !== "#") return named[code.toLowerCase()];
    return String.fromCodePoint(
      code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10),
    );
  });
}

// bun's JUnit report: a test is `<file> > <describe> > <name>`, or `<file> > <name>` at top level.
// A file that fails to import reports no test case, so its tests count as not passed.
export function parseJunit(xml) {
  const results = [];
  for (const match of String(xml ?? "").matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attributes = Object.fromEntries(
      [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decodeXml(value)]),
    );
    const body = match[2] ?? "";
    results.push({
      name: [attributes.file, attributes.classname, attributes.name].filter(Boolean).join(" > "),
      passed: !/<(failure|error|skipped)\b/.test(body),
    });
  }
  return results;
}

function runBunTest({ cwd, files, configPath, junitPath, sandbox = null }) {
  const args = ["test", `--config=${configPath}`, "--reporter=junit", `--reporter-outfile=${junitPath}`, ...files];
  const [command, commandArgs, env] = sandbox
    ? [sandbox.bwrap, [...sandbox.args, "--", sandbox.bun, ...args], sandbox.env]
    : [process.execPath, args, { PATH: process.env.PATH ?? "", HOME: homedir(), TMPDIR: tmpdir(), LANG: "C.UTF-8", NO_COLOR: "1" }];
  spawnSync(command, commandArgs, { cwd, env, encoding: "utf8", timeout: GRADE_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] });
  return parseJunit(existsSync(junitPath) ? readFileSync(junitPath, "utf8") : "");
}

function duplicateName(results) {
  const seen = new Set();
  for (const { name } of results) {
    if (seen.has(name)) return name;
    seen.add(name);
  }
  return null;
}

// The instrument's own check, on copies: the starting tree passes every visible test and fails at
// least one hidden test, and the solution overlay passes both. The names it returns are what
// grading expects, so a hidden file that fails to import in the starting tree still counts.
export function checkFixture(fixture) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "gsd-outcome-check-")));
  try {
    const configPath = join(base, "bunfig.toml");
    writeFileSync(configPath, "");
    const run = (name, withSolution) => {
      const dir = join(base, name);
      cpSync(join(fixture.root, "repo"), dir, { recursive: true });
      if (withSolution) cpSync(join(fixture.root, "solution"), dir, { recursive: true });
      cpSync(join(fixture.root, "hidden"), join(dir, "test"), { recursive: true });
      return runBunTest({
        cwd: dir,
        files: [...fixture.visible, ...fixture.hidden],
        configPath,
        junitPath: join(base, `${name}.xml`),
      });
    };
    const initial = run("initial", false);
    const solved = run("solved", true);
    const inFiles = (results, files) => results.filter(({ name }) => files.some((file) => name.startsWith(`${file} > `)));
    const visible = inFiles(initial, fixture.visible);
    const hidden = inFiles(solved, fixture.hidden);
    const duplicate = duplicateName(initial) ?? duplicateName(solved);
    if (duplicate) return { ok: false, detail: `${fixture.id}: duplicate test name ${duplicate}` };
    if (visible.length === 0) return { ok: false, detail: `${fixture.id}: the starting tree reports no visible test` };
    const failingVisible = visible.filter(({ passed }) => !passed).map(({ name }) => name);
    if (failingVisible.length > 0) {
      return { ok: false, detail: `${fixture.id}: the starting tree fails visible ${failingVisible.join(", ")}` };
    }
    if (hidden.length === 0) return { ok: false, detail: `${fixture.id}: the solution reports no hidden test` };
    const initialPassed = new Set(initial.filter(({ passed }) => passed).map(({ name }) => name));
    if (hidden.every(({ name }) => initialPassed.has(name))) {
      return { ok: false, detail: `${fixture.id}: the starting tree already passes every hidden test` };
    }
    const solvedPassed = new Set(solved.filter(({ passed }) => passed).map(({ name }) => name));
    const unsolved = [...visible, ...hidden].map(({ name }) => name).filter((name) => !solvedPassed.has(name));
    if (unsolved.length > 0) return { ok: false, detail: `${fixture.id}: the solution fails ${unsolved.join(", ")}` };
    return {
      ok: true,
      visible: visible.map(({ name }) => name).sort(compareText),
      hidden: hidden.map(({ name }) => name).sort(compareText),
    };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

export function buildOverlay(model) {
  const quoted = JSON.stringify(model);
  return [
    "modelRoles:",
    ...MODEL_ROLES.map((role) => `  ${role}: ${quoted}`),
    "task:",
    "  isolation:",
    "    enabled: true",
    "    merge: branch",
    "    apply: false",
    "prewalk:",
    "  enabled: false",
    "advisor:",
    "  enabled: false",
    "memories:",
    "  enabled: false",
    "",
  ].join("\n");
}

export function buildOmpArgs({ arm, model, ws, overlayPath, wrapperPath, prompt }) {
  return [
    "-p",
    "--mode",
    "json",
    "--model",
    model,
    "--smol",
    model,
    "--slow",
    model,
    "--plan",
    model,
    "--no-prewalk",
    "--config",
    overlayPath,
    "--cwd",
    ws,
    "--thinking",
    THINKING_LEVEL,
    "--no-extensions",
    ...(arm === "gsd" ? ["-e", wrapperPath] : []),
    "--no-skills",
    "--no-rules",
    "--no-context-files",
    "--no-lsp",
    "--no-session",
    "--no-title",
    "--tools",
    SESSION_TOOLS.join(","),
    "--auto-approve",
    "--wait-async",
    "--max-cost",
    String(SESSION_MAX_COST_USD),
    "--max-time",
    SESSION_MAX_TIME,
    `${prompt}\n\n${AUTONOMY_SUFFIX}`,
  ];
}

function isInside(path, dir) {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

// The base every sandbox shares. Later binds land on top of these, so they come first.
function baseSandboxArgs({ realHome, scratchHome, checkout }) {
  const args = [
    "--ro-bind", "/", "/",
    "--dev", "/dev",
    "--proc", "/proc",
    "--unshare-pid", "--unshare-ipc", "--unshare-uts",
    "--new-session", "--die-with-parent",
  ];
  for (const dir of HIDDEN_DIRS) if (existsSync(dir)) args.push("--tmpfs", dir);
  if (existsSync(DOCKER_SOCKET)) args.push("--ro-bind", "/dev/null", DOCKER_SOCKET);
  args.push("--bind", scratchHome, realHome);
  // A checkout outside the home and temp dirs is not covered by the binds above.
  if (!isInside(checkout, realHome) && !HIDDEN_DIRS.some((dir) => isInside(checkout, dir))) {
    args.push("--tmpfs", checkout);
  }
  return args;
}

// A session sees the system read-only, its own run directory, the bundle read-only, and the omp
// agent directory for auth, minus transcripts, user agents, extensions, and settings.
export function sessionSandboxArgs({ realHome, runDir, agentDir, ompPath, bunDir, bundleDir, checkout, harnessDir }) {
  const args = baseSandboxArgs({ realHome, scratchHome: join(runDir, "home"), checkout });
  if (isDirectory(agentDir)) {
    args.push("--bind", agentDir, agentDir);
    for (const name of HIDDEN_AGENT_DIRS) {
      if (isDirectory(join(agentDir, name))) args.push("--tmpfs", join(agentDir, name));
    }
    const replaced = [
      ["PERSONALITY.md", "/dev/null"],
      ["mcp.json", join(harnessDir, "mcp.json")],
      ["config.yml", join(harnessDir, "empty-config.yml")],
    ];
    for (const [name, source] of replaced) {
      if (existsSync(join(agentDir, name))) args.push("--ro-bind", source, join(agentDir, name));
    }
  }
  const nativesDir = join(realHome, ".omp", "natives");
  if (isDirectory(nativesDir)) args.push("--ro-bind", nativesDir, nativesDir);
  args.push(
    "--ro-bind", ompPath, ompPath,
    "--ro-bind", bunDir, bunDir,
    "--bind", runDir, runDir,
    "--ro-bind", bundleDir, bundleDir,
    "--chdir", join(runDir, "ws"),
  );
  return args;
}

// Grading runs session-written code, so it gets no network and no agent directory.
export function gradeSandboxArgs({ realHome, gradeDir, bunDir, checkout }) {
  return [
    ...baseSandboxArgs({ realHome, scratchHome: join(gradeDir, "home"), checkout }),
    "--unshare-net",
    "--ro-bind", bunDir, bunDir,
    "--bind", gradeDir, gradeDir,
    "--chdir", join(gradeDir, "tree"),
  ];
}

// Both arms get exactly this environment; nothing is inherited from the runner.
export function sandboxEnv({ realHome, bunDir, agentDir = null }) {
  return {
    PATH: [bunDir, ...SYSTEM_PATH].join(delimiter),
    HOME: realHome,
    TMPDIR: "/tmp",
    LANG: "C.UTF-8",
    TERM: "dumb",
    NO_COLOR: "1",
    ...(agentDir ? { PI_CODING_AGENT_DIR: agentDir } : {}),
    ...EVAL_GIT_IDENTITY,
  };
}

export function gitIdentityEnv() {
  return { ...EVAL_GIT_IDENTITY };
}

// Task sub-agents report cumulative counters in `details.progress`, through updates that keep
// arriving after the task call returns; the largest value per call and sub-agent is its final one.
function taskProgress(event) {
  const details = event?.partialResult?.details ?? event?.result?.details ?? event?.message?.details;
  if (!Array.isArray(details?.progress)) return [];
  const callId = event.toolCallId ?? event.message?.toolCallId ?? "";
  return details.progress.filter((entry) => isText(entry?.id)).map((entry) => ({ key: `${callId}\0${entry.id}`, entry }));
}

function amount(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function summarizeOmpEvents(text) {
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0, subagent: 0, total: 0 };
  let cost = 0;
  let turns = 0;
  let toolCalls = 0;
  const subagents = new Map();
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type === "message_end" && event.message?.role === "assistant") {
      const usage = event.message.usage ?? {};
      tokens.input += amount(usage.input);
      tokens.output += amount(usage.output);
      tokens.cache_read += amount(usage.cacheRead);
      tokens.cache_write += amount(usage.cacheWrite);
      cost += amount(usage.cost?.total);
      turns += 1;
    } else if (event?.type === "tool_execution_start") {
      toolCalls += 1;
    }
    for (const { key, entry } of taskProgress(event)) {
      const last = subagents.get(key) ?? { requests: 0, tokens: 0, cost: 0, toolCount: 0 };
      subagents.set(key, {
        requests: Math.max(last.requests, amount(entry.requests)),
        tokens: Math.max(last.tokens, amount(entry.tokens)),
        cost: Math.max(last.cost, amount(entry.cost)),
        toolCount: Math.max(last.toolCount, amount(entry.toolCount)),
      });
    }
  }
  let requests = 0;
  let subagentTools = 0;
  for (const entry of subagents.values()) {
    tokens.subagent += entry.tokens;
    cost += entry.cost;
    requests += entry.requests;
    subagentTools += entry.toolCount;
  }
  tokens.total = tokens.input + tokens.output + tokens.cache_read + tokens.cache_write + tokens.subagent;
  return {
    tokens,
    cost_usd: roundCost(cost),
    turns,
    tool_calls: toolCalls,
    subagents: { count: subagents.size, requests, tool_calls: subagentTools },
  };
}

// A cap is told apart from a failure: omp stops itself at --max-time, the runner kills a session
// that outlives it, and --max-cost exits with its own code.
export function classifyOutcome({ status, killed, wallMs }) {
  if (killed || wallMs >= SESSION_MAX_TIME_MS) return "time-cap";
  if (status === OMP_COST_CAP_EXIT) return "cost-cap";
  return status === 0 ? "ok" : "error";
}

// Grades the tree a session left, on a copy: edited visible tests are named and restored, the
// hidden tests are copied in, and both suites run in a sandbox without network.
export function gradeWorkspace({ fixture, expected, runDir, sandbox }) {
  const gradeDir = join(runDir, "grade");
  const tree = join(gradeDir, "tree");
  mkdirSync(join(gradeDir, "home"), { recursive: true });
  cpSync(join(runDir, "ws"), tree, { recursive: true, filter: (source) => basename(source) !== ".git" });
  const edited = [];
  for (const rel of fixture.visible) {
    const original = readFileSync(join(fixture.root, "repo", rel));
    const target = join(tree, rel);
    let current = null;
    try {
      current = readFileSync(target);
    } catch {
      // a deleted or replaced test file counts as edited
    }
    if (current?.equals(original)) continue;
    edited.push(rel);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, original);
  }
  for (const rel of fixture.hidden) {
    rmSync(join(tree, rel), { recursive: true, force: true });
    cpSync(join(fixture.root, "hidden", basename(rel)), join(tree, rel));
  }
  const configPath = join(gradeDir, "bunfig.toml");
  writeFileSync(configPath, "");
  const results = runBunTest({
    cwd: tree,
    files: [...fixture.visible, ...fixture.hidden],
    configPath,
    junitPath: join(gradeDir, "junit.xml"),
    sandbox,
  });
  const passed = new Set(results.filter((result) => result.passed).map((result) => result.name));
  const failing = expected.hidden.filter((name) => !passed.has(name));
  return {
    hidden: { passed: expected.hidden.length - failing.length, total: expected.hidden.length, failing },
    regressions: expected.visible.filter((name) => !passed.has(name)),
    visible_tests_edited: edited,
  };
}

function listFiles(dir, prefix = "") {
  const files = [];
  const entries = readdirSync(join(dir, prefix), { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    const rel = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(dir, rel));
    else files.push(rel);
  }
  return files;
}

function treeDigest(dir) {
  const hash = createHash("sha256");
  if (!existsSync(dir)) return hash.digest("hex");
  for (const rel of listFiles(dir)) {
    const path = join(dir, rel);
    hash.update(rel.split(sep).join("/"));
    hash.update("\0");
    hash.update(lstatSync(path).isSymbolicLink() ? readlinkSync(path) : readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

// The GSD arm loads the omp adapter from a plugin bundle built from this checkout, the same
// layout an install produces, so the bundle's bytes are part of what a report measured.
export function prepareBundle(root, target) {
  const { pluginRoot } = buildPluginBundle(root, target);
  const adapterPath = join(pluginRoot, "adapters", "omp", "gsd-context.js");
  const coreRoot = resolveGsdRoot(adapterPath);
  const surface = evalSurfaceFingerprint({ bootstrap: createBootstrap(coreRoot), repoRoot: realpathSync(coreRoot) });
  return {
    pluginRoot,
    coreRoot,
    adapterPath,
    bootstrap_sha256: surface.bootstrap_sha256,
    bootstrap_words: surface.bootstrap_words,
    bundle_sha256: treeDigest(pluginRoot),
  };
}

export function outcomeFingerprint(bundle, fixturesDir) {
  const harness = createHash("sha256");
  for (const name of HARNESS_FILES) {
    harness.update(name);
    harness.update("\0");
    harness.update(readFileSync(new URL(`./${name}`, import.meta.url)));
    harness.update("\0");
  }
  return {
    bootstrap_sha256: bundle.bootstrap_sha256,
    bootstrap_words: bundle.bootstrap_words,
    bundle_sha256: bundle.bundle_sha256,
    fixtures_sha256: treeDigest(fixturesDir),
    harness_sha256: harness.digest("hex"),
  };
}

export function liveOutcomeFingerprint(root) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "gsd-outcome-bundle-")));
  try {
    return outcomeFingerprint(prepareBundle(root, join(base, "bundle")), join(root, DEFAULT_FIXTURES_DIR));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

export function fingerprintMismatches(recorded, live) {
  return FINGERPRINT_KEYS.filter((key) => recorded?.[key] !== live[key]);
}

export function cellKey({ model, fixture, repeat, arm }) {
  return JSON.stringify([model, fixture, repeat, arm]);
}

function compareRows(left, right) {
  return (
    compareText(left.model, right.model) ||
    compareText(left.fixture, right.fixture) ||
    left.repeat - right.repeat ||
    OUTCOME_ARMS.indexOf(left.arm) - OUTCOME_ARMS.indexOf(right.arm)
  );
}

function emptyArmSummary() {
  return {
    rows: 0,
    valid: 0,
    outcomes: Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])),
    all_hidden_passed: 0,
    hidden_passed: 0,
    hidden_total: 0,
    regressions: 0,
    visible_tests_edited: 0,
    cost_usd: 0,
    tokens: 0,
    wall_ms: 0,
  };
}

// Per model and arm: how many rows ran and were valid, then counts and sums over valid rows only.
export function summarizeRows(rows) {
  const summary = {};
  for (const row of rows) {
    summary[row.model] ??= Object.fromEntries(OUTCOME_ARMS.map((arm) => [arm, emptyArmSummary()]));
    const cell = summary[row.model][row.arm];
    cell.rows += 1;
    if (!row.valid) continue;
    cell.valid += 1;
    cell.outcomes[row.outcome] += 1;
    if (row.hidden.total > 0 && row.hidden.passed === row.hidden.total) cell.all_hidden_passed += 1;
    cell.hidden_passed += row.hidden.passed;
    cell.hidden_total += row.hidden.total;
    cell.regressions += row.regressions.length;
    cell.visible_tests_edited += row.visible_tests_edited.length;
    cell.cost_usd = roundCost(cell.cost_usd + row.cost_usd);
    cell.tokens += row.tokens.total;
    cell.wall_ms += row.wall_ms;
  }
  return summary;
}

export function buildReport({ fingerprint, ompVersion, rows }) {
  const sorted = [...rows].sort(compareRows);
  const kinds = new Map(sorted.map((row) => [row.fixture, row.kind]));
  return {
    scope: REPORT_SCOPE,
    fingerprint,
    omp_version: ompVersion,
    settings: {
      thinking: THINKING_LEVEL,
      max_cost_usd: SESSION_MAX_COST_USD,
      max_time: SESSION_MAX_TIME,
      tools: [...SESSION_TOOLS],
      pinned_roles: [...MODEL_ROLES],
      sandbox: "bwrap",
    },
    fixtures: [...kinds.keys()].sort(compareText).map((id) => ({ id, kind: kinds.get(id) })),
    summary: summarizeRows(sorted),
    rows: sorted,
  };
}

// A report is published evidence, so no string in it may name a local path.
function findAbsolutePath(value) {
  if (typeof value === "string") return /^(\/|~|[A-Za-z]:[\\/])/.test(value) ? value : null;
  if (Array.isArray(value)) return value.map(findAbsolutePath).find(Boolean) ?? null;
  if (isPlainObject(value)) return Object.values(value).map(findAbsolutePath).find(Boolean) ?? null;
  return null;
}

function rowDefect(row) {
  if (!hasExactKeys(row, ROW_KEYS)) return `must contain exactly ${ROW_KEYS.join(", ")}`;
  if (!isText(row.fixture) || !FIXTURE_KINDS.includes(row.kind)) return "fixture must be an id with a known kind";
  if (!OUTCOME_ARMS.includes(row.arm)) return `arm must be one of ${OUTCOME_ARMS.join(", ")}`;
  if (!Number.isInteger(row.repeat) || row.repeat < 1) return "repeat must be a positive integer";
  if (!isText(row.model)) return "model must be text";
  if (!OUTCOMES.includes(row.outcome)) return `outcome must be one of ${OUTCOMES.join(", ")}`;
  if (row.exit_code !== null && !Number.isInteger(row.exit_code)) return "exit_code must be an integer or null";
  if (typeof row.valid !== "boolean") return "valid must be a boolean";
  if (row.valid ? row.invalid_reason !== null : !isText(row.invalid_reason)) {
    return "an invalid row names its reason and a valid row has none";
  }
  if (row.arm === "vanilla" ? row.bootstrap_injections !== null : !isCount(row.bootstrap_injections)) {
    return "bootstrap_injections is a count in the GSD arm and null in the vanilla arm";
  }
  if (row.arm === "gsd" && row.valid && row.bootstrap_injections < 1) return "a valid GSD row needs injection evidence";
  const { hidden } = row;
  if (!hasExactKeys(hidden, ["passed", "total", "failing"]) || !isCount(hidden.passed) || !isCount(hidden.total)) {
    return "hidden must hold passed, total, and failing";
  }
  if (!Array.isArray(hidden.failing) || !hidden.failing.every(isText) || hidden.passed + hidden.failing.length !== hidden.total) {
    return "hidden.failing must name every hidden test that did not pass";
  }
  if (!isTextList(row.regressions) || !isTextList(row.visible_tests_edited)) {
    return "regressions and visible_tests_edited must be lists of names";
  }
  if (!hasExactKeys(row.tokens, TOKEN_KEYS) || !TOKEN_KEYS.every((key) => isCount(row.tokens[key]))) {
    return `tokens must hold counts for ${TOKEN_KEYS.join(", ")}`;
  }
  const { input, output, cache_read, cache_write, subagent, total } = row.tokens;
  if (input + output + cache_read + cache_write + subagent !== total) return "tokens.total must be the sum of the other counts";
  if (!Number.isFinite(row.cost_usd) || row.cost_usd < 0) return "cost_usd must be a non-negative number";
  if (!isCount(row.turns) || !isCount(row.tool_calls) || !isCount(row.wall_ms)) return "turns, tool_calls, and wall_ms must be counts";
  if (!hasExactKeys(row.subagents, ["count", "requests", "tool_calls"]) || !Object.values(row.subagents).every(isCount)) {
    return "subagents must hold count, requests, and tool_calls";
  }
  return null;
}

export function validateOutcomeReport(report) {
  const fail = (detail) => ({ ok: false, detail });
  if (!hasExactKeys(report, REPORT_KEYS)) return fail(`report must contain exactly ${REPORT_KEYS.join(", ")}`);
  if (report.scope !== REPORT_SCOPE) return fail(`scope must be ${REPORT_SCOPE}`);
  const path = findAbsolutePath(report);
  if (path) return fail(`report holds an absolute path: ${path}`);
  const { fingerprint, settings } = report;
  if (!hasExactKeys(fingerprint, FINGERPRINT_KEYS)) return fail(`fingerprint must contain exactly ${FINGERPRINT_KEYS.join(", ")}`);
  for (const key of FINGERPRINT_KEYS) {
    const valid = key === "bootstrap_words" ? isCount(fingerprint[key]) : /^[0-9a-f]{64}$/.test(String(fingerprint[key]));
    if (!valid) return fail(`fingerprint.${key} is malformed`);
  }
  if (!isText(report.omp_version)) return fail("omp_version must name the omp build");
  if (!hasExactKeys(settings, SETTINGS_KEYS)) return fail(`settings must contain exactly ${SETTINGS_KEYS.join(", ")}`);
  if (
    !isText(settings.thinking) ||
    !(settings.max_cost_usd > 0) ||
    !isText(settings.max_time) ||
    !isTextList(settings.tools) ||
    !isTextList(settings.pinned_roles) ||
    !isText(settings.sandbox)
  ) {
    return fail("settings values are malformed");
  }
  if (!Array.isArray(report.rows) || report.rows.length === 0) return fail("rows must list at least one session");
  const cells = new Set();
  for (const [index, row] of report.rows.entries()) {
    const defect = rowDefect(row);
    if (defect) return fail(`row ${index + 1}: ${defect}`);
    const key = cellKey(row);
    if (cells.has(key)) return fail(`row ${index + 1}: duplicate session ${key}`);
    cells.add(key);
  }
  const rebuilt = buildReport({ fingerprint, ompVersion: report.omp_version, rows: report.rows });
  if (!isDeepStrictEqual(report.rows, rebuilt.rows)) return fail("rows must be sorted by model, fixture, repeat, and arm");
  if (!isDeepStrictEqual(report.fixtures, rebuilt.fixtures)) return fail("fixtures must list each measured fixture once with its kind");
  if (!isDeepStrictEqual(report.summary, rebuilt.summary)) return fail("summary must equal the per-arm counts and sums of the rows");
  return { ok: true };
}
