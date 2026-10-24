import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseCanonComplianceEvents, validateCanonFixtureSet } from "./eval/canon-compliance-eval-contract.mjs";

const ROOT = join(import.meta.dir, "..");
const REFERENCE = join(ROOT, "skills", "gsd", "REFERENCE.md");
const SKILLS = new Set(readdirSync(join(ROOT, "skills")).filter((name) => existsSync(join(ROOT, "skills", name, "SKILL.md"))));
const FIXTURE = { id: "f", answer: "B" };

function assistantEvent(content) {
  return `${JSON.stringify({ type: "message_end", message: { role: "assistant", content } })}\n`;
}
const read = (path) => ({ type: "toolCall", id: path, name: "read", arguments: { path } });
const answer = (value) => assistantEvent([{ type: "text", text: JSON.stringify(value) }]);

test("the committed canon fixtures are a valid set", () => {
  const fixtures = JSON.parse(readFileSync(join(ROOT, "test", "eval", "canon-fixtures.json"), "utf8"));
  assert.deepEqual(validateCanonFixtureSet(fixtures, SKILLS), { ok: true });
});

test("a fixture set fails on an unknown skill, a stray answer, or a letter no fixture uses", () => {
  const fixture = (id, answer, skill = "gsd-verify") => ({
    id,
    skill,
    state: "s",
    prompt: "p",
    options: { A: "a", B: "b", C: "c", D: "d" },
    answer,
    sources: { current: "x", baseline: "y" },
  });
  const all = [fixture("a", "A"), fixture("b", "B"), fixture("c", "C"), fixture("d", "D")];
  assert.deepEqual(validateCanonFixtureSet(all, SKILLS), { ok: true });
  assert.match(validateCanonFixtureSet([...all, fixture("e", "A", "gsd-nope")], SKILLS).detail, /e: unknown skill gsd-nope/);
  assert.match(validateCanonFixtureSet([...all, fixture("e", "E")], SKILLS).detail, /e: answer must be one of/);
  assert.match(validateCanonFixtureSet(all.slice(0, 3), SKILLS).detail, /no fixture answers D/);
  const { sources, ...unsourced } = fixture("e", "A");
  assert.match(validateCanonFixtureSet([...all, unsourced], SKILLS).detail, /fixture 5 must have exactly/);
});

test("the right choice after reads passes and reports whether REFERENCE was read", () => {
  const skill = join(ROOT, "skills", "gsd-verify", "SKILL.md");
  const withCanon = parseCanonComplianceEvents(
    assistantEvent([read(skill)]) + assistantEvent([read(REFERENCE)]) + answer({ choice: "B" }),
    FIXTURE,
    REFERENCE,
  );
  assert.deepEqual(withCanon, { ok: true, pass: true, readCanon: true, detail: "chose B after 2 reads" });
  const skillOnly = parseCanonComplianceEvents(assistantEvent([read(skill)]) + answer({ choice: "B" }), FIXTURE, REFERENCE);
  assert.equal(skillOnly.pass, true);
  assert.equal(skillOnly.readCanon, false);
});

test("a wrong letter, extra keys, prose, or a non-read tool fails with a named detail", () => {
  const grade = (raw) => parseCanonComplianceEvents(raw, FIXTURE, REFERENCE);
  assert.equal(grade(answer({ choice: "C" })).detail, "want B, got C");
  assert.match(grade(answer({ choice: "B", why: "x" })).detail, /exactly \{"choice"/);
  assert.match(grade(assistantEvent([{ type: "text", text: "B, because" }])).detail, /not valid JSON/);
  assert.match(grade(assistantEvent([{ type: "toolCall", id: "1", name: "bash", arguments: {} }]) + answer({ choice: "B" })).detail, /tool bash called/);
  assert.equal(grade(assistantEvent([read(REFERENCE)])).detail, "no text answer");
});
