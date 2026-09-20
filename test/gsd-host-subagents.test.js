import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPluginBundle } from "../adapters/plugin/gsd-plugin-packager.mjs";
import { createBootstrap, discoverSkillCatalog } from "../lib/gsd-bootstrap.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every supported host has a named sub-agent launch surface", () => {
  const adapters = readFileSync(join(ROOT, "adapters", "README.md"), "utf8");

  assert.match(
    adapters,
    /Sub-agent implementation \| One task per isolated sub-agent, serial fallback \| Agent-tool subagents from `\.claude\/agents\/\*\.md` \| Spawned agent threads from `\.codex\/agents\/\*\.toml`, collected by the main thread/,
  );
  assert.match(adapters, /Independent review \| One isolated read-only reviewer sub-agent task/);
  assert.match(adapters, /task isolation/);

  const marketplaceRoot = mkdtempSync(join(tmpdir(), "gsd-host-subagents-"));
  const { pluginRoot } = buildPluginBundle(ROOT, marketplaceRoot);

  const claudeManifest = JSON.parse(
    readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
  );
  assert.equal(claudeManifest.agents, "./agents/gsd-reviewer.md");
  const claudeAgent = readFileSync(join(pluginRoot, "agents", "gsd-reviewer.md"), "utf8");
  assert.match(claudeAgent, /^name: gsd-reviewer$/m);
  assert.match(claudeAgent, /^tools: Read, Grep, Glob$/m);
  assert.match(claudeAgent, /You are GSD's independent read-only reviewer/);

  const codexAgent = readFileSync(join(pluginRoot, "agents", "gsd-reviewer.toml"), "utf8");
  assert.match(codexAgent, /^name = "gsd-reviewer"$/m);
  assert.match(codexAgent, /^sandbox_mode = "read-only"$/m);
  assert.match(codexAgent, /You are GSD's independent read-only reviewer/);

  assert.ok(existsSync(join(pluginRoot, "adapters", "omp", "gsd-context.js")));
  const ompManifest = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8"));
  assert.deepEqual(ompManifest.omp.extensions, ["./adapters/omp/gsd-context.js"]);
});

test("brainstorming remains the explicit familiar route and skill behavior", () => {
  const bootstrap = createBootstrap(ROOT);
  assert.match(
    bootstrap,
    /interface, architecture, domain, new-feature, integration, or unrelated lifecycle -> `gsd-brainstorming`/,
  );

  const catalog = discoverSkillCatalog(ROOT);
  const brainstorm = catalog.find(({ name }) => name === "gsd-brainstorming");
  assert.ok(brainstorm, "gsd-brainstorming must stay in the visible catalog");
  assert.equal(
    brainstorm.description,
    "Converge non-trivial new/changed product behavior into acceptance, then load gsd-to-plan.",
  );

  const skill = readFileSync(brainstorm.skillPath, "utf8");
  assert.match(skill, /Recommend answers for all questions/);
  assert.match(skill, /Batch independent questions/);
  assert.match(skill, /present 2–3 approaches with tradeoffs and a recommendation/);
  assert.match(skill, /## Discovery and stress-test/);

  const fixtures = JSON.parse(readFileSync(join(ROOT, "test", "eval", "fixtures.json"), "utf8"));
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  for (const id of [
    "arch-audit",
    "new-feature",
    "interface-design",
    "domain-glossary",
    "domain-context-mapping",
  ]) {
    assert.equal(byId.get(id)?.expectedPrimarySkill, "gsd-brainstorming", `${id} must route to brainstorming`);
  }
});
