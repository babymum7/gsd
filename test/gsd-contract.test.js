import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyzeWaves, parseQuickFixPlan, readPlanFile } from "../lib/gsd-contract.mjs";

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
    "- **Test:** `bun test test/gsd-contract.test.js`",
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
      "base: main",
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
  const t1Tail = "- **Test:** `bun test test/gsd-contract.test.js`\n- **Status:** pending";
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
    "- **Test:** `bun test test/gsd-contract.test.js`",
    "- **Status:** pending",
  ]);
  // The only shard owner is superseded, so no task that runs ever writes the shard.
  const supersededOwner = appendTask(semantic("superseded-owner"), [
    "### T2: Abandoned documentation pass",
    "- **Satisfies:** AC-1",
    "- **Files:**",
    shardLine,
    "- **Test:** `bun test test/gsd-contract.test.js`",
    "- **Status:** superseded",
  ]);
  // The shard rides a prose-only task, so the semantic checkpoint stays undocumented.
  const proseOnlyOwner = appendTask(withSecondCriterion(semantic("prose-owner")), [
    "### T2: Note the change",
    "- **Satisfies:** AC-2",
    "- **Files:**",
    "  - `AGENTS.md` \u2014 modify: record the corrected agent instruction",
    shardLine,
    "- **Test:** `bun test test/gsd-contract.test.js`",
    "- **Status:** pending",
  ]);
  // A valid semantic owner exists, but a later documentation-only task re-owns the shard:
  // its own green checkpoint documents a change it does not make.
  const trailingDocsOwner = appendTask(withSecondCriterion(owned.replace("`owned`", "`trailing-docs`")), [
    "### T2: Restate the change",
    "- **Satisfies:** AC-2",
    "- **Files:**",
    shardLine.replace("record the corrected", "restate the corrected"),
    "- **Test:** `bun test test/gsd-contract.test.js`",
    "- **Status:** pending",
  ]);
  // `docs/domain/index.md` and `AGENTS.md` follow the same ownership rule as a shard: a
  // doc-only task that owns either changes nothing it describes.
  const indexOnlyOwner = appendTask(withSecondCriterion(owned.replace("`owned`", "`index-only`")), [
    "### T2: Restate the index",
    "- **Satisfies:** AC-2",
    "- **Files:**",
    "  - `docs/domain/index.md` \u2014 modify: keep the index current",
    "- **Test:** `bun test test/gsd-contract.test.js`",
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
    {
      feature: "index-only",
      content: indexOnlyOwner,
      status: 1,
      expect: /docs\/domain\/index\.md[\s\S]*T2 does not/,
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
test("plan-owned durable records enforce NNNN-slug.md and allow prose-only ownership", () => {
  const badRecord = canonicalPlan("bad-record").replace(
    "  - `tools/gsd-contract.mjs` \u2014 create: expose canonical plan validation",
    "  - `docs/decisions/0001_bad-name.md` \u2014 create: record architecture decision",
  );
  const badDesignRecord = canonicalPlan("bad-design").replace(
    "  - `tools/gsd-contract.mjs` \u2014 create: expose canonical plan validation",
    "  - `docs/design/0001_bad_name.md` \u2014 create: record system design",
  );
  const validRecord = canonicalPlan("valid-record").replace(
    "  - `tools/gsd-contract.mjs` \u2014 create: expose canonical plan validation",
    "  - `docs/decisions/0001-tech-stack.md` \u2014 create: record architecture decision",
  );
  const validDesignRecord = canonicalPlan("valid-design").replace(
    "  - `tools/gsd-contract.mjs` \u2014 create: expose canonical plan validation",
    "  - `docs/design/0042-system-architecture.md` \u2014 create: record system design",
  );

  const cases = [
    {
      feature: "bad-record",
      content: badRecord,
      status: 1,
      expect: /durable record path must match.*NNNN-slug\.md/,
    },
    {
      feature: "bad-design",
      content: badDesignRecord,
      status: 1,
      expect: /durable record path must match.*NNNN-slug\.md/,
    },
    {
      feature: "valid-record",
      content: validRecord,
      status: 0,
    },
    {
      feature: "valid-design",
      content: validDesignRecord,
      status: 0,
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
  // repo-relative `bun tools/gsd-contract.mjs` here re-teaches exactly the form that never
  // resolves outside this checkout. The CLI knows where it was loaded from, so it names that
  // absolute path instead of a placeholder no shell expands.
  const { workspace } = makePlanWorkspace("cli-help", "# Plan\n");
  try {
    const surfaces = [
      { label: "help", args: ["validate-plan", "--help"], status: 0 },
      { label: "usage", args: ["validate-plan"], status: 2 },
      { label: "unknown-command", args: ["validate-nothing"], status: 2 },
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
        /bun tools\/gsd-contract\.mjs/,
        `${surface.label} must not instruct a repo-relative invocation`,
      );
      assert.ok(
        invocation.startsWith(`bun ${JSON.stringify(CLI)}`),
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
        // Optional flags are documented in brackets; a copy-run drops all of them.
        .replace(/ \[[^\]]+\]/g, "");
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
    "- **Test:** `bun test test/fix.test.js`",
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

// `plan.md` § Base and `state.toon` `base_ref` are two records of one decision. Prose alone
// let them drift, so a packet could stay hash-bound to a plan naming base A while the merge
// gate read base B out of state and squashed there.
test("a bound call rejects a plan whose base differs from the recorded base_ref", () => {
  const cases = [
    { command: "validate-plan", feature: "bound-base", build: canonicalPlan },
    { command: "validate-quick-fix", feature: "bound-base-qf", build: quickFixPlan },
  ];
  for (const { command, feature, build } of cases) {
    const plan = build(feature).replace("`main`", "`release/2026`");
    const { workspace, planPath } = makePlanWorkspace(feature, plan);
    try {
      const agreed = spawnSync(
        process.execPath,
        [CLI, command, "--path", planPath, "--expected-base", "release/2026"],
        { cwd: workspace, encoding: "utf8" },
      );
      assert.equal(agreed.status, 0, `${command} must accept a matching base: ${agreed.stdout}${agreed.stderr}`);
      assert.match(agreed.stdout, /^base: release\/2026$/m);

      const drifted = spawnSync(
        process.execPath,
        [CLI, command, "--path", planPath, "--expected-base", "main"],
        { cwd: workspace, encoding: "utf8" },
      );
      assert.equal(drifted.status, 1, `${command} must reject a drifted base: ${drifted.stdout}`);
      assert.match(drifted.stdout, /^code: invalid-artifact$/m);
      // Resume branches on this phrase to stop instead of rebinding, so it is a contract.
      assert.match(drifted.stdout, /plan base release\/2026 does not match recorded base_ref main/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
});

// Resume separates moved bytes from malformed grammar by revalidating without the bound hash.
// If that call dropped the base check, a base mismatch would come back clean and be rebound as
// an ordinary amendment — silently retargeting the merge. The base check is hash-independent.
test("an unbound revalidation still rejects a drifted base", () => {
  const feature = "unbound-base";
  const plan = canonicalPlan(feature).replace("`main`", "`release/2026`");
  const { workspace, planPath } = makePlanWorkspace(feature, plan);
  try {
    const result = spawnSync(
      process.execPath,
      [CLI, "validate-plan", "--path", planPath, "--expected-base", "main"],
      { cwd: workspace, encoding: "utf8" },
    );
    assert.equal(result.status, 1, `an unbound call must still check the base: ${result.stdout}`);
    assert.match(result.stdout, /does not match recorded base_ref main/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

// The base is interpolated into Git commands, so a value Git would read as an option or a
// range must be rejected by the grammar itself, with no expected base supplied.
test("a base that is not a usable Git branch name is rejected", () => {
  const feature = "unsafe-base";
  for (const base of ["--force", "a..b", "feature/", ".hidden", "trailing.lock", "has space"]) {
    const plan = canonicalPlan(feature).replace("`main`", `\`${base}\``);
    const { workspace, planPath } = makePlanWorkspace(feature, plan);
    try {
      const result = spawnSync(process.execPath, [CLI, "validate-plan", "--path", planPath], {
        cwd: workspace,
        encoding: "utf8",
      });
      assert.equal(result.status, 1, `base ${base} must be rejected: ${result.stdout}`);
      assert.match(result.stdout, /^code: invalid-artifact$/m);
      assert.match(result.stdout, /Base must be a Git branch name able to receive the merge/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
});

// A usage error must name the flag rather than fail deep inside validation.
test("--expected-base rejects a malformed value and a repeat as usage errors", () => {
  const feature = "base-usage";
  const { workspace, planPath } = makePlanWorkspace(feature, canonicalPlan(feature));
  try {
    for (const args of [
      ["--expected-base", "not a branch"],
      ["--expected-base", "-main"],
      ["--expected-base", "main..wip"],
      ["--expected-base", "main", "--expected-base", "main"],
      ["--expected-base"],
    ]) {
      const result = spawnSync(process.execPath, [CLI, "validate-plan", "--path", planPath, ...args], {
        cwd: workspace,
        encoding: "utf8",
      });
      assert.equal(result.status, 2, `${args.join(" ")} must be a usage error: ${result.stdout}`);
      assert.match(result.stdout, /--expected-base/);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
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

test("inaccessible feature directory is an environment failure while missing directory is malformed authority", () => {
  const readable = quickFixPlan("io-dir-denied");
  const denied = makePlanWorkspace("io-dir-denied", readable);
  const missing = makePlanWorkspace("io-missing-dir", quickFixPlan("io-missing-dir"));
  const scratchDir = join(denied.workspace, ".scratch");
  const missingDir = join(missing.workspace, ".scratch", "io-missing-dir");
  rmSync(missingDir, { recursive: true, force: true });
  chmodSync(scratchDir, 0o000);
  try {
    const cases = [
      {
        entry: denied,
        code: "io-error",
        expect: /feature directory cannot be inspected: EACCES|plan file cannot be read/,
      },
      {
        entry: missing,
        code: "invalid-artifact",
        expect: /feature directory cannot be inspected: ENOENT/,
      },
    ];
    for (const command of ["validate-quick-fix", "validate-plan"]) {
      for (const fixture of cases) {
        const result = spawnSync(
          process.execPath,
          [CLI, command, "--path", fixture.entry.planPath],
          { cwd: fixture.entry.workspace, encoding: "utf8" },
        );
        assert.equal(result.status, 1, `${command} ${fixture.code}: ${result.stdout}${result.stderr}`);
        assert.match(result.stdout, new RegExp(`^status: error\\ncode: ${fixture.code}\\n`));
        assert.match(result.stdout, fixture.expect);
        assert.doesNotMatch(result.stdout, /\n\s+at |Error:/);
        assert.equal(result.stderr, "");
      }
    }
  } finally {
    chmodSync(scratchDir, 0o755);
    for (const workspace of [denied.workspace, missing.workspace]) {
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
    "- **Test:** `bun test test/fix.test.js`\n",
    `- **Test:** \`bun test test/fix.test.js\`\n### T2: Document the shard\n- **Files:**\n${shardLine}\n- **Test:** \`bun test test/skills.test.js\`\n`,
  );
  assert.notEqual(splitTask, semantic);

  // A later task pairs the shard with different code, leaving T1's semantic change
  // undocumented at its own green checkpoint.
  const laterCodeTask = semantic.replace(
    "- **Test:** `bun test test/fix.test.js`\n",
    `- **Test:** \`bun test test/fix.test.js\`\n### T2: Adjust the caller\n- **Files:**\n  - \`src/caller.js\` \u2014 modify: pass the corrected value through\n${shardLine}\n- **Test:** \`bun test test/caller.test.js\`\n`,
  );
  assert.notEqual(laterCodeTask, semantic);

  // The shard rides with prose only, so the semantic change stays undocumented.
  const proseOnlyTask = semantic.replace(
    "- **Test:** `bun test test/fix.test.js`\n",
    `- **Test:** \`bun test test/fix.test.js\`\n### T2: Note the change\n- **Files:**\n  - \`AGENTS.md\` \u2014 modify: record the corrected agent instruction\n${shardLine}\n- **Test:** \`bun test test/skills.test.js\`\n`,
  );
  assert.notEqual(proseOnlyTask, semantic);

  // The shard rides with a test-only task while production code lands later, so the
  // first green checkpoint documents behavior that does not exist yet.
  const testOnlyTask = semantic
    .replace(codeLine, `  - \`test/fix.test.js\` \u2014 create: pin the corrected observable behavior\n${shardLine}`)
    .replace(
      "- **Test:** `bun test test/fix.test.js`\n",
      `- **Test:** \`bun test test/fix.test.js\`\n### T2: Correct the source\n- **Files:**\n${codeLine}\n- **Test:** \`bun test test/fix.test.js\`\n`,
    );
  assert.notEqual(testOnlyTask, semantic);

  // A trailing task changes more production code, so its own semantic change lands
  // at a green checkpoint that no shard edit accompanies.
  const trailingCodeTask = sameTask.replace(
    "- **Test:** `bun test test/fix.test.js`\n",
    "- **Test:** `bun test test/fix.test.js`\n### T2: Adjust the caller\n- **Files:**\n  - `src/caller.js` \u2014 modify: pass the corrected value through\n- **Test:** `bun test test/caller.test.js`\n",
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
      /bun tools\/gsd-contract\.mjs/,
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
  // `bun tools/gsd-contract.mjs` resolves against the wrong root and never reaches the
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
        "base: main",
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
    assert.match(repoRelative.stderr, /Module not found/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function wavePlan(feature, tasks) {
  const acTitles = new Map();
  for (const [index, task] of tasks.entries()) {
    const id = task.satisfies ?? `AC-${index + 1}`;
    if (!acTitles.has(id)) acTitles.set(id, task.ac);
  }
  const criteria = [...acTitles.entries()]
    .map(
      ([id, title]) =>
        [
          `### ${id}: Analyze ${title}`,
          "- **State:** active",
          "- **Outcome:** The task criterion is proven.",
          "- **Action:** Run the focused check.",
          "- **Expected:** The check reports green.",
        ].join("\n"),
    )
    .join("\n");
  const interfaces = [...acTitles.keys()]
    .map((id) => `| ${id} | production validator CLI | \`tools/gsd-contract.mjs\` | none |`)
    .join("\n");
  const taskBlocks = tasks
    .map(
      (task, index) =>
        [
          `### T${index + 1}: ${task.title}`,
          `- **Satisfies:** ${task.satisfies ?? `AC-${index + 1}`}`,
          "- **Files:**",
          `  - \`${task.file}\` — create: implement the task`,
          `- **Test:** \`${task.test}\``,
          `- **Status:** ${task.status ?? "pending"}`,
        ].join("\n"),
    )
    .join("\n");
  return [
    "# Plan",
    "## Feature",
    `\`${feature}\``,
    "## Base",
    "`main`",
    "## Summary",
    "Exercise parallel wave analysis.",
    "## Context",
    "gsd",
    "## Domain Impact",
    "- **Classification:** none",
    "- **Contexts:** none",
    "- **Documentation:** none",
    "- **Broad bootstrap:** not-offered",
    "- **Evidence:** This fixture changes no production term, invariant, workflow, outcome, relationship, policy, or context boundary.",
    "## Scope",
    "- Validate wave analysis.",
    "## Acceptance Criteria",
    criteria,
    "## Decisions",
    "None.",
    "## Invariants",
    "- **I-1:** Wave analysis never mutates the plan.",
    "## Non-goals",
    "- **NG-1:** No execution happens here.",
    "## Interfaces",
    "| Criterion | Seam | Path | Lower-seam reason |",
    "| --- | --- | --- | --- |",
    interfaces,
    "## Publication",
    "null",
    "## Tasks",
    taskBlocks,
    "",
  ].join("\n");
}

function runWaves(planPath, workspace, extraArgs = []) {
  return spawnSync(process.execPath, [CLI, "analyze-waves", "--path", planPath, ...extraArgs], {
    cwd: workspace,
    encoding: "utf8",
  });
}

test("analyze-waves groups file- and check-disjoint tasks into one parallel wave", () => {
  const plan = wavePlan("wave-join", [
    { title: "A", ac: "A", file: "src/a.js", test: "bun test test/a.test.js" },
    { title: "B", ac: "B", file: "src/b.js", test: "bun test test/b.test.js" },
    { title: "C", ac: "C", file: "src/c.js", test: "bun test test/c.test.js" },
  ]);
  const { workspace, planPath } = makePlanWorkspace("wave-join", plan);
  try {
    const result = runWaves(planPath, workspace);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^status: valid\nkind: plan\nfeature: wave-join\n/);
    assert.match(result.stdout, /waves: T1,T2,T3$/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("analyze-waves splits waves on shared files and shared checks", () => {
  const plans = [
    {
      name: "shared-file",
      tasks: [
        { title: "A", ac: "A", file: "src/a.js", test: "bun test test/a.test.js" },
        { title: "B", ac: "B", file: "src/b.js", test: "bun test test/b.test.js" },
        { title: "C", ac: "C", file: "src/a.js", test: "bun test test/c.test.js" },
        { title: "D", ac: "D", file: "src/d.js", test: "bun test test/d.test.js" },
      ],
      waves: "T1,T2|T3,T4",
    },
    {
      name: "shared-check",
      tasks: [
        { title: "A", ac: "A", file: "src/a.js", test: "bun test test/a.test.js" },
        { title: "B", ac: "B", file: "src/b.js", test: "bun test test/a.test.js" },
        { title: "C", ac: "C", file: "src/c.js", test: "bun test test/c.test.js" },
      ],
      waves: "T1|T2,T3",
    },
  ];
  for (const entry of plans) {
    const plan = wavePlan(`wave-${entry.name}`, entry.tasks);
    const { workspace, planPath } = makePlanWorkspace(`wave-${entry.name}`, plan);
    try {
      const result = runWaves(planPath, workspace);
      assert.equal(result.status, 0, `${entry.name}: ${result.stderr || result.stdout}`);
      assert.match(result.stdout, new RegExp(`waves: ${entry.waves.replaceAll(".", "\\.")}$`), entry.name);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
});

test("analyze-waves skips superseded tasks without letting them break a wave", () => {
  // T2 is superseded and shares a file with T1; if it participated it would split the
  // wave, so the surviving active tasks T1, T3, T4 must still group together.
  const plan = wavePlan("wave-superseded", [
    { title: "A", ac: "A", file: "src/a.js", test: "bun test test/a.test.js", status: "pending" },
    { title: "B", ac: "B", file: "src/a.js", test: "bun test test/b.test.js", status: "superseded" },
    { title: "C", ac: "B", file: "src/c.js", test: "bun test test/c.test.js", status: "pending", satisfies: "AC-2" },
    { title: "D", ac: "C", file: "src/b.js", test: "bun test test/b.test.js", status: "pending", satisfies: "AC-3" },
  ]);
  const { workspace, planPath } = makePlanWorkspace("wave-superseded", plan);
  try {
    const result = runWaves(planPath, workspace);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /waves: T1,T3,T4$/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("analyze-waves accepts the bound hash and fails closed on drift", () => {
  const plan = wavePlan("wave-bound", [
    { title: "A", ac: "A", file: "src/a.js", test: "bun test test/a.test.js" },
    { title: "B", ac: "B", file: "src/b.js", test: "bun test test/b.test.js" },
  ]);
  const { workspace, planPath } = makePlanWorkspace("wave-bound", plan);
  try {
    const bound = runWaves(planPath, workspace, ["--expected-sha256", createHash("sha256").update(plan).digest("hex")]);
    assert.equal(bound.status, 0, bound.stderr || bound.stdout);
    assert.match(bound.stdout, /waves: T1,T2$/);

    const drifted = runWaves(planPath, workspace, ["--expected-sha256", "a".repeat(64)]);
    assert.equal(drifted.status, 1);
    assert.match(drifted.stdout, /code: invalid-artifact/);
    assert.match(drifted.stdout, /hash mismatch after approval/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("analyze-waves rejects quick-fix grammar and enforces usage", () => {
  const quickFix = [
    "# Quick-fix Plan",
    "## Feature",
    "`wave-quick`",
    "## Base",
    "`main`",
    "## Domain Impact",
    "- **Classification:** none",
    "- **Contexts:** none",
    "- **Documentation:** none",
    "- **Broad bootstrap:** not-offered",
    "- **Evidence:** This fix changes no production term, invariant, workflow, outcome, relationship, policy, or context boundary.",
    "## Tasks",
    "### T1: Fix the value",
    "- **Files:**",
    "  - `src/a.js` — modify: correct the value",
    "- **Test:** `bun test test/a.test.js`",
    "",
  ].join("\n");
  const { workspace, planPath } = makePlanWorkspace("wave-quick", quickFix);
  try {
    const rejected = runWaves(planPath, workspace);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stdout, /code: invalid-artifact/);

    const missing = spawnSync(process.execPath, [CLI, "analyze-waves"], { cwd: workspace, encoding: "utf8" });
    assert.equal(missing.status, 2);
    assert.match(missing.stdout, /code: usage/);

    const help = spawnSync(process.execPath, [CLI, "analyze-waves", "--help"], { cwd: workspace, encoding: "utf8" });
    assert.equal(help.status, 0, help.stderr || help.stdout);
    assert.match(help.stdout, /analyze-waves/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an amended plan allows superseded tasks to reference superseded criteria while live tasks satisfy active criteria", () => {
  const buildAmended = (feature = "amended-plan") => {
    return canonicalPlan(feature)
      .replace("- **State:** active", "- **State:** superseded")
      .replace(
        "## Decisions",
        [
          "### AC-2: Validate amended plan",
          "- **State:** active",
          "- **Outcome:** The amended plan is accepted through the production command.",
          "- **Action:** Run the validator against the plan fixture.",
          "- **Expected:** The command reports the feature and exact source hash.",
          "## Decisions",
        ].join("\n"),
      )
      .replace(
        "| AC-1 | production validator CLI | `tools/gsd-contract.mjs` | none |",
        "| AC-2 | production validator CLI | `tools/gsd-contract.mjs` | none |",
      )
      .replace(
        "- **Status:** pending",
        [
          "- **Status:** superseded",
          "### T2: Validate amended plan",
          "- **Satisfies:** AC-2",
          "- **Files:**",
          "  - `lib/gsd-contract.mjs` — modify: accept superseded task criterion references",
          "- **Test:** `bun test test/gsd-contract.test.js`",
          "- **Status:** pending",
        ].join("\n"),
      );
  };

  const validAmended = buildAmended("valid-amended");
  const { workspace: w1, planPath: p1 } = makePlanWorkspace("valid-amended", validAmended);
  try {
    const result = spawnSync(process.execPath, [CLI, "validate-plan", "--path", p1], {
      cwd: w1,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /^status: valid\nkind: plan\nfeature: valid-amended\n/);
    assert.match(result.stdout, /tasks: 2/);
  } finally {
    rmSync(w1, { recursive: true, force: true });
  }

  const liveReferencingSuperseded = buildAmended("live-superseded").replace(
    "- **Satisfies:** AC-2",
    "- **Satisfies:** AC-1",
  );
  const { workspace: w2, planPath: p2 } = makePlanWorkspace("live-superseded", liveReferencingSuperseded);
  try {
    const result = spawnSync(process.execPath, [CLI, "validate-plan", "--path", p2], {
      cwd: w2,
      encoding: "utf8",
    });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /^status: error\ncode: invalid-artifact\n/);
    assert.match(result.stdout, /must satisfy an active criterion/);
  } finally {
    rmSync(w2, { recursive: true, force: true });
  }

  const unknownCriterion = buildAmended("unknown-criterion").replace(
    "- **Satisfies:** AC-2",
    "- **Satisfies:** AC-9",
  );
  const { workspace: w3, planPath: p3 } = makePlanWorkspace("unknown-criterion", unknownCriterion);
  try {
    const result = spawnSync(process.execPath, [CLI, "validate-plan", "--path", p3], {
      cwd: w3,
      encoding: "utf8",
    });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /^status: error\ncode: invalid-artifact\n/);
    assert.match(result.stdout, /unknown criterion/);
  } finally {
    rmSync(w3, { recursive: true, force: true });
  }
});

test("analyzeWaves groups criteria-less parsed tasks by file and check disjointness without raising", () => {
  const task1 = {
    id: "T1",
    title: "Task 1",
    fileIntents: [{ path: "src/a.js", operation: "modify", intent: "modify a" }],
    files: ["src/a.js"],
    test: "bun test test/a.test.js",
  };
  const task2 = {
    id: "T2",
    title: "Task 2",
    fileIntents: [{ path: "src/b.js", operation: "modify", intent: "modify b" }],
    files: ["src/b.js"],
    test: "bun test test/b.test.js",
  };
  const task3SameFile = {
    id: "T3",
    title: "Task 3",
    fileIntents: [{ path: "src/a.js", operation: "modify", intent: "modify a again" }],
    files: ["src/a.js"],
    test: "bun test test/c.test.js",
  };
  const task4SameCheck = {
    id: "T4",
    title: "Task 4",
    fileIntents: [{ path: "src/d.js", operation: "modify", intent: "modify d" }],
    files: ["src/d.js"],
    test: "bun test test/b.test.js",
  };
  const task5NoCheck = {
    id: "T5",
    title: "Task 5",
    fileIntents: [{ path: "src/e.js", operation: "modify", intent: "modify e" }],
    files: ["src/e.js"],
    test: "none",
  };
  const task6NoCheck = {
    id: "T6",
    title: "Task 6",
    fileIntents: [{ path: "src/f.js", operation: "modify", intent: "modify f" }],
    files: ["src/f.js"],
    test: "none",
  };

  // Disjoint criteria-less tasks share one wave
  const disjointWaves = analyzeWaves([task1, task2]);
  assert.deepEqual(disjointWaves, [{ tasks: ["T1", "T2"] }]);

  // Overlapping files split into separate waves
  const overlappingFileWaves = analyzeWaves([task1, task3SameFile]);
  assert.deepEqual(overlappingFileWaves, [{ tasks: ["T1"] }, { tasks: ["T3"] }]);

  // Overlapping checks split into separate waves
  const overlappingCheckWaves = analyzeWaves([task2, task4SameCheck]);
  assert.deepEqual(overlappingCheckWaves, [{ tasks: ["T2"] }, { tasks: ["T4"] }]);

  // Criteria-less tasks with test: "none" share a wave when files are disjoint
  const noCheckWaves = analyzeWaves([task5NoCheck, task6NoCheck]);
  assert.deepEqual(noCheckWaves, [{ tasks: ["T5", "T6"] }]);

  // Multi-task grouping
  const multiWaves = analyzeWaves([task1, task2, task3SameFile]);
  assert.deepEqual(multiWaves, [{ tasks: ["T1", "T2"] }, { tasks: ["T3"] }]);
});

test("Quick-fix shard ownership treats __tests__/ and spec/ as observation-only test paths", () => {
  const semantic = quickFixPlan()
    .replace("Classification:** none", "Classification:** change-existing-context")
    .replace("Contexts:** none", "Contexts:** gsd")
    .replace("Documentation:** none", "Documentation:** update-existing");

  const codeLine = "  - `src/fix.js` — modify: correct the bounded observable behavior";
  const shardLine = "  - `docs/domain/gsd.md` — modify: record the corrected production behavior";

  const makeFixture = (testPath) =>
    semantic
      .replace(codeLine, `  - \`${testPath}\` — create: pin the corrected observable behavior\n${shardLine}`)
      .replace(
        "- **Test:** `bun test test/fix.test.js`\n",
        `- **Test:** \`bun test test/fix.test.js\`\n### T2: Correct the source\n- **Files:**\n${codeLine}\n- **Test:** \`bun test test/fix.test.js\`\n`,
      );

  const testsCase = makeFixture("__tests__/x.js");
  const specCase = makeFixture("spec/x.js");
  const controlCase = semantic.replace(codeLine, `${codeLine}\n${shardLine}`);

  assert.throws(
    () => parseQuickFixPlan({ "plan.md": testsCase }),
    /must own affected domain shard.*docs\/domain\/gsd\.md/i,
  );
  assert.throws(
    () => parseQuickFixPlan({ "plan.md": specCase }),
    /must own affected domain shard.*docs\/domain\/gsd\.md/i,
  );

  const parsed = parseQuickFixPlan({ "plan.md": controlCase });
  assert.equal(parsed.feature, "quick-fix-plan");
  assert.equal(parsed.tasks.length, 1);
});

test("semantic validator failures attach actionable remediation help lines", () => {
  // 1. Multi-AC interface pin conflict: T1 satisfies AC-1 and AC-2, but AC-1 is CLI and AC-2 is other seam
  const pinConflictPlan = canonicalPlan("pin-conflict")
    .replace(
      "### AC-1: Validate canonical plan\n- **State:** active\n- **Outcome:** The canonical plan is accepted through the production command.\n- **Action:** Run the validator against the plan fixture.\n- **Expected:** The command reports the feature and exact source hash.",
      "### AC-1: Validate canonical plan\n- **State:** active\n- **Outcome:** The canonical plan is accepted through the production command.\n- **Action:** Run the validator against the plan fixture.\n- **Expected:** The command reports the feature and exact source hash.\n### AC-2: Second criterion\n- **State:** active\n- **Outcome:** The second criterion is accepted.\n- **Action:** Run the second check.\n- **Expected:** The second check reports success.",
    )
    .replace(
      "| AC-1 | production validator CLI | `tools/gsd-contract.mjs` | none |",
      "| AC-1 | production validator CLI | `tools/gsd-contract.mjs` | none |\n| AC-2 | other seam | `tools/other.mjs` | none |",
    )
    .replace(
      "- **Satisfies:** AC-1\n- **Files:**\n  - `tools/gsd-contract.mjs` — create: expose canonical plan validation",
      "- **Satisfies:** AC-1, AC-2\n- **Files:**\n  - `tools/gsd-contract.mjs` — create: expose canonical plan validation\n  - `tools/other.mjs` — create: other helper",
    );

  const { workspace: pinWs, planPath: pinPlanPath } = makePlanWorkspace("pin-conflict", pinConflictPlan);

  // 2. Field-ordering failure in task fields
  const fieldOrderPlan = canonicalPlan("field-order")
    .replace(
      "- **Satisfies:** AC-1\n- **Files:**\n  - `tools/gsd-contract.mjs` — create: expose canonical plan validation\n- **Test:** `bun test test/gsd-contract.test.js`\n- **Status:** pending",
      "- **Satisfies:** AC-1\n- **Test:** `bun test test/gsd-contract.test.js`\n- **Files:**\n  - `tools/gsd-contract.mjs` — create: expose canonical plan validation\n- **Status:** pending",
    );

  const { workspace: orderWs, planPath: orderPlanPath } = makePlanWorkspace("field-order", fieldOrderPlan);

  try {
    const pinResult = spawnSync(process.execPath, [CLI, "validate-plan", "--path", pinPlanPath], {
      cwd: pinWs,
      encoding: "utf8",
    });
    assert.equal(pinResult.status, 1);
    assert.match(pinResult.stdout, /^status: error\ncode: invalid-artifact\n/);
    assert.match(pinResult.stdout, /Task T1 satisfies multiple ACs but their interface pins/);
    assert.match(pinResult.stdout, /AC-1 and AC-2 conflict/);
    assert.match(pinResult.stdout, /^help: ".*make the interface rows identical or split the task into two tasks.*"$/m);

    const orderResult = spawnSync(process.execPath, [CLI, "validate-plan", "--path", orderPlanPath], {
      cwd: orderWs,
      encoding: "utf8",
    });
    assert.equal(orderResult.status, 1);
    assert.match(orderResult.stdout, /^status: error\ncode: invalid-artifact\n/);
    assert.match(orderResult.stdout, /structured task fields must be exactly ordered: Satisfies, Files, Test, Status/);
    assert.match(orderResult.stdout, /^help: ".*reorder fields to match the canonical order.*"$/m);
  } finally {
    rmSync(pinWs, { recursive: true, force: true });
    rmSync(orderWs, { recursive: true, force: true });
  }
});

test("semantic validator failures attach concrete remediation help lines across representative failure classes", () => {
  // 1. Required-field class: missing/empty Summary field
  const missingFieldPlan = canonicalPlan("missing-summary")
    .replace("## Summary\nValidate one canonical GSD plan through the production command.", "## Summary\n");
  const { workspace: fieldWs, planPath: fieldPlanPath } = makePlanWorkspace("missing-summary", missingFieldPlan);

  // 2. Unsafe-path class: traversal path in task files
  const unsafePathPlan = canonicalPlan("unsafe-path")
    .replace(
      "- `tools/gsd-contract.mjs` — create: expose canonical plan validation",
      "- `../tools/gsd-contract.mjs` — create: expose canonical plan validation",
    );
  const { workspace: pathWs, planPath: pathPlanPath } = makePlanWorkspace("unsafe-path", unsafePathPlan);

  // 3. Domain-impact class: unsorted Contexts list
  const unsortedContextsPlan = canonicalPlan("unsorted-contexts")
    .replace(
      "- **Classification:** none\n- **Contexts:** none\n- **Documentation:** none\n- **Broad bootstrap:** not-offered\n- **Evidence:** This validation fixture changes no production term, invariant, workflow, outcome, relationship, policy, or context boundary.",
      "- **Classification:** change-existing-context\n- **Contexts:** zebra-context, alpha-context\n- **Documentation:** update-existing\n- **Broad bootstrap:** not-offered\n- **Evidence:** This validation fixture updates domain docs for zebra and alpha contexts.",
    )
    .replace(
      "- `tools/gsd-contract.mjs` — create: expose canonical plan validation",
      "- `tools/gsd-contract.mjs` — create: expose canonical plan validation\n  - `docs/domain/zebra-context.md` — modify: update zebra docs\n  - `docs/domain/alpha-context.md` — modify: update alpha docs",
    );
  const { workspace: domainWs, planPath: domainPlanPath } = makePlanWorkspace("unsorted-contexts", unsortedContextsPlan);

  // 4. Bound-hash mismatch via CLI spawn
  const validPlan = canonicalPlan("hash-mismatch");
  const { workspace: hashWs, planPath: hashPlanPath } = makePlanWorkspace("hash-mismatch", validPlan);

  // 5. Base mismatch via CLI spawn
  const basePlan = canonicalPlan("base-mismatch");
  const { workspace: baseWs, planPath: basePlanPath } = makePlanWorkspace("base-mismatch", basePlan);

  try {
    // 1. Required-field test
    const fieldResult = spawnSync(process.execPath, [CLI, "validate-plan", "--path", fieldPlanPath], {
      cwd: fieldWs,
      encoding: "utf8",
    });
    assert.equal(fieldResult.status, 1);
    assert.match(fieldResult.stdout, /^status: error\ncode: invalid-artifact\n/);
    assert.match(fieldResult.stdout, /^help: "add content under ## Summary"$/m);
    // 2. Unsafe-path test
    const pathResult = spawnSync(process.execPath, [CLI, "validate-plan", "--path", pathPlanPath], {
      cwd: pathWs,
      encoding: "utf8",
    });
    assert.equal(pathResult.status, 1);
    assert.match(pathResult.stdout, /^status: error\ncode: invalid-artifact\n/);
    assert.match(pathResult.stdout, /contains dot\/traversal/);
    assert.match(pathResult.stdout, /^help: "use one repository-relative path without backslashes, dot segments, \.scratch, or \.toon"$/m);

    // 3. Domain-impact unsorted contexts test
    const domainResult = spawnSync(process.execPath, [CLI, "validate-plan", "--path", domainPlanPath], {
      cwd: domainWs,
      encoding: "utf8",
    });
    assert.equal(domainResult.status, 1);
    assert.match(domainResult.stdout, /^status: error\ncode: invalid-artifact\n/);
    assert.match(domainResult.stdout, /Domain Impact Contexts must be sorted/);
    assert.match(domainResult.stdout, /^help: ".*sort contexts alphabetically in ascending order.*"$/m);

    // 4. Bound-hash mismatch via CLI spawn
    const hashResult = spawnSync(
      process.execPath,
      [CLI, "validate-plan", "--path", hashPlanPath, "--expected-sha256", "0000000000000000000000000000000000000000000000000000000000000000"],
      {
        cwd: hashWs,
        encoding: "utf8",
      },
    );
    assert.equal(hashResult.status, 1);
    assert.match(hashResult.stdout, /^status: error\ncode: invalid-artifact\n/);
    assert.match(hashResult.stdout, /hash mismatch after approval/);
    assert.match(hashResult.stdout, /^help: ".*revalidate unbound and rebind through the amendment flow, never silently overwrite.*"$/m);

    // 5. Base mismatch via CLI spawn
    const baseResult = spawnSync(
      process.execPath,
      [CLI, "validate-plan", "--path", basePlanPath, "--expected-base", "other-base-branch"],
      {
        cwd: baseWs,
        encoding: "utf8",
      },
    );
    assert.equal(baseResult.status, 1);
    assert.match(baseResult.stdout, /^status: error\ncode: invalid-artifact\n/);
    assert.match(baseResult.stdout, /does not match recorded base_ref/);
    assert.match(baseResult.stdout, /^help: ".*align --expected-base with plan § Base.*"$/m);
  } finally {
    rmSync(fieldWs, { recursive: true, force: true });
    rmSync(pathWs, { recursive: true, force: true });
    rmSync(domainWs, { recursive: true, force: true });
    rmSync(hashWs, { recursive: true, force: true });
    rmSync(baseWs, { recursive: true, force: true });
  }
});

test("normalize-plan reports surface-form defects as a reviewable patch without touching the file (AC-2)", () => {
  const defectivePlan = canonicalPlan("defective-feature")
    .replace("## Feature\n`defective-feature`", "## Feature\ndefective-feature")
    .replace("- **Status:** pending\n", "- **Status:** pending   \n");

  const { workspace, planPath } = makePlanWorkspace("defective-feature", defectivePlan);
  const relPath = join(".scratch", "defective-feature", "plan.md");
  try {
    const beforeBytes = readFileSync(planPath);
    const result = spawnSync(process.execPath, [CLI, "normalize-plan", "--path", relPath], {
      cwd: workspace,
      encoding: "utf8",
    });
    const afterBytes = readFileSync(planPath);

    assert.equal(result.status, 0);
    assert.match(result.stdout, new RegExp(`^--- a/${relPath.replace(/\./g, "\\.")}\\n\\+\\+\\+ b/${relPath.replace(/\./g, "\\.")}\\n`));
    assert.match(result.stdout, /-defective-feature\n\+`defective-feature`/);
    assert.match(result.stdout, /-- \*\*Status:\*\* pending   \n\+- \*\*Status:\*\* pending/);
    assert.deepEqual(afterBytes, beforeBytes);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("normalize-plan --write converges a defective plan to canonical form idempotently (AC-3)", () => {
  const defectivePlan = canonicalPlan("converging-feature")
    .replace("## Feature\n`converging-feature`", "## Feature\nconverging-feature")
    .replace("## Base\n`main`", "## Base\nmain")
    .replace("- **Status:** pending\n", "- **Status:** pending   \n");

  const { workspace, planPath } = makePlanWorkspace("converging-feature", defectivePlan);
  const relPath = join(".scratch", "converging-feature", "plan.md");
  try {
    // First run with --write rewrites the file with fixed bytes
    const firstRun = spawnSync(process.execPath, [CLI, "normalize-plan", "--path", relPath, "--write"], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.equal(firstRun.status, 0);
    assert.equal(firstRun.stdout, "");

    const fixedBytes = readFileSync(planPath, "utf8");
    assert.match(fixedBytes, /## Feature\n`converging-feature`\n/);
    assert.match(fixedBytes, /## Base\n`main`\n/);
    assert.match(fixedBytes, /- \*\*Status:\*\* pending\n/);
    assert.doesNotMatch(fixedBytes, /pending   /);

    // Second run reports zero fixes and does not alter file
    const secondRun = spawnSync(process.execPath, [CLI, "normalize-plan", "--path", relPath, "--write"], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.equal(secondRun.status, 0);
    assert.equal(secondRun.stdout, "");

    const secondBytes = readFileSync(planPath, "utf8");
    assert.equal(secondBytes, fixedBytes);

    // validate-plan accepts the normalized plan
    const validateResult = spawnSync(process.execPath, [CLI, "validate-plan", "--path", relPath], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.equal(validateResult.status, 0);
    assert.match(validateResult.stdout, /^status: valid\nkind: plan\nfeature: converging-feature\nbase: main\n/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("normalize-plan on a clean canonical plan reports zero fixes", () => {
  const cleanPlan = canonicalPlan("clean-feature");
  const { workspace } = makePlanWorkspace("clean-feature", cleanPlan);
  const relPath = join(".scratch", "clean-feature", "plan.md");
  try {
    const dryRun = spawnSync(process.execPath, [CLI, "normalize-plan", "--path", relPath], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.equal(dryRun.status, 0);
    assert.equal(dryRun.stdout, "");

    const writeRun = spawnSync(process.execPath, [CLI, "normalize-plan", "--path", relPath, "--write"], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.equal(writeRun.status, 0);
    assert.equal(writeRun.stdout, "");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("normalize-plan enforces usage and rejects unknown flags or unreadable files", () => {
  const { workspace } = makePlanWorkspace("usage-feature", canonicalPlan("usage-feature"));
  const relPath = join(".scratch", "usage-feature", "plan.md");
  try {
    // Missing --path
    const missingPath = spawnSync(process.execPath, [CLI, "normalize-plan"], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.equal(missingPath.status, 2);
    assert.match(missingPath.stdout, /^status: error\ncode: usage\n/);

    // Unknown flag --expected-sha256
    const unexpectedSha = spawnSync(process.execPath, [CLI, "normalize-plan", "--path", relPath, "--expected-sha256", "a".repeat(64)], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.equal(unexpectedSha.status, 2);
    assert.match(unexpectedSha.stdout, /^status: error\ncode: usage\n/);

    // Missing file
    const missingFile = spawnSync(process.execPath, [CLI, "normalize-plan", "--path", ".scratch/non-existent/plan.md"], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.equal(missingFile.status, 1);
    assert.match(missingFile.stdout, /^status: error\ncode: invalid-artifact\n/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("normalize-plan proposes and fixes missing terminal newline with no-newline marker", () => {
  const cleanPlan = canonicalPlan("missing-newline");
  const noNewlinePlan = cleanPlan.endsWith("\n") ? cleanPlan.slice(0, -1) : cleanPlan;
  const { workspace, planPath } = makePlanWorkspace("missing-newline", noNewlinePlan);
  const relPath = join(".scratch", "missing-newline", "plan.md");
  try {
    const dryRun = spawnSync(process.execPath, [CLI, "normalize-plan", "--path", relPath], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.equal(dryRun.status, 0);
    assert.match(dryRun.stdout, new RegExp(`^--- a/${relPath.replace(/\./g, "\\.")}\\n\\+\\+\\+ b/${relPath.replace(/\./g, "\\.")}\\n`));
    assert.match(dryRun.stdout, /\\ No newline at end of file/);

    const writeRun = spawnSync(process.execPath, [CLI, "normalize-plan", "--path", relPath, "--write"], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.equal(writeRun.status, 0);
    assert.equal(writeRun.stdout, "");

    const fixedBytes = readFileSync(planPath, "utf8");
    assert.ok(fixedBytes.endsWith("\n"));

    const secondRun = spawnSync(process.execPath, [CLI, "normalize-plan", "--path", relPath, "--write"], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.equal(secondRun.status, 0);
    assert.equal(secondRun.stdout, "");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("T1: readPlanFile reads plan through pinned directory chain and rejects directory swap", () => {
  const feature = "pinned-read-test";
  const plan = canonicalPlan(feature);
  const { workspace, planPath } = makePlanWorkspace(feature, plan);
  try {
    const result = readPlanFile(planPath, { cwd: workspace });
    assert.equal(result.content, plan);
    assert.equal(result.feature, feature);
    assert.equal(result.path, planPath);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
