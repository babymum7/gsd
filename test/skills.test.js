import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import nodeFs from "node:fs";
import { dirname, join, resolve } from "node:path";
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
  // positive lifecycle/role assertions
  assert.match(execution, /Child roles \(implementer, reviewer, and fixer\) consume the immutable attempt/);
  assert.match(execution, /dispatches one fresh task implementer/);
  assert.match(execution, /dispatches a fresh read-only reviewer/);
  assert.match(execution, /dispatches a fresh finding-scoped `task` fixer/);

  // negative assertions for repeated child live-plan validation
  assert.match(execution, /Instead of repeated full validation, follow the approved phase-boundary semantic-validation and digest-guard model\./);
  assert.match(execution, /without independently reparsing `plan\.md`/);

  // negative assertions for implementer acceptance
  assert.match(execution, /The implementer runs its focused check once after implementation; it never runs acceptance checks\./);
  assert.match(execution, /Task acceptance deferral is removed; the terminal verifier solely owns acceptance\/E2E\./);

  // negative assertions for missing freshness
  assert.match(execution, /Repeat this full parse and binding check only at execution entry\/resume\./);
  assert.match(execution, /Task attempt creation performs only a lightweight bound-source digest comparison\./);

  // negative assertions for ambiguous terminal replay/fixer
  assert.match(execution, /After any fresh task fixer or inline fallback, the fixer reruns only focused checks invalidated by its repair, records replacement green evidence for each invalidated check, and re-enters fresh review\./);

  // negative assertions for legacy normal sources
  assert.match(execution, /Any legacy `proposal\.md`, `spec\.md`, or `design\.md` is rejected\./);

  // negative assertions for lost parent ownership
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

  function validateHandoff(parsed, installedSkills) {
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
      "run task review/repair",
      "enter terminal verification/repair",
      "Discussion/Spec-escalation"
    ];
    const isActionValid = nextAction !== undefined && nextAction !== "" && validNextActions.includes(nextAction);

    if (isActionValid) {
      const requiredUnconditional = {
        "start/continue task": ["gsd-executing-plans", "gsd-handoff", "gsd-tdd"],
        "run task review/repair": ["gsd-executing-plans", "gsd-handoff", "gsd-verify", "gsd-diagnosing-bugs"],
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
    const parsed = parseHandoff(content, installedSkills);

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
      "run task review/repair",
      "enter terminal verification/repair",
      "Discussion/Spec-escalation"
    ];
    const isActionValid = nextAction !== undefined && nextAction !== "" && validNextActions.includes(nextAction);

    if (isActionValid) {
      const requiredUnconditional = {
        "start/continue task": ["gsd-executing-plans", "gsd-handoff", "gsd-tdd"],
        "run task review/repair": ["gsd-executing-plans", "gsd-handoff", "gsd-verify", "gsd-diagnosing-bugs"],
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

    logs.push(`validate handoff: ${highestHandoffPath}`);
    logs.push(`execute next_action: ${nextAction}`);
    return logs;
  }


  const execStr = (s) => s
    .replace("schema:v1", "schema:v1\nmode:execution\nphase:approved")
    .replace("plan_path:.scratch/canonical-fixture/plan.md", "plan_path:plan.md")
    .replace("plan_hash:", "plan_sha256:");

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
      action: "run task review/repair",
      baseSkills: ["gsd-executing-plans", "gsd-handoff", "gsd-verify", "gsd-diagnosing-bugs"]
    },
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
    "run task review/repair": ["gsd-executing-plans", "gsd-handoff", "gsd-verify", "gsd-diagnosing-bugs"],
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
next_action:start/continue task
plan_path:.scratch/canonical-fixture/plan.md
plan_sha256:773439b156176e571582546b8552fc8c4a03da6ec147586988e6af632d100b1d
settings[0]{key,value}:
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
plan_path:correct.md
plan_sha256:correct
settings[0]{key,value}:
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
next_action:
plan_path:correct.md
plan_sha256:correct
settings[0]{key,value}:
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
next_action:invalid_action
plan_path:correct.md
plan_sha256:correct
settings[0]{key,value}:
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
  assert.match(executingPlans, /task repair.*next_action.*set to.*run task review\/repair/);
  assert.match(executingPlans, /green-task.*next_action.*set to.*start\/continue task/);
  assert.match(executingPlans, /terminal entry.*next_action.*set to.*enter terminal verification\/repair/);
  assert.match(executingPlans, /pause.*preserves the exact interrupted executable `next_action`/);
  assert.match(executingPlans, /Discussion\/Spec-escalation/);
  assert.match(verify, /terminal repair.*next_action.*set to.*enter terminal verification\/repair/);
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
  assert.match(executingPlans, /the fixer reruns only focused checks invalidated by its repair, records replacement green evidence for each invalidated check, and re-enters fresh review/i);
  assert.doesNotMatch(executingPlans, /Rerun all invalidated evidence and review\./i);
  assert.doesNotMatch(executingPlans, /focused checks and evidence/i);
  assert.doesNotMatch(executingPlans, /that fixer pass/i);

  // Renderer serialization without String.replace implication
  assert.doesNotMatch(reference, /placeholder is replaced by/i);
  assert.doesNotMatch(reference, /`<features>` is replaced by/i);
  assert.match(reference, /`<features>` template field is serialized as/i);
  assert.match(reference, /For Normal mode \(<= 5 active features\), `<resume_instruction>` is:/i);
  assert.match(reference, /For Bounded-Ambiguity mode \(> 5 active features\), `<resume_instruction>` is:/i);
});

