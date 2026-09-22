import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBootstrap, discoverSkillCatalog } from "../lib/gsd-bootstrap.mjs";
import { buildPluginBundle } from "../adapters/plugin/gsd-plugin-packager.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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
  assert.equal(existsSync(join(pluginRoot, "skills", "gsd-ponytail")), false);
  assert.ok(existsSync(join(pluginRoot, "core", "skills", "gsd", "SKILL.md")));
  assert.ok(existsSync(join(pluginRoot, "core", "skills", "gsd-ponytail", "SKILL.md")));
  assert.ok(existsSync(join(pluginRoot, "core", "tools", "gsd-contract.mjs")));
  assert.deepEqual(collectSymlinks(pluginRoot), []);

  const claudeManifest = JSON.parse(
    readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
  );
  assert.equal(claudeManifest.name, "gsd");
  assert.deepEqual(claudeManifest.author, { name: "GSD" });
  assert.equal(claudeManifest.agents, "./agents/gsd-reviewer.md");
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
    createBootstrap(join(pluginRoot, "core")),
    "the plugin hook must inject the bundled core's exact bytes",
  );
});
