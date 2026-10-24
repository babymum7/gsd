// The canon axis asks lifecycle questions whose answers the skills and REFERENCE state, as
// closed multiple choice so grading needs no judgement. Each fixture names where the rule
// lives in the current tree and in the baseline tree, so a comparison never rewards a rule
// only one side states.
export const CANON_CHOICES = ["A", "B", "C", "D"];
const FIXTURE_KEYS = ["answer", "id", "options", "prompt", "skill", "sources", "state"];

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function exactKeys(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);
}

export function validateCanonFixtureSet(fixtures, skillNames) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    return { ok: false, detail: "canon-fixtures.json must contain a non-empty top-level array" };
  }
  const ids = new Set();
  const answers = new Set();
  for (const [index, fixture] of fixtures.entries()) {
    if (!exactKeys(fixture, FIXTURE_KEYS)) {
      return { ok: false, detail: `fixture ${index + 1} must have exactly ${FIXTURE_KEYS.join(", ")}` };
    }
    for (const field of ["id", "skill", "state", "prompt"]) {
      if (!nonEmptyString(fixture[field])) return { ok: false, detail: `fixture ${index + 1} has invalid ${field}` };
    }
    if (ids.has(fixture.id)) return { ok: false, detail: `duplicate fixture ID ${fixture.id}` };
    ids.add(fixture.id);
    if (!skillNames.has(fixture.skill)) return { ok: false, detail: `${fixture.id}: unknown skill ${fixture.skill}` };
    if (!exactKeys(fixture.options, CANON_CHOICES) || !CANON_CHOICES.every((choice) => nonEmptyString(fixture.options[choice]))) {
      return { ok: false, detail: `${fixture.id}: options must be non-empty A, B, C, and D` };
    }
    if (!CANON_CHOICES.includes(fixture.answer)) return { ok: false, detail: `${fixture.id}: answer must be one of A, B, C, D` };
    answers.add(fixture.answer);
    if (!exactKeys(fixture.sources, ["baseline", "current"]) || !nonEmptyString(fixture.sources.baseline) || !nonEmptyString(fixture.sources.current)) {
      return { ok: false, detail: `${fixture.id}: sources must name where the rule lives in the current and baseline trees` };
    }
  }
  // A model that always picks one letter must not score above chance.
  const unused = CANON_CHOICES.filter((choice) => !answers.has(choice));
  if (unused.length > 0) return { ok: false, detail: `no fixture answers ${unused.join(", ")}` };
  return { ok: true };
}

function assistantMessages(events) {
  return events
    .filter((event) => event?.type === "message_end")
    .map((event) => event.message)
    .filter((message) => message?.role === "assistant");
}

function visibleContent(message) {
  if (typeof message.content === "string") {
    return message.content.trim() === "" ? [] : [{ type: "text", text: message.content }];
  }
  if (!Array.isArray(message.content)) return [];
  return message.content.filter((item) => item && item.type !== "thinking");
}

// Only the choice is graded. Many canon rules also live in the owner skill or the bootstrap,
// so whether REFERENCE was read is reported, never required.
export function parseCanonComplianceEvents(rawEvents, fixture, referencePath) {
  if (typeof rawEvents !== "string") return { ok: false, pass: false, readCanon: false, detail: "OMP JSON output must be a string" };

  const events = [];
  for (const [index, line] of rawEvents.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch (error) {
      return { ok: true, pass: false, readCanon: false, detail: `invalid NDJSON line ${index + 1}: ${error.message}` };
    }
  }

  const visible = assistantMessages(events).flatMap(visibleContent);
  const calls = visible.filter((item) => item.type === "toolCall");
  const readCanon = calls.some((call) => call.name === "read" && call.arguments?.path === referencePath);
  const reads = calls.filter((call) => call.name === "read").map((call) => String(call.arguments?.path ?? ""));
  const fail = (detail) => ({ ok: true, pass: false, readCanon, reads, detail });

  const other = calls.find((call) => call.name !== "read");
  if (other) return fail(`tool ${other.name} called; only read is allowed`);
  const text = visible.filter((item) => item.type === "text" && nonEmptyString(item.text)).at(-1)?.text.trim();
  if (!text) return fail("no text answer");

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return fail(`answer is not valid JSON: ${text.slice(0, 120)}`);
  }
  if (!exactKeys(value, ["choice"])) return fail(`answer must be exactly {"choice": "<letter>"}: ${text.slice(0, 120)}`);
  if (!CANON_CHOICES.includes(value.choice)) return fail(`choice ${JSON.stringify(value.choice)} is not A, B, C, or D`);
  if (value.choice !== fixture.answer) return fail(`want ${fixture.answer}, got ${value.choice}`);
  return { ok: true, pass: true, readCanon, reads, detail: `chose ${value.choice} after ${calls.length} reads` };
}
