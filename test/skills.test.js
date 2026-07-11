import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bindApprovedSources, parseMarkdownPacket, rejectLegacyPreapprovalFiles, verifyApprovedSources,
} from "./support/markdown-packet.mjs";
import {
  parseClassifyResponse, parseTraceResponse, validateFixtureSet,
} from "./eval/route-eval-contract.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(ROOT, "skills");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const skillNames = () => readdirSync(SKILLS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("gsd"))
  .map((entry) => entry.name);
const filesUnder = (directory) => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() ? [path] : [];
  });
const markdownFiles = (directory) => filesUnder(directory)
  .filter((path) => path.endsWith(".md"));
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
  assert.throws(() => verifyApprovedSources({ ...files, "plan.md": files["plan.md"].replace("Parse packet", "Parse bound packet") }, binding), /hash mismatch/);
  assert.throws(() => parseMarkdownPacket({ ...files, "spec.md": files["spec.md"].replace("**Outcome:** A valid packet becomes an execution contract.", "**Outcome:** success") }), /outcome, action, and expected/);
  assert.throws(() => parseMarkdownPacket({ ...files, "spec.md": files["spec.md"].replaceAll("\n", "\r\n") }), /LF line endings/);
  assert.throws(() => parseMarkdownPacket({ ...files, "proposal.md": `\n${files["proposal.md"]}` }), /leading or trailing blank lines/);
  assert.throws(() => parseMarkdownPacket({ ...files, "proposal.md": `${files["proposal.md"]} \t\n` }), /leading or trailing blank lines/);
  assert.throws(() => parseMarkdownPacket({ ...files, "proposal.md": `${files["proposal.md"]} \t` }), /leading or trailing blank lines/);
  assert.throws(() => parseMarkdownPacket({ ...files, "proposal.md": files["proposal.md"].replace("# Proposal", "# Wrong") }), /top-level heading/);
  assert.throws(() => parseMarkdownPacket({ ...files, "proposal.md": files["proposal.md"].replace("## Summary\nValidate Markdown packets.", "## Summary\n") }), /Summary is required/);
  assert.throws(() => parseMarkdownPacket({ ...files, "design.md": "" }), /design\.md is required/);
  assert.doesNotThrow(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("`node --test test/skills.test.js`", "`none`") }));
  const publishedSpec = `${files["spec.md"]}\n## Publication\n\n\`docs/gsd/canonical-fixture/milestones.md\`\n`;
  assert.doesNotThrow(() => parseMarkdownPacket({ ...files, "spec.md": publishedSpec }));
  const legacyPublication = publishedSpec.replace("milestones.md", ["milestones", ".toon"].join(""));
  assert.throws(
    () => parseMarkdownPacket({ ...files, "spec.md": legacyPublication }),
    /canonical Markdown ledger path/,
  );
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
  assert.match(planner, /create the next positive sequential handoff \(`handoff-1\.toon` when none exists\)/);
  assert.doesNotMatch(execution, /^produces: \[[^\n]*plan\.md/m);
  assert.match(execution, /ledger byte-for-byte read-only throughout the per-task loop/);
  assert.match(verify, /final milestone → delete the ledger/);
  assert.match(handoff, /settings\[N\]\{key,value\}/);
  assert.match(handoff, /malformed row, duplicate key, or invalid known value/);
  assert.match(handoff, /select the highest-numbered handoff first/);
  assert.match(planner, /fresh approval after Spec escalation supersedes older bindings/);
  assert.match(execution, /Never fall back to an older handoff/);
  assert.match(handoff, /Execution resume \| `handoff-<n>\.toon`; `proposal\.md`; `spec\.md`; `plan\.md`/);
  assert.match(reference, /Execution never depends on prompt-local memory for the approval binding/);
  assert.match(reference, /# Milestones[\s\S]*\| ID \| Slug \| Goal \| Status \|/);
  assert.match(reference, /status is exactly `pending` or `done`/);
  assert.match(master, /all-`done`, fail closed/);
});

