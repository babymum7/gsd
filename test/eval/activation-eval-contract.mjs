const ACTIVATING_DECISIONS = new Set([
  "ordinary-routing",
  "ignore-terminal-record",
]);
const STOPPING_DECISIONS = new Set([
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
