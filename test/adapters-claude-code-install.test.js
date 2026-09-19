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
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createBootstrap } from "../lib/gsd-bootstrap.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(ROOT, "adapters", "claude-code", "install.mjs");

function runInstaller(args) {
  return spawnSync(process.execPath, [INSTALLER, ...args], { encoding: "utf8" });
}

function tempConfigDir() {
  return mkdtempSync(join(tmpdir(), "gsd-cc-config-"));
}

// A constant read out of the installer source, so the README cannot describe a marker the
// installer no longer writes.
function installerConstant(source, name) {
  const match = source.match(new RegExp(`const ${name} = '([^']+)'`));
  assert.ok(match, `the installer must declare ${name}`);
  return match[1];
}

function readmeUninstallSection() {
  const section = readFileSync(join(ROOT, "README.md"), "utf8").match(
    /### Uninstalling a host adapter\n([\s\S]*?)(?=\n## )/,
  )?.[1];
  assert.ok(section, "the README must document uninstalling a host adapter");
  return section;
}

test("the README's uninstall steps name the markers and artifacts this adapter owns", () => {
  const section = readmeUninstallSection();
  const installer = readFileSync(INSTALLER, "utf8");
  const hookMarker = installerConstant(installer, "HOOK_MARKER");
  assert.ok(
    section.includes(hookMarker),
    `the uninstall steps must name the hook marker ${hookMarker}`,
  );
  // The agent definition is described by its rule - a link into this checkout - rather than
  // by file name, because `README.md` may not name the reviewer agent (session-owner
  // authority guard in test/skills-lifecycle.test.js).
  for (const artifact of ["settings.json", "skills/", "agents/"]) {
    assert.ok(section.includes(artifact), `the uninstall steps must name ${artifact}`);
  }
  assert.ok(
    readdirSync(join(ROOT, "adapters", "claude-code", "agents")).length > 0,
    "the adapter must ship the definitions that rule removes",
  );
});

test("dry-run plans the hooks without writing anything", () => {
  const configDir = tempConfigDir();
  const result = runInstaller(["--config-dir", configDir, "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SessionStart/);
  assert.match(result.stdout, /gsd-context\.mjs/);
  assert.equal(existsSync(join(configDir, "settings.json")), false);
  assert.equal(existsSync(join(configDir, "skills")), false);
});

test("install registers the lifecycle hooks, links skills, and preserves existing settings", () => {
  const configDir = tempConfigDir();
  writeFileSync(
    join(configDir, "settings.json"),
    JSON.stringify(
      {
        model: "keep-me",
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }],
        },
      },
      null,
      2,
    ),
  );

  const result = runInstaller(["--config-dir", configDir]);
  assert.equal(result.status, 0, result.stderr);

  const settings = JSON.parse(readFileSync(join(configDir, "settings.json"), "utf8"));
  assert.equal(settings.model, "keep-me", "unrelated settings are preserved");
  for (const event of ["SessionStart", "UserPromptSubmit"]) {
    assert.ok(Array.isArray(settings.hooks[event]), `${event} hooks are registered`);
  }
  assert.match(
    settings.hooks.SessionStart[0].hooks[0].command,
    /echo hi/,
    "the pre-existing hook group stays first",
  );
  assert.ok(
    settings.hooks.SessionStart.some((group) =>
      group.hooks.some((handler) => handler.command.includes("gsd-context.mjs")),
    ),
    "the GSD hook is appended without dropping the existing group",
  );

  assert.ok(
    lstatSync(join(configDir, "skills", "gsd-brainstorming")).isSymbolicLink(),
    "visible skills are published",
  );
  assert.equal(
    existsSync(join(configDir, "skills", "gsd")),
    false,
    "the hidden gsd master must not be published",
  );
  assert.equal(
    existsSync(join(configDir, "skills", "gsd-ponytail")),
    false,
    "the hidden ponytail context must not be published",
  );
  assert.ok(lstatSync(join(configDir, "agents", "gsd-reviewer.md")).isSymbolicLink());
});

test("re-running the installer is idempotent", () => {
  const configDir = tempConfigDir();
  assert.equal(runInstaller(["--config-dir", configDir]).status, 0);
  assert.equal(runInstaller(["--config-dir", configDir]).status, 0);

  const settings = JSON.parse(readFileSync(join(configDir, "settings.json"), "utf8"));
  for (const event of ["SessionStart", "UserPromptSubmit"]) {
    const gsdGroups = settings.hooks[event].filter((group) =>
      group.hooks.some((handler) => handler.command.includes("gsd-context.mjs")),
    );
    assert.equal(gsdGroups.length, 1, `${event} keeps exactly one GSD hook group`);
  }
});