test("master route and policy tables retain their declared shape", () => {
  const master = read("skills/gsd/SKILL.md");
  const classifier = master.match(/\*\*Route 0 classifier \(normative\)\.\*\*([\s\S]*?)\n1\. \*\*Resume\*\*:/)?.[1];
  assert.ok(classifier, "Route 0 classifier boundary");
  const classifierRows = classifier.split("\n").filter((line) => line.startsWith("|"));
  assert.equal(classifierRows.length, 5);
  assert.ok(classifierRows.every((line) => line.split("|").length === 7), "Route 0 table must have five columns");

  for (const [route, title] of [
    [1, "Resume"], [2, "Review/Diff"], [3, "Spec/Plan"],
    [4, "Issue/Bug"], [5, "Codebase Exploration"], [6, "New Work / Vague Input"],
  ]) {
    assert.match(master, new RegExp(`^${route}\\. \\*\\*${title.replace("/", "\\/")}\\*\\*:$`, "m"));
  }

  const matrix = master.match(/### Executable policy scenario matrix \(normative\)([\s\S]*?)\n## Dynamic Sub-Skill Loading/)?.[1];
  assert.ok(matrix, "context-harvest matrix boundary");
  const matrixRows = matrix.split("\n").filter((line) => line.startsWith("|"));
  assert.ok(matrixRows.length > 2);
  assert.ok(matrixRows.every((line) => line.split("|").length === 10), "policy matrix must have eight columns");
});

test("domain model has exactly one writer", () => {
  const writers = skillNames().filter((name) => {
    const skill = read(`skills/${name}/SKILL.md`);
    return /^produces: .*docs\/domain\/index\.md.*docs\/domain\/<scope>\.md/m.test(skill);
  });
  assert.deepEqual(writers, ["gsd-domain-modeling"]);
  const modeler = read("skills/gsd-domain-modeling/SKILL.md");
  assert.match(modeler, /orphan shard, or any other partial directory fails closed/);
});

test("domain model satisfies its deterministic Markdown invariants", () => {
  const index = read("docs/domain/index.md");
  assert.doesNotMatch(index, /\r/);
  assert.match(index, /^# Domain Model\n/);
  assert.match(index, /^## Scopes$/m);

  const scopeRows = [...index.matchAll(/^\| ([a-z0-9-]+) \| `([^`]+\.md)` \| ([^|]+) \|$/gm)]
    .map(([, scope, file, purpose]) => ({ scope, file, purpose: purpose.trim() }));
  const scopes = scopeRows.map(({ scope }) => scope);
  assert.ok(scopeRows.length > 0, "domain index must declare at least one scope");
  assert.deepEqual(scopes, [...scopes].sort());
  const shardFiles = readdirSync(join(ROOT, "docs/domain"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md")
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(scopeRows.map(({ file }) => file), shardFiles);

  for (const { scope, file, purpose } of scopeRows) {
    assert.ok(purpose, `${scope} purpose is required`);
    assert.equal(file, `${scope}.md`, `${scope} shard name`);
    assert.ok(existsSync(join(ROOT, "docs/domain", file)), `${file} must exist`);

    const shard = read(`docs/domain/${file}`);
    assert.doesNotMatch(shard, /\r/);
    assert.match(shard, /^# Domain Scope\n/);
    assert.equal(shard.match(/^## Scope\n\n`([^`]+)`$/m)?.[1], scope);
    assert.match(shard, /^## Terms$/m);
    assert.match(shard, /^## Decisions$/m);

    const termRows = [...shard.matchAll(/^\| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)]
      .map(([, term]) => term.trim())
      .filter((term) => !["Term", "---"].includes(term));
    assert.deepEqual(termRows, [...termRows].sort(), `${scope} terms must be sorted`);

    const decisions = [...shard.matchAll(/^### D-([a-z0-9-]+)-(\d+): (.+)$/gm)];
    assert.ok(
      decisions.every(([, decisionScope, , title]) => decisionScope === scope && title.trim()),
      `${scope} decision headings`,
    );
    assert.deepEqual(
      decisions.map(([, , ordinal]) => Number(ordinal)),
      decisions.map((_, index_) => index_ + 1),
      `${scope} decision IDs`,
    );
    assert.ok(termRows.length + decisions.length > 0, `${scope} shard cannot be empty`);
  }
});

test("durable domain and milestone documentation has no legacy TOON paths", () => {
  const contractFiles = [
    join(ROOT, "README.md"),
    join(ROOT, "install.sh"),
    join(ROOT, "VERSION"),
    join(ROOT, ".gitattributes"),
    ...filesUnder(join(ROOT, "skills")),
    ...filesUnder(join(ROOT, "docs")),
    ...filesUnder(join(ROOT, "test")),
  ];
  const legacyDomainPath = ["docs/domain", ".toon"].join("");
  const legacyMilestoneSuffix = ["/milestones", ".toon"].join("");
  for (const path of contractFiles) {
    const content = readFileSync(path, "utf8");
    assert.ok(!content.includes(legacyDomainPath) && !content.includes(legacyMilestoneSuffix), path);
  }
});

test("all relative Markdown links resolve", () => {
  const paths = [
    join(ROOT, "README.md"),
    ...markdownFiles(SKILLS),
    ...markdownFiles(join(ROOT, "docs")),
  ];
  for (const path of paths) {
    const content = readFileSync(path, "utf8");
    for (const match of content.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].split("#")[0];
      if (!target || /^[a-z]+:\/\//i.test(target) || target.startsWith("mailto:")) continue;
      assert.ok(existsSync(resolve(dirname(path), target)), `${path}: unresolved link ${target}`);
    }
  }
});

test("README documents the Markdown contract without legacy plan authority", () => {
  const readme = read("README.md");
  assert.match(readme, /proposal\.md \+ spec\.md/);
  assert.match(readme, /plan\.md/);
  assert.doesNotMatch(readme, /proposal\.toon|spec\.toon|design\.toon|plan\.toon/);
});

test("route evaluation fixtures and response parsers enforce the routing contract", () => {
  const fixtureText = read("test/eval/fixtures.json");
  const fixtures = JSON.parse(fixtureText);
  const installed = new Set(skillNames());
  assert.deepEqual(validateFixtureSet(fixtures, installed), { ok: true });
  const documentedFixtureCount = read("README.md").match(/(\d+) workspace-state \+ prompt fixtures/);
  assert.ok(documentedFixtureCount);
  assert.equal(fixtures.length, Number(documentedFixtureCount[1]));
  assert.match(fixtureText, /approved plan\.md exist/);
  assert.doesNotMatch(fixtureText, /proposal\.toon|spec\.toon|design\.toon|plan\.toon/);
  assert.deepEqual(parseClassifyResponse('{"route":"0","skill":"none"}', installed), {
    ok: true,
    value: { route: "0", skill: "none" },
  });
  assert.match(parseClassifyResponse('{"route":"0","skill":"none","route":"6"}', installed).detail, /duplicate keys/);
  assert.deepEqual(parseTraceResponse("Route 5 → gsd-codebase-design", installed), {
    ok: true,
    value: { route: "5", skill: "gsd-codebase-design" },
  });
  assert.match(parseTraceResponse("Route meta → catalog", installed).detail, /noncanonical/);
});
