import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "tools", "gsd-contract.mjs");

function canonicalPlan(feature = "valid-plan") {
  return [
    "# Plan",
    "## Feature",
    `\`${feature}\``,
    "## Base",
    "`main`",
    "## Summary",
    "Validate one canonical GSD plan through the production command.",
    "## Context",
    "gsd",
    "## Domain Impact",
    "- **Classification:** none",
    "- **Contexts:** none",
    "- **Documentation:** none",
    "- **Broad bootstrap:** not-offered",
    "- **Evidence:** This validation fixture changes no production term, invariant, workflow, outcome, relationship, policy, or context boundary.",
    "## UI Impact",
    "- **Classification:** none",
    "- **Surfaces:** none",
    "- **Prototype:** none",
    "- **Evidence:** This validation fixture renders no user-facing surface and converts no locked prototype into production markup.",
    "## Scope",
    "- Validate one canonical plan.",
    "## Acceptance Criteria",
    "### AC-1: Validate canonical plan",
    "- **State:** active",
    "- **Outcome:** The canonical plan is accepted through the production command.",
    "- **Action:** Run the validator against the plan fixture.",
    "- **Expected:** The command reports the feature and exact source hash.",
    "## Decisions",
    "None.",
    "## Invariants",
    "- **I-1:** Validation never mutates the source plan.",
    "## Non-goals",
    "- **NG-1:** The fixture does not exercise legacy compatibility.",
    "## Interfaces",
    "| Criterion | Seam | Path | Lower-seam reason |",
    "| --- | --- | --- | --- |",
    "| AC-1 | production validator CLI | `tools/gsd-contract.mjs` | none |",
    "## Publication",
    "null",
    "## Tasks",
    "### T1: Validate canonical plan",
    "- **Satisfies:** AC-1",
    "- **Files:**",
    "  - `tools/gsd-contract.mjs` — create: expose canonical plan validation",
    "- **Test:** `node --test test/gsd-contract.test.js`",
    "- **Status:** pending",
    "",
  ].join("\n");
}

function makePlanWorkspace(feature, content) {
  const workspace = mkdtempSync(join(tmpdir(), "gsd-contract-"));
  const featureDir = join(workspace, ".scratch", feature);
  mkdirSync(featureDir, { recursive: true });
  const planPath = join(featureDir, "plan.md");
  writeFileSync(planPath, content);
  return { workspace, planPath };
}

