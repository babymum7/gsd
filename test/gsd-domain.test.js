import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  parseAgentsDomainSection,
  parseDomainIndex,
  parseDomainScope,
} from "../lib/gsd-domain.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "tools", "gsd-domain.mjs");

function indexContent(rows) {
  return [
    "# Domain Model",
    "",
    "## Scopes",
    "",
    "| Scope | File | Purpose |",
    "| --- | --- | --- |",
    ...rows.map(([scope, purpose]) => `| ${scope} | \`${scope}.md\` | ${purpose} |`),
  ].join("\n") + "\n";
}

function shardContent(scope, { terms = [["Settlement", "A definition.", "an avoid phrase"]], policies = [["1", "A policy"]] } = {}) {
  const lines = [
    "# Domain Scope",
    "",
    "## Scope",
    "",
    `\`${scope}\``,
    "",
    "## Purpose and responsibilities",
    "",
    "Own the scope.",
    "",
    "## Terms",
    "",
    "| Term | Definition | Avoid |",
    "| --- | --- | --- |",
    ...terms.map(([term, definition, avoid]) => `| ${term} | ${definition} | ${avoid} |`),
    "",
    "## Actors",
    "",
    "- An actor.",
    "",
    "## Invariants",
    "",
    "- An invariant.",
    "",
    "## Workflows and state transitions",
    "",
    "### A workflow",
    "",
    "1. A step.",
    "",
    "## Commands, events, and outcomes",
    "",
    "| Command or event | Actor | Outcome |",
    "| --- | --- | --- |",
    "| A command | An actor | An outcome. |",
    "",
    "## Context relationships",
    "",
    "None.",
    "",
    "## Domain policies",
    "",
  ];
  for (let index = 0; index < policies.length; index += 1) {
    if (index > 0) lines.push("");
    const [num, title] = policies[index];
    lines.push(`### P-${scope}-${num}: ${title}`, "", "- **Policy:** A rule.", "- **Reason:** A reason.");
  }
  return lines.join("\n") + "\n";
}

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

test("parseDomainIndex accepts a sorted well-formed index", () => {
  const index = parseDomainIndex(indexContent([
    ["billing", "Invoicing and settlement."],
    ["payments", "Captured funds facts."],
  ]));
  assert.deepEqual(index.scopes.map((entry) => entry.scope), ["billing", "payments"]);
});

test("parseDomainIndex rejects unsorted scopes", () => {
  assert.throws(() => parseDomainIndex(indexContent([
    ["payments", "Captured funds facts."],
    ["billing", "Invoicing and settlement."],
  ])), /sorted/);
});

test("parseDomainIndex rejects a File that is not <scope>.md", () => {
  const content = indexContent([["billing", "Invoicing and settlement."]]).replace("`billing.md`", "`other.md`");
  assert.throws(() => parseDomainIndex(content), /File must be/);
});

test("parseDomainScope accepts a valid shard and reports terms and policies", () => {
  const shard = parseDomainScope(shardContent("billing"), "billing");
  assert.deepEqual(shard.terms, ["Settlement"]);
  assert.equal(shard.policies.length, 1);
});

test("parseDomainScope rejects unsorted terms", () => {
  const content = shardContent("billing", { terms: [
    ["Settlement", "A definition.", "an avoid phrase"],
    ["Capture", "Another definition.", "an avoid phrase"],
  ] });
  assert.throws(() => parseDomainScope(content, "billing"), /lexicographically sorted/);
});

test("parseDomainScope rejects a policy numbering gap", () => {
  const content = shardContent("billing", { policies: [["1", "A policy"], ["3", "A skipped policy"]] });
  assert.throws(() => parseDomainScope(content, "billing"), /sequential/);
});

test("parseDomainScope rejects a scope/slug mismatch", () => {
  const content = shardContent("billing").replace("`billing`", "`payments`");
  assert.throws(() => parseDomainScope(content, "billing"), /must name/);
});

test("parseAgentsDomainSection requires exactly one of each documentation section", () => {
  const complete =
    "# Agent instructions\n\n## Domain documentation\n\n- A rule.\n\n## Decisions\n\n- A decision.\n\n## Design\n\n- A design.\n";
  assert.deepEqual(parseAgentsDomainSection(complete), { domain: 1, decisions: 1, design: 1 });
  assert.throws(() => parseAgentsDomainSection("# Agent instructions\n"), /must contain/);
  assert.throws(
    () => parseAgentsDomainSection("## Domain documentation\n\n## Domain documentation\n"),
    /exactly one/,
  );
  assert.throws(
    () => parseAgentsDomainSection("# Agent instructions\n\n## Domain documentation\n\n## Design\n"),
    /must contain a `## Decisions` section/,
  );
  assert.throws(
    () =>
      parseAgentsDomainSection(
        "# Agent instructions\n\n## Domain documentation\n\n## Decisions\n\n## Decisions\n\n## Design\n",
      ),
    /exactly one `## Decisions` section/,
  );
});

test("validate CLI reports a complete model and rejects an orphan shard", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-domain-"));
  const docs = join(dir, "docs", "domain");
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(docs, "index.md"), indexContent([["billing", "Invoicing and settlement."]]));
  writeFileSync(join(docs, "billing.md"), shardContent("billing"));
  writeFileSync(
    join(dir, "AGENTS.md"),
    "# Agent instructions\n\n## Domain documentation\n\n- A rule.\n\n## Decisions\n\n- A decision.\n\n## Design\n\n- A design.\n",
  );

  const valid = run(["validate", "--index", join(docs, "index.md"), "--agents", join(dir, "AGENTS.md")]);
  assert.equal(valid.status, 0, valid.stdout);
  assert.match(valid.stdout, /status: valid/);
  assert.match(valid.stdout, /scopes: 1/);
  assert.match(valid.stdout, /sections: domain, decisions, design/);

  writeFileSync(join(docs, "orphan.md"), shardContent("orphan"));
  const orphan = run(["validate", "--index", join(docs, "index.md")]);
  assert.equal(orphan.status, 1);
  assert.match(orphan.stdout, /code: invalid-domain/);
  assert.match(orphan.stdout, /orphan shard/);

  rmSync(join(docs, "orphan.md"), { force: true });
  writeFileSync(
    join(dir, "AGENTS.md"),
    "# Agent instructions\n\n## Domain documentation\n\n## Decisions\n\n## Decisions\n\n## Design\n",
  );
  const dupSections = run(["validate", "--index", join(docs, "index.md"), "--agents", join(dir, "AGENTS.md")]);
  assert.equal(dupSections.status, 1);
  assert.match(dupSections.stdout, /code: invalid-domain/);
  assert.match(dupSections.stdout, /exactly one `## Decisions` section/);

  rmSync(dir, { recursive: true, force: true });
});

test("validate CLI usage and help exit codes", () => {
  const usage = run([]);
  assert.equal(usage.status, 2);
  assert.match(usage.stdout, /code: usage/);

  const help = run(["validate", "--help"]);
  assert.equal(help.status, 0, help.stdout);
  assert.match(help.stdout, /Usage:/);
  assert.match(help.stdout, /Commands:/);
});
