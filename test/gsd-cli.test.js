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

  const result = runCli(["install", "--agent", "claude", "--home", home], {
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
  });

  assert.equal(result.status, 0, result.stderr);
  const commands = readFileSync(logPath, "utf8").trim().split("\n");
  assert.deepEqual(commands, [
    `claude plugin marketplace add ${join(home, "marketplace")} --scope user`,
    "claude plugin install gsd@gsd-local --scope user",
  ]);
  assert.ok(existsSync(join(home, "marketplace", "gsd", ".claude-plugin", "plugin.json")));

  const state = JSON.parse(readFileSync(join(home, "state.json"), "utf8"));
  assert.deepEqual(state.agents, { claude: "plugin" });
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
    JSON.stringify({ version: 1, agents: { claude: "plugin" } }, null, 2),
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
  writeFileSync(join(agentsDir, "gsd-reviewer.md"), "---\nname: gsd-reviewer\n---\n");
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

  const result = runCli(["uninstall", "--agent", "claude", "--home", home], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      CLAUDE_CONFIG_DIR: configDir,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(logPath, "utf8").trim().split("\n"), [
    "claude plugin uninstall gsd@gsd-local --scope user",
    "claude plugin marketplace remove gsd-local --scope user",
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

test("config set writes validated per-profile host values and get/list read them back", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-cli-config-"));

  assert.equal(runCli(["config", "list", "--home", home]).stdout, `${join(home, "settings.json")}: no profiles set\n`);
  assert.equal(existsSync(join(home, "settings.json")), false, "list must not create settings");

  for (const [key, value] of [
    ["worker.claude", "sonnet"],
    ["scout.codex", "a6/glm-5.3-flash"],
    ["scout.omp", "scout"],
  ]) {
    const result = runCli(["config", "set", key, value, "--home", home]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${key}=${value}\n`);
  }

  const settings = JSON.parse(readFileSync(join(home, "settings.json"), "utf8"));
  assert.deepEqual(settings, {
    version: 1,
    profiles: {
      scout: { codex: "a6/glm-5.3-flash", omp: "scout" },
      worker: { claude: "sonnet" },
    },
  });

  const get = runCli(["config", "get", "scout.codex", "--home", home]);
  assert.equal(get.status, 0, get.stderr);
  assert.equal(get.stdout, "a6/glm-5.3-flash\n");
  assert.equal(runCli(["config", "get", "worker.codex", "--home", home]).status, 1);

  const list = runCli(["config", "list", "--home", home]);
  assert.equal(list.status, 0, list.stderr);
  assert.equal(
    list.stdout,
    "scout.omp=scout\nscout.codex=a6/glm-5.3-flash\nworker.claude=sonnet\n",
  );
});

test("config resolves GSD_HOME when --home is absent", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-cli-config-env-"));
  const previous = process.env.GSD_HOME;
  process.env.GSD_HOME = home;
  try {
    assert.equal(runCli(["config", "set", "worker.codex", "a6/grok-4.7"]).status, 0);
  } finally {
    if (previous === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = previous;
  }
  assert.equal(JSON.parse(readFileSync(join(home, "settings.json"), "utf8")).profiles.worker.codex, "a6/grok-4.7");
});

test("config rejects usage errors with status 2 and invalid values or files with status 1", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-cli-config-bad-"));
  for (const argv of [
    ["config"],
    ["config", "toString"],
    ["config", "set", "scout.claude"],
    ["config", "get", "planner.claude"],
    ["config", "get", "scout.gemini"],
    ["config", "list", "extra"],
    ["config", "list", "--agent", "claude"],
  ]) {
    assert.equal(runCli([...argv, "--home", home]).status, 2, argv.join(" "));
  }
  for (const value of ["has space", "back`tick", 'quo"te']) {
    const result = runCli(["config", "set", "scout.claude", value, "--home", home]);
    assert.equal(result.status, 1, value);
    assert.match(result.stderr, /scout\.claude: value must be/);
  }
  assert.equal(existsSync(join(home, "settings.json")), false);

  writeFileSync(join(home, "settings.json"), JSON.stringify({ version: 1, profiles: { planner: {} } }));
  const broken = runCli(["config", "list", "--home", home]);
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /unknown profile planner/);
});

test("uninstall keeps user settings", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-cli-config-keep-"));
  const logPath = join(home, "commands.log");
  const binDir = fakeBinDir(logPath);
  buildPluginBundle(ROOT, join(home, "marketplace"));
  writeFileSync(join(home, "state.json"), JSON.stringify({ version: 1, agents: { codex: "plugin" } }));
  assert.equal(runCli(["config", "set", "worker.codex", "a6/grok-4.7", "--home", home]).status, 0);

  const result = runCli(["uninstall", "--agent", "codex", "--home", home], {
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(home, "marketplace")), false);
  assert.ok(existsSync(join(home, "settings.json")));
});
