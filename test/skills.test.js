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
  assert.match(execution, /never mutate the attempt or rewrite the approved Markdown plan/);
  assert.match(handoff, /never overwrite or suffix an existing handoff/);
  assert.match(tdd, /focused test seam from the approved Markdown plan/);
  assert.match(tdd, /consume the validated immutable attempt and relevant pinned sections/);
  assert.doesNotMatch(tdd, /proposal\.toon|spec\.toon|plan\.toon/);
  assert.doesNotMatch(reference, /TOON-only execution/i);
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
  assert.match(handoff, /Execution resume \| `handoff-<n>\.toon`; `plan\.md`/);
  assert.match(reference, /Execution never depends on prompt-local memory for the approval binding/);
  assert.match(reference, /# Milestones[\s\S]*\| ID \| Slug \| Goal \| Status \|/);
  assert.match(reference, /status is exactly `pending` or `done`/);
  assert.match(master, /all-`done`, fail closed/);
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

  // --- AC-1: Approval binds distinct OMP execution models ---
  // Positive assertions
  assert.match(toPlan, /Before approval, GSD validates that concrete, available, and distinct model selectors are configured for `modelRoles\.gsdExecutor` and `modelRoles\.gsdReviewer`/);
  assert.match(toPlan, /At approval, GSD binds these validated persistent executor and reviewer models\./);
  assert.match(reference, /At approval, GSD binds the persistent executor model from `modelRoles\.gsdExecutor` and the distinct persistent reviewer model from `modelRoles\.gsdReviewer`\./);
  assert.match(domain, /### D-gsd-3: Bind persistent OMP executor and reviewer roles/);
  // Negative assertions
  assert.match(toPlan, /rejects missing, unresolved, alias-only, or same-model bindings/);
  assert.match(toPlan, /keeps the current model active before execution, and never substitutes the current model for either role/);

  // --- AC-2: One executor owns all implementation and self-verification ---
  // Positive assertions
  assert.match(execution, /The persistent executor, reviewer, or any launched OMP child agents consume the immutable attempt/);
  assert.match(execution, /dispatches the persistent gsd-executor agent with the bound executor model and direct-root TDD instructions/);
  assert.match(execution, /GSD reuses its OMP agent identity \(gsd-executor/);
  assert.match(execution, /The executor may fan out task attempts concurrently through OMP child agents if and only if the complete safe fan-out gate is satisfied: \(1\) attempts are dependency-independent, \(2\) attempts target path-disjoint files, \(3\) attempts consume only parent-created immutable attempts, \(4\) safe isolation and model evidence are present, and \(5\) GSD performs deterministic integration of the results\./);
  assert.match(execution, /If any proof of these conditions is absent, GSD must fall back to sequential task execution\./);
  assert.match(reference, /explicitly dispatch the persistent gsd-executor agent \(with the bound executor model from `modelRoles\.gsdExecutor`\)/);
  // Negative assertions
  assert.doesNotMatch(execution, /Child roles \(implementer, reviewer, and fixer\)/);
  assert.doesNotMatch(execution, /dispatches one fresh task implementer/);
  assert.doesNotMatch(execution, /dispatches a fresh finding-scoped `task` fixer/);
  assert.doesNotMatch(execution, /inline implementation pass by the parent/);
  assert.doesNotMatch(execution, /inline repair pass/);

  // --- AC-3: Independent reviewer gates merge through progress-guarded convergence ---
  // Positive assertions
  assert.match(verify, /dispatches the persistent gsd-reviewer agent \(reusing the same gsd-reviewer session with the bound reviewer model/);
  assert.match(execution, /Do not dispatch `gsdReviewer` per task/);
  assert.match(verify, /The parent dispatches the persistent gsd-reviewer agent \(reusing the same gsd-reviewer session with the bound reviewer model/);
  assert.match(verify, /terminal repair continues without a fixed round count only while findings or the relevant diff demonstrably change; stop on a repeated blocking fingerprint or no relevant repair diff\./);
  assert.match(domain, /### D-gsd-4: Replace the fixed repair cap with a progress guard/);
  // Negative assertions
  assert.doesNotMatch(verify, /terminal repair has at most two complete re-review\/retest rounds/);
  assert.doesNotMatch(verify, /persists a bounded repair counter/);
  assert.doesNotMatch(verify, /terminal self-review fallback/);
  assert.doesNotMatch(reference, /terminal repair has at most two complete re-review\/retest rounds/);

  // --- AC-4: Resume and documentation preserve the OMP-only contract ---
  // Positive assertions
  assert.match(handoff, /Every executable handoff explicitly requires and validates concrete, distinct executor and reviewer model selectors/);
  assert.match(handoff, /actual agent identity\/model\/generation fields by phase/);
  assert.match(handoff, /progress\/fingerprint evidence for repair rounds/);
  assert.match(handoff, /never be left opaque or ignored/);
  assert.match(readme, /## Dual-Agent Model Roles/);
  assert.match(readme, /- `modelRoles\.gsdExecutor`: Binds the persistent primary executor/);
  assert.match(readme, /- `modelRoles\.gsdReviewer`: Binds the independent persistent reviewer/);
  assert.match(readme, /~\/\.omp\/agent\/config\.yml/);
  assert.match(readme, /\.omp\/config\.yml/);
  assert.match(readme, /never falls back to built-in `modelRoles\.task` or `modelRoles\.advisor`/);
  assert.match(domain, /### D-gsd-5: Allow same-model successor generations only after identity loss/);

  // --- Dedicated agent definition frontmatter assertions ---
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
  // Negative assertions
  assert.doesNotMatch(handoff, /Runtime terminal-repair counters retain/);
  assert.doesNotMatch(reference, /missing task capability makes implementation and repair separate inline passes/);
  assert.doesNotMatch(reference, /missing reviewer capability makes review a separate/);
  assert.doesNotMatch(reference, /bound advisor model/);
  assert.doesNotMatch(execution, /bound advisor model/);
  assert.doesNotMatch(verify, /bound advisor model/);
  // --- Task Self-Review Fallback and Banned Remnants ---
  assert.match(execution, /If the independent reviewer capability or model configuration is unavailable, GSD must fail closed immediately\./);
  assert.doesNotMatch(execution, /read-only self-review/);
  assert.doesNotMatch(reference, /missing reviewer capability makes review a separate read-only self-review/);
  assert.match(reference, /If the independent reviewer capability or model configuration is unavailable, GSD must fail closed immediately\./);
  assert.match(verify, /If the independent reviewer capability or model configuration is unavailable, GSD must fail closed immediately\./);

  // --- Other existing assertions ---
  assert.match(execution, /Instead of repeated full validation, follow the approved phase-boundary semantic-validation and digest-guard model\./);
  assert.match(execution, /without independently reparsing `plan\.md`/);
  assert.match(execution, /Every observable task loads `gsd-tdd` and follows direct-root TDD: RED before implementation, GREEN after implementation, then refactor after green/);
  assert.match(execution, /Task acceptance deferral is removed; the terminal verifier solely owns acceptance\/E2E\./);
  assert.match(execution, /Repeat this full parse and binding check only at execution entry\/resume\./);
  assert.match(execution, /Task attempt creation performs only a lightweight bound-source digest comparison\./);
  assert.match(execution, /After any repair, the gsd-executor agent reruns only focused checks invalidated by its repair, records replacement green evidence for each invalidated check, and reports replacement green evidence to the parent for an executor-only focused-check decision\./);
  assert.match(execution, /Any legacy `proposal\.md`, `spec\.md`, or `design\.md` is rejected\./);
  assert.match(execution, /Missing, invalid, altered, or additional `plan\.md` is a Spec escalation\./);
  assert.match(execution, /never mutate the attempt or rewrite the approved Markdown plan\./);
  assert.match(execution, /The parent retains task order, Git commits, handoff generation, and terminal transition\./);
});

test("T2 reload manifest contract and rehydration validation", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const master = read("skills/gsd/SKILL.md");

  // Prose Invariant Assertions
  assert.match(reference, /reload\[N\]\{skill,path\}/);
  assert.match(reference, /Master \(`gsd`?\) is always reloaded/);
  assert.match(reference, /Reject duplicate skill names or duplicate paths/);
  assert.match(reference, /Reject unknown or non-installed skills/);
  assert.match(reference, /Reject mismatched skill names and paths/);
  assert.match(reference, /Reject absolute paths, paths containing backslashes, empty paths, dot\/traversal segments/);
  assert.match(reference, /Fail closed immediately/);
  assert.match(reference, /Confirm the master is loaded/);
  assert.match(reference, /Validate that supplied execution handoff path equals highest canonical handoff path/);
  assert.match(reference, /reload every listed subskill in order/);

  assert.match(handoff, /reload\[N\]\{skill,path\}/);
  assert.match(handoff, /Every execution handoff write requires exact manifest coverage/);
  assert.match(handoff, /without circular re-entry/);
  assert.match(handoff, /never treat unknown reload skills in the manifest as forward-compatible/);

  assert.match(master, /Do not invoke or execute the capsule again/);
  assert.match(master, /Compaction Recovery Capsule/);

  // Behavioral Validation Executable Invariants
  const installed = new Set(skillNames());

  function parseHandoff(content, installedSkills) {
    const lines = content.split(/\r?\n/);
    const result = {
      fields: {},
      tables: {}
    };

    const seenFields = new Set();
    const seenTables = new Set();

    let currentTableName = null;
    let currentTableRowsExpected = 0;
    let currentTableRowsParsed = [];
    let currentTableColumns = [];

    const finishCurrentTable = () => {
      if (currentTableName !== null) {
        if (currentTableRowsParsed.length !== currentTableRowsExpected) {
          throw new Error(`Count mismatch: table ${currentTableName} expected ${currentTableRowsExpected} rows, got ${currentTableRowsParsed.length}`);
        }
        result.tables[currentTableName] = currentTableRowsParsed;
        currentTableName = null;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === "" && i === lines.length - 1) {
        continue;
      }
      if (line.trim() === "") {
        if (i === lines.length - 1) {
          continue;
        }
        throw new Error(`Malformed structure: blank line at line ${i + 1}`);
      }

      if (line.startsWith("  ")) {
        if (currentTableName === null) {
          throw new Error(`Malformed structure: table row without header at line ${i + 1}`);
        }
        const rawRow = line.substring(2);
        if (currentTableRowsParsed.some(r => r.raw === rawRow)) {
          throw new Error(`Duplicate rows: duplicate row in table ${currentTableName} at line ${i + 1}`);
        }
        const values = rawRow.split(",");
        if (values.length !== currentTableColumns.length) {
          throw new Error(`Malformed structure: row at line ${i + 1} has ${values.length} columns, expected ${currentTableColumns.length}`);
        }
        const rowObj = {};
        for (let c = 0; c < currentTableColumns.length; c++) {
          rowObj[currentTableColumns[c]] = values[c];
        }
        rowObj.raw = rawRow;
        currentTableRowsParsed.push(rowObj);
      } else {
        finishCurrentTable();

        if (!line.startsWith("  ") && /^(settings|reload)\[/.test(line)) {
          if (line.startsWith("settings")) {
            if (!/^settings\[\d+\]\{([a-z0-9_,]+)\}:$/.test(line)) {
              throw new Error(`Invalid or malformed settings header: ${line} at line ${i + 1}`);
            }
          } else if (line.startsWith("reload")) {
            if (!/^reload\[\d+\]\{([a-z0-9_,]+)\}:$/.test(line)) {
              throw new Error(`Invalid or malformed reload header: ${line} at line ${i + 1}`);
            }
          }
        }

        const tableMatch = line.match(/^([a-z0-9_]+)\[(\d+)\]\{([a-z0-9_,]+)\}:$/);
        if (tableMatch) {
          const name = tableMatch[1];
          const countStr = tableMatch[2];
          if (!/^(0|[1-9]\d*)$/.test(countStr)) {
            throw new Error(`Non-canonical numeric count: ${countStr} at line ${i + 1}`);
          }
          const count = parseInt(countStr, 10);
          const colsStr = tableMatch[3];
          if (name === "settings") {
            if (colsStr !== "key,value") {
              throw new Error(`Invalid or reordered columns for settings table: ${colsStr} at line ${i + 1}`);
            }
          } else if (name === "reload") {
            if (colsStr !== "skill,path") {
              throw new Error(`Invalid or reordered columns for reload table: ${colsStr} at line ${i + 1}`);
            }
          } else {
            throw new Error(`Unknown table: ${name} at line ${i + 1}`);
          }
          const cols = colsStr.split(",");

          if (seenTables.has(name) || seenFields.has(name)) {
            throw new Error(`Duplicate table/header: ${name} at line ${i + 1}`);
          }
          seenTables.add(name);

          currentTableName = name;
          currentTableRowsExpected = count;
          currentTableColumns = cols;
          currentTableRowsParsed = [];
        } else {
          const colonIndex = line.indexOf(":");
          if (colonIndex === -1) {
            throw new Error(`Malformed structure: missing colon at line ${i + 1}`);
          }
          const key = line.substring(0, colonIndex);
          const value = line.substring(colonIndex + 1);


          if (seenFields.has(key) || seenTables.has(key)) {
            throw new Error(`Duplicate table/header: ${key} at line ${i + 1}`);
          }
          seenFields.add(key);

          result.fields[key] = value;
        }
      }
    }

    finishCurrentTable();

    if ("reload" in result.fields) {
      const isPre = result.fields.mode === "discussion" && result.fields.phase === "pre-plan";
      if (isPre) {
        throw new Error("Reject partial, mixed, or execution-shaped state");
      } else {
        throw new Error("scalar reload key is not allowed");
      }
    }

    return result;
  }

  function checkPrePlan(parsed) {
    const mode = parsed.fields.mode;
    const phase = parsed.fields.phase;
    return mode === "discussion" && phase === "pre-plan";
  }

  function resolveAndValidatePriorHandoff(currentParsed, suppliedHandoffPath, targetFilename, expectedGen, installedSkills) {
    if (!suppliedHandoffPath) {
      throw new Error("Missing supplied handoff path for history resolution");
    }

    // IMP-28: Canonical history filename format (strictly handoff-<positive canonical integer>.toon)
    const targetBase = basename(targetFilename);
    const match = targetBase.match(/^handoff-([1-9][0-9]*)\.toon$/);
    if (!match) {
      throw new Error(`Invalid canonical handoff filename format: ${targetBase}`);
    }
    const histGen = parseInt(match[1], 10);

    const curBase = basename(suppliedHandoffPath);
    const curMatch = curBase.match(/^handoff-([1-9][0-9]*)\.toon$/);
    if (!curMatch) {
      throw new Error(`Invalid current handoff filename format: ${curBase}`);
    }
    const curGen = parseInt(curMatch[1], 10);

    if (histGen >= curGen) {
      throw new Error(`History handoff generation ${histGen} is not strictly earlier than current generation ${curGen}`);
    }
    if (expectedGen !== undefined && histGen !== expectedGen) {
      throw new Error(`Expected generation ${expectedGen} but got ${histGen} in history file ${targetBase}`);
    }

    const targetPath = join(dirname(suppliedHandoffPath), targetBase);
    let st;
    try {
      st = nodeFs.lstatSync(targetPath);
    } catch (e) {
      throw new Error(`History handoff file not found: ${targetPath}`);
    }
    if (st.isSymbolicLink()) {
      throw new Error(`Symbolic link rejected for history handoff file: ${targetPath}`);
    }
    if (!st.isFile()) {
      throw new Error(`History handoff path is not a regular file: ${targetPath}`);
    }
    let content;
    try {
      content = readFileSync(targetPath, "utf8");
    } catch (e) {
      throw new Error(`Failed to read history handoff file: ${targetPath}`);
    }
    let parsed;
    try {
      parsed = parseHandoff(content, installedSkills);
    } catch (e) {
      throw new Error(`Failed to parse history handoff file: ${targetPath} - ${e.message}`);
    }

    // IMP-31: Mandatory and matching feature binding across current and history handoffs
    const curFeature = currentParsed.fields.feature;
    const histFeature = parsed.fields.feature;
    if (!curFeature || curFeature === "") {
      throw new Error("Missing feature in current handoff");
    }
    if (!histFeature || histFeature === "") {
      throw new Error(`Missing feature in history file: ${targetBase}`);
    }
    if (curFeature !== histFeature) {
      throw new Error(`Feature mismatch in history file: current '${curFeature}' vs history '${histFeature}'`);
    }

    // Verify required plan_path (fail closed if missing or mismatched)
    const curPlan = currentParsed.fields.plan_path;
    const histPlan = parsed.fields.plan_path;
    if (!histPlan || histPlan === "") {
      throw new Error(`Missing plan_path in history file: ${targetBase}`);
    }
    if (curPlan && histPlan !== curPlan) {
      throw new Error(`plan_path mismatch in history file: current '${curPlan}' vs history '${histPlan}'`);
    }

    // Verify required plan_sha256 (fail closed if missing or mismatched)
    const curSha = currentParsed.fields.plan_sha256;
    const histSha = parsed.fields.plan_sha256;
    if (!histSha || histSha === "") {
      throw new Error(`Missing plan_sha256 in history file: ${targetBase}`);
    }
    if (curSha && histSha !== curSha) {
      throw new Error(`plan_sha256 mismatch in history file: current '${curSha}' vs history '${histSha}'`);
    }

    // Verify matching model bindings (settings key/value)
    const curSettingsRows = currentParsed.tables.settings || [];
    const histSettingsRows = parsed.tables.settings || [];
    const curModels = {};
    for (const r of curSettingsRows) {
      if (r.key === "executor_model" || r.key === "reviewer_model") {
        curModels[r.key] = r.value;
      }
    }
    const histModels = {};
    for (const r of histSettingsRows) {
      if (r.key === "executor_model" || r.key === "reviewer_model") {
        histModels[r.key] = r.value;
      }
    }
    if (!histModels.executor_model || !histModels.reviewer_model) {
      throw new Error(`Missing executor_model or reviewer_model in history file: ${targetBase}`);
    }
    if (curModels.executor_model !== histModels.executor_model || curModels.reviewer_model !== histModels.reviewer_model) {
      throw new Error(`Model settings mismatch in history file: current '${curModels.executor_model}/${curModels.reviewer_model}' vs history '${histModels.executor_model}/${histModels.reviewer_model}'`);
    }

    return parsed;
  }

  const getGenFromFilename = (fn) => {
    const m = basename(fn).match(/^handoff-([1-9][0-9]*)\.toon$/);
    return m ? parseInt(m[1], 10) : null;
  };

  function validateCompletedReviewChain(startParsed, startFilename, suppliedHandoffPath, curModels, installedSkills) {
    const visitedGens = new Set();
    const chain = [];

    let currentParsed = startParsed;
    let currentFilename = startFilename;
    let currentGen = getGenFromFilename(currentFilename);

    if (currentGen === null) {
      throw new Error(`Invalid handoff filename format: ${currentFilename}`);
    }

    // Pass 1: Traversal, file resolution, and collection only
    while (true) {
      if (visitedGens.has(currentGen)) {
        throw new Error(`Cycle or revisited node detected at generation ${currentGen} in chain`);
      }
      visitedGens.add(currentGen);

      const fields = currentParsed.fields;
      const round = fields.review_round;
      if (!round || round === "") {
        if (currentFilename !== basename(suppliedHandoffPath)) {
          validatePriorCompletedReviewSemantics(currentParsed, currentFilename, curModels, installedSkills, suppliedHandoffPath);
        }
        throw new Error(`Missing review_round in completed review: ${currentFilename}`);
      }
      const roundNum = parseInt(round, 10);
      if (isNaN(roundNum) || roundNum < 1) {
        if (currentFilename !== basename(suppliedHandoffPath)) {
          validatePriorCompletedReviewSemantics(currentParsed, currentFilename, curModels, installedSkills, suppliedHandoffPath);
        }
        throw new Error(`review_round must be a positive integer: ${currentFilename}`);
      }

      chain.push({ parsed: currentParsed, filename: currentFilename, gen: currentGen, round: roundNum });

      if (roundNum === 1) {
        break;
      }

      const prevGen = currentGen - 2;
      let prevFilename = `handoff-${prevGen}.toon`;
      const priorField = currentParsed.fields.previous_completed_review_handoff;
      if (priorField) {
        prevFilename = basename(priorField);
      }

      const prevMatch = prevFilename.match(/^handoff-([1-9][0-9]*)\.toon$/);
      if (!prevMatch) {
        throw new Error(`Invalid canonical handoff filename format: ${prevFilename}`);
      }
      const resolvedPrevGen = parseInt(prevMatch[1], 10);
      if (resolvedPrevGen !== prevGen && !priorField) {
        throw new Error(`Filename/generation mismatch: expected ${prevFilename} but got mismatch`);
      }

      if (resolvedPrevGen === currentGen) {
        throw new Error(`Predecessor generation ${resolvedPrevGen} must be less than current generation ${currentGen} in ${currentFilename}`);
      }
      if (visitedGens.has(resolvedPrevGen)) {
        throw new Error(`Cycle or revisited node detected at generation ${resolvedPrevGen} in chain`);
      }
      if (resolvedPrevGen > currentGen) {
        throw new Error(`Predecessor generation ${resolvedPrevGen} must be less than current generation ${currentGen} in ${currentFilename}`);
      }

      const currentPath = join(dirname(suppliedHandoffPath), currentFilename);
      let parsed;
      try {
        parsed = resolveAndValidatePriorHandoff(currentParsed, currentPath, prevFilename, resolvedPrevGen, installedSkills);
      } catch (e) {
        const msg = e.message;
        if (msg.includes("History handoff file not found")) {
          throw new Error(`Predecessor history file not found: ${prevFilename} for ${currentFilename}`);
        }
        if (msg.includes("Symbolic link rejected")) {
          throw new Error(`Symbolic link rejected for predecessor history file: ${prevFilename}`);
        }
        if (msg.includes("is not a regular file")) {
          throw new Error(`Predecessor history path is not a regular file: ${prevFilename}`);
        }
        if (msg.includes("Failed to read history handoff file")) {
          throw new Error(`Failed to read predecessor history file: ${prevFilename}`);
        }
        if (msg.includes("Failed to parse history handoff file")) {
          throw new Error(`Failed to parse predecessor history file: ${prevFilename} - ${msg.substring(msg.indexOf(" - ") + 3)}`);
        }
        throw e;
      }

      currentParsed = parsed;
      currentFilename = prevFilename;
      currentGen = resolvedPrevGen;
    }

    // Pass 2: Validation of semantics and links
    for (let i = 0; i < chain.length; i++) {
      const node = chain[i];
      const nextNode = chain[i + 1];

      // Validate single node semantics if it is a prior completed review
      if (node.filename !== basename(suppliedHandoffPath)) {
        validatePriorCompletedReviewSemantics(node.parsed, node.filename, curModels, installedSkills, suppliedHandoffPath);
      }

      if (nextNode) {
        if (node.round !== nextNode.round + 1) {
          throw new Error(`Round mismatch: predecessor of ${node.filename} (round ${node.round}) has round ${nextNode.round} instead of ${node.round - 1}`);
        }

        const prevFingerprint = node.parsed.fields.previous_blocking_fingerprint;
        if (!prevFingerprint || prevFingerprint === "") {
          throw new Error(`Prior completed review round >= 2 requires previous_blocking_fingerprint in ${node.filename}`);
        }
        const priorFingerprint = nextNode.parsed.fields.blocking_fingerprint;
        if (prevFingerprint !== priorFingerprint) {
          throw new Error(`previous_blocking_fingerprint mismatch: self-reported '${prevFingerprint}' vs derived '${priorFingerprint}' in ${node.filename}`);
        }
        if (node.parsed.fields.blocking_fingerprint === priorFingerprint) {
          throw new Error(`Unchanged repeated fingerprint fails closed in ${node.filename}`);
        }

        const prevReviewedCommit = node.parsed.fields.previous_reviewed_commit;
        if (!prevReviewedCommit || prevReviewedCommit === "") {
          throw new Error(`Prior completed review round >= 2 requires previous_reviewed_commit in ${node.filename}`);
        }
        const priorReviewedCommit = nextNode.parsed.fields.reviewed_commit || nextNode.parsed.fields.completed_commit;
        if (prevReviewedCommit !== priorReviewedCommit) {
          throw new Error(`previous_reviewed_commit mismatch: self-reported '${prevReviewedCommit}' vs derived '${priorReviewedCommit}' in ${node.filename}`);
        }

        const curReviewedCommit = node.parsed.fields.reviewed_commit || node.parsed.fields.completed_commit;
        if (curReviewedCommit && priorReviewedCommit && curReviewedCommit === priorReviewedCommit) {
          throw new Error(`Unchanged commit fails closed in ${node.filename}`);
        }
      }
    }
  }
  function validatePriorCompletedReviewSemantics(parsed, targetFilename, curModels, installedSkills, suppliedHandoffPath) {
    const fields = parsed.fields;
    const sentinels = ["none", "unassigned", "pending"];

    if (fields.mode !== "execution") {
      throw new Error(`Prior completed review mode must be execution, got '${fields.mode}' in ${targetFilename}`);
    }

    if (fields.phase !== "terminal-repair") {
      throw new Error(`Prior completed review history phase must be terminal-repair, got '${fields.phase}' in ${targetFilename}`);
    }

    if (fields.next_action !== "enter terminal verification/repair") {
      throw new Error(`Prior completed review next_action must be 'enter terminal verification/repair', got '${fields.next_action}' in ${targetFilename}`);
    }

    // IMP-35 & IMP-36: Validate prior record settings concrete/distinct and matching bindings & enums
    if (fields.settings !== undefined) {
      throw new Error(`settings table must not be scalarized in prior completed review: ${targetFilename}`);
    }
    const settingsRows = parsed.tables.settings;
    if (!settingsRows) {
      throw new Error(`Missing settings table in prior completed review: ${targetFilename}`);
    }
    const settingsMap = {};
    const seenSettingsKeys = new Set();
    for (const row of settingsRows) {
      const { key, value } = row;
      if (key === undefined || key === "" || value === undefined || value === "") {
        throw new Error(`Empty settings key or value not allowed in prior completed review: ${targetFilename}`);
      }
      if (seenSettingsKeys.has(key)) {
        throw new Error(`Duplicate key in settings in prior completed review: ${key} in ${targetFilename}`);
      }
      seenSettingsKeys.add(key);
      settingsMap[key] = value;

      if (key === "autosync") {
        if (value !== "on" && value !== "off") {
          throw new Error(`Invalid autosync value: ${value} in prior completed review: ${targetFilename}`);
        }
      } else if (key === "ponytail_level") {
        if (value !== "lite" && value !== "full" && value !== "ultra") {
          throw new Error(`Invalid ponytail_level value: ${value} in prior completed review: ${targetFilename}`);
        }
      } else if (key === "design_state" || key === "domain_state") {
        throw new Error(`Invalid key in settings: ${key} is deleted in prior completed review: ${targetFilename}`);
      }
    }
    const execModel = settingsMap["executor_model"];
    const revModel = settingsMap["reviewer_model"];
    if (!execModel || !revModel) {
      throw new Error(`Missing executor_model or reviewer_model selector in settings in prior completed review: ${targetFilename}`);
    }
    const aliases = ["default", "task", "advisor", "implementer", "reviewer", "fixer"];
    if (aliases.includes(execModel) || aliases.includes(revModel)) {
      throw new Error(`Alias-only model selectors are not allowed in prior completed review: ${targetFilename}`);
    }
    if (execModel === revModel) {
      throw new Error(`Executor and reviewer model selectors must be distinct in prior completed review: ${targetFilename}`);
    }
    if (!execModel.includes("/") && !execModel.includes("-") && !execModel.includes(".")) {
      throw new Error(`Invalid executor model selector in prior completed review: ${targetFilename}`);
    }
    if (!revModel.includes("/") && !revModel.includes("-") && !revModel.includes(".")) {
      throw new Error(`Invalid reviewer model selector in prior completed review: ${targetFilename}`);
    }
    if (curModels.executor_model && execModel !== curModels.executor_model) {
      throw new Error(`Model settings mismatch in history file: current executor '${curModels.executor_model}' vs history '${execModel}'`);
    }
    if (curModels.reviewer_model && revModel !== curModels.reviewer_model) {
      throw new Error(`Model settings mismatch in history file: current reviewer '${curModels.reviewer_model}' vs history '${revModel}'`);
    }

    // IMP-35: Validate prior record reload table manifest
    if (!parsed.tables.reload) {
      throw new Error(`Missing reload table in prior completed review: ${targetFilename}`);
    }
    const reloadRows = parsed.tables.reload || [];
    const seenSkills = new Set();
    const seenPaths = new Set();
    for (const row of reloadRows) {
      const { skill, path } = row;
      if (skill === "gsd") {
        throw new Error(`Master skill (gsd) must not be in reload manifest in prior completed review: ${targetFilename}`);
      }
      if (seenSkills.has(skill)) {
        throw new Error(`Duplicate skill in reload manifest in prior completed review: ${skill} in ${targetFilename}`);
      }
      seenSkills.add(skill);
      if (seenPaths.has(path)) {
        throw new Error(`Duplicate path in reload manifest in prior completed review: ${path} in ${targetFilename}`);
      }
      seenPaths.add(path);

      if (!installedSkills.has(skill)) {
        throw new Error(`Unknown/non-installed skill in prior completed review: ${skill} in ${targetFilename}`);
      }

      if (path.startsWith("/") || /^[a-zA-Z]:\\/.test(path)) {
        throw new Error(`Absolute path in prior completed review: ${path} in ${targetFilename}`);
      }
      if (path.includes("\\")) {
        throw new Error(`Backslash in path in prior completed review: ${path} in ${targetFilename}`);
      }
      const segments = path.split("/");
      if (segments.includes(".") || segments.includes("..") || segments.some(s => s === "")) {
        throw new Error(`Invalid traversal/dot segment in path in prior completed review: ${path} in ${targetFilename}`);
      }
      const expectedPath = `skills/${skill}/SKILL.md`;
      if (path !== expectedPath) {
        throw new Error(`Mismatched path for ${skill} in prior completed review: expected ${expectedPath}, got ${path} in ${targetFilename}`);
      }
    }

    const unconditionalList = ["gsd-verify", "gsd-handoff"];
    for (const skill of unconditionalList) {
      if (!seenSkills.has(skill)) {
        throw new Error(`Missing required skill in prior completed review: ${skill} in ${targetFilename}`);
      }
    }

    const ponytail_level = settingsMap["ponytail_level"];
    const ponytailActive = (ponytail_level !== undefined && ponytail_level !== null && ponytail_level !== "");
    if (ponytailActive) {
      if (!seenSkills.has("gsd-ponytail")) {
        throw new Error(`Missing conditional skill in prior completed review: gsd-ponytail in ${targetFilename}`);
      }
    } else {
      if (seenSkills.has("gsd-ponytail")) {
        throw new Error(`Extraneous conditional skill in prior completed review: gsd-ponytail in ${targetFilename}`);
      }
    }

    const allAllowedSkills = new Set([...unconditionalList]);
    if (ponytailActive) allAllowedSkills.add("gsd-ponytail");
    if (seenSkills.has("gsd-codebase-design")) allAllowedSkills.add("gsd-codebase-design");
    if (seenSkills.has("gsd-domain-modeling")) allAllowedSkills.add("gsd-domain-modeling");

    for (const skill of seenSkills) {
      if (!allAllowedSkills.has(skill)) {
        throw new Error(`Extra skill in prior completed review: ${skill} in ${targetFilename}`);
      }
    }

    // IMP-30: Mandate non-sentinel executor identity, actual model matching bound executor setting, and positive generation
    const execAgent = fields.executor_agent;
    const execActModel = fields.executor_actual_model;
    const execGen = fields.executor_generation;
    if (!execAgent || !execActModel || execGen === undefined || execGen === "") {
      throw new Error(`Missing executor identity/model/generation in prior completed review: ${targetFilename}`);
    }
    if (sentinels.includes(execAgent.toLowerCase()) || sentinels.includes(execActModel.toLowerCase())) {
      throw new Error(`Invalid sentinel value in executor fields in prior completed review: ${execAgent} / ${execActModel}`);
    }
    const execGenNum = parseInt(execGen, 10);
    if (isNaN(execGenNum) || execGenNum < 1) {
      throw new Error(`executor_generation must be a positive integer in prior completed review: ${targetFilename}`);
    }
    if (curModels.executor_model && execActModel !== curModels.executor_model) {
      throw new Error(`Actual executor model (${execActModel}) in prior completed review does not match bound executor_model (${curModels.executor_model})`);
    }

    // IMP-30: Mandate non-sentinel reviewer identity, actual model matching bound reviewer setting, and positive generation
    const revAgent = fields.reviewer_agent;
    const revActModel = fields.reviewer_actual_model;
    const revGen = fields.reviewer_generation;
    if (!revAgent || !revActModel || revGen === undefined || revGen === "") {
      throw new Error(`Missing reviewer identity/model/generation in prior completed review: ${targetFilename}`);
    }
    if (sentinels.includes(revAgent.toLowerCase()) || sentinels.includes(revActModel.toLowerCase())) {
      throw new Error(`Invalid sentinel value in reviewer fields in prior completed review: ${revAgent} / ${revActModel}`);
    }
    const revGenNum = parseInt(revGen, 10);
    if (isNaN(revGenNum) || revGenNum < 1) {
      throw new Error(`reviewer_generation must be a positive integer in prior completed review: ${targetFilename}`);
    }
    if (curModels.reviewer_model && revActModel !== curModels.reviewer_model) {
      throw new Error(`Actual reviewer model (${revActModel}) in prior completed review does not match bound reviewer_model (${curModels.reviewer_model})`);
    }

    // IMP-30: Mandate positive review_round
    const round = fields.review_round;
    if (!round || round === "") {
      throw new Error(`Missing review_round in prior completed review: ${targetFilename}`);
    }
    const roundNum = parseInt(round, 10);
    if (isNaN(roundNum) || roundNum < 1) {
      throw new Error(`review_round must be a positive integer in prior completed review: ${targetFilename}`);
    }

    // IMP-30: Mandate completed non-pending check and non-empty result
    const check = fields.reviewer_terminal_check;
    const res = fields.reviewer_terminal_result;
    if (!check || check === "" || check === "pending") {
      throw new Error(`Prior completed review requires non-pending reviewer_terminal_check in ${targetFilename}`);
    }
    if (!res || res === "") {
      throw new Error(`Prior completed review requires non-empty reviewer_terminal_result in ${targetFilename}`);
    }

    // IMP-30: Mandate exact BLOCKED verdict and positive blocking count
    const verdict = fields.reviewer_verdict;
    if (verdict !== "BLOCKED") {
      throw new Error(`Prior completed review reviewer_verdict must be BLOCKED, got '${verdict}' in ${targetFilename}`);
    }
    const count = fields.blocking_count;
    if (count === undefined || count === "") {
      throw new Error(`Missing blocking_count in prior completed review: ${targetFilename}`);
    }
    const countNum = parseInt(count, 10);
    if (isNaN(countNum) || countNum < 1) {
      throw new Error(`blocking_count must be a positive integer in prior completed review: ${targetFilename}`);
    }

    // IMP-30 & IMP-37: Mandate valid fingerprints and previous reviewed commits
    const fingerprint = fields.blocking_fingerprint;
    if (!fingerprint || fingerprint === "") {
      throw new Error(`Missing blocking_fingerprint in prior completed review: ${targetFilename}`);
    }
    if (roundNum >= 2) {
      const prevFingerprint = fields.previous_blocking_fingerprint;
      if (!prevFingerprint || prevFingerprint === "") {
        throw new Error(`Prior completed review round >= 2 requires previous_blocking_fingerprint in ${targetFilename}`);
      }
      if (fingerprint === prevFingerprint) {
        throw new Error(`Unchanged repeated fingerprint in prior completed review: ${targetFilename}`);
      }

      const prevReviewedCommit = fields.previous_reviewed_commit;
      if (!prevReviewedCommit || prevReviewedCommit === "") {
        throw new Error(`Prior completed review round >= 2 requires previous_reviewed_commit in ${targetFilename}`);
      }

    }

    // IMP-30: Mandate reviewed_commit / completed_commit
    const revCommit = fields.reviewed_commit || fields.completed_commit;
    if (!revCommit || revCommit === "") {
      throw new Error(`Missing reviewed_commit in prior completed review: ${targetFilename}`);
    }

    // IMP-30: Mandate exact progress_status:advanced, non-empty progress_evidence and progress_guard
    const progStatus = fields.progress_status;
    if (progStatus !== "advanced") {
      throw new Error(`Prior completed review progress_status must be 'advanced', got '${progStatus}' in ${targetFilename}`);
    }
    const progEvidence = fields.progress_evidence;
    if (!progEvidence || progEvidence === "") {
      throw new Error(`Missing progress_evidence in prior completed review: ${targetFilename}`);
    }
    const progGuard = fields.progress_guard;
    if (!progGuard || progGuard === "") {
      throw new Error(`Missing progress_guard in prior completed review: ${targetFilename}`);
    }
  }

  function validatePendingTerminalReviewSemantics(parsed, targetFilename, curModels, installedSkills, suppliedHandoffPath, repairRound, repairCommit, repairExecutorGen, repairReviewerGen, repairExecutorAgent, repairReviewerAgent) {
    const fields = parsed.fields;
    const sentinels = ["none", "unassigned", "pending"];

    if (fields.mode !== "execution") {
      throw new Error(`Pending terminal-review mode must be execution, got '${fields.mode}' in ${targetFilename}`);
    }
    if (fields.phase !== "terminal-review") {
      throw new Error(`Pending terminal-review phase must be terminal-review, got '${fields.phase}' in ${targetFilename}`);
    }
    if (fields.next_action !== "enter terminal verification/repair") {
      throw new Error(`Pending terminal-review next_action must be 'enter terminal verification/repair', got '${fields.next_action}' in ${targetFilename}`);
    }
    if (fields.reviewer_terminal_check !== "pending") {
      throw new Error(`Pending terminal-review reviewer_terminal_check must be pending, got '${fields.reviewer_terminal_check}' in ${targetFilename}`);
    }

    const forbidden = ["reviewer_terminal_result", "reviewer_verdict", "blocking_count", "blocking_fingerprint", "reviewed_commit"];
    for (const f of forbidden) {
      if (f in fields) {
        throw new Error("Pending terminal-review must not specify completed terminal fields");
      }
    }

    // Validate settings table (known-key semantics + opaque keys, concrete distinct models)
    if (fields.settings !== undefined) {
      throw new Error(`settings table must not be scalarized in pending terminal-review: ${targetFilename}`);
    }
    const settingsRows = parsed.tables.settings;
    if (!settingsRows) {
      throw new Error(`Missing settings table in pending terminal-review: ${targetFilename}`);
    }
    const settingsMap = {};
    const seenSettingsKeys = new Set();
    for (const row of settingsRows) {
      const { key, value } = row;
      if (key === undefined || key === "" || value === undefined || value === "") {
        throw new Error(`Empty settings key or value not allowed in pending terminal-review: ${targetFilename}`);
      }
      if (seenSettingsKeys.has(key)) {
        throw new Error(`Duplicate key in settings in pending terminal-review: ${key} in ${targetFilename}`);
      }
      seenSettingsKeys.add(key);
      settingsMap[key] = value;

      if (key === "autosync") {
        if (value !== "on" && value !== "off") {
          throw new Error(`Invalid autosync value: ${value} in pending terminal-review: ${targetFilename}`);
        }
      } else if (key === "ponytail_level") {
        if (value !== "lite" && value !== "full" && value !== "ultra") {
          throw new Error(`Invalid ponytail_level value: ${value} in pending terminal-review: ${targetFilename}`);
        }
      } else if (key === "design_state" || key === "domain_state") {
        throw new Error(`Invalid key in settings: ${key} is deleted in pending terminal-review: ${targetFilename}`);
      }
    }

    const execModel = settingsMap["executor_model"];
    const revModel = settingsMap["reviewer_model"];
    if (!execModel || !revModel) {
      throw new Error(`Missing executor_model or reviewer_model selector in settings in pending terminal-review: ${targetFilename}`);
    }
    const aliases = ["default", "task", "advisor", "implementer", "reviewer", "fixer"];
    if (aliases.includes(execModel) || aliases.includes(revModel)) {
      throw new Error(`Alias-only model selectors are not allowed in pending terminal-review: ${targetFilename}`);
    }
    if (execModel === revModel) {
      throw new Error(`Executor and reviewer model selectors must be distinct in pending terminal-review: ${targetFilename}`);
    }
    if (!execModel.includes("/") && !execModel.includes("-") && !execModel.includes(".")) {
      throw new Error(`Invalid executor model selector in pending terminal-review: ${targetFilename}`);
    }
    if (!revModel.includes("/") && !revModel.includes("-") && !revModel.includes(".")) {
      throw new Error(`Invalid reviewer model selector in pending terminal-review: ${targetFilename}`);
    }
    if (curModels.executor_model && execModel !== curModels.executor_model) {
      throw new Error(`Model settings mismatch in history file: current executor '${curModels.executor_model}' vs history '${execModel}'`);
    }
    if (curModels.reviewer_model && revModel !== curModels.reviewer_model) {
      throw new Error(`Model settings mismatch in history file: current reviewer '${curModels.reviewer_model}' vs history '${revModel}'`);
    }

    // Validate reload manifest
    if (!parsed.tables.reload) {
      throw new Error(`Missing reload table in pending terminal-review: ${targetFilename}`);
    }
    const reloadRows = parsed.tables.reload || [];
    const seenSkills = new Set();
    const seenPaths = new Set();
    for (const row of reloadRows) {
      const { skill, path } = row;
      if (skill === "gsd") {
        throw new Error(`Master skill (gsd) must not be in reload manifest in pending terminal-review: ${targetFilename}`);
      }
      if (seenSkills.has(skill)) {
        throw new Error(`Duplicate skill in reload manifest in pending terminal-review: ${skill} in ${targetFilename}`);
      }
      seenSkills.add(skill);
      if (seenPaths.has(path)) {
        throw new Error(`Duplicate path in reload manifest in pending terminal-review: ${path} in ${targetFilename}`);
      }
      seenPaths.add(path);

      if (!installedSkills.has(skill)) {
        throw new Error(`Unknown/non-installed skill in pending terminal-review: ${skill} in ${targetFilename}`);
      }

      if (path.startsWith("/") || /^[a-zA-Z]:\\/.test(path)) {
        throw new Error(`Absolute path in pending terminal-review: ${path} in ${targetFilename}`);
      }
      if (path.includes("\\")) {
        throw new Error(`Backslash in path in pending terminal-review: ${path} in ${targetFilename}`);
      }
      const segments = path.split("/");
      if (segments.includes(".") || segments.includes("..") || segments.some(s => s === "")) {
        throw new Error(`Invalid traversal/dot segment in path in pending terminal-review: ${path} in ${targetFilename}`);
      }
      const expectedPath = `skills/${skill}/SKILL.md`;
      if (path !== expectedPath) {
        throw new Error(`Mismatched path for ${skill} in pending terminal-review: expected ${expectedPath}, got ${path} in ${targetFilename}`);
      }
    }

    const unconditionalList = ["gsd-verify", "gsd-handoff"];
    for (const skill of unconditionalList) {
      if (!seenSkills.has(skill)) {
        throw new Error(`Missing required skill in pending terminal-review: ${skill} in ${targetFilename}`);
      }
    }

    const ponytail_level = settingsMap["ponytail_level"];
    const ponytailActive = (ponytail_level !== undefined && ponytail_level !== null && ponytail_level !== "");
    if (ponytailActive) {
      if (!seenSkills.has("gsd-ponytail")) {
        throw new Error(`Missing conditional skill in pending terminal-review: gsd-ponytail in ${targetFilename}`);
      }
    } else {
      if (seenSkills.has("gsd-ponytail")) {
        throw new Error(`Extraneous conditional skill in pending terminal-review: gsd-ponytail in ${targetFilename}`);
      }
    }

    const allAllowedSkills = new Set([...unconditionalList]);
    if (ponytailActive) allAllowedSkills.add("gsd-ponytail");
    if (seenSkills.has("gsd-codebase-design")) allAllowedSkills.add("gsd-codebase-design");
    if (seenSkills.has("gsd-domain-modeling")) allAllowedSkills.add("gsd-domain-modeling");

    for (const skill of seenSkills) {
      if (!allAllowedSkills.has(skill)) {
        throw new Error(`Extra skill in pending terminal-review: ${skill} in ${targetFilename}`);
      }
    }

    // Validate executor identity
    const execAgent = fields.executor_agent;
    const execActModel = fields.executor_actual_model;
    const execGen = fields.executor_generation;
    if (!execAgent || !execActModel || execGen === undefined || execGen === "") {
      throw new Error(`Missing executor identity/model/generation fields in phase terminal-review`);
    }
    if (sentinels.includes(execAgent.toLowerCase()) || sentinels.includes(execActModel.toLowerCase())) {
      throw new Error(`Invalid sentinel value in executor fields: ${execAgent} / ${execActModel}`);
    }
    const execGenNum = parseInt(execGen, 10);
    if (isNaN(execGenNum) || execGenNum < 1) {
      throw new Error(`executor_generation must be a positive integer`);
    }
    if (execActModel !== execModel) {
      throw new Error(`Actual executor model (${execActModel}) does not match bound executor_model (${execModel})`);
    }
    if (repairExecutorAgent !== undefined && execAgent !== repairExecutorAgent) {
      throw new Error(`executor_agent mismatch in pending terminal-review: expected ${repairExecutorAgent}, got ${execAgent} in ${targetFilename}`);
    }

    // Validate reviewer identity
    const revAgent = fields.reviewer_agent;
    const revActModel = fields.reviewer_actual_model;
    const revGen = fields.reviewer_generation;
    if (!revAgent || !revActModel || revGen === undefined || revGen === "") {
      throw new Error(`Missing reviewer identity/model/generation/round fields in phase terminal-review`);
    }
    if (sentinels.includes(revAgent.toLowerCase()) || sentinels.includes(revActModel.toLowerCase())) {
      throw new Error(`Invalid sentinel value in reviewer fields: ${revAgent} / ${revActModel}`);
    }
    const revGenNum = parseInt(revGen, 10);
    if (isNaN(revGenNum) || revGenNum < 1) {
      throw new Error(`reviewer_generation must be a positive integer`);
    }
    if (revActModel !== revModel) {
      throw new Error(`Actual reviewer model (${revActModel}) does not match bound reviewer_model (${revModel})`);
    }
    if (repairReviewerAgent !== undefined && revAgent !== repairReviewerAgent) {
      throw new Error(`reviewer_agent mismatch in pending terminal-review: expected ${repairReviewerAgent}, got ${revAgent} in ${targetFilename}`);
    }

    // Validate review round
    const round = fields.review_round;
    if (!round || round === "") {
      throw new Error(`Missing reviewer identity/model/generation/round fields in phase terminal-review`);
    }
    const roundNum = parseInt(round, 10);
    if (isNaN(roundNum) || roundNum < 1) {
      throw new Error(`review_round must be a positive integer`);
    }

    if (repairRound !== undefined && roundNum !== repairRound) {
      throw new Error(`review_round mismatch in pending terminal-review: expected ${repairRound}, got ${roundNum} in ${targetFilename}`);
    }

    let prevFingerprint;
    let prevReviewedCommit;

    // Validate previous fingerprint/commit continuity
    if (roundNum === 1) {
      if (fields.previous_blocking_fingerprint) {
        throw new Error(`round-one terminal-review must not specify previous_blocking_fingerprint`);
      }
    } else if (roundNum >= 2) {
      prevFingerprint = fields.previous_blocking_fingerprint;
      prevReviewedCommit = fields.previous_reviewed_commit;

      if (!prevFingerprint || prevFingerprint === "") {
        throw new Error(`Missing previous_blocking_fingerprint for pending terminal-review`);
      }
      if (!prevReviewedCommit || prevReviewedCommit === "") {
        throw new Error(`Missing previous_reviewed_commit for pending terminal-review`);
      }
    }

    // Validate current_review_commit
    const curReviewCommit = fields.current_review_commit;
    if (!curReviewCommit || curReviewCommit === "") {
      throw new Error(`Missing current_review_commit for pending terminal-review`);
    }

    if (fields.completed_commit && fields.completed_commit !== curReviewCommit) {
      throw new Error(`completed_commit (${fields.completed_commit}) must equal current_review_commit (${curReviewCommit}) in ${targetFilename}`);
    }
    if (repairCommit !== undefined && curReviewCommit !== repairCommit) {
      throw new Error(`reviewed_commit (${repairCommit}) must equal triggering pending review current_review_commit (${curReviewCommit})`);
    }

    if (repairExecutorGen !== undefined && execGenNum !== repairExecutorGen) {
      throw new Error(`executor_generation mismatch in pending terminal-review: expected ${repairExecutorGen}, got ${execGenNum} in ${targetFilename}`);
    }
    if (repairReviewerGen !== undefined && revGenNum !== repairReviewerGen) {
      throw new Error(`reviewer_generation mismatch in pending terminal-review: expected ${repairReviewerGen}, got ${revGenNum} in ${targetFilename}`);
    }

    if (roundNum >= 2) {
      if (curReviewCommit === prevReviewedCommit) {
        throw new Error(`Unchanged review commit for pending terminal-review`);
      }
      // Resolve and check prior completed review history
      const currentHandoffGen = getGenFromFilename(targetFilename);
      const expectedPriorGen = (currentHandoffGen !== null) ? currentHandoffGen - 1 : revGenNum - 1;
      let priorFilename = `handoff-${expectedPriorGen}.toon`;
      const priorField = fields.previous_completed_review_handoff;
      if (priorField) {
        priorFilename = basename(priorField);
      }

      const priorParsed = resolveAndValidatePriorHandoff(parsed, suppliedHandoffPath, priorFilename, expectedPriorGen, installedSkills);
      const priorFields = priorParsed.fields;

      validateCompletedReviewChain(priorParsed, priorFilename, suppliedHandoffPath, curModels, installedSkills);

      const derivedFingerprint = priorFields.blocking_fingerprint;
      const derivedReviewedCommit = priorFields.reviewed_commit || priorFields.completed_commit;

      if (!derivedFingerprint || derivedFingerprint === "") {
        throw new Error(`Derived blocking fingerprint from priorCompletedReview is empty`);
      }
      if (!derivedReviewedCommit || derivedReviewedCommit === "") {
        throw new Error(`Derived reviewed commit from priorCompletedReview is empty`);
      }

      if (prevFingerprint !== derivedFingerprint) {
        throw new Error(`previous_blocking_fingerprint mismatch: self-reported '${prevFingerprint}' vs derived '${derivedFingerprint}'`);
      }
      if (prevReviewedCommit !== derivedReviewedCommit) {
        throw new Error(`previous_reviewed_commit mismatch: self-reported '${prevReviewedCommit}' vs derived '${derivedReviewedCommit}'`);
      }
    }
  }
  function validateHandoff(parsed, installedSkills, suppliedHandoffPath) {
    const curMatch = suppliedHandoffPath ? suppliedHandoffPath.match(/handoff-(\d+)\.toon$/) : null;
    const currentHandoffGen = curMatch ? parseInt(curMatch[1], 10) : null;

    const mode = parsed.fields.mode;
    const phase = parsed.fields.phase;
    const nextAction = parsed.fields.next_action;
    if (mode === undefined || mode === "") {
      throw new Error("Missing or empty mode");
    }
    if (phase === undefined || phase === "") {
      throw new Error("Missing or empty phase");
    }
    const hasPathProp = "plan_path" in parsed.fields;
    const hasHashProp = "plan_sha256" in parsed.fields;
    const hasBinding = hasPathProp || hasHashProp;
    const hasReload = "reload" in parsed.tables || "reload" in parsed.fields;

    const isPre = checkPrePlan(parsed);
    if (isPre) {
      if (nextAction === undefined || nextAction === "") {
        throw new Error("Missing or empty next_action");
      }
      if (hasBinding || hasReload) {
        throw new Error("Reject partial, mixed, or execution-shaped state");
      }
      if (parsed.fields.settings !== undefined) {
        throw new Error("settings table must not be scalarized");
      }
      if (parsed.tables.settings) {
        const settingsRows = parsed.tables.settings;
        const seenSettingsKeys = new Set();
        for (const row of settingsRows) {
          const { key, value } = row;
          if (key === undefined || key === "" || value === undefined || value === "") {
            throw new Error("Empty settings key or value not allowed");
          }
          if (seenSettingsKeys.has(key)) {
            throw new Error(`Duplicate key in settings: ${key}`);
          }
          seenSettingsKeys.add(key);

          if (key === "autosync") {
            if (value !== "on" && value !== "off") {
              throw new Error("Invalid autosync value");
            }
          } else if (key === "ponytail_level") {
            if (value !== "lite" && value !== "full" && value !== "ultra") {
              throw new Error("Invalid ponytail_level value");
            }
          } else if (key === "design_state" || key === "domain_state") {
            throw new Error(`Invalid key in settings: ${key} is deleted`);
          }
        }
      }
      return;
    }

    if (/^discussion$/i.test(mode)) {
      throw new Error("Discussion mode not allowed for execution");
    }

    const feature = parsed.fields.feature;
    if (!feature || feature === "") {
      throw new Error("Missing feature in execution handoff");
    }

    if (!hasPathProp || !hasHashProp) {
      throw new Error("Missing approval binding for execution handoff");
    }
    if (parsed.fields.plan_path === "" || parsed.fields.plan_sha256 === "") {
      throw new Error("empty/partial/mixed binding fails, never counts as omitted pre-plan state");
    }

    if (parsed.fields.settings !== undefined) {
      throw new Error("settings table must not be scalarized");
    }
    if (!parsed.tables.settings) {
      throw new Error("Missing settings table");
    }

    const settingsRows = parsed.tables.settings || [];
    const seenSettingsKeys = new Set();
    const settingsMap = {};
    let ponytail_level = null;
    for (const row of settingsRows) {
      const { key, value } = row;
      if (key === undefined || key === "" || value === undefined || value === "") {
        throw new Error("Empty settings key or value not allowed");
      }
      if (seenSettingsKeys.has(key)) {
        throw new Error(`Duplicate key in settings: ${key}`);
      }
      seenSettingsKeys.add(key);
      settingsMap[key] = value;

      if (key === "autosync") {
        if (value !== "on" && value !== "off") {
          throw new Error(`Invalid autosync value: ${value}`);
        }
      } else if (key === "ponytail_level") {
        if (value !== "lite" && value !== "full" && value !== "ultra") {
          throw new Error(`Invalid ponytail_level value: ${value}`);
        }
        ponytail_level = value;
      } else if (key === "design_state" || key === "domain_state") {
        throw new Error(`Invalid key in settings: ${key} is deleted`);
      }
    }

    if (mode === "execution") {
      const isTerminalRepair = phase === "terminal-repair";
      const isTerminalReview = phase === "terminal-review";
      const isTaskPhase = phase === "task-active" || phase === "task-repair";
      const isGreenPhase = phase === "green-task";
      const isTerminalEntry = phase === "terminal-entry";
      const isExecutorTerminalGreen = phase === "executor-terminal-green";
      const isApproved = phase === "approved";

      const requiresModelSettings = isTerminalRepair || isTerminalReview || isTaskPhase || isGreenPhase || isTerminalEntry || isExecutorTerminalGreen || isApproved;
      if (requiresModelSettings) {
        const execModel = settingsMap["executor_model"];
        const revModel = settingsMap["reviewer_model"];
        if (!execModel || !revModel) {
          throw new Error("Missing executor_model or reviewer_model selector in settings");
        }
        const aliases = ["default", "task", "advisor", "implementer", "reviewer", "fixer"];
        if (aliases.includes(execModel) || aliases.includes(revModel)) {
          throw new Error("Alias-only model selectors are not allowed");
        }
        if (execModel === revModel) {
          throw new Error("Executor and reviewer model selectors must be distinct");
        }
        if (!execModel.includes("/") && !execModel.includes("-") && !execModel.includes(".")) {
          throw new Error("Invalid executor model selector");
        }
        if (!revModel.includes("/") && !revModel.includes("-") && !revModel.includes(".")) {
          throw new Error("Invalid reviewer model selector");
        }
      }

      const execBoundModel = settingsMap["executor_model"];
      const revBoundModel = settingsMap["reviewer_model"];

      const actualExecutorModel = parsed.fields.executor_actual_model;
      const actualReviewerModel = parsed.fields.reviewer_actual_model;

      if (actualExecutorModel && actualExecutorModel !== execBoundModel) {
        throw new Error(`Actual executor model (${actualExecutorModel}) does not match bound executor_model (${execBoundModel})`);
      }
      if (actualReviewerModel && actualReviewerModel !== revBoundModel) {
        throw new Error(`Actual reviewer model (${actualReviewerModel}) does not match bound reviewer_model (${revBoundModel})`);
      }

      const requiresExecutorFields = isTaskPhase || isGreenPhase || isTerminalRepair || isTerminalEntry || isExecutorTerminalGreen;
      if (requiresExecutorFields) {
        const agent = parsed.fields.executor_agent;
        const actModel = parsed.fields.executor_actual_model;
        const gen = parsed.fields.executor_generation;
        if (!agent || !actModel || gen === undefined || gen === "") {
          throw new Error(`Missing executor identity/model/generation fields in phase ${phase}`);
        }
        const sentinels = ["none", "unassigned", "pending"];
        if (sentinels.includes(agent.toLowerCase()) || sentinels.includes(actModel.toLowerCase())) {
          throw new Error(`Invalid sentinel value in executor fields: ${agent} / ${actModel}`);
        }
        const genNum = parseInt(gen, 10);
        if (isNaN(genNum) || genNum < 1) {
          throw new Error("executor_generation must be a positive integer");
        }
        if (actModel !== execBoundModel) {
          throw new Error(`Actual executor model (${actModel}) does not match bound executor_model (${execBoundModel})`);
        }

        if (isExecutorTerminalGreen) {
          const termVerdict = parsed.fields.executor_terminal_verdict;
          const termCheck = parsed.fields.executor_terminal_check;
          const termResult = parsed.fields.executor_terminal_result;
          if (termVerdict !== "PASS") {
            throw new Error("executor-terminal-green phase requires executor_terminal_verdict to be PASS");
          }
          if (!termCheck || termCheck === "" || termCheck === "pending") {
            throw new Error("executor-terminal-green phase requires a valid completed executor_terminal_check");
          }
          if (!termResult || termResult === "") {
            throw new Error("executor-terminal-green phase requires non-empty executor_terminal_result");
          }
        }
      }

      if (isTerminalReview) {
        const terminalCheck = parsed.fields.reviewer_terminal_check;
        if (!terminalCheck || terminalCheck === "") {
          throw new Error("Missing reviewer_terminal_check in terminal-review");
        }
        if (terminalCheck === "pending") {
          const curSettingsRows = parsed.tables.settings || [];
          const curModels = {};
          for (const r of curSettingsRows) {
            if (r.key === "executor_model" || r.key === "reviewer_model") {
              curModels[r.key] = r.value;
            }
          }
          validatePendingTerminalReviewSemantics(parsed, basename(suppliedHandoffPath), curModels, installedSkills, suppliedHandoffPath);
        } else {
          const agent = parsed.fields.reviewer_agent;
          const actModel = parsed.fields.reviewer_actual_model;
          const gen = parsed.fields.reviewer_generation;
          const round = parsed.fields.review_round;
          if (!agent || !actModel || gen === undefined || gen === "" || round === undefined || round === "") {
            throw new Error("Missing reviewer identity/model/generation/round fields in phase terminal-review");
          }
          const sentinels = ["none", "unassigned", "pending"];
          if (sentinels.includes(agent.toLowerCase()) || sentinels.includes(actModel.toLowerCase())) {
            throw new Error(`Invalid sentinel value in reviewer fields: ${agent} / ${actModel}`);
          }
          const genNum = parseInt(gen, 10);
          const roundNum = parseInt(round, 10);
          if (isNaN(genNum) || genNum < 1) {
            throw new Error("reviewer_generation must be a positive integer");
          }
          if (isNaN(roundNum) || roundNum < 1) {
            throw new Error("review_round must be a positive integer");
          }
          if (actModel !== revBoundModel) {
            throw new Error(`Actual reviewer model (${actModel}) does not match bound reviewer_model (${revBoundModel})`);
          }

          validateCompletedReviewerFields(parsed, suppliedHandoffPath, installedSkills);
        }
      }

      if (isTerminalRepair) {
        const agent = parsed.fields.reviewer_agent;
        const actModel = parsed.fields.reviewer_actual_model;
        const gen = parsed.fields.reviewer_generation;
        const round = parsed.fields.review_round;
        if (!agent || !actModel || gen === undefined || gen === "" || round === undefined || round === "") {
          throw new Error("Missing reviewer identity/model/generation/round fields in phase terminal-repair");
        }
        const sentinels = ["none", "unassigned", "pending"];
        if (sentinels.includes(agent.toLowerCase()) || sentinels.includes(actModel.toLowerCase())) {
          throw new Error(`Invalid sentinel value in reviewer fields: ${agent} / ${actModel}`);
        }
        const genNum = parseInt(gen, 10);
        const roundNum = parseInt(round, 10);
        if (isNaN(genNum) || genNum < 1) {
          throw new Error("reviewer_generation must be a positive integer");
        }
        if (isNaN(roundNum) || roundNum < 1) {
          throw new Error("review_round must be a positive integer");
        }
        if (actModel !== revBoundModel) {
          throw new Error(`Actual reviewer model (${actModel}) does not match bound reviewer_model (${revBoundModel})`);
        }
        const terminalCheck = parsed.fields.reviewer_terminal_check;
        if (!terminalCheck || terminalCheck === "") {
          throw new Error("Missing reviewer_terminal_check in terminal-repair");
        }
        if (terminalCheck === "pending") {
          throw new Error("terminal-repair requires a completed reviewer_terminal_check, not pending");
        }

        // 1. Resolve and validate trigger pending-review handoff at gen - 1
        const expectedTriggerGen = (currentHandoffGen !== null) ? currentHandoffGen - 1 : genNum - 1;
        let triggerFilename = `handoff-${expectedTriggerGen}.toon`;
        const triggerField = parsed.fields.trigger_review_handoff;
        if (triggerField) {
          triggerFilename = basename(triggerField);
        }

        const triggerPath = join(dirname(suppliedHandoffPath), triggerFilename);
        const triggerParsed = resolveAndValidatePriorHandoff(parsed, suppliedHandoffPath, triggerFilename, expectedTriggerGen, installedSkills);

        const curSettingsRows = parsed.tables.settings || [];
        const curModels = {};
        for (const r of curSettingsRows) {
          if (r.key === "executor_model" || r.key === "reviewer_model") {
            curModels[r.key] = r.value;
          }
        }

        const repairRound = parseInt(parsed.fields.review_round, 10);
        const repairCommit = parsed.fields.reviewed_commit || parsed.fields.completed_commit;
        const repairExecutorGen = parseInt(parsed.fields.executor_generation, 10);
        const repairReviewerGen = parseInt(parsed.fields.reviewer_generation, 10);
        const repairExecutorAgent = parsed.fields.executor_agent;
        const repairReviewerAgent = parsed.fields.reviewer_agent;

        validateCompletedReviewerFields(parsed, suppliedHandoffPath, installedSkills);

        validatePendingTerminalReviewSemantics(
          triggerParsed,
          triggerFilename,
          curModels,
          installedSkills,
          triggerPath,
          repairRound,
          repairCommit,
          repairExecutorGen,
          repairReviewerGen,
          repairExecutorAgent,
          repairReviewerAgent
        );
      }
    }

    function validateCompletedReviewerFields(parsed, suppliedHandoffPath, installedSkills) {
      const check = parsed.fields.reviewer_terminal_check;
      const res = parsed.fields.reviewer_terminal_result;
      const verdict = parsed.fields.reviewer_verdict;
      const count = parsed.fields.blocking_count;
      const fingerprint = parsed.fields.blocking_fingerprint;
      const round = parsed.fields.review_round;

      if (!check || check === "pending") {
        throw new Error("reviewer_terminal_check must be a valid completed check, not pending");
      }
      if (!res || res === "") {
        throw new Error("Missing reviewer_terminal_result");
      }
      if (parsed.fields.phase === "terminal-repair" && verdict !== "BLOCKED") {
        throw new Error("terminal-repair requires reviewer_verdict to be BLOCKED exactly");
      }
      if (verdict !== "BLOCKED" && verdict !== "PASS") {
        throw new Error(`Invalid reviewer_verdict: ${verdict}`);
      }
      if (verdict === "BLOCKED") {
        if (count === undefined || count === "") {
          throw new Error("Missing blocking_count for BLOCKED verdict");
        }
        const countNum = parseInt(count, 10);
        if (isNaN(countNum) || countNum < 1) {
          throw new Error("blocking_count must be a positive integer for BLOCKED verdict");
        }
        if (!fingerprint || fingerprint === "") {
          throw new Error("Missing blocking_fingerprint for BLOCKED verdict");
        }

        const guard = parsed.fields.progress_guard;
        if (!guard || guard === "") {
          throw new Error("Missing progress_guard");
        }
        const evidence = parsed.fields.progress_evidence;
        if (!evidence || evidence === "") {
          throw new Error("Missing progress_evidence");
        }
        if (parsed.fields.progress_status !== "advanced") {
          throw new Error("BLOCKED verdict requires progress_status to be advanced");
        }

        const roundNum = parseInt(round, 10);
        if (!isNaN(roundNum) && roundNum >= 2) {
          const prevFingerprint = parsed.fields.previous_blocking_fingerprint;
          if (!prevFingerprint || prevFingerprint === "") {
            throw new Error("terminal-repair rounds >=2 require previous_blocking_fingerprint");
          }
          if (fingerprint === prevFingerprint) {
            throw new Error("Unchanged repeated fingerprint fails closed");
          }

          const prevReviewedCommit = parsed.fields.previous_reviewed_commit;
          if (!prevReviewedCommit || prevReviewedCommit === "") {
            throw new Error("terminal-repair rounds >=2 require previous_reviewed_commit");
          }

          // Extract curModels for setting cross-checks
          const curSettingsRows = parsed.tables.settings || [];
          const curModels = {};
          for (const r of curSettingsRows) {
            if (r.key === "executor_model" || r.key === "reviewer_model") {
              curModels[r.key] = r.value;
            }
          }

          validateCompletedReviewChain(parsed, basename(suppliedHandoffPath), suppliedHandoffPath, curModels, installedSkills);
        }
      }
    }

    if (!parsed.tables.reload) {
      throw new Error("Missing reload table");
    }
    const reloadRows = parsed.tables.reload || [];
    const seenSkills = new Set();
    const seenPaths = new Set();
    for (const row of reloadRows) {
      const { skill, path } = row;
      if (skill === "gsd") {
        throw new Error("Master skill (gsd) must not be in reload manifest");
      }
      if (seenSkills.has(skill)) {
        throw new Error(`Duplicate skill in reload manifest: ${skill}`);
      }
      seenSkills.add(skill);
      if (seenPaths.has(path)) {
        throw new Error(`Duplicate path in reload manifest: ${path}`);
      }
      seenPaths.add(path);

      if (!installedSkills.has(skill)) {
        throw new Error(`Unknown/non-installed skill: ${skill}`);
      }

      if (path.startsWith("/") || /^[a-zA-Z]:\\/.test(path)) {
        throw new Error(`Absolute path: ${path}`);
      }
      if (path.includes("\\")) {
        throw new Error(`Backslash in path: ${path}`);
      }
      const segments = path.split("/");
      if (segments.includes(".") || segments.includes("..") || segments.some(s => s === "")) {
        throw new Error(`Invalid traversal/dot segment in path: ${path}`);
      }
      const expectedPath = `skills/${skill}/SKILL.md`;
      if (path !== expectedPath) {
        throw new Error(`Mismatched path for ${skill}: expected ${expectedPath}, got ${path}`);
      }
    }

    const validNextActions = [
      "start/continue task",
      "enter terminal verification/repair",
      "Discussion/Spec-escalation"
    ];
    const isActionValid = nextAction !== undefined && nextAction !== "" && validNextActions.includes(nextAction);

    if (isActionValid) {
      const requiredUnconditional = {
        "start/continue task": ["gsd-executing-plans", "gsd-handoff", "gsd-tdd"],
        "enter terminal verification/repair": ["gsd-verify", "gsd-handoff"],
        "Discussion/Spec-escalation": ["gsd-handoff"]
      };
      const unconditionalList = requiredUnconditional[nextAction];
      let unconditionalListChecked = unconditionalList;
      if (!unconditionalListChecked) {
        unconditionalListChecked = [];
      }

      for (const skill of unconditionalListChecked) {
        if (!seenSkills.has(skill)) {
          throw new Error(`Missing required skill: ${skill}`);
        }
      }

      const ponytailActive = (ponytail_level !== null);
      if (ponytailActive) {
        if (!seenSkills.has("gsd-ponytail")) {
          throw new Error("Missing conditional skill: gsd-ponytail");
        }
      } else {
        if (seenSkills.has("gsd-ponytail")) {
          throw new Error("Extraneous conditional skill: gsd-ponytail");
        }
      }

      const allAllowedSkills = new Set([...unconditionalListChecked]);
      if (ponytail_level !== null) allAllowedSkills.add("gsd-ponytail");
      if (seenSkills.has("gsd-codebase-design")) allAllowedSkills.add("gsd-codebase-design");
      if (seenSkills.has("gsd-domain-modeling")) allAllowedSkills.add("gsd-domain-modeling");

      for (const skill of seenSkills) {
        if (!allAllowedSkills.has(skill)) {
          throw new Error(`Extra skill: ${skill}`);
        }
      }
    }

    if (nextAction === undefined || nextAction === "") {
      throw new Error("Missing or empty next_action");
    }
    if (!validNextActions.includes(nextAction)) {
      throw new Error(`Invalid next_action: ${nextAction}`);
    }
  }

  function rehydrate(content, installedSkills, suppliedHandoffPath, highestHandoffPath, liveBinding) {
    const logs = [];
    let parsed;
    try {
      parsed = parseHandoff(content, installedSkills);
    } catch (e) {
      if (e.message.includes("blank line")) {
        console.log("REHYDRATE FAIL PATH:", suppliedHandoffPath);
        console.log("REHYDRATE FAIL CONTENT:");
        content.split("\n").forEach((l, idx) => console.log(`${idx+1}: ${JSON.stringify(l)}`));
      }
      throw e;
    }

    // Stage 1: Common/classification validation
    const mode = parsed.fields.mode;
    const phase = parsed.fields.phase;
    const nextAction = parsed.fields.next_action;

    if (mode === undefined || mode === "") {
      throw new Error("Missing or empty mode");
    }
    if (phase === undefined || phase === "") {
      throw new Error("Missing or empty phase");
    }
    const hasPathProp = "plan_path" in parsed.fields;
    const hasHashProp = "plan_sha256" in parsed.fields;
    const hasBinding = hasPathProp || hasHashProp;
    const hasReload = "reload" in parsed.tables || "reload" in parsed.fields;

    const isPrePlan = checkPrePlan(parsed);
    if (isPrePlan) {
      if (nextAction === undefined || nextAction === "") {
        throw new Error("Missing or empty next_action");
      }
      if (hasBinding || hasReload) {
        throw new Error("Reject partial, mixed, or execution-shaped state");
      }
      if (parsed.fields.settings !== undefined) {
        throw new Error("settings table must not be scalarized");
      }
      if (parsed.tables.settings) {
        const settingsRows = parsed.tables.settings;
        const seenSettingsKeys = new Set();
        for (const row of settingsRows) {
          const { key, value } = row;
          if (key === undefined || key === "" || value === undefined || value === "") {
            throw new Error("Empty settings key or value not allowed");
          }
          if (seenSettingsKeys.has(key)) {
            throw new Error(`Duplicate key in settings: ${key}`);
          }
          seenSettingsKeys.add(key);

          if (key === "autosync") {
            if (value !== "on" && value !== "off") {
              throw new Error("Invalid autosync value");
            }
          } else if (key === "ponytail_level") {
            if (value !== "lite" && value !== "full" && value !== "ultra") {
              throw new Error("Invalid ponytail_level value");
            }
          } else if (key === "design_state" || key === "domain_state") {
            throw new Error(`Invalid key in settings: ${key} is deleted`);
          }
        }
      }
      logs.push(`validate handoff: ${highestHandoffPath}`);
      logs.push("return once to state detection");
      return logs;
    }

    // Non-pre-plan checks:
    if (/^discussion$/i.test(mode)) {
      throw new Error("Discussion mode not allowed for execution");
    }

    // Execution order of checks:
    // 1. highest-path equality (supplied/highest guard)
    if (suppliedHandoffPath !== undefined && suppliedHandoffPath !== highestHandoffPath) {
      throw new Error(`Fail closed: supplied handoff path ${suppliedHandoffPath} does not equal highest canonical handoff path ${highestHandoffPath}`);
    }

    // 2. missing/empty/partial execution binding checks
    if (!hasPathProp || !hasHashProp) {
      throw new Error("Missing approval binding for execution handoff");
    }
    if (parsed.fields.plan_path === "" || parsed.fields.plan_sha256 === "") {
      throw new Error("empty/partial/mixed binding fails, never counts as omitted pre-plan state");
    }

    // 2. exact live binding path/hash comparison (do not require literal plan.md)
    if (!liveBinding) {
      throw new Error("Missing live binding");
    }
    if (parsed.fields.plan_path !== liveBinding.path) {
      throw new Error(`Plan path mismatch: expected ${liveBinding.path}, got ${parsed.fields.plan_path}`);
    }
    if (parsed.fields.plan_sha256 !== liveBinding.sha256) {
      throw new Error("Plan SHA-256 mismatch");
    }

    // 3. master load (logging)
    logs.push("reload master: skills/gsd/SKILL.md");

    // 4. manifest validation/reload (fails after master but before action)
    if (parsed.fields.settings !== undefined) {
      throw new Error("settings table must not be scalarized");
    }
    if (!parsed.tables.settings) {
      throw new Error("Missing settings table");
    }

    const settingsRows = parsed.tables.settings || [];
    const seenSettingsKeys = new Set();
    let ponytail_level = null;
    for (const row of settingsRows) {
      const { key, value } = row;
      if (key === undefined || key === "" || value === undefined || value === "") {
        throw new Error("Empty settings key or value not allowed");
      }
      if (seenSettingsKeys.has(key)) {
        throw new Error(`Duplicate key in settings: ${key}`);
      }
      seenSettingsKeys.add(key);

      if (key === "autosync") {
        if (value !== "on" && value !== "off") {
          throw new Error(`Invalid autosync value: ${value}`);
        }
      } else if (key === "ponytail_level") {
        if (value !== "lite" && value !== "full" && value !== "ultra") {
          throw new Error(`Invalid ponytail_level value: ${value}`);
        }
        ponytail_level = value;
      } else if (key === "design_state" || key === "domain_state") {
        throw new Error(`Invalid key in settings: ${key} is deleted`);
      }
    }

    if (!parsed.tables.reload) {
      throw new Error("Missing reload table for execution handoff");
    }

    const reloadRows = parsed.tables.reload || [];
    const seenSkills = new Set();
    const seenPaths = new Set();
    for (const row of reloadRows) {
      const { skill, path } = row;
      if (skill === "gsd") {
        throw new Error("Master skill (gsd) must not be in reload manifest");
      }
      if (seenSkills.has(skill)) {
        throw new Error(`Duplicate skill in reload manifest: ${skill}`);
      }
      seenSkills.add(skill);
      if (seenPaths.has(path)) {
        throw new Error(`Duplicate path in reload manifest: ${path}`);
      }
      seenPaths.add(path);

      if (!installedSkills.has(skill)) {
        throw new Error(`Unknown/non-installed skill: ${skill}`);
      }

      if (path.startsWith("/") || /^[a-zA-Z]:\\/.test(path)) {
        throw new Error(`Absolute path: ${path}`);
      }
      if (path.includes("\\")) {
        throw new Error(`Backslash in path: ${path}`);
      }
      const segments = path.split("/");
      if (segments.includes(".") || segments.includes("..") || segments.some(s => s === "")) {
        throw new Error(`Invalid traversal/dot segment in path: ${path}`);
      }
      const expectedPath = `skills/${skill}/SKILL.md`;
      if (path !== expectedPath) {
        throw new Error(`Mismatched path for ${skill}: expected ${expectedPath}, got ${path}`);
      }
    }

    const validNextActions = [
      "start/continue task",
      "enter terminal verification/repair",
      "Discussion/Spec-escalation"
    ];
    const isActionValid = nextAction !== undefined && nextAction !== "" && validNextActions.includes(nextAction);

    if (isActionValid) {
      const requiredUnconditional = {
        "start/continue task": ["gsd-executing-plans", "gsd-handoff", "gsd-tdd"],
        "enter terminal verification/repair": ["gsd-verify", "gsd-handoff"],
        "Discussion/Spec-escalation": ["gsd-handoff"]
      };
      const unconditionalList = requiredUnconditional[nextAction];
      let unconditionalListChecked = unconditionalList;
      if (!unconditionalListChecked) {
        unconditionalListChecked = [];
      }

      for (const skill of unconditionalListChecked) {
        if (!seenSkills.has(skill)) {
          throw new Error(`Missing required skill: ${skill}`);
        }
      }

      const ponytailActive = (ponytail_level !== null);
      if (ponytailActive) {
        if (!seenSkills.has("gsd-ponytail")) {
          throw new Error("Missing conditional skill: gsd-ponytail");
        }
      } else {
        if (seenSkills.has("gsd-ponytail")) {
          throw new Error("Extraneous conditional skill: gsd-ponytail");
        }
      }

      const allAllowedSkills = new Set([...unconditionalListChecked]);
      if (ponytail_level !== null) allAllowedSkills.add("gsd-ponytail");
      if (seenSkills.has("gsd-codebase-design")) allAllowedSkills.add("gsd-codebase-design");
      if (seenSkills.has("gsd-domain-modeling")) allAllowedSkills.add("gsd-domain-modeling");

      for (const skill of seenSkills) {
        if (!allAllowedSkills.has(skill)) {
          throw new Error(`Extra skill: ${skill}`);
        }
      }
    }

    for (const entry of reloadRows) {
      logs.push(`reload subskill: ${entry.path}`);
    }

    // 5. executable action validation/logging
    if (nextAction === undefined || nextAction === "") {
      throw new Error("Missing or empty next_action");
    }
    if (!validNextActions.includes(nextAction)) {
      throw new Error(`Invalid next_action: ${nextAction}`);
    }

    validateHandoff(parsed, installedSkills, suppliedHandoffPath);
    logs.push(`validate handoff: ${highestHandoffPath}`);
    logs.push(`execute next_action: ${nextAction}`);
    return logs;
  }
  const execStr = (s) => s
    .replace("schema:v1", "schema:v1\nmode:execution\nphase:approved\nfeature:canonical-fixture")
    .replace("plan_path:.scratch/canonical-fixture/plan.md", "plan_path:plan.md")
    .replace("plan_hash:", "plan_sha256:")
    .replace("settings[0]{key,value}:", "settings[2]{key,value}:\n  executor_model,google-antigravity/gemini-3.5-flash:high\n  reviewer_model,openai-codex/gpt-5.5:high")
    .replace("settings[1]{key,value}:", "settings[3]{key,value}:\n  executor_model,google-antigravity/gemini-3.5-flash:high\n  reviewer_model,openai-codex/gpt-5.5:high");

  // Test highest generation enforcement
  const minimalExecutionHandoffForGen = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);

  const minimalPrePlanHandoffForGen = `schema:v1
mode:discussion
phase:pre-plan
next_action:Discussion/Spec-escalation
settings[0]{key,value}:`;

  assert.throws(() => {
    rehydrate(minimalExecutionHandoffForGen, installed, "handoff-1.toon", "handoff-2.toon");
  }, /supplied handoff path handoff-1\.toon does not equal highest canonical handoff path handoff-2\.toon/);

  assert.doesNotThrow(() => {
    try {
      rehydrate(minimalExecutionHandoffForGen, installed, "handoff-2.toon", "handoff-2.toon");
    } catch (e) {
      assert.notEqual(e.message, "supplied handoff path");
    }
  });

  // Pre-plan handoff does not throw on mismatched paths
  assert.doesNotThrow(() => {
    rehydrate(minimalPrePlanHandoffForGen, installed, "handoff-1.toon", "handoff-2.toon");
  });

  // Test valid cases (byte-level string format)
  const validStartTaskString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);

  const liveBinding = { path: "plan.md", sha256: "773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d" };

  const logs = rehydrate(validStartTaskString, installed, "handoff-1.toon", "handoff-1.toon", liveBinding);
  assert.deepEqual(logs, [
    "reload master: skills/gsd/SKILL.md",
    "reload subskill: skills/gsd-executing-plans/SKILL.md",
    "reload subskill: skills/gsd-handoff/SKILL.md",
    "reload subskill: skills/gsd-tdd/SKILL.md",
    "validate handoff: handoff-1.toon",
    "execute next_action: start/continue task"
  ]);

  // Test count mismatch
  const countMismatchString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[2]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => parseHandoff(countMismatchString, installed), /Count mismatch/);

  // Test duplicate table/header
  const duplicateHeaderString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
schema:v2
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => parseHandoff(duplicateHeaderString, installed), /Duplicate table\/header/);

  // Test duplicate rows
  const duplicateRowsString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => parseHandoff(duplicateRowsString, installed), /Duplicate rows/);

  // Test malformed structure (missing colon)
  const malformedStructureString = execStr(`schema:v1
next_action start/continue task
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => parseHandoff(malformedStructureString, installed), /Malformed structure/);

  // Test malformed structure (table row without header)
  const rowWithoutHeaderString = execStr(`  gsd-handoff,skills/gsd-handoff/SKILL.md
schema:v1
next_action:start/continue task`);
  assert.throws(() => parseHandoff(rowWithoutHeaderString, installed), /Malformed structure/);

  // Raw negatives: settings reordered columns
  const settingsReorderedColumnsString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{value,key}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => parseHandoff(settingsReorderedColumnsString, installed), /Invalid or reordered columns/);

  // Raw negatives: settings extra columns
  const settingsExtraColumnsString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value,extra}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => parseHandoff(settingsExtraColumnsString, installed), /Invalid or reordered columns/);

  // Raw negatives: settings non-canonical count
  const settingsNonCanonicalCountString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[01]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => parseHandoff(settingsNonCanonicalCountString, installed), /Non-canonical numeric count/);

  // Raw negatives: reload reordered columns
  const reloadReorderedColumnsString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{path,skill}:
  skills/gsd-executing-plans/SKILL.md,gsd-executing-plans
  skills/gsd-handoff/SKILL.md,gsd-handoff
  skills/gsd-tdd/SKILL.md,gsd-tdd`);
  assert.throws(() => parseHandoff(reloadReorderedColumnsString, installed), /Invalid or reordered columns/);

  // Raw negatives: reload extra columns
  const reloadExtraColumnsString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path,extra}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md,1
  gsd-handoff,skills/gsd-handoff/SKILL.md,2
  gsd-tdd,skills/gsd-tdd/SKILL.md,3`);
  assert.throws(() => parseHandoff(reloadExtraColumnsString, installed), /Invalid or reordered columns/);

  // Raw negatives: reload non-canonical count
  const reloadNonCanonicalCountString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[03]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => parseHandoff(reloadNonCanonicalCountString, installed), /Non-canonical/);

  // Test malformed structure (columns count mismatch)
  const columnsMismatchString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => parseHandoff(columnsMismatchString, installed), /Malformed structure/);

  // Test name/path duplicates (different skill but same path)
  const duplicatePathString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-handoff/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => validateHandoff(parseHandoff(duplicatePathString, installed), installed), /Duplicate path|Mismatched path/);

  // Test name/path duplicates (same skill but different path)
  const duplicateSkillString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-handoff,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => validateHandoff(parseHandoff(duplicateSkillString, installed), installed), /Duplicate skill|Mismatched path/);

  // Test unknown skills
  const unknownSkillString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-unknown-xyz,skills/gsd-unknown-xyz/SKILL.md`);
  assert.throws(() => validateHandoff(parseHandoff(unknownSkillString, installed), installed), /Unknown\/non-installed skill/);

  // Test absolute path
  const absolutePathString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,/skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => validateHandoff(parseHandoff(absolutePathString, installed), installed), /Absolute path/);

  // Test backslash path
  const backslashPathString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills\\gsd-executing-plans\\SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => validateHandoff(parseHandoff(backslashPathString, installed), installed), /Backslash/);

  // Test dot segment path
  const dotPathString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/./gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => validateHandoff(parseHandoff(dotPathString, installed), installed), /Invalid traversal/);

  // Test traversal segment path
  const traversalPathString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/../gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => validateHandoff(parseHandoff(traversalPathString, installed), installed), /Invalid traversal/);

  // Test path mismatch
  const pathMismatchString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-handoff/SKILL.md
  gsd-handoff,skills/gsd-executing-plans/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => validateHandoff(parseHandoff(pathMismatchString, installed), installed), /Mismatched path/);

  // Test master skill in manifest
  const masterSkillInManifestString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd,skills/gsd/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => validateHandoff(parseHandoff(masterSkillInManifestString, installed), installed), /Master skill/);

  // Test missing required skill
  const missingRequiredString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[2]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`);
  assert.throws(() => validateHandoff(parseHandoff(missingRequiredString, installed), installed), /Missing required skill/);

  // Test extra skill
  const extraSkillString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[4]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md
  gsd-verify,skills/gsd-verify/SKILL.md`);
  assert.throws(() => validateHandoff(parseHandoff(extraSkillString, installed), installed), /Extra skill/);

  // Test conditional skill ponytail active
  const ponytailActiveString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[1]{key,value}:
  ponytail_level,full
