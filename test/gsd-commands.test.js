import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_COMMANDS, errorRows, invocationOf } from "../lib/gsd-commands.mjs";

const TOOLS = join(dirname(fileURLToPath(import.meta.url)), "..", "tools");
const run = (tool, ...args) => spawnSync(process.execPath, [join(TOOLS, tool), ...args], { encoding: "utf8" });

// After a compaction agents recall a command but not its tool, so a command sent to the wrong
// tool says where it lives instead of only that it is unknown.
test("every tool names the tool that owns a command it does not have", () => {
  const cases = [
    ["gsd-git.mjs", "merge-message", /merge-message is a command of gsd-contract\.mjs/],
    ["gsd-state.mjs", "preflight", /preflight is a command of gsd-git\.mjs/],
    ["gsd-contract.mjs", "set", /set is a command of gsd-state\.mjs/],
    ["gsd-domain.mjs", "validate-plan", /validate-plan is a command of gsd-contract\.mjs/],
    ["gsd-record.mjs", "normalize", /normalize is a command of gsd-domain\.mjs/],
    ["gsd-git.mjs", "validate", /validate is a command of gsd-domain\.mjs or gsd-record\.mjs/],
  ];
  for (const [tool, command, expected] of cases) {
    const result = run(tool, command);
    assert.equal(result.status, 2, `${tool} ${command}: ${result.stdout}`);
    assert.match(result.stdout, /code: usage/);
    assert.match(result.stdout, expected, `${tool} ${command}: ${result.stdout}`);
  }
});

test("a command no tool has stays a plain unknown command", () => {
  const result = run("gsd-git.mjs", "frobnicate");
  assert.equal(result.status, 2);
  assert.match(result.stdout, /error: "unknown command: frobnicate"/);
});

test("each tool accepts exactly the commands the owner map gives it", () => {
  for (const [tool, commands] of Object.entries(TOOL_COMMANDS)) {
    for (const command of commands) {
      const result = run(tool, command, "--help");
      assert.doesNotMatch(result.stdout, /unknown command/, `${tool} ${command}: ${result.stdout}`);
    }
  }
});

// Every tool refusal opens with the same four rows, and each value is one JSON string, so a
// message holding a quote or a newline stays on its own row.
test("tool refusals share one row shape with JSON-quoted values", () => {
  assert.deepEqual(errorRows("usage", 'bad "flag"\nnext', 7), [
    "status: error",
    "code: usage",
    'error: "bad \\"flag\\"\\nnext"',
    'help: "7"',
  ]);
  assert.equal(invocationOf("/opt/g sd/tools/gsd-git.mjs"), 'bun "/opt/g sd/tools/gsd-git.mjs"');
});
