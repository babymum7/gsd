// The intent benchmark's pure contract (decision 0049): fixtures, the simulated user's turn
// protocol, backend turn builders and parsers, rows, and the report. The runner beside it owns
// every process, file write, and print.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const INTENT_KINDS = ["vague", "clear"];
export const DEFAULT_INTENT_FIXTURES_DIR = "test/eval/intent-fixtures";
const FIXTURE_KEYS = ["id", "kind", "summary"];
const TEST_FILE_SUFFIX = ".test.js";

function isText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function testFiles(dir) {
  return isDirectory(dir) ? readdirSync(dir).filter((name) => name.endsWith(TEST_FILE_SUFFIX)).sort(compareText) : [];
}

function readTrimmed(path) {
  return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
}

// A fixture is `<id>/` with fixture.json, prompt.md (the request), clarification.md (what the
// simulated user reveals), the starting repo, hidden tests written as if they sat in repo/test/,
// and a solution overlay. The shape matches the outcome benchmark's, so its `checkFixture` and
// `gradeWorkspace` apply unchanged.
export function loadIntentFixtures(dir) {
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
    if (!INTENT_KINDS.includes(meta.kind)) {
      return { ok: false, detail: `${id}/fixture.json: kind must be one of ${INTENT_KINDS.join(", ")}` };
    }
    if (!isText(meta.summary)) return { ok: false, detail: `${id}/fixture.json: summary must be text` };
    const prompt = readTrimmed(join(root, "prompt.md"));
    if (!prompt) return { ok: false, detail: `${id}/prompt.md must hold the request` };
    const clarification = readTrimmed(join(root, "clarification.md"));
    if (!clarification) return { ok: false, detail: `${id}/clarification.md must hold what the user reveals when asked` };
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
      clarification,
      root,
      visible: visible.map((name) => `test/${name}`),
      hidden: hidden.map((name) => `test/${name}`),
    });
  }
  return { ok: true, fixtures };
}

// ---------------------------------------------------------------------------------------------
// The simulated user (decision 0049, D-1). It never improvises: after each agent turn the tree
// is graded, and the reply is the fixture's clarification, one fixed recommendation reply, or
// nothing.

export const MAX_AGENT_TURNS = 3;
export const RECOMMENDATION_REPLY = "Go with your recommendation and finish the change.";
export const CORRECTION_PREFIX = "That is not what I meant.";
// Both arms get it, so GSD never spends its one question on how the work lands.
export const LANDING_NOTE =
  "Leave the finished change in this repository's checked-out working tree; no push or pull request is needed.";

export function firstPrompt(fixture) {
  return `${fixture.prompt}\n\n${LANDING_NOTE}`;
}

// A question is a `?` in prose: fenced blocks and inline code are dropped first, since
// `user?.name` or a ternary asks nothing.
export function endsWithQuestion(text) {
  const prose = String(text ?? "")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ");
  return prose.includes("?");
}

// A turn asks when its prose holds a question or it replied without touching the tree: an
// agent that stops to wait for an answer may phrase it as "reply go" with no `?`.
export function turnAsks({ text, changed }) {
  return endsWithQuestion(text) || !changed;
}

export function nextUserMessage({ fixture, turn, passed, text, changed, disclosed, recommended }) {
  if (passed || turn >= MAX_AGENT_TURNS) return { action: "stop" };
  const asks = turnAsks({ text, changed });
  if (!disclosed) {
    return asks
      ? { action: "reply", event: "asked", message: fixture.clarification }
      : { action: "reply", event: "corrected", message: `${CORRECTION_PREFIX} ${fixture.clarification}` };
  }
  if (asks && !recommended) return { action: "reply", event: "recommended", message: RECOMMENDATION_REPLY };
  return { action: "stop" };
}

// ---------------------------------------------------------------------------------------------
// Backends (D-2, D-3). Each builds one turn's command line and parses that turn's stdout.

export const BACKENDS = ["claude", "codex", "dsh"];
export const INTENT_ARMS = ["vanilla", "gsd"];
// The installed plugin both arms switch off, so only the checkout bundle (or nothing) is loaded.
export const INSTALLED_PLUGIN = "gsd@gsd-local";
const BOOTSTRAP_MARKER = "gsd:session-bootstrap:v2";
// dsh picks its model from the headless profile; the harness cannot choose another one.
const DSH_MODEL = "default";

