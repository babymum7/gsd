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

test("bound legacy plan is accepted only after its exact hash matches", () => {
  const plan = canonicalPlan("bound-legacy").replace(
    /## Domain Impact\n(?:- .+\n){5}/,
    "",
  );
  const { workspace, planPath } = makePlanWorkspace("bound-legacy", plan);
  try {
    const hash = createHash("sha256").update(plan).digest("hex");
    const unbound = spawnSync(process.execPath, [CLI, "validate-plan", "--path", planPath], {
      cwd: workspace,
      encoding: "utf8",
    });
    const mismatched = spawnSync(
      process.execPath,
      [CLI, "validate-plan", "--path", planPath, "--expected-sha256", "0".repeat(64)],
      { cwd: workspace, encoding: "utf8" },
    );
    const bound = spawnSync(
      process.execPath,
      [CLI, "validate-plan", "--path", planPath, "--expected-sha256", hash],
      { cwd: workspace, encoding: "utf8" },
    );

    assert.equal(unbound.status, 1);
    assert.match(unbound.stdout, /^status: error\ncode: invalid-artifact\n/);
    assert.match(unbound.stdout, /missing Domain Impact section/);
    assert.equal(unbound.stderr, "");
    assert.equal(mismatched.status, 1);
    assert.match(mismatched.stdout, /hash mismatch after approval/);
    assert.equal(mismatched.stderr, "");
    assert.equal(bound.status, 0, bound.stderr || bound.stdout);
    assert.match(bound.stdout, /^status: valid\nkind: plan\nfeature: bound-legacy\n/);
    assert.match(bound.stdout, new RegExp(`sha256: ${hash}`));
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
