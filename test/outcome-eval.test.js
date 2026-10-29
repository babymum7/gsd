import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MODEL_ROLES,
  WRAPPER_CONFIG_FILE,
  WRAPPER_FILE,
  buildReport,
  checkFixture,
  classifyOutcome,
  loadFixtures,
  prepareBundle,
  resolveCommand,
  validateOutcomeReport,
} from "./eval/outcome-eval-contract.mjs";

const ROOT = join(import.meta.dir, "..");
const RUNNER = join(ROOT, "test/eval/outcome-eval.mjs");
const WRAPPER = join(ROOT, "test/eval", WRAPPER_FILE);
const HAS_BWRAP = resolveCommand("bwrap", process.env.PATH) !== null;
const SESSION_TEST_TIMEOUT_MS = 120000;

// A fixture small enough to grade in milliseconds: `mean([])` is NaN until the solution lands.
const TINY = {
  "fixture.json": '{ "id": "tiny-sum", "kind": "bug", "summary": "mean of an empty list" }\n',
  "prompt.md": "mean([]) should be 0.\n",
  "repo/src/sum.js":
    "export function sum(values) {\n  return values.reduce((total, value) => total + value, 0);\n}\n\nexport function mean(values) {\n  return sum(values) / values.length;\n}\n",
  "repo/test/sum.test.js":
    'import { expect, test } from "bun:test";\nimport { mean, sum } from "../src/sum.js";\n\ntest("sum adds", () => expect(sum([1, 2, 3])).toBe(6));\ntest("mean averages", () => expect(mean([2, 4])).toBe(3));\n',
  "hidden/sum.hidden.test.js":
    'import { describe, expect, test } from "bun:test";\nimport { mean } from "../src/sum.js";\n\ndescribe("mean", () => {\n  test("returns 0 for an empty list", () => expect(mean([])).toBe(0));\n  test("returns the only value", () => expect(mean([4])).toBe(4));\n});\n',
  "solution/src/sum.js":
    "export function sum(values) {\n  return values.reduce((total, value) => total + value, 0);\n}\n\nexport function mean(values) {\n  return values.length === 0 ? 0 : sum(values) / values.length;\n}\n",
};
const SOLVED = { "src/sum.js": TINY["solution/src/sum.js"] };
// The tampering session fixes `mean` but drops the first value from `sum`, then edits the
// visible test to expect the broken total.
const TAMPERED = {
  "src/sum.js":
    "export function sum(values) {\n  return values.slice(1).reduce((total, value) => total + value, 0);\n}\n\nexport function mean(values) {\n  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;\n}\n",
  "test/sum.test.js": TINY["repo/test/sum.test.js"].replace("toBe(6)", "toBe(5)"),
};
const GSD_USAGE = [
  { type: "session", id: "stub" },
  { type: "message_end", message: { role: "assistant", content: [], usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 0, totalTokens: 125, cost: { total: 0.01 } } } },
  { type: "tool_execution_start", toolName: "bash", toolCallId: "call-1", args: {} },
  { type: "tool_execution_update", toolName: "task", toolCallId: "call-2", partialResult: { details: { progress: [{ id: "Worker", status: "running", requests: 1, tokens: 50, cost: 0.002, toolCount: 1 }] } } },
  { type: "tool_execution_update", toolName: "task", toolCallId: "call-2", partialResult: { details: { progress: [{ id: "Worker", status: "completed", requests: 3, tokens: 300, cost: 0.02, toolCount: 4 }] } } },
  { type: "message_end", message: { role: "assistant", content: [], usage: { input: 200, output: 30, cacheRead: 0, cacheWrite: 10, totalTokens: 240, cost: { total: 0.03 } } } },
  { type: "agent_end" },
];
const VANILLA_USAGE = [
  { type: "message_end", message: { role: "assistant", content: [], usage: { input: 50, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 60, cost: { total: 0.005 } } } },
];