export function containsBootstrapMarker(text) {
  return String(text ?? "").includes(BOOTSTRAP_MARKER);
}

export function parseAgents(value) {
  const names = String(value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) return { ok: false, detail: "no agents named" };
  const agents = [];
  for (const name of names) {
    const split = name.indexOf(":");
    if (split <= 0 || split === name.length - 1) return { ok: false, detail: `${name} is not backend:model` };
    const backend = name.slice(0, split);
    const model = name.slice(split + 1);
    if (!BACKENDS.includes(backend)) return { ok: false, detail: `${backend} is not a backend; use one of ${BACKENDS.join(", ")}` };
    if (backend === "dsh" && model !== DSH_MODEL) {
      return { ok: false, detail: `dsh runs its headless profile's model; name it dsh:${DSH_MODEL}` };
    }
    agents.push({ backend, model });
  }
  return { ok: true, agents };
}

export function buildTurn({ backend, model, arm, message, sessionId, turn, bundle, budgetUsd }) {
  if (backend === "claude") {
    return {
      command: "claude",
      args: [
        "-p", message,
        "--output-format", "stream-json", "--verbose", "--include-hook-events",
        "--model", model,
        "--max-budget-usd", String(budgetUsd),
        "--dangerously-skip-permissions",
        "--disallowedTools", "AskUserQuestion",
        "--settings", JSON.stringify({ enabledPlugins: { [INSTALLED_PLUGIN]: false } }),
        ...(arm === "gsd" ? ["--plugin-dir", bundle.pluginRoot] : []),
        ...(turn === 1 ? ["--session-id", sessionId] : ["--resume", sessionId]),
      ],
    };
  }
  if (backend === "codex") {
    // After a reinstall codex holds the plugin's hooks untrusted and `exec` skips them, but a
    // bypass also runs a disabled plugin's hooks, so only the GSD arm bypasses hook trust.
    const options = [
      "--json",
      "--skip-git-repo-check",
      ...(arm === "gsd" ? ["--dangerously-bypass-hook-trust"] : []),
      "-c", `model="${model}"`,
      "-c", `plugins."${INSTALLED_PLUGIN}".enabled=${arm === "gsd"}`,
    ];
    return { command: "codex", args: [...(turn === 1 ? ["exec"] : ["exec", "resume", sessionId]), ...options, message] };
  }
  return {
    command: "dsh",
    args: ["--profile", "headless", "--json", ...(turn === 1 ? [] : ["--session-id", sessionId]), message],
  };
}

function jsonLines(stdout) {
  const events = [];
  for (const line of String(stdout ?? "").split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      events.push({ line, event: JSON.parse(line) });
    } catch {
      // a partial or foreign line carries nothing this parser reads
    }
  }
  return events;
}

const count = (value) => (Number.isFinite(value) ? value : 0);
const CLAUDE_SYNTHETIC_MODEL = "<synthetic>";

function parseClaude(events) {
  const result = events.map(({ event }) => event).findLast((event) => event.type === "result");
  const usage = Object.values(result?.modelUsage ?? {});
  const tokens = usage.reduce(
    (sum, model) =>
      sum + count(model.inputTokens) + count(model.outputTokens) + count(model.cacheReadInputTokens) + count(model.cacheCreationInputTokens),
    0,
  );
  return {
    text: typeof result?.result === "string" ? result.result : "",
    sessionId: result?.session_id ?? null,
    tokens,
    costUsd: count(result?.total_cost_usd),
    bootstrapSeen: events.some(({ event, line }) => event.type === "system" && containsBootstrapMarker(line)),
    // A synthetic message is the CLI's own answer, such as a login refusal, not the model's.
    replied: events.some(({ event }) => event.type === "assistant" && event.message?.model !== CLAUDE_SYNTHETIC_MODEL),
  };
}

