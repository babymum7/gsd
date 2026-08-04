import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalPacket, structuredPacket, FILES_BLOCK, filesBlockWith, T1_BLOCK, INTERFACE_ROW,
  replaceOnce, read, skillNames, visibleSkillNames, filesUnder, markdownFiles,
  parseAgentFrontmatter, ROOT, SKILLS,
} from "./support/skills-fixtures.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  bindApprovedSources, parseMarkdownPacket, parseQuickFixPlan, rejectLegacyPreapprovalFiles,
  sha256, verifyApprovedSources, validateSectionEdges,
} from "../lib/gsd-contract.mjs";
import {
  parseActivationResponse, responseMatchesFixture, selectEvalBackend, validateActivationTarget,
  validateFixtureSet,
} from "./eval/activation-eval-contract.mjs";
import gsdContextExtension, { CAPSULE_TEMPLATE } from "../extensions/gsd-context.js";

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
  assert.match(reference, /The `<resume_instruction>` is a single string/i);
  assert.match(reference, /Some features are omitted from this list/i);
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

// The `## Base` field and `base_ref` were both required with no rule for deriving the
// value, so a worktree session recorded the repository default and the terminal gate
// offered to merge into `main` instead of the branch the packet was actually cut from.
test("base is derived from the work tree and owns the merge target", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");

  assert.match(reference, /### Base derivation and merge target/);
  assert.match(reference, /base is read from the work tree at packet creation, never assumed/);
  assert.match(reference, /git rev-parse --abbrev-ref HEAD/);
  assert.match(reference, /linked worktree is checked out on its own branch, so that branch is the base/);
  assert.match(reference, /detached HEAD records the commit oid/);
  assert.match(reference, /terminal squash merges into exactly the recorded `base_ref`/);
  assert.match(reference, /`main` is the merge target only when `main` is the recorded base/);
  assert.match(reference, /Never ask whether to merge into `main`/);

  // The planner captures it; the terminal gate consumes it. Neither may fall back to a default.
  assert.match(planner, /Read § Base from the work tree, never from convention/);
  assert.match(planner, /git rev-parse --abbrev-ref HEAD/);
  assert.match(verify, /merge target is exactly the recorded `state\.toon` `base_ref`/);
  assert.match(verify, /never ask whether to merge into `main`/);
  assert.match(verify, /Promoting that base onward is separate user-owned work/);
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
