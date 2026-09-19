import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPluginBundle } from "../adapters/plugin/gsd-plugin-packager.mjs";
import { runCli } from "../adapters/plugin/gsd-cli.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function fakeBinDir(logPath) {
  const binDir = mkdtempSync(join(tmpdir(), "gsd-cli-bin-"));
  for (const name of ["claude", "codex", "omp"]) {
    const script = join(binDir, name);
    writeFileSync(
      script,
      `#!/bin/sh\nprintf '%s\\n' "${name} $*" >> ${JSON.stringify(logPath)}\n`,
    );
    chmodSync(script, 0o755);
  }
  return binDir;
}

test("install routes one selected agent through its native plugin command", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-cli-home-"));
  const logPath = join(home, "commands.log");
  const binDir = fakeBinDir(logPath);

  const result = runCli(["install", "--agent", "claude-code", "--home", home], {
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
  });

  assert.equal(result.status, 0, result.stderr);
  const commands = readFileSync(logPath, "utf8").trim().split("\n");
  assert.deepEqual(commands, [
    `claude plugin marketplace add ${join(home, "marketplace")}`,
    "claude plugin install gsd@gsd-local --scope user",
  ]);
  assert.ok(existsSync(join(home, "marketplace", "gsd", ".claude-plugin", "plugin.json")));

  const state = JSON.parse(readFileSync(join(home, "state.json"), "utf8"));
  assert.deepEqual(state.agents, { "claude-code": "plugin" });
});

test("install dry-run plans commands without building or invoking a host", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-cli-dry-"));
  const result = runCli(["install", "--agent", "all", "--home", home, "--dry-run"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /claude plugin install gsd@gsd-local --scope user/);
  assert.match(result.stdout, /codex plugin add gsd@gsd-local/);
  assert.match(result.stdout, /omp plugin link/);
  assert.equal(existsSync(join(home, "marketplace")), false);
  assert.equal(existsSync(join(home, "state.json")), false);
});

test("help works without a command", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
});

test("uninstall is plugin-only and leaves legacy-looking host files unchanged", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-cli-uninstall-"));
  const logPath = join(home, "commands.log");
  const binDir = fakeBinDir(logPath);
  buildPluginBundle(ROOT, join(home, "marketplace"));
  writeFileSync(
    join(home, "state.json"),
    JSON.stringify({ version: 1, agents: { "claude-code": "plugin" } }, null, 2),
  );

  const configDir = mkdtempSync(join(tmpdir(), "gsd-claude-config-"));
  const skillsDir = join(configDir, "skills");
  const agentsDir = join(configDir, "agents");
  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(
    join(configDir, "AGENTS.md"),
    "Keep this text.\n<!-- gsd:codex-adapter -->\n## GSD\nmanaged\n<!-- /gsd:codex-adapter -->\n",
  );
  const userSkill = mkdtempSync(join(tmpdir(), "gsd-user-skill-"));
  symlinkSync(join(ROOT, "skills", "gsd-brainstorming"), join(skillsDir, "gsd-brainstorming"), "dir");
  symlinkSync(userSkill, join(skillsDir, "my-skill"), "dir");
  symlinkSync(
    join(ROOT, "adapters", "claude-code", "agents", "gsd-reviewer.md"),
    join(agentsDir, "gsd-reviewer.md"),
    "file",
  );
  writeFileSync(join(agentsDir, "my-agent.md"), "---\nname: my-agent\n---\n");
  writeFileSync(
    join(configDir, "settings.json"),
    JSON.stringify(
      {
        model: "keep-me",
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: "bun /repo/adapters/claude-code/gsd-context.mjs" }] },
            { hooks: [{ type: "command", command: "echo keep" }] },
          ],
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "bun /repo/adapters/codex/gsd-context.mjs" }] },
          ],
        },
      },
      null,
      2,
    ),
  );
  const settingsBefore = readFileSync(join(configDir, "settings.json"), "utf8");
  const agentsBefore = readFileSync(join(configDir, "AGENTS.md"), "utf8");

  const result = runCli(["uninstall", "--agent", "claude-code", "--home", home], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      CLAUDE_CONFIG_DIR: configDir,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(logPath, "utf8").trim().split("\n"), [
    "claude plugin uninstall gsd@gsd-local --scope user",
    "claude plugin marketplace remove gsd-local",
  ]);
  assert.equal(readFileSync(join(configDir, "settings.json"), "utf8"), settingsBefore);
  assert.equal(readFileSync(join(configDir, "AGENTS.md"), "utf8"), agentsBefore);
  assert.ok(existsSync(join(skillsDir, "gsd-brainstorming")));
  assert.ok(existsSync(join(skillsDir, "my-skill")));
  assert.ok(existsSync(join(agentsDir, "gsd-reviewer.md")));
  assert.ok(existsSync(join(agentsDir, "my-agent.md")));
  assert.equal(existsSync(join(home, "marketplace")), false);
  assert.equal(existsSync(join(home, "state.json")), false);
});
