import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createBootstrap } from "../lib/gsd-bootstrap.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(ROOT, "adapters", "codex", "install.mjs");

function runInstaller(args) {
  return spawnSync(process.execPath, [INSTALLER, ...args], { encoding: "utf8" });
}

function tempConfigDir() {
  return mkdtempSync(join(tmpdir(), "gsd-codex-config-"));
}

function tempSkillsDir() {
  return mkdtempSync(join(tmpdir(), "gsd-codex-skills-"));
}

// Constants read out of the installer source, so the README cannot describe markers the
// installer no longer writes.
function installerConstant(source, name) {
  const match = source.match(new RegExp(`const ${name} = '([^']+)'`));
  assert.ok(match, `the installer must declare ${name}`);
  return match[1];
}

test("the README's uninstall steps name the markers and artifacts this adapter owns", () => {
  const section = readFileSync(join(ROOT, "README.md"), "utf8").match(
    /### Uninstalling a host adapter\n([\s\S]*?)(?=\n## )/,
  )?.[1];
  assert.ok(section, "the README must document uninstalling a host adapter");
  const installer = readFileSync(INSTALLER, "utf8");
  const hookMarker = installerConstant(installer, "HOOK_MARKER");
  assert.ok(
    section.includes(hookMarker),
    `the uninstall steps must name the hook marker ${hookMarker}`,
  );
  for (const name of ["AGENTS_MD_START", "AGENTS_MD_END"]) {
    const marker = installerConstant(installer, name);
    assert.ok(section.includes(marker), `the uninstall steps must name the marker ${marker}`);
  }
  // The agent definition is described by its rule - a link into this checkout - rather than
  // by file name, because `README.md` may not name the reviewer agent (session-owner
  // authority guard in test/skills-lifecycle.test.js).
  for (const artifact of ["hooks.json", "~/.agents/skills", "agents/"]) {
    assert.ok(section.includes(artifact), `the uninstall steps must name ${artifact}`);
  }
  assert.ok(
    readdirSync(join(ROOT, "adapters", "codex", "agents")).length > 0,
    "the adapter must ship the definitions that rule removes",
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Codex scans user skills at ~/.agents/skills; --skills-dir keeps every test off the
// runner's real home directory.
function runInstall(extra = []) {
  const configDir = tempConfigDir();
  const skillsDir = tempSkillsDir();
  const result = runInstaller(["--config-dir", configDir, "--skills-dir", skillsDir, ...extra]);
  return { configDir, skillsDir, result };
}

test("dry-run plans the hooks without writing anything", () => {
  const configDir = tempConfigDir();
  const skillsDir = tempSkillsDir();
  const result = runInstaller([
    "--config-dir",
    configDir,
    "--skills-dir",
    skillsDir,
    "--dry-run",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SessionStart/);
  assert.match(result.stdout, /gsd-context\.mjs/);
  assert.match(result.stdout, new RegExp(escapeRegExp(skillsDir)));
  assert.equal(existsSync(join(configDir, "hooks.json")), false);
  assert.equal(existsSync(join(configDir, "skills")), false);
});

test("skills default to the Codex user directory ~/.agents/skills, not $CODEX_HOME", () => {
  const configDir = tempConfigDir();
  const result = runInstaller(["--config-dir", configDir, "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    new RegExp(escapeRegExp(join(homedir(), ".agents", "skills"))),
    "the default skill dir must be the location Codex actually scans",
  );
});

test("install registers the hooks, links skills, and preserves existing hooks.json", () => {
  const configDir = tempConfigDir();
  const skillsDir = tempSkillsDir();
  writeFileSync(
    join(configDir, "hooks.json"),
    JSON.stringify(
      {
        description: "keep-me",
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }],
        },
      },
      null,
      2,
    ),
  );

  const result = runInstaller(["--config-dir", configDir, "--skills-dir", skillsDir]);
  assert.equal(result.status, 0, result.stderr);

  const doc = JSON.parse(readFileSync(join(configDir, "hooks.json"), "utf8"));
  assert.equal(doc.description, "keep-me", "unrelated top-level metadata is preserved");
  for (const event of ["SessionStart", "UserPromptSubmit"]) {
    assert.ok(Array.isArray(doc.hooks[event]), `${event} hooks are registered`);
  }
  assert.match(doc.hooks.SessionStart[0].hooks[0].command, /echo hi/);
  assert.ok(
    doc.hooks.SessionStart.some((group) =>
      group.hooks.some((handler) => handler.command.includes("gsd-context.mjs")),
    ),
    "the GSD hook is appended without dropping the existing group",
  );
  assert.ok(
    lstatSync(join(skillsDir, "gsd-brainstorming")).isSymbolicLink(),
    "visible skills are published",
  );
  assert.equal(
    existsSync(join(skillsDir, "gsd")),
    false,
    "the hidden gsd master must not be published",
  );
  assert.equal(
    existsSync(join(skillsDir, "gsd-ponytail")),
    false,
    "the hidden ponytail context must not be published",
  );
  assert.equal(
    existsSync(join(configDir, "skills")),
    false,
    "skills must not be published under $CODEX_HOME, which Codex does not scan",
  );
  assert.ok(lstatSync(join(configDir, "agents", "gsd-reviewer.toml")).isSymbolicLink());
  const agentsMd = readFileSync(join(configDir, "AGENTS.md"), "utf8");
  assert.match(agentsMd, /<!-- gsd:codex-adapter -->/);
  assert.match(agentsMd, /## GSD/);
  assert.match(
    agentsMd,
    /`\/plan`[\s\S]{0,120}`\/goal`/,
    "the managed section names the Codex plan and goal affordances",
  );
  assert.match(
    agentsMd,
    /affordances, not authority[\s\S]{0,240}only definition of done/i,
    "the managed section keeps plan and goal non-authoritative",
  );
});

test("re-running the installer is idempotent", () => {
  const configDir = tempConfigDir();
  const skillsDir = tempSkillsDir();
  const args = ["--config-dir", configDir, "--skills-dir", skillsDir];
  assert.equal(runInstaller(args).status, 0);
  assert.equal(runInstaller(args).status, 0);

  const doc = JSON.parse(readFileSync(join(configDir, "hooks.json"), "utf8"));
  for (const event of ["SessionStart", "UserPromptSubmit"]) {
    const gsdGroups = doc.hooks[event].filter((group) =>
      group.hooks.some((handler) => handler.command.includes("gsd-context.mjs")),
    );
    assert.equal(gsdGroups.length, 1, `${event} keeps exactly one GSD hook group`);
  }
  const agentsMd = readFileSync(join(configDir, "AGENTS.md"), "utf8");
  assert.equal(
    agentsMd.split("<!-- gsd:codex-adapter -->").length - 1,
    1,
    "the managed AGENTS.md section is upserted once",
  );
});

test("re-installing removes a stale managed link to a hidden skill and keeps user links", () => {
  const configDir = tempConfigDir();
  const skillsDir = tempSkillsDir();
  symlinkSync(join(ROOT, "skills", "gsd"), join(skillsDir, "gsd"), "dir");
  const userSkill = mkdtempSync(join(tmpdir(), "gsd-user-skill-"));
  symlinkSync(userSkill, join(skillsDir, "my-own-skill"), "dir");

  const result = runInstaller(["--config-dir", configDir, "--skills-dir", skillsDir]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    existsSync(join(skillsDir, "gsd")),
    false,
    "a managed link to a hidden skill is removed",
  );
  assert.ok(
    lstatSync(join(skillsDir, "my-own-skill")).isSymbolicLink(),
    "a user link outside the GSD skills root is left untouched",
  );
  assert.match(result.stdout, /removed gsd/);
});

// Codex spills additionalContext over its per-handler budget to a head-and-tail
// preview. The GSD bootstrap sits near the 2,500-token default, so the handler must
// pin a budget that delivers the bootstrap and capsule whole.
test("the GSD hook pins an additionalContext budget above Codex's spill default", () => {
  const { configDir, result } = runInstall();
  assert.equal(result.status, 0, result.stderr);

  const doc = JSON.parse(readFileSync(join(configDir, "hooks.json"), "utf8"));
  for (const event of ["SessionStart", "UserPromptSubmit"]) {
    const handler = doc.hooks[event]
      .flatMap((group) => group.hooks)
      .find((entry) => entry.command.includes("gsd-context.mjs"));
    assert.ok(handler, `${event} exposes the GSD handler`);
    assert.equal(
      handler.additionalContextLimit,
      6000,
      `${event} must pin a budget above Codex's 2,500-token spill default`,
    );
  }
});

test("an explicit [features] hooks = false in config.toml is reported as advisory", () => {
  const configDir = tempConfigDir();
  writeFileSync(join(configDir, "config.toml"), "[features]\nhooks = false\n");
  const result = runInstaller(["--config-dir", configDir, "--skills-dir", tempSkillsDir()]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /hooks = false/);
});

test("the deprecated codex_hooks = false alias is reported as advisory", () => {
  const configDir = tempConfigDir();
  writeFileSync(join(configDir, "config.toml"), "[features]\ncodex_hooks = false\n");
  const result = runInstaller(["--config-dir", configDir, "--skills-dir", tempSkillsDir()]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /hooks = false/);
});

// The Codex side of the installed-command check: install into a temp config, then
// execute the exact command hooks.json registers, from a checkout whose path has a
// space in it, and require the core's own bootstrap bytes on stdout.
test("the registered hook command runs and injects the core's bytes from a spaced checkout", () => {
  const spaceRoot = mkdtempSync(join(tmpdir(), "gsd codex install-"));
  mkdirSync(join(spaceRoot, "adapters"), { recursive: true });
  cpSync(join(ROOT, "lib"), join(spaceRoot, "lib"), { recursive: true });
  cpSync(join(ROOT, "skills"), join(spaceRoot, "skills"), { recursive: true });
  cpSync(join(ROOT, "adapters", "codex"), join(spaceRoot, "adapters", "codex"), {
    recursive: true,
  });

  const configDir = tempConfigDir();
  const install = spawnSync(
    process.execPath,
    [
      join(spaceRoot, "adapters", "codex", "install.mjs"),
      "--config-dir",
      configDir,
      "--skills-dir",
      tempSkillsDir(),
    ],
    { encoding: "utf8" },
  );
  assert.equal(install.status, 0, install.stderr);

  const doc = JSON.parse(readFileSync(join(configDir, "hooks.json"), "utf8"));
  const registered = doc.hooks.SessionStart.flatMap((group) => group.hooks)
    .map((handler) => handler.command)
    .find((command) => command.includes("gsd-context.mjs"));
  assert.ok(registered, "SessionStart must register the GSD hook command");

  const project = mkdtempSync(join(tmpdir(), "gsd-codex-project-"));
  const hook = spawnSync("sh", ["-c", registered], {
    input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "installed", cwd: project }),
    encoding: "utf8",
    cwd: project,
    env: { ...process.env, TMPDIR: mkdtempSync(join(tmpdir(), "gsd-codex-state-")) },
  });
  assert.equal(hook.status, 0, `the installed command must run: ${hook.stderr}`);
  assert.equal(
    JSON.parse(hook.stdout).hookSpecificOutput.additionalContext,
    createBootstrap(realpathSync(spaceRoot)),
    "the installed hook injects the core's exact bytes for its own root",
  );
});
