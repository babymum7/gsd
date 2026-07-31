import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalPacket, structuredPacket, FILES_BLOCK, filesBlockWith, T1_BLOCK, INTERFACE_ROW,
  replaceOnce, read, skillNames, visibleSkillNames, filesUnder, markdownFiles,
  parseAgentFrontmatter, ROOT, SKILLS,
} from "./support/skills-fixtures.js";
import {
  bindApprovedSources, parseMarkdownPacket, parseQuickFixPlan, rejectLegacyPreapprovalFiles,
  sha256, verifyApprovedSources, validateSectionEdges,
} from "../lib/gsd-contract.mjs";
import {
  parseActivationResponse, responseMatchesFixture, selectEvalBackend, validateActivationTarget,
  validateFixtureSet,
} from "./eval/activation-eval-contract.mjs";
import gsdContextExtension, { CAPSULE_TEMPLATE } from "../extensions/gsd-context.js";

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
