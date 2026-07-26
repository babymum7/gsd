import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import nodeFs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bindApprovedSources, parseMarkdownPacket, parseQuickFixPlan, rejectLegacyPreapprovalFiles,
  sha256, verifyApprovedSources, validateSectionEdges,
} from "../lib/gsd-contract.mjs";
import {
  parseActivationResponse, responseMatchesFixture, selectEvalBackend, validateActivationTarget,
  validateFixtureSet,
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
const visibleSkillNames = () => skillNames().filter((name) =>
  parseAgentFrontmatter(read(`skills/${name}/SKILL.md`), name).hide !== true);
const filesUnder = (directory) => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() ? [path] : [];
  });
const markdownFiles = (directory) => filesUnder(directory)
  .filter((path) => path.endsWith(".md"));
const canonicalPacket = () => ({
  "plan.md": [
    "# Plan",
    "## Feature",
    "`canonical-fixture`",
    "## Base",
    "`main`",
    "## Summary",
    "Validate Markdown plan.",
    "## Context",
    "A tracked inline fixture.",
    "## Domain Impact",
    "- **Classification:** none",
    "- **Contexts:** none",
    "- **Documentation:** none",
    "- **Broad bootstrap:** not-offered",
    "- **Evidence:** Parser-only fixture changes no production domain behavior.",
    "## UI Impact",
    "- **Classification:** none",
    "- **Surfaces:** none",
    "- **Prototype:** none",
    "- **Evidence:** Parser-only fixture renders no user-facing surface and converts no locked prototype.",
    "## Scope",
    "- Validate plan",
    "## Acceptance Criteria",
    "### AC-1: Plan parses",
    "- **State:** active",
    "- **Outcome:** A valid plan becomes an execution contract.",
    "- **Action:** Parse the approved Markdown plan.",
    "- **Expected:** Return the matching feature and acceptance criterion.",
    "## Decisions",
    "None.",
    "## Invariants",
    "- **I-1:** Approved source bytes remain immutable.",
    "## Non-goals",
    "- **NG-1:** Runtime TOON is not edited by the parser.",
    "## Interfaces",
    "| Criterion | Seam | Path | Lower-seam reason |",
    "| --- | --- | --- | --- |",
    "| AC-1 | parser | `test/skills.test.js` | none |",
    "## Publication",
    "null",
    "## Tasks",
    "### T1: Parse plan",
    "- **Satisfies:** AC-1",
    "- **Files:**",
    "  - `test/skills.test.js` — modify: exercise the canonical parser fixture",
    "- **Test:** `node --test test/skills.test.js`",
    "- **Status:** pending",
    "",
  ].join("\n"),
});

// Single source of truth for the canonical fixture's Files block. Tests replace
// against these constants so a drifted literal fails loudly instead of no-oping.
const FILES_BLOCK = "- **Files:**\n  - `test/skills.test.js` — modify: exercise the canonical parser fixture";
const filesBlockWith = (...entries) => [FILES_BLOCK, ...entries].join("\n");
const T1_BLOCK = `### T1: Parse plan\n- **Satisfies:** AC-1\n${FILES_BLOCK}\n- **Test:** \`node --test test/skills.test.js\`\n- **Status:** pending`;
const INTERFACE_ROW = "| AC-1 | parser | `test/skills.test.js` | none |";
const replaceOnce = (source, needle, replacement) => {
  const count = source.split(needle).length - 1;
  assert.equal(count, 1, `fixture needle must occur exactly once: ${needle.slice(0, 60)}`);
  return source.replace(needle, replacement);
};

const structuredPacket = () => {
  const packet = canonicalPacket();
  packet["plan.md"] = replaceOnce(
    packet["plan.md"],
    FILES_BLOCK,
    "- **Files:**\n  - `src/new.js` — create: expose the planned public entrypoint\n  - `src/current.js` — modify: enforce the approved behavior contract\n  - `src/obsolete.js` — delete: remove the superseded runtime path",
  );
  return packet;
};

test("structured task file intents parse deterministically", () => {
  const structured = structuredPacket();
  const parsed = parseMarkdownPacket(structured);
  assert.deepEqual(parsed.tasks[0].fileIntents, [
    { path: "src/new.js", operation: "create", intent: "expose the planned public entrypoint" },
    { path: "src/current.js", operation: "modify", intent: "enforce the approved behavior contract" },
    { path: "src/obsolete.js", operation: "delete", intent: "remove the superseded runtime path" },
  ]);

  const source = structured["plan.md"];
  for (const [needle, replacement, error] of [
    ["— create: expose", "— move: expose", /operation|Files entry/i],
    ["create: expose the planned public entrypoint", "create: todo", /intent|vague/i],
    ["`src/current.js` — modify", "`../src/current.js` — modify", /traversal|repository-relative/i],
  ]) {
    assert.throws(
      () => parseMarkdownPacket({ "plan.md": source.replace(needle, replacement) }),
      error,
    );
  }
});

test("domain-impact packet grammar is mandatory in every validation path", () => {
  const canonical = canonicalPacket();
  const parsed = parseMarkdownPacket(canonical);
  assert.deepEqual(parsed.domainImpact, {
    classification: "none",
    contexts: [],
    documentation: "none",
    broadBootstrap: "not-offered",
    evidence: "Parser-only fixture changes no production domain behavior.",
  });

  // A non-`none` classification must land every affected shard in a live task that also
  // changes semantic code, so the fixture owns both shards beside a production path.
  const changedPlan = replaceOnce(
    canonical["plan.md"],
    FILES_BLOCK,
    [
      "- **Files:**",
      "  - `src/billing.js` — modify: apply the approved billing behavior",
      "  - `docs/domain/billing.md` — modify: record current billing production behavior",
      "  - `docs/domain/orders.md` — modify: record current orders production behavior",
    ].join("\n"),
  )
    .replace("Classification:** none", "Classification:** change-existing-context")
    .replace("Contexts:** none", "Contexts:** billing, orders")
    .replace("Documentation:** none", "Documentation:** update-existing")
    .replace("Broad bootstrap:** not-offered", "Broad bootstrap:** selected");
  assert.deepEqual(parseMarkdownPacket({ "plan.md": changedPlan }).domainImpact, {
    classification: "change-existing-context",
    contexts: ["billing", "orders"],
    documentation: "update-existing",
    broadBootstrap: "selected",
    evidence: "Parser-only fixture changes no production domain behavior.",
  });
  // Dropping either shard leaves that context's semantics undocumented at the checkpoint.
  assert.throws(
    () => parseMarkdownPacket({
      "plan.md": replaceOnce(changedPlan, "  - `docs/domain/orders.md` — modify: record current orders production behavior\n", ""),
    }),
    /must own affected domain shard: docs\/domain\/orders\.md/,
  );
  assert.throws(
    () => parseMarkdownPacket({
      "plan.md": canonical["plan.md"].replace("Contexts:** none", "Contexts:** gsd"),
    }),
    /classification none requires Contexts and Documentation to be none/i,
  );
  assert.throws(
    () => parseMarkdownPacket({
      "plan.md": canonical["plan.md"]
        .replace("Classification:** none", "Classification:** change-existing-context")
        .replace("Contexts:** none", "Contexts:** gsd"),
    }),
    /requires domain documentation/i,
  );
  assert.throws(
    () => parseMarkdownPacket({
      "plan.md": changedPlan
        .replace("change-existing-context", "introduce-context")
        .replace("update-existing", "update-existing"),
    }),
    /introduce-context requires bootstrap-feature-context/i,
  );

  const legacyPlan = canonical["plan.md"].replace(
    "## Domain Impact\n- **Classification:** none\n- **Contexts:** none\n- **Documentation:** none\n- **Broad bootstrap:** not-offered\n- **Evidence:** Parser-only fixture changes no production domain behavior.\n",
    "",
  );
  const legacyFiles = { "plan.md": legacyPlan };
  const legacyBinding = { "plan.md": sha256(legacyPlan) };
  assert.throws(() => bindApprovedSources(legacyFiles), /Domain Impact|section/i);
  assert.throws(() => verifyApprovedSources(legacyFiles, legacyBinding), /Domain Impact|section/i);
  assert.throws(
    () => verifyApprovedSources({ "plan.md": `${legacyPlan}\n` }, legacyBinding),
    /hash mismatch/i,
  );

  const malformedNew = canonical["plan.md"].replace(
    "- **Evidence:** Parser-only fixture changes no production domain behavior.\n",
    "",
  );
  assert.throws(
    () => verifyApprovedSources(
      { "plan.md": malformedNew },
      { "plan.md": sha256(malformedNew) },
    ),
    /fields must be exactly ordered/i,
  );
});

