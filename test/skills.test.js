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
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("gsd") && existsSync(join(SKILLS, entry.name, "SKILL.md")))
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

const structuredPacket = () => {
  const packet = canonicalPacket();
  packet["plan.md"] = packet["plan.md"].replace(
    "### T1: Parse plan\n- **Satisfies:** AC-1\n- **Files:** `test/skills.test.js`\n- **Test:** `node --test test/skills.test.js`\n- **Status:** pending",
    "### T1: Parse plan\n- **Satisfies:** AC-1\n- **Files:**\n  - `src/new.js` — create: expose the planned public entrypoint\n  - `src/current.js` — modify: enforce the approved behavior contract\n  - `src/obsolete.js` — delete: remove the superseded runtime path\n- **Artifacts:**\n  - `.scratch/canonical-fixture/prototype/dashboard.png` — reference: dashboard layout and component states; fidelity: preserve hierarchy, spacing tokens, loading state, and mobile stacking\n- **Test:** `node --test test/skills.test.js`\n- **Status:** pending",
  );
  return packet;
};

test("structured task file intents and prototype bindings parse deterministically", () => {
  const legacy = parseMarkdownPacket(canonicalPacket());
  assert.equal(legacy.taskFormat, "legacy");
  assert.equal(legacy.tasks[0].format, "legacy");

  const structured = structuredPacket();
  const parsed = parseMarkdownPacket(structured);
  assert.equal(parsed.taskFormat, "structured");
  assert.deepEqual(parsed.tasks[0].fileIntents, [
    { path: "src/new.js", operation: "create", intent: "expose the planned public entrypoint" },
    { path: "src/current.js", operation: "modify", intent: "enforce the approved behavior contract" },
    { path: "src/obsolete.js", operation: "delete", intent: "remove the superseded runtime path" },
  ]);
  assert.deepEqual(parsed.tasks[0].artifacts, [{
    path: ".scratch/canonical-fixture/prototype/dashboard.png",
    role: "dashboard layout and component states",
    fidelity: "preserve hierarchy, spacing tokens, loading state, and mobile stacking",
  }]);

  const source = structured["plan.md"];
  for (const [needle, replacement, error] of [
    ["— create: expose", "— move: expose", /operation|Files entry/i],
    ["create: expose the planned public entrypoint", "create: todo", /intent|vague/i],
    ["`src/current.js` — modify", "`../src/current.js` — modify", /traversal|repository-relative/i],
    ["`.scratch/canonical-fixture/prototype/dashboard.png`", "`.scratch/other-feature/prototype/dashboard.png`", /Artifacts|feature|prototype/i],
    ["dashboard layout and component states", "todo", /role|vague/i],
    ["preserve hierarchy, spacing tokens, loading state, and mobile stacking", "todo", /fidelity|vague/i],
  ]) {
    assert.throws(
      () => parseMarkdownPacket({ "plan.md": source.replace(needle, replacement) }),
      error,
    );
  }
});

