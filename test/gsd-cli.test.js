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
import { uninstallLegacyAgent } from "../adapters/plugin/gsd-host-uninstall.mjs";
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

test("Codex legacy cleanup removes only managed hooks, links, and AGENTS.md", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-codex-uninstall-"));
  const configDir = join(home, "codex");
  const skillsDir = join(home, "skills");
  const agentsDir = join(configDir, "agents");
  mkdirSync(join(configDir, "agents"), { recursive: true });
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(
    join(configDir, "hooks.json"),
    JSON.stringify(
      {
        description: "keep-me",
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: "bun /repo/adapters/codex/gsd-context.mjs" }] },
            { hooks: [{ type: "command", command: "echo keep" }] },
          ],
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(configDir, "AGENTS.md"),
    "Keep this text.\n<!-- gsd:codex-adapter -->\n## GSD\nmanaged\n<!-- /gsd:codex-adapter -->\n",
  );
  symlinkSync(join(ROOT, "skills", "gsd-to-plan"), join(skillsDir, "gsd-to-plan"), "dir");
  const userSkill = mkdtempSync(join(tmpdir(), "gsd-user-skill-"));
  symlinkSync(userSkill, join(skillsDir, "my-skill"), "dir");
  symlinkSync(
    join(ROOT, "adapters", "codex", "agents", "gsd-reviewer.toml"),
    join(agentsDir, "gsd-reviewer.toml"),
    "file",
  );
  writeFileSync(join(agentsDir, "my-agent.toml"), "description = 'mine'\n");

  uninstallLegacyAgent("codex", ROOT, {
    HOME: home,
    CODEX_HOME: configDir,
    CODEX_SKILLS_DIR: skillsDir,
  });

  const hooks = JSON.parse(readFileSync(join(configDir, "hooks.json"), "utf8"));
  assert.equal(hooks.description, "keep-me");
  assert.deepEqual(hooks.hooks, {
    SessionStart: [{ hooks: [{ type: "command", command: "echo keep" }] }],
  });
  assert.equal(readFileSync(join(configDir, "AGENTS.md"), "utf8"), "Keep this text.\n");
  assert.equal(existsSync(join(skillsDir, "gsd-to-plan")), false);
  assert.ok(existsSync(join(skillsDir, "my-skill")));
  assert.equal(existsSync(join(agentsDir, "gsd-reviewer.toml")), false);
  assert.ok(existsSync(join(agentsDir, "my-agent.toml")));
});

test("OMP legacy cleanup removes managed extension links only", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-omp-uninstall-"));
  const agentDir = join(home, "agent");
  mkdirSync(join(agentDir, "extensions"), { recursive: true });
  mkdirSync(join(agentDir, "agents"), { recursive: true });
  symlinkSync(
    join(ROOT, "extensions", "gsd-context.js"),
    join(agentDir, "extensions", "gsd-context.js"),
    "file",
  );
  writeFileSync(join(agentDir, "extensions", "my-extension.js"), "export {};\n");
  symlinkSync(
    join(ROOT, "agents", "gsd-reviewer.md"),
    join(agentDir, "agents", "gsd-reviewer.md"),
    "file",
  );
  writeFileSync(join(agentDir, "agents", "my-agent.md"), "---\nname: my-agent\n---\n");

  uninstallLegacyAgent("omp", ROOT, {
    HOME: home,
    PI_CODING_AGENT_DIR: agentDir,
  });

  assert.equal(existsSync(join(agentDir, "extensions", "gsd-context.js")), false);
  assert.ok(existsSync(join(agentDir, "extensions", "my-extension.js")));
  assert.equal(existsSync(join(agentDir, "agents", "gsd-reviewer.md")), false);
  assert.ok(existsSync(join(agentDir, "agents", "my-agent.md")));
});

test("help works without a command", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
});

test("uninstall removes plugin and legacy Claude managed entries", () => {
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
  const settings = JSON.parse(readFileSync(join(configDir, "settings.json"), "utf8"));
  assert.equal(settings.model, "keep-me");
  assert.deepEqual(settings.hooks, {
    SessionStart: [{ hooks: [{ type: "command", command: "echo keep" }] }],
    UserPromptSubmit: [
      { hooks: [{ type: "command", command: "bun /repo/adapters/codex/gsd-context.mjs" }] },
    ],
  });
  assert.equal(existsSync(join(skillsDir, "gsd-brainstorming")), false);
  assert.ok(existsSync(join(skillsDir, "my-skill")));
  assert.equal(existsSync(join(agentsDir, "gsd-reviewer.md")), false);
  assert.ok(existsSync(join(agentsDir, "my-agent.md")));
  assert.equal(existsSync(join(home, "marketplace")), false);
  assert.equal(existsSync(join(home, "state.json")), false);
});