function writeTree(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

// The stub stands in for omp inside the sandbox. In the GSD arm it loads the `-e` wrapper with a
// fake extension host and fires two context events, as omp does before each model request.
function stubSource(mode, extra) {
  return `#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
const MODE = ${JSON.stringify(mode)};
const EXTRA = ${JSON.stringify(extra)};
const argv = process.argv.slice(2);
if (argv[0] === "--version") {
  console.log("stub-omp/0.0.0");
  process.exit(0);
}
const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
const ws = flag("--cwd");
const runDir = dirname(ws);
const wrapper = flag("-e");
writeFileSync(join(runDir, "stub-record.json"), JSON.stringify({ argv, env: process.env }));
if (wrapper && MODE !== "no-evidence") {
  const handlers = {};
  const host = { on: (name, handler) => { handlers[name] = handler; }, logger: { error() {} } };
  (await import(pathToFileURL(wrapper).href)).default(host);
  for (let turn = 0; turn < 2; turn += 1) {
    await handlers.context({ messages: [{ role: "user", content: argv.at(-1) }] }, { sessionManager: { getSessionId: () => "stub-session" } });
  }
}
const write = (files) => {
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(ws, rel), text);
};
if (MODE === "solve" && wrapper) write(EXTRA.solved);
if (MODE === "tamper" && !wrapper) write(EXTRA.tampered);
if (MODE === "probe") {
  const attempt = (path) => {
    try {
      writeFileSync(path, "probe");
      return "written";
    } catch (error) {
      return error.code ?? "error";
    }
  };
  const config = JSON.parse(readFileSync(join(runDir, "wrapper", EXTRA.wrapperConfig), "utf8"));
  writeFileSync(join(runDir, "probe.json"), JSON.stringify({
    workspace: attempt(join(ws, "probe.txt")),
    home: attempt(join(homedir(), EXTRA.marker)),
    bundle: attempt(join(dirname(config.adapter), "probe.txt")),
    checkout: existsSync(join(EXTRA.checkout, "package.json")),
    hidden: existsSync(EXTRA.hidden),
    sessions: readdirSync(join(EXTRA.agentDir, "sessions")).length,
  }));
}
for (const event of wrapper ? EXTRA.gsdEvents : EXTRA.vanillaEvents) process.stdout.write(JSON.stringify(event) + "\\n");
process.exit(MODE === "cost-cap" ? 3 : 0);
`;
}

// Every session test gets its own temp tree: a fixture set, a fake agent directory holding a
// session transcript the sandbox must hide, a stub omp, and a report path. The runner's own
// temp tree lands inside it too, so cleanup removes kept runs.
function sessionWorkspace(mode) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "gsd-outcome-test-")));
  const fixtures = join(base, "fixtures");
  writeTree(join(fixtures, "tiny-sum"), TINY);
  const agentDir = join(base, "agent");
  writeTree(agentDir, { "agent.db": "auth", "sessions/old.jsonl": "{}\n", "mcp.json": '{ "mcpServers": { "x": {} } }\n' });
  const marker = `gsd-outcome-probe-${process.pid}-${Date.now()}`;
  const stub = join(base, "omp");
  const extra = {
    solved: SOLVED,
    tampered: TAMPERED,
    gsdEvents: GSD_USAGE,
    vanillaEvents: VANILLA_USAGE,
    agentDir,
    marker,
    checkout: ROOT,
    hidden: join(fixtures, "tiny-sum", "hidden", "sum.hidden.test.js"),
    wrapperConfig: WRAPPER_CONFIG_FILE,
  };
  writeFileSync(stub, stubSource(mode, extra), { mode: 0o755 });
  return { base, agentDir, stub, marker, fixtures, report: join(base, "report.json") };
}

function runRunner(workspace, args = [], env = {}) {
  return spawnSync(
    process.execPath,
    [RUNNER, "--fixtures", workspace.fixtures, "--report-path", workspace.report, "--keep-runs", ...args],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: SESSION_TEST_TIMEOUT_MS,
      env: {
        ...process.env,
        TMPDIR: workspace.base,
        GSD_EVAL_OMP: workspace.stub,
        GSD_EVAL_MODEL: "fake-model",
        GSD_EVAL_BACKEND: "",
        PI_CODING_AGENT_DIR: workspace.agentDir,
        ...env,
      },
    },
  );
}

function keptRuns(result) {
  const match = /^Runs kept: (.+)$/m.exec(result.stdout);
  assert.ok(match, `the runner names the kept runs:\n${result.stdout}\n${result.stderr}`);
  return match[1];
}

function rowOf(report, arm, repeat = 1) {
  return report.rows.find((row) => row.arm === arm && row.repeat === repeat);
}

