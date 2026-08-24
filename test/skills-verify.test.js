import { test } from "bun:test";
import assert from "node:assert/strict";
import { read, markdownFiles, ROOT, SKILLS } from "./support/skills-fixtures.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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
  assert.match(reference, /goals[\s\S]{0,160}approved authority[\s\S]{0,160}status[\s\S]{0,160}terminal verification/i);
  assert.doesNotMatch(domain, /local spec/i);
});

test("AC-4: Cross-references, None. explicit, repair evidence not duplicated, and renderer serialization", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.match(execution, /A "None\." decisions block[\s\S]{0,100}explicit empty decisions marker/i);
  assert.match(reference, /Decisions[\s\S]{0,120}`None\.`[\s\S]{0,120}(?:sequential\s+)?D(?:-\d+)? blocks/i);
  assert.match(execution, /rerun only checks[\s\S]{0,60}invalidated by the repair/i);
  assert.match(reference, /serialized once only[\s\S]{0,60}without repeating/i);
  assert.match(reference, /`<resume_instruction>`[\s\S]{0,120}single string/i);
  assert.match(reference, /omitted from this list[\s\S]{0,10}stop and select exactly one active feature before resuming/i);
});

test("archive terminal disposition contract", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  assert.match(reference, /Terminal scratch disposition/);
  assert.match(reference, /docs\/gsd\/<feature>\/archive\/plan\.md/);
  assert.match(reference, /docs\/gsd\/<feature>\/archive\/implementation\.md/);
  assert.match(reference, /same green[\s\S]{0,160}(?:one-feature\/one-squash|one-squash) commit/i);
  assert.match(reference, /archive destination already exists[\s\S]{0,120}fail closed/i);
  assert.match(reference, /terminal-cleanup-owned[\s\S]{0,120}lifecycle paths[\s\S]{0,160}changed-path ownership proof/i);
  assert.match(verify, /canonical archive destinations[\s\S]{0,60}terminal-cleanup-owned lifecycle paths/i);
  assert.match(verify, /every other changed path[\s\S]{0,40}must be task-owned/i);
  assert.match(verify, /phase=merged-cleanup-pending/);
  assert.doesNotMatch(reference, /automatically archive every completed feature/i);
});

test("AC-1: Fast TDD is mandatory for observable tasks", () => {
  const tdd = read("skills/gsd-tdd/SKILL.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.match(execution, /Every observable task[\s\S]{0,40}loads? `gsd-tdd`/i);
  assert.match(execution, /RED before implementation[\s\S]{0,60}GREEN after implementation[\s\S]{0,60}refactor after green/i);
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
  assert.match(execution, /Only after every non-superseded task[\s\S]{0,60}Fast TDD Check is green/i);
  assert.match(execution, /deterministic cumulative conformance[\s\S]{0,60}Deferred Slow E2E/i);
  assert.match(verify, /deterministic cumulative conformance[\s\S]{0,60}Deferred Slow E2E/i);
  assert.match(verify, /Deferred Slow E2E suite[\s\S]{0,60}after current-commit conformance/i);
  assert.match(verify, /full slow\/E2E GREEN[\s\S]{0,60}same unchanged commit/i);
  assert.match(reference, /Green unchanged bytes[\s\S]{0,160}one-squash merge[\s\S]{0,120}cleanup/i);
  assert.match(reference, /Deferred Slow E2E[\s\S]{0,160}(?:after|follows)[\s\S]{0,160}current-commit conformance/i);
});

// The `## Base` field and `base_ref` were both required with no rule for deriving the
// value, so a worktree session recorded the repository default and the terminal gate
// offered to merge into `main` instead of the branch the packet was actually cut from.
// The base must also stay a branch: a commit oid can receive no squash.
test("base is derived from the work tree and owns the merge target", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");

  // Derivation is an executable contract now: both records name the tool, and only the canon
  // still names the plumbing, to explain which Git form is correct and why.
  const DERIVATION = /tools\/gsd-git\.mjs" derive-base/;
  const PREFLIGHT = /tools\/gsd-git\.mjs" preflight --feature-dir \.scratch\/<feature>/;

  assert.match(reference, /### Base derivation and merge target/);
  assert.match(reference, DERIVATION);
  assert.match(reference, /git symbolic-ref --quiet --short HEAD/);
  assert.match(reference, /`code:\s*detached-head`[\s\S]{0,200}fails packet creation closed[\s\S]{0,160}commit oid/i);
  assert.match(reference, /linked worktree[\s\S]{0,160}records its own branch/i);
  assert.match(reference, /base[\s\S]{0,120}never[\s\S]{0,80}`wip\/<feature>`/i);
  assert.match(reference, /terminal squash[\s\S]{0,160}merges into[\s\S]{0,120}`base_ref`/i);
  assert.match(reference, /`main`[\s\S]{0,120}merge target[\s\S]{0,120}only when `main` is that base/i);
  assert.match(reference, /never ask[\s\S]{0,120}merge into `main`/i);
  // Two records of one decision only stay consistent if the bound call compares them.
  assert.match(reference, /--expected-base <base_ref>/);
  // The gate must run the check, and a blocked check must stop it rather than pick a target.
  assert.match(reference, PREFLIGHT);
  assert.match(reference, /blocked gate[\s\S]{0,160}never retargets the merge/i);
  assert.match(reference, /no Git subcommand[\s\S]{0,160}change a repository/i);
  // A squash commits the whole index, so the gate must prove the reviewed tree is committed.
  assert.match(reference, /`dirty-worktree`[\s\S]{0,200}staged, modified, and untracked[\s\S]{0,160}`\.scratch\//i);
  // Git names only a rename's destination first, so counting one record hid a staged deletion.
  assert.match(reference, /rename or copy[\s\S]{0,160}counts both[\s\S]{0,160}moving[\s\S]{0,160}`\.scratch\/`[\s\S]{0,120}blocks/i);

  // The planner captures it; the terminal gate consumes it. Neither may fall back to a default.
  assert.match(planner, /Read `plan\.md` § Base[\s\S]{0,60}work tree[\s\S]{0,60}never from convention/i);
  assert.match(planner, DERIVATION);
  assert.match(planner, /`code:\s*detached-head`[\s\S]{0,80}stops packet creation[\s\S]{0,60}checks out a branch/i);
  assert.match(verify, /merge target is exactly[\s\S]{0,60}recorded `state\.toon` `base_ref`/i);
  assert.match(verify, PREFLIGHT);
  assert.match(verify, /only `status: ready` proceeds/);
  assert.match(verify, /no path outside `\.scratch\/`[\s\S]{0,60}(?:staged, modified, or untracked|staged)/i);
  assert.match(verify, /stops the gate[\s\S]{0,40}instead of retargeting the merge/i);
  assert.match(verify, /never ask[\s\S]{0,40}merge into `main`/i);
  assert.match(verify, /Promoting that base onward[\s\S]{0,60}separate user-owned work/i);

  // `git rev-parse --abbrev-ref HEAD` prints the literal `HEAD` when detached, so every
  // mention of that form must stay inside prose explaining why it is not the derivation.
  for (const [name, body] of [["reference", reference], ["planner", planner], ["verify", verify]]) {
    for (const hit of body.match(/git rev-parse --abbrev-ref HEAD/g) ?? []) {
      assert.match(
        body,
        /prints the literal `HEAD`/,
        `${name} names ${hit} without stating that it fails on detached HEAD`,
      );
    }
  }
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
  assert.match(verify, /focused-check evidence[\s\S]{0,60}unchanged current commit/i);
});
