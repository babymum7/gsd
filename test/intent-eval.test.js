import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkFixture } from "./eval/outcome-eval-contract.mjs";
import {
  CORRECTION_PREFIX,
  DEFAULT_INTENT_FIXTURES_DIR,
  LANDING_NOTE,
  MAX_AGENT_TURNS,
  RECOMMENDATION_REPLY,
  buildIntentReport,
  buildRow,
  buildTurn,
  cellKey,
  keepMatchingRows,
  validateIntentReport,
  endsWithQuestion,
  firstPrompt,
  loadIntentFixtures,
  nextUserMessage,
  parseAgents,
  parseTurn,
} from "./eval/intent-eval-contract.mjs";

const ROOT = join(import.meta.dir, "..");
const FIXTURE_TEST_TIMEOUT_MS = 60000;

test(
  "every intent fixture proves itself: vague or clear, a clarification, and hidden tests only the solution passes",
  () => {
    const loaded = loadIntentFixtures(join(ROOT, DEFAULT_INTENT_FIXTURES_DIR));
    assert.equal(loaded.ok, true, loaded.detail);
    const kinds = loaded.fixtures.map((fixture) => fixture.kind).sort();
    assert.deepEqual(kinds, ["clear", "clear", "vague", "vague", "vague", "vague"]);
    for (const fixture of loaded.fixtures) {
      assert.ok(fixture.clarification.length > 0, `${fixture.id} has no clarification`);
      const checked = checkFixture(fixture);
      assert.equal(checked.ok, true, checked.detail);
    }
  },
  FIXTURE_TEST_TIMEOUT_MS,
);

const MARKER_LINE = "gsd:session-bootstrap:v2";
const vague = { id: "discount-codes", kind: "vague", clarification: "Codes are SAVE10 and FLAT5." };
const decide = (overrides) =>
  nextUserMessage({
    fixture: vague,
    turn: 1,
    passed: false,
    text: "Done.",
    changed: true,
    disclosed: false,
    recommended: false,
    ...overrides,
  });

test("the simulated user stops on a pass and on the turn budget", () => {
  assert.deepEqual(decide({ passed: true, text: "Which code?" }), { action: "stop" });
  assert.deepEqual(decide({ turn: MAX_AGENT_TURNS, text: "Which code?", disclosed: true }), { action: "stop" });
});

test("the first failing turn gets the clarification, as an answer or as a correction", () => {
  assert.deepEqual(decide({ text: "Should codes be percentages or amounts?" }), {
    action: "reply",
    event: "asked",
    message: vague.clarification,
  });
  assert.deepEqual(decide({ text: "Done: added a percent discount." }), {
    action: "reply",
    event: "corrected",
    message: `${CORRECTION_PREFIX} ${vague.clarification}`,
  });
  // A reply that leaves the tree untouched waits for the user, even phrased without a `?`.
  assert.deepEqual(decide({ text: 'Reply "go with defaults" or name the changes you want.', changed: false }), {
    action: "reply",
    event: "asked",
    message: vague.clarification,
  });
});

test("after the clarification a question gets one recommendation reply and anything else stops", () => {
  assert.deepEqual(decide({ turn: 2, text: "Merge it now?", disclosed: true }), {
    action: "reply",
    event: "recommended",
    message: RECOMMENDATION_REPLY,
  });
  assert.deepEqual(decide({ turn: 2, text: "Merge it now?", disclosed: true, recommended: true }), { action: "stop" });
  assert.deepEqual(decide({ turn: 2, text: "Finished.", disclosed: true }), { action: "stop" });
});

test("a question mark inside code is not a question", () => {
  assert.equal(endsWithQuestion("Use `user?.name` there. Done."), false);
  assert.equal(endsWithQuestion("Done.\n\n```js\nconst x = a ? b : c;\n```"), false);
  assert.equal(endsWithQuestion("Should the discount apply before tax?"), true);
  assert.equal(endsWithQuestion(""), false);
});

test("the first prompt carries the landing note in both arms", () => {
  assert.equal(firstPrompt({ prompt: "Add pagination to listUsers." }), `Add pagination to listUsers.\n\n${LANDING_NOTE}`);
});

