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
