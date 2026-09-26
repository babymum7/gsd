import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBootstrap, discoverSkillCatalog } from "../lib/gsd-bootstrap.mjs";
import { buildPluginBundle } from "../adapters/plugin/gsd-plugin-packager.mjs";
import { withSessionOwner } from "../lib/gsd-session-context.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Byte identity holds against an empty GSD home: user sub-agent profiles in the real
// ~/.gsd/settings.json would otherwise append to the bootstrap every hook emits.
process.env.GSD_HOME = mkdtempSync(join(tmpdir(), "gsd-empty-home-"));

function collectSymlinks(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name);
    if (entry.isSymbolicLink()) found.push(target);
    if (entry.isDirectory()) collectSymlinks(target, found);
  }
  return found;
}

test("buildPluginBundle creates a self-contained plugin with a hidden runtime core", () => {
  const marketplaceRoot = mkdtempSync(join(tmpdir(), "gsd-plugin-marketplace-"));
  const { pluginRoot } = buildPluginBundle(ROOT, marketplaceRoot);

  const visible = discoverSkillCatalog(ROOT)
    .map((row) => row.name)
    .sort();
  assert.deepEqual(readdirSync(join(pluginRoot, "skills")).sort(), visible);
  assert.equal(existsSync(join(pluginRoot, "skills", "gsd")), false);
  assert.equal(existsSync(join(pluginRoot, "skills", "gsd-codebase-architecture")), false);
  assert.ok(existsSync(join(pluginRoot, "core", "skills", "gsd", "SKILL.md")));
  assert.ok(existsSync(join(pluginRoot, "core", "skills", "gsd-codebase-architecture", "SKILL.md")));
  assert.ok(existsSync(join(pluginRoot, "core", "tools", "gsd-contract.mjs")));
  assert.deepEqual(collectSymlinks(pluginRoot), []);
  // Every core tool must load from the built bundle: tools import `../lib`, which shipped
  // missing from `core/` and failed every validator call with "Cannot find module".
  for (const tool of readdirSync(join(pluginRoot, "core", "tools"))) {
    const run = spawnSync(process.execPath, [join(pluginRoot, "core", "tools", tool), "--help"], { encoding: "utf8" });
    assert.doesNotMatch(run.stderr, /Cannot find module/, `${tool} loads from the bundle`);
  }

  const claudeManifest = JSON.parse(
    readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
  );
  assert.equal(claudeManifest.name, "gsd");
  assert.deepEqual(claudeManifest.author, { name: "GSD" });
  assert.equal(claudeManifest.agents, undefined);
  assert.equal(existsSync(join(pluginRoot, "agents")), false);
  assert.equal(claudeManifest.hooks, "./hooks/claude.json");
  // No root `plugin.json`: codex would resolve it as an AgentPlugin manifest and
  // skip hook registration; the legacy `.codex-plugin/plugin.json` stays authoritative.
  assert.equal(existsSync(join(pluginRoot, "plugin.json")), false);
  const codexFallback = JSON.parse(
    readFileSync(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"),
  );
  assert.equal(codexFallback.hooks, "./hooks/codex.json");
  const ompManifest = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8"));
  assert.deepEqual(ompManifest.omp.extensions, ["./adapters/omp/gsd-context.js"]);

  const claudeHooks = JSON.parse(readFileSync(join(pluginRoot, "hooks", "claude.json"), "utf8"));
  const claudeCommand = claudeHooks.hooks.SessionStart[0].hooks[0].command;
  assert.match(claudeCommand, /\$\{CLAUDE_PLUGIN_ROOT\}\/adapters\/claude-code\/gsd-context\.mjs/);
  const codexHooks = JSON.parse(readFileSync(join(pluginRoot, "hooks", "codex.json"), "utf8"));
  const codexHandler = codexHooks.hooks.SessionStart[0].hooks[0];
  assert.match(codexHandler.command, /\$\{PLUGIN_ROOT\}\/adapters\/codex\/gsd-context\.mjs/);
  assert.equal(codexHandler.additionalContextLimit, 6000);

  const marketplace = JSON.parse(
    readFileSync(join(marketplaceRoot, ".claude-plugin", "marketplace.json"), "utf8"),
  );
  assert.equal(marketplace.name, "gsd-local");
  assert.equal(marketplace.description, "GSD workflow skills and session adapters");
  assert.deepEqual(marketplace.owner, { name: "GSD" });
  assert.equal(marketplace.plugins[0].description, "GSD workflow skills, contract validators, and the OMP, Claude Code, and Codex session adapters.");
  assert.equal(marketplace.plugins[0].source, "./gsd");

  const project = mkdtempSync(join(tmpdir(), "gsd-plugin-project-"));
  const hook = spawnSync(
    process.execPath,
    [join(pluginRoot, "adapters", "claude-code", "gsd-context.mjs")],
    {
      input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "plugin", cwd: project }),
      encoding: "utf8",
    },
  );
  assert.equal(hook.status, 0, hook.stderr);
  assert.equal(
    JSON.parse(hook.stdout).hookSpecificOutput.additionalContext,
    withSessionOwner(createBootstrap(join(pluginRoot, "core")), "claude-plugin"),
    "the plugin hook must inject the bundled core's exact bytes plus the session owner",
  );
});