test("agents are named explicitly as backend:model", () => {
  assert.deepEqual(parseAgents("claude:claude-haiku-5-5, dsh:default,codex:gpt-6-luna"), {
    ok: true,
    agents: [
      { backend: "claude", model: "claude-haiku-5-5" },
      { backend: "dsh", model: "default" },
      { backend: "codex", model: "gpt-6-luna" },
    ],
  });
  assert.equal(parseAgents("").ok, false);
  assert.match(parseAgents("omp:gemini").detail, /omp/);
  assert.match(parseAgents("dsh:deepseek").detail, /dsh:default/);
  assert.match(parseAgents("claude").detail, /backend:model/);
});

const at = (args, flag) => args[args.indexOf(flag) + 1];

test("claude turns start a session, resume it, and load the bundle only in the GSD arm", () => {
  const bundle = { pluginRoot: "/bundle/gsd" };
  const turn = (overrides) =>
    buildTurn({ backend: "claude", model: "claude-haiku-5-5", arm: "gsd", message: "hi", sessionId: "s-1", turn: 1, bundle, budgetUsd: 0.75, ...overrides });
  const first = turn({});
  assert.equal(first.command, "claude");
  assert.equal(at(first.args, "-p"), "hi");
  assert.equal(at(first.args, "--session-id"), "s-1");
  assert.equal(at(first.args, "--plugin-dir"), "/bundle/gsd");
  assert.equal(at(first.args, "--max-budget-usd"), "0.75");
  assert.equal(at(first.args, "--disallowedTools"), "AskUserQuestion");
  assert.deepEqual(JSON.parse(at(first.args, "--settings")), { enabledPlugins: { "gsd@gsd-local": false } });
  const next = turn({ arm: "vanilla", message: "more", turn: 2 });
  assert.equal(at(next.args, "--resume"), "s-1");
  assert.equal(next.args.includes("--session-id"), false);
  assert.equal(next.args.includes("--plugin-dir"), false);
  assert.deepEqual(JSON.parse(at(next.args, "--settings")), { enabledPlugins: { "gsd@gsd-local": false } });
});

test("codex turns toggle the installed plugin per arm and resume by thread id", () => {
  const turn = (overrides) =>
    buildTurn({ backend: "codex", model: "gpt-6-luna", arm: "vanilla", message: "hi", sessionId: null, turn: 1, bundle: null, budgetUsd: 1, ...overrides });
  const first = turn({});
  assert.equal(first.command, "codex");
  assert.equal(first.args[0], "exec");
  assert.ok(first.args.includes("--json"));
  // Codex runs a disabled plugin's hooks too when hook trust is bypassed, so only the GSD arm bypasses it.
  assert.ok(!first.args.includes("--dangerously-bypass-hook-trust"));
  assert.ok(first.args.includes('plugins."gsd@gsd-local".enabled=false'));
  assert.ok(first.args.includes('model="gpt-6-luna"'));
  assert.equal(first.args.at(-1), "hi");
  const next = turn({ arm: "gsd", message: "more", sessionId: "t-9", turn: 2 });
  assert.deepEqual(next.args.slice(0, 3), ["exec", "resume", "t-9"]);
  assert.ok(next.args.includes('plugins."gsd@gsd-local".enabled=true'));
  assert.ok(next.args.includes("--dangerously-bypass-hook-trust"));
  assert.equal(next.args.at(-1), "more");
});

test("dsh turns run the headless profile and resume by session id", () => {
  const turn = (overrides) =>
    buildTurn({ backend: "dsh", model: "default", arm: "gsd", message: "hi", sessionId: null, turn: 1, bundle: null, budgetUsd: 1, ...overrides });
  assert.deepEqual(turn({}), { command: "dsh", args: ["--profile", "headless", "--json", "hi"] });
  assert.deepEqual(turn({ message: "more", sessionId: "session-7", turn: 2 }).args, [
    "--profile",
    "headless",
    "--json",
    "--session-id",
    "session-7",
    "more",
  ]);
});