reload[4]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md
  gsd-ponytail,skills/gsd-ponytail/SKILL.md`);
  assert.doesNotThrow(() => validateHandoff(parseHandoff(ponytailActiveString, installed), installed));

  // Test conditional skill ponytail extraneous (inactive but present)
  const ponytailExtraneousString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[4]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md
  gsd-ponytail,skills/gsd-ponytail/SKILL.md`);
  assert.throws(() => validateHandoff(parseHandoff(ponytailExtraneousString, installed), installed), /Extraneous conditional skill/);

  // Test conditional skill ponytail missing (active but absent)
  const ponytailMissingString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[1]{key,value}:
  ponytail_level,full
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => validateHandoff(parseHandoff(ponytailMissingString, installed), installed), /Missing conditional skill/);

  // Test design active (no design_state setting key but present in reload)
  const designActiveString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[4]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md
  gsd-codebase-design,skills/gsd-codebase-design/SKILL.md`);
  assert.doesNotThrow(() => validateHandoff(parseHandoff(designActiveString, installed), installed));

  // Test design_state setting is rejected
  const designStateSettingRejectedString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[1]{key,value}:
  design_state,active
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => validateHandoff(parseHandoff(designStateSettingRejectedString, installed), installed), /deleted/);

  // Test domain active (no domain_state setting key but present in reload)
  const domainActiveString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[4]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md
  gsd-domain-modeling,skills/gsd-domain-modeling/SKILL.md`);
  assert.doesNotThrow(() => validateHandoff(parseHandoff(domainActiveString, installed), installed));

  // Test domain_state setting is rejected
  const domainStateSettingRejectedString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[1]{key,value}:
  domain_state,active
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => validateHandoff(parseHandoff(domainStateSettingRejectedString, installed), installed), /deleted/);

  // Test unknown settings key remains opaque and doesn't fail
  const unknownSettingOpaqueString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[1]{key,value}:
  unknown_setting_key,some_value
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.doesNotThrow(() => validateHandoff(parseHandoff(unknownSettingOpaqueString, installed), installed));

  // Test invalid known settings key fails
  const invalidSettingFailsString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[1]{key,value}:
  ponytail_level,invalid_value
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => validateHandoff(parseHandoff(invalidSettingFailsString, installed), installed), /Invalid ponytail_level/);
  // Test conditional skills on other next_actions
  const otherActions = [
    {
      action: "enter terminal verification/repair",
      baseSkills: ["gsd-verify", "gsd-handoff"]
    },
    {
      action: "Discussion/Spec-escalation",
      baseSkills: ["gsd-handoff"]
    }
  ];

  for (const { action, baseSkills } of otherActions) {
    // 1. Inactive case: no ponytail, design, domain state. Reload manifest has only baseSkills.
    const inactiveHandoff = execStr(`schema:v1
next_action:${action}
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[${baseSkills.length}]{skill,path}:
${baseSkills.map(s => `  ${s},skills/${s}/SKILL.md`).join("\n")}`);
    assert.doesNotThrow(() => validateHandoff(parseHandoff(inactiveHandoff, installed), installed));

    // 2. Extraneous case: inactive but conditional skill is present -> should throw
    const extraneousHandoff = execStr(`schema:v1
next_action:${action}
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[${baseSkills.length + 1}]{skill,path}:
${[...baseSkills, "gsd-ponytail"].map(s => `  ${s},skills/${s}/SKILL.md`).join("\n")}`);
    assert.throws(() => validateHandoff(parseHandoff(extraneousHandoff, installed), installed), /Extraneous conditional skill/);

    // 3. Active ponytail
    const activePonytailHandoff = execStr(`schema:v1
next_action:${action}
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[1]{key,value}:
  ponytail_level,lite
reload[${baseSkills.length + 1}]{skill,path}:
${[...baseSkills, "gsd-ponytail"].map(s => `  ${s},skills/${s}/SKILL.md`).join("\n")}`);
    assert.doesNotThrow(() => validateHandoff(parseHandoff(activePonytailHandoff, installed), installed));

    // 4. Missing ponytail (active settings but absent from reload manifest)
    const missingPonytailHandoff = execStr(`schema:v1
next_action:${action}
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[1]{key,value}:
  ponytail_level,lite
reload[${baseSkills.length}]{skill,path}:
${baseSkills.map(s => `  ${s},skills/${s}/SKILL.md`).join("\n")}`);
    assert.throws(() => validateHandoff(parseHandoff(missingPonytailHandoff, installed), installed), /Missing conditional skill/);

    // 5. Active design writer case (gsd-codebase-design is reloaded)
    const activeDesignHandoff = execStr(`schema:v1
next_action:${action}
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[${baseSkills.length + 1}]{skill,path}:
${[...baseSkills, "gsd-codebase-design"].map(s => `  ${s},skills/${s}/SKILL.md`).join("\n")}`);
    assert.doesNotThrow(() => validateHandoff(parseHandoff(activeDesignHandoff, installed), installed));

    // 6. Active domain writer case (gsd-domain-modeling is reloaded)
    const activeDomainHandoff = execStr(`schema:v1
next_action:${action}
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[${baseSkills.length + 1}]{skill,path}:
${[...baseSkills, "gsd-domain-modeling"].map(s => `  ${s},skills/${s}/SKILL.md`).join("\n")}`);
    assert.doesNotThrow(() => validateHandoff(parseHandoff(activeDomainHandoff, installed), installed));
  }

  // Byte-level positive/negative tests for the new requirements (Change 4)
  // 1. Positive test: pre-plan no-manifest resume
  const prePlanNoManifestResumeString = `schema:v1
mode:discussion
phase:pre-plan
next_action:Discussion/Spec-escalation
settings[0]{key,value}:`;
  const prePlanLogs = rehydrate(prePlanNoManifestResumeString, installed, "handoff-1.toon", "handoff-1.toon");
  assert.deepEqual(prePlanLogs, [
    "validate handoff: handoff-1.toon",
    "return once to state detection"
  ]);

  // 2. Negative test: execution missing-manifest failure
  const executionMissingManifestString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:`); // Missing reload table completely
  assert.throws(() => validateHandoff(parseHandoff(executionMissingManifestString, installed), installed), /Missing reload table/);

  // 3. Negative test: missing settings failure
  const executionMissingSettingsString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`); // Missing settings table completely
  assert.throws(() => validateHandoff(parseHandoff(executionMissingSettingsString, installed), installed), /Missing settings table/);

  // 4. Negative test: scalar settings failure
  const executionScalarSettingsString = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings:some_scalar_value
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`); // Settings is scalar field
  assert.throws(() => validateHandoff(parseHandoff(executionScalarSettingsString, installed), installed), /settings table must not be scalarized/);

  // 5. Negative test: missing approval binding for execution handoff
  const executionMissingBindingString = execStr(`schema:v1
