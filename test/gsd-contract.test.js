import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

test("the CLI names a runnable invocation in every help and error surface", () => {
  // Help text is the most operative instruction an owner sees after a mis-invocation, so a
  // repo-relative `node tools/gsd-contract.mjs` here re-teaches exactly the form that never
  // resolves outside this checkout. The CLI knows where it was loaded from, so it names that
  // absolute path instead of a placeholder no shell expands.
  const { workspace, planPath } = makePlanWorkspace("cli-help", "# Plan\n");
  try {
    const surfaces = [
      { label: "help", args: ["validate-plan", "--help"], status: 0 },
      { label: "usage", args: ["validate-plan"], status: 2 },
      { label: "unknown-command", args: ["validate-nothing"], status: 2 },
      { label: "artifact", args: ["validate-plan", "--path", planPath], status: 1 },
    ];
    for (const surface of surfaces) {
      const result = spawnSync(process.execPath, [CLI, ...surface.args], {
        cwd: workspace,
        encoding: "utf8",
      });
      assert.equal(result.status, surface.status, result.stderr || result.stdout);
      // Every field stays JSON-quoted, so the invocation is read back through the same
      // decode a consumer performs rather than matched against escaped bytes.
      const field = result.stdout.split("\n").find((line) => /^(?:usage|help): /.test(line));
      assert.ok(field, `${surface.label} must carry a usage or help field`);
      const invocation = JSON.parse(field.slice(field.indexOf(": ") + 2));
      assert.doesNotMatch(
        invocation,
        /node tools\/gsd-contract\.mjs/,
        `${surface.label} must not instruct a repo-relative invocation`,
      );
      assert.ok(
        invocation.startsWith(`node ${JSON.stringify(CLI)}`),
        `${surface.label} must name the resolved absolute script path, got ${invocation}`,
      );
    }

    // The documented form is only workspace-independent if it actually runs from a foreign
    // cwd, so the decoded help line is copy-run verbatim against a real packet.
    const valid = makePlanWorkspace("cli-copy-run", canonicalPlan("cli-copy-run"));
    try {
      const help = spawnSync(process.execPath, [CLI, "validate-plan", "--help"], {
        cwd: valid.workspace,
        encoding: "utf8",
      });
      const usage = JSON.parse(help.stdout.match(/^usage: (.+)$/m)[1]);
      const copied = usage
        .replace(".scratch/<feature>/plan.md", join(".scratch", "cli-copy-run", "plan.md"))
        .replace(" [--expected-sha256 <64-hex>]", "");
      const ran = spawnSync(copied, { cwd: valid.workspace, encoding: "utf8", shell: true });
      assert.equal(ran.status, 0, ran.stderr || ran.stdout);
      assert.match(ran.stdout, /^status: valid\nkind: plan\nfeature: cli-copy-run\n/);
    } finally {
      rmSync(valid.workspace, { recursive: true, force: true });
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
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

// A worktree session plans on the worktree's own branch, so the base is whatever is
// checked out — never a hardcoded default. The validator must accept any such base and
// reject only the packet's own WIP branch, which would leave the squash no merge target.
test("both grammars accept a non-default base and reject a self-referencing one", () => {
  const cases = [
    { command: "validate-plan", feature: "worktree-base", build: canonicalPlan },
    { command: "validate-quick-fix", feature: "worktree-base-qf", build: quickFixPlan },
  ];
  for (const { command, feature, build } of cases) {
    const worktreeBase = build(feature).replace("`main`", "`worktree-onboarding`");
    const accepted = makePlanWorkspace(feature, worktreeBase);
    try {
      const result = spawnSync(process.execPath, [CLI, command, "--path", accepted.planPath], {
        cwd: accepted.workspace,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, `${command} must accept a worktree base: ${result.stdout}${result.stderr}`);
    } finally {
      rmSync(accepted.workspace, { recursive: true, force: true });
    }

    const selfBase = build(feature).replace("`main`", `\`wip/${feature}\``);
    const rejected = makePlanWorkspace(feature, selfBase);
    try {
      const result = spawnSync(process.execPath, [CLI, command, "--path", rejected.planPath], {
        cwd: rejected.workspace,
        encoding: "utf8",
      });
      assert.equal(result.status, 1, `${command} must reject a self-referencing base: ${result.stdout}`);
      assert.match(result.stdout, /^status: error\ncode: invalid-artifact\n/);
      assert.match(result.stdout, new RegExp(`never its own WIP branch wip/${feature}`));
    } finally {
      rmSync(rejected.workspace, { recursive: true, force: true });
    }
  }
});

// An unreadable file is the environment failing, not the author writing a bad packet.
// Collapsing both into `invalid-artifact` would send an owner to rewrite authority that
// is actually fine, so the two classes stay distinguishable at the CLI surface.
test("an unreadable plan is an environment failure, not malformed authority", () => {
  const readable = quickFixPlan("io-denied");
  const denied = makePlanWorkspace("io-denied", readable);
  const malformed = makePlanWorkspace("io-malformed", "# Quick-fix Plan\n");
  chmodSync(denied.planPath, 0o000);
  try {
    const cases = [
      { entry: denied, code: "io-error", expect: /plan file cannot be read/ },
      {
        entry: malformed,
        code: "invalid-artifact",
        expect: /must be followed directly by the first ## section/,
      },
    ];
    for (const fixture of cases) {
      const result = spawnSync(
        process.execPath,
        [CLI, "validate-quick-fix", "--path", fixture.entry.planPath],
        { cwd: fixture.entry.workspace, encoding: "utf8" },
      );
      assert.equal(result.status, 1, `${fixture.code}: ${result.stdout}${result.stderr}`);
      assert.match(result.stdout, new RegExp(`^status: error\\ncode: ${fixture.code}\\n`));
      assert.match(result.stdout, fixture.expect);
      assert.doesNotMatch(result.stdout, /\n\s+at |Error:/);
      assert.equal(result.stderr, "");
    }
    chmodSync(denied.planPath, 0o644);
    assert.equal(readFileSync(denied.planPath, "utf8"), readable);
    assert.equal(readFileSync(malformed.planPath, "utf8"), "# Quick-fix Plan\n");
  } finally {
    chmodSync(denied.planPath, 0o644);
    for (const workspace of [denied.workspace, malformed.workspace]) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
});

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

  // The lifecycle runs in workspaces that are not this checkout, so an owner that copies a
  // repo-relative path never reaches the CLI. Authority documents carry the injected root
  // substituted into an absolute path, and the bare form must not come back anywhere.
  const absolutePlan = /"<GSD_ROOT>\/tools\/gsd-contract\.mjs" validate-plan --path/;
  const absoluteQuickFix = /"<GSD_ROOT>\/tools\/gsd-contract\.mjs" validate-quick-fix --path/;
  assert.match(files.get("reference"), absolutePlan);
  assert.match(files.get("reference"), /--expected-sha256/);
  assert.match(files.get("reference"), absoluteQuickFix);
  assert.match(files.get("planner"), absolutePlan);
  for (const owner of ["execution", "handoff", "verify"]) {
    assert.match(
      files.get(owner),
      /"<GSD_ROOT>\/tools\/gsd-contract\.mjs" validate-plan --path[\s\S]*--expected-sha256/,
      `${owner} must bind validation to the approved hash`,
    );
  }
  assert.match(files.get("verify"), absoluteQuickFix);
  assert.match(files.get("readme"), absolutePlan);
  for (const [label, content] of files) {
    assert.doesNotMatch(
      content,
      /node tools\/gsd-contract\.mjs/,
      `${label} must not instruct a repo-relative validator invocation`,
    );
  }

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


test("the validator resolves a foreign workspace by absolute script path", () => {
  // The lifecycle runs in workspaces that are not this checkout, where a repo-relative
  // `node tools/gsd-contract.mjs` resolves against the wrong root and never reaches the
  // CLI. Packet resolution is already `cwd`-relative, so the absolute script path is the
  // whole fix: this pins both halves so the documented form cannot regress to the bare one.
  const plan = canonicalPlan("foreign-workspace");
  const { workspace } = makePlanWorkspace("foreign-workspace", plan);
  const relativePlan = join(".scratch", "foreign-workspace", "plan.md");
  try {
    const absolute = spawnSync(process.execPath, [CLI, "validate-plan", "--path", relativePlan], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.equal(absolute.status, 0, absolute.stderr || absolute.stdout);
    assert.equal(
      absolute.stdout,
      [
        "status: valid",
        "kind: plan",
        "feature: foreign-workspace",
        `sha256: ${createHash("sha256").update(plan).digest("hex")}`,
        "tasks: 1",
      ].join("\n"),
    );
    assert.equal(absolute.stderr, "");

    // The form every authority document used to carry, run from the workspace it would
    // actually run in: the interpreter never loads a CLI, so no exit code or TOON failure
    // shape is reachable and an owner reads a module error instead of a verdict.
    const repoRelative = spawnSync(
      process.execPath,
      [join("tools", "gsd-contract.mjs"), "validate-plan", "--path", relativePlan],
      { cwd: workspace, encoding: "utf8" },
    );
    assert.notEqual(repoRelative.status, 0);
    assert.equal(repoRelative.stdout, "");
    assert.match(repoRelative.stderr, /Cannot find module/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