test("claude stream-json parses into text, session, tokens, cost, and bootstrap evidence", () => {
  const stdout = [
    JSON.stringify({ type: "system", subtype: "hook_response", hook_event: "SessionStart", output: `<GSD_BOOTSTRAP>\n${MARKER_LINE}\n` }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Which code?" }] } }),
    JSON.stringify({
      type: "result",
      subtype: "success",
      session_id: "s-1",
      result: "Which code?",
      total_cost_usd: 0.25,
      modelUsage: { "claude-haiku-5-5": { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 100, cacheCreationInputTokens: 1000 } },
    }),
  ].join("\n");
  assert.deepEqual(parseTurn("claude", stdout), {
    text: "Which code?",
    sessionId: "s-1",
    tokens: 1115,
    costUsd: 0.25,
    bootstrapSeen: true,
    replied: true,
  });
  assert.deepEqual(parseTurn("claude", "not json\n"), {
    text: "",
    sessionId: null,
    tokens: 0,
    costUsd: 0,
    bootstrapSeen: false,
    replied: false,
  });
  // A CLI that cannot reach the model answers with a synthetic message, such as a login refusal.
  const loggedOut = [
    JSON.stringify({ type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text: "Not logged in · Please run /login" }] } }),
    JSON.stringify({ type: "result", subtype: "success", session_id: "s-2", result: "Not logged in · Please run /login" }),
  ].join("\n");
  assert.equal(parseTurn("claude", loggedOut).replied, false);
});

test("codex and dsh JSON events parse into text, session, and tokens without a cost", () => {
  const codex = [
    '{"type":"thread.started","thread_id":"t-9"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"thinking"}}',
    '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"OK"}}',
    '{"type":"turn.completed","usage":{"input_tokens":15447,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}',
  ].join("\n");
  assert.deepEqual(parseTurn("codex", codex), { text: "OK", sessionId: "t-9", tokens: 15452, costUsd: null, bootstrapSeen: null, replied: true });
  const dsh = [
    '{"type":"session","sessionId":"session-7","cwd":"/w"}',
    '{"type":"status","phase":"step_end","turn":1,"step":1,"usage":{"inputTokens":7799,"outputTokens":2,"totalTokens":7801}}',
    '{"type":"status","phase":"step_end","turn":1,"step":2,"usage":{"inputTokens":100,"outputTokens":3,"totalTokens":103}}',
    '{"type":"final","text":"OK"}',
  ].join("\n");
  assert.deepEqual(parseTurn("dsh", dsh), { text: "OK", sessionId: "session-7", tokens: 7904, costUsd: null, bootstrapSeen: null, replied: true });
});

const turnRecord = (overrides = {}) => ({
  text: "Done.",
  sessionId: "s-1",
  tokens: 100,
  costUsd: 0.1,
  bootstrapSeen: true,
  replied: true,
  changed: true,
  question: false,
  event: null,
  passed: true,
  ...overrides,
});
const GRADE = { hidden: { passed: 6, total: 6, failing: [] }, regressions: [], visible_tests_edited: [] };
const rowInput = (overrides = {}) => ({
  fixture: { id: "discount-codes", kind: "vague" },
  agent: { backend: "claude", model: "claude-haiku-5-5" },
  arm: "gsd",
  turns: [turnRecord()],
  grade: GRADE,
  wallMs: 1000,
  fingerprint: { fixture_sha256: "a", harness_sha256: "b", cli_version: "c", bundle_sha256: "d" },
  ...overrides,
});

test("a row sums its turns and keeps what the simulated user did", () => {
  const row = buildRow(
    rowInput({
      turns: [
        turnRecord({ changed: false, question: true, passed: false, event: "asked", tokens: 40, costUsd: 0.05 }),
        turnRecord({ tokens: 60, costUsd: 0.1 }),
      ],
    }),
  );
  assert.equal(row.valid, true);
  assert.equal(row.passed, true);
  assert.equal(row.agent_turns, 2);
  assert.equal(row.asked, true);
  assert.equal(row.corrected, false);
  assert.deepEqual(row.turn1, { changed: false, question: true });
  assert.equal(row.tokens, 100);
  assert.equal(row.cost_usd, 0.15);
  const uncosted = buildRow(rowInput({ agent: { backend: "dsh", model: "default" }, turns: [turnRecord({ costUsd: null })] }));
  assert.equal(uncosted.cost_usd, null);
});

test("a session that ran the wrong arm or never replied is invalid", () => {
  assert.match(buildRow(rowInput({ turns: [turnRecord({ bootstrapSeen: false })] })).invalid_reason, /GSD arm/);
  assert.match(buildRow(rowInput({ arm: "vanilla", turns: [turnRecord({ bootstrapSeen: true })] })).invalid_reason, /vanilla arm/);
  assert.match(buildRow(rowInput({ turns: [turnRecord({ bootstrapSeen: null })] })).invalid_reason, /evidence/);
  assert.match(buildRow(rowInput({ turns: [turnRecord({ replied: false })] })).invalid_reason, /no reply/);
  assert.equal(buildRow(rowInput({ arm: "vanilla", turns: [turnRecord({ bootstrapSeen: false })] })).valid, true);
});