function parseCodex(events) {
  let text = "";
  let sessionId = null;
  let tokens = 0;
  let replied = false;
  for (const { event } of events) {
    if (event.type === "thread.started") sessionId = event.thread_id ?? sessionId;
    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      text = String(event.item.text ?? "");
      replied = true;
    }
    if (event.type === "turn.completed") tokens += count(event.usage?.input_tokens) + count(event.usage?.output_tokens);
  }
  return { text, sessionId, tokens, costUsd: null, bootstrapSeen: null, replied };
}

function parseDsh(events) {
  let text = "";
  let sessionId = null;
  let tokens = 0;
  let replied = false;
  for (const { event } of events) {
    if (event.type === "session") sessionId = event.sessionId ?? sessionId;
    if (event.type === "status" && event.phase === "step_end") tokens += count(event.usage?.inputTokens) + count(event.usage?.outputTokens);
    if (event.type === "final") {
      text = String(event.text ?? "");
      replied = true;
    }
  }
  return { text, sessionId, tokens, costUsd: null, bootstrapSeen: null, replied };
}

// Codex and dsh print no hook output, so their bootstrap evidence comes from the session files
// the runner reads afterwards; until then it is null, which a row treats as missing.
export function parseTurn(backend, stdout) {
  const events = jsonLines(stdout);
  if (backend === "claude") return parseClaude(events);
  if (backend === "codex") return parseCodex(events);
  return parseDsh(events);
}

// ---------------------------------------------------------------------------------------------
// Rows (D-5). A row is one session: every turn summed, the simulated user's events, the final
// grade, and the fingerprint of the bytes it measured.

const COST_DECIMALS = 9;

function bootstrapEvidence(turns) {
  if (turns.some((turn) => turn.bootstrapSeen === true)) return true;
  if (turns.some((turn) => turn.bootstrapSeen === null)) return null;
  return false;
}

function invalidReason(arm, turns, seen) {
  if (!turns.some((turn) => turn.replied)) return "the agent gave no reply";
  if (seen === null) return "no bootstrap evidence could be read for this session";
  if (arm === "gsd" && !seen) return "the GSD arm shows no bootstrap evidence";
  if (arm === "vanilla" && seen) return "the bootstrap reached the vanilla arm";
  return null;
}

export function buildRow({ fixture, agent, arm, turns, grade, wallMs, fingerprint }) {
  const seen = bootstrapEvidence(turns);
  const reason = invalidReason(arm, turns, seen);
  const costs = turns.map((turn) => turn.costUsd);
  const first = turns[0] ?? { changed: false, question: false };
  return {
    fixture: fixture.id,
    kind: fixture.kind,
    backend: agent.backend,
    model: agent.model,
    arm,
    valid: reason === null,
    invalid_reason: reason,
    bootstrap_seen: seen,
    passed: grade.hidden.passed === grade.hidden.total && grade.regressions.length === 0,
    hidden: grade.hidden,
    regressions: grade.regressions,
    visible_tests_edited: grade.visible_tests_edited,
    agent_turns: turns.length,
    asked: turns.some((turn) => turn.event === "asked"),
    corrected: turns.some((turn) => turn.event === "corrected"),
    recommended: turns.some((turn) => turn.event === "recommended"),
    turn1: { changed: first.changed, question: first.question },
    tokens: turns.reduce((sum, turn) => sum + count(turn.tokens), 0),
    cost_usd: costs.some((cost) => cost === null) ? null : Number(costs.reduce((sum, cost) => sum + cost, 0).toFixed(COST_DECIMALS)),
    wall_ms: wallMs,
    ...fingerprint,
  };
}

// ---------------------------------------------------------------------------------------------
// The report. It keeps every raw row and sums valid rows per agent and arm; it states no
// improvement figure, so a reader compares the arms themselves.

export const INTENT_REPORT_SCOPE = "agent CLI sessions with and without GSD (intent axis)";
export const DEFAULT_INTENT_REPORT_PATH = "test/eval/intent-report.json";
export const FINGERPRINT_KEYS = ["fixture_sha256", "harness_sha256", "cli_version", "bundle_sha256"];
const ROW_KEYS = {
  fixture: "string",
  kind: "string",
  backend: "string",
  model: "string",
  arm: "string",
  valid: "boolean",
  passed: "boolean",
  agent_turns: "number",
  asked: "boolean",
  corrected: "boolean",
  recommended: "boolean",
  tokens: "number",
  wall_ms: "number",
};

