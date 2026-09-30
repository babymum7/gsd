import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPluginBundle } from "../adapters/plugin/gsd-plugin-packager.mjs";
import { needsAgentPrompt, runCli } from "../adapters/plugin/gsd-cli.mjs";

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

test("skills-only install writes resolved visible skills and a router, and uninstall removes only them", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-cli-home-"));
  const skillsDir = mkdtempSync(join(tmpdir(), "gsd-skills-dir-"));
  mkdirSync(join(skillsDir, "someone-else"));
  writeFileSync(join(skillsDir, "someone-else", "SKILL.md"), "unrelated\n");

  const installed = runCli(["install", "--skills-dir", skillsDir, "--home", home]);
  assert.equal(installed.status, 0, installed.stderr);
  const coreRoot = join(home, "marketplace", "gsd", "core");

  const router = readFileSync(join(skillsDir, "gsd", "SKILL.md"), "utf8");
  assert.match(router, /^name: gsd$/m);
  assert.doesNotMatch(router, /^hide: true$/m);
  assert.ok(router.includes(`GSD_ROOT: ${JSON.stringify(coreRoot)}`));
  assert.match(router, /^GSD_SESSION: skills-only$/m);
  assert.doesNotMatch(router, /The host already loaded this/);
  assert.ok(existsSync(join(skillsDir, "gsd", "REFERENCE.md")), "relative ../gsd/REFERENCE.md links resolve");

  const executing = readFileSync(join(skillsDir, "gsd-executing-plans", "SKILL.md"), "utf8");
  assert.doesNotMatch(executing, /<GSD_ROOT>/);
  assert.ok(executing.includes(`bun "${coreRoot}/tools/gsd-state.mjs"`));
  assert.ok(existsSync(join(coreRoot, "tools", "gsd-state.mjs")));
  assert.ok(!existsSync(join(skillsDir, "gsd-tdd")), "hidden helper skills stay in core");
  assert.equal(JSON.parse(readFileSync(join(home, "state.json"), "utf8")).agents[`skills:${skillsDir}`], "skills");

  const removed = runCli(["uninstall", "--skills-dir", skillsDir, "--home", home]);
  assert.equal(removed.status, 0, removed.stderr);
  assert.ok(!existsSync(join(skillsDir, "gsd")));
  assert.ok(!existsSync(join(skillsDir, "gsd-executing-plans")));
  assert.equal(readFileSync(join(skillsDir, "someone-else", "SKILL.md"), "utf8"), "unrelated\n");
  assert.ok(!existsSync(join(home, "marketplace")), "the bundle goes once nothing uses it");
});

test("skills-only install refuses to overwrite a skill it does not manage", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-cli-home-"));
  const skillsDir = mkdtempSync(join(tmpdir(), "gsd-skills-dir-"));
  mkdirSync(join(skillsDir, "gsd-verify"));
  writeFileSync(join(skillsDir, "gsd-verify", "SKILL.md"), "mine\n");

  const result = runCli(["install", "--skills-dir", skillsDir, "--home", home]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /is not a GSD-managed skill/);
  assert.equal(readFileSync(join(skillsDir, "gsd-verify", "SKILL.md"), "utf8"), "mine\n");
  assert.ok(!existsSync(join(skillsDir, "gsd")), "nothing is written after a refusal");
  assert.equal(runCli(["install", "--skills-dir", skillsDir, "--agent", "omp", "--home", home]).status, 2);
});

// A host stub whose exit behaviour a test picks per binary, so the install and uninstall
// failure paths run instead of the always-successful fakes above.
function scriptedBinDir(logPath, behaviour) {
  const binDir = mkdtempSync(join(tmpdir(), "gsd-cli-script-"));
  for (const name of ["claude", "codex", "omp"]) {
    const script = join(binDir, name);
    const action = behaviour[name] ?? "exit 0";
    writeFileSync(
      script,
      `#!/bin/sh\nprintf '%s\\n' "${name} $*" >> ${JSON.stringify(logPath)}\n${action}\n`,
    );
    chmodSync(script, 0o755);
  }
  return binDir;
}

function withBin(binDir) {
  return { env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` } };
}

const readAgents = (home) => JSON.parse(readFileSync(join(home, "state.json"), "utf8")).agents;

test("a partial install records the agents that did install, so uninstall still removes them", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-cli-partial-"));
  const logPath = join(home, "commands.log");
  const binDir = scriptedBinDir(logPath, { claude: "exit 4" });
  try {
    const failed = runCli(["install", "--agent", "all", "--home", home], withBin(binDir));
    assert.equal(failed.status, 4, failed.stderr);
    assert.deepEqual(readAgents(home), { omp: "plugin" }, "omp linked before claude failed");

    const removed = runCli(["uninstall", "--agent", "omp", "--home", home], withBin(binDir));
    assert.equal(removed.status, 0, removed.stderr);
    assert.match(readFileSync(logPath, "utf8"), /omp plugin uninstall gsd-core/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a partial uninstall keeps only the agents still installed, so a retry can finish", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-cli-retry-"));
  const logPath = join(home, "commands.log");
  const ok = scriptedBinDir(logPath, {});
  const failing = scriptedBinDir(logPath, { claude: "exit 4" });
  try {
    assert.equal(runCli(["install", "--agent", "all", "--home", home], withBin(ok)).status, 0);
    const failed = runCli(["uninstall", "--agent", "all", "--home", home], withBin(failing));
    assert.equal(failed.status, 4, failed.stderr);
    assert.deepEqual(readAgents(home), { claude: "plugin", codex: "plugin" });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a corrupt state file stops install before any host is touched and names the file", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-cli-corrupt-"));
  const logPath = join(home, "commands.log");
  const binDir = scriptedBinDir(logPath, {});
  try {
    writeFileSync(join(home, "state.json"), '{ "version": 1, "agents": {');
    const result = runCli(["install", "--agent", "claude", "--home", home], withBin(binDir));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /state\.json/);
    assert.equal(existsSync(logPath), false, "no host command ran");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a host command killed by a signal fails the install instead of exiting 0", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-cli-signal-"));
  const binDir = scriptedBinDir(join(home, "commands.log"), { claude: "kill -KILL $$" });
  try {
    const result = runCli(["install", "--agent", "claude", "--home", home], withBin(binDir));
    assert.notEqual(result.status, 0);
    assert.equal(typeof result.status, "number");
    assert.match(result.stderr, /SIGKILL/);
    assert.equal(existsSync(join(home, "state.json")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a flag never swallows the next flag as its value", () => {
  for (const argv of [
    ["install", "--skills-dir", "--dry-run"],
    ["install", "--agent", "claude", "--home", "--dry-run"],
    ["install", "--agent", "claude", "--dry-run", "--home"],
    ["install", "--agent", "--dry-run"],
    ["install", "--agent", "claude", "--home", ""],
  ]) {
    const result = runCli(argv);
    assert.equal(result.status, 2, `${argv.join(" ")}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /requires/);
  }
});

