import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bindApprovedSources, parseMarkdownPacket, rejectLegacyPreapprovalFiles, verifyApprovedSources,
} from "./support/markdown-packet.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(ROOT, "skills");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const skillNames = () => readdirSync(SKILLS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("gsd"))
  .map((entry) => entry.name);
const canonicalPacket = () => ({
  "proposal.md": "# Proposal\n## Feature\n`canonical-fixture`\n## Summary\nValidate Markdown packets.\n## Why\nPrevent runtime drift.\n## Scope\n- Validate packet\n## Impact\n- **runtime:** binds sources\n## Questions\nNone.\n",
  "spec.md": "# Specification\n## Feature\n`canonical-fixture`\n## Context\nA tracked inline fixture.\n## Acceptance Criteria\n### AC-1: Packet parses\n- **State:** active\n- **Outcome:** A valid packet becomes an execution contract.\n- **Action:** Parse the approved Markdown sources.\n- **Expected:** Return the matching feature and acceptance criterion.\n## Invariants\n- **I-1:** Approved source bytes remain immutable.\n## Non-goals\n- **NG-1:** Runtime TOON is not edited by the parser.\n## Interfaces\n| Criterion | Seam | Path | Lower-seam reason |\n| --- | --- | --- | --- |\n| AC-1 | parser | `test/skills.test.js` | none |\n",
  "plan.md": "# Plan\n## Feature\n`canonical-fixture`\n## Base\n`main`\n## Tasks\n### T1: Parse packet\n- **Satisfies:** AC-1\n- **Files:** `test/skills.test.js`\n- **Test:** `node --test test/skills.test.js`\n- **Status:** pending\n",
});

test("every GSD skill has complete matching frontmatter", () => {
  for (const name of skillNames()) {
    const skill = read(`skills/${name}/SKILL.md`);
    assert.match(skill, new RegExp(`^---\\nname: ${name}\\n`, "m"), name);
    assert.match(skill, /^triggers: .+$/m, `${name} triggers`);
    assert.match(skill, /^produces: \[.*\]$/m, `${name} produces`);
    assert.match(skill, /^consumes: \[.*\]$/m, `${name} consumes`);
  }
});

test("all skill references resolve to installed skills", () => {
  const names = new Set(skillNames());
  const unresolved = [];
  for (const name of names) {
    const skill = read(`skills/${name}/SKILL.md`);
    for (const match of skill.matchAll(/`(gsd-[a-z-]+)`|(?<![a-z0-9/])\/(gsd-[a-z-]+)/g)) {
      const target = match[1] ?? match[2];
      if (!names.has(target)) unresolved.push(`${name} -> ${target}`);
    }
  }
  assert.deepEqual(unresolved, []);
});

test("canonical Markdown packet is ordered, concrete, and hash-bound", () => {
  const files = canonicalPacket();
  const parsed = parseMarkdownPacket(files);
  assert.equal(parsed.feature, "canonical-fixture");
  assert.deepEqual(parsed.tasks.map(({ id }) => id), ["T1"]);
  const binding = bindApprovedSources(files);
  assert.deepEqual(verifyApprovedSources(files, binding), binding);
  assert.throws(() => parseMarkdownPacket({ ...files, "spec.md": files["spec.md"].replace("**State:** active", "**State:** draft") }), /invalid state/);
  assert.throws(() => parseMarkdownPacket({ ...files, "spec.md": files["spec.md"].replace("- **Action:** Parse the approved Markdown sources.\n- **Expected:** Return the matching feature and acceptance criterion.", "- **Expected:** Return the matching feature and acceptance criterion.\n- **Action:** Parse the approved Markdown sources.") }), /fields must be exactly ordered/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("**Satisfies:** AC-1", "**Satisfies:** AC-1, AC-1") }), /exactly once/);
  assert.throws(() => verifyApprovedSources({ ...files, "plan.md": `${files["plan.md"]}\n` }, binding), /hash mismatch/);
});

test("legacy pre-approval TOON is explicitly rejected", () => {
  assert.throws(() => rejectLegacyPreapprovalFiles(["proposal.toon", "spec.toon"]), /not authoritative/);
  assert.doesNotThrow(() => rejectLegacyPreapprovalFiles(["handoff-1.toon", "result.toon"]));
});

test("core pipeline skills use Markdown authority and preserve runtime TOON", () => {
  const master = read("skills/gsd/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const tdd = read("skills/gsd-tdd/SKILL.md");
  assert.match(master, /route it to `gsd-to-plan`, the sole `plan\.md` author/);
  assert.match(master, /stale non-authoritative state/);
  assert.match(reference, /Canonical Markdown contract/);
  assert.match(reference, /SHA-256 hash/);
  assert.match(reference, /Runtime records report progress and bind source bytes/);
  for (const skill of [planner, execution, verify, handoff, tdd]) {
    assert.match(skill, /Markdown/i);
    assert.match(skill, /hash|SHA-256|binding/i);
  }
  assert.match(execution, /never mutate the attempt or rewrite the approved Markdown plan/);
  assert.match(handoff, /never overwrite or suffix an existing handoff/);
  assert.match(tdd, /source paths\/hashes and criterion\/interface facts against `spec\.md` and `plan\.md`/);
  assert.match(tdd, /bound Markdown packet \(`proposal\.md`, `spec\.md`, optional `design\.md`, and `plan\.md`\)/);
  assert.doesNotMatch(tdd, /proposal\.toon|spec\.toon|plan\.toon/);
  assert.doesNotMatch(reference, /TOON-only execution|reject an active `spec\.md`/i);
  assert.match(reference, /Quick-fix plan exception/);
  assert.match(master, /Quick-fix plan exception/);
  assert.match(verify, /Critical\/Important findings and red gates block/);
});

test("domain model has exactly one writer", () => {
  const writers = skillNames().filter((name) => read(`skills/${name}/SKILL.md`).match(/^produces: .*docs\/domain\.toon/m));
  assert.deepEqual(writers, ["gsd-domain-modeling"]);
});

test("README documents the Markdown contract without legacy plan authority", () => {
  const readme = read("README.md");
  assert.match(readme, /proposal\.md \+ spec\.md/);
  assert.match(readme, /plan\.md/);
  assert.doesNotMatch(readme, /proposal\.toon|spec\.toon|design\.toon|plan\.toon/);
});

test("route evaluation fixtures model Markdown feature state", () => {
  const fixtures = read("test/eval/fixtures.json");
  assert.match(fixtures, /approved plan\.md exist/);
  assert.doesNotMatch(fixtures, /proposal\.toon|spec\.toon|design\.toon|plan\.toon/);
});