test("UI Impact is returned by the parser and banned from Quick-fix paths", () => {
  const canonical = canonicalPacket();
  // The parsed section is the value lifecycle owners retain in the task slice, so the
  // return shape is part of the contract, not an internal validation side effect.
  assert.deepEqual(parseMarkdownPacket(canonical).uiImpact, {
    classification: "none",
    surfaces: [],
    prototype: [],
    evidence: "Parser-only fixture renders no user-facing surface and converts no locked prototype.",
  });

  const converting = replaceOnce(
    canonical["plan.md"],
    FILES_BLOCK,
    [
      "- **Files:**",
      "  - `src/ui/orders.tsx` — modify: render the locked order surface states",
    ].join("\n"),
  ).replace(
    "## UI Impact\n- **Classification:** none\n- **Surfaces:** none\n- **Prototype:** none",
    "## UI Impact\n- **Classification:** reuse-prototype\n- **Surfaces:** `src/ui/orders.tsx`\n- **Prototype:** `design/docs/orders.md`",
  );
  assert.deepEqual(parseMarkdownPacket({ "plan.md": converting }).uiImpact, {
    classification: "reuse-prototype",
    surfaces: ["src/ui/orders.tsx"],
    prototype: ["design/docs/orders.md"],
    evidence: "Parser-only fixture renders no user-facing surface and converts no locked prototype.",
  });

  const reference = read("skills/gsd/REFERENCE.md");
  const quickFix = reference.match(/### Quick-fix plan exception\n[\s\S]*?(?=\n### Executable contract validator)/)[0];
  assert.match(quickFix, /under `design\/`/, "Quick-fix exception states the prototype-path prohibition");
});

test("Quick-fix Domain Impact grammar is exact and domain-owned", () => {
  const quickFixPlan = [
    "# Quick-fix Plan",
    "## Feature",
    "`fix-header`",
    "## Base",
    "`main`",
    "## Domain Impact",
    "- **Classification:** none",
    "- **Contexts:** none",
    "- **Documentation:** none",
    "- **Broad bootstrap:** not-offered",
    "- **Evidence:** Header normalization already belongs to the documented request contract.",
    "## Tasks",
    "### T1: Correct header behavior",
    "- **Files:**",
    "  - `src/header.js` — modify: correct header normalization at the public API",
    "- **Test:** `node --test test/header.test.js`",
  ].join("\n");

  const parsed = parseQuickFixPlan({ "plan.md": quickFixPlan });
  assert.equal(parsed.feature, "fix-header");
  assert.equal(parsed.tasks.length, 1);
  assert.deepEqual(parsed.domainImpact, {
    classification: "none",
    contexts: [],
    documentation: "none",
    broadBootstrap: "not-offered",
    evidence: "Header normalization already belongs to the documented request contract.",
  });

  assert.throws(
    () => parseQuickFixPlan({ "plan.md": quickFixPlan.replace(/## Domain Impact[\s\S]*?(?=## Tasks)/, "") }),
    /Domain Impact|sections must be exactly ordered/i,
  );
  assert.throws(
    () => parseQuickFixPlan({ "plan.md": quickFixPlan.replace("Contexts:** none", "Contexts:** gsd") }),
    /classification none requires Contexts and Documentation to be none/i,
  );
  assert.throws(
    () => parseQuickFixPlan({ "plan.md": quickFixPlan.replace("Broad bootstrap:** not-offered", "Broad bootstrap:** selected") }),
    /Quick-fix.*Broad bootstrap.*not-offered/i,
  );

  const impactedWithoutShard = quickFixPlan
    .replace("Classification:** none", "Classification:** change-existing-context")
    .replace("Contexts:** none", "Contexts:** gsd")
    .replace("Documentation:** none", "Documentation:** update-existing");
  assert.throws(
    () => parseQuickFixPlan({ "plan.md": impactedWithoutShard }),
    /must own affected domain shard: docs\/domain\/gsd\.md/i,
  );
  const impacted = impactedWithoutShard.replace(
    "- **Test:**",
    "  - `docs/domain/gsd.md` — modify: align current Quick-fix production semantics\n- **Test:**",
  );
  assert.equal(parseQuickFixPlan({ "plan.md": impacted }).domainImpact.classification, "change-existing-context");

  const reference = read("skills/gsd/REFERENCE.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  assert.match(reference, /# Quick-fix Plan[\s\S]{0,240}## Domain Impact[\s\S]{0,360}## Tasks/);
  assert.match(reference, /Quick-fix always records `Broad bootstrap: not-offered`/);
  assert.match(verify, /`Broad bootstrap` must always be `not-offered`/);
  assert.match(verify, /Quick-fix[\s\S]{0,500}exact five-field `Domain Impact`/i);
  assert.match(verify, /Quick-fix[\s\S]{0,800}domain drift[\s\S]{0,100}(?:blocks|Blocker)/i);

  // AC-5: an absent domain index keeps Quick-fix bounded instead of exiting it.
  for (const doc of [reference, verify]) {
    assert.match(doc, /absent (?:`docs\/domain\/index\.md`|domain index) keeps/i);
    assert.doesNotMatch(doc, /(?:A |a )missing index or requested broad bootstrap exits/);
    assert.match(doc, /only an explicitly requested broad bootstrap exits/i);
  }

  // AC-5: resume never reloads the already-injected master bootstrap.
  const handoff = read("skills/gsd-handoff/SKILL.md");
  assert.doesNotMatch(handoff, /Load master once/);
  assert.match(handoff, /never reloaded: validate state, then load the peer owner/);
});

test("planner single-writes structured task file intents", () => {
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");

  assert.match(reference, /- \*\*Files:\*\*\n\s+- `<path>` — (?:create\|modify\|delete|<create\|modify\|delete>)/);
  assert.match(planner, /REFERENCE\.md[^.\n]*§ Packet grammar/);
  assert.match(planner, /single-writes exactly that grammar/i);
  assert.match(reference, /accepts only structured task blocks/i);
  assert.match(reference, /rejected in every validation path/i);
  assert.match(execution, /reads only structured task blocks/i);
  assert.doesNotMatch(reference, /dual-read/i);
  assert.doesNotMatch(execution, /legacy task blocks/i);
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
  const designTwice = read("skills/gsd-codebase-architecture/DESIGN-IT-TWICE.md");
  const designSkill = read("skills/gsd-codebase-architecture/SKILL.md");
  const ponytail = read("skills/gsd-ponytail/SKILL.md");

  for (const [path, body] of corpus) {
    assert.doesNotMatch(
      body,
      /gsdReviewer|gsd-reviewer|gsdExecutor|gsd-executor|reviewer_model|executor_model|review_round|blocking_fingerprint|reviewed_commit|progress_status|terminal_repair_round|Adaptive Chunked Cumulative Review|\breducer\b|review shard|shard review|per-shard|shard lifecycle|root integrator|root-integrator|reviewer PASS|\bparent (?:owner|authority)\b/i,
      path,
    );
  }
  assert.match(reference, /schema:v4[\s\S]*session owner/i);
  assert.match(handoff, /schema:v4[\s\S]*session owner/i);
  assert.match(reference, /sole lifecycle authority/i);
  assert.match(verify, /plan hash[\s\S]*every active AC[\s\S]*changed path[\s\S]*task diffs in plan order/i);
  assert.match(verify, /malformed binding[\s\S]*ownership\/coverage mismatch[\s\S]*contract contradiction[\s\S]*red deterministic check/i);
  assert.match(verify, /Deferred Slow E2E/i);
  assert.doesNotMatch(designTwice, /sub-?agents?|`task`/i);
  assert.match(designTwice, /three self-contained shapes/i);
  assert.match(designSkill, /DESIGN-IT-TWICE\.md/);
  assert.match(ponytail, /^hide: true$/m);
  assert.doesNotMatch(ponytail, /ponytail_level|Invocation modes|explicit_level|auto_scope|lite\/full\/ultra/i);
});

test("every GSD skill has complete matching frontmatter", () => {
  for (const name of skillNames()) {
    const skill = read(`skills/${name}/SKILL.md`);
    assert.match(skill, new RegExp(`^---\\nname: ${name}\\n`, "m"), name);
    assert.doesNotMatch(skill, /^triggers:/m, `${name} carries no dead triggers field`);
    assert.match(skill, /^produces: \[.*\]$/m, `${name} produces`);
    assert.match(skill, /^consumes: \[.*\]$/m, `${name} consumes`);
  }
});

test("visible catalog descriptions stay within the injected byte budget", () => {
  // Every visible description is injected once per session, so the sum is a real cost.
  let total = 0;
  for (const name of skillNames()) {
    const skill = read(`skills/${name}/SKILL.md`);
    if (/^hide: true$/m.test(skill)) continue;
    const description = JSON.parse(skill.match(/^description: (.+)$/m)[1]);
    assert.doesNotMatch(description, /^Do not use|\. Do not use for read-only questions/, name);
    total += Buffer.byteLength(description, "utf8");
  }
  assert.ok(total < 1800, `summed visible description bytes must stay under 1800, got ${total}`);

  // AC-6: the renderer byte-accounting spec belongs beside createCapsule, not in
  // agent-facing prose. Input caps stay because the renderer validates against them.
  const reference = read("skills/gsd/REFERENCE.md");
  assert.doesNotMatch(reference, /\d+\s*\+\s*\d+\s*\+\s*\d+\s*\+\s*\d+\s*=/);
  assert.doesNotMatch(reference, /UTF-8 bytes\)/);
  assert.doesNotMatch(reference, /Byte-Budget Limits|Caps are a maximum/);
  assert.match(reference, /A rendered capsule over 4000 bytes fails closed/);
  assert.match(read("extensions/gsd-context.js"), /2750|2759/);
  for (const name of skillNames()) {
    assert.doesNotMatch(read(`skills/${name}/SKILL.md`), /^triggers:/m, `${name} triggers`);
  }
});

test("agent-facing skill prose keeps rule lines readable", () => {
  // AC-7: a single line must not stack many distinct rules. Bullets cost the same
  // bytes but let an agent apply one rule at a time.
  const MAX_LINE_CHARS = 600;
  const offenders = [];
  const markdown = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`);
      else if (entry.name.endsWith(".md")) markdown.push(`${dir}/${entry.name}`);
    }
  };
  walk("skills");
  assert.ok(markdown.length >= skillNames().length, "every skill contributes at least one markdown file");
  for (const file of markdown) {
    read(file).split("\n").forEach((line, index) => {
      if (line.length > MAX_LINE_CHARS) offenders.push(`${file}:${index + 1} (${line.length})`);
    });
  }
  assert.deepEqual(offenders, []);
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
    .replace(FILES_BLOCK, filesBlockWith('  - `docs/gsd/canonical-fixture/milestones.md` — modify: record the approved milestone ledger'));
  assert.doesNotThrow(() => parseMarkdownPacket({ "plan.md": publishedPlan }));
  
  const invalidPubPlan = files["plan.md"]
    .replace("## Publication\nnull", "## Publication\n`docs/gsd/canonical-fixture/" + ["milestones", ".toon"].join("") + "`")
    .replace(FILES_BLOCK, filesBlockWith("  - `docs/gsd/canonical-fixture/" + ["milestones", ".toon"].join("") + "` — modify: reference a runtime ledger path"));
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": invalidPubPlan }),
    /Publication must be null or the canonical Markdown ledger path/,
  );

  // focused Publication cases: null+ledger, wrong feature, no owner, duplicate non-superseded owners, superseded-only owner, and valid exact owner
  // 1. null+ledger
  const nullPlusLedgerPlan = files["plan.md"]
    .replace(FILES_BLOCK, filesBlockWith('  - `docs/gsd/canonical-fixture/milestones.md` — modify: record the approved milestone ledger'));
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": nullPlusLedgerPlan }),
    /unowned or mismatched milestone ledger path/
  );

  // 2. wrong feature
  const wrongFeaturePlan = files["plan.md"]
    .replace("## Publication\nnull", "## Publication\n`docs/gsd/wrong-feature/milestones.md`")
    .replace(FILES_BLOCK, filesBlockWith("  - `docs/gsd/wrong-feature/milestones.md` — modify: reference a mismatched ledger slug"));
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
      T1_BLOCK,
      `### T1: Parse plan\n- **Satisfies:** AC-1\n${filesBlockWith('  - `docs/gsd/canonical-fixture/milestones.md` — modify: record the approved milestone ledger')}\n- **Test:** \`node --test test/skills.test.js\`\n- **Status:** pending\n### T2: Another task\n- **Satisfies:** AC-2\n${filesBlockWith('  - `docs/gsd/canonical-fixture/milestones.md` — modify: record the approved milestone ledger')}\n- **Test:** \`node --test test/skills.test.js\`\n- **Status:** pending`
    );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": duplicateOwnersPlan }),
    /non-null publication path must occur exactly once/
  );

  // 5. superseded-only owner
  const supersededOnlyOwnerPlan = files["plan.md"]
    .replace("## Publication\nnull", "## Publication\n`docs/gsd/canonical-fixture/milestones.md`")
    .replace(
      T1_BLOCK,
      `### T1: Parse plan\n- **Satisfies:** AC-1\n${filesBlockWith('  - `docs/gsd/canonical-fixture/milestones.md` — modify: record the approved milestone ledger')}\n- **Test:** \`node --test test/skills.test.js\`\n- **Status:** superseded\n### T2: Another task\n- **Satisfies:** AC-1\n${FILES_BLOCK}\n- **Test:** \`node --test test/skills.test.js\`\n- **Status:** pending`
    );
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": supersededOnlyOwnerPlan }),
    /non-null publication path must occur exactly once/
  );

  // 6. valid exact owner
  const validExactOwnerPlan = files["plan.md"]
    .replace("## Publication\nnull", "## Publication\n`docs/gsd/canonical-fixture/milestones.md`")
    .replace(FILES_BLOCK, filesBlockWith('  - `docs/gsd/canonical-fixture/milestones.md` — modify: record the approved milestone ledger'));
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

  // Interfaces Path still uses the comma-separated backticked list validator.
  assert.throws(() => parseMarkdownPacket({ "plan.md": replaceOnce(files["plan.md"], INTERFACE_ROW, "| AC-1 | parser | `test/skills.test.js`, unbackticked | none |") }), /must be comma-separated/);

  // Task Files path validator tests
  // 1. absolute
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": replaceOnce(files["plan.md"], FILES_BLOCK, "- **Files:**\n  - `/absolute/path.js` — modify: exercise the path validator") }),
    /must be repository-relative/
  );
  // 2. backslash
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": replaceOnce(files["plan.md"], FILES_BLOCK, "- **Files:**\n  - `some\\\\path.js` — modify: exercise the path validator") }),
    /contains backslash/
  );
  // 3. empty segment
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": replaceOnce(files["plan.md"], FILES_BLOCK, "- **Files:**\n  - `some//path.js` — modify: exercise the path validator") }),
    /contains empty segment/
  );
  // 4. dot/traversal
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": replaceOnce(files["plan.md"], FILES_BLOCK, "- **Files:**\n  - `some/../path.js` — modify: exercise the path validator") }),
    /contains dot\/traversal/
  );
  // 5. .scratch
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": replaceOnce(files["plan.md"], FILES_BLOCK, "- **Files:**\n  - `.scratch/path.js` — modify: exercise the path validator") }),
    /contains \.scratch/
  );
  // 6. runtime TOON path
  assert.throws(
    () => parseMarkdownPacket({ "plan.md": replaceOnce(files["plan.md"], FILES_BLOCK, "- **Files:**\n  - `some/handoff-1.toon` — modify: exercise the path validator") }),
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
    () => validateSectionEdges(`${T1_BLOCK}\n\n`, "Tasks"),
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
  const trailingBlankContext = files["plan.md"].replace("A tracked inline fixture.\n## Domain Impact", "A tracked inline fixture.\n\n## Domain Impact");
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
  assert.throws(() => parseMarkdownPacket({ ...files, "plan.md": files["plan.md"].replace("- **Status:** pending", `- **Status:** pending \n### T2: Another task\n- **Satisfies:** AC-1\n${FILES_BLOCK}\n- **Test:** \`node --test test/skills.test.js\`\n- **Status:** superseded`) }), /Status must not have leading or trailing whitespace/);
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
        `- **Status:** pending\n### T2: Task 2\n- **Satisfies:** AC-2\n${FILES_BLOCK}\n- **Test:** \`node --test test/skills.test.js\`\n- **Status:** pending`
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
    const filesList = i === 10
      ? "  - `test/skills.test.js` — modify: exercise the canonical parser fixture\n  - `test/another.test.js` — modify: exercise the second pinned path"
      : "  - `test/skills.test.js` — modify: exercise the canonical parser fixture";
    taskBlocks += `### T${i}: Task ${i}\n- **Satisfies:** AC-${i}\n- **Files:**\n${filesList}\n- **Test:** \`node --test test/skills.test.js\`\n- **Status:** pending\n`;
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
  assert.match(execution, /amend `\.scratch\/<feature>\/plan\.md` under § Plan amendment, revalidate, rebind/i);
  assert.match(handoff, /Write atomic `\.scratch\/<feature>\/state\.toon`/i);
  assert.match(tdd, /focused test seam from the approved Markdown plan/);
  assert.match(tdd, /consume the exact validated task slice and relevant pinned sections/);
  assert.doesNotMatch(tdd, /proposal\.toon|spec\.toon|plan\.toon/);
  assert.match(reference, /Quick-fix plan exception/);
  assert.match(master, /Quick-fix plan exception/);
  assert.match(verify, /malformed binding[\s\S]*red deterministic check blocks/i);
  assert.match(planner, /atomically write canonical `schema:v4` `state\.toon`/);
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
});