// The agent prompt only runs on a terminal, and Bun's readline reacts to raw keystrokes, so the
// behaviour under test exists only behind a pseudo-terminal. The driver types `keys` once the
// prompt is shown and reports how the process ended; the test skips where it cannot run.
const PTY_DRIVER = `
import json, os, pty, select, signal, sys, time
keys = json.loads(sys.argv[1]).encode()
command = sys.argv[2:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(command[0], command)
out = b""
sent = False
deadline = time.time() + 15
code = None
while time.time() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.2)
    if ready:
        try:
            data = os.read(fd, 4096)
        except OSError:
            data = b""
        if data:
            out += data
            if not sent and b"> " in out:
                os.write(fd, keys)
                sent = True
    done, status = os.waitpid(pid, os.WNOHANG)
    if done:
        code = os.waitstatus_to_exitcode(status)
        break
if code is None:
    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)
    code = "timeout"
print(json.dumps({"code": code, "out": out.decode("utf-8", "replace")}))
`;

function typeAtAgentPrompt(keys, home) {
  const probe = spawnSync("python3", ["-c", "import pty"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0 || process.platform === "win32") return null;
  const result = spawnSync(
    "python3",
    ["-c", PTY_DRIVER, JSON.stringify(keys), process.execPath, join(ROOT, "bin", "gsd.mjs"), "install", "--dry-run", "--home", home],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(result.status, 0, result.stderr);
  const reported = JSON.parse(result.stdout);
  // eslint-disable-next-line no-control-regex
  return { ...reported, out: reported.out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "") };
}

test("the agent prompt treats Ctrl-D as a cancel instead of crashing", () => {
  // Bun rejects the pending question with `AbortError: Aborted with Ctrl+D`; nothing caught it,
  // so ending the prompt printed a runtime stack trace.
  const home = mkdtempSync(join(tmpdir(), "gsd-cli-home-"));
  try {
    const run = typeAtAgentPrompt("\u0004", home);
    if (run === null) return;
    assert.equal(run.code, 1, run.out);
    assert.match(run.out, /agent selection cancelled/);
    assert.doesNotMatch(run.out, /AbortError|Bun v\d|\bat .*\(/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the agent prompt names an invalid answer instead of claiming the terminal is not interactive", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-cli-home-"));
  try {
    const run = typeAtAgentPrompt("9\n", home);
    if (run === null) return;
    assert.equal(run.code, 2, run.out);
    assert.match(run.out, /unknown selection "9"/);
    assert.doesNotMatch(run.out, /not interactive/);

    const control = typeAtAgentPrompt("3\n", home);
    assert.equal(control.code, 0, control.out);
    assert.match(control.out, /\[claude\]/);
    assert.doesNotMatch(control.out, /\[codex\]/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an empty GSD_HOME falls back to the default home like config does", () => {
  const saved = process.env.GSD_HOME;
  process.env.GSD_HOME = "";
  let result;
  try {
    result = runCli(["install", "--agent", "claude", "--dry-run"]);
  } finally {
    if (saved === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = saved;
  }
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`marketplace add ${join(homedir(), ".gsd", "marketplace")}`));
});

test("the agent menu is offered only when the run still needs an agent", () => {
  assert.equal(needsAgentPrompt(["install"]), true);
  assert.equal(needsAgentPrompt(["uninstall", "--dry-run"]), true);
  assert.equal(needsAgentPrompt(["install", "--agent", "claude"]), false);
  assert.equal(needsAgentPrompt(["install", "--skills-dir", "/tmp/skills"]), false);
  assert.equal(needsAgentPrompt(["uninstall", "--skills-dir", "/tmp/skills"]), false);
  assert.equal(needsAgentPrompt(["install", "--help"]), false);
  assert.equal(needsAgentPrompt(["install", "-h"]), false);
  assert.equal(needsAgentPrompt(["config", "list"]), false);
});

test("a skills directory under a path with $ patterns keeps the path verbatim", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-cli-dollar-"));
  const dollarHome = join(home, "h$$x");
  const skillsDir = join(home, "skills");
  try {
    const result = runCli(["install", "--skills-dir", skillsDir, "--home", dollarHome]);
    assert.equal(result.status, 0, result.stderr);
    const executing = readFileSync(join(skillsDir, "gsd-executing-plans", "SKILL.md"), "utf8");
    assert.ok(executing.includes(join(dollarHome, "marketplace", "gsd", "core")), "the core path is unchanged");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
