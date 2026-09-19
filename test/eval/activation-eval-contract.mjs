import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ACTIVATING_DECISIONS = new Set([
  "ordinary-routing",
  "ignore-terminal-record",
]);
export const STOPPING_DECISIONS = new Set([
  "cleanup-question",
  "cleanup-only",
  "block-resume",
  "fail-closed",
]);
const ALLOWED_DECISIONS = new Set([
  ...ACTIVATING_DECISIONS,
  ...STOPPING_DECISIONS,
]);
const ALLOWED_ACTIONS = new Set(["load", "direct", "stop"]);
const HTTP_DEFAULT_MODEL = "gpt-4o-mini";
const OMP_DEFAULT_MODELS = ["gpt-5.6-luna"];

// A report is evidence only if it says which bytes produced its numbers. The rendered bootstrap
// embeds absolute repository paths, so the repository root is normalized to one placeholder
// first: two checkouts of the same revision fingerprint identically, while any change to the
// bootstrap, the visible skill catalog, or the supplied canon moves the hash. `bootstrap_words`
// and `canon_words` count words the same way the skill word caps do, but over the text the
// model actually received (the rendered bootstrap embeds the catalog rows), so they run above
// the source-file cap numbers by design.
export function evalSurfaceFingerprint({ bootstrap, repoRoot = "", canonSection = null }) {
  const normalize = (text) => String(text ?? "").split(repoRoot).join("<GSD_ROOT>");
  const digest = (text) => createHash("sha256").update(normalize(text), "utf8").digest("hex");
  const words = (text) => normalize(text).trim().split(/\s+/).filter(Boolean).length;
  return {
    bootstrap_sha256: digest(bootstrap),
    bootstrap_words: words(bootstrap),
    canon_sha256: canonSection ? digest(canonSection) : null,
    canon_words: canonSection ? words(canonSection) : null,
  };
}