test("re-installing prunes the retired PreCompact hook group and keeps user groups", () => {
  const configDir = tempConfigDir();
  writeFileSync(
    join(configDir, "settings.json"),
    JSON.stringify({
      hooks: {
        PreCompact: [
          {
            hooks: [
              {
                type: "command",
                command: "bun /repo/adapters/claude-code/gsd-context.mjs",
              },
            ],
          },
          { hooks: [{ type: "command", command: "echo keep" }] },
        ],
      },
    }),
  );

  const result = runInstaller(["--config-dir", configDir]);
  assert.equal(result.status, 0, result.stderr);
  const settings = JSON.parse(readFileSync(join(configDir, "settings.json"), "utf8"));
  assert.equal(settings.hooks.PreCompact.length, 1, "the retired GSD group is pruned");
  assert.match(settings.hooks.PreCompact[0].hooks[0].command, /echo keep/);
  for (const event of ["SessionStart", "UserPromptSubmit"]) {
    assert.ok(Array.isArray(settings.hooks[event]), `${event} hooks are registered`);
  }
});

test("re-installing removes a stale managed link to a hidden skill and keeps user links", () => {
  const configDir = tempConfigDir();
  const skillsDir = join(configDir, "skills");
  mkdirSync(skillsDir, { recursive: true });
  symlinkSync(join(ROOT, "skills", "gsd-ponytail"), join(skillsDir, "gsd-ponytail"), "dir");
  const userSkill = mkdtempSync(join(tmpdir(), "gsd-user-skill-"));
  symlinkSync(userSkill, join(skillsDir, "my-own-skill"), "dir");

  const result = runInstaller(["--config-dir", configDir]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    existsSync(join(skillsDir, "gsd-ponytail")),
    false,
    "a managed link to a hidden skill is removed",
  );
  assert.ok(
    lstatSync(join(skillsDir, "my-own-skill")).isSymbolicLink(),
    "a user link outside the GSD skills root is left untouched",
  );
  assert.match(result.stdout, /removed gsd-ponytail/);
});

// Installing is only half the contract: the command the installer registers has to
// run. The core and the adapter are copied into a checkout whose path contains a
// space, so this also covers the shell quoting of the hook path, which the
// marker-match assertions above cannot see.
test("the registered hook command runs and injects the core's bytes from a spaced checkout", () => {
  const spaceRoot = mkdtempSync(join(tmpdir(), "gsd cc install-"));
  mkdirSync(join(spaceRoot, "adapters"), { recursive: true });
  cpSync(join(ROOT, "lib"), join(spaceRoot, "lib"), { recursive: true });
  cpSync(join(ROOT, "skills"), join(spaceRoot, "skills"), { recursive: true });
  cpSync(
    join(ROOT, "adapters", "claude-code"),
    join(spaceRoot, "adapters", "claude-code"),
    { recursive: true },
  );

  const configDir = tempConfigDir();
  const install = spawnSync(
    process.execPath,
    [join(spaceRoot, "adapters", "claude-code", "install.mjs"), "--config-dir", configDir],
    { encoding: "utf8" },
  );
  assert.equal(install.status, 0, install.stderr);

  const settings = JSON.parse(readFileSync(join(configDir, "settings.json"), "utf8"));
  const registered = settings.hooks.SessionStart.flatMap((group) => group.hooks)
    .map((handler) => handler.command)
    .find((command) => command.includes("gsd-context.mjs"));
  assert.ok(registered, "SessionStart must register the GSD hook command");

  const project = mkdtempSync(join(tmpdir(), "gsd-cc-project-"));
  const hook = spawnSync("sh", ["-c", registered], {
    input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "installed", cwd: project }),
    encoding: "utf8",
    cwd: project,
    env: { ...process.env, TMPDIR: mkdtempSync(join(tmpdir(), "gsd-cc-state-")) },
  });
  assert.equal(hook.status, 0, `the installed command must run: ${hook.stderr}`);
  assert.equal(
    JSON.parse(hook.stdout).hookSpecificOutput.additionalContext,
    createBootstrap(realpathSync(spaceRoot)),
    "the installed hook injects the core's exact bytes for its own root",
  );
});
