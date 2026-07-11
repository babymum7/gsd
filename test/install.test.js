import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function runInstaller(home, fakeBin) {
  return spawnSync("bash", ["install.sh"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
    },
  });
}

test("installer registers idempotently and refuses unmanaged collisions", () => {
  const temporary = mkdtempSync(join(tmpdir(), "gsd-install-"));
  const home = join(temporary, "home");
  const fakeBin = join(temporary, "bin");
  mkdirSync(home);
  mkdirSync(fakeBin);
  for (const command of ["git", "pnpm"]) {
    const path = join(fakeBin, command);
    writeFileSync(path, "#!/bin/sh\nexit 1\n");
    chmodSync(path, 0o755);
  }

  try {
    const first = runInstaller(home, fakeBin);
    assert.equal(first.status, 0, first.stderr);
    const commands = join(home, ".omp", "agent", "commands");
    const target = join(commands, "gsd.md");
    const installed = readFileSync(target, "utf8");
    assert.match(installed, /^<!-- gsd-managed-command:v1 -->$/m);
    assert.match(installed, new RegExp(`^GSD_ROOT=${JSON.stringify(ROOT).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
    assert.deepEqual(readdirSync(commands), ["gsd.md"]);

    const second = runInstaller(home, fakeBin);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(target, "utf8"), installed);

    writeFileSync(target, "user-owned command\n");
    const collision = runInstaller(home, fakeBin);
    assert.equal(collision.status, 1);
    assert.match(collision.stderr, /not managed by GSD/);
    assert.equal(readFileSync(target, "utf8"), "user-owned command\n");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("portable mktemp templates end in X", () => {
  const installer = readFileSync(join(ROOT, "install.sh"), "utf8");
  const lavish = readFileSync(join(ROOT, "skills", "gsd-lavish", "SKILL.md"), "utf8");
  assert.match(installer, /mktemp "\$\{OMP_COMMANDS_DIR\}\/gsd\.md\.XXXXXX"/);
  assert.doesNotMatch(installer, /mktemp [^\n]*XXXXXX\.[A-Za-z]/);
  assert.match(lavish, /mktemp "\$ARTIFACT_DIR\/\$\{STEM\}\.XXXXXX"/);
  assert.doesNotMatch(lavish, /mktemp [^\n]*XXXXXX\.[A-Za-z]/);
});