const failedGrade = { hidden: { passed: 2, total: 6, failing: ["x"] }, regressions: [], visible_tests_edited: [] };

test("the report sums valid rows per agent and arm, and counts asking by fixture kind", () => {
  const rows = [
    buildRow(rowInput({ turns: [turnRecord({ passed: false, question: true, event: "asked", costUsd: 0.2 }), turnRecord({ costUsd: 0.1 })] })),
    buildRow(rowInput({ fixture: { id: "csv-quote", kind: "clear" }, turns: [turnRecord({ question: true, passed: false, event: "asked" }), turnRecord()] })),
    buildRow(rowInput({ arm: "vanilla", turns: [turnRecord({ bootstrapSeen: false, passed: false, event: "corrected" }), turnRecord({ bootstrapSeen: false })] })),
    buildRow(rowInput({ arm: "vanilla", fixture: { id: "slug-vietnamese", kind: "vague" }, grade: failedGrade, turns: [turnRecord({ bootstrapSeen: false })] })),
    buildRow(rowInput({ fixture: { id: "paginate-users", kind: "vague" }, turns: [turnRecord({ bootstrapSeen: false })] })),
  ];
  const report = buildIntentReport({ rows });
  assert.equal(validateIntentReport(report).ok, true, validateIntentReport(report).detail);
  const gsd = report.summary["claude:claude-haiku-5-5"].gsd;
  assert.deepEqual(
    { rows: gsd.rows, valid: gsd.valid, passed: gsd.passed, first_try: gsd.first_try, asked_vague: gsd.asked_vague, vague: gsd.vague },
    { rows: 3, valid: 2, passed: 2, first_try: 2, asked_vague: 1, vague: 1 },
  );
  assert.deepEqual({ over_asked: gsd.over_asked, clear: gsd.clear, corrected: gsd.corrected, agent_turns: gsd.agent_turns }, { over_asked: 1, clear: 1, corrected: 0, agent_turns: 4 });
  assert.equal(gsd.cost_usd, 0.5);
  const vanilla = report.summary["claude:claude-haiku-5-5"].vanilla;
  assert.deepEqual({ valid: vanilla.valid, passed: vanilla.passed, first_try: vanilla.first_try, corrected: vanilla.corrected }, { valid: 2, passed: 1, first_try: 0, corrected: 1 });
});

test("a tampered report or a malformed row fails validation", () => {
  const report = buildIntentReport({ rows: [buildRow(rowInput())] });
  const tampered = structuredClone(report);
  tampered.summary["claude:claude-haiku-5-5"].gsd.passed = 9;
  assert.match(validateIntentReport(tampered).detail, /summary/);
  const broken = structuredClone(report);
  delete broken.rows[0].arm;
  assert.match(validateIntentReport(broken).detail, /row 0/);
});

test("rows measured on other bytes are dropped before a rerun", () => {
  const kept = buildRow(rowInput());
  const stale = buildRow(rowInput({ fixture: { id: "csv-quote", kind: "clear" }, fingerprint: { ...rowInput().fingerprint, fixture_sha256: "old" } }));
  const live = (row) => ({ ...rowInput().fingerprint, fixture_sha256: row.fixture === "csv-quote" ? "new" : "a" });
  assert.deepEqual(keepMatchingRows([kept, stale], live), { kept: [kept], dropped: 1 });
  assert.equal(cellKey(kept), "claude:claude-haiku-5-5|discount-codes|gsd");
});

const RUNNER = join(ROOT, "test/eval/intent-eval.mjs");
const runRunner = (env) =>
  spawnSync(process.execPath, [RUNNER], { cwd: ROOT, encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: tmpdir(), ...env } });

test("the runner names its agents explicitly before spending a session", () => {
  const unset = runRunner({});
  assert.equal(unset.status, 2);
  assert.match(unset.stderr, /GSD_EVAL_AGENTS/);
  assert.match(unset.stderr, /claude:claude-haiku-5-5/);
  const unknown = runRunner({ GSD_EVAL_AGENTS: "omp:gemini" });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /omp is not a backend/);
});

test("a backend whose CLI is not on PATH is named and skipped", () => {
  const skipped = runRunner({ GSD_EVAL_AGENTS: "claude:claude-haiku-5-5" });
  assert.match(skipped.stdout, /skip: claude is not on PATH/);
  assert.equal(skipped.status, 0);
});