test("validate-plan emits deterministic minimal TOON for a canonical plan", () => {
  const plan = canonicalPlan();
  const { workspace, planPath } = makePlanWorkspace("valid-plan", plan);
  try {
    const expected = [
      "status: valid",
      "kind: plan",
      "feature: valid-plan",
      `sha256: ${createHash("sha256").update(plan).digest("hex")}`,
      "tasks: 1",
    ].join("\n");

    const first = spawnSync(process.execPath, [CLI, "validate-plan", "--path", planPath], {
      cwd: workspace,
      encoding: "utf8",
    });
    const second = spawnSync(process.execPath, [CLI, "validate-plan", "--path", planPath], {
      cwd: workspace,
      encoding: "utf8",
    });

    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.equal(first.stdout, expected);
    assert.equal(first.stderr, "");
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.equal(second.stdout, expected);
    assert.equal(second.stderr, "");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("both plan grammars reject content between the title and the first section", () => {
  // `validateSections` only inspects `## ` lines and `validateTitle` only counted `# `
  // headings, leaving this region unowned: a canonical title could carry arbitrary
  // preamble, or drift a blank line, and still validate as converged authority.
  const cases = [
    ["prose-preamble", "validate-plan", canonicalPlan().replace("# Plan\n", "# Plan\nstray preamble\n")],
    ["blank-preamble", "validate-quick-fix", quickFixPlan().replace("# Quick-fix Plan\n", "# Quick-fix Plan\n\n")],
  ];
  for (const [feature, command, content] of cases) {
    const { workspace, planPath } = makePlanWorkspace(feature, content);
    try {
      const result = spawnSync(process.execPath, [CLI, command, "--path", planPath], {
        cwd: workspace,
        encoding: "utf8",
      });
      assert.equal(result.status, 1, `${feature}: ${result.stdout}`);
      assert.match(result.stdout, /^status: error\ncode: invalid-artifact\n/);
      assert.match(result.stdout, /must be followed directly by the first ## section/);
      assert.equal(result.stderr, "");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
});
test("full-plan domain shard ownership matches Quick-fix, minus superseded tasks", () => {
  // The rule only ran for `kind === "quick-fix"`, so an identical non-`none` full plan
  // validated with no shard task at all. Full plans differ twice: `parseTasks` scopes
  // path uniqueness per task, so a shard may be re-owned at several checkpoints, and a
  // `superseded` task never runs, so ownership recorded there documents nothing.
  const semantic = (feature) =>
    canonicalPlan(feature)
      .replace("Classification:** none", "Classification:** change-existing-context")
      .replace("Contexts:** none", "Contexts:** gsd")
      .replace("Documentation:** none", "Documentation:** update-existing");
  const codeLine = "  - `tools/gsd-contract.mjs` \u2014 create: expose canonical plan validation";
  const shardLine = "  - `docs/domain/gsd.md` \u2014 modify: record the corrected production behavior";
  const t1Tail = "- **Test:** `node --test test/gsd-contract.test.js`\n- **Status:** pending";
  const appendTask = (plan, lines) => plan.replace(t1Tail, [t1Tail, ...lines].join("\n"));
  // A second live task needs its own active criterion, since every active AC is covered
  // exactly once and that check runs before shard ownership.
  const withSecondCriterion = (plan) =>
    plan
      .replace(
        "## Decisions",
        [
          "### AC-2: Document the corrected behavior",
          "- **State:** active",
          "- **Outcome:** The affected domain shard states the corrected production behavior.",
          "- **Action:** Read the shard after the change lands.",
          "- **Expected:** The shard describes the behavior the validator now enforces.",
          "## Decisions",
        ].join("\n"),
      )
      .replace(
        "| AC-1 | production validator CLI | `tools/gsd-contract.mjs` | none |",
        "| AC-1 | production validator CLI | `tools/gsd-contract.mjs` | none |\n| AC-2 | production validator CLI | `tools/gsd-contract.mjs` | none |",
      );

  const owned = semantic("owned").replace(codeLine, `${codeLine}\n${shardLine}`);
  // A second live task re-owns the same shard: legal, because it documents its own change.
  const reowned = withSecondCriterion(semantic("reowned")).replace(codeLine, `${codeLine}\n${shardLine}`);
  const reownedPlan = appendTask(reowned, [
    "### T2: Adjust the caller",
    "- **Satisfies:** AC-2",
    "- **Files:**",
    "  - `lib/gsd-contract.mjs` \u2014 modify: pass the corrected value through",
    shardLine,
    "- **Test:** `node --test test/gsd-contract.test.js`",
    "- **Status:** pending",
  ]);
  // The only shard owner is superseded, so no task that runs ever writes the shard.
  const supersededOwner = appendTask(semantic("superseded-owner"), [
    "### T2: Abandoned documentation pass",
    "- **Satisfies:** AC-1",
    "- **Files:**",
    shardLine,
    "- **Test:** `node --test test/gsd-contract.test.js`",
    "- **Status:** superseded",
  ]);
  // The shard rides a prose-only task, so the semantic checkpoint stays undocumented.
  const proseOnlyOwner = appendTask(withSecondCriterion(semantic("prose-owner")), [
    "### T2: Note the change",
    "- **Satisfies:** AC-2",
    "- **Files:**",
    "  - `AGENTS.md` \u2014 modify: record the corrected agent instruction",
    shardLine,
    "- **Test:** `node --test test/gsd-contract.test.js`",
    "- **Status:** pending",
  ]);
  // A valid semantic owner exists, but a later documentation-only task re-owns the shard:
  // its own green checkpoint documents a change it does not make.
  const trailingDocsOwner = appendTask(withSecondCriterion(owned.replace("`owned`", "`trailing-docs`")), [
    "### T2: Restate the change",
    "- **Satisfies:** AC-2",
    "- **Files:**",
    shardLine.replace("record the corrected", "restate the corrected"),
    "- **Test:** `node --test test/gsd-contract.test.js`",
    "- **Status:** pending",
  ]);

  const missing = /must own affected domain shard: docs\/domain\/gsd\.md/;
  const cases = [
    { feature: "owned", content: owned, status: 0 },
    { feature: "reowned", content: reownedPlan, status: 0 },
    { feature: "unowned", content: semantic("unowned"), status: 1, expect: missing },
    { feature: "superseded-owner", content: supersededOwner, status: 1, expect: missing },
    {
      feature: "prose-owner",
      content: proseOnlyOwner,
      status: 1,
      expect: /in a task that also changes the semantic code[\s\S]*T2 does not/,
    },
    {
      feature: "trailing-docs",
      content: trailingDocsOwner,
      status: 1,
      expect: /in a task that also changes the semantic code[\s\S]*T2 does not/,
    },
  ].map((entry) => ({ ...entry, ...makePlanWorkspace(entry.feature, entry.content) }));

  try {
    for (const entry of cases) {
      const result = spawnSync(process.execPath, [CLI, "validate-plan", "--path", entry.planPath], {
        cwd: entry.workspace,
        encoding: "utf8",
      });
      assert.equal(result.status, entry.status, `${entry.feature}: ${result.stdout}${result.stderr}`);
      assert.equal(result.stderr, "");
      if (entry.status === 0) {
        assert.match(result.stdout, /^status: valid\nkind: plan\n/, entry.feature);
      } else {
        assert.match(result.stdout, /^status: error\ncode: invalid-artifact\n/, entry.feature);
        assert.match(result.stdout, entry.expect, entry.feature);
      }
    }
  } finally {
    for (const entry of cases) rmSync(entry.workspace, { recursive: true, force: true });
  }
});


test("legacy path-only task grammar is rejected bound and unbound", () => {
  const plan = canonicalPlan("legacy-task").replace(
    "- **Files:**\n  - `tools/gsd-contract.mjs` — create: expose canonical plan validation",
    "- **Files:** `tools/gsd-contract.mjs`",
  );
  const { workspace, planPath } = makePlanWorkspace("legacy-task", plan);
  try {
    const hash = createHash("sha256").update(plan).digest("hex");
    const unbound = spawnSync(process.execPath, [CLI, "validate-plan", "--path", planPath], {
      cwd: workspace,
      encoding: "utf8",
    });
    const bound = spawnSync(
      process.execPath,
      [CLI, "validate-plan", "--path", planPath, "--expected-sha256", hash],
      { cwd: workspace, encoding: "utf8" },
    );

    assert.equal(unbound.status, 1);
    assert.match(unbound.stdout, /^status: error\ncode: invalid-artifact\n/);
    assert.match(unbound.stdout, /structured task fields must be exactly ordered/);
    assert.equal(unbound.stderr, "");
    assert.equal(bound.status, 1);
    assert.match(bound.stdout, /structured task fields must be exactly ordered/);
    assert.equal(bound.stderr, "");
    assert.equal(readFileSync(planPath, "utf8"), plan);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a plan missing Domain Impact is rejected even when its hash matches", () => {
  const plan = canonicalPlan("no-impact").replace(/## Domain Impact\n(?:- .+\n){5}/, "");
  const { workspace, planPath } = makePlanWorkspace("no-impact", plan);
  try {
    const hash = createHash("sha256").update(plan).digest("hex");
    const bound = spawnSync(
      process.execPath,
      [CLI, "validate-plan", "--path", planPath, "--expected-sha256", hash],
      { cwd: workspace, encoding: "utf8" },
    );

    assert.equal(bound.status, 1);
    assert.match(bound.stdout, /missing Domain Impact section/);
    assert.equal(bound.stderr, "");
    assert.equal(readFileSync(planPath, "utf8"), plan);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("usage and unsafe plan inputs fail through the structured CLI surface", () => {
  const valid = makePlanWorkspace("usage-plan", canonicalPlan("usage-plan"));
  const malformed = makePlanWorkspace("malformed-plan", "# Plan\n");
  const oversized = makePlanWorkspace("oversized-plan", "x".repeat(1024 * 1024 + 1));
  const bom = makePlanWorkspace("bom-plan", `\uFEFF${canonicalPlan("bom-plan")}`);
  const symlinked = makePlanWorkspace("symlink-target", canonicalPlan("symlink-target"));
  const symlinkFeature = join(symlinked.workspace, ".scratch", "symlink-plan");
  mkdirSync(symlinkFeature);
  const symlinkPlan = join(symlinkFeature, "plan.md");
  symlinkSync(symlinked.planPath, symlinkPlan);
  try {
    const cases = [
      {
        args: ["validate-plan", "--path"],
        cwd: valid.workspace,
        status: 2,
        code: "usage",
      },
      {
        args: ["validate-plan", "--path", valid.planPath, "--expected-sha256", "invalid"],
        cwd: valid.workspace,
        status: 2,
        code: "usage",
      },
      {
        args: ["validate-plan", "--path", malformed.planPath],
        cwd: malformed.workspace,
        status: 1,
        code: "invalid-artifact",
      },
      {
        args: ["validate-plan", "--path", oversized.planPath],
        cwd: oversized.workspace,
        status: 1,
        code: "invalid-artifact",
      },
      {
        args: ["validate-plan", "--path", symlinkPlan],
        cwd: symlinked.workspace,
        status: 1,
        code: "invalid-artifact",
      },
      {
        args: ["validate-plan", "--path", bom.planPath],
        cwd: bom.workspace,
        status: 1,
        code: "invalid-artifact",
      },
    ];

    for (const fixture of cases) {
      const result = spawnSync(process.execPath, [CLI, ...fixture.args], {
        cwd: fixture.cwd,
        encoding: "utf8",
      });
      assert.equal(result.status, fixture.status, result.stderr || result.stdout);
      assert.match(result.stdout, new RegExp(`^status: error\\ncode: ${fixture.code}\\n`));
      assert.doesNotMatch(result.stdout, /\n\s+at |Error:/);
      assert.equal(result.stderr, "");
    }
  } finally {
    for (const workspace of [
      valid.workspace,
      malformed.workspace,
      oversized.workspace,
      symlinked.workspace,
      bom.workspace,
    ]) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
});

function quickFixPlan(feature = "quick-fix-plan") {
  return [
    "# Quick-fix Plan",
    "## Feature",
    `\`${feature}\``,
    "## Base",
    "`main`",
    "## Domain Impact",
    "- **Classification:** none",
    "- **Contexts:** none",
    "- **Documentation:** none",
    "- **Broad bootstrap:** not-offered",
    "- **Evidence:** The fixture changes no production term, invariant, workflow, outcome, relationship, policy, or context boundary.",
    "## Tasks",
    "### T1: Apply bounded fix",
    "- **Files:**",
    "  - `src/fix.js` — modify: correct the bounded observable behavior",
    "- **Test:** `node --test test/fix.test.js`",
    "",
  ].join("\n");
}

test("validate-quick-fix enforces its distinct Domain Impact contract", () => {
  const plan = quickFixPlan();
  const valid = makePlanWorkspace("quick-fix-plan", plan);
  const invalidPlan = plan
    .replace("Classification:** none", "Classification:** change-existing-context")
    .replace("Contexts:** none", "Contexts:** gsd")
    .replace("Documentation:** none", "Documentation:** update-existing");
  const invalid = makePlanWorkspace("quick-fix-plan", invalidPlan);
  try {
    const accepted = spawnSync(
      process.execPath,
      [CLI, "validate-quick-fix", "--path", valid.planPath],
      { cwd: valid.workspace, encoding: "utf8" },
    );
    const rejected = spawnSync(
      process.execPath,
      [CLI, "validate-quick-fix", "--path", invalid.planPath],
      { cwd: invalid.workspace, encoding: "utf8" },
    );

    assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
    assert.match(accepted.stdout, /^status: valid\nkind: quick-fix\nfeature: quick-fix-plan\n/);
    assert.match(accepted.stdout, /\ntasks: 1$/);
    assert.equal(accepted.stderr, "");
    assert.equal(rejected.status, 1);
    assert.match(rejected.stdout, /^status: error\ncode: invalid-artifact\n/);
    assert.match(rejected.stdout, /must own affected domain shard/);
    assert.equal(rejected.stderr, "");
  } finally {
    rmSync(valid.workspace, { recursive: true, force: true });
    rmSync(invalid.workspace, { recursive: true, force: true });
  }
});

test("Quick-fix domain shard ownership is enforced per task, not plan-wide", () => {
  const semantic = quickFixPlan()
    .replace("Classification:** none", "Classification:** change-existing-context")
    .replace("Contexts:** none", "Contexts:** gsd")
    .replace("Documentation:** none", "Documentation:** update-existing");

  const codeLine = "  - `src/fix.js` \u2014 modify: correct the bounded observable behavior";
  const shardLine = "  - `docs/domain/gsd.md` \u2014 modify: record the corrected production behavior";

  // One task owns both the code and its affected shard.
  const sameTask = semantic.replace(codeLine, `${codeLine}\n${shardLine}`);
  assert.notEqual(sameTask, semantic);

  // The shard is split into a separate trailing task, so no task owns both.
  const splitTask = semantic.replace(
    "- **Test:** `node --test test/fix.test.js`\n",
    `- **Test:** \`node --test test/fix.test.js\`\n### T2: Document the shard\n- **Files:**\n${shardLine}\n- **Test:** \`node --test test/skills.test.js\`\n`,
  );
  assert.notEqual(splitTask, semantic);

  // A later task pairs the shard with different code, leaving T1's semantic change
  // undocumented at its own green checkpoint.
  const laterCodeTask = semantic.replace(
    "- **Test:** `node --test test/fix.test.js`\n",
    `- **Test:** \`node --test test/fix.test.js\`\n### T2: Adjust the caller\n- **Files:**\n  - \`src/caller.js\` \u2014 modify: pass the corrected value through\n${shardLine}\n- **Test:** \`node --test test/caller.test.js\`\n`,
  );
  assert.notEqual(laterCodeTask, semantic);

  // The shard rides with prose only, so the semantic change stays undocumented.
  const proseOnlyTask = semantic.replace(
    "- **Test:** `node --test test/fix.test.js`\n",
    `- **Test:** \`node --test test/fix.test.js\`\n### T2: Note the change\n- **Files:**\n  - \`AGENTS.md\` \u2014 modify: record the corrected agent instruction\n${shardLine}\n- **Test:** \`node --test test/skills.test.js\`\n`,
  );
  assert.notEqual(proseOnlyTask, semantic);

  // The shard rides with a test-only task while production code lands later, so the
  // first green checkpoint documents behavior that does not exist yet.
  const testOnlyTask = semantic
    .replace(codeLine, `  - \`test/fix.test.js\` \u2014 create: pin the corrected observable behavior\n${shardLine}`)
    .replace(
      "- **Test:** `node --test test/fix.test.js`\n",
      `- **Test:** \`node --test test/fix.test.js\`\n### T2: Correct the source\n- **Files:**\n${codeLine}\n- **Test:** \`node --test test/fix.test.js\`\n`,
    );
  assert.notEqual(testOnlyTask, semantic);

  // A trailing task changes more production code, so its own semantic change lands
  // at a green checkpoint that no shard edit accompanies.
  const trailingCodeTask = sameTask.replace(
    "- **Test:** `node --test test/fix.test.js`\n",
    "- **Test:** `node --test test/fix.test.js`\n### T2: Adjust the caller\n- **Files:**\n  - `src/caller.js` \u2014 modify: pass the corrected value through\n- **Test:** `node --test test/caller.test.js`\n",
  );
  assert.notEqual(trailingCodeTask, sameTask);

  const ownership = /must own affected domain shard/;
  const single = /must change semantic code in exactly one task/;
  const cases = [
    { name: "same-task", content: sameTask, status: 0 },
    { name: "trailing-code-task", content: trailingCodeTask, status: 1, expect: single },
    { name: "test-only-owner", content: testOnlyTask, status: 1, expect: ownership },
    { name: "prose-only-owner", content: proseOnlyTask, status: 1, expect: ownership },
    { name: "split-task", content: splitTask, status: 1, expect: ownership },
    { name: "later-code-task", content: laterCodeTask, status: 1, expect: single },
    { name: "unowned", content: semantic, status: 1, expect: ownership },
  ].map((entry) => ({ ...entry, ...makePlanWorkspace("quick-fix-plan", entry.content) }));

  try {
    for (const entry of cases) {
      const result = spawnSync(
        process.execPath,
        [CLI, "validate-quick-fix", "--path", entry.planPath],
        { cwd: entry.workspace, encoding: "utf8" },
      );
      assert.equal(result.status, entry.status, `${entry.name}: ${result.stdout}${result.stderr}`);
      assert.equal(result.stderr, "");
      if (entry.status === 0) {
        assert.match(result.stdout, /^status: valid\nkind: quick-fix\n/);
      } else {
        assert.match(result.stdout, /^status: error\ncode: invalid-artifact\n/);
        assert.match(result.stdout, entry.expect, entry.name);
      }
    }
  } finally {
    for (const entry of cases) rmSync(entry.workspace, { recursive: true, force: true });
  }
});

test("a Quick-fix naming any design/ path is rejected", () => {
  // A prototype-touching change is by definition not a bounded quick fix: it needs
  // prototype convergence, so the fast path refuses the path instead of gaining a
  // `UI Impact` section it could not enforce.
  const offending = quickFixPlan().replace(
    "  - `src/fix.js` \u2014 modify: correct the bounded observable behavior",
    "  - `design/primitives/button.css` \u2014 modify: correct the bounded observable behavior",
  );
  const nested = quickFixPlan().replace(
    "  - `src/fix.js` \u2014 modify: correct the bounded observable behavior",
    "  - `src/fix.js` \u2014 modify: correct the bounded observable behavior\n  - `design/docs/orders.md` \u2014 modify: record the corrected state",
  );
  const cases = [
    { name: "unrelated quick fix still validates", content: quickFixPlan(), status: 0 },
    {
      name: "sole design path",
      content: offending,
      status: 1,
      expect: /Quick-fix must not touch prototype path: design\/primitives\/button\.css/,
    },
    {
      name: "design path beside production code",
      content: nested,
      status: 1,
      expect: /Quick-fix must not touch prototype path: design\/docs\/orders\.md/,
    },
  ].map((entry) => ({ ...entry, ...makePlanWorkspace("quick-fix-plan", entry.content) }));

  try {
    for (const entry of cases) {
      const result = spawnSync(
        process.execPath,
        [CLI, "validate-quick-fix", "--path", entry.planPath],
        { cwd: entry.workspace, encoding: "utf8" },
      );
      assert.equal(result.status, entry.status, `${entry.name}: ${result.stdout}${result.stderr}`);
      assert.equal(result.stderr, "");
      if (entry.status === 0) {
        assert.match(result.stdout, /^status: valid\nkind: quick-fix\n/, entry.name);
      } else {
        assert.match(result.stdout, /^status: error\ncode: invalid-artifact\n/, entry.name);
        assert.match(result.stdout, entry.expect, entry.name);
      }
    }
  } finally {
    for (const entry of cases) rmSync(entry.workspace, { recursive: true, force: true });
  }
});

test("full-plan UI Impact grammar binds classification, paths, and ownership", () => {
  // `Surfaces` names the production paths a locked prototype converts into, so it is
  // required exactly when the plan claims to reuse a lock. A prototype-authoring packet
  // has no production surface yet and declares `none`.
  const reuse = (plan) =>
    plan
      .replace(
        "## UI Impact\n- **Classification:** none\n- **Surfaces:** none\n- **Prototype:** none",
        "## UI Impact\n- **Classification:** reuse-prototype\n- **Surfaces:** `src/ui/orders.tsx`\n- **Prototype:** `design/docs/orders.md`",
      );

  const cases = [
    {
      name: "canonical none",
      plan: canonicalPlan("ui-none"),
      status: 0,
    },
    {
      name: "canonical reuse",
      plan: reuse(canonicalPlan("ui-reuse")),
      status: 0,
    },
    {
      name: "missing section",
      plan: canonicalPlan("ui-missing").replace(/## UI Impact\n(?:- .+\n){4}/, ""),
      status: 1,
      expect: /missing UI Impact section/,
    },
    {
      name: "unknown classification",
      plan: canonicalPlan("ui-unknown").replace(
        "## UI Impact\n- **Classification:** none",
        "## UI Impact\n- **Classification:** redesign",
      ),
      status: 1,
      expect: /UI Impact Classification is invalid/,
    },
    {
      name: "none carrying surfaces",
      plan: canonicalPlan("ui-none-surfaces").replace(
        "- **Surfaces:** none\n- **Prototype:** none",
        "- **Surfaces:** `src/ui/orders.tsx`\n- **Prototype:** none",
      ),
      status: 1,
      expect: /UI Impact classification none requires Surfaces and Prototype to be none/,
    },
    {
      name: "prototype path outside design/",
      plan: reuse(canonicalPlan("ui-outside")).replace(
        "- **Prototype:** `design/docs/orders.md`",
        "- **Prototype:** `docs/orders.md`",
      ),
      status: 1,
      expect: /UI Impact Prototype path must be under design\/: docs\/orders\.md/,
    },
    {
      name: "unsorted prototype paths",
      plan: reuse(canonicalPlan("ui-unsorted")).replace(
        "- **Prototype:** `design/docs/orders.md`",
        "- **Prototype:** `design/docs/orders.md`, `design/docs/customers.md`",
      ),
      status: 1,
      expect: /UI Impact Prototype must be sorted/,
    },
    {
      name: "duplicate prototype paths",
      plan: reuse(canonicalPlan("ui-duplicate")).replace(
        "- **Prototype:** `design/docs/orders.md`",
        "- **Prototype:** `design/docs/orders.md`, `design/docs/orders.md`",
      ),
      status: 1,
      expect: /UI Impact Prototype must be unique/,
    },
    {
      name: "unsorted surfaces",
      plan: reuse(canonicalPlan("ui-surface-order")).replace(
        "- **Surfaces:** `src/ui/orders.tsx`",
        "- **Surfaces:** `src/ui/orders.tsx`, `src/ui/customers.tsx`",
      ),
      status: 1,
      expect: /UI Impact Surfaces must be sorted/,
    },
    {
      name: "duplicate surfaces",
      plan: reuse(canonicalPlan("ui-surface-dupe")).replace(
        "- **Surfaces:** `src/ui/orders.tsx`",
        "- **Surfaces:** `src/ui/orders.tsx`, `src/ui/orders.tsx`",
      ),
      status: 1,
      expect: /UI Impact Surfaces must be unique/,
    },
    {
      name: "extend-prototype without surfaces validates",
      plan: canonicalPlan("ui-extend-owned")
        .replace(
          "## UI Impact\n- **Classification:** none\n- **Surfaces:** none\n- **Prototype:** none",
          "## UI Impact\n- **Classification:** extend-prototype\n- **Surfaces:** none\n- **Prototype:** `design/docs/orders.md`",
        )
        .replace(
          "  - `tools/gsd-contract.mjs` — create: expose canonical plan validation",
          "  - `tools/gsd-contract.mjs` — create: expose canonical plan validation\n  - `design/docs/orders.md` — modify: extend the order surface states and flows\n  - `design/primitives/order-form.js` — modify: render the extended order states",
        ),
      status: 0,
    },
    {
      name: "reuse without surfaces",
      plan: reuse(canonicalPlan("ui-reuse-bare")).replace(
        "- **Surfaces:** `src/ui/orders.tsx`",
        "- **Surfaces:** none",
      ),
      status: 1,
      expect: /reuse-prototype requires at least one production surface/,
    },
    {
      name: "non-none without prototype",
      plan: canonicalPlan("ui-no-proto").replace(
        "## UI Impact\n- **Classification:** none\n- **Surfaces:** none",
        "## UI Impact\n- **Classification:** new-prototype\n- **Surfaces:** none",
      ),
      status: 1,
      expect: /Surface-changing work requires at least one design\/ prototype path/,
    },
    {
      name: "new-prototype carrying production surfaces",
      plan: canonicalPlan("ui-new-surfaces").replace(
        "## UI Impact\n- **Classification:** none\n- **Surfaces:** none\n- **Prototype:** none",
        "## UI Impact\n- **Classification:** new-prototype\n- **Surfaces:** `src/ui/orders.tsx`\n- **Prototype:** `design/docs/orders.md`",
      ),
      status: 1,
      expect: /new-prototype precedes production conversion and requires Surfaces to be none/,
    },
    {
      name: "new-prototype owning its declared prototype path",
      plan: canonicalPlan("ui-new-owned")
        .replace(
          "## UI Impact\n- **Classification:** none\n- **Surfaces:** none\n- **Prototype:** none",
          "## UI Impact\n- **Classification:** new-prototype\n- **Surfaces:** none\n- **Prototype:** `design/docs/orders.md`",
        )
        .replace(
          "  - `tools/gsd-contract.mjs` — create: expose canonical plan validation",
          "  - `tools/gsd-contract.mjs` — create: expose canonical plan validation\n  - `design/docs/orders.md` — create: lock the order surface states and flows\n  - `design/primitives/order-form.js` — create: render the order surface states",
        ),
      status: 0,
    },
    {
      name: "extend-prototype owning its declared prototype path",
      plan: canonicalPlan("ui-extend-owned")
        .replace(
          "## UI Impact\n- **Classification:** none\n- **Surfaces:** none\n- **Prototype:** none",
          "## UI Impact\n- **Classification:** extend-prototype\n- **Surfaces:** none\n- **Prototype:** `design/docs/orders.md`",
        )
        .replace(
          "  - `tools/gsd-contract.mjs` — create: expose canonical plan validation",
          "  - `tools/gsd-contract.mjs` — create: expose canonical plan validation\n  - `design/docs/orders.md` — modify: add the bulk-edit state to the order surface\n  - `design/primitives/order-form.js` — modify: render the bulk-edit state",
        ),
      status: 0,
    },
    {
      name: "new-prototype with no owning task",
      plan: canonicalPlan("ui-new-orphan").replace(
        "## UI Impact\n- **Classification:** none\n- **Surfaces:** none\n- **Prototype:** none",
        "## UI Impact\n- **Classification:** new-prototype\n- **Surfaces:** none\n- **Prototype:** `design/docs/orders.md`",
      ),
      status: 1,
      expect: /plan must own declared prototype path: design\/docs\/orders\.md/,
    },
    {
      name: "new-prototype owned only by a prose task",
      plan: canonicalPlan("ui-new-prose")
        .replace(
          "## UI Impact\n- **Classification:** none\n- **Surfaces:** none\n- **Prototype:** none",
          "## UI Impact\n- **Classification:** new-prototype\n- **Surfaces:** none\n- **Prototype:** `design/docs/orders.md`",
        )
        .replace(
          "  - `tools/gsd-contract.mjs` — create: expose canonical plan validation",
          "  - `design/docs/orders.md` — create: lock the order surface states and flows",
        ),
      status: 1,
      expect: /in a task that also changes prototype code/,
    },
    // The CLI rejects a plan whose Feature slug differs from its `.scratch/<feature>/`
    // directory, so the workspace name comes from the fixture itself, not the case label.
  ].map((entry) => ({
    ...entry,
    ...makePlanWorkspace(entry.plan.match(/^## Feature\n`([^`]+)`$/m)[1], entry.plan),
  }));

  try {
    for (const entry of cases) {
      const result = spawnSync(process.execPath, [CLI, "validate-plan", "--path", entry.planPath], {
        cwd: entry.workspace,
        encoding: "utf8",
      });
      assert.equal(result.status, entry.status, `${entry.name}: ${result.stdout}${result.stderr}`);
      assert.equal(result.stderr, "");
      if (entry.status === 0) {
        assert.match(result.stdout, /^status: valid\nkind: plan\n/, entry.name);
      } else {
        assert.match(result.stdout, /^status: error\ncode: invalid-artifact\n/, entry.name);
        assert.match(result.stdout, entry.expect, entry.name);
      }
    }
  } finally {
    for (const entry of cases) rmSync(entry.workspace, { recursive: true, force: true });
  }
});

test("lifecycle owners use the production validator and document inert legacy terminals", () => {
  const files = new Map([
    ["reference", readFileSync(join(ROOT, "skills", "gsd", "REFERENCE.md"), "utf8")],
    ["planner", readFileSync(join(ROOT, "skills", "gsd-to-plan", "SKILL.md"), "utf8")],
    ["execution", readFileSync(join(ROOT, "skills", "gsd-executing-plans", "SKILL.md"), "utf8")],
    ["handoff", readFileSync(join(ROOT, "skills", "gsd-handoff", "SKILL.md"), "utf8")],
    ["verify", readFileSync(join(ROOT, "skills", "gsd-verify", "SKILL.md"), "utf8")],
    ["domain", readFileSync(join(ROOT, "docs", "domain", "gsd.md"), "utf8")],
    ["readme", readFileSync(join(ROOT, "README.md"), "utf8")],
  ]);

  assert.match(files.get("reference"), /tools\/gsd-contract\.mjs validate-plan --path/);
  assert.match(files.get("reference"), /--expected-sha256/);
  assert.match(files.get("reference"), /tools\/gsd-contract\.mjs validate-quick-fix --path/);
  assert.match(files.get("planner"), /tools\/gsd-contract\.mjs validate-plan --path/);
  for (const owner of ["execution", "handoff", "verify"]) {
    assert.match(
      files.get(owner),
      /tools\/gsd-contract\.mjs validate-plan --path[\s\S]*--expected-sha256/,
      `${owner} must bind validation to the approved hash`,
    );
  }
  assert.match(files.get("verify"), /tools\/gsd-contract\.mjs validate-quick-fix --path/);
  assert.match(files.get("readme"), /tools\/gsd-contract\.mjs validate-plan --path/);

  const legacyWording = /v1\/v2[\s\S]{0,220}candidate discovery[\s\S]{0,220}inert[\s\S]{0,220}explicit (?:read|`readStateFile`)[\s\S]{0,180}(?:reject|fail closed)/i;
  assert.match(files.get("reference"), legacyWording);
  assert.match(files.get("handoff"), legacyWording);
  assert.match(files.get("domain"), legacyWording);

  for (const content of files.values()) {
    assert.doesNotMatch(content, /test\/support\/markdown-packet\.mjs/);
  }
  assert.equal(existsSync(join(ROOT, "test", "support", "markdown-packet.mjs")), false);
  assert.equal(existsSync(join(ROOT, "lib", "gsd-contract.mjs")), true);
});

function surfaceDoc(name, { claims, rules = [] } = {}) {
  const claimLines = claims === "none"
    ? ["`none`"]
    : claims.map(({ path, intent }) => `- \`${path}\` — ${intent}`);
  return [
    `# Surface: ${name}`,
    "",
    "## States",
    "",
    "| State | Reached when | Renders |",
    "| --- | --- | --- |",
    "| populated | Data exists | The list |",
    "",
    "## Flows",
    "",
    "1. populated: the user opens the list.",
    "",
    "## Production surfaces",
    "",
    ...claimLines,
    ...(rules.length === 0 ? [] : ["", "## Rules", "", ...rules.map((id) => `- ${id}`)]),
    "",
  ].join("\n");
}

function ruleLedger(ids) {
  return [
    "# Interaction rules",
    "",
    "## Rules",
    "",
    ...ids.flatMap((id) => [
      `### ${id}: A rule the ledger records`,
      "",
      "- **Trigger:** An observable condition occurs.",
      "- **Behavior:** The surface responds the same way everywhere.",
      "- **Reason:** A checkable rule beats a preference.",
      "",
    ]),
  ].join("\n");
}

function makeDesignWorkspace(documents) {
  const workspace = mkdtempSync(join(tmpdir(), "gsd-design-"));
  const docsDir = join(workspace, "design", "docs");
  mkdirSync(docsDir, { recursive: true });
  for (const [name, content] of Object.entries(documents)) {
    writeFileSync(join(docsDir, name), content);
  }
  return { workspace, docsPath: "design/docs" };
}

test("validate-design-map emits deterministic TOON for a canonical design map", () => {
  // The map is the durable design-to-production claim: cleanup deletes `.scratch`, so a
  // surface document is the only artifact that survives to be audited against code.
  const documents = {
    "interaction-rules.md": ruleLedger(["IR-1", "IR-2"]),
    "orders.md": surfaceDoc("Orders", {
      claims: [
        { path: "src/ui/orders/list.tsx", intent: "converts the populated and empty states" },
        { path: "src/ui/orders/row.tsx", intent: "converts the per-row actions" },
      ],
      rules: ["IR-1"],
    }),
    "settings.md": surfaceDoc("Settings", {
      claims: [{ path: "src/ui/settings/page.tsx", intent: "converts every settings state" }],
      rules: ["IR-2"],
    }),
  };
  const { workspace, docsPath } = makeDesignWorkspace(documents);
  try {
    const expected = [
      "status: valid",
      "kind: design-map",
      "surfaces: 2",
      "claims: 3",
    ].join("\n");
    const first = spawnSync(process.execPath, [CLI, "validate-design-map", "--path", docsPath], {
      cwd: workspace,
      encoding: "utf8",
    });
    const second = spawnSync(process.execPath, [CLI, "validate-design-map", "--path", docsPath], {
      cwd: workspace,
      encoding: "utf8",
    });

    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.equal(first.stdout, expected);
    assert.equal(first.stderr, "");
    assert.equal(second.stdout, expected, "validation is deterministic across runs");
    // Reading a map never rewrites it.
    for (const [name, content] of Object.entries(documents)) {
      assert.equal(readFileSync(join(workspace, docsPath, name), "utf8"), content, name);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a surface before conversion declares none and still validates", () => {
  // An authored prototype has no production side yet, so `none` is the explicit
  // pre-conversion claim rather than a missing section.
  const { workspace, docsPath } = makeDesignWorkspace({
    "interaction-rules.md": ruleLedger(["IR-1"]),
    "orders.md": surfaceDoc("Orders", { claims: "none" }),
  });
  try {
    const result = spawnSync(process.execPath, [CLI, "validate-design-map", "--path", docsPath], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout, ["status: valid", "kind: design-map", "surfaces: 1", "claims: 0"].join("\n"));
    assert.equal(result.stderr, "");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("validate-design-map rejects every malformed design map without mutating sources", () => {
  // Each workspace carries exactly one defect, so the named failure proves which rule
  // rejected it rather than which check happens to run first.
  const withoutSection = [
    "# Surface: Orders",
    "",
    "## States",
    "",
    "| State | Reached when | Renders |",
    "| --- | --- | --- |",
    "| populated | Data exists | The list |",
    "",
    "## Flows",
    "",
    "1. populated: the user opens the list.",
    "",
  ].join("\n");

  const fixtures = [
    {
      name: "no production surfaces section",
      documents: {
        "interaction-rules.md": ruleLedger(["IR-1"]),
        "orders.md": withoutSection,
      },
      expect: /design\/docs\/orders\.md must declare a ## Production surfaces section/,
    },
    {
      name: "unsorted claims",
      documents: {
        "interaction-rules.md": ruleLedger(["IR-1"]),
        "orders.md": surfaceDoc("Orders", {
          claims: [
            { path: "src/ui/orders/row.tsx", intent: "converts the per-row actions" },
            { path: "src/ui/orders/list.tsx", intent: "converts the populated state" },
          ],
        }),
      },
      expect: /design\/docs\/orders\.md Production surfaces must be sorted[^\\]*src\/ui\/orders\/list\.tsx/,
    },
    {
      name: "duplicate claim inside one document",
      documents: {
        "interaction-rules.md": ruleLedger(["IR-1"]),
        "orders.md": surfaceDoc("Orders", {
          claims: [
            { path: "src/ui/orders/list.tsx", intent: "converts the populated state" },
            { path: "src/ui/orders/list.tsx", intent: "converts the empty state" },
          ],
        }),
      },
      expect: /design\/docs\/orders\.md Production surfaces must be unique: src\/ui\/orders\/list\.tsx/,
    },
    {
      name: "one production path claimed by two documents",
      documents: {
        "interaction-rules.md": ruleLedger(["IR-1"]),
        "orders.md": surfaceDoc("Orders", {
          claims: [{ path: "src/ui/shared/table.tsx", intent: "converts the row layout" }],
        }),
        "settings.md": surfaceDoc("Settings", {
          claims: [{ path: "src/ui/shared/table.tsx", intent: "converts the row layout" }],
        }),
      },
      expect: /production path src\/ui\/shared\/table\.tsx is claimed by both design\/docs\/orders\.md and design\/docs\/settings\.md/,
    },
    {
      name: "claimed path under design/",
      documents: {
        "interaction-rules.md": ruleLedger(["IR-1"]),
        "orders.md": surfaceDoc("Orders", {
          claims: [{ path: "design/prototype/orders.html", intent: "converts the populated state" }],
        }),
      },
      expect: /design\/docs\/orders\.md Production surfaces path must not be under design\/: design\/prototype\/orders\.html/,
    },
    {
      name: "citation the ledger does not record",
      documents: {
        "interaction-rules.md": ruleLedger(["IR-1"]),
        "orders.md": surfaceDoc("Orders", {
          claims: [{ path: "src/ui/orders/list.tsx", intent: "converts the populated state" }],
          rules: ["IR-4"],
        }),
      },
      expect: /design\/docs\/orders\.md cites IR-4, which interaction-rules\.md does not record/,
    },
  ];

  for (const fixture of fixtures) {
    const { workspace, docsPath } = makeDesignWorkspace(fixture.documents);
    try {
      const result = spawnSync(process.execPath, [CLI, "validate-design-map", "--path", docsPath], {
        cwd: workspace,
        encoding: "utf8",
      });
      assert.equal(result.status, 1, `${fixture.name}: ${result.stdout}`);
      assert.match(result.stdout, /^status: error\ncode: invalid-artifact\n/, fixture.name);
      assert.match(result.stdout, fixture.expect, fixture.name);
      assert.doesNotMatch(result.stdout, /\n\s+at |Error:/, fixture.name);
      assert.equal(result.stderr, "", fixture.name);
      for (const [name, content] of Object.entries(fixture.documents)) {
        assert.equal(readFileSync(join(workspace, docsPath, name), "utf8"), content, `${fixture.name}: ${name}`);
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
});

test("validate-design-map rejects a symlinked design directory that escapes the workspace", () => {
  // The relative path check alone passes when `design` itself is a link: the map would then
  // be read from outside the audited repository while claiming to describe it.
  const workspace = mkdtempSync(join(tmpdir(), "gsd-design-host-"));
  const outside = mkdtempSync(join(tmpdir(), "gsd-design-away-"));
  const documents = {
    "interaction-rules.md": ruleLedger(["IR-1"]),
    "orders.md": surfaceDoc("Orders", { claims: "none" }),
  };
  mkdirSync(join(outside, "docs"));
  for (const [name, content] of Object.entries(documents)) {
    writeFileSync(join(outside, "docs", name), content);
  }
  symlinkSync(outside, join(workspace, "design"));
  try {
    const result = spawnSync(process.execPath, [CLI, "validate-design-map", "--path", "design/docs"], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /^status: error\ncode: invalid-artifact\n/);
    assert.match(result.stdout, /design must be a real directory/);
    assert.equal(result.stderr, "");
    for (const [name, content] of Object.entries(documents)) {
      assert.equal(readFileSync(join(outside, "docs", name), "utf8"), content, name);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
