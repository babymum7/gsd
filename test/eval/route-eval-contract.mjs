const ALLOWED_ROUTES = new Set(["0", "1", "2", "3", "4", "5", "6", "meta"]);
const ROUTE_TARGETS = new Map([
  ["0", new Set(["none", "gsd-ponytail"])],
  ["1", new Set(["gsd-handoff"])],
  ["2", new Set(["gsd-verify"])],
  ["3", new Set(["gsd-to-plan", "gsd-executing-plans"])],
  ["4", new Set(["gsd-diagnosing-bugs"])],
  ["5", new Set(["gsd-improve-codebase-architecture", "gsd-codebase-design", "gsd-domain-modeling"])],
  ["6", new Set(["none"])],
  ["meta", new Set(["gsd-handoff", "gsd-lavish", "catalog"])],
]);

const ROUTE_BEARING_DECISIONS = new Set([
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
  ...ROUTE_BEARING_DECISIONS,
  ...STOPPING_DECISIONS,
]);

export function decisionHasRoute(decision) {
  return ROUTE_BEARING_DECISIONS.has(decision);
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
    if (character === "{"
      || character === "[") {
      depth += 1;
      continue;
    }
    if (character === "}"
      || character === "]") {
      depth -= 1;
      continue;
    }
    if (character !== "\"") {
      continue;
    }

    let end = index + 1;
    let escaped = false;
    for (; end < text.length; end += 1) {
      const stringCharacter = text[end];
      if (escaped) {
        escaped = false;
      } else if (stringCharacter === "\\") {
        escaped = true;
      } else if (stringCharacter === "\"") {
        break;
      }
    }
    if (end >= text.length) {
      return false;
    }

    if (depth === 1) {
      let cursor = end + 1;
      while (/\s/.test(text[cursor] ?? "")) {
        cursor += 1;
      }
      if (text[cursor] === ":") {
        const key = JSON.parse(text.slice(index, end + 1));
        if (seen.has(key)) {
          return true;
        }
        seen.add(key);
      }
    }
    index = end;
  }
  return false;
}

export function validateRouteTarget(value, installedSkills, { allowMeta = true } = {}) {
  if (!(installedSkills instanceof Set)) {
    return { ok: false, detail: "installed skill set is required" };
  }
  if (!isPlainObject(value) || typeof value.route !== "string" || typeof value.skill !== "string") {
    return { ok: false, detail: "route and skill must be strings" };
  }
  if (!ALLOWED_ROUTES.has(value.route) || (!allowMeta && value.route === "meta")) {
    return { ok: false, detail: `unsupported route ${value.route}` };
  }
  const targetAllowed = value.skill === "none"
    || value.skill === "catalog"
    || (value.skill.startsWith("gsd-") && installedSkills.has(value.skill));
  if (!targetAllowed) {
    return { ok: false, detail: `unsupported or unregistered skill ${value.skill}` };
  }
  if (!ROUTE_TARGETS.get(value.route).has(value.skill)) {
    return { ok: false, detail: `skill ${value.skill} is not a target for route ${value.route}` };
  }
  return { ok: true };
}

export function validateDecisionTarget(value, installedSkills) {
  if (!(installedSkills instanceof Set)) {
    return { ok: false, detail: "installed skill set is required" };
  }
  if (!hasExactKeys(value, ["decision", "route", "skill"])) {
    return { ok: false, detail: "decision target must contain exactly decision, route, and skill" };
  }
  if (typeof value.decision !== "string" || !ALLOWED_DECISIONS.has(value.decision)) {
    return { ok: false, detail: `unsupported decision ${value.decision}` };
  }
  if (decisionHasRoute(value.decision)) {
    return validateRouteTarget(value, installedSkills);
  }
  if (value.route !== null || value.skill !== null) {
    return { ok: false, detail: `decision ${value.decision} requires null route and skill` };
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
      ? ["id", "state", "prompt", "decision", "route", "skill"]
      : ["id", "state", "prompt", "decision", "route", "skill", "accept"];
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

    const expected = validateDecisionTarget(
      { decision: fixture.decision, route: fixture.route, skill: fixture.skill },
      installedSkills,
    );
    if (!expected.ok) {
      return { ok: false, detail: `${fixture.id}: ${expected.detail}` };
    }
    if (fixture.accept !== undefined) {
      if (!Array.isArray(fixture.accept)) {
        return { ok: false, detail: `${fixture.id}: accept must be an array` };
      }
      for (const alternate of fixture.accept) {
        if (!hasExactKeys(alternate, ["decision", "route", "skill"])) {
          return { ok: false, detail: `${fixture.id}: invalid accept entry shape` };
        }
        if (fixture.decision !== alternate.decision) {
          return { ok: false, detail: `${fixture.id}: accept entries must use the primary pre-route decision` };
        }
        if (decisionHasRoute(fixture.decision)
          && ((fixture.route === "meta") !== (alternate.route === "meta"))) {
          return { ok: false, detail: `${fixture.id}: accept entries must use the primary route's trace mode` };
        }
        const accepted = validateDecisionTarget(alternate, installedSkills);
        if (!accepted.ok) {
          return { ok: false, detail: `${fixture.id}: ${accepted.detail}` };
        }
      }
    }
  }
  return { ok: true };
}

export function parseClassifyResponse(text, installedSkills) {
  if (typeof text !== "string" || text !== text.trim()) {
    return { ok: false, detail: `classify reply has outer whitespace: ${text}` };
  }
  const reply = text;
  let parsed;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return { ok: false, detail: `invalid exact JSON reply: ${text}` };
  }
  if (hasDuplicateTopLevelKeys(reply)) {
    return { ok: false, detail: `classify reply contains duplicate keys: ${text}` };
  }

  if (!hasExactKeys(parsed, ["decision", "route", "skill"])) {
    return {
      ok: false,
      detail: `classify reply must contain exactly decision, route, and skill: ${text}`,
    };
  }
  const validated = validateDecisionTarget(parsed, installedSkills);
  if (!validated.ok) {
    return { ok: false, detail: `invalid classify reply: ${validated.detail}` };
  }
  return {
    ok: true,
    value: { decision: parsed.decision, route: parsed.route, skill: parsed.skill },
  };
}

export function parseTraceResponse(text, installedSkills) {
  if (typeof text !== "string" || text !== text.trim()) {
    return { ok: false, detail: `route trace has outer whitespace: ${text}` };
  }
  const reply = text;
  const match = reply.match(/^Route ([0-6]) → ([a-z0-9-]+)$/);
  if (!match) {
    return { ok: false, detail: `noncanonical route trace: ${text}` };
  }

  const value = { route: match[1], skill: match[2] };
  const validated = validateRouteTarget(value, installedSkills, { allowMeta: false });
  if (!validated.ok) {
    return { ok: false, detail: `invalid route trace: ${validated.detail}` };
  }
  return { ok: true, value };
}

export function responseMatchesFixture(value, fixture) {
  return [
    { decision: fixture.decision, route: fixture.route, skill: fixture.skill },
    ...(fixture.accept ?? []),
  ].some((want) => {
    if (Object.hasOwn(value, "decision")) {
      return value.decision === want.decision
        && value.route === want.route
        && value.skill === want.skill;
    }
    return decisionHasRoute(want.decision)
      && value.route === want.route
      && value.skill === want.skill;
  });
}