test("legacy terminal prose matches discovery and explicit-read behavior", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const domain = read("docs/domain/gsd.md");

  assert.match(reference, /Exact active `schema:v1`, `schema:v2`, and `schema:v3` records migrate only after full validation/);
  assert.match(reference, /Exact v1\/v2 `completed-retained` records[\s\S]{0,220}candidate discovery[\s\S]{0,180}explicit `readStateFile` rejects[\s\S]{0,160}Retained v3 remains the sole terminal case/i);
  assert.match(handoff, /v1\/v2 terminal records fail closed unchanged[\s\S]{0,180}v3 `completed-retained` compatibility case[\s\S]{0,220}candidate discovery[\s\S]{0,180}explicit read validates and migrates/i);
  assert.match(domain, /retained v1\/v2 terminal records remain inert[\s\S]{0,180}fail closed on explicit read[\s\S]{0,180}retained v3 migrates only on an explicit validated read/i);
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

  assert.match(read("skills/gsd-domain-modeling/SKILL.md"), /## Domain lifecycle[\s\S]*## Markdown contracts/);
  assert.match(read("skills/gsd-codebase-architecture/SKILL.md"), /## Vocabulary[\s\S]*## Domain-aligned architecture[\s\S]*## Seam discipline/);
});

test("domain model index summarizes the gsd lifecycle responsibility", () => {
  const index = read("docs/domain/index.md");
  const purpose = index.match(/^\| gsd \| `gsd\.md` \| (.+) \|$/m)?.[1];
  assert.ok(purpose, "gsd scope purpose must exist");
  for (const term of ["delivery lifecycle", "artifact authority", "Domain Impact", "resume", "verification", "milestone ownership"]) {
    assert.match(purpose, new RegExp(term, "i"));
  }
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

test("domain impact is enforced across the feature lifecycle", () => {
  const brainstorm = read("skills/gsd-brainstorming/SKILL.md");
  const modeler = read("skills/gsd-domain-modeling/SKILL.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const agents = read("AGENTS.md");

  for (const body of [brainstorm, modeler, planner, execution, verify, reference]) {
    assert.match(body, /Domain Impact/);
  }
  assert.match(brainstorm, /When `docs\/domain\/index\.md` exists[\s\S]{0,220}do not (?:offer|suggest)[\s\S]{0,120}broad/i);
  assert.match(brainstorm, /read only[\s\S]{0,100}affected[\s\S]{0,100}(?:context|shard)/i);
  assert.match(brainstorm, /When `docs\/domain\/index\.md` is absent[\s\S]{0,240}feature-scoped[\s\S]{0,160}broad/i);
  assert.match(modeler, /Declining broad bootstrap never (?:waives|skips)[\s\S]{0,120}required/i);
  assert.match(planner, /Classification[\s\S]*Contexts[\s\S]*Documentation[\s\S]*Broad bootstrap[\s\S]*Evidence/);
  assert.match(planner, /bind[\s\S]{0,160}exact[\s\S]{0,120}domain-documentation paths/i);
  assert.match(execution, /same owning task[\s\S]{0,180}code[\s\S]{0,120}domain documentation/i);
  assert.match(execution, /target domain behavior[\s\S]{0,160}current production behavior/i);
  assert.match(verify, /domain drift[\s\S]{0,160}(?:blocks|Blocker)/i);
  assert.equal(agents.match(/^## Domain documentation$/gm)?.length, 1);
  assert.match(agents, /production code, schemas, contracts, and tests are authoritative/i);
  assert.match(agents, /No domain impact[\s\S]{0,100}justification/i);
  assert.match(reference, /existing `docs\/domain\/index\.md` suppresses[\s\S]{0,120}broad/i);
});

test("UI Impact is written, retained, and revalidated across the lifecycle", () => {
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");

  for (const body of [planner, execution, verify, reference]) {
    assert.match(body, /UI Impact/);
  }
  // The canonical grammar block orders the four fields directly after Domain Impact.
  assert.match(
    reference,
    /## Domain Impact\n(?:- \*\*.+\n){5}## UI Impact\n- \*\*Classification:\*\* <none\|reuse-prototype\|extend-prototype\|new-prototype>\n- \*\*Surfaces:\*\* .+\n- \*\*Prototype:\*\* .+\n- \*\*Evidence:\*\* .+\n/,
  );
  assert.match(reference, /only `reuse-prototype` names production `Surfaces`/);
  assert.match(planner, /Classification`, `Surfaces`, `Prototype`, `Evidence`/);
  // An authoring classification must change a real design/ artifact in the owning task, so
  // a plan can never claim it produced a prototype it does not touch.
  assert.match(planner, /bind each declared prototype path to a live task that also changes a non-doc `design\/` artifact/);
  assert.match(planner, /source of truth[\s\S]{0,160}never redefines it/i);
  assert.match(execution, /validated task slice[\s\S]{0,200}UI Impact/);
  assert.match(execution, /source of truth[\s\S]{0,200}same task as the surface change/i);
  assert.match(verify, /terminal slice including `Domain Impact` and `UI Impact`/);
  assert.match(verify, /UI drift[\s\S]{0,200}(?:blocks|Blocker)/i);

  // The README is the human entry point: the prototype phase and the plan section it
  // produces must both be documented, and the skill layout must list the new owner.
  const readme = read("README.md");
  assert.match(readme, /UI Impact/);
  assert.match(readme, /gsd-prototyping/);
  assert.match(readme, /gsd-prototyping\/\s*#[^\n]*prototyp/i, "skill layout lists the prototype owner");
  assert.match(readme, /prototyp[\s\S]{0,200}before[\s\S]{0,120}(?:requirement|converg)/i);

  // The shard is the durable record of shipped behavior: prototype-first delivery needs its
  // own workflow, command row, and policy, not only prose inside the skills.
  const domain = read("docs/domain/gsd.md");
  assert.match(domain, /^### Lock a prototype before requirements$/m);
  assert.match(domain, /\| Lock a prototype \| .+ \|/);
  assert.match(domain, /^### P-gsd-15: [^\n]*prototype/im);
  // The prototype-lock walkthrough records the configuration this repository sets, not a
  // tool habit: working directory at the repository root, generated files targeted at
  // `design/`, and a file-writing run over one inline artifact block.
  assert.match(domain, /working directory[\s\S]{0,140}repository root/i);
  assert.match(domain, /writes? files|file-writing/i);
  assert.match(domain, /inline artifact/i);
});

test("repository root instructs agents on design ownership", () => {
  const agents = read("AGENTS.md");
  const gitignore = read(".gitignore");

  assert.equal(agents.match(/^## Design documentation$/gm)?.length, 1, "exactly one canonical design section");
  // The root file is the only agent contract: this repository sets the design tool's
  // working directory to the repository root, so a nested design/AGENTS.md would compete.
  assert.match(agents, /root `AGENTS\.md`[\s\S]{0,200}only agent contract/i);
  assert.doesNotMatch(agents, /`design\/AGENTS\.md`/);
  assert.match(agents, /prototype artifacts[\s\S]{0,160}under `design\/`/i);
  // design/ is the source of truth for surface behavior; production code converts from it.
  assert.match(agents, /source of truth[\s\S]{0,200}convert/i);
  assert.match(agents, /backend-only[\s\S]{0,160}no design impact/i);
  // A system-wide accepted rule is durable; per-surface states stay with their surface.
  assert.match(agents, /`design\/docs\/interaction-rules\.md`/);
  // Configuration is the obligation, never an asserted tool habit: this repository sets the
  // tool's working directory to the repository root, targets its generated design files at
  // `design/`, and supplies this file plus `design/DESIGN.md` as context. A file-writing run
  // keeps the surface separated; a single-file artifact is still an input to decompose.
  assert.match(agents, /[Aa]ny AI design tool/);
  assert.match(agents, /working directory[\s\S]{0,140}repository root/i);
  assert.doesNotMatch(agents, /design tools open the repository root/i);
  assert.match(agents, /generated[\s\S]{0,100}`design\/`/i);
  assert.match(agents, /`design\/DESIGN\.md`[\s\S]{0,100}context/i);
  assert.match(agents, /writes? files[\s\S]{0,200}inline artifact/i);
  assert.match(agents, /single[- ]file[\s\S]{0,240}(?:decompose|split)/i);
  assert.match(agents, /before[\s\S]{0,120}lock/i);
  for (const entry of [".od/", ".live-artifacts/", ".file-versions/"]) {
    assert.ok(
      gitignore.split("\n").includes(entry),
      `.gitignore ignores design-tool runtime output directory ${entry}`,
    );
  }
});

test("prototype review captures accepted feedback before the surface locks", () => {
  const prototyping = read("skills/gsd-prototyping/SKILL.md");

  // Review feedback is durable only when it lands in an artifact: a system-wide rule goes
  // to the ledger, a surface-specific decision stays with its surface document.
  assert.match(prototyping, /`design\/docs\/interaction-rules\.md`/);
  assert.match(prototyping, /IR-<n>/);
  assert.match(prototyping, /system-wide[\s\S]{0,240}interaction-rules\.md/i);
  assert.match(prototyping, /surface-specific[\s\S]{0,200}surface(?:'s)? document/i);
  // Capture happens in the same turn as the prototype change, so the artifact never lags
  // behind what the prototype renders.
  assert.match(prototyping, /same turn[\s\S]{0,160}prototype change/i);
  // Lock is the gate that makes capture non-optional.
  assert.match(prototyping, /^\d+\. [^\n]*(?:accepted|unrecorded)[^\n]*$/m, "a lock criterion covers accepted feedback");
  assert.match(prototyping, /read[\s\S]{0,160}interaction-rules\.md[\s\S]{0,200}before/i);

  // The skill reads the root contract, never a nested one, and records the configured
  // working directory, `design/` output location, and file-writing run. A single-file
  // artifact is decomposed before the surface can lock.
  assert.match(prototyping, /root `AGENTS\.md`/);
  assert.doesNotMatch(prototyping, /`design\/AGENTS\.md`/);
  assert.match(prototyping, /working directory[\s\S]{0,140}repository root/i);
  assert.doesNotMatch(prototyping, /[Rr]un the design tool from the repository root/);
  assert.match(prototyping, /generated[\s\S]{0,100}`design\/`/i);
  assert.match(prototyping, /`design\/DESIGN\.md`[\s\S]{0,120}context/i);
  assert.match(prototyping, /writes? files[\s\S]{0,200}inline artifact/i);
  assert.match(prototyping, /single[- ]file[\s\S]{0,240}(?:decompose|split)/i);
  assert.match(prototyping, /^\d+\. [^\n]*(?:decomposed|split into)[^\n]*$/m, "a lock criterion covers the structure");

  // The Design standard states obligations, not one framework's mechanics: the template's
  // light-DOM custom elements are named as its own choice, so a project on a component
  // framework keeps the obligation and swaps the mechanism.
  assert.match(prototyping, /declared token, never an inline literal/i);
  assert.match(prototyping, /one extracted component/i);
  assert.match(prototyping, /component framework uses that framework instead/i);
});

test("domain modeling keeps preapproval writes current-only and reads affected shards only", () => {
  const brainstorm = read("skills/gsd-brainstorming/SKILL.md");
  const modeler = read("skills/gsd-domain-modeling/SKILL.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");

  assert.doesNotMatch(modeler, /Write target behavior before approval/i);
  assert.match(modeler, /Before approval[\s\S]{0,180}return[\s\S]{0,120}exact affected paths[\s\S]{0,180}write no target behavior/i);
  assert.match(modeler, /unrelated mappings[\s\S]{0,180}metadata[\s\S]{0,180}never read unrelated shard bodies/i);
  assert.match(brainstorm, /Before approval[\s\S]{0,200}exact affected paths[\s\S]{0,160}writes no future behavior/i);
  assert.match(planner, /reserved[\s\S]{0,120}domain-documentation paths[\s\S]{0,180}plan owns target behavior/i);
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

  const requiredHeadings = [
    "Scope",
    "Purpose and responsibilities",
    "Terms",
    "Actors",
    "Invariants",
    "Workflows and state transitions",
    "Commands, events, and outcomes",
    "Context relationships",
    "Domain policies",
  ];
  for (const { scope, file, purpose } of scopeRows) {
    assert.ok(purpose, `${scope} purpose is required`);
    assert.equal(file, `${scope}.md`, `${scope} shard name`);
    assert.ok(existsSync(join(ROOT, "docs/domain", file)), `${file} must exist`);

    const shard = read(`docs/domain/${file}`);
    assert.doesNotMatch(shard, /\r/);
    assert.match(shard, /^# Domain Scope\n/);
    assert.equal(shard.match(/^## Scope\n\n`([^`]+)`$/m)?.[1], scope);
    assert.deepEqual(
      [...shard.matchAll(/^## (.+)$/gm)].map((match) => match[1]),
      requiredHeadings,
      `${scope} production-domain headings`,
    );
    assert.doesNotMatch(shard, /^## Decisions$/m);

    const termRows = [...shard.matchAll(/^\| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)]
      .map(([, term]) => term.trim())
      .filter((term) => !["Term", "Command or event", "---"].includes(term));
    assert.ok(termRows.length > 0, `${scope} shard must describe current domain behavior`);
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
  assert.match(execution, /current top-level session owner consumes the validated slice/);
  assert.match(execution, /implements or repairs the task inline/);
  assert.match(execution, /next task in strict heading order/);
  assert.match(execution, /dispatches no[\s\S]{0,120}generic child task/);
  assert.match(reference, /current top-level session owner implements and repairs each ordered task inline and sequentially/i);
  assert.match(execution, /Task `Tn\+1` begins only from the committed green checkpoint of `Tn`/);
  assert.match(execution, /Source mutations never overlap task\/repair or Deferred Slow E2E/i);
  assert.match(verify, /No free-form critique or model-generated verdict is terminal authority/);
  assert.match(domain, /### P-gsd-3: Make the session owner the sole lifecycle authority/);
  assert.match(domain, /### P-gsd-4: Converge only through deterministic blockers/);
  assert.match(domain, /### P-gsd-5: Rehydrate authority from canonical sources/);
  assert.match(readme, /## Session-owner authority/);
  assert.equal(existsSync(join(ROOT, "agents", "gsd-executor.md")), false);
  assert.equal(existsSync(join(ROOT, "agents", "gsd-reviewer.md")), false);
  assert.match(execution, /full parse and binding check at execution entry or resume/);
  assert.match(execution, /At ordinary task selection consume the retained validated task slice/);
  assert.match(execution, /RED before implementation, GREEN after implementation, then refactor after green/);
  assert.match(execution, /rerun only checks invalidated by the repair/);
  assert.match(execution, /Reject legacy proposal\/spec\/design files/);
  assert.match(execution, /an amended plan is rebound in that same write/);
});

test("T2 schema:v4 state.toon contract and skill derivation", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const master = read("skills/gsd/SKILL.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");

  assert.match(reference, /## Runtime state contract/);
  const currentStateBlock = reference.match(/```toon\nschema:v4\n[\s\S]*?\n```/);
  assert.ok(currentStateBlock, "REFERENCE must contain canonical schema:v4");
  assert.doesNotMatch(currentStateBlock[0], /model|agent|review|ponytail/);
  assert.match(currentStateBlock[0], /phase:draft\|approved\|executing\|paused\|verifying\|repair\|merged-cleanup-pending\|completed-retained/);
  assert.match(currentStateBlock[0], /checkpoint_revision/);
  assert.match(currentStateBlock[0], /cleanup_preference:none\|delete\|retain\|archive-and-delete/);
  assert.match(reference, /Exact active `schema:v1`, `schema:v2`, and `schema:v3` records migrate only after full validation/);
  assert.match(reference, /`schema:v3` `completed-retained` record is the sole terminal explicit-read compatibility case[\s\S]{0,180}candidate discovery[\s\S]{0,180}explicit `readStateFile`[\s\S]{0,160}migrates it to canonical `schema:v4`/);
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
  assert.match(handoff, /Write atomic `\.scratch\/<feature>\/state\.toon`/);
  assert.match(handoff, /Active skills are derived from `phase` and `next_action`/);
  assert.match(handoff, /Never serialize a `reload` manifest/);
  assert.match(handoff, /Exact active v1, v2, and v3 records migrate atomically/);
  assert.match(handoff, /v1\/v2 terminal records fail closed unchanged/);
  assert.match(planner, /atomically write canonical `schema:v4` `state\.toon`/);
  assert.match(execution, /validated task slice/);
  assert.match(execution, /Do not write task-attempt TOON files/);
  assert.match(verify, /phase=merged-cleanup-pending|merged-cleanup-pending/);
  assert.match(master, /state\.toon/);
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

  // Prototype-first routing: new user-facing surface work converges in design/ before
  // requirements, while backend-only work must not be dragged through a prototype.
  const prototypeFixtures = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const selecting = prototypeFixtures.get("new-surface-prototype");
  assert.ok(selecting, "a fixture pins prototype selection for new surface work");
  assert.equal(selecting.expectedPrimarySkill, "gsd-prototyping");
  assert.equal(selecting.expectedAction, "load");
  const nonSelecting = prototypeFixtures.get("backend-only-no-prototype");
  assert.ok(nonSelecting, "a fixture pins non-selection for backend-only work");
  assert.notEqual(nonSelecting.expectedPrimarySkill, "gsd-prototyping");
  assert.equal(nonSelecting.expectedAction, "load");
  const bootstrap = read("skills/gsd/SKILL.md");
  assert.match(bootstrap, /gsd-prototyping/);
  assert.match(bootstrap, /user-facing surface[\s\S]{0,240}before[\s\S]{0,120}(?:requirement|converg)/i);
  assert.match(bootstrap, /backend-only[\s\S]{0,160}never[\s\S]{0,120}prototyp/i);

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

  // Leftover terminal or malformed state gates related and lifecycle intent only. An
  // unrelated direct prompt keeps ordinary behavior, and uncertainty asks one question.
  for (const doc of [master, reference]) {
    assert.match(doc, /unrelated direct work is never blocked|never blocks unrelated direct work/);
    assert.match(doc, /asks one question instead of stopping/);
    assert.match(doc, /Malformed residual bytes without a `plan\.md` \| `ordinary-routing`/);
    assert.doesNotMatch(doc, /Any state is malformed \| `fail-closed`/);
    assert.doesNotMatch(doc, /globally gates recovery|global crash-recovery gate/);
  }
  // Malformed bytes cannot be parsed, so only the directory name may decide relatedness.
  assert.match(reference, /only the `\.scratch\/<feature>\/` directory name is a trusted relatedness signal/);
  assert.deepEqual(
    {
      decision: byId.get("result-pending-unrelated").decision,
      action: byId.get("result-pending-unrelated").expectedAction,
      primarySkill: byId.get("result-pending-unrelated").expectedPrimarySkill,
    },
    { decision: "ordinary-routing", action: "direct", primarySkill: null },
  );
  assert.deepEqual(
    {
      decision: byId.get("result-malformed-unrelated").decision,
      action: byId.get("result-malformed-unrelated").expectedAction,
    },
    { decision: "ordinary-routing", action: "load" },
  );
  assert.equal(byId.get("result-malformed-with-active").decision, "fail-closed");
  assert.match(evalRunner, /createBootstrap\(repoRoot\)/);
  assert.match(evalRunner, /discoverSkillCatalog\(repoRoot\)/);
  // The runner pins the stable text transport; it never parses omp's JSON event stream.
  assert.doesNotMatch(evalRunner, /REFERENCE\.md|route|trace/);
  assert.match(evalRunner, /--mode", "text|--mode text/);
  assert.doesNotMatch(evalRunner, /--mode", "json|message_end|assistantMessageEvent/);
  assert.match(master, /Completed-state decision matrix|completed-state decision matrix/i);
});

test("the bootstrap names the resume gateway, fail-closed precedence, and helper limits", () => {
  // The live activation eval measured these five rules wrong on both evaluated models,
  // so the injected routing authority must state each one instead of implying it.
  const master = read("skills/gsd/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");

  // Validated active state enters through gsd-handoff; next_action picks the peer owner.
  assert.match(master, /`gsd-handoff`[^.\n]{0,160}(?:first|gateway)|(?:first|gateway)[^.\n]{0,160}`gsd-handoff`/);
  assert.match(master, /`next_action`/);
  assert.match(master, /bare resume[^.\n]{0,120}`gsd-handoff`/i);
  assert.match(master, /[Nn]aming the work[^.\n]{0,140}`gsd-executing-plans`/);

  // Runtime discovery decides malformed authority: a feature holding both `plan.md` and
  // malformed `state.toon` throws for every prompt, while plan-less bytes are skipped.
  assert.match(master, /malformed[\s\S]{0,240}`fail-closed`|`fail-closed`[\s\S]{0,240}malformed/);
  assert.match(master, /(?:full|complete) packet|without a `plan\.md`|residual/i);

  // A moved plan hash is an amendment, never a lifecycle stop.
  assert.match(master, /hash mismatch[^.\n]{0,120}amend|amend[^.\n]{0,120}hash mismatch/i);

  // A first-pending ledger row resumes; it never authorizes replacement brainstorming.
  assert.match(master, /first pending[^.\n]{0,160}resum|ledger[^.\n]{0,160}resum/i);

  // gsd-tdd is a helper: it is never the primary owner for direct work.
  assert.match(master, /`gsd-tdd`[^.\n]{0,160}never[^.\n]{0,40}(?:primary|owner)/);

  // `continue` alone is the only bare resume: it enters gsd-handoff even beside exactly
  // one executing packet, while `continue` plus a named feature/task/repair routes
  // straight to that owner. The executing-plans catalog row admits only prompt-named
  // pending work, so `next_action` never competes with the gateway during selection.
  assert.match(master, /`continue` alone is a bare resume/);
  assert.match(master, /even beside one executing packet/);
  assert.match(master, /`continue` plus a named feature, task, or repair is not bare/);
  assert.match(master, /Unrelated new work beside an active or `merged-cleanup-pending` packet is `ordinary-routing`; only a discovered completed-retained or residual record reports `ignore-terminal-record`/);
  // A returned Quick-fix WIP Fail leaves a nameable repair round that loads gsd-verify.
  assert.match(master, /repair round its prompt can name, which loads `gsd-verify` rather than answering directly/);
  assert.match(master, /An unrelated valid `merged-cleanup-pending` state \| `ordinary-routing`[\s\S]{0,120}never `ignore-terminal-record`/);
  // `ignore-terminal-record` is gated on a discovered terminal record: with none present,
  // unrelated work beside an active or merged-cleanup-pending packet stays ordinary.
  assert.match(master, /`ignore-terminal-record` needs a discovered `phase=completed-retained` record or residual terminal bytes; with none present, unrelated work stays `ordinary-routing`/);
  assert.match(reference, /`ignore-terminal-record` requires a discovered `phase=completed-retained` record or residual terminal bytes; with no such record present, unrelated work stays `ordinary-routing`/);
  // An active packet is never terminal history, so unrelated new work beside one is ordinary.
  assert.match(master, /An active or `merged-cleanup-pending` packet is never terminal history, so unrelated new work beside one is `ordinary-routing`/);
  assert.match(reference, /An active or `merged-cleanup-pending` packet is never terminal history, so new work unrelated to one is plain `ordinary-routing`/);
  // An unrelated valid merged-cleanup-pending state routes ordinarily: ignore-terminal-record
  // names completed-retained and residual records only, so the two rows never collapse.
  assert.match(reference, /`phase=merged-cleanup-pending` state is unrelated[\s\S]{0,180}never report `ignore-terminal-record`, which covers completed-retained and residual records only/);
  const executing = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(executing, /^description: "[^"]*pending work that the prompt names\."$/m);
  assert.doesNotMatch(executing.match(/^description: .*$/m)[0], /next_action/);

  // A located failure stays direct: diagnosis owns only unlocated or non-obvious causes.
  assert.match(master, /named file\/line or exact failure signature is located/);
  assert.match(master, /`gsd-diagnosing-bugs` owns only unlocated or non-obvious causes/);

  // Hash drift keeps prompt-named work with its executing owner instead of diverting to
  // the resume gateway, and a full malformed packet outranks every other active packet.
  assert.match(master, /never a stop or `gsd-handoff` diversion/);
  assert.match(master, /even one naming another valid feature/);

  // Several valid packets are an ambiguity to resolve through gsd-handoff, not a stop.
  // detectCandidates returns every valid packet and the capsule asks for exactly one
  // validated resume, so generic `continue` selects that owner instead of failing closed.
  assert.match(master, /(?:several|multiple|more than one)[^.\n]{0,120}valid[^.\n]{0,200}`gsd-handoff`/i);
  assert.match(master, /exactly one[^.\n]{0,80}resume/i);

  // The visible catalog description decides selection, so ledger recovery must appear.
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const handoffDescription = handoff.match(/^description: "(.*)"$/m);
  assert.ok(handoffDescription);
  assert.match(handoffDescription[1], /ledger|milestone/i);

  const domain = read("docs/domain/gsd.md");
  assert.match(domain, /Several valid active packets[\s\S]{0,240}`gsd-handoff`/);
  assert.match(domain, /full malformed packet[\s\S]{0,200}fails closed/i);
});

test("the activation evaluator runs keyless through the local omp CLI", () => {
  // A bearer key is not the way to reach a model here: the local omp binary already
  // holds credentials, so it is preferred and an ambient OPENAI_API_KEY cannot silently
  // bill an HTTP endpoint. `GSD_EVAL_BACKEND` is the explicit override.
  const ambientKey = selectEvalBackend({ OPENAI_API_KEY: "sk-ambient" }, "/usr/bin/omp");
  assert.equal(ambientKey.kind, "omp");
  assert.equal(ambientKey.command, "/usr/bin/omp");
  assert.deepEqual(ambientKey.models, ["gemini-3.6-flash", "gpt-5.6-luna"]);

  const keyless = selectEvalBackend({}, "/usr/bin/omp");
  assert.equal(keyless.kind, "omp");
  assert.deepEqual(keyless.models, ["gemini-3.6-flash", "gpt-5.6-luna"]);

  // No binary falls back to a bearer key; forcing http uses it even when omp exists.
  assert.equal(selectEvalBackend({ GSD_EVAL_KEY: "sk-test" }, null).kind, "http");
  const forcedHttp = selectEvalBackend({ GSD_EVAL_KEY: "sk-test", GSD_EVAL_BACKEND: "http" }, "/usr/bin/omp");
  assert.equal(forcedHttp.kind, "http");
  assert.deepEqual(forcedHttp.models, ["gpt-4o-mini"]);

  // An explicit model list overrides the defaults on either backend.
  assert.deepEqual(
    selectEvalBackend({ GSD_EVAL_MODEL: " gemini-3.6-flash , gpt-5.6-luna " }, "/usr/bin/omp").models,
    ["gemini-3.6-flash", "gpt-5.6-luna"],
  );
  assert.deepEqual(
    selectEvalBackend({ GSD_EVAL_KEY: "sk-test", GSD_EVAL_MODEL: "gpt-4.1" }, null).models,
    ["gpt-4.1"],
  );

  // A backend without its credential skips instead of pretending to run.
  assert.equal(selectEvalBackend({}, null).kind, "skip");
  assert.equal(selectEvalBackend({ GSD_EVAL_BACKEND: "http" }, "/usr/bin/omp").kind, "skip");
  assert.equal(selectEvalBackend({ GSD_EVAL_KEY: "sk-test", GSD_EVAL_BACKEND: "omp" }, null).kind, "skip");

  // Each model reports its own result, so one model cannot mask the other's failure.
  const runner = read("test/eval/activation-eval.mjs");
  assert.match(runner, /\$\{model\}(?::|\|)\$\{fixture\.id\}|\$\{fixture\.id\}(?::|\|)\$\{model\}/);
  // The omp run is isolated: no repo cwd, discovered extensions, skills, rules, tools, or session.
  for (const flag of [
    "--cwd", "--no-extensions", "--no-skills", "--no-rules", "--no-tools", "--no-session", "--system-prompt",
  ]) {
    assert.ok(runner.includes(flag), `omp eval run must pass ${flag}`);
  }
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

test("AC-1: Ponytail is hidden level-free context", () => {
  const ponytail = read("skills/gsd-ponytail/SKILL.md");
  const frontmatter = parseAgentFrontmatter(ponytail, "gsd-ponytail");
  assert.equal(frontmatter.hide, true);
  assert.match(ponytail, /smallest complete path/i);
  assert.match(ponytail, /enter the normal GSD lifecycle/i);
  assert.doesNotMatch(ponytail, /ponytail_level|Invocation modes|Role:\s*(?:owner|helper)|explicit_level|auto_scope|lite\/full\/ultra/i);
});

test("Quick-fix owner uses the injected hidden context and deterministic gates", () => {
  const master = read("skills/gsd/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");

  assert.match(master, /PONYTAIL_CONTEXT_PATH/);
  assert.match(master, /session owner[\s\S]{0,220}bounded fix[\s\S]{0,220}PONYTAIL_CONTEXT_PATH/i);
  // A fix the user already diagnosed is direct work: both evaluated models otherwise
  // named `gsd-verify` as the primary owner for a one-line known fix.
  assert.match(master, /already diagnosed[^.\n]{0,80}direct[^.\n]{0,60}never a `primarySkill`/i);
  assert.match(master, /PONYTAIL_CONTEXT_PATH[\s\S]{0,300}gsd-tdd[\s\S]{0,240}gsd-verify/i);
  assert.match(reference, /\| `gsd-verify` \| owner \|[^|\n]*Quick-fix[^|\n]*\|[^|\n]*Quick-fix `plan\.md`[^|\n]*\|/i);
  assert.match(reference, /Quick-fix[\s\S]{0,300}session owner[\s\S]{0,300}gsd-tdd[\s\S]{0,300}gsd-verify/i);
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
  assert.match(execution, /deterministic cumulative conformance before Deferred Slow E2E/);
  assert.match(verify, /deterministic cumulative conformance before Deferred Slow E2E/);
  assert.match(verify, /Run the complete feature-affected Deferred Slow E2E suite only after current-commit conformance/);
  assert.match(verify, /full slow\/E2E GREEN on the same unchanged commit/);
  assert.match(reference, /Green unchanged bytes then enter one-squash merge and cleanup/);
  assert.match(reference, /Deferred Slow E2E runs only after current-commit conformance/);
});

test("AC-4: hidden bootstrap uses state.toon and terminal conformance", () => {
  const master = read("skills/gsd/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.match(master, /Deferred Slow E2E/i);
  assert.match(master, /state\.toon/);
  assert.match(master, /deterministic terminal conformance/i);
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
  const visible = visibleSkillNames().filter((name) => name !== "gsd").sort();
  assert.equal(visible.length, 10, "exactly 10 visible GSD skills");

  const section = reference.match(
    /## Visible skill mandatory-use matrix\n+([\s\S]*?)(?:\n## |\n### |\n*$)/,
  );
  assert.ok(section, "REFERENCE must define ## Visible skill mandatory-use matrix");
  const body = section[1];
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

  assert.equal(rows.length, 10, "matrix must have exactly 10 rows");
  assert.deepEqual(rows.map((row) => row.skill).sort(), visible);
  assert.equal(new Set(rows.map((row) => row.skill)).size, 10, "no multiply mapped skill");

  const vague = /\b(as needed|if useful|when appropriate|sometimes|maybe|etc\.?|TBD|TODO)\b/i;
  // Only the Do-not-load and Transition labels were pinned, so a skill could restate another
  // skill's guard or understate its own exit: `gsd-diagnosing-bugs` carried brainstorming's
  // "known single-spot quick fix" while its row forbids a located failure, and `gsd-verify`
  // claimed only the planned green path squashes. Connectives and plural inflection
  // paraphrase freely; every content word of the canonical cell must survive.
  const CONNECTIVES = new Set(["still", "used", "with", "work", "from", "that", "this", "when", "only", "into"]);
  const stem = (word) => (word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
  const contentWords = (text) =>
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4 && !CONNECTIVES.has(word))
      .map(stem);
  const helpers = [];
  for (const row of rows) {
    assert.ok(row.intent && row.intent !== "—" && row.intent.length > 8, `${row.skill} exact intent`);
    assert.ok(row.prerequisites && row.prerequisites !== "", `${row.skill} prerequisites`);
    assert.ok(row.doNotLoad && row.doNotLoad !== "", `${row.skill} do-not-load`);
    assert.ok(row.transition && row.transition !== "—" && row.transition.length > 3, `${row.skill} transition`);
    for (const field of [row.intent, row.prerequisites, row.doNotLoad, row.transition]) {
      assert.doesNotMatch(field, vague, `${row.skill} field not vague`);
    }
    if (row.role === "helper") {
      helpers.push(row.skill);
      assert.notEqual(row.helperWhen, "—", `${row.skill} helper-when required`);
      assert.match(row.helperWhen, /must load|required when|active if and only if|load when/i);
    } else {
      assert.equal(row.helperWhen, "—", `${row.skill} owner has empty helper-when marker`);
    }

    const skillMd = read(`skills/${row.skill}/SKILL.md`);
    assert.match(skillMd, /Visible skill mandatory-use matrix/);
    assert.match(skillMd, new RegExp(`Role:\\s*${row.role}`));
    const pinRestatement = (label, canonical) => {
      const line = skillMd.match(new RegExp(`^- ${label}: (.+)$`, "m"));
      assert.ok(line, `${row.skill} restates ${label}`);
      const restated = new Set(contentWords(line[1]));
      const dropped = contentWords(canonical).filter((word) => !restated.has(word));
      assert.deepEqual(dropped, [], `${row.skill} drops canonical ${label} terms: ${dropped.join(", ")}`);
    };
    pinRestatement("Do-not-load", row.doNotLoad);
    pinRestatement("Transition", row.transition);
    if (row.role === "helper") pinRestatement("Helper-when", row.helperWhen);
  }

  assert.deepEqual(helpers.sort(), ["gsd-domain-modeling", "gsd-tdd"]);
  assert.doesNotMatch(body, /gsd-ponytail|gsd-codebase-design|gsd-improve-codebase-architecture/);
  assert.doesNotMatch(body, vague);
});

test("AC-4: Concision preserves semantic parity", () => {
  const MAX_VISIBLE_WORDS = 10900;
  const MAX_BOOTSTRAP_WORDS = 1010;
  const MAX_REFERENCE_WORDS = 5150;
  const wordCount = (body) => body.trim().split(/\s+/).filter(Boolean).length;
  const visible = visibleSkillNames().filter((name) => name !== "gsd").sort();
  assert.equal(visible.length, 10);
  const total = visible.reduce(
    (count, name) => count + wordCount(read(`skills/${name}/SKILL.md`)),
    0,
  );
  assert.ok(total <= MAX_VISIBLE_WORDS, `${total} must not exceed ${MAX_VISIBLE_WORDS}`);
  const bootstrapWords = wordCount(read("skills/gsd/SKILL.md"));
  const referenceWords = wordCount(read("skills/gsd/REFERENCE.md"));
  assert.ok(bootstrapWords <= MAX_BOOTSTRAP_WORDS, `${bootstrapWords} must not exceed ${MAX_BOOTSTRAP_WORDS}`);
  assert.ok(referenceWords <= MAX_REFERENCE_WORDS, `${referenceWords} must not exceed ${MAX_REFERENCE_WORDS}`);

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
  assert.doesNotMatch(handoff, /schema:v4\nfeature:/);
  assert.match(reference, /### Fast TDD and task-loop constraints/);
  assert.match(reference, /deterministic cumulative conformance/);
  // The validator owns the region between the title and the first section, so the grammar
  // section must say so: silent preamble tolerance was the gap that made them disagree.
  assert.match(reference, /any line between the title and its first section/);
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





test("AC-4 repair: ponytail is hidden and absent from runtime dispatch", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const ponytail = read("skills/gsd-ponytail/SKILL.md");
  assert.equal(parseAgentFrontmatter(ponytail, "gsd-ponytail").hide, true);
  assert.doesNotMatch(reference, /`gsd-ponytail`/);
  assert.doesNotMatch(ponytail, /Visible skill mandatory-use matrix|Helper-when:|ponytail_level/);
});

test("AC-4 repair: ponytail carries no modes or persisted preference", () => {
  const ponytail = read("skills/gsd-ponytail/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.doesNotMatch(ponytail, /## Invocation modes|explicit_level|auto_scope|ponytail_level|lite\/full\/ultra/i);
  const currentStateBlock = reference.match(/```toon\nschema:v4\n[\s\S]*?\n```/);
  assert.ok(currentStateBlock);
  assert.doesNotMatch(currentStateBlock[0], /ponytail/i);
});

test("AC-4 repair: domain-modeling exact production schema", () => {
  const domain = read("skills/gsd-domain-modeling/SKILL.md");
  assert.match(domain, /## Markdown contracts/);
  assert.match(domain, /# Domain Model/);
  assert.match(domain, /## Scopes/);
  assert.match(domain, /\| Scope \| File \| Purpose \|/);
  assert.match(domain, /# Domain Scope/);
  for (const heading of [
    "Purpose and responsibilities",
    "Terms",
    "Actors",
    "Invariants",
    "Workflows and state transitions",
    "Commands, events, and outcomes",
    "Context relationships",
    "Domain policies",
  ]) {
    assert.match(domain, new RegExp(`## ${heading}`));
  }
  assert.doesNotMatch(domain, /^## Decisions$/m);
  assert.match(domain, /current production behavior/i);
  assert.match(domain, /sole writer/i);
  assert.match(domain, /orphan shard, or any other partial directory fails closed/);
  assert.match(domain, /## Domain lifecycle/);
});

test("AC-4 repair: unified architecture vocabulary and deepening", () => {
  const skill = read("skills/gsd-codebase-architecture/SKILL.md");
  assert.match(skill, /## Vocabulary/);
  assert.match(skill, /deep module|Deep module/i);
  assert.match(skill, /## Domain-aligned architecture/);
  assert.match(skill, /## Seam discipline/);
  assert.match(skill, /DESIGN-IT-TWICE\.md/);
  assert.match(skill, /information hiding|complexity hidden/i);
  assert.match(skill, /Role:\s*owner/);
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
  assert.match(skill, /gsd-codebase-architecture/);
  // disclosure pair for AC-4 cross-ref
  assert.match(skill, /^[ ]{0,3}## Contextual disclosure.*\[\.\.\/gsd\/REFERENCE\.md\]\(\.\.\/gsd\/REFERENCE\.md\).*§ Contextual disclosure templates.*\r?\n[ ]{0,3}```/m);
});

test("AC-4 repair: unified architecture candidates selection gate", () => {
  const skill = read("skills/gsd-codebase-architecture/SKILL.md");
  assert.match(skill, /## Explore and design/);
  assert.match(skill, /## Candidate contract/);
  assert.match(skill, /ask the user to select one/i);
  assert.match(skill, /present ranked candidates/i);
  assert.match(skill, /Post-diagnosis architecture/);
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

test("AC-4 repair: unified architecture Adapter and Leverage definitions", () => {
  const skill = read("skills/gsd-codebase-architecture/SKILL.md");
  assert.match(skill, /\*\*Adapter\*\* — concrete implementation occupying a seam; a role/);
  assert.match(skill, /\*\*Leverage\*\* — capability reused across callers and tests per unit of interface learned/);
  assert.doesNotMatch(skill, /\*\*Adapter\*\* — thin translation at a boundary without leaking internals/);
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

test("AC-4 repair: existing domain index suppresses broad bootstrap", () => {
  const brainstorm = read("skills/gsd-brainstorming/SKILL.md");
  const architecture = read("skills/gsd-codebase-architecture/SKILL.md");
  const modeler = read("skills/gsd-domain-modeling/SKILL.md");
  for (const body of [brainstorm, architecture, modeler]) {
    assert.match(body, /When `docs\/domain\/index\.md` exists[\s\S]{0,240}(?:do not|never)[\s\S]{0,80}(?:offer|suggest)[\s\S]{0,80}broad/i);
  }
  assert.match(modeler, /When `docs\/domain\/index\.md` is absent[\s\S]{0,280}broad/i);
});

test("AC-4 repair: unified architecture implementation and seam principles", () => {
  const skill = read("skills/gsd-codebase-architecture/SKILL.md");
  assert.match(skill, /\*\*Implementation\*\* — behavior hidden inside a module/);
  assert.match(skill, /\*\*Depth\*\* — behavior and complexity hidden per unit of caller knowledge/);
  assert.match(skill, /deletion test/i);
  assert.match(skill, /One production adapter alone is a hypothetical seam/i);
  assert.match(skill, /Keep internal test seams private/i);
  assert.match(skill, /Tests observe the public interface and survive internal refactors/i);
});

test("AC-4 repair: session-owner task repair does not enter terminal verification", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(execution, /First checkpoint `next_action=start\/continue task`/);
  assert.match(execution, /rerun only checks invalidated by the repair/);
  assert.match(execution, /Load no terminal verifier until every task is green/);
  assert.match(execution, /enter terminal verification\/repair/);
  assert.doesNotMatch(execution, /re-enters review|re-enter review|gsdReviewer/);
});

test("AC-4 repair: architecture Explore friction and domain boundaries", () => {
  const skill = read("skills/gsd-codebase-architecture/SKILL.md");
  assert.match(skill, /## Explore and design/);
  assert.match(skill, /duplicated policy, concepts bouncing across shallow modules, leaky seams, wrong dependency direction/i);
  assert.match(skill, /bounded context is a semantic and language boundary/i);
  assert.match(skill, /Inside approved execution[\s\S]{0,260}Spec-escalation blocker/i);
});

test("AC-4 repair: architecture targetless guard and framework discipline", () => {
  const skill = read("skills/gsd-codebase-architecture/SKILL.md");
  assert.match(skill, /Invocation guard/i);
  assert.match(skill, /ask one focused target question; never survey the repository to invent a target/i);
  assert.match(skill, /Keep domain\/application policy independent/i);
  assert.match(skill, /Do not wrap stable framework APIs merely to appear framework-neutral/i);
});

test("AC-4 repair: architecture candidate enums exact", () => {
  const skill = read("skills/gsd-codebase-architecture/SKILL.md");
  assert.match(skill, /recommendation strength: `Strong`, `Worth exploring`, or `Speculative`/i);
  assert.match(skill, /`in-process`, `local-substitutable`, `remote but owned`, or `true external`/i);
});

test("AC-4 repair: session-owner task-repair evidence grammar", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(execution, /green focused evidence, recorded only in reporting and transcripts/);
  assert.match(execution, /rerun only checks invalidated by the repair/);
  assert.match(execution, /Do not write task-attempt TOON files/);
});

test("terminal-conformance AC-1: enter verification only after all tasks", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(execution, /Atomically update `state\.toon` with `last_green_task`, `last_green_commit`, and `next_action=start\/continue task`/);
  assert.match(execution, /Only after every non-superseded task and Fast TDD Check is green/);
  assert.match(execution, /next_action=enter terminal verification\/repair/);
  assert.match(execution, /load `gsd-verify`/);
  assert.doesNotMatch(execution, /After every non-superseded task[\s\S]{0,100}load `gsd-verify`/);
});

test("terminal-conformance AC-2: deterministic cumulative coverage and quality", () => {
  const verify = read("skills/gsd-verify/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.match(verify, /every active AC maps exactly once to one completed task and one public interface pin/);
  assert.match(verify, /every changed path is task-owned/);
  assert.match(verify, /task diffs in plan order/);
  assert.match(verify, /explicit Decisions, invariants, non-goals/);
  assert.match(verify, /focused-check evidence on the unchanged current commit/);
  assert.match(reference, /Only malformed binding, ownership\/coverage mismatch, explicit contract contradiction, unresolved change, or a red deterministic check blocks/);
});


test("terminal-conformance AC-5: same-commit invalidation and merge gates", () => {
  const verify = read("skills/gsd-verify/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.match(verify, /Any source change invalidates prior conformance/);
  assert.match(verify, /full slow\/E2E GREEN on the same unchanged commit/);
  assert.match(reference, /Source changes invalidate conformance/);
  assert.match(reference, /Green unchanged bytes then enter one-squash merge and cleanup/);
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

test("an executing owner amends the plan in place instead of blocking", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const domain = read("docs/domain/gsd.md");

  // Amending an approved plan mid-execution is a normal move: revalidate the new
  // bytes and rebind the hash. Only unparseable or missing authority still stops.
  assert.match(reference, /### Plan amendment/);
  assert.match(reference, /amend[\s\S]{0,200}revalidate[\s\S]{0,120}rebind/i);
  assert.doesNotMatch(reference, /digest mismatch at those boundaries fails closed as Spec escalation/);
  assert.match(execution, /amend/i);
  assert.doesNotMatch(execution, /Never rewrite the approved Markdown plan/);
  assert.doesNotMatch(execution, /altered, or additional `plan\.md` is Spec escalation/);
  assert.doesNotMatch(verify, /Changed plan bytes, malformed new grammar/);
  assert.match(verify, /changed plan bytes revalidate and rebind/i);
  assert.doesNotMatch(handoff, /invalid, missing, or changed plan is Spec escalation/);
  assert.match(handoff, /rebind/i);
  assert.match(planner, /sole writer of the initial|sole writer at creation/i);

  // Self-service vs ask: routine bookkeeping needs no prompt, material changes and
  // drift the owner cannot account for ask one question and still never stop.
  assert.match(reference, /Bookkeeping amendments are self-service/);
  assert.match(reference, /Material amendments ask one question first/);
  assert.match(reference, /cannot account for asks one question/);
  assert.doesNotMatch(reference, /amendment[^.\n]{0,80}requires (?:a )?fresh approval/i);
  // A bound-hash exit 1 reports moved bytes, not a lifecycle stop.
  assert.match(reference, /exits 1[\s\S]{0,140}not as a lifecycle stop/);
  assert.doesNotMatch(reference, /mismatched hash fails closed/);

  // The revalidation command must match the packet grammar. A Quick-fix `plan.md`
  // exits 1 under `validate-plan` ("top-level heading must be exactly # Plan"), so
  // naming only that command turns a legal Quick-fix amendment into a false blocker.
  const amendment = reference.match(/### Plan amendment\n[\s\S]*?(?=\n### )/)[0];
  assert.match(amendment, /validate-plan/);
  assert.match(amendment, /validate-quick-fix/);
  assert.match(amendment, /grammar/i);
  assert.match(domain, /validate-quick-fix/);

  // Resume has the same grammar hazard as amendment, but `schema:v4` records no kind
  // discriminator, so "use the matching validator" is unactionable. The probe order is
  // the contract: `validate-quick-fix` first (a full plan exits 1 there), then the bound
  // full-plan form. A bound call checks the hash before parsing, so only an unbound
  // revalidation separates moved bytes from genuinely malformed grammar.
  const resume = handoff.match(/^For every Execution resume[\s\S]*?(?=\nA valid Execution resume)/m)[0];
  assert.match(resume, /validate-quick-fix[\s\S]*validate-plan/);
  assert.match(resume, /no grammar kind/);
  assert.match(resume, /unbound/);
  assert.match(resume, /Exit 2 is never escalation/);
  assert.doesNotMatch(resume, /For every Execution resume, run `node tools\/gsd-contract\.mjs validate-plan/);
  assert.match(domain, /probing `validate-quick-fix` before the full-plan validator/);
  // The probe reads current bytes, not the bound kind: a packet rewritten into the other
  // grammar probes clean, so a hash mismatch can never prove the prior kind. Any rule that
  // rebinds silently, or claims to know "the same grammar", is unexecutable — ask instead.
  assert.match(resume, /prior kind is unprovable/);
  assert.doesNotMatch(resume, /same proven grammar/);
  assert.match(domain, /prior packet kind is unprovable/);

  // A Quick-fix carries no normal-packet approval authority, yet its state records
  // and rebinds a validated `plan_sha256` — both merged Quick-fix features did. The
  // exception must say which binding is absent instead of denying binding outright.
  const quickFix = reference.match(/### Quick-fix plan exception\n[\s\S]*?(?=\n### Executable contract validator)/)[0];
  assert.doesNotMatch(quickFix, /set, no approval binding, and/);
  assert.match(quickFix, /no normal-packet approval binding/);
  assert.match(quickFix, /`state\.toon`/);
  assert.match(quickFix, /does not accept `--expected-sha256`|unbound/);
  assert.match(domain, /Quick-fix[^.\n]{0,160}runtime binding|runtime binding[^.\n]{0,160}Quick-fix/);
  // A recorded binding nobody checks is decoration: the Quick-fix gate compares it.
  assert.match(verify, /compare the returned hash with the recorded `state\.toon` `plan_sha256`/);

  // Uncertainty asks one question; it never becomes a stop.
  for (const body of [reference, execution]) {
    assert.match(body, /ask one question/i);
  }
  assert.doesNotMatch(domain, /Approved `plan\.md` bytes remain immutable/);
  assert.match(domain, /amend/i);
});