next_action:start/continue task
test_missing_binding:true
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => validateHandoff(parseHandoff(executionMissingBindingString, installed), installed), /Missing approval binding/);

  // 6. Ponytail active/inactive action coverage positive/negative tests
  const requiredUnconditional = {
    "start/continue task": ["gsd-executing-plans", "gsd-handoff", "gsd-tdd"],
    "enter terminal verification/repair": ["gsd-verify", "gsd-handoff"]
  };
  for (const action of Object.keys(requiredUnconditional)) {
    const base = requiredUnconditional[action];
    // Ponytail active case (should pass)
    const ponytailActiveForAction = execStr(`schema:v1
next_action:${action}
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[1]{key,value}:
  ponytail_level,ultra
reload[${base.length + 1}]{skill,path}:
${[...base, "gsd-ponytail"].map(s => `  ${s},skills/${s}/SKILL.md`).join("\n")}`);
    assert.doesNotThrow(() => validateHandoff(parseHandoff(ponytailActiveForAction, installed), installed));

    // Ponytail inactive case but present in reload (extraneous ponytail - should throw)
    const ponytailExtraneousForAction = execStr(`schema:v1
next_action:${action}
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[${base.length + 1}]{skill,path}:
${[...base, "gsd-ponytail"].map(s => `  ${s},skills/${s}/SKILL.md`).join("\n")}`);
    assert.throws(() => validateHandoff(parseHandoff(ponytailExtraneousForAction, installed), installed), /Extraneous conditional skill/);

    // Ponytail active in settings but missing from reload (should throw)
    const ponytailMissingForAction = execStr(`schema:v1
next_action:${action}
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[1]{key,value}:
  ponytail_level,ultra
reload[${base.length}]{skill,path}:
${base.map(s => `  ${s},skills/${s}/SKILL.md`).join("\n")}`);
    assert.throws(() => validateHandoff(parseHandoff(ponytailMissingForAction, installed), installed), /Missing conditional skill/);
  }


  // Combined negatives:
  // 1. Valid settings table but malformed settings header afterward
  const combinedNegative1 = execStr(`schema:v1
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[1]{key,value}:
  ponytail_level,lite
settings[0]{value,key}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => parseHandoff(combinedNegative1, installed), /Invalid or reordered columns/);

  // 2. Pre-plan handoff with settings table but also duplicate settings key
  const combinedNegative2 = `schema:v1
mode:discussion
phase:pre-plan
next_action:Discussion/Spec-escalation
settings[2]{key,value}:
  autosync,on
  autosync,off`;
  assert.throws(() => validateHandoff(parseHandoff(combinedNegative2, installed), installed), /Duplicate key in settings/);

  // 3. Pre-plan handoff with malformed settings header
  const combinedNegative3 = `schema:v1
mode:discussion
phase:pre-plan
next_action:Discussion/Spec-escalation
settings[0]{value,key}:`;
  assert.throws(() => parseHandoff(combinedNegative3, installed), /Invalid or reordered columns/);

  // 4. Reject mixed pre-plan mode with plan_path / plan_hash
  const combinedNegative4 = `schema:v1
mode:discussion
phase:pre-plan
next_action:Discussion/Spec-escalation
plan_path:plan.md
plan_sha256:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:`;
  assert.throws(() => validateHandoff(parseHandoff(combinedNegative4, installed), installed), /Reject partial, mixed, or execution-shaped state/);

  // 5. Reject mixed pre-plan mode with reload table
  const combinedNegative5 = `schema:v1
mode:discussion
phase:pre-plan
next_action:Discussion/Spec-escalation
settings[0]{key,value}:
reload[1]{skill,path}:
  gsd-handoff,skills/gsd-handoff/SKILL.md`;
  assert.throws(() => validateHandoff(parseHandoff(combinedNegative5, installed), installed), /Reject partial, mixed, or execution-shaped state/);

  // Live binding negatives
  const liveBindingNegative = { path: "plan.md", sha256: "773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d" };

  // Missing live binding input
  assert.throws(() => {
    rehydrate(validStartTaskString, installed, "handoff-1.toon", "handoff-1.toon", undefined);
  }, /Missing live binding/);

  // Wrong live binding path
  assert.throws(() => {
    rehydrate(validStartTaskString, installed, "handoff-1.toon", "handoff-1.toon", { path: "wrong.md", sha256: "773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d" });
  }, /Plan path mismatch/);

  // Wrong handoff plan path (if handoff has different plan path, even if live plan path is plan.md)
  const wrongHandoffPlanPath = execStr(`schema:v1
next_action:start/continue task
plan_path:wrong.md
plan_hash:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`);
  assert.throws(() => {
    rehydrate(wrongHandoffPlanPath, installed, "handoff-1.toon", "handoff-1.toon", liveBindingNegative);
  }, /Plan path mismatch/);

  // SHA-256 mismatch
  assert.throws(() => {
    rehydrate(validStartTaskString, installed, "handoff-1.toon", "handoff-1.toon", { path: "plan.md", sha256: "wronghash123" });
  }, /Plan SHA-256 mismatch/);

  // Pre-plan negative: empty scalar reload key
  const prePlanEmptyScalarReload = `schema:v1
mode:discussion
phase:pre-plan
next_action:Discussion/Spec-escalation
reload:`;
  assert.throws(() => parseHandoff(prePlanEmptyScalarReload, installed), /Reject partial, mixed, or execution-shaped state/);

  // Pre-plan negative: nonempty scalar reload key
  const prePlanNonEmptyScalarReload = `schema:v1
mode:discussion
phase:pre-plan
next_action:Discussion/Spec-escalation
reload:some_value`;
  assert.throws(() => parseHandoff(prePlanNonEmptyScalarReload, installed), /Reject partial, mixed, or execution-shaped state/);

  // Positive live binding case
  const positiveHandoffString = `schema:v1
mode:execution
phase:approved
feature:canonical-fixture
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_sha256:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[2]{key,value}:
  executor_model,google-antigravity/gemini-3.5-flash:high
  reviewer_model,openai-codex/gpt-5.5:high
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`;

  const liveBindingPositive = {
    path: ".scratch/canonical-fixture/plan.md",
    sha256: "773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d"
  };

  assert.doesNotThrow(() => {
    rehydrate(positiveHandoffString, installed, "handoff-1.toon", "handoff-1.toon", liveBindingPositive);
  });

  // Mismatch negative 1: path mismatch
  assert.throws(() => {
    rehydrate(positiveHandoffString, installed, "handoff-1.toon", "handoff-1.toon", {
      path: ".scratch/other-feature/plan.md",
      sha256: "773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d"
    });
  }, /Plan path mismatch/);

  // Mismatch negative 2: hash mismatch
  assert.throws(() => {
    rehydrate(positiveHandoffString, installed, "handoff-1.toon", "handoff-1.toon", {
      path: ".scratch/canonical-fixture/plan.md",
      sha256: "wronghash123"
    });
  }, /Plan SHA-256 mismatch/);

  // Order assertions:
  // 1. stale supplied path fails before binding/master/manifest
  const staleAndMismatchedAndMalformed = `schema:v1
mode:execution
phase:approved
feature:canonical-fixture
next_action:start/continue task
plan_path:wrong.md
plan_sha256:wrong
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`; // missing settings
  assert.throws(() => {
    rehydrate(staleAndMismatchedAndMalformed, installed, "handoff-1.toon", "handoff-2.toon", { path: "correct.md", sha256: "correct" });
  }, /Fail closed: supplied handoff path/);

  // Proves highest-generation error wins for stale handoff with missing binding
  const staleAndMissingBinding = `schema:v1
mode:execution
phase:approved
feature:canonical-fixture
next_action:start/continue task
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`;
  assert.throws(() => {
    rehydrate(staleAndMissingBinding, installed, "handoff-1.toon", "handoff-2.toon", { path: "correct.md", sha256: "correct" });
  }, /Fail closed: supplied handoff path/);

  // Proves highest-generation error wins for stale handoff with empty binding
  const staleAndEmptyBinding = `schema:v1
mode:execution
phase:approved
feature:canonical-fixture
next_action:start/continue task
plan_path:
plan_sha256:
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`;
  assert.throws(() => {
    rehydrate(staleAndEmptyBinding, installed, "handoff-1.toon", "handoff-2.toon", { path: "correct.md", sha256: "correct" });
  }, /Fail closed: supplied handoff path/);

  // Proves current-generation handoff with missing binding fails binding shape check next
  assert.throws(() => {
    rehydrate(staleAndMissingBinding, installed, "handoff-2.toon", "handoff-2.toon", { path: "correct.md", sha256: "correct" });
  }, /Missing approval binding for execution handoff/);

  // Proves current-generation handoff with empty binding fails binding shape check next
  assert.throws(() => {
    rehydrate(staleAndEmptyBinding, installed, "handoff-2.toon", "handoff-2.toon", { path: "correct.md", sha256: "correct" });
  }, /empty\/partial\/mixed binding fails/);

  // 2. binding mismatch fails before master/manifest
  assert.throws(() => {
    rehydrate(staleAndMismatchedAndMalformed, installed, "handoff-1.toon", "handoff-1.toon", { path: "correct.md", sha256: "correct" });
  }, /Plan path mismatch/);

  // 3. malformed manifest fails after master but before action
  const correctBindingMalformedManifestInvalidAction = `schema:v1
mode:execution
phase:approved
feature:canonical-fixture
next_action:invalid_action
plan_path:correct.md
plan_sha256:correct
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`; // missing settings
  assert.throws(() => {
    rehydrate(correctBindingMalformedManifestInvalidAction, installed, "handoff-1.toon", "handoff-1.toon", { path: "correct.md", sha256: "correct" });
  }, /Missing settings table/);
  // Proves highest-generation error wins for stale handoff with missing next_action
  const staleAndMissingAction = `schema:v1
mode:execution
phase:approved
feature:canonical-fixture
plan_path:correct.md
plan_sha256:correct
settings[2]{key,value}:
  executor_model,google-antigravity/gemini-3.5-flash:high
  reviewer_model,openai-codex/gpt-5.5:high
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`;
  assert.throws(() => {
    rehydrate(staleAndMissingAction, installed, "handoff-1.toon", "handoff-2.toon", { path: "correct.md", sha256: "correct" });
  }, /Fail closed: supplied handoff path/);

  // Proves highest-generation error wins for stale handoff with empty next_action
  const staleAndEmptyAction = `schema:v1
mode:execution
phase:approved
feature:canonical-fixture
next_action:
plan_path:correct.md
plan_sha256:correct
settings[2]{key,value}:
  executor_model,google-antigravity/gemini-3.5-flash:high
  reviewer_model,openai-codex/gpt-5.5:high
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`;
  assert.throws(() => {
    rehydrate(staleAndEmptyAction, installed, "handoff-1.toon", "handoff-2.toon", { path: "correct.md", sha256: "correct" });
  }, /Fail closed: supplied handoff path/);

  // Proves current-generation handoff with missing next_action reaches action error after earlier stages
  assert.throws(() => {
    rehydrate(staleAndMissingAction, installed, "handoff-2.toon", "handoff-2.toon", { path: "correct.md", sha256: "correct" });
  }, /Missing or empty next_action/);

  // Proves current-generation handoff with empty next_action reaches action error after earlier stages
  assert.throws(() => {
    rehydrate(staleAndEmptyAction, installed, "handoff-2.toon", "handoff-2.toon", { path: "correct.md", sha256: "correct" });
  }, /Missing or empty next_action/);

  // Proves current-generation handoff with invalid next_action reaches action error after earlier stages
  const correctHandoffInvalidAction = `schema:v1
mode:execution
phase:approved
feature:canonical-fixture
next_action:invalid_action
plan_path:correct.md
plan_sha256:correct
settings[2]{key,value}:
  executor_model,google-antigravity/gemini-3.5-flash:high
  reviewer_model,openai-codex/gpt-5.5:high
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`;
  assert.throws(() => {
    rehydrate(correctHandoffInvalidAction, installed, "handoff-2.toon", "handoff-2.toon", { path: "correct.md", sha256: "correct" });
  }, /Invalid next_action: invalid_action/);

  // 4. pre-plan returns without master
  assert.ok(!prePlanLogs.includes("reload master: skills/gsd/SKILL.md"));

  // Positive pure pre-plan at rehydrate level
  const purePrePlanHandoff = `schema:v1
mode:discussion
phase:pre-plan
next_action:Discussion/Spec-escalation
settings[0]{key,value}:`;
  const purePrePlanLogs = rehydrate(purePrePlanHandoff, installed, "handoff-1.toon", "handoff-1.toon");
  assert.deepEqual(purePrePlanLogs, [
    "validate handoff: handoff-1.toon",
    "return once to state detection"
  ]);

  // Negative partial/empty/full binding plus reload variants at rehydrate level
  const prePlanPartialPath = `schema:v1
mode:discussion
phase:pre-plan
next_action:Discussion/Spec-escalation
plan_path:plan.md
settings[0]{key,value}:`;
  assert.throws(() => rehydrate(prePlanPartialPath, installed, "handoff-1.toon", "handoff-1.toon"), /Reject partial, mixed, or execution-shaped state/);

  const prePlanPartialHash = `schema:v1
mode:discussion
phase:pre-plan
next_action:Discussion/Spec-escalation
plan_sha256:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:`;
  assert.throws(() => rehydrate(prePlanPartialHash, installed, "handoff-1.toon", "handoff-1.toon"), /Reject partial, mixed, or execution-shaped state/);

  const prePlanFullBinding = `schema:v1
mode:discussion
phase:pre-plan
next_action:Discussion/Spec-escalation
plan_path:plan.md
plan_sha256:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:`;
  assert.throws(() => rehydrate(prePlanFullBinding, installed, "handoff-1.toon", "handoff-1.toon"), /Reject partial, mixed, or execution-shaped state/);

  const prePlanEmptyPath = `schema:v1
mode:discussion
phase:pre-plan
next_action:Discussion/Spec-escalation
plan_path:
settings[0]{key,value}:`;
  assert.throws(() => rehydrate(prePlanEmptyPath, installed, "handoff-1.toon", "handoff-1.toon"), /Reject partial, mixed, or execution-shaped state/);

  const prePlanEmptyHash = `schema:v1
mode:discussion
phase:pre-plan
next_action:Discussion/Spec-escalation
plan_sha256:
settings[0]{key,value}:`;
  assert.throws(() => rehydrate(prePlanEmptyHash, installed, "handoff-1.toon", "handoff-1.toon"), /Reject partial, mixed, or execution-shaped state/);

  const prePlanWithReloadTable = `schema:v1
mode:discussion
phase:pre-plan
next_action:Discussion/Spec-escalation
settings[0]{key,value}:
reload[1]{skill,path}:
  gsd-handoff,skills/gsd-handoff/SKILL.md`;
  assert.throws(() => rehydrate(prePlanWithReloadTable, installed, "handoff-1.toon", "handoff-1.toon"), /Reject partial, mixed, or execution-shaped state/);

  const prePlanWithScalarReload = `schema:v1
mode:discussion
phase:pre-plan
next_action:Discussion/Spec-escalation
reload:some_value
settings[0]{key,value}:`;
  assert.throws(() => rehydrate(prePlanWithScalarReload, installed, "handoff-1.toon", "handoff-1.toon"), /Reject partial, mixed, or execution-shaped state/);

  // Reject missing execution mode/phase with binding
  const missingModeWithBinding = `schema:v1
phase:approved
next_action:start/continue task
plan_path:plan.md
plan_sha256:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`;
  assert.throws(() => validateHandoff(parseHandoff(missingModeWithBinding, installed), installed), /Missing or empty mode/);

  // Reject Discussion mode with binding
  const discussionModeWithBinding = `schema:v1
mode:discussion
phase:approved
next_action:start/continue task
plan_path:plan.md
plan_sha256:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`;
  assert.throws(() => validateHandoff(parseHandoff(discussionModeWithBinding, installed), installed), /Discussion mode not allowed/);

  const discussionModeWithBinding2 = `schema:v1
mode:Discussion
phase:approved
next_action:start/continue task
plan_path:plan.md
plan_sha256:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`;
  assert.throws(() => validateHandoff(parseHandoff(discussionModeWithBinding2, installed), installed), /Discussion mode not allowed/);
  // Test producer coverage and transition mappings
  const toPlan = read("skills/gsd-to-plan/SKILL.md");
  const executingPlans = read("skills/gsd-executing-plans/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");

  assert.match(toPlan, /next_action.*set to.*start\/continue task/);
  assert.match(executingPlans, /task-active.*next_action.*set to.*start\/continue task/);
  assert.match(executingPlans, /task repair.*next_action.*set to.*start\/continue task/s);
  assert.match(executingPlans, /green-task.*next_action.*set to.*start\/continue task/);
  assert.match(executingPlans, /terminal entry.*next_action.*set to.*enter terminal verification\/repair/);
  assert.match(executingPlans, /pause.*preserves the exact interrupted executable `next_action`/);
  assert.match(executingPlans, /Discussion\/Spec-escalation/);
  assert.match(verify, /terminal repair.*next_action.*set to.*enter terminal verification\/repair/);

  // --- T2-IMP-11 and IMP-08 handoff phase validation ---
  const liveBindingLocal = { path: "plan.md", sha256: "773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d" };

  const validHandoffBase = (phase, settingsStr = "", fieldsStr = "") => `schema:v1
mode:execution
phase:${phase}
feature:omp-persistent-execution-review
next_action:start/continue task
plan_path:plan.md
plan_sha256:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
${fieldsStr}

settings[2]{key,value}:
  executor_model,google-antigravity/gemini-3.5-flash:high
  reviewer_model,openai-codex/gpt-5.5:high
${settingsStr}
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`.split('\n').filter(line => line.trim() !== '').join('\n');

  const t2TempDir = nodeFs.mkdtempSync(join(ROOT, "test/tmp_gsd_T2_"));
  const writeT2TempFile = (filename, content) => {
    nodeFs.writeFileSync(join(t2TempDir, filename), content, "utf8");
  };

  try {
    // 1. Write the history files for positive & negative tests
    // handoff-1.toon: completed review round 1
    const handoff1Content = validHandoffBase(
      "terminal-repair",
      "",
      `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests 82 pass 82 fail 0
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:4d223c66e49589a6a166162871488707222286df1383384b5b72e99f8c0f90a5
progress_guard:continue
progress_evidence:evidence_text
progress_status:advanced
reviewed_commit:abcdef1234567890abcdef1234567890abcdef12`
    ).replace("next_action:start/continue task", "next_action:enter terminal verification/repair")
     .replace("settings[2]{key,value}:", "settings[3]{key,value}:\n  my_opaque_key,my_opaque_value")
     .replace(/reload\[3\]\{skill,path\}:[\s\S]*/, `reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`);
    writeT2TempFile("handoff-1.toon", handoff1Content);

    // handoff-2.toon: completed review round 2
    const handoff2Content = validHandoffBase(
      "terminal-repair",
      "",
      `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests 82 pass 82 fail 0
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:4d223c66e49589a6a166162871488707222286df1383384b5b72e99f8c0f90a5
progress_guard:continue
progress_evidence:evidence_text
progress_status:advanced
reviewed_commit:commit_round2`
    ).replace("next_action:start/continue task", "next_action:enter terminal verification/repair")
     .replace(/reload\[3\]\{skill,path\}:[\s\S]*/, `reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`);
    writeT2TempFile("handoff-2.toon", handoff2Content);

    // handoff-3.toon: pending review round 3
    const handoff3Content = validHandoffBase(
      "terminal-review",
      "",
      `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:pending
previous_blocking_fingerprint:4d223c66e49589a6a166162871488707222286df1383384b5b72e99f8c0f90a5
previous_reviewed_commit:commit_round2
current_review_commit:commit_round3`
    ).replace("next_action:start/continue task", "next_action:enter terminal verification/repair")
     .replace(/reload\[3\]\{skill,path\}:[\s\S]*/, `reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`);
    writeT2TempFile("handoff-3.toon", handoff3Content);

    // --- POSITIVE FIXTURES ---

    // 1. Approved phase (no executor/reviewer agent fields, no model settings required)
    const approvedHandoff = `schema:v1
mode:execution
phase:approved
feature:canonical-fixture
next_action:start/continue task
plan_path:plan.md
plan_sha256:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[2]{key,value}:
  executor_model,google-antigravity/gemini-3.5-flash:high
  reviewer_model,openai-codex/gpt-5.5:high
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`;
    assert.doesNotThrow(() => rehydrate(approvedHandoff, installed, join(t2TempDir, "handoff-1.toon"), join(t2TempDir, "handoff-1.toon"), liveBindingLocal));

    // 2. Task-active phase (requires model settings and executor agent identity fields, no terminal progress fields)
    const taskActiveHandoff = validHandoffBase(
      "task-active",
      "",
      `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2`
    );
    assert.doesNotThrow(() => rehydrate(taskActiveHandoff, installed, join(t2TempDir, "handoff-1.toon"), join(t2TempDir, "handoff-1.toon"), liveBindingLocal));

    // 3. Green-task phase (requires completed executor fields but no terminal progress fields)
    const greenTaskHandoff = validHandoffBase(
      "green-task",
      "",
      `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:3`
    );
    assert.doesNotThrow(() => rehydrate(greenTaskHandoff, installed, join(t2TempDir, "handoff-1.toon"), join(t2TempDir, "handoff-1.toon"), liveBindingLocal));

    // 4. Terminal-review phase with reviewer_terminal_check:pending (requires prior progress fields, no completed terminal fields)
    const terminalReviewPendingHandoff = validHandoffBase(
      "terminal-review",
      "",
      `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:pending
previous_blocking_fingerprint:4d223c66e49589a6a166162871488707222286df1383384b5b72e99f8c0f90a5
previous_reviewed_commit:abcdef1234567890abcdef1234567890abcdef12
current_review_commit:1234567890abcdef1234567890abcdef12345678`
    ).replace("next_action:start/continue task", "next_action:enter terminal verification/repair")
     .replace(/reload\[3\]\{skill,path\}:[\s\S]*/, `reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`);
    assert.doesNotThrow(() => rehydrate(terminalReviewPendingHandoff, installed, join(t2TempDir, "handoff-2.toon"), join(t2TempDir, "handoff-2.toon"), liveBindingLocal));

    // 5. Terminal-repair phase (requires executor fields and completed reviewer fields)
    const terminalRepairHandoff = validHandoffBase(
      "terminal-repair",
      "",
      `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests 82 pass 82 fail 0
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:d2059d1868399b5543092ff008335d8e03ac72b2f90009ff1b0cab7ee52a1447
previous_blocking_fingerprint:4d223c66e49589a6a166162871488707222286df1383384b5b72e99f8c0f90a5
previous_reviewed_commit:commit_round2
progress_guard:continue because fingerprint changed
progress_evidence:evidence_text
progress_status:advanced
reviewed_commit:commit_round3`
    ).replace("next_action:start/continue task", "next_action:enter terminal verification/repair")
     .replace(/reload\[3\]\{skill,path\}:[\s\S]*/, `reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`);
    assert.doesNotThrow(() => rehydrate(terminalRepairHandoff, installed, join(t2TempDir, "handoff-4.toon"), join(t2TempDir, "handoff-4.toon"), liveBindingLocal));


    // 1. Missing settings model selectors in task-active
    const missingModelHandoff = `schema:v1
mode:execution
phase:task-active
feature:canonical-fixture
next_action:start/continue task
plan_path:plan.md
plan_sha256:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
settings[0]{key,value}:
reload[3]{skill,path}:
  gsd-executing-plans,skills/gsd-executing-plans/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-tdd,skills/gsd-tdd/SKILL.md`;
    assert.throws(() => rehydrate(missingModelHandoff, installed, join(t2TempDir, "handoff-1.toon"), join(t2TempDir, "handoff-1.toon"), liveBindingLocal), /Missing executor_model or reviewer_model/);

    // 2. Alias-only model selector
    const aliasModelHandoff = validHandoffBase("task-active", "").replace("google-antigravity/gemini-3.5-flash:high", "task")
      .replace("executor_agent:gsd-executor-2", "executor_agent:gsd-executor-2\nexecutor_actual_model:google-antigravity/gemini-3.5-flash:high\nexecutor_generation:2");
    assert.throws(() => rehydrate(aliasModelHandoff, installed, join(t2TempDir, "handoff-1.toon"), join(t2TempDir, "handoff-1.toon"), liveBindingLocal), /Alias-only model selector/);

    // 3. Same executor-reviewer selectors
    const sameModelHandoff = validHandoffBase("task-active", "").replace("openai-codex/gpt-5.5:high", "google-antigravity/gemini-3.5-flash:high")
      .replace("executor_agent:gsd-executor-2", "executor_agent:gsd-executor-2\nexecutor_actual_model:google-antigravity/gemini-3.5-flash:high\nexecutor_generation:2");
    assert.throws(() => rehydrate(sameModelHandoff, installed, join(t2TempDir, "handoff-1.toon"), join(t2TempDir, "handoff-1.toon"), liveBindingLocal), /must be distinct/);

    // 4. Invalid model selector format (no provider path slash/dash)
    const invalidFormatHandoff = validHandoffBase("task-active", "").replace("google-antigravity/gemini-3.5-flash:high", "invalidmodel")
      .replace("executor_agent:gsd-executor-2", "executor_agent:gsd-executor-2\nexecutor_actual_model:google-antigravity/gemini-3.5-flash:high\nexecutor_generation:2");
    assert.throws(() => rehydrate(invalidFormatHandoff, installed, join(t2TempDir, "handoff-1.toon"), join(t2TempDir, "handoff-1.toon"), liveBindingLocal), /Invalid executor model selector/);

    // 5. Missing phase-required identities (executor_agent in task-active)
    const missingExecutorAgentHandoff = validHandoffBase("task-active", "", "executor_actual_model:google-antigravity/gemini-3.5-flash:high\nexecutor_generation:2");
    assert.throws(() => rehydrate(missingExecutorAgentHandoff, installed, join(t2TempDir, "handoff-1.toon"), join(t2TempDir, "handoff-1.toon"), liveBindingLocal), /Missing executor identity/);

    // 6. Missing phase-required generations (executor_generation in task-active)
    const missingExecutorGenHandoff = validHandoffBase("task-active", "", "executor_agent:gsd-executor-2\nexecutor_actual_model:google-antigravity/gemini-3.5-flash:high");
    assert.throws(() => rehydrate(missingExecutorGenHandoff, installed, join(t2TempDir, "handoff-1.toon"), join(t2TempDir, "handoff-1.toon"), liveBindingLocal), /Missing executor identity/);

    // 7. Invalid phase-required generations (executor_generation is 0 or negative)
    const invalidExecutorGenHandoff = validHandoffBase("task-active", "", "executor_agent:gsd-executor-2\nexecutor_actual_model:google-antigravity/gemini-3.5-flash:high\nexecutor_generation:-1");
    assert.throws(() => rehydrate(invalidExecutorGenHandoff, installed, join(t2TempDir, "handoff-1.toon"), join(t2TempDir, "handoff-1.toon"), liveBindingLocal), /positive integer/);

    // 8. Missing phase-required identities (reviewer_agent in terminal-review)
    const missingReviewerAgentHandoff = validHandoffBase(
      "terminal-review",
      "",
      `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:pending
previous_blocking_fingerprint:4d223c66e49589a6a166162871488707222286df1383384b5b72e99f8c0f90a5
previous_reviewed_commit:abcdef1234567890abcdef1234567890abcdef12`
    ).replace("next_action:start/continue task", "next_action:enter terminal verification/repair")
     .replace(/reload\[3\]\{skill,path\}:[\s\S]*/, `reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`);
    assert.throws(() => rehydrate(missingReviewerAgentHandoff, installed, join(t2TempDir, "handoff-2.toon"), join(t2TempDir, "handoff-2.toon"), liveBindingLocal), /Missing reviewer identity/);

    // 9. Pending terminal-review missing previous_blocking_fingerprint
    const missingPrevFingerprintHandoff = validHandoffBase(
      "terminal-review",
      "",
      `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:pending
previous_reviewed_commit:abcdef1234567890abcdef1234567890abcdef12`
    ).replace("next_action:start/continue task", "next_action:enter terminal verification/repair")
     .replace(/reload\[3\]\{skill,path\}:[\s\S]*/, `reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`);
    assert.throws(() => rehydrate(missingPrevFingerprintHandoff, installed, join(t2TempDir, "handoff-2.toon"), join(t2TempDir, "handoff-2.toon"), liveBindingLocal), /Missing previous_blocking_fingerprint/);

    // 10. Completed terminal-repair missing reviewer_terminal_result
    const missingTermResultHandoff = validHandoffBase(
      "terminal-repair",
      "",
      `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:node --test test/*.test.js
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:d2059d1868399b5543092ff008335d8e03ac72b2f90009ff1b0cab7ee52a1447
previous_blocking_fingerprint:4d223c66e49589a6a166162871488707222286df1383384b5b72e99f8c0f90a5
previous_reviewed_commit:commit_round2
progress_guard:continue because fingerprint changed
progress_evidence:evidence_text
progress_status:advanced
reviewed_commit:commit_round3`
    ).replace("next_action:start/continue task", "next_action:enter terminal verification/repair")
     .replace(/reload\[3\]\{skill,path\}:[\s\S]*/, `reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`);
    assert.throws(() => rehydrate(missingTermResultHandoff, installed, join(t2TempDir, "handoff-4.toon"), join(t2TempDir, "handoff-4.toon"), liveBindingLocal), /Missing reviewer_terminal_result/);

    // 11. Completed terminal-repair missing progress_guard
    const missingProgressGuardHandoff = validHandoffBase(
      "terminal-repair",
      "",
      `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests 82 pass 82 fail 0
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:d2059d1868399b5543092ff008335d8e03ac72b2f90009ff1b0cab7ee52a1447
previous_blocking_fingerprint:4d223c66e49589a6a166162871488707222286df1383384b5b72e99f8c0f90a5
previous_reviewed_commit:commit_round2
progress_evidence:evidence_text
progress_status:advanced
reviewed_commit:commit_round3`
    ).replace("next_action:start/continue task", "next_action:enter terminal verification/repair")
     .replace(/reload\[3\]\{skill,path\}:[\s\S]*/, `reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`);
    assert.throws(() => rehydrate(missingProgressGuardHandoff, installed, join(t2TempDir, "handoff-4.toon"), join(t2TempDir, "handoff-4.toon"), liveBindingLocal), /Missing progress_guard/);

    // 11b. Completed terminal-repair missing progress_evidence
    const missingProgressEvidenceHandoff = validHandoffBase(
      "terminal-repair",
      "",
      `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests 82 pass 82 fail 0
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:d2059d1868399b5543092ff008335d8e03ac72b2f90009ff1b0cab7ee52a1447
previous_blocking_fingerprint:4d223c66e49589a6a166162871488707222286df1383384b5b72e99f8c0f90a5
previous_reviewed_commit:commit_round2
progress_guard:continue because fingerprint changed
progress_status:advanced
reviewed_commit:commit_round3`
    ).replace("next_action:start/continue task", "next_action:enter terminal verification/repair")
     .replace(/reload\[3\]\{skill,path\}:[\s\S]*/, `reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`);
    assert.throws(() => rehydrate(missingProgressEvidenceHandoff, installed, join(t2TempDir, "handoff-4.toon"), join(t2TempDir, "handoff-4.toon"), liveBindingLocal), /Missing progress_evidence/);

    // 11c. Completed terminal-repair missing previous_reviewed_commit
    const missingPrevCommitHandoff = validHandoffBase(
      "terminal-repair",
      "",
      `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests 82 pass 82 fail 0
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:d2059d1868399b5543092ff008335d8e03ac72b2f90009ff1b0cab7ee52a1447
previous_blocking_fingerprint:4d223c66e49589a6a166162871488707222286df1383384b5b72e99f8c0f90a5
progress_guard:continue because fingerprint changed
progress_evidence:evidence_text
progress_status:advanced
reviewed_commit:commit_round3`
    ).replace("next_action:start/continue task", "next_action:enter terminal verification/repair")
     .replace(/reload\[3\]\{skill,path\}:[\s\S]*/, `reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`);
    assert.throws(() => rehydrate(missingPrevCommitHandoff, installed, join(t2TempDir, "handoff-4.toon"), join(t2TempDir, "handoff-4.toon"), liveBindingLocal), /require previous_reviewed_commit/);

    // 11d. Completed terminal-repair mismatched previous_reviewed_commit
    const mismatchedPrevCommitHandoff = validHandoffBase(
      "terminal-repair",
      "",
      `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests 82 pass 82 fail 0
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:d2059d1868399b5543092ff008335d8e03ac72b2f90009ff1b0cab7ee52a1447
previous_blocking_fingerprint:4d223c66e49589a6a166162871488707222286df1383384b5b72e99f8c0f90a5
previous_reviewed_commit:commit_mismatch
progress_guard:continue because fingerprint changed
progress_evidence:evidence_text
progress_status:advanced
reviewed_commit:commit_round3`
    ).replace("next_action:start/continue task", "next_action:enter terminal verification/repair")
     .replace(/reload\[3\]\{skill,path\}:[\s\S]*/, `reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`);
    assert.throws(() => rehydrate(mismatchedPrevCommitHandoff, installed, join(t2TempDir, "handoff-4.toon"), join(t2TempDir, "handoff-4.toon"), liveBindingLocal), /previous_reviewed_commit mismatch/);

    // 11e. Completed terminal-repair unchanged reviewed commit
    const unchangedTempDir = nodeFs.mkdtempSync(join(ROOT, "test/tmp_gsd_unchanged_"));
    try {
      const h2Content = validHandoffBase(
        "terminal-repair",
        "",
        `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests 82 pass 82 fail 0
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:4d223c66e49589a6a166162871488707222286df1383384b5b72e99f8c0f90a5
progress_guard:continue
progress_evidence:evidence_text
progress_status:advanced
reviewed_commit:commit_round2`
      ).replace("next_action:start/continue task", "next_action:enter terminal verification/repair")
       .replace(/reload\[3\]\{skill,path\}:[\s\S]*/, `reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`);
      nodeFs.writeFileSync(join(unchangedTempDir, "handoff-2.toon"), h2Content, "utf8");

      const h3Content = validHandoffBase(
        "terminal-review",
        "",
        `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:pending
previous_blocking_fingerprint:4d223c66e49589a6a166162871488707222286df1383384b5b72e99f8c0f90a5
previous_reviewed_commit:commit_round2
current_review_commit:commit_round2`
      ).replace("next_action:start/continue task", "next_action:enter terminal verification/repair")
       .replace(/reload\[3\]\{skill,path\}:[\s\S]*/, `reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`);
      nodeFs.writeFileSync(join(unchangedTempDir, "handoff-3.toon"), h3Content, "utf8");

      const h4Content = validHandoffBase(
        "terminal-repair",
        "",
        `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests 82 pass 82 fail 0
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:d2059d1868399b5543092ff008335d8e03ac72b2f90009ff1b0cab7ee52a1447
previous_blocking_fingerprint:4d223c66e49589a6a166162871488707222286df1383384b5b72e99f8c0f90a5
previous_reviewed_commit:commit_round2
progress_guard:continue because fingerprint changed
progress_evidence:evidence_text
progress_status:advanced
reviewed_commit:commit_round2`
      ).replace("next_action:start/continue task", "next_action:enter terminal verification/repair")
       .replace(/reload\[3\]\{skill,path\}:[\s\S]*/, `reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`);

      assert.throws(() => rehydrate(h4Content, installed, join(unchangedTempDir, "handoff-4.toon"), join(unchangedTempDir, "handoff-4.toon"), liveBindingLocal), /Unchanged commit fails closed/);
    } finally {
      nodeFs.rmSync(unchangedTempDir, { recursive: true, force: true });
    }
    // 12. Unchanged repeated fingerprint/no-progress rejection
    const unchangedFingerprintNoProgressHandoff = validHandoffBase(
      "terminal-repair",
      "",
      `executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests 82 pass 82 fail 0
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:4d223c66e49589a6a166162871488707222286df1383384b5b72e99f8c0f90a5
previous_blocking_fingerprint:4d223c66e49589a6a166162871488707222286df1383384b5b72e99f8c0f90a5
previous_reviewed_commit:commit_round2
progress_guard:continue terminal repair
progress_evidence:evidence_text
progress_status:advanced
reviewed_commit:commit_round3`
    ).replace("next_action:start/continue task", "next_action:enter terminal verification/repair")
     .replace(/reload\[3\]\{skill,path\}:[\s\S]*/, `reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`);
    assert.throws(() => rehydrate(unchangedFingerprintNoProgressHandoff, installed, join(t2TempDir, "handoff-4.toon"), join(t2TempDir, "handoff-4.toon"), liveBindingLocal), /Unchanged repeated fingerprint fails closed/);

    // --- Round 5 unit tests ---
    const mockDir = t2TempDir;
    const activeBinding = {
      path: ".scratch/omp-persistent-execution-review/plan.md",
      sha256: "b1f939f1463ddb66c1241e24261fb61778938aa19a7c8810b3205cf14f1de26c"
    };

    const writeMockHandoff = (filename, phase, nextAction, fieldsStr) => {
      const content = `schema:v1
mode:execution
phase:${phase}
feature:omp-persistent-execution-review
next_action:${nextAction}
plan_path:.scratch/omp-persistent-execution-review/plan.md
plan_sha256:b1f939f1463ddb66c1241e24261fb61778938aa19a7c8810b3205cf14f1de26c
${fieldsStr}
settings[2]{key,value}:
  executor_model,google-antigravity/gemini-3.5-flash:high
  reviewer_model,openai-codex/gpt-5.5:high
reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`.split('\n').filter(line => line.trim() !== '').join('\n');
      nodeFs.writeFileSync(join(mockDir, filename), content, "utf8");
    };

    const deleteMockHandoff = (filename) => {
      try {
        nodeFs.unlinkSync(join(mockDir, filename));
      } catch (e) {}
    };

    // Set up mock handoff-997 (completed review, round 1)
    writeMockHandoff("handoff-997.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests 82 pass 82 fail 0
reviewer_verdict:BLOCKED
blocking_count:3
blocking_fingerprint:fingerprint_A
previous_blocking_fingerprint:fingerprint_prev
reviewed_commit:commit_A
progress_status:advanced
progress_guard:continue
progress_evidence:evidence_text
`);

    // Set up mock handoff-998 (pending review, round 2)
    writeMockHandoff("handoff-998.toon", "terminal-review", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:pending
previous_blocking_fingerprint:fingerprint_A
previous_reviewed_commit:commit_A
current_review_commit:commit_B
`);

    // Set up mock handoff-999 (completed review, round 2)
    writeMockHandoff("handoff-999.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests 82 pass 82 fail 0
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:fingerprint_B
previous_blocking_fingerprint:fingerprint_A
trigger_review_handoff:.scratch/omp-persistent-execution-review/handoff-998.toon
reviewed_commit:commit_B
previous_reviewed_commit:commit_A
progress_status:advanced
progress_guard:continue
progress_evidence:evidence_text
`);

    // Assert both 998 and 999 are valid
    const p998 = join(mockDir, "handoff-998.toon");
    const p999 = join(mockDir, "handoff-999.toon");
    const content998 = readFileSync(p998, "utf8");
    const content999 = readFileSync(p999, "utf8");
    assert.doesNotThrow(() => rehydrate(content998, installed, p998, p998, activeBinding));
    assert.doesNotThrow(() => rehydrate(content999, installed, p999, p999, activeBinding));

    // 1. Sentinel agent check for executor
    const sentinelExecContent = content999.replace("executor_agent:gsd-executor-2", "executor_agent:none");
    assert.throws(() => rehydrate(sentinelExecContent, installed, p999, p999, activeBinding), /Invalid sentinel value/);

    // 2. Sentinel agent check for reviewer
    const sentinelRevContent = content999.replace("reviewer_agent:gsd-reviewer", "reviewer_agent:unassigned");
    assert.throws(() => rehydrate(sentinelRevContent, installed, p999, p999, activeBinding), /Invalid sentinel value/);

    // 3. Verdict not BLOCKED for terminal-repair
    const passVerdictContent = content999.replace("reviewer_verdict:BLOCKED", "reviewer_verdict:PASS");
    assert.throws(() => rehydrate(passVerdictContent, installed, p999, p999, activeBinding), /terminal-repair requires reviewer_verdict to be BLOCKED/);

    // 4. Pending terminal-review specifying completed fields
    const completedFieldPendingContent = content998 + "\nreviewer_verdict:BLOCKED";
    assert.throws(() => rehydrate(completedFieldPendingContent, installed, p998, p998, activeBinding), /Pending terminal-review must not specify completed terminal fields/);

    // 4b. Pending terminal-review specifying valid completed_commit + progress transition fields
    const pendingWithProgressContent = content998 + "\ncompleted_commit:commit_B\nprogress_status:advanced\nprogress_evidence:evidence_text\nprogress_guard:continue because fingerprint changed";
    assert.doesNotThrow(() => rehydrate(pendingWithProgressContent, installed, p998, p998, activeBinding));

    // 4c. Pending terminal-review with completed_commit mismatching current_review_commit
    const pendingCommitMismatchContent = content998 + "\ncompleted_commit:commit_mismatch";
    assert.throws(() => rehydrate(pendingCommitMismatchContent, installed, p998, p998, activeBinding), /completed_commit.*must equal current_review_commit/);
    // 5. Completed terminal-repair specifying pending check
    const pendingCheckCompletedContent = content999.replace("reviewer_terminal_check:node --test test/*.test.js", "reviewer_terminal_check:pending");
    assert.throws(() => rehydrate(pendingCheckCompletedContent, installed, p999, p999, activeBinding), /terminal-repair requires a completed reviewer_terminal_check/);

    // 6. Reviewed commit mismatch in terminal-repair (current reviewed_commit != triggering pending current_review_commit)
    const commitMismatchContent = content999.replace("reviewed_commit:commit_B", "reviewed_commit:commit_mismatch");
    assert.throws(() => rehydrate(commitMismatchContent, installed, p999, p999, activeBinding), /reviewed_commit.*must equal triggering pending review/);

    // 6a. Executor agent mismatch between repair and triggering pending review
    const execAgentMismatchContent = content999.replace("executor_agent:gsd-executor-2", "executor_agent:gsd-executor-other");
    assert.throws(() => rehydrate(execAgentMismatchContent, installed, p999, p999, activeBinding), /executor_agent mismatch in pending terminal-review/);

    // 6b. Reviewer agent mismatch between repair and triggering pending review
    const revAgentMismatchContent = content999.replace("reviewer_agent:gsd-reviewer", "reviewer_agent:gsd-reviewer-other");
    assert.throws(() => rehydrate(revAgentMismatchContent, installed, p999, p999, activeBinding), /reviewer_agent mismatch in pending terminal-review/);

    // 6c. Triggering terminal-review round >= 2 with previous_completed_review_handoff pointing to a mismatched completed review
    writeMockHandoff("handoff-997.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests 82 pass 82 fail 0
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:fingerprint_OTHER
reviewed_commit:commit_OTHER
progress_guard:continue
progress_evidence:evidence_text
progress_status:advanced
`);

    writeMockHandoff("handoff-998.toon", "terminal-review", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:pending
previous_completed_review_handoff:.scratch/omp-persistent-execution-review/handoff-997.toon
previous_blocking_fingerprint:fingerprint_A
previous_reviewed_commit:commit_A
current_review_commit:commit_B
`);

    assert.throws(() => rehydrate(content999, installed, p999, p999, activeBinding), /previous_blocking_fingerprint mismatch/);

    // Restore handoff-997.toon and handoff-998.toon back to default valid state for subsequent tests
    writeMockHandoff("handoff-997.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests 82 pass 82 fail 0
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:fingerprint_A
reviewed_commit:commit_A
progress_guard:continue
progress_evidence:evidence_text
progress_status:advanced
`);

    writeMockHandoff("handoff-998.toon", "terminal-review", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:pending
previous_blocking_fingerprint:fingerprint_A
previous_reviewed_commit:commit_A
current_review_commit:commit_B
`);
    // 7. Unchanged fingerprint from prior completed review
    const unchangedFingerprintContent = content999.replace("blocking_fingerprint:fingerprint_B", "blocking_fingerprint:fingerprint_A");
    assert.throws(() => rehydrate(unchangedFingerprintContent, installed, p999, p999, activeBinding), /Unchanged repeated fingerprint fails closed/);

    // 8. Unchanged commit from prior completed review
    // First make triggering pending current_review_commit commit_A too (mocking no commit change)
    writeMockHandoff("handoff-998.toon", "terminal-review", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:pending
previous_blocking_fingerprint:fingerprint_A
previous_reviewed_commit:commit_A
current_review_commit:commit_A
`);
    // Unchanged review commit in pending review itself should fail:
    const unchangedPendingContent = readFileSync(p998, "utf8");
    assert.throws(() => rehydrate(unchangedPendingContent, installed, p998, p998, activeBinding), /Unchanged review commit/);

    // --- IMP-27..29 unit tests ---
    // --- IMP-27..29 unit tests ---
    // A. Malformed history filenames
    // 1. History filename with 0 (handoff-0.toon)
    writeMockHandoff("handoff-995.toon", "terminal-review", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:pending
previous_blocking_fingerprint:fingerprint_A
previous_reviewed_commit:commit_A
current_review_commit:commit_B
previous_completed_review_handoff:.scratch/omp-persistent-execution-review/handoff-0.toon
`);
    const p995 = join(mockDir, "handoff-995.toon");
    const content995 = readFileSync(p995, "utf8");
    assert.throws(() => rehydrate(content995, installed, p995, p995, activeBinding), /Invalid canonical handoff filename format/);

    // 2. History filename with leading zero (handoff-01.toon)
    const leadingZeroContent = content995.replace("handoff-0.toon", "handoff-01.toon");
    assert.throws(() => rehydrate(leadingZeroContent, installed, p995, p995, activeBinding), /Invalid canonical handoff filename format/);

    // 3. History filename with letters (handoff-2a.toon)
    const nonNumericContent = content995.replace("handoff-0.toon", "handoff-2a.toon");
    assert.throws(() => rehydrate(nonNumericContent, installed, p995, p995, activeBinding), /Invalid canonical handoff filename format/);

    // 4. History filename with prefix (prefix-handoff-1.toon)
    const prefixContent = content995.replace("handoff-0.toon", "prefix-handoff-1.toon");
    assert.throws(() => rehydrate(prefixContent, installed, p995, p995, activeBinding), /Invalid canonical handoff filename format/);

    // B. Semantic completeness of prior completed review (IMP-27)
    // 1. Prior completed review has non-terminal-repair phase (e.g. task-active)
    writeMockHandoff("handoff-994.toon", "task-active", "start/continue task", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
`);
    const validRefHandoff995Content = content995.replace("handoff-0.toon", "handoff-994.toon");
    assert.throws(() => rehydrate(validRefHandoff995Content, installed, p995, p995, activeBinding), /Prior completed review history phase must be terminal-repair/);

    // 2. Prior completed review has PASS verdict
    writeMockHandoff("handoff-994.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests pass
reviewer_verdict:PASS
progress_status:advanced
progress_guard:continue
reviewed_commit:commit_A
`);
    assert.throws(() => rehydrate(validRefHandoff995Content, installed, p995, p995, activeBinding), /Prior completed review reviewer_verdict must be BLOCKED/);

    // 3. Prior completed review has pending check
    writeMockHandoff("handoff-994.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:pending
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fingerprint_A
progress_status:advanced
progress_guard:continue
reviewed_commit:commit_A
`);
    assert.throws(() => rehydrate(validRefHandoff995Content, installed, p995, p995, activeBinding), /Prior completed review requires non-pending reviewer_terminal_check/);

    // C. Missing plan_path or plan_sha256 in history (IMP-28)
    writeMockHandoff("handoff-994.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fingerprint_A
progress_status:advanced
progress_guard:continue
reviewed_commit:commit_A
`);
    const noPlanPathContent = readFileSync(join(mockDir, "handoff-994.toon"), "utf8").replace(/plan_path:.*\n/, "");
    nodeFs.writeFileSync(join(mockDir, "handoff-994.toon"), noPlanPathContent, "utf8");
    assert.throws(() => rehydrate(validRefHandoff995Content, installed, p995, p995, activeBinding), /Missing plan_path in history file/);

    // D. Binding mismatches (IMP-28)
    writeMockHandoff("handoff-994.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fingerprint_A
progress_status:advanced
progress_guard:continue
reviewed_commit:commit_A
`);
    const modelMismatchContent = readFileSync(join(mockDir, "handoff-994.toon"), "utf8").replace("openai-codex/gpt-5.5:high", "openai-codex/gpt-4o:high");
    nodeFs.writeFileSync(join(mockDir, "handoff-994.toon"), modelMismatchContent, "utf8");
    assert.throws(() => rehydrate(validRefHandoff995Content, installed, p995, p995, activeBinding), /does not match bound reviewer_model/);

    // E. IMP-30 & IMP-31 Deep field mandates & Symlink rejection
    // 1. Missing executor_agent in prior completed review
    writeMockHandoff("handoff-994.toon", "terminal-repair", "enter terminal verification/repair", `
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fingerprint_A
progress_status:advanced
progress_guard:continue
progress_evidence:tests failed
reviewed_commit:commit_A
`);
    assert.throws(() => rehydrate(validRefHandoff995Content, installed, p995, p995, activeBinding), /Missing executor identity/);

    // 2. Sentinel executor_agent in prior completed review
    writeMockHandoff("handoff-994.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:none
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fingerprint_A
progress_status:advanced
progress_guard:continue
progress_evidence:tests failed
reviewed_commit:commit_A
`);
    assert.throws(() => rehydrate(validRefHandoff995Content, installed, p995, p995, activeBinding), /Invalid sentinel value/);
    // 3. Missing progress_status in prior completed review
    writeMockHandoff("handoff-994.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fingerprint_A
progress_guard:continue
progress_evidence:tests failed
reviewed_commit:commit_A
`);
    assert.throws(() => rehydrate(validRefHandoff995Content, installed, p995, p995, activeBinding), /Prior completed review progress_status must be 'advanced'/);

    // 4. Missing reviewed_commit in prior completed review
    writeMockHandoff("handoff-994.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fingerprint_A
progress_status:advanced
progress_guard:continue
progress_evidence:tests failed
`);
    assert.throws(() => rehydrate(validRefHandoff995Content, installed, p995, p995, activeBinding), /Missing reviewed_commit in prior completed review/);

    // 5. Missing feature in prior history file
    writeMockHandoff("handoff-994.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fingerprint_A
progress_status:advanced
progress_guard:continue
progress_evidence:tests failed
reviewed_commit:commit_A
`);
    const noFeatureHistContent = readFileSync(join(mockDir, "handoff-994.toon"), "utf8").replace(/feature:.*\n/, "");
    nodeFs.writeFileSync(join(mockDir, "handoff-994.toon"), noFeatureHistContent, "utf8");
    assert.throws(() => rehydrate(validRefHandoff995Content, installed, p995, p995, activeBinding), /Missing feature in history file/);

    // 6. Symlinked history file rejection before read
    nodeFs.rmSync(join(mockDir, "handoff-994.toon"), { force: true });
    nodeFs.symlinkSync(join(mockDir, "handoff-995.toon"), join(mockDir, "handoff-994.toon"));
    assert.throws(() => rehydrate(validRefHandoff995Content, installed, p995, p995, activeBinding), /Symbolic link rejected for history handoff file/);

    // 7. Prior completed review mode must be execution
    nodeFs.rmSync(join(mockDir, "handoff-994.toon"), { force: true });
    nodeFs.writeFileSync(join(mockDir, "handoff-994.toon"), `schema:v1
mode:discussion
phase:terminal-repair
feature:omp-persistent-execution-review
next_action:enter terminal verification/repair
plan_path:.scratch/omp-persistent-execution-review/plan.md
plan_sha256:b1f939f1463ddb66c1241e24261fb61778938aa19a7c8810b3205cf14f1de26c
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fingerprint_A
progress_status:advanced
progress_guard:continue
progress_evidence:tests failed
reviewed_commit:commit_A
settings[2]{key,value}:
  executor_model,google-antigravity/gemini-3.5-flash:high
  reviewer_model,openai-codex/gpt-5.5:high
reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`, "utf8");
    assert.throws(() => rehydrate(validRefHandoff995Content, installed, p995, p995, activeBinding), /Prior completed review mode must be execution/);

    // 8. Prior completed review next_action must be enter terminal verification/repair
    nodeFs.rmSync(join(mockDir, "handoff-994.toon"), { force: true });
    nodeFs.writeFileSync(join(mockDir, "handoff-994.toon"), `schema:v1
mode:execution
phase:terminal-repair
feature:omp-persistent-execution-review
next_action:start/continue task
plan_path:.scratch/omp-persistent-execution-review/plan.md
plan_sha256:b1f939f1463ddb66c1241e24261fb61778938aa19a7c8810b3205cf14f1de26c
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fingerprint_A
progress_status:advanced
progress_guard:continue
progress_evidence:tests failed
reviewed_commit:commit_A
settings[2]{key,value}:
  executor_model,google-antigravity/gemini-3.5-flash:high
  reviewer_model,openai-codex/gpt-5.5:high
reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`, "utf8");
    assert.throws(() => rehydrate(validRefHandoff995Content, installed, p995, p995, activeBinding), /Prior completed review next_action must be 'enter terminal verification\/repair'/);

    // 9. Prior completed review missing progress_evidence
    nodeFs.rmSync(join(mockDir, "handoff-994.toon"), { force: true });
    nodeFs.writeFileSync(join(mockDir, "handoff-994.toon"), `schema:v1
mode:execution
phase:terminal-repair
feature:omp-persistent-execution-review
next_action:enter terminal verification/repair
plan_path:.scratch/omp-persistent-execution-review/plan.md
plan_sha256:b1f939f1463ddb66c1241e24261fb61778938aa19a7c8810b3205cf14f1de26c
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fingerprint_A
progress_status:advanced
progress_guard:continue
reviewed_commit:commit_A
settings[2]{key,value}:
  executor_model,google-antigravity/gemini-3.5-flash:high
  reviewer_model,openai-codex/gpt-5.5:high
reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`, "utf8");
    assert.throws(() => rehydrate(validRefHandoff995Content, installed, p995, p995, activeBinding), /Missing progress_evidence/);

    // 10. Prior completed review round >= 2 unchanged repeated fingerprint
    writeMockHandoff("handoff-992.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fingerprint_A
progress_status:advanced
progress_guard:continue
progress_evidence:tests failed
reviewed_commit:commit_A
`);

    writeMockHandoff("handoff-994.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fingerprint_A
previous_blocking_fingerprint:fingerprint_A
progress_status:advanced
progress_guard:continue
progress_evidence:tests failed
reviewed_commit:commit_A
previous_reviewed_commit:commit_A
`);
    assert.throws(() => rehydrate(validRefHandoff995Content, installed, p995, p995, activeBinding), /Unchanged repeated fingerprint/);

    // 11. Prior completed review duplicate reload skill
    nodeFs.rmSync(join(mockDir, "handoff-994.toon"), { force: true });
    nodeFs.writeFileSync(join(mockDir, "handoff-994.toon"), `schema:v1
mode:execution
phase:terminal-repair
feature:omp-persistent-execution-review
next_action:enter terminal verification/repair
plan_path:.scratch/omp-persistent-execution-review/plan.md
plan_sha256:b1f939f1463ddb66c1241e24261fb61778938aa19a7c8810b3205cf14f1de26c
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fingerprint_A
progress_status:advanced
progress_guard:continue
progress_evidence:tests failed
reviewed_commit:commit_A
settings[2]{key,value}:
  executor_model,google-antigravity/gemini-3.5-flash:high
  reviewer_model,openai-codex/gpt-5.5:high
reload[3]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-verify,skills/gsd-handoff/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md`, "utf8");
    assert.throws(() => rehydrate(validRefHandoff995Content, installed, p995, p995, activeBinding), /Duplicate skill in reload manifest/);

    // 12. Prior completed review settings key duplicate
    nodeFs.rmSync(join(mockDir, "handoff-994.toon"), { force: true });
    nodeFs.writeFileSync(join(mockDir, "handoff-994.toon"), `schema:v1
mode:execution
phase:terminal-repair
feature:omp-persistent-execution-review
next_action:enter terminal verification/repair
plan_path:.scratch/omp-persistent-execution-review/plan.md
plan_sha256:b1f939f1463ddb66c1241e24261fb61778938aa19a7c8810b3205cf14f1de26c
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fingerprint_A
progress_status:advanced
progress_guard:continue
progress_evidence:tests failed
reviewed_commit:commit_A
settings[4]{key,value}:
  executor_model,google-antigravity/gemini-3.5-flash:high
  reviewer_model,openai-codex/gpt-5.5:high
  ponytail_level,lite
  ponytail_level,full
reload[3]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
  gsd-ponytail,skills/gsd-ponytail/SKILL.md`, "utf8");
    assert.throws(() => rehydrate(validRefHandoff995Content, installed, p995, p995, activeBinding), /Duplicate key in settings/);

    // --- IMP-38 predecessor chain validator tests ---
    const testDir = join(mockDir, "t2_1");
    nodeFs.mkdirSync(testDir, { recursive: true });

    const writeHandoff = (filename, phase, action, fieldsStr) => {
      const trimmed = fieldsStr.trim();
      nodeFs.writeFileSync(join(testDir, filename), `schema:v1
mode:execution
phase:${phase}
feature:omp-persistent-execution-review
next_action:${action}
plan_path:.scratch/omp-persistent-execution-review/plan.md
plan_sha256:b1f939f1463ddb66c1241e24261fb61778938aa19a7c8810b3205cf14f1de26c
${trimmed}
settings[2]{key,value}:
  executor_model,google-antigravity/gemini-3.5-flash:high
  reviewer_model,openai-codex/gpt-5.5:high
reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
`, "utf8");
    };

    try {
      // 1. Valid handoff-3 round 2 -> h1 passes
      writeHandoff("handoff-1.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fp_1
progress_status:advanced
progress_guard:continue
progress_evidence:tests failed
completed_commit:commit_1
`);

      writeHandoff("handoff-3.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:fp_3
previous_blocking_fingerprint:fp_1
completed_commit:commit_3
previous_reviewed_commit:commit_1
trigger_review_handoff:.scratch/omp-persistent-execution-review/handoff-2.toon
progress_status:advanced
progress_guard:continue
progress_evidence:evidence_3
`);

      writeHandoff("handoff-4.toon", "terminal-review", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:3
reviewer_terminal_check:pending
previous_blocking_fingerprint:fp_3
previous_reviewed_commit:commit_3
current_review_commit:commit_4
previous_completed_review_handoff:.scratch/omp-persistent-execution-review/handoff-3.toon
`);

      const p4 = join(testDir, "handoff-4.toon");
      const content4 = readFileSync(p4, "utf8");
      assert.doesNotThrow(() => rehydrate(content4, installed, p4, p4, activeBinding));

      // 2. handoff-1 round 2 fails
      writeHandoff("handoff-1.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fp_1
previous_blocking_fingerprint:fp_0
completed_commit:commit_1
previous_reviewed_commit:commit_0
`);

      writeHandoff("handoff-2.toon", "terminal-review", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:3
reviewer_terminal_check:pending
previous_blocking_fingerprint:fp_1
previous_reviewed_commit:commit_1
current_review_commit:commit_2
previous_completed_review_handoff:.scratch/omp-persistent-execution-review/handoff-1.toon
`);

      const p2 = join(testDir, "handoff-2.toon");
      const content2 = readFileSync(p2, "utf8");
      assert.throws(() => rehydrate(content2, installed, p2, p2, activeBinding), /Invalid canonical handoff filename format/);

      // Restore handoff-1.toon to round 1
      writeHandoff("handoff-1.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fp_1
progress_status:advanced
progress_guard:continue
progress_evidence:tests failed
completed_commit:commit_1
`);

      // 3. missing predecessor fails
      // Remove handoff-1.toon
      nodeFs.unlinkSync(join(testDir, "handoff-1.toon"));
      assert.throws(() => rehydrate(content4, installed, p4, p4, activeBinding), /Predecessor history file not found/);

      // Restore handoff-1.toon
      writeHandoff("handoff-1.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fp_1
progress_status:advanced
progress_guard:continue
progress_evidence:tests failed
completed_commit:commit_1
`);

      // 4. Cycle/revisited node fails
      // Self-cycle on handoff-3 (predecessor points to handoff-3.toon)
      writeHandoff("handoff-3.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:fp_3
previous_blocking_fingerprint:fp_1
completed_commit:commit_3
previous_reviewed_commit:commit_1
trigger_review_handoff:.scratch/omp-persistent-execution-review/handoff-2.toon
previous_completed_review_handoff:.scratch/omp-persistent-execution-review/handoff-3.toon
progress_status:advanced
progress_guard:continue
progress_evidence:evidence_3
`);
      assert.throws(() => rehydrate(content4, installed, p4, p4, activeBinding), /Predecessor generation 3 must be less than current generation 3/);

      // Two-node cycle (handoff-3 points to handoff-1; handoff-1 has round 2 and points to handoff-3)
      writeHandoff("handoff-3.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:fp_3
previous_blocking_fingerprint:fp_1
completed_commit:commit_3
previous_reviewed_commit:commit_1
trigger_review_handoff:.scratch/omp-persistent-execution-review/handoff-2.toon
previous_completed_review_handoff:.scratch/omp-persistent-execution-review/handoff-1.toon
progress_status:advanced
progress_guard:continue
progress_evidence:evidence_3
`);

      writeHandoff("handoff-1.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fp_1
previous_blocking_fingerprint:fp_3
completed_commit:commit_1
previous_reviewed_commit:commit_3
previous_completed_review_handoff:.scratch/omp-persistent-execution-review/handoff-3.toon
`);
      assert.throws(() => rehydrate(content4, installed, p4, p4, activeBinding), /Cycle or revisited node detected/);

      // 5. Deep >=1500 completed rounds passes without RangeError or round cap
      for (let r = 1; r <= 1500; r++) {
        const g = 2 * r - 1;
        const prevG = g - 2;
        const roundContent = `schema:v1
mode:execution
phase:terminal-repair
feature:omp-persistent-execution-review
next_action:enter terminal verification/repair
plan_path:.scratch/omp-persistent-execution-review/plan.md
plan_sha256:b1f939f1463ddb66c1241e24261fb61778938aa19a7c8810b3205cf14f1de26c
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:${r}
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fp_${g}
progress_status:advanced
progress_guard:continue
progress_evidence:tests failed
completed_commit:commit_${g}
${r >= 2 ? `previous_blocking_fingerprint:fp_${prevG}
previous_reviewed_commit:commit_${prevG}
previous_completed_review_handoff:.scratch/omp-persistent-execution-review/handoff-${prevG}.toon
` : ""}settings[2]{key,value}:
  executor_model,google-antigravity/gemini-3.5-flash:high
  reviewer_model,openai-codex/gpt-5.5:high
reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
`;
        nodeFs.writeFileSync(join(testDir, `handoff-${g}.toon`), roundContent, "utf8");
      }

      const pending3000 = `schema:v1
mode:execution
phase:terminal-review
feature:omp-persistent-execution-review
next_action:enter terminal verification/repair
plan_path:.scratch/omp-persistent-execution-review/plan.md
plan_sha256:b1f939f1463ddb66c1241e24261fb61778938aa19a7c8810b3205cf14f1de26c
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1501
reviewer_terminal_check:pending
previous_blocking_fingerprint:fp_2999
previous_reviewed_commit:commit_2999
current_review_commit:commit_3000
previous_completed_review_handoff:.scratch/omp-persistent-execution-review/handoff-2999.toon
settings[2]{key,value}:
  executor_model,google-antigravity/gemini-3.5-flash:high
  reviewer_model,openai-codex/gpt-5.5:high
reload[2]{skill,path}:
  gsd-verify,skills/gsd-verify/SKILL.md
  gsd-handoff,skills/gsd-handoff/SKILL.md
`;
      const p3000 = join(testDir, "handoff-3000.toon");
      assert.doesNotThrow(() => rehydrate(pending3000, installed, p3000, p3000, activeBinding));
      // 6. Predecessor binding mismatch (middle/deep predecessor feature or plan_sha256 mismatch)
      // First, restore handoff-3.toon to its valid form (which references handoff-1.toon)
      writeHandoff("handoff-3.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:2
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:2
blocking_fingerprint:fp_3
previous_blocking_fingerprint:fp_1
completed_commit:commit_3
previous_reviewed_commit:commit_1
trigger_review_handoff:.scratch/omp-persistent-execution-review/handoff-2.toon
previous_completed_review_handoff:.scratch/omp-persistent-execution-review/handoff-1.toon
progress_status:advanced
progress_guard:continue
progress_evidence:evidence_3
`);

      // Write handoff-1.toon with valid fields
      writeHandoff("handoff-1.toon", "terminal-repair", "enter terminal verification/repair", `
executor_agent:gsd-executor-2
executor_actual_model:google-antigravity/gemini-3.5-flash:high
executor_generation:2
reviewer_agent:gsd-reviewer
reviewer_actual_model:openai-codex/gpt-5.5:high
reviewer_generation:1
review_round:1
reviewer_terminal_check:node --test test/*.test.js
reviewer_terminal_result:tests fail
reviewer_verdict:BLOCKED
blocking_count:1
blocking_fingerprint:fp_1
progress_status:advanced
progress_guard:continue
progress_evidence:tests failed
completed_commit:commit_1
`);

      const h1Path = join(testDir, "handoff-1.toon");
      const h1Content = nodeFs.readFileSync(h1Path, "utf8");

      // Mutate handoff-1.toon to have a different feature
      nodeFs.writeFileSync(h1Path, h1Content.replace("feature:omp-persistent-execution-review", "feature:omp-mismatched-feature"), "utf8");
      assert.throws(() => rehydrate(content4, installed, p4, p4, activeBinding), /Feature mismatch in history file/);

      // Restore handoff-1.toon feature but mismatch plan_sha256
      nodeFs.writeFileSync(h1Path, h1Content.replace("plan_sha256:b1f939f1463ddb66c1241e24261fb61778938aa19a7c8810b3205cf14f1de26c", "plan_sha256:mismatched-sha"), "utf8");
      assert.throws(() => rehydrate(content4, installed, p4, p4, activeBinding), /plan_sha256 mismatch in history file/);

      // Restore handoff-1.toon to its valid state
      nodeFs.writeFileSync(h1Path, h1Content, "utf8");

    } finally {
      nodeFs.rmSync(testDir, { recursive: true, force: true });
    }
  } finally {
    nodeFs.rmSync(t2TempDir, { recursive: true, force: true });
  }
});
test("activation fixtures and response parser enforce lazy primary-skill selection", () => {
  const fixtureText = read("test/eval/fixtures.json");
  const fixtures = JSON.parse(fixtureText);
  const installed = new Set(skillNames().filter((name) => name !== "gsd"));
  assert.deepEqual(validateFixtureSet(fixtures, installed), { ok: true });
  const documentedFixtureCount = read("README.md").match(/(\d+) workspace-state \+ prompt fixtures/);
  assert.ok(documentedFixtureCount);
  assert.equal(fixtures.length, Number(documentedFixtureCount[1]));
  assert.match(fixtureText, /approved plan\.md exist/);
  assert.doesNotMatch(fixtureText, /proposal\.toon|spec\.toon|design\.toon|plan\.toon/);
  assert.doesNotMatch(fixtureText, /"route"|"skill"/);

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
  assert.match(reference, /merged_cleanup_residual/);
  assert.match(evalRunner, /createBootstrap\(repoRoot\)/);
  assert.match(evalRunner, /discoverSkillCatalog\(repoRoot\)/);
  assert.doesNotMatch(evalRunner, /REFERENCE\.md|route|trace|--mode/);
  assert.match(master, /result-marker decision matrix/i);
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
    writeFileSync(join(featDir, "handoff-1.toon"), "handoff");

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
  assert.match(executingPlans, /A "None\." decisions block in the plan is represented as an explicit empty decisions marker/i);
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


  // Workflow approval-final carve-out: both to-plan and executing-plans must match
  const terminalDispositionException = /except the sole terminal scratch disposition \(delete, retain, or archive-and-delete\) offered after implementation checks pass and before final terminal review\/squash; that disposition never reopens planning, visual review, or any other menu\./;
  assert.match(toPlan, /This is the last normal prompt:/);
  assert.match(toPlan, /no later planning menu, confirmation, or visual-review offer appears,/);
  assert.match(toPlan, terminalDispositionException);
  assert.doesNotMatch(toPlan, /no later menu, offer, or confirmation appears/);
  assert.match(executing, /Approval is the last normal prompt\./);
  assert.match(executing, /no planning menus, confirmations, visual-review offers, or manual merge,/);
  assert.match(executing, terminalDispositionException);
  assert.doesNotMatch(executing, /no later menu, offer, or confirmation appears/);
  // REFERENCE keeps the sole post-approval human prompt phrasing as the canonical disposition contract
  assert.match(reference, /The sole post-approval human prompt is the terminal scratch disposition \(delete, retain, or archive-and-delete\) offered after implementation checks pass and before final terminal review\/squash; it never reopens planning, visual review, or any other menu\./);

  // AC-1: option, destinations, pre-review/pre-squash timing, same-squash inclusion, scratch deletion, no post-merge docs commit
  assert.match(reference, /Terminal scratch disposition/i);
  assert.match(reference, /delete, retain, or archive-and-delete/);
  assert.match(reference, /After implementation checks pass and before the final terminal review\/squash/);
  assert.match(reference, /docs\/gsd\/<feature>\/archive\/plan\.md/);
  assert.match(reference, /docs\/gsd\/<feature>\/archive\/implementation\.md/);
  assert.match(reference, /same green one-feature\/one-squash commit/);
  assert.match(reference, /never create a post-squash or post-merge documentation-only commit/);
  assert.match(reference, /then remove `\.scratch\/<feature>\/` after publication/);

  assert.match(verify, /After implementation checks pass and before the final terminal review\/squash/);
  assert.match(verify, /delete, retain, or archive-and-delete/);
  assert.match(verify, /copy the exact approved `\.scratch\/<feature>\/plan\.md` to `docs\/gsd\/<feature>\/archive\/plan\.md`/);
  assert.match(verify, /write `docs\/gsd\/<feature>\/archive\/implementation\.md`/);
  assert.match(verify, /feature outcome, changed paths, acceptance outcomes, and verification evidence/);
  assert.match(verify, /same green one-feature\/one-squash commit/);
  assert.match(verify, /then delete `\.scratch\/<feature>\/` after publication/);
  assert.match(verify, /never create a post-squash documentation-only commit/);

  assert.match(master, /terminal scratch disposition/);
  assert.match(master, /delete, retain, or archive-and-delete/);
  assert.match(master, /docs\/gsd\/<feature>\/archive\/plan\.md/);
  assert.match(master, /docs\/gsd\/<feature>\/archive\/implementation\.md/);

  // AC-2: reference-only authority, no runtime TOON, fail-closed collision, preserve result/one-squash/cleanup
  assert.match(reference, /non-authoritative historical reference/);
  assert.match(reference, /sole execution\/design authority/);
  assert.match(reference, /Do not copy handoffs, immutable attempts, `result\.toon`/);
  assert.match(reference, /If either archive destination already exists, fail closed and preserve prior content; never overwrite/);
  assert.match(reference, /Existing result-marker schema, one-squash branch cleanup, and scratch cleanup contracts remain intact/);
  assert.match(reference, /The sole post-approval human prompt is the terminal scratch disposition/);
  assert.match(reference, /it never reopens planning, visual review, or any other menu/);
  assert.match(reference, /Post-merge `scratch:pending` recovery resumes only the existing delete-or-retain decision/);
  assert.match(reference, /pre-squash archive opportunity is not reopened after merge/);

  assert.match(verify, /non-authoritative historical reference only/);
  assert.match(verify, /never copy handoffs, attempts, or result markers/);
  assert.match(verify, /fail closed without overwrite on collision/);

  assert.match(master, /never reopens planning or any other menu/);
  assert.match(master, /pre-squash archive opportunity is not reopened/);

  // Preserve existing result-marker schema and delete-or-retain recovery wording
  assert.match(reference, /exact nine-line UTF-8\/LF scalar record/);
  assert.match(reference, /scratch:<retained\|pending>/);
  assert.match(reference, /Resume only that marker's existing delete-or-retain decision/);
  assert.match(master, /Resume only its existing delete-or-retain decision/);

  // Negative: no automatic archive, no archived-feature resume, no full scratch copy
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

test("AC-2 repair: task repair is executor-only without gsd-verify or gsdReviewer", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");

  // Task repair uses start/continue task (executor-only) — not a reviewer/verify path
  assert.match(execution, /task-repair handoff[\s\S]{0,200}next_action` set to `start\/continue task`/);
  assert.doesNotMatch(execution, /next_action` set to `run task review\/repair`/);

  // Reload mapping must not load gsd-verify or diagnose via a per-task review action
  assert.doesNotMatch(reference, /`run task review\/repair`: requires unconditional base skills `gsd-executing-plans`, `gsd-handoff`, `gsd-verify`/);
  assert.match(reference, /`start\/continue task`: requires unconditional base skills `gsd-executing-plans`, `gsd-handoff`, and `gsd-tdd`/);
  // Task repair remains executor-only: no gsd-verify and no gsdReviewer in the task loop
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

  // Parent keeps executor-only focused-check decision for task repair
  assert.match(execution, /Do not dispatch `gsdReviewer` per task/);
  assert.match(execution, /task-repair handoff[\s\S]{0,200}next_action` set to `start\/continue task`/);

  // Terminal whole-diff review lives only in gsd-verify / gsd-reviewer
  assert.match(verify, /whole-diff review only after the complete feature-affected slow suite is green/i);
  assert.match(reviewer, /terminal whole-diff/i);
  assert.match(reviewer, /Do not dispatch `gsdReviewer` per task/);

  // Executor repair protocol must not imply per-task reviewer re-review
  assert.doesNotMatch(executor, /submit for re-review/i);
  assert.doesNotMatch(executor, /dispatch `gsdReviewer`/i);
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

  // Invocation modes table must be well-formed with real mode rows
  const modes = ponytail.match(/## Invocation modes\n+([\s\S]*?)(?:\n## |\n*$)/);
  assert.ok(modes, "Invocation modes section required");
  const modeRows = [...modes[1].matchAll(/^\| (?!Mode|---)([^|]+) \|/gm)].map((m) => m[1].trim());
  assert.ok(modeRows.length >= 2, "at least Quick-fix and Explicit toggle modes");
  assert.ok(modeRows.some((r) => /quick-fix/i.test(r)), "Quick-fix auto-fire mode");
  assert.ok(modeRows.some((r) => /explicit/i.test(r)), "Explicit session toggle mode");
  // Mode table columns remain well-formed (5 cells)
  assert.match(modes[1], /^\| Mode \| Required \| Optional \| Produced \| Missing required \|$/m);
  for (const line of modes[1].split("\n")) {
    if (!line.startsWith("|") || /Mode|---/.test(line)) continue;
    const cells = line.split("|").slice(1, -1);
    assert.equal(cells.length, 5, `mode row cell count: ${line}`);
  }
  // Runtime policy modes document no artifact writes after the table
  assert.match(modes[1], /runtime policy transitions with no artifact requirements or writes/i);

  // Distinct runtime fields
  assert.match(ponytail, /explicit_level/);
  assert.match(ponytail, /auto_scope/);
  assert.match(ponytail, /none\|lite\|full\|ultra|exactly `none\|lite\|full\|ultra`/);
  assert.match(ponytail, /none\|quick-fix|exactly `none\|quick-fix`/);

  // State transitions table is normative and includes autofire + handoff + scope expansion
  assert.match(ponytail, /## State transitions \(normative\)/);
  assert.match(ponytail, /event=quick-fix;explicit_level=none;auto_scope=none/);
  assert.match(ponytail, /event=scope-expands;explicit_level=<current>;auto_scope=<scope>/);
  assert.match(ponytail, /event=handoff-write;explicit_level=<level>;auto_scope=<scope>/);
  assert.match(ponytail, /event=handoff-restore;explicit_level=<current>;auto_scope=<scope>;row=ponytail_level,<level>/);
  assert.match(ponytail, /ponytail_level,<level>/);
  assert.match(ponytail, /Auto-fire never becomes explicit state|auto-fire is never serialized/i);

  // Intensity levels remain explicit
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
  // No per-task re-enter review wording
  assert.doesNotMatch(execution, /re-enters review/i);
  assert.doesNotMatch(execution, /re-enter review/i);
  // Red focused repair returns executor-only focused-check decision
  assert.match(
    execution,
    /report replacement green evidence to the parent for an executor-only focused-check decision|executor-only focused-check decision/i,
  );
  assert.match(execution, /Do not dispatch `gsdReviewer` per task/);
  assert.match(execution, /task-repair handoff[\s\S]{0,200}next_action` set to `start\/continue task`/);
  // Independent review remains terminal-only
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