// A bearer key is one way to reach a model; the local omp binary is another, and it
// already holds credentials. The keyless local binary is preferred so an ambient
// OPENAI_API_KEY cannot silently bill an HTTP endpoint; `GSD_EVAL_BACKEND=http|omp`
// forces one explicitly. Only a backend with no usable credential skips the eval.
export function selectEvalBackend(env = {}, ompPath = null) {
  const models = String(env.GSD_EVAL_MODEL ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const key = env.GSD_EVAL_KEY || env.OPENAI_API_KEY;
  const command = typeof ompPath === "string" && ompPath ? ompPath : null;
  const forced = String(env.GSD_EVAL_BACKEND ?? "").trim();
  if (forced && forced !== "http" && forced !== "omp") {
    return { kind: "skip", models, detail: `unsupported GSD_EVAL_BACKEND ${forced}` };
  }
  const http = () => ({
    kind: "http",
    key,
    baseUrl: String(env.GSD_EVAL_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
    models: models.length ? models : [HTTP_DEFAULT_MODEL],
  });
  const omp = () => ({
    kind: "omp",
    command,
    models: models.length ? models : [...OMP_DEFAULT_MODELS],
  });
  if (forced === "http") {
    return key ? http() : { kind: "skip", models, detail: "GSD_EVAL_BACKEND=http needs GSD_EVAL_KEY" };
  }
  if (forced === "omp") {
    return command ? omp() : { kind: "skip", models, detail: "GSD_EVAL_BACKEND=omp needs the omp binary" };
  }
  if (command) return omp();
  if (key) return http();
  return { kind: "skip", models, detail: "no omp binary and no GSD_EVAL_KEY" };
}

// Every fixture talks to the model through one backend, so an error thrown while asking is
// the backend failing, never a fixture the model answered wrong. Classifying it lets the
// runner stop on the first failure instead of scoring a broken credential as every fixture
// failing, which reads like a total routing regression.
export function describeEvalBackendError(message) {
  const text = String(message ?? "").trim();
  if (/incorrect api key|invalid_api_key|unauthorized|\b401\b|\b403\b/i.test(text)) {
    return `backend rejected credentials: ${text}`;
  }
  return `backend unavailable: ${text}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function hasDuplicateTopLevelKeys(text) {
  const seen = new Set();
  let depth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "{" || character === "[") {
      depth += 1;
      continue;
    }
    if (character === "}" || character === "]") {
      depth -= 1;
      continue;
    }
    if (character !== "\"") continue;

    let end = index + 1;
    let escaped = false;
    for (; end < text.length; end += 1) {
      const stringCharacter = text[end];
      if (escaped) escaped = false;
      else if (stringCharacter === "\\") escaped = true;
      else if (stringCharacter === "\"") break;
    }
    if (end >= text.length) return false;

    if (depth === 1) {
      let cursor = end + 1;
      while (/\s/.test(text[cursor] ?? "")) cursor += 1;
      if (text[cursor] === ":") {
        const key = JSON.parse(text.slice(index, end + 1));
        if (seen.has(key)) return true;
        seen.add(key);
      }
    }
    index = end;
  }
  return false;
}

export function validateActivationTarget(value, installedSkills) {
  if (!(installedSkills instanceof Set)) {
    return { ok: false, detail: "installed skill set is required" };
  }
  if (!hasExactKeys(value, ["decision", "action", "primarySkill"])) {
    return { ok: false, detail: "activation target must contain exactly decision, action, and primarySkill" };
  }
  if (typeof value.decision !== "string" || !ALLOWED_DECISIONS.has(value.decision)) {
    return { ok: false, detail: `unsupported decision ${value.decision}` };
  }
  if (typeof value.action !== "string" || !ALLOWED_ACTIONS.has(value.action)) {
    return { ok: false, detail: `unsupported action ${value.action}` };
  }

  if (STOPPING_DECISIONS.has(value.decision)) {
    if (value.action !== "stop" || value.primarySkill !== null) {
      return { ok: false, detail: `decision ${value.decision} requires stop with null primarySkill` };
    }
    return { ok: true };
  }

  if (value.action === "direct") {
    return value.primarySkill === null
      ? { ok: true }
      : { ok: false, detail: "direct action requires null primarySkill" };
  }
  if (value.action !== "load") {
    return { ok: false, detail: `decision ${value.decision} requires load or direct` };
  }
  if (typeof value.primarySkill !== "string" || !installedSkills.has(value.primarySkill)) {
    return { ok: false, detail: `unsupported or unregistered primary skill ${value.primarySkill}` };
  }
  return { ok: true };
}

export function validateFixtureSet(fixtures, installedSkills) {
  if (!Array.isArray(fixtures)) {
    return { ok: false, detail: "fixtures.json must contain a top-level array" };
  }
  if (fixtures.length === 0) {
    return { ok: false, detail: "fixtures.json must contain at least one fixture" };
  }

  const ids = new Set();
  for (const [index, fixture] of fixtures.entries()) {
    const requiredKeys = fixture?.accept === undefined
      ? ["id", "state", "prompt", "decision", "expectedAction", "expectedPrimarySkill"]
      : ["id", "state", "prompt", "decision", "expectedAction", "expectedPrimarySkill", "accept"];
    if (!hasExactKeys(fixture, requiredKeys)) {
      return { ok: false, detail: `fixture ${index + 1} has an invalid object shape` };
    }
    for (const field of ["id", "state", "prompt"]) {
      if (typeof fixture[field] !== "string" || fixture[field].trim() === "") {
        return { ok: false, detail: `fixture ${index + 1} has invalid ${field}` };
      }
    }
    if (ids.has(fixture.id)) {
      return { ok: false, detail: `duplicate fixture ID ${fixture.id}` };
    }
    ids.add(fixture.id);

    const expected = validateActivationTarget({
      decision: fixture.decision,
      action: fixture.expectedAction,
      primarySkill: fixture.expectedPrimarySkill,
    }, installedSkills);
    if (!expected.ok) return { ok: false, detail: `${fixture.id}: ${expected.detail}` };

    if (fixture.accept !== undefined) {
      if (!Array.isArray(fixture.accept)) {
        return { ok: false, detail: `${fixture.id}: accept must be an array` };
      }
      for (const alternate of fixture.accept) {
        if (!hasExactKeys(alternate, ["decision", "action", "primarySkill"])) {
          return { ok: false, detail: `${fixture.id}: invalid accept entry shape` };
        }
        if (fixture.decision !== alternate.decision) {
          return { ok: false, detail: `${fixture.id}: accept entries must use the primary result-marker decision` };
        }
        const accepted = validateActivationTarget(alternate, installedSkills);
        if (!accepted.ok) return { ok: false, detail: `${fixture.id}: ${accepted.detail}` };
      }
    }
  }
  return { ok: true };
}

export function parseActivationResponse(text, installedSkills) {
  if (typeof text !== "string" || text !== text.trim()) {
    return { ok: false, detail: `activation reply has outer whitespace: ${text}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, detail: `invalid exact JSON reply: ${text}` };
  }
  if (hasDuplicateTopLevelKeys(text)) {
    return { ok: false, detail: `activation reply contains duplicate keys: ${text}` };
  }
  const validated = validateActivationTarget(parsed, installedSkills);
  if (!validated.ok) {
    return { ok: false, detail: `invalid activation reply: ${validated.detail}` };
  }
  return {
    ok: true,
    value: {
      decision: parsed.decision,
      action: parsed.action,
      primarySkill: parsed.primarySkill,
    },
  };
}