export function cellKey(row) {
  return `${row.backend}:${row.model}|${row.fixture}|${row.arm}`;
}

function emptySums() {
  return {
    rows: 0,
    valid: 0,
    passed: 0,
    first_try: 0,
    vague: 0,
    asked_vague: 0,
    clear: 0,
    over_asked: 0,
    corrected: 0,
    agent_turns: 0,
    tokens: 0,
    cost_usd: 0,
    wall_ms: 0,
  };
}

export function summarizeIntentRows(rows) {
  const summary = {};
  for (const row of rows) {
    const agent = `${row.backend}:${row.model}`;
    summary[agent] ??= Object.fromEntries(INTENT_ARMS.map((arm) => [arm, emptySums()]));
    const sums = summary[agent][row.arm];
    sums.rows += 1;
    if (!row.valid) continue;
    sums.valid += 1;
    if (row.passed) sums.passed += 1;
    if (row.passed && !row.corrected) sums.first_try += 1;
    if (row.kind === "vague") {
      sums.vague += 1;
      if (row.asked) sums.asked_vague += 1;
    } else {
      sums.clear += 1;
      if (row.asked) sums.over_asked += 1;
    }
    if (row.corrected) sums.corrected += 1;
    sums.agent_turns += row.agent_turns;
    sums.tokens += row.tokens;
    sums.cost_usd =
      sums.cost_usd === null || row.cost_usd === null ? null : Number((sums.cost_usd + row.cost_usd).toFixed(COST_DECIMALS));
    sums.wall_ms += row.wall_ms;
  }
  return summary;
}

export function buildIntentReport({ rows }) {
  const sorted = [...rows].sort((left, right) => compareText(cellKey(left), cellKey(right)));
  return { scope: INTENT_REPORT_SCOPE, rows: sorted, summary: summarizeIntentRows(sorted) };
}

function rowProblem(row) {
  for (const [key, type] of Object.entries(ROW_KEYS)) {
    if (typeof row?.[key] !== type) return `${key} must be a ${type}`;
  }
  if (!INTENT_KINDS.includes(row.kind)) return `kind must be one of ${INTENT_KINDS.join(", ")}`;
  if (!BACKENDS.includes(row.backend)) return `backend must be one of ${BACKENDS.join(", ")}`;
  if (!INTENT_ARMS.includes(row.arm)) return `arm must be one of ${INTENT_ARMS.join(", ")}`;
  if (row.cost_usd !== null && typeof row.cost_usd !== "number") return "cost_usd must be a number or null";
  const badKey = FINGERPRINT_KEYS.find((key) => row[key] !== null && typeof row[key] !== "string");
  return badKey ? `${badKey} must be a string or null` : null;
}

export function validateIntentReport(report) {
  if (report?.scope !== INTENT_REPORT_SCOPE) return { ok: false, detail: `scope must be "${INTENT_REPORT_SCOPE}"` };
  if (!Array.isArray(report.rows)) return { ok: false, detail: "rows must be an array" };
  const seen = new Set();
  for (const [index, row] of report.rows.entries()) {
    const problem = rowProblem(row);
    if (problem) return { ok: false, detail: `row ${index}: ${problem}` };
    if (seen.has(cellKey(row))) return { ok: false, detail: `row ${index}: ${cellKey(row)} appears twice` };
    seen.add(cellKey(row));
  }
  if (JSON.stringify(report.summary) !== JSON.stringify(summarizeIntentRows(report.rows))) {
    return { ok: false, detail: "summary does not match the rows" };
  }
  return { ok: true };
}

// `live(row)` returns the fingerprint that row's cell would be measured with now.
export function keepMatchingRows(rows, live) {
  const kept = rows.filter((row) => {
    const expected = live(row);
    return FINGERPRINT_KEYS.every((key) => (row[key] ?? null) === (expected[key] ?? null));
  });
  return { kept, dropped: rows.length - kept.length };
}
