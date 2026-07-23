import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..");
const CLI = join(ROOT, "src", "cli.ts");

function runCli(args: string[], projectRoot: string) {
  return spawnSync("bun", [CLI, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, LAVISH_PROJECT_ROOT: projectRoot },
  });
}

test("help exposes the direct Bun CLI contract", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lavish-cli-help-"));
  try {
    const result = runCli(["--help"], projectRoot);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /lavish open/);
    assert.match(result.stdout, /lavish feedback/);
    assert.match(result.stdout, /Bun/);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("sessions reports an explicit empty TOON result", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lavish-cli-sessions-"));
  try {
    const result = runCli(["sessions"], projectRoot);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /sessions\[0\]/);
    assert.doesNotMatch(result.stdout, /undefined|null/);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
