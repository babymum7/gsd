import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import gsdContextExtension from "../adapters/omp/gsd-context.js";
import { createBootstrap, messageContainsBootstrap } from "../lib/gsd-bootstrap.mjs";
import {
  readSettings,
  renderSubagentProfiles,
  validateSettings,
  withSubagentProfiles,
  writeSettings,
} from "../lib/gsd-settings.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE_ROOT = realpathSync(ROOT);
const SPAWN_FIELD = {
  claude: "the Agent tool `model`",
  codex: "`spawn_agent` `model`",
  omp: "the task tool `agent`",
};
const render = (settings, host) => renderSubagentProfiles(settings, host, SPAWN_FIELD[host]);
const SETTINGS = {
  version: 1,
  profiles: {
    scout: { claude: "haiku", codex: "a6/glm-5.3-flash", omp: "scout" },
    worker: { claude: "sonnet", codex: "a6/grok-4.7", omp: "task" },
  },
};

function homeWith(settings) {
  const home = mkdtempSync(join(tmpdir(), "gsd-settings-home-"));
  if (settings) writeFileSync(join(home, "settings.json"), JSON.stringify(settings));
  return home;
}

function runHook(host, home) {
  const result = spawnSync(process.execPath, [join(ROOT, "adapters", host, "gsd-context.mjs")], {
    input: JSON.stringify({ hook_event_name: "SessionStart", session_id: `settings-${host}`, cwd: ROOT }),
    encoding: "utf8",
    env: { ...process.env, GSD_HOME: home, TMPDIR: mkdtempSync(join(tmpdir(), "gsd-settings-state-")) },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
}

test("the profile block names each set profile in canonical order with the host's spawn field", () => {
  assert.equal(
    render(SETTINGS, "claude"),
    "## Sub-agent profiles\nUser GSD settings; pass as the Agent tool `model` when spawning that profile: scout `haiku`, worker `sonnet`.",
  );
  assert.match(render(SETTINGS, "codex"), /pass as `spawn_agent` `model`/);
  assert.match(render(SETTINGS, "omp"), /pass as the task tool `agent`.*scout `scout`, worker `task`\.$/);
  assert.equal(
    render({ version: 1, profiles: { worker: { codex: "m" } } }, "claude"),
    "",
    "a host with no values gets no block",
  );
  assert.equal(render(null, "claude"), "");
});

test("an injected profile block stays small and keeps the bootstrap shape", () => {
  const bootstrap = createBootstrap(CORE_ROOT);
  assert.equal(withSubagentProfiles(bootstrap, ""), bootstrap);
  for (const host of ["claude", "codex", "omp"]) {
    const block = render(SETTINGS, host);
    // The block rides on every session's bootstrap, so it stays one line per host
    // beyond the heading; 40 words fits three profiles with long router model ids.
    const words = block.split(/\s+/).filter(Boolean).length;
    assert.ok(words <= 40, `${host} profile block has ${words} words`);
    const injected = withSubagentProfiles(bootstrap, block);
    assert.equal(messageContainsBootstrap({ content: injected }), true);
    assert.ok(injected.endsWith(`\n\n${block}\n</GSD_BOOTSTRAP>`));
  }
});

test("claude and codex hooks append the user's profiles and stay byte-identical without settings", () => {
  const bootstrap = createBootstrap(CORE_ROOT);
  for (const [dir, host] of [
    ["claude-code", "claude"],
    ["codex", "codex"],
  ]) {
    assert.equal(runHook(dir, homeWith(null)), bootstrap, `${dir} without settings`);
    assert.equal(
      runHook(dir, homeWith(SETTINGS)),
      withSubagentProfiles(bootstrap, render(SETTINGS, host)),
      `${dir} with settings`,
    );
    assert.equal(
      runHook(dir, homeWith({ version: 2 })),
      bootstrap,
      `${dir} invalid settings never block the bootstrap`,
    );
  }
});

test("the OMP context message carries the user's OMP agent profiles", async () => {
  const previous = process.env.GSD_HOME;
  process.env.GSD_HOME = homeWith(SETTINGS);
  try {
    const events = {};
    gsdContextExtension({
      on(event, handler) {
        events[event] = handler;
      },
      async sendMessage() {},
      logger: { error() {} },
    });
    const context = await events.context({
      messages: [{ role: "user", content: "first prompt", timestamp: 0 }],
    });
    assert.equal(
      context.messages[0].content,
      withSubagentProfiles(createBootstrap(CORE_ROOT), render(SETTINGS, "omp")),
    );
  } finally {
    if (previous === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = previous;
  }
});

test("settings read and write validate the schema", () => {
  const home = homeWith(null);
  assert.equal(readSettings(home), null);
  writeSettings(home, SETTINGS);
  assert.deepEqual(readSettings(home), SETTINGS);
  assert.throws(() => writeSettings(home, { version: 1, profiles: { scout: { Bad_Host: "x" } } }), /invalid host key scout\.Bad_Host/);
  assert.throws(() => validateSettings({ version: 1, extra: true }), /unknown key extra/);
  assert.throws(() => validateSettings({ version: 1, profiles: { scout: { claude: "" } } }), /value must be/);
  writeFileSync(join(home, "settings.json"), "{");
  assert.throws(() => readSettings(home), /invalid JSON/);
});