test("planner single-writes structured tasks and execution binds prototype references", () => {
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");

  assert.match(reference, /- \*\*Files:\*\*\n\s+- `<path>` — (?:create\|modify\|delete|<create\|modify\|delete>)/);
  assert.match(reference, /- \*\*Artifacts:\*\* none/);
  assert.match(reference, /\.scratch\/<feature>\/prototype\//);
  assert.match(planner, /REFERENCE\.md[^.\n]*§ Packet grammar/);
  assert.match(planner, /newly approve only structured task blocks/i);
  assert.match(reference, /dual-read[\s\S]*single-write/i);
  assert.match(execution, /artifact references[\s\S]*open every referenced artifact before source edits/i);
  assert.match(execution, /already-approved[\s\S]*legacy task blocks/i);
  assert.match(planner, /exist and are readable/i);
  assert.match(planner, /prototype[\s\S]*never[\s\S]*scope authority/i);
});

test("session owner is sole lifecycle authority without model agents", () => {
  const paths = [
    "README.md",
    "docs/domain/gsd.md",
    ...filesUnder(SKILLS).map((path) => path.slice(ROOT.length + 1)),
  ];
  const corpus = paths.map((path) => [path, read(path)]);
  const reference = read("skills/gsd/REFERENCE.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const designTwice = read("skills/gsd-codebase-design/DESIGN-IT-TWICE.md");
  const designSkill = read("skills/gsd-codebase-design/SKILL.md");
  const ponytail = read("skills/gsd-ponytail/SKILL.md");

  for (const [path, body] of corpus) {
    assert.doesNotMatch(
      body,
      /gsdReviewer|gsd-reviewer|gsdExecutor|gsd-executor|reviewer_model|executor_model|review_round|blocking_fingerprint|reviewed_commit|progress_status|terminal_repair_round|Adaptive Chunked Cumulative Review|\breducer\b|review shard|shard review|per-shard|shard lifecycle|root integrator|root-integrator|reviewer PASS|\bparent (?:owner|authority)\b/i,
      path,
    );
  }
  assert.match(reference, /schema:v3[\s\S]*session owner/i);
  assert.match(handoff, /schema:v3[\s\S]*session owner/i);
  assert.match(reference, /sole lifecycle authority/i);
  assert.match(verify, /plan hash[\s\S]*every active AC[\s\S]*changed path[\s\S]*task diffs in plan order/i);
  assert.match(verify, /malformed binding[\s\S]*ownership\/coverage mismatch[\s\S]*contract contradiction[\s\S]*red deterministic check/i);
  assert.match(verify, /Terminal Visual Review[\s\S]*Deferred Slow E2E/i);
  assert.doesNotMatch(designTwice, /sub-?agents?|`task`/i);
  assert.match(designTwice, /three separate self-contained inline design passes/i);
  assert.match(designSkill, /three sequential inline design passes/i);
  assert.doesNotMatch(designSkill, /at least two interfaces/i);
  assert.match(ponytail, /ponytail_level:<value>/);
  assert.doesNotMatch(ponytail, /settings\[\]|ponytail_level,/);
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

  assert.match(master, /gsd-brainstorming` → `gsd-to-plan` → approval/);
  assert.match(master, /stale non-authoritative state/);
  assert.match(reference, /Canonical Markdown contract/);
  assert.match(reference, /SHA-256/);
  assert.match(reference, /Runtime records report progress and bind source bytes/);
  for (const skill of [planner, execution, verify, handoff, tdd]) {
    assert.match(skill, /plan\.md|Markdown/i);
    assert.match(skill, /hash|SHA-256|binding/i);
  }
  assert.match(execution, /never rewrite the approved Markdown plan/i);
  assert.match(handoff, /Write atomic `\.scratch\/<feature>\/state\.toon`/i);
  assert.match(tdd, /focused test seam from the approved Markdown plan/);
  assert.match(tdd, /consume the exact validated task slice and relevant pinned sections/);
  assert.doesNotMatch(tdd, /proposal\.toon|spec\.toon|plan\.toon/);
  assert.match(reference, /Quick-fix plan exception/);
  assert.match(master, /Quick-fix plan exception/);
  assert.match(verify, /malformed binding[\s\S]*red deterministic check blocks/i);
  assert.match(planner, /atomically write canonical `schema:v3` `state\.toon`/);
  assert.doesNotMatch(execution, /^produces: \[[^\n]*plan\.md/m);
  assert.match(execution, /ledger byte-for-byte read-only throughout the per-task loop/);
  assert.match(verify, /final milestone deletes the ledger/);
  assert.match(handoff, /Malformed, duplicate, or invalid known values fail closed/i);
  assert.match(handoff, /discover active candidates/i);
  assert.match(planner, /fresh approval after Spec escalation supersedes older binding state/);
  assert.match(execution, /Reject legacy proposal\/spec\/design files, numbered handoffs/);
  assert.match(handoff, /Execution resume \| `state\.toon`; `plan\.md`/);
  assert.match(reference, /session owner rebuilds complete task or terminal slices from canonical plan\/state\/Git/i);
  assert.match(reference, /# Milestones[\s\S]*\| ID \| Slug \| Goal \| Status \|/);
  assert.match(reference, /status is exactly `pending` or `done`/);
  assert.match(master, /all-`done`, fail closed/);
  assert.doesNotMatch(reference, /Manual UI Review Gate/);
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

test("T1 session-owner execution contract and lifecycle roles", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const readme = read("README.md");
  const domain = read("docs/domain/gsd.md");

  for (const body of [planner, execution, verify, handoff, reference, readme, domain]) {
    assert.doesNotMatch(
      body,
      /gsdReviewer|gsd-reviewer|gsdExecutor|gsd-executor|reviewer_model|executor_model|review_round|blocking_fingerprint|reviewed_commit|progress_status/i,
    );
  }
  assert.match(planner, /session owner materializes the feature-appropriate prototype/i);
  assert.match(execution, /current top-level session owner consumes the validated slice/);
  assert.match(execution, /implements or repairs the task inline/);
  assert.match(execution, /next task in strict heading order/);
  assert.match(execution, /dispatches no[\s\S]{0,120}generic child task/);
  assert.match(reference, /current top-level session owner implements and repairs each ordered task inline and sequentially/i);
  assert.match(execution, /Task `Tn\+1` begins only from the committed green checkpoint of `Tn`/);
  assert.match(execution, /Passive feedback transport[\s\S]{0,160}source mutations never overlap/i);
  assert.match(verify, /session owner performs deterministic cumulative conformance/);
  assert.match(verify, /No free-form critique or model-generated verdict is terminal authority/);
  assert.match(domain, /### D-gsd-3: Make the session owner the sole lifecycle authority/);
  assert.match(domain, /### D-gsd-4: Converge only through deterministic blockers/);
  assert.match(domain, /### D-gsd-5: Rehydrate authority from canonical sources/);
  assert.match(readme, /## Session-owner authority/);
  assert.equal(existsSync(join(ROOT, "agents", "gsd-executor.md")), false);
  assert.equal(existsSync(join(ROOT, "agents", "gsd-reviewer.md")), false);
  assert.match(execution, /full parse and binding check at execution entry or resume/);
  assert.match(execution, /At ordinary task selection consume the retained validated task slice/);
  assert.match(execution, /RED before implementation, GREEN after implementation, then refactor after green/);
  assert.match(execution, /rerun only checks invalidated by the repair/);
  assert.match(execution, /Reject legacy proposal\/spec\/design files/);
  assert.match(execution, /never rewrite approved Markdown/);
});

test("T2 schema:v3 state.toon contract and skill derivation", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const master = read("skills/gsd/SKILL.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");

  assert.match(reference, /## Runtime state contract/);
  const currentStateBlock = reference.match(/```toon\nschema:v3\n[\s\S]*?\n```/);
  assert.ok(currentStateBlock, "REFERENCE must contain canonical schema:v3");
  assert.doesNotMatch(currentStateBlock[0], /model|agent|review/);
  assert.match(currentStateBlock[0], /phase:draft\|approved\|executing\|paused\|verifying\|repair\|merged-cleanup-pending\|completed-retained/);
  assert.match(currentStateBlock[0], /checkpoint_revision/);
  assert.match(currentStateBlock[0], /cleanup_preference:none\|delete\|retain\|archive-and-delete/);
  assert.match(reference, /exact valid active production `schema:v1` or `schema:v2`[\s\S]*atomically rewritten to canonical `schema:v3`/);
  assert.match(reference, /Validate `phase` against the fixed schema enum/);
  assert.match(handoff, /Reject an unknown `phase`; preserve an opaque `next_action`/);
  assert.doesNotMatch(reference, /opaque state `phase`|opaque `phase`/);
  assert.doesNotMatch(handoff, /unknown opaque `phase`|opaque `phase`/);
  assert.match(reference, /Atomic write/);
  assert.match(reference, /atomically renames it over `state\.toon`/);
  assert.match(reference, /No dispatch occurs from unvalidated or partially written/);
  assert.match(reference, /Skill derivation from phase and next_action/);
  assert.match(reference, /`start\/continue task`[\s\S]{0,200}gsd-executing-plans[\s\S]{0,80}gsd-handoff[\s\S]{0,80}gsd-tdd/);
  assert.match(reference, /`enter terminal verification\/repair`[\s\S]{0,160}gsd-verify[\s\S]{0,80}gsd-handoff/);
  assert.doesNotMatch(reference, /reload\[N\]\{skill,path\}/);
  assert.doesNotMatch(handoff, /reload\[N\]\{skill,path\}/);
  assert.doesNotMatch(reference, /Manual UI Review Gate/);
  assert.match(handoff, /Write atomic `\.scratch\/<feature>\/state\.toon`/);
  assert.match(handoff, /Active skills are derived from `phase` and `next_action`/);
  assert.match(handoff, /Never serialize a `reload` manifest/);
  assert.match(handoff, /schema:v1` and `schema:v2`[\s\S]*rewritten to `schema:v3`/);
  assert.match(planner, /Build prototype with Lavish/);
  assert.match(planner, /atomically write canonical `schema:v3` `state\.toon`/);
  assert.match(execution, /validated task slice/);
  assert.match(execution, /Do not write task-attempt TOON files/);
  assert.match(verify, /phase=merged-cleanup-pending|merged-cleanup-pending/);
  assert.match(verify, /Terminal Visual Review|Visualize completed work with Lavish/);
  assert.match(master, /state\.toon/);
  assert.match(master, /Build prototype with Lavish/);
  assert.doesNotMatch(master, /result\.toon/);
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
      "schema:v2",
      "feature:ac-10",
      "phase:executing",
      "next_action:start/continue task",
      "plan_path:.scratch/ac-10/plan.md",
      "plan_sha256:" + "a".repeat(64),
      "base_ref:main",
      "wip_branch:wip/ac-10",
      "last_green_task:none",
      "last_green_commit:none",
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
  assert.match(readme, /Relocation of the checkout requires reinstall/);
  assert.match(readme, /Editing the extension in place requires a new OMP session/);
  assert.match(readme, /editing a skill takes effect the next time that skill is selected/i);
  assert.doesNotMatch(readme, /Relocation of the checkout does not require reinstall/);
});

test("AC-3: Milestone Ledger definition points to canonical plan and excludes legacy local spec", () => {
  const domain = read("docs/domain/gsd.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.match(domain, /Milestone Ledger[\s\S]{0,220}docs\/gsd\/<feature>\/milestones\.md/);
  assert.match(domain, /precise user-approved milestone goals and durable pending\/done state/);
  assert.match(reference, /goals are approved authority; its status column is controlled by terminal verification/);
  assert.doesNotMatch(domain, /local spec/i);
});

test("AC-4: Cross-references, None. explicit, repair evidence not duplicated, and renderer serialization", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.match(execution, /A "None\." decisions block[\s\S]{0,100}explicit empty decisions marker/i);
  assert.match(reference, /Decisions is exact `None\.` or sequential D blocks/);
  assert.match(execution, /rerun only checks invalidated by the repair/i);
  assert.match(reference, /`<features>` template field is serialized as/i);
  assert.match(reference, /For Normal mode \(<= 5 active features\), `<resume_instruction>` is:/i);
  assert.match(reference, /For Bounded-Ambiguity mode \(> 5 active features\), `<resume_instruction>` is:/i);
});


test("archive terminal disposition contract", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  assert.match(reference, /Terminal scratch disposition/);
  assert.match(reference, /docs\/gsd\/<feature>\/archive\/plan\.md/);
  assert.match(reference, /docs\/gsd\/<feature>\/archive\/implementation\.md/);
  assert.match(reference, /same green one-feature\/one-squash commit/);
  assert.match(reference, /If either archive destination already exists, fail closed/);
  assert.match(reference, /terminal-cleanup-owned lifecycle paths included in changed-path ownership proof/);
  assert.match(verify, /canonical archive destinations are terminal-cleanup-owned lifecycle paths/);
  assert.match(verify, /every other changed path must be task-owned/);
  assert.match(verify, /phase=merged-cleanup-pending/);
  assert.match(reference, /symlinks, non-directories, another session, or the persistent project profile are never followed or deleted/i);
  assert.doesNotMatch(reference, /automatically archive every completed feature/i);
});

test("AC-1: Fast TDD is mandatory for observable tasks", () => {
  const tdd = read("skills/gsd-tdd/SKILL.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.match(execution, /Every observable task loads `gsd-tdd`/);
  assert.match(execution, /RED before implementation, GREEN after implementation, then refactor after green/);
  assert.match(tdd, /Fast TDD Check/);
  assert.match(tdd, /RED before implementation[\s\S]{0,260}GREEN after implementation/);
  assert.match(tdd, /required sequence is RED→GREEN→refactor/);
  assert.match(planner, /never use `none` for observable behavior/i);
  assert.match(reference, /Every observable task loads `gsd-tdd`/);
  for (const body of [tdd, execution]) {
    assert.match(body, /no browser|browser,[^\n]{0,100}stay outside the task loop|never runs? browser/i);
    assert.match(body, /external network|resource-heavy/i);
  }
  assert.doesNotMatch(reference, /tdd_evidence|red_evidence|green_evidence|refactor_evidence/);
});

test("AC-2: Terminal conformance precedes slow E2E with same-commit gates", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.match(execution, /Only after every non-superseded task and Fast TDD Check is green/);
  assert.match(execution, /deterministic cumulative conformance before any Terminal Visual Review or Deferred Slow E2E/);
  assert.match(verify, /deterministic cumulative conformance before Terminal Visual Review or Deferred Slow E2E/);
  assert.match(verify, /Run the complete feature-affected Deferred Slow E2E suite only after current-commit conformance/);
  assert.match(verify, /full slow\/E2E GREEN on the same unchanged commit/);
  assert.match(reference, /Deferred Slow E2E runs only after current conformance/);
  assert.match(reference, /Green unchanged bytes then enter one-squash merge and cleanup/);
});
test("AC-optional: planning prototype replaces Manual UI Review", () => {
  const brainstorm = read("skills/gsd-brainstorming/SKILL.md");
  const toPlan = read("skills/gsd-to-plan/SKILL.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const domain = read("docs/domain/gsd.md");
  const readme = read("README.md");

  assert.match(brainstorm, /Build prototype with Lavish/i);
  assert.doesNotMatch(brainstorm, /Manual UI Review Gate/i);
  assert.match(toPlan, /Build prototype with Lavish/);
  assert.match(toPlan, /Approve and execute/);
  assert.match(toPlan, /single post-plan action surface|post-plan action surface/);
  assert.match(toPlan, /launch consent/);
  assert.match(toPlan, /tools\/lavish\/src\/cli\.ts" open --file/);
  assert.doesNotMatch(toPlan, /Manual UI Review Gate/i);

  assert.doesNotMatch(verify, /There is no terminal pre-E2E visual pause/);
  assert.doesNotMatch(execution, /There is no terminal pre-E2E visual pause/);
  assert.doesNotMatch(readme, /There is no terminal pre-E2E visual pause/);
  assert.doesNotMatch(execution, /manual_ui_review,on/);
  assert.doesNotMatch(handoff, /manual_ui_review,on/);
  assert.doesNotMatch(reference, /manual_ui_review,on/);

  assert.match(reference, /Planning Prototype Session/);
  assert.match(reference, /Build prototype with Lavish/);
  assert.match(domain, /### D-gsd-9: Separate planning prototypes from terminal implementation review/);
  assert.match(readme, /Build prototype with Lavish/);
  assert.match(execution, /post-approval prototype request is Spec escalation/i);
  assert.match(toPlan, /1\. Approve and execute[\s\S]*2\. Build prototype with Lavish[\s\S]*3\. Revise the plan[\s\S]*4\. Pause/);
});

test("AC-4: hidden bootstrap uses state.toon and prototype surface", () => {
  const master = read("skills/gsd/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.match(master, /Build prototype with Lavish/i);
  assert.match(master, /Deferred Slow E2E/i);
  assert.match(master, /state\.toon/);
  assert.match(master, /deterministic terminal conformance/i);
  assert.match(reference, /Planning Prototype Session/);
  assert.match(reference, /merged-cleanup-pending|completed-retained/);
  assert.doesNotMatch(master, /result\.toon|gsdReviewer|gsd-reviewer/);
});

test("AC-2 repair: task repair stays session-owner-inline without terminal verification", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(execution, /First checkpoint `next_action=start\/continue task`/);
  assert.match(execution, /repair source-first[\s\S]{0,160}rerun only checks invalidated by the repair/);
  assert.match(execution, /Load no terminal verifier until every task is green/);
  assert.match(reference, /`start\/continue task`[\s\S]{0,120}gsd-executing-plans[\s\S]{0,80}gsd-handoff[\s\S]{0,80}gsd-tdd/);
  assert.doesNotMatch(execution, /run task review\/repair|gsdReviewer|gsd-reviewer/);
});

test("AC-3: Visible skill dispatch is deterministic", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const visible = skillNames().filter((name) => name !== "gsd").sort();
  assert.equal(visible.length, 11, "exactly 11 visible GSD skills");

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

  assert.equal(rows.length, 11, "matrix must have exactly 11 rows");
  assert.deepEqual(
    rows.map((r) => r.skill).sort(),
    visible,
    "matrix skills must be exactly the 11 visible skills, one each",
  );
  // uniqueness
  assert.equal(new Set(rows.map((r) => r.skill)).size, 11, "no multiply mapped skill");

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
  for (const helper of ["gsd-tdd", "gsd-domain-modeling", "gsd-codebase-design"]) {
    assert.ok(helpers.includes(helper), `${helper} mapped as helper`);
  }

  // Reject unmapped skill by construction (already exact set equality)
  // Reject vague matrix-wide language
  assert.doesNotMatch(body, vague);
});

test("AC-4: Concision preserves semantic parity", () => {
  const MAX_VISIBLE_WORDS = 10900;
  const MAX_BOOTSTRAP_WORDS = 900;
  const MAX_REFERENCE_WORDS = 4800;
  const wordCount = (body) => body.trim().split(/\s+/).filter(Boolean).length;
  const visible = skillNames().filter((name) => name !== "gsd").sort();
  assert.equal(visible.length, 11);
  const total = visible.reduce(
    (count, name) => count + wordCount(read(`skills/${name}/SKILL.md`)),
    0,
  );
  assert.ok(total <= MAX_VISIBLE_WORDS, `${total} must not exceed ${MAX_VISIBLE_WORDS}`);
  assert.ok(wordCount(read("skills/gsd/SKILL.md")) <= MAX_BOOTSTRAP_WORDS);
  assert.ok(wordCount(read("skills/gsd/REFERENCE.md")) <= MAX_REFERENCE_WORDS);

  const reference = read("skills/gsd/REFERENCE.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const tdd = read("skills/gsd-tdd/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  assert.match(planner, /REFERENCE\.md[^.\n]*§ Packet grammar/);
  assert.match(handoff, /REFERENCE\.md[^.\n]*§ Runtime state contract/);
  assert.match(verify, /REFERENCE\.md[^.\n]*§ Post-approval pipeline contract/);
  assert.doesNotMatch(planner, /```md\n# Plan/);
  assert.doesNotMatch(handoff, /schema:v3\nfeature:/);
  assert.match(reference, /### Fast TDD and task-loop constraints/);
  assert.match(reference, /deterministic cumulative conformance/);
  assert.match(execution, /Every observable task loads `gsd-tdd`/);
  assert.match(tdd, /RED before implementation/);
  assert.match(tdd, /GREEN after implementation/);
  assert.match(verify, /Deferred Slow E2E suite only after current-commit conformance/);
  for (const name of visible) {
    assert.match(read(`skills/${name}/SKILL.md`), /## Dispatch contract/);
  }
});

test("AC-4 repair: session-owner inline task repair forbids terminal re-entry", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(execution, /implements or repairs the task inline/);
  assert.match(execution, /red focused check[\s\S]{0,180}bounded inline repair/i);
  assert.match(execution, /rerun only checks invalidated by the repair/);
  assert.match(execution, /Load no terminal verifier until every task is green/);
  assert.doesNotMatch(execution, /submit for re-review|per-task verdict|gsdReviewer/);
});

test("internal Lavish migration is direct and bridge-free", () => {
  const callerBodies = [
    read("README.md"),
    read("skills/gsd-to-plan/SKILL.md"),
    read("skills/gsd-verify/SKILL.md"),
    read("skills/gsd-handoff/SKILL.md"),
    read("skills/gsd-improve-codebase-architecture/SKILL.md"),
    read("skills/gsd/REFERENCE.md"),
  ];
  const combined = callerBodies.join("\n");
  assert.match(combined, /tools\/lavish\/src\/cli\.ts/);
  assert.match(combined, /open --url/);
  assert.match(combined, /open --file/);
  assert.match(combined, /feedback "\$SESSION_ID"/);
  assert.match(combined, /end (?:it with the matching `end` command|the session explicitly)/);
  assert.doesNotMatch(combined, /gsd-lavish|lavish-axi|\.gsd-lavish|cli\.mjs|\bpnpm\b/i);
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
  assert.ok(modes);
  assert.match(modes[1], /Quick-fix auto-fire/);
  assert.match(modes[1], /Explicit session toggle/);
  assert.match(ponytail, /explicit_level` is exactly `none\|lite\|full\|ultra`/);
  assert.match(ponytail, /auto_scope` is exactly `none\|quick-fix`/);
  assert.match(ponytail, /ponytail_level:<level>/);
  assert.match(ponytail, /ponytail_level:none/);
  assert.match(ponytail, /scalar `ponytail_level:<value>`/);
  assert.doesNotMatch(ponytail, /ponytail_level,<level>|row=ponytail_level/);
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

test("AC-4 repair: session-owner task repair does not enter terminal verification", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(execution, /First checkpoint `next_action=start\/continue task`/);
  assert.match(execution, /rerun only checks invalidated by the repair/);
  assert.match(execution, /Load no terminal verifier until every task is green/);
  assert.match(execution, /enter terminal verification\/repair/);
  assert.doesNotMatch(execution, /re-enters review|re-enter review|gsdReviewer/);
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

test("AC-4 repair: session-owner task-repair evidence grammar", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(execution, /green focused evidence, recorded only in reporting and transcripts/);
  assert.match(execution, /rerun only checks invalidated by the repair/);
  assert.match(execution, /Do not write task-attempt TOON files/);
});

test("terminal-review-flow AC-1: enter terminal verification only after all tasks", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(execution, /Atomically update `state\.toon` with `last_green_task`, `last_green_commit`, and `next_action=start\/continue task`/);
  assert.match(execution, /Only after every non-superseded task and Fast TDD Check is green/);
  assert.match(execution, /next_action=enter terminal verification\/repair/);
  assert.match(execution, /load `gsd-verify`/);
  assert.doesNotMatch(execution, /After every non-superseded task[\s\S]{0,100}load `gsd-verify`/);
});

test("terminal-review-flow AC-2: deterministic cumulative coverage and quality", () => {
  const verify = read("skills/gsd-verify/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.match(verify, /every active AC maps exactly once to one completed task and one public interface pin/);
  assert.match(verify, /every changed path is task-owned/);
  assert.match(verify, /task diffs in plan order/);
  assert.match(verify, /explicit Decisions, invariants, non-goals/);
  assert.match(verify, /focused-check evidence on the unchanged current commit/);
  assert.match(reference, /Only malformed binding, ownership\/coverage mismatch, explicit contract contradiction, unresolved change, or a red deterministic check blocks/);
});

test("terminal-review-flow AC-3: opt-in terminal visual surface after conformance", () => {
  const verify = read("skills/gsd-verify/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const tool = read("tools/lavish/README.md");
  const readme = read("README.md");
  assert.match(verify, /After current-commit conformance, offer Terminal Visual Review when eligible/);
  assert.match(verify, /UI\/UX plans always receive `Continue to Deferred Slow E2E` and `Visualize completed work with Lavish`/);
  assert.match(verify, /Ineligible work proceeds without a prompt/);
  assert.match(verify, /Continue does not launch a helper/);
  assert.match(verify, /tools\/lavish\/src\/cli\.ts" open --url/);
  assert.match(reference, /after current-commit deterministic conformance/);
  assert.match(tool, /runs on Bun/);
  assert.match(readme, /Current-commit session-owner verification precedes Terminal Visual Review/);
});

test("terminal-review-flow AC-4: actual implementation visual feedback loop", () => {
  const verify = read("skills/gsd-verify/SKILL.md");
  const overlay = read("tools/lavish/src/injected/overlay.ts");
  assert.match(verify, /completed live app or HTML target/);
  assert.match(overlay, />Interact<\/button><button data-mode="annotate">Annotate</);
  assert.match(overlay, /data-capture="viewport"/);
  assert.match(overlay, /data-capture="region"/);
  assert.match(verify, /session owner repairs only that frozen confirmed in-scope feedback set/);
  assert.match(verify, /Reject feedback that changes scope, acceptance, interface, invariant, or design as Spec escalation/);
  assert.match(verify, /Unavailable Lavish degrades to equivalent terminal inspection/);
});

test("terminal-review-flow AC-5: same-commit invalidation and merge gates", () => {
  const verify = read("skills/gsd-verify/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const readme = read("README.md");
  assert.match(verify, /Any source change invalidates prior conformance and selected visual acceptance/);
  assert.match(verify, /source changes clear both conformance and visual acceptance/);
  assert.match(verify, /full slow\/E2E GREEN on the same unchanged commit/);
  assert.match(reference, /Source changes invalidate conformance and acceptance/);
  assert.match(reference, /Green unchanged bytes then enter one-squash merge and cleanup/);
  assert.match(readme, /Source changes invalidate verification and visual acceptance/);
  assert.doesNotMatch(reference, /visual_review_|terminal_visual_/);
});


// --- session-owner terminal conformance ---
test("terminal conformance has no model-capacity or fan-out path", () => {
  const bodies = [
    read("skills/gsd-verify/SKILL.md"),
    read("skills/gsd/REFERENCE.md"),
    read("skills/gsd-executing-plans/SKILL.md"),
    read("skills/gsd-handoff/SKILL.md"),
    read("skills/gsd/SKILL.md"),
    read("README.md"),
    read("docs/domain/gsd.md"),
  ];
  for (const body of bodies) {
    assert.doesNotMatch(
      body,
      /contextWindow|single_budget|shard_budget|Adaptive Chunked Cumulative Review|\breducer\b|review shard|shard review|root integrator|model-generated PASS/i,
    );
  }
  const verify = bodies[0];
  assert.match(verify, /deterministic cumulative conformance/);
  assert.match(verify, /every active AC maps exactly once/);
  assert.match(verify, /every changed path is task-owned/);
  assert.match(verify, /task diffs in plan order/);
  assert.match(verify, /focused-check evidence on the unchanged current commit/);
});

// --- direct internal Lavish integration ---
test("Lavish CLI exposes a finite non-interactive session lifecycle", () => {
  const cli = read("tools/lavish/src/cli.ts");
  assert.match(cli, /lavish open --url <url>/);
  assert.match(cli, /lavish open --file <path>/);
  assert.match(cli, /lavish sessions/);
  assert.match(cli, /lavish feedback <id>/);
  assert.match(cli, /lavish end <id>/);
  assert.match(cli, /Every command is non-interactive/);
  assert.match(cli, /open requires exactly one of --url or --file/);
  assert.match(cli, /cursor: result\.cursor/);
});

test("Lavish live review separates app interaction from annotation", () => {
  const overlay = read("tools/lavish/src/injected/overlay.ts");
  const tool = read("tools/lavish/README.md");
  assert.match(tool, /\*\*Interact\*\* and \*\*Annotate\*\* modes/);
  assert.match(tool, /Interact mode passes ordinary app pointer,[\s\S]{0,120}events through/);
  assert.match(tool, /Annotate mode records a bounded DOM[\s\S]{0,120}without activating the selected app control/);
  assert.match(overlay, /return mode === "annotate" \? "annotate" : "pass"/);
  assert.match(overlay, /data-mode="interact"/);
  assert.match(overlay, /data-mode="annotate"/);
});

test("Lavish capture contract is current viewport and dragged region only", () => {
  const overlay = read("tools/lavish/src/injected/overlay.ts");
  const tool = read("tools/lavish/README.md");
  const page = read("tools/lavish/src/cdp/page.ts");
  assert.match(overlay, /Capture viewport/);
  assert.match(overlay, /Capture region/);
  assert.match(tool, /current viewport/);
  assert.match(tool, /dragged rectangle captures a viewport region/);
  assert.match(tool, /Full-document[\s\S]{0,80}not part of this milestone/);
  assert.match(page, /Page\.captureScreenshot/);
  assert.doesNotMatch(overlay, /data-capture="full/);
});

test("Lavish feedback remains machine-local evidence with exact cleanup", () => {
  const verify = read("skills/gsd-verify/SKILL.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const tool = read("tools/lavish/README.md");
  const combined = [verify, handoff, reference, tool].join("\n");
  assert.match(verify, /feedback "\$SESSION_ID"/);
  assert.match(verify, /finite ordered results/);
  assert.match(verify, /remove only its exact `\.lavish\/sessions\/<session-id>\/` directory/);
  assert.match(handoff, /direct Lavish session ID, feedback cursor/);
  assert.match(reference, /\.lavish\/sessions\/` and `\.lavish\/profiles\//);
  assert.match(tool, /creation-ordered records/);
  assert.match(tool, /Binary[\s\S]{0,100}never embedded/);
  assert.doesNotMatch(combined, /gsd-lavish|lavish-axi|\.gsd-lavish|cli\.mjs|\bpnpm\b/i);
});
