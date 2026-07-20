import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import nodeFs from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bindApprovedSources, parseMarkdownPacket, rejectLegacyPreapprovalFiles, verifyApprovedSources,
  validateSectionEdges,
} from "./support/markdown-packet.mjs";
import {
  parseActivationResponse, responseMatchesFixture, validateActivationTarget, validateFixtureSet,
} from "./eval/activation-eval-contract.mjs";
import gsdContextExtension, { CAPSULE_TEMPLATE } from "../extensions/gsd-context.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(ROOT, "skills");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
function parseAgentFrontmatter(content, label) {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) throw new Error(`${label}: missing frontmatter`);
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) throw new Error(`${label}: unterminated frontmatter`);
  const sourceLines = normalized.slice(4, end).split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => ({ indent: line.length - line.trimStart().length, text: line.trim() }));
  const scalar = (value) => {
    if (value === "") return {};
    if (value === "true") return true;
    if (value === "false") return false;
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
    if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
    return value;
  };
  const parseBlock = (start, indent) => {
    const isList = sourceLines[start]?.indent === indent && sourceLines[start].text.startsWith("- ");
    const result = isList ? [] : {};
    let index = start;
    while (index < sourceLines.length && sourceLines[index].indent === indent) {
      const { text } = sourceLines[index];
      if (isList) {
        if (!text.startsWith("- ")) break;
        result.push(scalar(text.slice(2).trim()));
        index++;
        continue;
      }
      const match = text.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s+(.*))?$/);
      if (!match) throw new Error(`${label}: malformed frontmatter line "${text}"`);
      const [, key, rawValue = ""] = match;
      if (Object.prototype.hasOwnProperty.call(result, key)) throw new Error(`${label}: duplicate ${key}`);
      if (rawValue !== "") {
        result[key] = scalar(rawValue);
        index++;
        continue;
      }
      if (sourceLines[index + 1]?.indent > indent) {
        [result[key], index] = parseBlock(index + 1, sourceLines[index + 1].indent);
      } else {
        result[key] = {};
        index++;
      }
    }
    return [result, index];
  };
  const [frontmatter, next] = parseBlock(0, sourceLines[0]?.indent ?? 0);
  assert.equal(next, sourceLines.length, `${label}: unparsed frontmatter`);
  return frontmatter;
}
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
  "plan.md": "# Plan\n## Feature\n`canonical-fixture`\n## Base\n`main`\n## Summary\nValidate Markdown plan.\n## Context\nA tracked inline fixture.\n## Scope\n- Validate plan\n## Acceptance Criteria\n### AC-1: Plan parses\n- **State:** active\n- **Outcome:** A valid plan becomes an execution contract.\n- **Action:** Parse the approved Markdown plan.\n- **Expected:** Return the matching feature and acceptance criterion.\n## Decisions\nNone.\n## Invariants\n- **I-1:** Approved source bytes remain immutable.\n## Non-goals\n- **NG-1:** Runtime TOON is not edited by the parser.\n## Interfaces\n| Criterion | Seam | Path | Lower-seam reason |\n| --- | --- | --- | --- |\n| AC-1 | parser | `test/skills.test.js` | none |\n## Publication\nnull\n## Tasks\n### T1: Parse plan\n- **Satisfies:** AC-1\n- **Files:** `test/skills.test.js`\n- **Test:** `node --test test/skills.test.js`\n- **Status:** pending\n",
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
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("**State:** active", "**State:** draft") }), /invalid state/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Action:** Parse the approved Markdown plan.\n- **Expected:** Return the matching feature and acceptance criterion.", "- **Expected:** Return the matching feature and acceptance criterion.\n- **Action:** Parse the approved Markdown plan.") }), /fields must be exactly ordered/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("**Satisfies:** AC-1", "**Satisfies:** AC-1, AC-1") }), /exactly once/);
  assert.throws(() => verifyApprovedSources({ ...files, "plan.md": files["plan.md"].replace("Parse plan", "Parse bound plan") }, binding), /hash mismatch/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("**Outcome:** A valid plan becomes an execution contract.", "**Outcome:** success") }), /outcome, action, and expected/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replaceAll("\n", "\r\n") }), /LF line endings/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": `\n${files["plan.md"]}` }), /leading or trailing blank lines/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": `${files["plan.md"]} \t\n` }), /leading or trailing blank lines/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": `${files["plan.md"]} \t` }), /leading or trailing blank lines/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("# Plan", "# Wrong") }), /top-level heading/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("## Summary\nValidate Markdown plan.", "## Summary\n") }), /Summary section must not be empty or blank/);
  assert.throws(() => parseMarkdownPacket({ ...files, "proposal.md": "" }), /legacy multi-file state/);
  assert.throws(() => parseMarkdownPacket({ ...files, "spec.md": "" }), /legacy multi-file state/);
  assert.throws(() => parseMarkdownPacket({ ...files, "design.md": "" }), /legacy multi-file state/);
  assert.doesNotThrow(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("`node --test test/skills.test.js`", "`none`") }));
  // Negative parse and bindApprovedSources tests for Feature extra line, unbackticked Base, prose Scope, and extra source key
  const featureExtraLinePlan = files["plan.md"].replace("## Feature\n`canonical-fixture`", "## Feature\n`canonical-fixture`\nextra line");
  assert.throws(() => parseMarkdownPacket({ "plan.md": featureExtraLinePlan }), /Feature must be/);
  assert.throws(() => bindApprovedSources({ "plan.md": featureExtraLinePlan }), /Feature must be/);

  const unbacktickedBasePlan = files["plan.md"].replace("## Base\n`main`", "## Base\nmain");
  assert.throws(() => parseMarkdownPacket({ "plan.md": unbacktickedBasePlan }), /Base must be/);
  assert.throws(() => bindApprovedSources({ "plan.md": unbacktickedBasePlan }), /Base must be/);

  const proseScopePlan = files["plan.md"].replace("## Scope\n- Validate plan", "## Scope\nValidate plan");
  assert.throws(() => parseMarkdownPacket({ "plan.md": proseScopePlan }), /Scope line 1 must be a bullet point/);
  assert.throws(() => bindApprovedSources({ "plan.md": proseScopePlan }), /Scope line 1 must be a bullet point/);

  assert.throws(() => parseMarkdownPacket({ ...files, "extra.md": "# Extra" }), /files mapping must contain exactly plan.md/);
  assert.throws(() => bindApprovedSources({ ...files, "extra.md": "# Extra" }), /files mapping must contain exactly plan.md/);
  
  const publishedPlan = files["plan.md"]
    .replace("## Publication\nnull", "## Publication\n`docs/gsd/canonical-fixture/milestones.md`")
    .replace("- **Files:** `test/skills.test.js`", "- **Files:** `test/skills.test.js`, `docs/gsd/canonical-fixture/milestones.md`");
  assert.doesNotThrow(() => parseMarkdownPacket({ "plan.md": publishedPlan }));
  
  const invalidPubPlan = files["plan.md"]
    .replace("## Publication\nnull", "## Publication\n`docs/gsd/canonical-fixture/" + ["milestones", ".toon"].join("") + "`")
    .replace("- **Files:** `test/skills.test.js`", "- **Files:** `test/skills.test.js`, `docs/gsd/canonical-fixture/" + ["milestones", ".toon"].join("") + "`");
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": invalidPubPlan }),
    /Publication must be null or the canonical Markdown ledger path/,
  );

  // focused Publication cases: null+ledger, wrong feature, no owner, duplicate non-superseded owners, superseded-only owner, and valid exact owner
  // 1. null+ledger
  const nullPlusLedgerPlan = files["plan.md"]
    .replace("- **Files:** `test/skills.test.js`", "- **Files:** `test/skills.test.js`, `docs/gsd/canonical-fixture/milestones.md`");
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": nullPlusLedgerPlan }),
    /unowned or mismatched milestone ledger path/
  );

  // 2. wrong feature
  const wrongFeaturePlan = files["plan.md"]
    .replace("## Publication\nnull", "## Publication\n`docs/gsd/wrong-feature/milestones.md`")
    .replace("- **Files:** `test/skills.test.js`", "- **Files:** `test/skills.test.js`, `docs/gsd/wrong-feature/milestones.md`");
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": wrongFeaturePlan }),
    /Publication must be null or the canonical Markdown ledger path/
  );

  // 3. no owner
  const noOwnerPlan = files["plan.md"]
    .replace("## Publication\nnull", "## Publication\n`docs/gsd/canonical-fixture/milestones.md`");
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": noOwnerPlan }),
    /non-null publication path must occur exactly once/
  );

  // 4. duplicate non-superseded owners
  const duplicateOwnersPlan = files["plan.md"]
    .replace("## Publication\nnull", "## Publication\n`docs/gsd/canonical-fixture/milestones.md`")
    .replace(
      "### AC-1: Plan parses\n- **State:** active\n- **Outcome:** A valid plan becomes an execution contract.\n- **Action:** Parse the approved Markdown plan.\n- **Expected:** Return the matching feature and acceptance criterion.",
      "### AC-1: Plan parses\n- **State:** active\n- **Outcome:** A valid plan becomes an execution contract.\n- **Action:** Parse the approved Markdown plan.\n- **Expected:** Return the matching feature and acceptance criterion.\n### AC-2: Another\n- **State:** active\n- **Outcome:** outcome.\n- **Action:** act.\n- **Expected:** expect."
    )
    .replace(
      "| AC-1 | parser | `test/skills.test.js` | none |",
      "| AC-1 | parser | `test/skills.test.js` | none |\n| AC-2 | parser | `test/skills.test.js` | none |"
    )
    .replace(
      "### T1: Parse plan\n- **Satisfies:** AC-1\n- **Files:** `test/skills.test.js`\n- **Test:** `node --test test/skills.test.js`\n- **Status:** pending",
      "### T1: Parse plan\n- **Satisfies:** AC-1\n- **Files:** `test/skills.test.js`, `docs/gsd/canonical-fixture/milestones.md`\n- **Test:** `node --test test/skills.test.js`\n- **Status:** pending\n### T2: Another task\n- **Satisfies:** AC-2\n- **Files:** `test/skills.test.js`, `docs/gsd/canonical-fixture/milestones.md`\n- **Test:** `node --test test/skills.test.js`\n- **Status:** pending"
    );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": duplicateOwnersPlan }),
    /non-null publication path must occur exactly once/
  );

  // 5. superseded-only owner
  const supersededOnlyOwnerPlan = files["plan.md"]
    .replace("## Publication\nnull", "## Publication\n`docs/gsd/canonical-fixture/milestones.md`")
    .replace(
      "### T1: Parse plan\n- **Satisfies:** AC-1\n- **Files:** `test/skills.test.js`\n- **Test:** `node --test test/skills.test.js`\n- **Status:** pending",
      "### T1: Parse plan\n- **Satisfies:** AC-1\n- **Files:** `test/skills.test.js`, `docs/gsd/canonical-fixture/milestones.md`\n- **Test:** `node --test test/skills.test.js`\n- **Status:** superseded\n### T2: Another task\n- **Satisfies:** AC-1\n- **Files:** `test/skills.test.js`\n- **Test:** `node --test test/skills.test.js`\n- **Status:** pending"
    );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": supersededOnlyOwnerPlan }),
    /non-null publication path must occur exactly once/
  );

  // 6. valid exact owner
  const validExactOwnerPlan = files["plan.md"]
    .replace("## Publication\nnull", "## Publication\n`docs/gsd/canonical-fixture/milestones.md`")
    .replace("- **Files:** `test/skills.test.js`", "- **Files:** `test/skills.test.js`, `docs/gsd/canonical-fixture/milestones.md`");
  assert.doesNotThrow(() => parseMarkdownPacket({ "plan.md": validExactOwnerPlan }));
  // Negative tests for Interfaces parser validations
  assert.throws(() => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("Criterion | Seam | Path | Lower-seam reason", "Criterion | Seam | Path | Lower Reason") }), /Interfaces header is invalid/);
  assert.throws(() => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("--- | --- | --- | ---", "--- | --- | --- | --") }), /Interfaces separator is invalid/);
  assert.throws(() => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "AC-1 | parser | `test/skills.test.js` | none |") }), /must start and end with/);
  assert.throws(() => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1 | parser | `test/skills.test.js` | none | extra |") }), /must have exactly 4 columns/);
  assert.throws(() => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("| --- | --- | --- | --- |", "| --- | --- | --- | --- |\n") }), /stray prose or empty line/);

  // Negative tests for multi-AC identical triples
  const multiAcDiffPins = files["plan.md"]
    .replace(
      "### AC-1: Plan parses\n- **State:** active\n- **Outcome:** A valid plan becomes an execution contract.\n- **Action:** Parse the approved Markdown plan.\n- **Expected:** Return the matching feature and acceptance criterion.",
      "### AC-1: Plan parses\n- **State:** active\n- **Outcome:** A valid plan becomes an execution contract.\n- **Action:** Parse the approved Markdown plan.\n- **Expected:** Return the matching feature and acceptance criterion.\n### AC-2: Another\n- **State:** active\n- **Outcome:** another outcome.\n- **Action:** check.\n- **Expected:** pass."
    )
    .replace(
      "| AC-1 | parser | `test/skills.test.js` | none |",
      "| AC-1 | parser | `test/skills.test.js` | none |\n| AC-2 | parser | `test/skills.test.js` | diff |"
    )
    .replace(
      "- **Satisfies:** AC-1",
      "- **Satisfies:** AC-1, AC-2"
    );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": multiAcDiffPins }),
    /Task T1 satisfies multiple ACs but their interface pins/
  );

  // Negative tests for Tasks comma-separated backticked files format
  assert.throws(() => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("- **Files:** `test/skills.test.js`", "- **Files:** `test/skills.test.js`, unbackticked") }), /Files must be comma-separated/);

  // Task Files path validator tests
  // 1. absolute
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("- **Files:** `test/skills.test.js`", "- **Files:** `/absolute/path.js`") }),
    /must be repository-relative/
  );
  // 2. backslash
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("- **Files:** `test/skills.test.js`", "- **Files:** `some\\\\path.js`") }),
    /contains backslash/
  );
  // 3. empty segment
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("- **Files:** `test/skills.test.js`", "- **Files:** `some//path.js`") }),
    /contains empty segment/
  );
  // 4. dot/traversal
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("- **Files:** `test/skills.test.js`", "- **Files:** `some/../path.js`") }),
    /contains dot\/traversal/
  );
  // 5. .scratch
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("- **Files:** `test/skills.test.js`", "- **Files:** `.scratch/path.js`") }),
    /contains \.scratch/
  );
  // 6. runtime TOON path
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("- **Files:** `test/skills.test.js`", "- **Files:** `some/handoff-1.toon`") }),
    /contains runtime TOON path/
  );

  // Interface Path validator tests
  // 1. absolute
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1 | parser | `/absolute/path.js` | none |") }),
    /must be repository-relative/
  );
  // 2. backslash
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1 | parser | `some\\\\path.js` | none |") }),
    /contains backslash/
  );
  // 3. empty segment
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1 | parser | `some//path.js` | none |") }),
    /contains empty segment/
  );
  // 4. dot/traversal
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1 | parser | `some/../path.js` | none |") }),
    /contains dot\/traversal/
  );
  // 5. .scratch
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1 | parser | `.scratch/path.js` | none |") }),
    /contains \.scratch/
  );
  // 6. runtime TOON path
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1 | parser | `some/handoff-1.toon` | none |") }),
    /contains runtime TOON path/
  );
  
  // Negative tests for Tasks Test command backticked format
  assert.throws(() => parseMarkdownPacket({ "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:** node --test test/skills.test.js") }), /Test must be one fully backticked/);

  // Decisions assertions
  // 1. returns explicit empty for None.
  assert.deepEqual(parsed.decisions, []);

  // 2. returns ordered multiple Decisions deeply
  const multipleDecisionsPlan = files["plan.md"].replace(
    "## Decisions\nNone.",
    "## Decisions\n### D-1: First Decision\n- **Decision:** Do X\n- **Rationale:** Because Y\n### D-2: Second Decision\n- **Decision:** Do A\n- **Rationale:** Because B"
  );
  const parsedMultiple = parseMarkdownPacket({ "plan.md": multipleDecisionsPlan });
  assert.deepEqual(parsedMultiple.decisions, [
    { id: "D-1", ordinal: 1, title: "First Decision", decision: "Do X", rationale: "Because Y" },
    { id: "D-2", ordinal: 2, title: "Second Decision", decision: "Do A", rationale: "Because B" }
  ]);

  // 3. rejects malformed order
  const malformedOrderDecision = files["plan.md"].replace(
    "## Decisions\nNone.",
    "## Decisions\n### D-2: First Decision\n- **Decision:** Do X\n- **Rationale:** Because Y"
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": malformedOrderDecision }),
    /decision IDs must be sequential/
  );

  // 4. rejects vague values (Decision)
  const vagueDecision = files["plan.md"].replace(
    "## Decisions\nNone.",
    "## Decisions\n### D-1: Title\n- **Decision:** TBD\n- **Rationale:** concrete"
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": vagueDecision }),
    /decision and rationale must be concrete/
  );

  // 5. rejects vague values (Rationale)
  const vagueRationaleDecision = files["plan.md"].replace(
    "## Decisions\nNone.",
    "## Decisions\n### D-1: Title\n- **Decision:** concrete\n- **Rationale:** TODO"
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": vagueRationaleDecision }),
    /decision and rationale must be concrete/
  );

  // 6. rejects blank lines inside Decisions
  const blankLineDecision = files["plan.md"].replace(
    "## Decisions\nNone.",
    "## Decisions\n### D-1: First Decision\n- **Decision:** Do X\n\n- **Rationale:** Because Y"
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": blankLineDecision }),
    /Decisions must not contain blank or whitespace lines/
  );

  // 7. rejects leading/trailing blank lines in structured sections
  // Acceptance Criteria leading blank
  const leadingBlankAC = files["plan.md"].replace(
    "## Acceptance Criteria\n### AC-1:",
    "## Acceptance Criteria\n\n### AC-1:"
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": leadingBlankAC }),
    /Acceptance Criteria section must not have leading blank/
  );

  // Acceptance Criteria trailing blank
  const trailingBlankAC = files["plan.md"].replace(
    "## Acceptance Criteria\n### AC-1: Plan parses\n- **State:** active\n- **Outcome:** A valid plan becomes an execution contract.\n- **Action:** Parse the approved Markdown plan.\n- **Expected:** Return the matching feature and acceptance criterion.\n## Decisions",
    "## Acceptance Criteria\n### AC-1: Plan parses\n- **State:** active\n- **Outcome:** A valid plan becomes an execution contract.\n- **Action:** Parse the approved Markdown plan.\n- **Expected:** Return the matching feature and acceptance criterion.\n\n## Decisions"
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": trailingBlankAC }),
    /Acceptance Criteria section must not have trailing blank/
  );

  // Decisions leading blank
  const leadingBlankD = files["plan.md"].replace(
    "## Decisions\nNone.",
    "## Decisions\n\nNone."
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": leadingBlankD }),
    /Decisions section must not have leading blank/
  );

  // Decisions trailing blank
  const trailingBlankD = files["plan.md"].replace(
    "## Decisions\nNone.",
    "## Decisions\nNone.\n"
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": trailingBlankD }),
    /Decisions section must not have trailing blank/
  );

  // Decisions padded None. forms
  assert.throws(
    () => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("## Decisions\nNone.", "## Decisions\nNone. ") }),
    /Decisions section must not have trailing blank/
  );
  assert.throws(
    () => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("## Decisions\nNone.", "## Decisions\n None.") }),
    /Decisions section must not have leading blank/
  );
  assert.throws(
    () => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("## Decisions\nNone.", "## Decisions\n None. ") }),
    /Decisions section must not have leading blank/
  );
  assert.throws(
    () => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("## Decisions\nNone.\n## Invariants", "## Decisions\nNone.\n \n## Invariants") }),
    /Decisions section must not have trailing blank or whitespace-only lines/
  );

  // Invariants leading blank
  const leadingBlankI = files["plan.md"].replace(
    "## Invariants\n- **I-1:",
    "## Invariants\n\n- **I-1:"
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": leadingBlankI }),
    /Invariants section must not have leading blank/
  );

  // Invariants trailing blank
  const trailingBlankI = files["plan.md"].replace(
    "## Invariants\n- **I-1:** Approved source bytes remain immutable.\n## Non-goals",
    "## Invariants\n- **I-1:** Approved source bytes remain immutable.\n\n## Non-goals"
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": trailingBlankI }),
    /Invariants section must not have trailing blank/
  );

  // Non-goals leading blank
  const leadingBlankNG = files["plan.md"].replace(
    "## Non-goals\n- **NG-1:",
    "## Non-goals\n\n- **NG-1:"
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": leadingBlankNG }),
    /Non-goals section must not have leading blank/
  );

  // Non-goals trailing blank
  const trailingBlankNG = files["plan.md"].replace(
    "## Non-goals\n- **NG-1:** Runtime TOON is not edited by the parser.\n## Interfaces",
    "## Non-goals\n- **NG-1:** Runtime TOON is not edited by the parser.\n\n## Interfaces"
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": trailingBlankNG }),
    /Non-goals section must not have trailing blank/
  );

  // Tasks leading blank
  const leadingBlankT = files["plan.md"].replace(
    "## Tasks\n### T1:",
    "## Tasks\n\n### T1:"
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": leadingBlankT }),
    /Tasks section must not have leading blank/
  );

  // Tasks trailing blank
  const trailingBlankT = files["plan.md"] + "\n";
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": trailingBlankT }),
    /plan\.md must not have leading or trailing blank lines/
  );

  // Directly test validateSectionEdges for Tasks trailing blank
  assert.throws(
    () => validateSectionEdges("### T1: Parse plan\n- **Satisfies:** AC-1\n- **Files:** `test/skills.test.js`\n- **Test:** `node --test test/skills.test.js`\n- **Status:** pending\n\n", "Tasks"),
    /Tasks section must not have trailing blank/
  );

  // Focused negatives for scalar/table leading/trailing whitespace lines in all other sections:
  // Feature leading blank
  const leadingBlankFeature = files["plan.md"].replace("## Feature\n`canonical-fixture`", "## Feature\n\n`canonical-fixture`");
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": leadingBlankFeature }), /Feature section must not have leading blank/);
  // Feature trailing blank
  const trailingBlankFeature = files["plan.md"].replace("## Feature\n`canonical-fixture`\n## Base", "## Feature\n`canonical-fixture`\n\n## Base");
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": trailingBlankFeature }), /Feature section must not have trailing blank/);

  // Base leading blank
  const leadingBlankBase = files["plan.md"].replace("## Base\n`main`", "## Base\n\n`main`");
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": leadingBlankBase }), /Base section must not have leading blank/);
  // Base trailing blank
  const trailingBlankBase = files["plan.md"].replace("## Base\n`main`\n## Summary", "## Base\n`main`\n\n## Summary");
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": trailingBlankBase }), /Base section must not have trailing blank/);

  // Summary leading blank
  const leadingBlankSummary = files["plan.md"].replace("## Summary\nValidate", "## Summary\n\nValidate");
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": leadingBlankSummary }), /Summary section must not have leading blank/);
  // Summary trailing blank
  const trailingBlankSummary = files["plan.md"].replace("Validate Markdown plan.\n## Context", "Validate Markdown plan.\n\n## Context");
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": trailingBlankSummary }), /Summary section must not have trailing blank/);

  // Context leading blank
  const leadingBlankContext = files["plan.md"].replace("## Context\nA", "## Context\n\nA");
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": leadingBlankContext }), /Context section must not have leading blank/);
  // Context trailing blank
  const trailingBlankContext = files["plan.md"].replace("A tracked inline fixture.\n## Scope", "A tracked inline fixture.\n\n## Scope");
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": trailingBlankContext }), /Context section must not have trailing blank/);

  // Scope leading blank
  const leadingBlankScope = files["plan.md"].replace("## Scope\n-", "## Scope\n\n-");
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": leadingBlankScope }), /Scope section must not have leading blank/);
  // Scope trailing blank
  const trailingBlankScope = files["plan.md"].replace("- Validate plan\n## Acceptance Criteria", "- Validate plan\n\n## Acceptance Criteria");
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": trailingBlankScope }), /Scope section must not have trailing blank/);

  // Interfaces leading blank
  const leadingBlankInterfaces = files["plan.md"].replace("## Interfaces\n|", "## Interfaces\n\n|");
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": leadingBlankInterfaces }), /Interfaces section must not have leading blank/);
  // Interfaces trailing blank
  const trailingBlankInterfaces = files["plan.md"].replace("none |\n## Publication", "none |\n\n## Publication");
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": trailingBlankInterfaces }), /Interfaces section must not have trailing blank/);

  // Publication leading blank
  const leadingBlankPub = files["plan.md"].replace("## Publication\nnull", "## Publication\n\nnull");
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": leadingBlankPub }), /Publication section must not have leading blank/);
  // Publication trailing blank
  const trailingBlankPub = files["plan.md"].replace("## Publication\nnull\n## Tasks", "## Publication\nnull\n\n## Tasks");
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": trailingBlankPub }), /Publication section must not have trailing blank/);

  // Vague backticked Test values
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:** `todo`") }), /Test must not be vague/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:** `TBD`") }), /Test must not be vague/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:** `run tests`") }), /Test must not be vague/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:** `works correctly`") }), /Test must not be vague/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:** `valid`") }), /Test must not be vague/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:** `covered`") }), /Test must not be vague/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:** `success`") }), /Test must not be vague/);

  // Whitespace-only, leading/trailing space, and padded vague Test commands
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:** ` `") }), /Test must be one fully backticked/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:** `   `") }), /Test must be one fully backticked/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:** ` node --test test/skills.test.js`") }), /Test must be one fully backticked/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:** `node --test test/skills.test.js `") }), /Test must be one fully backticked/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:** ` run tests `") }), /Test must be one fully backticked/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:** ` todo`") }), /Test must be one fully backticked/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:** `TBD `") }), /Test must be one fully backticked/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:** none") }), /Test must be one fully backticked/);
  // Extra outer space negatives for Test and other fields
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:**  `node --test test/skills.test.js`") }), /Test must not have leading or trailing whitespace/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:** `node --test test/skills.test.js` ") }), /Test must not have leading or trailing whitespace/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Test:** `node --test test/skills.test.js`", "- **Test:**  `node --test test/skills.test.js` ") }), /Test must not have leading or trailing whitespace/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **State:** active", "- **State:**  active") }), /State must not have leading or trailing whitespace/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **State:** active", "- **State:** active ") }), /State must not have leading or trailing whitespace/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Status:** pending", "- **Status:**  pending") }), /Status must not have leading or trailing whitespace/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Status:** pending", "- **Status:** pending \n### T2: Another task\n- **Satisfies:** AC-1\n- **Files:** `test/skills.test.js`\n- **Test:** `node --test test/skills.test.js`\n- **Status:** superseded") }), /Status must not have leading or trailing whitespace/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **I-1:** Approved source bytes remain immutable.", "- **I-1:**  Approved source bytes remain immutable.") }), /text must not have leading or trailing whitespace/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **I-1:** Approved source bytes remain immutable.", "- **I-1:** Approved source bytes remain immutable. \n- **I-2:** Second invariant.") }), /text must not have leading or trailing whitespace/);
  // Retain the AC-10 multi-path Interfaces case
  const multiPathInterfacesPlan = files["plan.md"]
    .replace(
      "| AC-1 | parser | `test/skills.test.js` | none |",
      "| AC-1 | parser | `test/skills.test.js`, `test/another.test.js` | none |"
    );
  assert.doesNotThrow(() => parseMarkdownPacket({ "plan.md": multiPathInterfacesPlan }));

  // 8. rejects malformed Invariants and Non-goals lists
  // Invariants skipped ID
  const skippedI = files["plan.md"].replace(
    "- **I-1:** Approved source bytes remain immutable.",
    "- **I-2:** Approved source bytes remain immutable."
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": skippedI }),
    /Invariants IDs must equal I-1 through I-N in order/
  );

  // Invariants reordered ID
  const reorderedI = files["plan.md"].replace(
    "- **I-1:** Approved source bytes remain immutable.",
    "- **I-2:** Approved source bytes remain immutable.\n- **I-1:** Second invariant."
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": reorderedI }),
    /Invariants IDs must equal I-1 through I-N in order/
  );

  // Invariants duplicate ID
  const duplicateI = files["plan.md"].replace(
    "- **I-1:** Approved source bytes remain immutable.",
    "- **I-1:** Approved source bytes remain immutable.\n- **I-1:** Approved source bytes."
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": duplicateI }),
    /Invariants IDs must equal I-1 through I-N in order/
  );

  // Invariants prose line
  const proseI = files["plan.md"].replace(
    "- **I-1:** Approved source bytes remain immutable.",
    "- **I-1:** Approved source bytes remain immutable.\nSome stray prose text."
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": proseI }),
    /Invariants line 2 does not match the canonical format/
  );

  // Invariants blank rows inside
  const blankRowI = files["plan.md"].replace(
    "- **I-1:** Approved source bytes remain immutable.",
    "- **I-1:** Approved source bytes remain immutable.\n\n- **I-2:** Second invariant."
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": blankRowI }),
    /Invariants line 2 does not match the canonical format/
  );

  // Invariants vague text
  const vagueTextI = files["plan.md"].replace(
    "- **I-1:** Approved source bytes remain immutable.",
    "- **I-1:** TBD"
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": vagueTextI }),
    /I-1 text must not be vague/
  );

  // Non-goals skipped ID
  const skippedNG = files["plan.md"].replace(
    "- **NG-1:** Runtime TOON is not edited by the parser.",
    "- **NG-2:** Runtime TOON is not edited by the parser."
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": skippedNG }),
    /Non-goals IDs must equal NG-1 through NG-N in order/
  );

  // Non-goals reordered ID
  const reorderedNG = files["plan.md"].replace(
    "- **NG-1:** Runtime TOON is not edited by the parser.",
    "- **NG-2:** Runtime TOON is not edited by the parser.\n- **NG-1:** Second non-goal."
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": reorderedNG }),
    /Non-goals IDs must equal NG-1 through NG-N in order/
  );

  // Non-goals duplicate ID
  const duplicateNG = files["plan.md"].replace(
    "- **NG-1:** Runtime TOON is not edited by the parser.",
    "- **NG-1:** Runtime TOON is not edited by the parser.\n- **NG-1:** Runtime TOON."
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": duplicateNG }),
    /Non-goals IDs must equal NG-1 through NG-N in order/
  );

  // Non-goals prose line
  const proseNG = files["plan.md"].replace(
    "- **NG-1:** Runtime TOON is not edited by the parser.",
    "- **NG-1:** Runtime TOON is not edited by the parser.\nSome stray prose text."
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": proseNG }),
    /Non-goals line 2 does not match the canonical format/
  );

  // Non-goals blank rows inside
  const blankRowNG = files["plan.md"].replace(
    "- **NG-1:** Runtime TOON is not edited by the parser.",
    "- **NG-1:** Runtime TOON is not edited by the parser.\n\n- **NG-2:** Second non-goal."
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": blankRowNG }),
    /Non-goals line 2 does not match the canonical format/
  );

  // Non-goals vague text
  const vagueTextNG = files["plan.md"].replace(
    "- **NG-1:** Runtime TOON is not edited by the parser.",
    "- **NG-1:** success"
  );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": vagueTextNG }),
    /NG-1 text must not be vague/
  );

  // Scalar padding negatives
  // Feature leading space
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("## Feature\n`canonical-fixture`", "## Feature\n `canonical-fixture`") }), /Feature section must not have leading blank/);
  // Feature trailing space
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("## Feature\n`canonical-fixture`", "## Feature\n`canonical-fixture` ") }), /Feature section must not have trailing blank/);

  // Base leading space
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("## Base\n`main`", "## Base\n `main`") }), /Base section must not have leading blank/);
  // Base trailing space
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("## Base\n`main`", "## Base\n`main` ") }), /Base section must not have trailing blank/);

  // Summary leading space
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("## Summary\nValidate", "## Summary\n Validate") }), /Summary section must not have leading blank/);
  // Summary trailing space
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("Validate Markdown plan.", "Validate Markdown plan. ") }), /Summary section must not have trailing blank/);

  // Context leading space
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("## Context\nA", "## Context\n A") }), /Context section must not have leading blank/);
  // Context trailing space
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("A tracked inline fixture.", "A tracked inline fixture. ") }), /Context section must not have trailing blank/);

  // Scope leading space
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("## Scope\n-", "## Scope\n -") }), /Scope section must not have leading blank/);
  // Scope trailing space
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- Validate plan", "- Validate plan ") }), /Scope section must not have trailing blank/);

  // Publication leading space
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("## Publication\nnull", "## Publication\n null") }), /Publication section must not have leading blank/);
  // Publication trailing space
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("## Publication\nnull", "## Publication\nnull ") }), /Publication section must not have trailing blank/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("## Publication\nnull", "## Publication\n`docs/gsd/canonical-fixture/milestones.md` ") }), /Publication section must not have trailing blank/);

  // Interfaces row leading space
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", " | AC-1 | parser | `test/skills.test.js` | none |") }), /must start and end with/);
  // Interfaces row trailing space
  const addAc2 = (content) => {
    return content
      .replace(
        "- **Expected:** Return the matching feature and acceptance criterion.",
        "- **Expected:** Return the matching feature and acceptance criterion.\n### AC-2: Second criterion\n- **State:** active\n- **Outcome:** outcome.\n- **Action:** action.\n- **Expected:** expected."
      )
      .replace(
        "- **Status:** pending",
        "- **Status:** pending\n### T2: Task 2\n- **Satisfies:** AC-2\n- **Files:** `test/skills.test.js`\n- **Test:** `node --test test/skills.test.js`\n- **Status:** pending"
      );
  };
  const twoAcPlan = addAc2(files["plan.md"]);
  assert.throws(
    () => parseMarkdownPacket({
      ...files,
      "plan.md": twoAcPlan.replace(
        "| AC-1 | parser | `test/skills.test.js` | none |",
        "| AC-1 | parser | `test/skills.test.js` | none | \n| AC-2 | parser | `test/skills.test.js` | none |"
      )
    }),
    /must start and end with/
  );

  // Interfaces cell Criterion padding (leading space after pipe)
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "|  AC-1 | parser | `test/skills.test.js` | none |") }), /must start and end with a single space/);
  // Interfaces cell Criterion padding (trailing space before pipe)
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1  | parser | `test/skills.test.js` | none |") }), /must start and end with a single space/);

  // Interfaces cell Seam padding
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1 |  parser | `test/skills.test.js` | none |") }), /must start and end with a single space/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1 | parser  | `test/skills.test.js` | none |") }), /must start and end with a single space/);

  // Interfaces cell Path padding
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1 | parser |  `test/skills.test.js` | none |") }), /must start and end with a single space/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1 | parser | `test/skills.test.js`  | none |") }), /must start and end with a single space/);

  // Interfaces cell Lower-seam reason padding
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1 | parser | `test/skills.test.js` |  none |") }), /must start and end with a single space/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1 | parser | `test/skills.test.js` | none  |") }), /must start and end with a single space/);

  // Interfaces backticked captures padding inside backticks (Criterion)
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| ` AC-1` | parser | `test/skills.test.js` | none |") }), /capture must not have leading or trailing whitespace/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| `AC-1 ` | parser | `test/skills.test.js` | none |") }), /capture must not have leading or trailing whitespace/);

  // Interfaces backticked captures padding inside backticks (Seam)
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1 | ` parser` | `test/skills.test.js` | none |") }), /capture must not have leading or trailing whitespace/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1 | `parser ` | `test/skills.test.js` | none |") }), /capture must not have leading or trailing whitespace/);

  // Path lists padding inside backticks
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1 | parser | ` test/skills.test.js` | none |") }), /path has leading or trailing whitespace/);
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| AC-1 | parser | `test/skills.test.js ` | none |") }), /path has leading or trailing whitespace/);

  // Criterion multiple backticks
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("| AC-1 | parser | `test/skills.test.js` | none |", "| `AC-1``extra` | parser | `test/skills.test.js` | none |") }), /has multiple backticks/);

  // Multi-path AC-10 coverage
  const replaceSection = (content, heading, newBody) => {
    const regex = new RegExp(`(## ${heading}\\n)([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m");
    return content.replace(regex, `$1${newBody}\n`);
  };

  let acBlocks = "";
  for (let i = 1; i <= 10; i++) {
    acBlocks += `### AC-${i}: Criterion ${i}\n- **State:** active\n- **Outcome:** outcome ${i}\n- **Action:** action ${i}\n- **Expected:** expected ${i}\n`;
  }
  acBlocks = acBlocks.trim();
  let interfaceRows = "| Criterion | Seam | Path | Lower-seam reason |\n| --- | --- | --- | --- |\n";
  for (let i = 1; i <= 10; i++) {
    if (i === 10) {
      interfaceRows += `| AC-10 | parser | \`test/skills.test.js\`, \`test/another.test.js\` | none |\n`;
    } else {
      interfaceRows += `| AC-${i} | parser | \`test/skills.test.js\` | none |\n`;
    }
  }
  interfaceRows = interfaceRows.trim();

  let taskBlocks = "";
  for (let i = 1; i <= 10; i++) {
    const filesList = i === 10 ? "`test/skills.test.js`, `test/another.test.js`" : "`test/skills.test.js`";
    taskBlocks += `### T${i}: Task ${i}\n- **Satisfies:** AC-${i}\n- **Files:** ${filesList}\n- **Test:** \`node --test test/skills.test.js\`\n- **Status:** pending\n`;
  }
  taskBlocks = taskBlocks.trim();

  let multiAc10Plan = files["plan.md"];
  multiAc10Plan = replaceSection(multiAc10Plan, "Acceptance Criteria", acBlocks);
  multiAc10Plan = replaceSection(multiAc10Plan, "Interfaces", interfaceRows);
  multiAc10Plan = replaceSection(multiAc10Plan, "Tasks", taskBlocks);

  assert.doesNotThrow(() => parseMarkdownPacket({ ...files, "plan.md": multiAc10Plan }));
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
  assert.match(master, /gsd-to-plan` \(writes the plan/);
  assert.match(master, /stale non-authoritative state/);
  assert.match(reference, /Canonical Markdown contract/);
  assert.match(reference, /SHA-256 hash/);
  assert.match(reference, /Runtime records report progress and bind source bytes/);
  for (const skill of [planner, execution, verify, handoff, tdd]) {
    assert.match(skill, /Markdown/i);
    assert.match(skill, /hash|SHA-256|binding/i);
  }
  assert.match(execution, /never rewrite the approved Markdown plan/);
  assert.match(handoff, /atomic `?\.scratch\/<feature>\/state\.toon`?|Write atomic `\.scratch\/<feature>\/state\.toon`/i);
  assert.match(tdd, /focused test seam from the approved Markdown plan/);
  assert.match(tdd, /consume the validated task slice and relevant pinned sections/);
  assert.doesNotMatch(tdd, /proposal\.toon|spec\.toon|plan\.toon/);
  assert.doesNotMatch(reference, /TOON-only execution/i);
  assert.match(reference, /Quick-fix plan exception/);
  assert.match(master, /Quick-fix plan exception/);
  assert.match(verify, /Critical\/Important findings and red gates block/);
  assert.match(planner, /write atomic `state\.toon` with the plan path and SHA-256 hash/);
  assert.doesNotMatch(execution, /^produces: \[[^\n]*plan\.md/m);
  assert.match(execution, /ledger byte-for-byte read-only throughout the per-task loop/);
  assert.match(verify, /final milestone → delete the ledger/);
  assert.match(handoff, /executor_model|reviewer_model/);
  assert.match(handoff, /Malformed, duplicate, or invalid known values fail closed|malformed, duplicate, or invalid known values/i);
  assert.match(handoff, /Candidate discovery|discover active candidates/i);
  assert.match(planner, /fresh approval after Spec escalation supersedes older bindings/);
  assert.match(execution, /Reject numbered handoffs|never treat numbered handoffs/i);
  assert.match(handoff, /Execution resume \| `state\.toon`; `plan\.md`/);
  assert.match(reference, /Execution never depends on prompt-local memory for the approval binding/);
  assert.match(reference, /# Milestones[\s\S]*\| ID \| Slug \| Goal \| Status \|/);
  assert.match(reference, /status is exactly `pending` or `done`/);
  assert.match(master, /all-`done`, fail closed/);
  assert.match(reference, /state\.toon/);
  assert.doesNotMatch(reference, /Manual UI Review Gate/);
  assert.doesNotMatch(master, /Manual UI Review Gate/);
});

test("master and visible skills declare automatic lazy activation", () => {
  const master = read("skills/gsd/SKILL.md");
  assert.match(master, /^description: "Session bootstrap injected by the GSD OMP extension;/m);
  assert.match(master, /^hide: true$/m);
  assert.match(master, /choose exactly one primary process owner/i);
  assert.match(master, /same-session continuity/i);
  assert.match(master, /no matching skill.*ordinary direct behavior/is);
  const routeLabel = new RegExp(`\\b${"Rou" + "te"} (?:[0-6N]|meta)\\b`);
  const oldEngine = new RegExp(`Smart ${"Routi" + "ng"} Engine`);
  assert.doesNotMatch(master, routeLabel);
  assert.doesNotMatch(master, oldEngine);
  assert.match(master, /first action must be a `read` tool call/);

  const descriptions = new Set();
  const standaloneCommand = new RegExp(`(?:^|[\`"'(\\s])/${"gsd"}(?:\\s|\`|$)`, "m");
  for (const name of skillNames().filter((skillName) => skillName !== "gsd")) {
    const skill = read(`skills/${name}/SKILL.md`);
    const line = skill.match(/^description: (.+)$/m)?.[1];
    assert.ok(line, `${name} description`);
    assert.equal(line.startsWith('"') && line.endsWith('"'), true, `${name} JSON-quoted description`);
    const description = JSON.parse(line);
    assert.equal(typeof description, "string", `${name} description string`);
    assert.equal(descriptions.has(description), false, `${name} unique description`);
    descriptions.add(description);
    assert.doesNotMatch(skill, new RegExp(`${"routed"} via /${"gsd"}|${routeLabel.source}`), `${name} legacy activation`);
    assert.doesNotMatch(skill, standaloneCommand, `${name} standalone command syntax`);
  }

  assert.match(read("skills/gsd-domain-modeling/SKILL.md"), /## Scaling boundary[\s\S]*## Decision capture/);
  assert.match(read("skills/gsd-codebase-design/SKILL.md"), /## Deep vs shallow[\s\S]*## Designing for testability/);
  assert.match(read("skills/gsd-improve-codebase-architecture/SKILL.md"), /## 1\. Explore[\s\S]*## 3\. Grilling loop/);
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
  assert.match(readme, /plan\.md/);
  assert.doesNotMatch(readme, /proposal\.toon|spec\.toon|design\.toon|plan\.toon/);
});

test("T1 execution contract lifecycle and roles", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const toPlan = read("skills/gsd-to-plan/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const readme = read("README.md");
  const domain = read("docs/domain/gsd.md");

  assert.match(toPlan, /Before approval, GSD validates that concrete, available, and distinct model selectors are configured for `modelRoles\.gsdExecutor` and `modelRoles\.gsdReviewer`/);
  assert.match(toPlan, /At approval, GSD binds these validated persistent executor and reviewer models\./);
  assert.match(reference, /At approval, GSD binds the persistent executor model from `modelRoles\.gsdExecutor` and the distinct persistent reviewer model from `modelRoles\.gsdReviewer`\./);
  assert.match(domain, /### D-gsd-3: Bind persistent OMP executor and reviewer roles/);
  assert.match(toPlan, /rejects missing, unresolved, alias-only, or same-model bindings/);
  assert.match(toPlan, /keeps the current model active before execution, and never substitutes the current model for either role/);

  assert.match(execution, /The persistent executor, reviewer, or any launched OMP child agents consume the validated task slice/);
  assert.match(execution, /dispatches the persistent gsd-executor agent with the bound executor model and direct-root TDD instructions/);
  assert.match(execution, /GSD reuses its OMP agent identity \(gsd-executor/);
  assert.match(execution, /The executor may fan out task attempts concurrently through OMP child agents if and only if the complete safe fan-out gate is satisfied/);
  assert.match(execution, /If any proof of these conditions is absent, GSD must fall back to sequential task execution\./);
  assert.match(reference, /explicitly dispatch the persistent gsd-executor agent \(with the bound executor model from `modelRoles\.gsdExecutor`\)/);
  assert.doesNotMatch(execution, /Child roles \(implementer, reviewer, and fixer\)/);
  assert.doesNotMatch(execution, /dispatches one fresh task implementer/);
  assert.doesNotMatch(execution, /dispatches a fresh finding-scoped `task` fixer/);

  assert.match(verify, /dispatches the persistent gsd-reviewer agent \(reusing the same gsd-reviewer session with the bound reviewer model/);
  assert.match(execution, /Do not dispatch `gsdReviewer` per task/);
  assert.match(verify, /terminal repair continues without a fixed round count only while findings or the relevant diff demonstrably change; stop on a repeated blocking fingerprint or no relevant repair diff\./);
  assert.match(domain, /### D-gsd-4: Replace the fixed repair cap with a progress guard/);
  assert.doesNotMatch(verify, /terminal repair has at most two complete re-review\/retest rounds/);

  assert.match(handoff, /concrete, distinct executor and reviewer model selectors/);
  assert.match(handoff, /Persist only model selectors|do not persist live agent identities/i);
  assert.match(handoff, /review_round|blocking_fingerprint|progress_status/);
  assert.match(readme, /## Dual-Agent Model Roles/);
  assert.match(readme, /- `modelRoles\.gsdExecutor`:/);
  assert.match(readme, /- `modelRoles\.gsdReviewer`:/);
  assert.match(readme, /~\/\.omp\/agent\/config\.yml/);
  assert.match(readme, /\.omp\/config\.yml/);
  assert.match(readme, /never falls back to built-in `modelRoles\.task` or `modelRoles\.advisor`/);
  assert.match(domain, /### D-gsd-5: Recreate process-local agents from bound models/);

  const executorFrontmatter = parseAgentFrontmatter(read("agents/gsd-executor.md"), "gsd-executor");
  const reviewerFrontmatter = parseAgentFrontmatter(read("agents/gsd-reviewer.md"), "gsd-reviewer");
  assert.deepEqual(
    {
      name: executorFrontmatter.name,
      model: executorFrontmatter.model,
      spawns: executorFrontmatter.spawns,
    },
    { name: "gsd-executor", model: "@gsdExecutor", spawns: "*" },
  );
  assert.equal(executorFrontmatter.spawn_policy, undefined);
  assert.equal(executorFrontmatter.subagents, undefined);
  assert.deepEqual(
    {
      name: reviewerFrontmatter.name,
      model: reviewerFrontmatter.model,
      tools: reviewerFrontmatter.tools,
    },
    {
      name: "gsd-reviewer",
      model: "@gsdReviewer",
      tools: ["read", "grep", "glob", "bash"],
    },
  );
  assert.equal(reviewerFrontmatter.output_schema, undefined);
  assert.deepEqual(reviewerFrontmatter.output.properties.verdict.enum, ["PASS", "BLOCKED"]);
  assert.equal(reviewerFrontmatter.output.properties.findings, undefined);
  assert.deepEqual(
    Object.keys(reviewerFrontmatter.output.optionalProperties),
    ["findings"],
  );
  assert.deepEqual(
    Object.keys(reviewerFrontmatter.output.optionalProperties.findings.elements.properties),
    ["severity", "file", "description"],
  );
  assert.match(execution, /dispatches the persistent gsd-executor agent/);
  assert.doesNotMatch(execution, /dispatches the persistent gsd-reviewer agent \(reusing the same gsd-reviewer session with the bound reviewer model from `modelRoles\.gsdReviewer`\) against the task diff/);
  assert.match(verify, /dispatches the persistent gsd-reviewer agent/);
  assert.match(readme, /Global configuration \(`~\/\.omp\/agent\/config\.yml`\):[\s\S]*modelRoles:\n\s+gsdExecutor:\s+"[^"]+"\n\s+gsdReviewer:\s+"[^"]+"/);
  assert.match(readme, /Project-local override \(`\.omp\/config\.yml`\):[\s\S]*modelRoles:\n\s+gsdExecutor:\s+"[^"]+"\n\s+gsdReviewer:\s+"[^"]+"/);
  assert.doesNotMatch(reference, /bound advisor model/);
  assert.doesNotMatch(execution, /bound advisor model/);
  assert.doesNotMatch(verify, /bound advisor model/);
  assert.match(execution, /If the independent reviewer capability or model configuration is unavailable, GSD must fail closed immediately\./);
  assert.match(reference, /If the independent reviewer capability or model configuration is unavailable, GSD must fail closed immediately\./);
  assert.match(verify, /If the independent reviewer capability or model configuration is unavailable, GSD must fail closed immediately\./);

  assert.match(execution, /Instead of repeated full validation, follow the approved phase-boundary semantic-validation and digest-guard model\./);
  assert.match(execution, /without independently reparsing `plan\.md`/);
  assert.match(execution, /Every observable task loads `gsd-tdd` and follows direct-root TDD: RED before implementation, GREEN after implementation, then refactor after green/);
  assert.match(execution, /Task acceptance deferral is removed; the terminal verifier solely owns acceptance\/E2E\./);
  assert.match(execution, /Repeat this full parse and binding check only at execution entry\/resume\./);
  assert.match(execution, /Do not compare plan digest at ordinary task dispatch/);
  assert.match(execution, /After any repair, the gsd-executor agent reruns only focused checks invalidated by its repair, records replacement green evidence for each invalidated check, and reports replacement green evidence to the parent for an executor-only focused-check decision\./);
  assert.match(execution, /Any legacy `proposal\.md`, `spec\.md`, or `design\.md` is rejected\./);
  assert.match(execution, /Missing, invalid, altered, or additional `plan\.md` is a Spec escalation\./);
  assert.match(execution, /never rewrite the approved Markdown plan\./);
  assert.match(execution, /The parent retains task order, Git commits, state checkpoints, and terminal transition\./);
});

test("T2 state.toon contract and skill derivation", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const master = read("skills/gsd/SKILL.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const toPlan = read("skills/gsd-to-plan/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");

  assert.match(reference, /## Runtime state contract/);
  assert.match(reference, /Resumable State Snapshot/);
  assert.match(reference, /schema:v1/);
  assert.match(reference, /phase:draft\|approved\|executing\|paused\|verifying\|repair\|merged-cleanup-pending\|completed-retained/);
  assert.match(reference, /checkpoint_revision/);
  assert.match(reference, /cleanup_preference:none\|delete\|retain\|archive-and-delete/);
  assert.match(reference, /legacy key rejected|Reject every legacy key|including `mode`, `manual_ui_review`/i);
  assert.match(reference, /Atomic write/);
  assert.match(reference, /atomically renames it over `state\.toon`/);
  assert.match(reference, /No dispatch occurs from unvalidated or partially written/);
  assert.match(reference, /Skill derivation from phase and next_action/);
  assert.match(reference, /`start\/continue task`[\s\S]{0,200}gsd-executing-plans[\s\S]{0,80}gsd-handoff[\s\S]{0,80}gsd-tdd/);
  assert.match(reference, /`enter terminal verification\/repair`[\s\S]{0,120}gsd-verify[\s\S]{0,80}gsd-handoff/);
  assert.match(reference, /Do not load `gsd-verify` and do not dispatch `gsdReviewer` for task repair/);
  assert.doesNotMatch(reference, /reload\[N\]\{skill,path\}/);
  assert.doesNotMatch(handoff, /reload\[N\]\{skill,path\}/);
  assert.doesNotMatch(reference, /JIT task attempt|handoff-<n>\.toon as authority/i);
  assert.doesNotMatch(reference, /Manual UI Review Gate/);
  assert.match(handoff, /Write atomic `\.scratch\/<feature>\/state\.toon`/);
  assert.match(handoff, /Active skills are derived from `phase` and `next_action`/);
  assert.match(handoff, /Never serialize a `reload` manifest/);
  assert.match(toPlan, /Build prototype with Lavish/);
  assert.match(toPlan, /write atomic `state\.toon`/);
  assert.match(execution, /validated task slice/);
  assert.match(execution, /Do not write task-attempt TOON files/);
  assert.match(verify, /phase=merged-cleanup-pending|merged-cleanup-pending/);
  assert.match(verify, /There is no terminal pre-E2E visual pause/);
  assert.match(master, /state\.toon/);
  assert.match(master, /Build prototype with Lavish/);
  assert.doesNotMatch(master, /result\.toon/);
  assert.match(handoff, /Reject `manual_ui_review`/);
});
test("activation fixtures and response parser enforce lazy primary-skill selection", () => {
  const fixtureText = read("test/eval/fixtures.json");
  const fixtures = JSON.parse(fixtureText);
  const installed = new Set(skillNames().filter((name) => name !== "gsd"));
  assert.deepEqual(validateFixtureSet(fixtures, installed), { ok: true });
  const documentedFixtureCount = read("README.md").match(/(\d+) workspace-state \+ prompt fixtures/);
  assert.ok(documentedFixtureCount);
  assert.equal(fixtures.length, Number(documentedFixtureCount[1]));
  assert.match(fixtureText, /approved plan\.md exist|state\.toon/);
  assert.doesNotMatch(fixtureText, /proposal\.toon|spec\.toon|design\.toon|plan\.toon/);
  assert.doesNotMatch(fixtureText, /"route"|"skill"/);
  assert.doesNotMatch(fixtureText, /handoff-\d+\.toon|result\.toon/);

  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  for (const id of ["nano-typo", "readonly-question", "mention-not-ask", "catalog"]) {
    assert.deepEqual(
      {
        action: byId.get(id).expectedAction,
        primarySkill: byId.get(id).expectedPrimarySkill,
      },
      { action: "direct", primarySkill: null },
      id,
    );
  }
  assert.deepEqual(
    {
      action: byId.get("new-feature").expectedAction,
      primarySkill: byId.get("new-feature").expectedPrimarySkill,
    },
    { action: "load", primarySkill: "gsd-brainstorming" },
  );
  assert.deepEqual(
    {
      decision: byId.get("result-retained-newer-than-active").decision,
      action: byId.get("result-retained-newer-than-active").expectedAction,
      primarySkill: byId.get("result-retained-newer-than-active").expectedPrimarySkill,
    },
    { decision: "ignore-terminal-record", action: "load", primarySkill: "gsd-handoff" },
  );

  assert.deepEqual(
    validateActivationTarget(
      { decision: "block-resume", action: "stop", primarySkill: null },
      installed,
    ),
    { ok: true },
  );
  assert.match(
    validateActivationTarget(
      { decision: "block-resume", action: "direct", primarySkill: null },
      installed,
    ).detail,
    /requires stop/,
  );
  assert.deepEqual(
    parseActivationResponse(
      '{"decision":"ordinary-routing","action":"direct","primarySkill":null}',
      installed,
    ),
    {
      ok: true,
      value: { decision: "ordinary-routing", action: "direct", primarySkill: null },
    },
  );
  assert.deepEqual(
    parseActivationResponse(
      '{"decision":"ordinary-routing","action":"load","primarySkill":"gsd-verify"}',
      installed,
    ),
    {
      ok: true,
      value: { decision: "ordinary-routing", action: "load", primarySkill: "gsd-verify" },
    },
  );
  assert.match(
    parseActivationResponse(
      '{"decision":"ordinary-routing","action":"direct","primarySkill":null,"action":"load"}',
      installed,
    ).detail,
    /duplicate keys/,
  );
  assert.equal(
    responseMatchesFixture(
      { decision: "ordinary-routing", action: "direct", primarySkill: null },
      byId.get("readonly-question"),
    ),
    true,
  );
  assert.equal(
    responseMatchesFixture(
      { decision: "ordinary-routing", action: "load", primarySkill: "gsd-handoff" },
      byId.get("readonly-question"),
    ),
    false,
  );

  const master = read("skills/gsd/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const evalRunner = read("test/eval/activation-eval.mjs");
  for (const decision of [
    "ordinary-routing",
    "ignore-terminal-record",
    "cleanup-question",
    "cleanup-only",
    "block-resume",
    "fail-closed",
  ]) {
    assert.ok(reference.includes(`\`${decision}\``));
  }
  assert.match(reference, /generic `continue`/);
  assert.match(reference, /completed-retained|merged-cleanup-pending/);
  assert.match(evalRunner, /createBootstrap\(repoRoot\)/);
  assert.match(evalRunner, /discoverSkillCatalog\(repoRoot\)/);
  assert.doesNotMatch(evalRunner, /REFERENCE\.md|route|trace|--mode/);
  assert.match(master, /Completed-state decision matrix|completed-state decision matrix/i);
});

test("compaction recovery capsule byte identity and drift protection", async () => {

  const reference = read("skills/gsd/REFERENCE.md");
  const match = reference.match(/#### Compaction Recovery Capsule[\s\S]*?```text\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(match, "Failed to locate Compaction Recovery Capsule text block in REFERENCE.md");

  const extractedTemplate = match[1].replace(/\r\n/g, "\n");
  const normalizedTemplate = CAPSULE_TEMPLATE.replace(/\r\n/g, "\n");

  assert.equal(normalizedTemplate, extractedTemplate, "Drift detected: CAPSULE_TEMPLATE does not match REFERENCE.md exactly");

  // Real evidence for AC-10 lifecycle delivery
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  
  const tempDir = mkdtempSync(join(tmpdir(), "omp-gsd-ac10-"));
  const scratchDir = join(tempDir, ".scratch");
  mkdirSync(scratchDir);

  try {
    const featDir = join(scratchDir, "ac-10");
    mkdirSync(featDir);
    writeFileSync(join(featDir, "plan.md"), "plan");
    writeFileSync(join(featDir, "state.toon"), [
      "schema:v1",
      "feature:ac-10",
      "phase:executing",
      "next_action:start/continue task",
      "plan_path:.scratch/ac-10/plan.md",
      "plan_sha256:" + "a".repeat(64),
      "base_ref:main",
      "wip_branch:wip/ac-10",
      "last_green_task:none",
      "last_green_commit:none",
      "executor_model:xai-oauth/grok-4.5",
      "reviewer_model:openai-codex/gpt-5.5:high",
      "review_round:none",
      "blocking_fingerprint:none",
      "reviewed_commit:none",
      "progress_status:none",
      "autosync:none",
      "ponytail_level:none",
      "cleanup_preference:none",
      "checkpoint_revision:1",
      ""
    ].join("\n"));

    // Add an overlong otherwise-active directory (>255 UTF-8 bytes) via readdirSync interception
    const fs = nodeFs;
    const realReaddirSync = fs.readdirSync;
    const overlongName = "ac-10-overlong-" + "a".repeat(250);
    fs.readdirSync = function(p, opts) {
      const res = realReaddirSync.call(this, p, opts);
      if (p === scratchDir && opts?.withFileTypes) {
        return [
          ...res,
          {
            name: overlongName,
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false
          }
        ];
      }
      return res;
    };

    try {
      const registeredEvents = {};
      const sentMessages = [];

      const piMock = {
        on: (event, handler) => {
          registeredEvents[event] = handler;
        },
        sendMessage: async (message, options) => {
          sentMessages.push({ message, options });
        }
      };

      const ctxMock = {
        cwd: tempDir
      };

      gsdContextExtension(piMock);

      // Verify events registered
      assert.ok(registeredEvents["session.compacting"]);
      assert.ok(registeredEvents["session_compact"]);

      // Test session.compacting returns context with capsule for ac-10
      const compactResult = await registeredEvents["session.compacting"]({}, ctxMock);
      assert.ok(compactResult.context);
      assert.equal(compactResult.context.length, 1);
      assert.match(compactResult.context[0], /Active GSD features: ac-10/);

      // Test session_compact queues capsule for ac-10
      await registeredEvents["session_compact"]({}, ctxMock);
      assert.equal(sentMessages.length, 1);
      assert.match(sentMessages[0].message, /Active GSD features: ac-10/);
      assert.deepEqual(sentMessages[0].options, { deliverAs: "nextTurn", triggerTurn: false });
    } finally {
      fs.readdirSync = realReaddirSync;
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("AC-1: Ponytail lifecycle escalation and no reduced-scope completion", () => {
  const ponytail = read("skills/gsd-ponytail/SKILL.md");
  const domain = read("docs/domain/gsd.md");

  // Require normal GSD lifecycle escalation and forbid reduced-scope completion in ponytail skill
  assert.match(ponytail, /return to the normal GSD lifecycle/i);
  assert.match(ponytail, /never ship a reduced subset as complete/i);
  assert.doesNotMatch(ponytail, /Ship the lazy version \+ question it/i);

  // Assert scope-expands transition row as one exact anchored line
  assert.match(ponytail, /^\| Scope expansion \| `event=scope-expands;explicit_level=<current>;auto_scope=<scope>` \| `explicit_level=<current>;auto_scope=none` \| `none` \| `gsd-brainstorming` \| `none` \| `n\/a` \|$/m);
  assert.doesNotMatch(ponytail, /event=scope-expands.*auto_scope=<scope>.*explicit_level=none/i);
  assert.doesNotMatch(ponytail, /event=scope-expands.*auto_scope=<scope>.*auto_scope=quick-fix/i);

  // Require same in domain decision D-gsd-2
  assert.match(domain, /### D-gsd-2: Escalate work that stops being a quick fix/i);
  assert.match(domain, /Clear bounded quick-fix scope and return to the normal lifecycle when requested work becomes complex or expands beyond known scope/i);
  assert.match(domain, /silently reducing requested scope bypasses/i);
});

test("AC-2: Installation documentation distinguishes relocation from in-place edits", () => {
  const readme = read("README.md");

  // Find the paragraph containing installation guidance
  const paragraph = readme.split(/\n\s*\n/).find(p => p.includes("Relocation of the checkout") || p.includes("separately installed"));
  assert.ok(paragraph, "Should find the installation-guidance paragraph");
  const normalized = paragraph.replace(/\s+/g, " ").trim();

  // Relocation requiring reinstall
  assert.match(normalized, /Relocation of the checkout requires reinstall/);

  // Combined in-place clause: editing the extension in place does not require reinstall but does require starting a new OMP session
  assert.match(normalized, /editing the extension in place does not require reinstall, but it does require you to start a new OMP session/);

  // Ensure opposite session guidance cannot pass
  assert.doesNotMatch(normalized, /does not require starting a new OMP session/);
  assert.doesNotMatch(normalized, /without starting a new OMP session/);
  assert.doesNotMatch(normalized, /no new OMP session/);
  assert.doesNotMatch(normalized, /does not require (?:you to )?(?:start|starting) a new OMP session/);
  assert.doesNotMatch(normalized, /editing the extension in place requires reinstall/);
  assert.doesNotMatch(normalized, /Relocation of the checkout does not require reinstall/);
});

test("AC-3: Milestone Ledger definition points to canonical plan and excludes legacy local spec", () => {
  const domain = read("docs/domain/gsd.md");

  // Definition points to canonical plan and excludes local spec wording
  assert.match(domain, /detailed acceptance criteria stay in the canonical plan/i);
  assert.doesNotMatch(domain, /local spec/i);
});

test("AC-4: Cross-references, None. explicit, repair evidence not duplicated, and renderer serialization", () => {
  const bugDiagnosis = read("skills/gsd-diagnosing-bugs/SKILL.md");
  const architecture = read("skills/gsd-improve-codebase-architecture/SKILL.md");
  const executingPlans = read("skills/gsd-executing-plans/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");

  // Disclosure headings point to canonical reference and are immediately followed by fence
  const pairRegex = /^[ ]{0,3}## Contextual disclosure.*\[\.\.\/gsd\/REFERENCE\.md\]\(\.\.\/gsd\/REFERENCE\.md\).*§ Contextual disclosure templates.*\r?\n[ ]{0,3}```/m;
  assert.match(bugDiagnosis, pairRegex);
  assert.match(architecture, pairRegex);

  // None. is explicit in executing plans and reference
  assert.match(executingPlans, /A "None\." decisions block in the plan is represented as an explicit empty decisions marker|A `None\.` decisions block in the plan is represented as an explicit empty decisions marker/i);
  assert.match(reference, /A `None\.` decisions block in the plan is represented as an explicit empty decisions marker/i);

  // Repair evidence is not duplicated in executing plans
  assert.match(executingPlans, /the gsd-executor agent reruns only focused checks invalidated by its repair, records replacement green evidence for each invalidated check, and reports replacement green evidence to the parent for an executor-only focused-check decision/i);
  assert.doesNotMatch(executingPlans, /Rerun all invalidated evidence and review\./i);
  assert.doesNotMatch(executingPlans, /focused checks and evidence/i);
  assert.doesNotMatch(executingPlans, /that repair pass/i);

  // Renderer serialization without String.replace implication
  assert.doesNotMatch(reference, /placeholder is replaced by/i);
  assert.doesNotMatch(reference, /`<features>` is replaced by/i);
  assert.match(reference, /`<features>` template field is serialized as/i);
  assert.match(reference, /For Normal mode \(<= 5 active features\), `<resume_instruction>` is:/i);
  assert.match(reference, /For Bounded-Ambiguity mode \(> 5 active features\), `<resume_instruction>` is:/i);
});


test("archive terminal disposition contract", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const master = read("skills/gsd/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const toPlan = read("skills/gsd-to-plan/SKILL.md");
  const executing = read("skills/gsd-executing-plans/SKILL.md");

  assert.match(toPlan, /This is the last planning prompt:/);
  assert.match(toPlan, /Build prototype with Lavish/);
  assert.doesNotMatch(toPlan, /Manual UI Review Gate/);
  assert.match(toPlan, /no later planning menu, approval confirmation, or generic Lavish visual-review offer appears/);
  assert.match(executing, /Approval is the last normal planning prompt\./);
  assert.doesNotMatch(executing, /Manual UI Review Gate/);
  assert.match(reference, /Build prototype with Lavish|Planning Prototype Session/);
  assert.doesNotMatch(reference, /Manual UI Review Gate/);

  assert.match(reference, /Terminal scratch disposition/i);
  assert.match(reference, /delete, retain, or archive-and-delete|retain or archive-and-delete/);
  assert.match(reference, /docs\/gsd\/<feature>\/archive\/plan\.md/);
  assert.match(reference, /docs\/gsd\/<feature>\/archive\/implementation\.md/);
  assert.match(reference, /same green one-feature\/one-squash commit/);
  assert.match(reference, /never create a post-squash or post-merge documentation-only commit/);
  assert.match(reference, /remove `\.scratch\/<feature>\/`|delete `\.scratch\/<feature>\/`/);

  assert.match(verify, /archive-and-delete/);
  assert.match(verify, /copy the exact approved `\.scratch\/<feature>\/plan\.md` to `docs\/gsd\/<feature>\/archive\/plan\.md`/);
  assert.match(verify, /write `docs\/gsd\/<feature>\/archive\/implementation\.md`/);
  assert.match(verify, /feature outcome, changed paths, acceptance outcomes, and verification evidence/);
  assert.match(verify, /same green one-feature\/one-squash commit/);
  assert.match(verify, /never create a post-squash documentation-only commit/);
  assert.match(verify, /default to delete after green merge|automatically remove scratch/i);

  assert.match(master, /retain or archive-and-delete/);
  assert.match(master, /docs\/gsd\/<feature>\/archive\/plan\.md/);
  assert.match(master, /docs\/gsd\/<feature>\/archive\/implementation\.md/);

  assert.match(reference, /non-authoritative historical reference/);
  assert.match(reference, /sole execution\/design authority/);
  assert.match(reference, /Do not copy legacy handoffs|never copy handoffs/i);
  assert.match(reference, /If either archive destination already exists, fail closed and preserve prior content; never overwrite/);
  assert.match(reference, /pre-squash archive opportunity is not reopened after merge/);

  assert.match(verify, /non-authoritative historical reference only/);
  assert.match(verify, /never copy handoffs, attempts, or result markers/);
  assert.match(verify, /fail closed without overwrite on collision/);

  assert.match(master, /never reopens planning or any other menu/);
  assert.match(master, /pre-squash archive opportunity is not reopened/);

  assert.match(reference, /merged-cleanup-pending|completed-retained/);
  assert.match(master, /merged-cleanup-pending|completed-retained/);

  assert.doesNotMatch(reference, /automatically archive every completed feature/i);
  assert.doesNotMatch(reference, /archived plans as active authority/i);
  assert.doesNotMatch(reference, /copy the full scratch packet/i);
  assert.doesNotMatch(verify, /automatically archive every completed feature/i);
});

test("AC-1: Fast TDD is mandatory for observable tasks", () => {
  const tdd = read("skills/gsd-tdd/SKILL.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const toPlan = read("skills/gsd-to-plan/SKILL.md");
  const brainstorm = read("skills/gsd-brainstorming/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const executor = read("agents/gsd-executor.md");
  const reviewer = read("agents/gsd-reviewer.md");
  const readme = read("README.md");
  const domain = read("docs/domain/gsd.md");

  // Mandatory gsd-tdd load for observable task work
  assert.match(execution, /Every observable task loads `gsd-tdd`/i);
  assert.match(execution, /direct-root TDD instructions/);
  assert.match(tdd, /Dispatched task TDD/);
  assert.match(domain, /Every task with observable behavior must load `gsd-tdd`/);

  // Fast deterministic public seam + RED before implementation, GREEN after, then refactor
  assert.match(tdd, /Fast TDD Check/i);
  assert.match(tdd, /RED before implementation/i);
  assert.match(tdd, /GREEN after implementation/i);
  assert.match(tdd, /RED→GREEN→refactor|RED -> GREEN -> refactor|RED→GREEN.*refactor/i);
  assert.match(executor, /RED before implementation/i);
  assert.match(executor, /GREEN after implementation/i);
  assert.match(executor, /refactor after green/i);
  assert.match(domain, /Fast TDD Check for RED→GREEN→refactor/);

  // Fail closed: post-implementation-only checks are not the task TDD cadence
  assert.doesNotMatch(executor, /Run exact focused checks after implementation; never run whole acceptance\/E2E suites\./);
  assert.doesNotMatch(execution, /The executor runs its focused check once after implementation; it never runs acceptance checks\./);

  // Observable behavior cannot use `none`; missing fast seam adds the smallest real seam
  assert.match(toPlan, /Observable behavior always receives a fast public seam/i);
  assert.match(toPlan, /smallest real (?:fast )?public seam/i);
  assert.match(toPlan, /`none` is only for mechanically verified non-behavioral work/);
  assert.doesNotMatch(toPlan, /`none` is only for mechanically verified non-behavioral work\. A vague check/);
  // more precise: none must not be allowed for observable behavior
  assert.match(toPlan, /never use `none` for observable behavior/i);
  assert.match(brainstorm, /smallest real (?:fast )?public seam/i);
  assert.match(brainstorm, /Fast TDD Check|fast deterministic/i);

  // Per-task browser / resource-heavy checks are banned in the implementation task loop
  assert.match(tdd, /no browser or GUI/i);
  assert.match(tdd, /no (?:external )?network/i);
  assert.match(tdd, /no long-lived server/i);
  assert.match(tdd, /no large fixture/i);
  assert.match(tdd, /material (?:machine )?cost|materially expensive/i);
  assert.doesNotMatch(tdd, /focused check may be unit, integration, CLI, browser, or HTTP/);
  assert.doesNotMatch(tdd, /focused browser\/HTTP test remains per-task/);
  assert.doesNotMatch(brainstorm, /browser, CLI, or HTTP first/);
  assert.match(reference, /No browser, GUI, external network, long-lived server, large fixture, or material(?:ly expensive)?/);
  assert.match(executor, /never run (?:browser|resource-heavy|slow) (?:checks|suites) in the task loop/i);

  // Reporting-only evidence: no persistent TDD TOON evidence fields
  assert.match(tdd, /reporting and transcripts only/i);
  assert.match(tdd, /Do not add persistent TDD evidence tables, fields, or schema to runtime TOON/);
  assert.match(execution, /reporting and transcripts only/i);
  assert.match(reference, /reporting-only and transcript-only/);
  assert.doesNotMatch(reference, /tdd_evidence|red_evidence|green_evidence|refactor_evidence/);
  assert.doesNotMatch(tdd, /\btdd_evidence\b|\bred_evidence\b|\bgreen_evidence\b|\brefactor_evidence\b/);
  assert.doesNotMatch(execution, /\btdd_evidence\b|\bred_evidence\b|\bgreen_evidence\b|\brefactor_evidence\b/);

  // README/domain/agent surface the mandatory fast test-first sequence
  assert.match(readme, /fast deterministic|Fast TDD|RED→GREEN→refactor/i);
  assert.match(readme, /gsd-tdd/);
  assert.match(domain, /### D-gsd-6: Require fast TDD and defer resource-heavy E2E/);
  assert.match(domain, /Planning adds the smallest real fast public seam when none exists/);

  // Independent reviewer remains available but is not part of the per-task TDD loop for AC-1 evidence
  assert.match(reviewer, /terminal/i);
});

test("AC-2: Terminal slow E2E and whole-diff review are progress-guarded", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const reviewer = read("agents/gsd-reviewer.md");
  const readme = read("README.md");
  const domain = read("docs/domain/gsd.md");

  // No gsdReviewer / slow suite in the per-task implementation loop
  assert.match(execution, /Do not dispatch `gsdReviewer` per task/i);
  assert.match(execution, /task boundary (?:is )?based on executor fast-green evidence/i);
  assert.doesNotMatch(execution, /dispatches the persistent gsd-reviewer agent \(reusing the same gsd-reviewer session with the bound reviewer model from `modelRoles\.gsdReviewer`\) against the task diff/);
  assert.doesNotMatch(execution, /Never run browser\/resource-heavy\/slow suites in the task loop[\s\S]*dispatches the persistent gsd-reviewer agent against the task diff/);
  assert.match(reference, /No browser, GUI, external network, long-lived server, large fixture, or material cost may run in an implementation task loop/);
  assert.match(reference, /Do not dispatch `gsdReviewer` per task/i);

  // Terminal order: all tasks/fast green → complete feature-affected slow suite → whole-diff review
  assert.match(verify, /complete feature-affected slow suite/i);
  assert.match(verify, /only after (?:all )?(?:tasks and )?fast checks? (?:pass|are green)/i);
  assert.match(verify, /whole(?:-|\s)?diff review only after the complete feature-affected slow suite is green/i);
  assert.match(reference, /complete feature-affected slow suite/i);
  assert.match(reference, /whole(?:-|\s)?diff review only after/i);
  assert.match(domain, /Do not dispatch `gsdReviewer` per task/i);
  assert.match(domain, /complete feature-affected slow suite/i);

  // Reviewer agent is terminal whole-diff only
  assert.match(reviewer, /terminal whole(?:-|\s)?diff/i);
  assert.doesNotMatch(reviewer, /backing task and terminal review/);
  assert.doesNotMatch(reviewer, /Review task diffs and terminal WIP diffs/);

  // Progress-guarded repair sequence for slow/review failures
  assert.match(verify, /source(?:-first)? repair/i);
  assert.match(verify, /smallest affected (?:fast\/slow )?subset/i);
  assert.match(verify, /complete feature-affected slow suite/i);
  assert.match(verify, /whole(?:-|\s)?diff re-review/i);
  assert.match(verify, /progress guard/i);
  assert.match(reference, /smallest affected/i);
  assert.match(reference, /progress guard/i);
  assert.match(domain, /progress-guarded/i);

  // Completion requires both complete slow suite green and whole-diff review green
  assert.match(verify, /Terminal completion requires both the complete feature-affected slow suite and `gsdReviewer` whole-diff verdict/i);
  assert.match(reference, /Terminal completion requires both the complete feature-affected slow suite and `gsdReviewer` whole-diff verdict/i);
  assert.match(readme, /whole-diff terminal review/i);
  assert.match(readme, /complete feature-affected slow suite|Deferred Slow E2E/i);
  assert.doesNotMatch(readme, /reviews each task, records reporting-only evidence/);
});
test("AC-optional: planning prototype replaces Manual UI Review", () => {
  const brainstorm = read("skills/gsd-brainstorming/SKILL.md");
  const toPlan = read("skills/gsd-to-plan/SKILL.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const executor = read("agents/gsd-executor.md");
  const domain = read("docs/domain/gsd.md");
  const readme = read("README.md");
  const lavish = read("skills/gsd-lavish/SKILL.md");

  assert.match(brainstorm, /Build prototype with Lavish/i);
  assert.doesNotMatch(brainstorm, /Manual UI Review Gate/i);
  assert.match(toPlan, /Build prototype with Lavish/);
  assert.match(toPlan, /Approve and execute/);
  assert.match(toPlan, /single post-plan action surface|post-plan action surface/);
  assert.match(toPlan, /launch consent/);
  assert.doesNotMatch(toPlan, /Manual UI Review Gate/i);

  assert.match(verify, /There is no terminal pre-E2E visual pause/);
  assert.match(execution, /There is no terminal pre-E2E visual pause/);
  assert.doesNotMatch(execution, /manual_ui_review,on/);
  assert.doesNotMatch(handoff, /manual_ui_review,on/);
  assert.doesNotMatch(reference, /manual_ui_review,on/);
  assert.doesNotMatch(executor, /Manual UI Review Gate/i);

  assert.match(reference, /Planning Prototype Session/);
  assert.match(reference, /Build prototype with Lavish/);
  assert.match(domain, /### D-gsd-9: Keep Lavish prototypes pre-approval and reference-only/);
  assert.match(readme, /Build prototype with Lavish/);
  assert.match(lavish, /Planning prototype|Build prototype with Lavish/);
  assert.match(execution, /post-approval prototype request is Spec escalation/i);
});

test("AC-4: hidden bootstrap uses state.toon and prototype surface", () => {
  const master = read("skills/gsd/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");

  assert.match(master, /Build prototype with Lavish/i);
  assert.match(master, /Deferred Slow E2E/i);
  assert.match(master, /state\.toon/);
  assert.doesNotMatch(master, /Manual UI Review Gate/i);
  assert.doesNotMatch(master, /result\.toon/);
  assert.match(master, /auto-deletes after a green merge|Scratch auto-deletes/i);
  assert.match(master, /gsdReviewer|whole-diff/i);
  assert.match(reference, /Planning Prototype Session|Build prototype with Lavish/i);
  assert.match(reference, /merged-cleanup-pending|completed-retained/);
  assert.doesNotMatch(reference, /Manual UI Review Gate/i);
});

test("AC-2 repair: task repair is executor-only without gsd-verify or gsdReviewer", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");

  assert.match(execution, /task repair[\s\S]{0,200}next_action` set to `start\/continue task`/);
  assert.doesNotMatch(execution, /next_action` set to `run task review\/repair`/);

  assert.doesNotMatch(reference, /`run task review\/repair`/);
  assert.match(reference, /`start\/continue task`[\s\S]{0,120}gsd-executing-plans[\s\S]{0,80}gsd-handoff[\s\S]{0,80}gsd-tdd/);
  assert.match(execution, /Do not dispatch `gsdReviewer` per task/);
  assert.match(reference, /Do not dispatch `gsdReviewer` per task/);
  assert.doesNotMatch(reference, /run task review\/repair/);
});

test("AC-3: Visible skill dispatch is deterministic", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const visible = skillNames().filter((name) => name !== "gsd").sort();
  assert.equal(visible.length, 12, "exactly 12 visible GSD skills");

  // Canonical matrix section with machine-parseable rows
  const section = reference.match(
    /## Visible skill mandatory-use matrix\n+([\s\S]*?)(?:\n## |\n### |\n*$)/,
  );
  assert.ok(section, "REFERENCE must define ## Visible skill mandatory-use matrix");
  const body = section[1];

  // Header: exact columns
  assert.match(
    body,
    /^\| Skill \| Role \| Intent \| Prerequisites \| Do-not-load \| Transition \| Helper-when \|\n\| --- \| --- \| --- \| --- \| --- \| --- \| --- \|/m,
  );

  const rowRe =
    /^\| `(gsd-[a-z0-9-]+)` \| (owner|helper) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm;
  const rows = [...body.matchAll(rowRe)].map((m) => ({
    skill: m[1],
    role: m[2],
    intent: m[3].trim(),
    prerequisites: m[4].trim(),
    doNotLoad: m[5].trim(),
    transition: m[6].trim(),
    helperWhen: m[7].trim(),
  }));

  assert.equal(rows.length, 12, "matrix must have exactly 12 rows");
  assert.deepEqual(
    rows.map((r) => r.skill).sort(),
    visible,
    "matrix skills must be exactly the 12 visible skills, one each",
  );
  // uniqueness
  assert.equal(new Set(rows.map((r) => r.skill)).size, 12, "no multiply mapped skill");

  const vague = /\b(as needed|if useful|when appropriate|sometimes|maybe|etc\.?|TBD|TODO)\b/i;
  const helpers = [];
  for (const row of rows) {
    assert.ok(row.intent && row.intent !== "—" && row.intent.length > 8, `${row.skill} exact intent`);
    assert.ok(row.prerequisites && row.prerequisites !== "", `${row.skill} prerequisites`);
    assert.ok(row.doNotLoad && row.doNotLoad !== "", `${row.skill} do-not-load`);
    assert.ok(row.transition && row.transition !== "—" && row.transition.length > 3, `${row.skill} transition`);
    assert.doesNotMatch(row.intent, vague, `${row.skill} intent not vague`);
    assert.doesNotMatch(row.prerequisites, vague, `${row.skill} prerequisites not vague`);
    assert.doesNotMatch(row.doNotLoad, vague, `${row.skill} do-not-load not vague`);
    assert.doesNotMatch(row.transition, vague, `${row.skill} transition not vague`);

    if (row.role === "helper") {
      helpers.push(row.skill);
      assert.notEqual(row.helperWhen, "—", `${row.skill} helper-when required`);
      assert.ok(row.helperWhen.length > 8, `${row.skill} helper-when exact`);
      assert.doesNotMatch(row.helperWhen, vague, `${row.skill} helper-when not vague`);
      assert.match(
        row.helperWhen,
        /must load|required when|active if and only if|load when/i,
        `${row.skill} helper condition is mandatory, not optional`,
      );
    } else {
      assert.equal(row.helperWhen, "—", `${row.skill} owner has empty helper-when marker`);
    }

    // Each visible skill file must point at the matrix and restate role/transition concisely
    const skillMd = read(`skills/${row.skill}/SKILL.md`);
    assert.match(skillMd, /Visible skill mandatory-use matrix/);
    assert.match(skillMd, new RegExp(`Role:\\s*${row.role}`));
    assert.match(skillMd, /Do-not-load:/i);
    assert.match(skillMd, /Transition:/i);
    if (row.role === "helper") {
      assert.match(skillMd, /Helper-when:/i);
      assert.match(skillMd, /cannot be skipped|must load|required when/i);
    }
  }

  // Known helpers must be present and mandatory under condition
  for (const helper of ["gsd-tdd", "gsd-domain-modeling", "gsd-codebase-design", "gsd-lavish"]) {
    assert.ok(helpers.includes(helper), `${helper} mapped as helper`);
  }

  // Reject unmapped skill by construction (already exact set equality)
  // Reject vague matrix-wide language
  assert.doesNotMatch(body, vague);
});

test("AC-4: Concision preserves semantic parity", () => {
  const BASELINE_VISIBLE_WORDS = 13120;
  const visible = skillNames().filter((name) => name !== "gsd").sort();
  assert.equal(visible.length, 12);

  let total = 0;
  for (const name of visible) {
    // Whitespace-delimited count matches original `wc -w` baseline methodology.
    const body = read(`skills/${name}/SKILL.md`).trim();
    const words = body ? body.split(/\s+/).filter(Boolean) : [];
    total += words.length;
  }
  assert.ok(
    total < BASELINE_VISIBLE_WORDS,
    `visible-skill word count ${total} must be lower than baseline ${BASELINE_VISIBLE_WORDS}`,
  );

  const reference = read("skills/gsd/REFERENCE.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const tdd = read("skills/gsd-tdd/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");

  // Shared rules live in REFERENCE; skills keep mode-specific dispatch
  assert.match(reference, /## Visible skill mandatory-use matrix/);
  assert.match(reference, /### Fast TDD and task-loop constraints/);
  assert.match(reference, /Do not dispatch `gsdReviewer` per task/);
  assert.match(reference, /complete feature-affected slow suite/);

  // Mandatory semantics preserved after compression
  assert.match(execution, /Every observable task loads `gsd-tdd`/);
  assert.match(execution, /Do not dispatch `gsdReviewer` per task/);
  assert.match(tdd, /Fast TDD Check/);
  assert.match(tdd, /RED before implementation/);
  assert.match(tdd, /GREEN after implementation/);
  assert.match(verify, /whole-diff review only after the complete feature-affected slow suite is green/i);
  assert.match(verify, /progress guard/i);

  // No vague permissive replacement for exact guards
  for (const name of visible) {
    const skill = read(`skills/${name}/SKILL.md`);
    assert.match(skill, /## Dispatch contract/);
    assert.doesNotMatch(skill, /\b(as needed|if useful|when appropriate|maybe|etc\.)\b/i);
  }
});

test("AC-4 repair: executor agent forbids per-task re-review", () => {
  const executor = read("agents/gsd-executor.md");
  const reviewer = read("agents/gsd-reviewer.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");

  assert.match(execution, /Do not dispatch `gsdReviewer` per task/);
  assert.match(execution, /task repair[\s\S]{0,200}next_action` set to `start\/continue task`/);

  assert.match(verify, /whole-diff review only after the complete feature-affected slow suite is green/i);
  assert.match(reviewer, /terminal whole-diff/i);
  assert.match(reviewer, /Do not dispatch `gsdReviewer` per task/);

  assert.doesNotMatch(executor, /submit for re-review/i);
  assert.doesNotMatch(executor, /dispatch `gsdReviewer`/i);
  assert.doesNotMatch(executor, /Manual UI Review Gate/i);
  assert.match(
    executor,
    /rerun only focused (?:Fast TDD )?Checks invalidated by the repair/i,
  );
  assert.match(
    executor,
    /report replacement green evidence to the parent for an executor-only focused-check decision/i,
  );
});

test("AC-4 repair: lavish invocation requires explicit opt-in deliverable", () => {
  const lavish = read("skills/gsd-lavish/SKILL.md");
  const modes = lavish.match(/## Invocation modes\n+([\s\S]*?)(?:\n## |\n*$)/);
  assert.ok(modes, "gsd-lavish must define ## Invocation modes");
  const body = modes[1];
  // Required column must state explicit user acceptance + eligible completed deliverable
  assert.match(
    body,
    /^\| [^|]+ \|[^|]*\b(?:explicit )?user acceptance\b[^|]*\beligible completed deliverable\b[^|]*\|/im,
  );
  // Keep portable mktemp contract intact
  assert.match(lavish, /mktemp "\$ARTIFACT_DIR\/\$\{STEM\}\.XXXXXX"/);
  assert.equal((lavish.match(/^# Lavish$/gm) || []).length, 1);
});

test("AC-4 repair: ponytail is helper with no lifecycle ownership", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const ponytail = read("skills/gsd-ponytail/SKILL.md");
  const section = reference.match(
    /## Visible skill mandatory-use matrix\n+([\s\S]*?)(?:\n## |\n### |\n*$)/,
  );
  assert.ok(section);
  const row = [...section[1].matchAll(
    /^\| `(gsd-[a-z0-9-]+)` \| (owner|helper) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm,
  )].find((m) => m[1] === "gsd-ponytail");
  assert.ok(row, "matrix must include gsd-ponytail");
  assert.equal(row[2], "helper", "gsd-ponytail is helper, not a primary lifecycle owner");
  assert.match(row[7], /must load|required when|active if and only if|load when/i);
  assert.doesNotMatch(row[3], /\bowner\b/i);

  // Skill restates helper / no primary lifecycle ownership
  assert.match(ponytail, /Role:\s*helper/);
  assert.match(ponytail, /Helper-when:/i);
  assert.match(ponytail, /Do not select the primary lifecycle|never select(?:s)? the primary lifecycle|does not replace the primary lifecycle/i);
  assert.match(ponytail, /return to the normal GSD lifecycle/);
});

test("AC-4 repair: ponytail preference autofire and handoff state", () => {
  const ponytail = read("skills/gsd-ponytail/SKILL.md");

  const modes = ponytail.match(/## Invocation modes\n+([\s\S]*?)(?:\n## |\n*$)/);
  assert.ok(modes, "Invocation modes section required");
  const modeRows = [...modes[1].matchAll(/^\| (?!Mode|---)([^|]+) \|/gm)].map((m) => m[1].trim());
  assert.ok(modeRows.length >= 2, "at least Quick-fix and Explicit toggle modes");
  assert.ok(modeRows.some((r) => /quick-fix/i.test(r)), "Quick-fix auto-fire mode");
  assert.ok(modeRows.some((r) => /explicit/i.test(r)), "Explicit session toggle mode");
  assert.match(modes[1], /^\| Mode \| Required \| Optional \| Produced \| Missing required \|$/m);
  for (const line of modes[1].split("\n")) {
    if (!line.startsWith("|") || /Mode|---/.test(line)) continue;
    const cells = line.split("|").slice(1, -1);
    assert.equal(cells.length, 5, `mode row cell count: ${line}`);
  }
  assert.match(modes[1], /runtime policy transitions with no artifact requirements or writes/i);

  assert.match(ponytail, /explicit_level/);
  assert.match(ponytail, /auto_scope/);
  assert.match(ponytail, /none\|lite\|full\|ultra|exactly `none\|lite\|full\|ultra`/);
  assert.match(ponytail, /none\|quick-fix|exactly `none\|quick-fix`/);

  assert.match(ponytail, /## State transitions \(normative\)/);
  assert.match(ponytail, /event=quick-fix;explicit_level=none;auto_scope=none/);
  assert.match(ponytail, /event=scope-expands;explicit_level=<current>;auto_scope=<scope>/);
  assert.match(ponytail, /event=state-write;explicit_level=<level>;auto_scope=<scope>/);
  assert.match(ponytail, /event=state-restore;explicit_level=<current>;auto_scope=<scope>;row=ponytail_level,<level>/);
  assert.match(ponytail, /ponytail_level,<level>/);
  assert.match(ponytail, /state\.toon/);
  assert.match(ponytail, /Auto-fire never becomes explicit state|auto-fire is never serialized/i);

  assert.match(ponytail, /\*\*lite\*\*/);
  assert.match(ponytail, /\*\*full\*\*/);
  assert.match(ponytail, /\*\*ultra\*\*/);
});

test("AC-4 repair: domain-modeling exact Markdown schema", () => {
  const domain = read("skills/gsd-domain-modeling/SKILL.md");
  assert.match(domain, /## Markdown contracts/);
  assert.match(domain, /# Domain Model/);
  assert.match(domain, /## Scopes/);
  assert.match(domain, /\| Scope \| File \| Purpose \|/);
  assert.match(domain, /# Domain Scope/);
  assert.match(domain, /## Terms/);
  assert.match(domain, /\| Term \| Definition \| Avoid \|/);
  assert.match(domain, /## Decisions/);
  assert.match(domain, /D-<scope>-N|D-<scope>-N/);
  assert.match(domain, /\*\*Decision:\*\*/);
  assert.match(domain, /\*\*Rationale:\*\*/);
  assert.match(domain, /Empty `Terms` or `Decisions` may contain exactly `None\.`/);
  assert.match(domain, /sole writer/i);
  assert.match(domain, /orphan shard, or any other partial directory fails closed/);
  assert.match(domain, /## Scaling boundary/);
  assert.match(domain, /## Decision capture/);
  assert.match(domain, /hard to reverse/);
  assert.match(domain, /## Conservative context harvest|## Ambiguity by phase/);
});

test("AC-4 repair: codebase-design vocabulary and deepening", () => {
  const skill = read("skills/gsd-codebase-design/SKILL.md");
  assert.match(skill, /## Glossary/);
  assert.match(skill, /deep module|Deep module/i);
  assert.match(skill, /## Deep vs shallow/);
  assert.match(skill, /## Designing for testability/);
  assert.match(skill, /## Going deeper|design it twice|Design it twice|design-it-twice/i);
  assert.match(skill, /## Principles|information hiding|Information hiding/i);
  assert.match(skill, /## Rejected framings|shallow module/i);
  assert.match(skill, /Role:\s*helper/);
});

test("AC-4 repair: diagnosing-bugs red-capable flow", () => {
  const skill = read("skills/gsd-diagnosing-bugs/SKILL.md");
  assert.match(skill, /## Phase 1 — Build a feedback loop/);
  assert.match(skill, /red-capable|RED-capable|red capable/i);
  assert.match(skill, /## Phase 2 — Reproduce \+ minimize|## Phase 2 — Reproduce/);
  assert.match(skill, /## Phase 3 — Hypothesize/);
  assert.match(skill, /3–5 ranked hypotheses|3-5 ranked hypotheses|ranked hypotheses/i);
  assert.match(skill, /## Phase 4 — Instrument/);
  assert.match(skill, /## Phase 5 — Fix \+ regression test|## Phase 5 — Fix/);
  assert.match(skill, /## Phase 6 — Cleanup \+ post-mortem|## Phase 6 — Cleanup/);
  assert.match(skill, /regression test/);
  assert.match(skill, /\[DEBUG-/);
  assert.match(skill, /gsd-improve-codebase-architecture/);
  // disclosure pair for AC-4 cross-ref
  assert.match(skill, /^[ ]{0,3}## Contextual disclosure.*\[\.\.\/gsd\/REFERENCE\.md\]\(\.\.\/gsd\/REFERENCE\.md\).*§ Contextual disclosure templates.*\r?\n[ ]{0,3}```/m);
});

test("AC-4 repair: architecture candidates selection and Lavish gate", () => {
  const skill = read("skills/gsd-improve-codebase-architecture/SKILL.md");
  assert.match(skill, /## 1\. Explore/);
  assert.match(skill, /## 2\. Present candidates/);
  assert.match(skill, /## 3\. Grilling loop/);
  assert.match(skill, /ask the user to pick one|user pick|user selects?|user selection/i);
  assert.match(skill, /[Ll]avish|visual review/);
  assert.match(skill, /terminal default/i);
  assert.match(skill, /^[ ]{0,3}## Contextual disclosure.*\[\.\.\/gsd\/REFERENCE\.md\]\(\.\.\/gsd\/REFERENCE\.md\).*§ Contextual disclosure templates.*\r?\n[ ]{0,3}```/m);
});

test("AC-4 repair: brainstorming modes harvest and stress-test", () => {
  const skill = read("skills/gsd-brainstorming/SKILL.md");
  const modes = skill.match(/## Invocation modes\n+([\s\S]*?)(?:\n## |\n*$)/);
  assert.ok(modes);
  const body = modes[1];
  assert.match(body, /[Ss]tress-?test|Discovery and stress-test/);
  assert.match(skill, /## Discovery and stress-test/);
  assert.match(skill, /[Ss]pec-?gap|Spec gap|spec-gap return/i);
  assert.match(skill, /architecture candidate|Architecture-candidate|architecture-candidate/i);
  assert.match(skill, /## Conservative context harvest|context harvest/i);
  assert.match(skill, /## Large-feature decomposition|milestone/i);
  assert.match(skill, /## Acceptance and interface convergence/);
  assert.match(skill, /## Convergence transition|load `gsd-to-plan`/);
  assert.match(skill, /Role:\s*owner/);
});

test("AC-4 repair: codebase-design Adapter and Leverage definitions", () => {
  const skill = read("skills/gsd-codebase-design/SKILL.md");
  // Exact shared vocabulary — role-at-seam Adapter, not vague thin translation
  assert.match(
    skill,
    /\*\*Adapter\*\* — a concrete thing that satisfies an interface at a seam\. Describes \*role\* \(what slot it fills\), not substance \(what's inside\)\./,
  );
  // Exact Leverage definition — capability per unit interface across call sites/tests
  assert.match(
    skill,
    /\*\*Leverage\*\* — what callers get from depth: more capability per unit of interface they learn\. One implementation pays back across N call sites and M tests\./,
  );
  // Reject shallow redefinitions that replace the shared contract
  assert.doesNotMatch(skill, /\*\*Adapter\*\* — thin translation at a boundary without leaking internals/);
  assert.doesNotMatch(skill, /\*\*Leverage\*\* — change amplification through a deep interface/);
});

test("AC-4 repair: diagnosing no-red-loop blocker vs access ask", () => {
  const skill = read("skills/gsd-diagnosing-bugs/SKILL.md");
  // No red-capable loop is mode-branched: standalone may ask once; execution-blocker is Blocker/pause
  assert.match(skill, /No red-capable command → no Phase 2/i);
  assert.match(
    skill,
    /In standalone diagnosis[\s\S]{0,200}STOP and ask one focused question[\s\S]{0,120}(?:environment )?access|captured artifact|temporary instrumentation/i,
  );
  assert.match(
    skill,
    /In Execution-blocker diagnosis[\s\S]{0,120}ask no question[\s\S]{0,200}canonical post-approval Blocker stop|Blocker stop/i,
  );
  assert.match(skill, /return the blocker evidence to `gsd-executing-plans`/i);
  // Must not universally ask for access regardless of mode
  assert.doesNotMatch(
    skill,
    /If you cannot build one, STOP and ask for env access\/captured artifact\/temp instrumentation permission\./,
  );
});

test("AC-4 repair: ponytail Helper-when includes normal clearing", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const ponytail = read("skills/gsd-ponytail/SKILL.md");
  const section = reference.match(
    /## Visible skill mandatory-use matrix\n+([\s\S]*?)(?:\n## |\n### |\n*$)/,
  );
  assert.ok(section);
  const row = [...section[1].matchAll(
    /^\| `(gsd-[a-z0-9-]+)` \| (owner|helper) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm,
  )].find((m) => m[1] === "gsd-ponytail");
  assert.ok(row);
  assert.equal(row[2], "helper");
  // Helper-when must mandatorily cover normal/stop clearing-state load, not only lite/full/ultra
  assert.match(row[7], /\bnormal\b/i);
  assert.match(row[7], /must load|required when|active if and only if|load when/i);
  assert.match(row[7], /lite|full|ultra/i);
  // Skill dispatch stays aligned
  assert.match(ponytail, /Helper-when:[\s\S]{0,200}\bnormal\b/i);
  assert.match(ponytail, /event=stop;explicit_level=<current>;auto_scope=<scope>/);
  assert.match(ponytail, /Ponytail: none — normal mode\./);
});

test("AC-4 repair: codebase-design Implementation and seam principles", () => {
  const skill = read("skills/gsd-codebase-design/SKILL.md");
  assert.match(
    skill,
    /\*\*Implementation\*\* — what's inside a module, its body of code\. Distinct from \*\*Adapter\*\*/,
  );
  assert.match(
    skill,
    /\*\*Depth\*\* — leverage at the interface: the amount of behaviour a caller \(or test\) can exercise per unit of interface/i,
  );
  assert.match(skill, /Depth is a property of the interface, not the implementation/i);
  assert.match(skill, /The deletion test/i);
  assert.match(skill, /If complexity vanishes, it was a pass-through|complexity reappears across N callers/i);
  assert.match(skill, /One adapter means a hypothetical seam\. Two adapters means a real one/i);
  assert.match(skill, /Internal seams vs external seams/i);
  assert.match(skill, /Don't expose internal seams at the external interface|Don't expose internal/i);
  assert.match(skill, /Tests assert on observable outcomes through the interface, not internal state/i);
  assert.match(skill, /survive internal refactors|testing past the interface/i);
});

test("AC-4 repair: task repair is executor-only without re-enter review", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  assert.doesNotMatch(execution, /re-enters review/i);
  assert.doesNotMatch(execution, /re-enter review/i);
  assert.match(
    execution,
    /report replacement green evidence to the parent for an executor-only focused-check decision|executor-only focused-check decision/i,
  );
  assert.match(execution, /Do not dispatch `gsdReviewer` per task/);
  assert.match(execution, /task repair[\s\S]{0,200}next_action` set to `start\/continue task`/);
  assert.match(execution, /enter terminal verification\/repair|whole-diff review|gsd-verify/);
});

test("AC-4 repair: architecture Explore friction and domain ambiguity", () => {
  const skill = read("skills/gsd-improve-codebase-architecture/SKILL.md");
  assert.match(skill, /## 1\. Explore/);
  // Exact friction definition examples
  assert.match(
    skill,
    /Note friction such as one concept bouncing across shallow modules, leaky seams, call-site coupling hidden by extracted pure functions, or behavior that cannot be tested through a stable interface/i,
  );
  // Pre-approval domain ambiguity: one focused question, no write
  assert.match(
    skill,
    /Before approval[\s\S]{0,160}one[- ]focused[- ]question[\s\S]{0,80}no[- ]write/i,
  );
  // Post-approval: Spec escalation or skip
  assert.match(
    skill,
    /(?:Inside approved execution|After approval|post-approval)[\s\S]{0,200}Spec escalation[\s\S]{0,120}skip/i,
  );
});

test("AC-4 repair: codebase-design targetless guard and rejected framings", () => {
  const skill = read("skills/gsd-codebase-design/SKILL.md");
  assert.match(skill, /Invocation guard/i);
  assert.match(
    skill,
    /If no module, interface, or area is supplied, stop and ask one focused target question/i,
  );
  assert.match(skill, /never survey the repository or invent a target/i);
  assert.match(skill, /## Rejected framings/);
  assert.match(
    skill,
    /Depth as ratio of implementation-lines to interface-lines/i,
  );
  assert.match(
    skill,
    /"Interface" as the TypeScript `interface` keyword or a class's public methods/i,
  );
  assert.match(skill, /"Boundary"[^.\n]*bounded context|overloaded with DDD's bounded context/i);
});

test("AC-4 repair: architecture candidate enums exact", () => {
  const skill = read("skills/gsd-improve-codebase-architecture/SKILL.md");
  assert.match(
    skill,
    /recommendation strength \(`Strong`\/`Worth exploring`\/`Speculative`\)/i,
  );
  assert.match(
    skill,
    /dependency category \(`in-process`\/`local-substitutable`\/`remote but owned`\/`true external`\)/i,
  );
});

test("AC-4 repair: executing task-repair reports grammar", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(
    execution,
    /records replacement green evidence for each invalidated check, and reports replacement green evidence to the parent for an executor-only focused-check decision/i,
  );
  assert.doesNotMatch(
    execution,
    /records replacement green evidence for each invalidated check, and report replacement green evidence/i,
  );
  assert.doesNotMatch(execution, /re-enters review/i);
  assert.doesNotMatch(execution, /re-enter review/i);
});