test.skipIf(!HAS_BWRAP)(
  "AC-1/AC-2: both arms launch alike except the wrapper, and rows grade the tree and sum usage",
  () => {
    const workspace = sessionWorkspace("solve");
    try {
      const result = runRunner(workspace);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const runs = keptRuns(result);
      const record = (arm) => {
        const runDir = join(runs, `tiny-sum-${arm}-r1-fake-model`);
        const text = readFileSync(join(runDir, "stub-record.json"), "utf8").split(runDir).join("<RUN>");
        return JSON.parse(text);
      };
      const vanilla = record("vanilla");
      const gsd = record("gsd");
      const wrapperAt = gsd.argv.indexOf("-e");
      assert.equal(gsd.argv[wrapperAt + 1], `<RUN>/wrapper/${WRAPPER_FILE}`);
      assert.deepEqual(gsd.argv.toSpliced(wrapperAt, 2), vanilla.argv, "only the wrapper differs between the arms");
      assert.deepEqual(gsd.env, vanilla.env, "both arms see the same environment");
      const pinned = [["--model", "fake-model"], ["--smol", "fake-model"], ["--slow", "fake-model"], ["--plan", "fake-model"], ["--max-cost", "1"], ["--max-time", "20m"], ["--thinking", "high"]];
      for (const [name, value] of pinned) {
        assert.equal(vanilla.argv[vanilla.argv.indexOf(name) + 1], value, `${name} ${value}`);
      }
      for (const name of ["--wait-async", "--no-prewalk", "--no-extensions", "--no-context-files", "--no-session", "--auto-approve"]) {
        assert.ok(vanilla.argv.includes(name), name);
      }
      const overlay = readFileSync(join(runs, "tiny-sum-vanilla-r1-fake-model", "harness", "overlay.yml"), "utf8");
      for (const role of MODEL_ROLES) assert.match(overlay, new RegExp(`^  ${role}: "fake-model"$`, "m"), `role ${role} is pinned`);

      const report = JSON.parse(readFileSync(workspace.report, "utf8"));
      assert.deepEqual(validateOutcomeReport(report), { ok: true });
      const gsdRow = rowOf(report, "gsd");
      assert.deepEqual(
        {
          outcome: gsdRow.outcome,
          valid: gsdRow.valid,
          hidden: gsdRow.hidden,
          regressions: gsdRow.regressions,
          edited: gsdRow.visible_tests_edited,
          injections: gsdRow.bootstrap_injections,
        },
        { outcome: "ok", valid: true, hidden: { passed: 2, total: 2, failing: [] }, regressions: [], edited: [], injections: 2 },
      );
      assert.deepEqual(gsdRow.tokens, { input: 300, output: 50, cache_read: 5, cache_write: 10, subagent: 300, total: 665 });
      assert.equal(gsdRow.cost_usd, 0.06);
      assert.deepEqual([gsdRow.turns, gsdRow.tool_calls], [2, 1]);
      assert.deepEqual(gsdRow.subagents, { count: 1, requests: 3, tool_calls: 4 });
      const vanillaRow = rowOf(report, "vanilla");
      assert.deepEqual(vanillaRow.hidden, {
        passed: 1,
        total: 2,
        failing: ["test/sum.hidden.test.js > mean > returns 0 for an empty list"],
      });
      assert.equal(vanillaRow.bootstrap_injections, null);
      assert.deepEqual([vanillaRow.cost_usd, vanillaRow.tokens.total, vanillaRow.turns], [0.005, 60, 1]);
      assert.equal(report.summary["fake-model"].gsd.all_hidden_passed, 1);
      assert.equal(report.summary["fake-model"].vanilla.all_hidden_passed, 0);
    } finally {
      rmSync(workspace.base, { recursive: true, force: true });
    }
  },
  SESSION_TEST_TIMEOUT_MS,
);

test.skipIf(!HAS_BWRAP)(
  "AC-3: an edited visible test is named and the regression counts against the original",
  () => {
    const workspace = sessionWorkspace("tamper");
    try {
      const result = runRunner(workspace);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const row = rowOf(JSON.parse(readFileSync(workspace.report, "utf8")), "vanilla");
      assert.deepEqual(row.visible_tests_edited, ["test/sum.test.js"]);
      assert.deepEqual(row.regressions, ["test/sum.test.js > sum adds"]);
      assert.deepEqual(row.hidden, { passed: 2, total: 2, failing: [] });
    } finally {
      rmSync(workspace.base, { recursive: true, force: true });
    }
  },
  SESSION_TEST_TIMEOUT_MS,
);

test.skipIf(!HAS_BWRAP)(
  "AC-4: a GSD row without injection evidence is invalid and left out of the sums",
  () => {
    const workspace = sessionWorkspace("no-evidence");
    try {
      const result = runRunner(workspace);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const report = JSON.parse(readFileSync(workspace.report, "utf8"));
      const row = rowOf(report, "gsd");
      assert.equal(row.valid, false);
      assert.match(row.invalid_reason, /no bootstrap injection/);
      assert.equal(row.bootstrap_injections, 0);
      const gsd = report.summary["fake-model"].gsd;
      assert.deepEqual([gsd.rows, gsd.valid, gsd.hidden_total, gsd.cost_usd], [1, 0, 0, 0]);
      assert.deepEqual(validateOutcomeReport(report), { ok: true });
    } finally {
      rmSync(workspace.base, { recursive: true, force: true });
    }
  },
  SESSION_TEST_TIMEOUT_MS,
);

