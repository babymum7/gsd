import { test } from "bun:test";
import assert from "node:assert/strict";
import { read, skillNames, filesUnder, ROOT } from "./support/skills-fixtures.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
  assert.match(reference, /`docs\/domain\/index\.md`[\s\S]{0,160}(?:suppresses|suppress|do not offer)[\s\S]{0,160}broad/i);
});


test("domain modeling keeps preapproval writes current-only and reads affected shards only", () => {
  const brainstorm = read("skills/gsd-brainstorming/SKILL.md");
  const modeler = read("skills/gsd-domain-modeling/SKILL.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");

  assert.doesNotMatch(modeler, /Write target behavior before binding/i);
  assert.match(modeler, /Before binding[\s\S]{0,180}return[\s\S]{0,120}exact affected paths[\s\S]{0,180}write no target behavior/i);
  assert.match(modeler, /unrelated mappings[\s\S]{0,180}metadata[\s\S]{0,180}never read unrelated shard bodies/i);
  assert.match(brainstorm, /Before binding[\s\S]{0,200}exact affected paths[\s\S]{0,160}writes no future behavior/i);
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

test("T7: the domain shard records the shipped harness-fit behavior", () => {
  const domain = read("docs/domain/gsd.md");

  // D-3 gives this shard one owning task, so every semantic change this feature
  // shipped must be readable as current production behavior here, not only in the
  // authority documents the tasks edited.
  const invocation = domain.split("\n").find((line) => /^- The Contract Validator is reached/.test(line));
  assert.ok(invocation, "the shard records how the validator is reached");
  assert.match(invocation, /absolute path/, "the validator is reached by an absolute path");
  assert.match(invocation, /injected bootstrap root/, "the path is resolved from the injected root");
  assert.match(invocation, /workspaces that are not the GSD checkout/, "the absolute form serves foreign workspaces");

  const failure = domain.split("\n").find((line) => /^- An unreadable artifact/.test(line));
  assert.ok(failure, "the shard records the failure-class split");
  assert.match(failure, /could not read a file/, "the split names the unreadable-file class");
  assert.match(failure, /malformed authority/, "the split names the malformed-authority class");
  assert.match(failure, /never one collapsed status/, "the two classes stay distinguishable");

  const delegation = domain.split("\n").find((line) => /^- An injected orchestration/.test(line));
  assert.ok(delegation, "the shard records the delegation bound");
  assert.match(delegation, /read-only research/i, "bounded research delegation stays permitted");
  assert.match(delegation, /no authority|carries no authority/i, "a delegated result carries no authority");

  const mirror = domain.split("\n").find((line) => /^- Execution mirrors/.test(line));
  assert.ok(mirror, "the shard records the progress mirror");
  assert.match(mirror, /`state\.toon`/, "the mirror names the resumable authority it never displaces");
  assert.match(mirror, /display/i, "the mirror is display state");

  const recovery = domain.split("\n").find((line) => /^- Lifecycle recovery restores/.test(line));
  assert.ok(recovery, "the shard records the recovery exclusion");
  assert.match(recovery, /rewind/i, "the exclusion names conversation rewind");
  assert.match(recovery, /working tree|committed WIP/i, "the exclusion names the tree the rewind leaves behind");

  const policy = domain.split(/^### P-gsd-16: /m)[1]?.split(/^### /m)[0];
  assert.ok(policy, "the shard records the harness-boundary policy");
  assert.match(policy, /- \*\*Policy:\*\*/, "the policy states its rule");
  assert.match(policy, /- \*\*Reason:\*\*/, "the policy states its reason");
  assert.match(policy, /`state\.toon`/, "the policy keeps runtime authority canonical");
});

test("T8: the domain shard and AGENTS.md record the durable decision and design surfaces", () => {
  const domain = read("docs/domain/gsd.md");
  assert.match(domain, /Durable Decision Record/);
  assert.match(domain, /Durable Design Record/);
  assert.match(domain, /docs\/decisions\/NNNN-slug\.md/);
  assert.match(domain, /docs\/design\/NNNN-slug\.md/);
  assert.match(domain, /minimal header/);
  assert.match(domain, /sequential and gap-free per directory/);
  assert.match(domain, /proves every owned record before the squash/);

  const agents = read("AGENTS.md");
  assert.equal(agents.match(/^## Domain documentation$/gm)?.length, 1);
  assert.equal(agents.match(/^## Decisions$/gm)?.length, 1);
  assert.equal(agents.match(/^## Design$/gm)?.length, 1);
  assert.match(agents, /docs\/decisions\/NNNN-slug\.md/);
  assert.match(agents, /docs\/design\/NNNN-slug\.md/);
});