export function responseMatchesFixture(value, fixture) {
  return [
    {
      decision: fixture.decision,
      action: fixture.expectedAction,
      primarySkill: fixture.expectedPrimarySkill,
    },
    ...(fixture.accept ?? []),
  ].some((expected) => value.decision === expected.decision
    && value.action === expected.action
    && value.primarySkill === expected.primarySkill);
}

// The triage front door (decision 0013) classifies a prompt into exactly one route before
// any lifecycle work. It is a separate axis from the completed-state matrix above, so it
// gets its own fixture shape, parser, and coverage check.
export const TRIAGE_ROUTES = ["answer", "clarify", "research", "quick", "plan", "milestone"];
const TRIAGE_ROUTE_SET = new Set(TRIAGE_ROUTES);

export function validateTriageFixtureSet(fixtures) {
  if (!Array.isArray(fixtures)) {
    return { ok: false, detail: "triage fixtures must contain a top-level array" };
  }
  if (fixtures.length === 0) {
    return { ok: false, detail: "triage fixtures must contain at least one fixture" };
  }
  const ids = new Set();
  const covered = new Set();
  for (const [index, fixture] of fixtures.entries()) {
    if (!hasExactKeys(fixture, ["id", "state", "prompt", "route"])) {
      return { ok: false, detail: `triage fixture ${index + 1} has an invalid object shape` };
    }
    for (const field of ["id", "state", "prompt"]) {
      if (typeof fixture[field] !== "string" || fixture[field].trim() === "") {
        return { ok: false, detail: `triage fixture ${index + 1} has invalid ${field}` };
      }
    }
    if (ids.has(fixture.id)) {
      return { ok: false, detail: `duplicate triage fixture ID ${fixture.id}` };
    }
    ids.add(fixture.id);
    if (typeof fixture.route !== "string" || !TRIAGE_ROUTE_SET.has(fixture.route)) {
      return { ok: false, detail: `${fixture.id}: unsupported route ${fixture.route}` };
    }
    covered.add(fixture.route);
  }
  // Every route in the canon enum must be exercised, so the front door cannot silently drop
  // one classification while the suite still reports green.
  for (const route of TRIAGE_ROUTES) {
    if (!covered.has(route)) {
      return { ok: false, detail: `triage fixtures must cover the ${route} route` };
    }
  }
  return { ok: true };
}

export function parseTriageResponse(text) {
  if (typeof text !== "string" || text !== text.trim()) {
    return { ok: false, detail: `triage reply has outer whitespace: ${text}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, detail: `invalid exact JSON reply: ${text}` };
  }
  if (hasDuplicateTopLevelKeys(text)) {
    return { ok: false, detail: `triage reply contains duplicate keys: ${text}` };
  }
  if (!hasExactKeys(parsed, ["route"])) {
    return { ok: false, detail: `triage reply must contain exactly route: ${text}` };
  }
  if (typeof parsed.route !== "string" || !TRIAGE_ROUTE_SET.has(parsed.route)) {
    return { ok: false, detail: `unsupported triage route ${parsed.route}` };
  }
  return { ok: true, value: { route: parsed.route } };
}

export function triageResponseMatchesFixture(value, fixture) {
  return value.route === fixture.route;
}

// The bootstrap names the six completed-state decisions and points at the on-demand canon that
// carries their rows. A live owner reads that section before lifecycle work, so a faithful
// measurement can hand it over, while the bootstrap-only runner stays the lower bound.
// Extraction fails closed when the heading is gone, so a moved canon cannot be scored as loaded.
export function loadLifecycleMatrix(repoRoot) {
  const canon = readFileSync(join(repoRoot, "skills", "gsd", "REFERENCE.md"), "utf8");
  const lines = canon.split("\n");
  const start = lines.findIndex((line) => /^### Completed-state and cleanup matrix\s*$/.test(line));
  if (start === -1) {
    throw new Error("the canon no longer defines ### Completed-state and cleanup matrix");
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{2,3} /.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}