test("AC-5: the wrapper returns the adapter's messages and records only a rendered bootstrap", async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "gsd-outcome-wrapper-")));
  try {
    const working = prepareBundle(ROOT, join(base, "working"));
    const broken = prepareBundle(ROOT, join(base, "broken"));
    rmSync(join(broken.coreRoot, "skills"), { recursive: true, force: true });
    mkdirSync(join(broken.coreRoot, "skills"));
    const fire = async (bundle, name) => {
      const dir = join(base, name);
      mkdirSync(dir);
      cpSync(WRAPPER, join(dir, WRAPPER_FILE));
      const evidence = join(dir, "evidence.jsonl");
      writeFileSync(join(dir, WRAPPER_CONFIG_FILE), JSON.stringify({ adapter: bundle.adapterPath, evidence }));
      const handlers = {};
      (await import(pathToFileURL(join(dir, WRAPPER_FILE)).href)).default({
        on: (event, handler) => {
          handlers[event] = handler;
        },
        logger: { error() {} },
      });
      const result = await handlers.context(
        { messages: [{ role: "user", content: "hello" }] },
        { sessionManager: { getSessionId: () => "wrapper-test" } },
      );
      return { result, recorded: existsSync(evidence) ? readFileSync(evidence, "utf8").trim().split("\n").length : 0 };
    };
    const ok = await fire(working, "working-wrapper");
    assert.equal(ok.recorded, 1);
    assert.match(ok.result.messages[0].content, /^<GSD_BOOTSTRAP>\ngsd:session-bootstrap:v2\n/);
    assert.deepEqual(ok.result.messages[1], { role: "user", content: "hello" });
    const failed = await fire(broken, "broken-wrapper");
    assert.equal(failed.recorded, 0, "a bootstrap-error payload is not injection evidence");
    assert.match(failed.result.messages[0].content, /^\[GSD bootstrap unavailable\]/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test.skipIf(!HAS_BWRAP)(
  "AC-6: a session writes only its workspace and scratch home and sees no checkout or hidden test",
  () => {
    const workspace = sessionWorkspace("probe");
    try {
      const result = runRunner(workspace, ["--only", "tiny-sum"]);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const runDir = join(keptRuns(result), "tiny-sum-vanilla-r1-fake-model");
      assert.deepEqual(JSON.parse(readFileSync(join(runDir, "probe.json"), "utf8")), {
        workspace: "written",
        home: "written",
        bundle: "EROFS",
        checkout: false,
        hidden: false,
        sessions: 0,
      });
      assert.ok(existsSync(join(runDir, "home", workspace.marker)), "the home write lands in the run's scratch home");
      assert.ok(!existsSync(join(homedir(), workspace.marker)), "the real home is untouched");
    } finally {
      rmSync(join(homedir(), workspace.marker), { force: true });
      rmSync(workspace.base, { recursive: true, force: true });
    }
  },
  SESSION_TEST_TIMEOUT_MS,
);

test("AC-7: the runner refuses without bwrap, with the HTTP backend, or without a model", () => {
  const workspace = sessionWorkspace("solve");
  try {
    const noBwrap = runRunner(workspace, [], { PATH: "" });
    assert.equal(noBwrap.status, 2);
    assert.match(noBwrap.stderr, /bwrap/);
    assert.match(noBwrap.stderr, /apt install bubblewrap/);
    const http = runRunner(workspace, [], { GSD_EVAL_BACKEND: "http" });
    assert.equal(http.status, 2);
    assert.match(http.stderr, /GSD_EVAL_BACKEND=omp/);
    const noModel = runRunner(workspace, [], { GSD_EVAL_MODEL: "" });
    assert.equal(noModel.status, 2);
    assert.match(noModel.stderr, /GSD_EVAL_MODEL=/);
    assert.ok(!existsSync(workspace.report), "no session ran");
  } finally {
    rmSync(workspace.base, { recursive: true, force: true });
  }
});

test.skipIf(!HAS_BWRAP)(
  "AC-8: --repeats resumes a matching report and refuses one measured on other bytes",
  () => {
    const workspace = sessionWorkspace("solve");
    try {
      const first = runRunner(workspace, ["--repeats", "1"]);
      assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
      const second = runRunner(workspace, ["--repeats", "3"]);
      assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
      const launched = [...second.stdout.matchAll(/^tiny-sum (vanilla|gsd) r(\d+) fake-model:/gm)].map(([, arm, repeat]) => `${arm}${repeat}`);
      assert.deepEqual(launched.sort(), ["gsd2", "gsd3", "vanilla2", "vanilla3"]);
      const report = JSON.parse(readFileSync(workspace.report, "utf8"));
      assert.equal(report.rows.length, 6);
      assert.deepEqual(validateOutcomeReport(report), { ok: true });

      report.fingerprint.harness_sha256 = "0".repeat(64);
      writeFileSync(workspace.report, JSON.stringify(report));
      const stale = runRunner(workspace, ["--repeats", "3"]);
      assert.equal(stale.status, 2);
      assert.match(stale.stderr, /harness_sha256/);
      assert.match(stale.stderr, /--report-path/);
    } finally {
      rmSync(workspace.base, { recursive: true, force: true });
    }
  },
  SESSION_TEST_TIMEOUT_MS * 2,
);

test("AC-9: the report validator rejects a missing row field and an absolute path", () => {
  const row = {
    fixture: "tiny-sum",
    kind: "bug",
    arm: "vanilla",
    repeat: 1,
    model: "fake-model",
    outcome: "ok",
    exit_code: 0,
    valid: true,
    invalid_reason: null,
    bootstrap_injections: null,
    hidden: { passed: 1, total: 2, failing: ["test/sum.hidden.test.js > mean > returns 0 for an empty list"] },
    regressions: [],
    visible_tests_edited: [],
    tokens: { input: 1, output: 1, cache_read: 0, cache_write: 0, subagent: 0, total: 2 },
    cost_usd: 0.001,
    turns: 1,
    tool_calls: 0,
    subagents: { count: 0, requests: 0, tool_calls: 0 },
    wall_ms: 10,
  };
  const fingerprint = {
    bootstrap_sha256: "a".repeat(64),
    bootstrap_words: 10,
    bundle_sha256: "b".repeat(64),
    fixtures_sha256: "c".repeat(64),
    harness_sha256: "d".repeat(64),
  };
  const report = buildReport({ fingerprint, ompVersion: "omp/0.0.0", rows: [row] });
  assert.deepEqual(validateOutcomeReport(report), { ok: true });

  const { wall_ms: _dropped, ...missing } = row;
  const withoutField = validateOutcomeReport({ ...report, rows: [missing] });
  assert.equal(withoutField.ok, false);
  assert.match(withoutField.detail, /row 1/);

  const absolute = structuredClone(report);
  absolute.rows[0].hidden.failing = ["/home/someone/test/sum.hidden.test.js > mean"];
  const withPath = validateOutcomeReport(absolute);
  assert.equal(withPath.ok, false);
  assert.match(withPath.detail, /absolute path/);
});

test("session outcomes keep caps apart from failures", () => {
  assert.equal(classifyOutcome({ status: 0, killed: false, wallMs: 1000 }), "ok");
  assert.equal(classifyOutcome({ status: 3, killed: false, wallMs: 1000 }), "cost-cap");
  assert.equal(classifyOutcome({ status: 0, killed: false, wallMs: 20 * 60 * 1000 }), "time-cap");
  assert.equal(classifyOutcome({ status: null, killed: true, wallMs: 1000 }), "time-cap");
  assert.equal(classifyOutcome({ status: 1, killed: false, wallMs: 1000 }), "error");
});

const FIXTURES = loadFixtures(join(ROOT, "test/eval/outcome-fixtures"));
test("the outcome fixture set loads", () => {
  assert.equal(FIXTURES.ok, true, FIXTURES.detail);
});
for (const fixture of FIXTURES.fixtures ?? []) {
  test(`fixture ${fixture.id}: the initial tree passes visible and fails hidden tests; the solution passes both`, () => {
    const result = checkFixture(fixture);
    assert.equal(result.ok, true, result.detail);
  });
}

test("the synthetic fixture passes the same checker, which works on copies", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "gsd-outcome-tiny-")));
  try {
    writeTree(join(base, "tiny-sum"), TINY);
    const loaded = loadFixtures(base);
    assert.equal(loaded.ok, true, loaded.detail);
    const result = checkFixture(loaded.fixtures[0]);
    assert.equal(result.ok, true, result.detail);
    assert.deepEqual(result.visible, ["test/sum.test.js > mean averages", "test/sum.test.js > sum adds"]);
    assert.deepEqual(result.hidden, [
      "test/sum.hidden.test.js > mean > returns 0 for an empty list",
      "test/sum.hidden.test.js > mean > returns the only value",
    ]);
    assert.deepEqual(readdirSync(join(base, "tiny-sum", "repo", "test")), ["sum.test.js"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
