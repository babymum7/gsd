import { test } from "bun:test";
import assert from "node:assert/strict";
import { read, ROOT } from "./support/skills-fixtures.js";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

