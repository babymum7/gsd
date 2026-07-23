import { test } from "bun:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CdpClient } from "../src/cdp/client.ts";
import { readJson, sessionFile, writeJsonAtomic, type SessionRecord } from "../src/paths.ts";
import { runDaemon } from "../src/session.ts";

test("CDP client correlates responses and forwards events", async () => {
  const seen: string[] = [];
  const eventGate = Promise.withResolvers<void>();
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response("upgrade required", { status: 426 });
    },
    websocket: {
      open() {},
      message(ws, raw) {
        const request = JSON.parse(String(raw)) as { id: number; method: string };
        ws.send(JSON.stringify({ id: request.id, result: { method: request.method } }));
        ws.send(JSON.stringify({ method: "Test.event", params: { value: "delivered" } }));
      },
    },
  });
  try {
    const client = new CdpClient(`ws://127.0.0.1:${server.port}`);
    client.on("Test.event", (params) => {
      seen.push(String(params.value));
      eventGate.resolve();
    });
    await client.connect();
    const result = await client.request<{ method: string }>("Test.echo");
    assert.deepEqual(result, { method: "Test.echo" });
    await eventGate.promise;
    assert.deepEqual(seen, ["delivered"]);
    client.close();
  } finally {
    server.stop(true);
  }
});

test("CDP client can reconnect after a failed handshake", async () => {
  const reservation = Bun.serve({ port: 0, fetch: () => new Response("reserved") });
  const port = reservation.port;
  reservation.stop(true);

  const client = new CdpClient(`ws://127.0.0.1:${port}`);
  await assert.rejects(client.connect(), /CDP connection (failed|closed)/);

  const server = Bun.serve({
    port,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response("upgrade required", { status: 426 });
    },
    websocket: {
      message(ws, raw) {
        const request = JSON.parse(String(raw)) as { id: number };
        ws.send(JSON.stringify({ id: request.id, result: { reconnected: true } }));
      },
    },
  });
  try {
    await client.connect();
    const result = await client.request<{ reconnected: boolean }>("Test.reconnect");
    assert.deepEqual(result, { reconnected: true });
    client.close();
  } finally {
    server.stop(true);
  }
});

test("session launch failure stops Chromium and records failed state", async () => {
  const root = mkdtempSync(join(tmpdir(), "lavish-cdp-failure-"));
  const browser = join(root, "fake-browser");
  const pidFile = join(root, "browser.pid");
  writeFileSync(browser, `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
const port = Number(process.argv.find((arg) => arg.startsWith("--remote-debugging-port="))?.split("=")[1]);
writeFileSync(process.env.LAVISH_FAKE_PID_FILE, String(process.pid));
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === "/json/version") {
      return Response.json({ webSocketDebuggerUrl: \`ws://127.0.0.1:\${port}/devtools/browser/fake\` });
    }
    if (url.pathname === "/json/list") return Response.json([]);
    if (server.upgrade(request)) return;
    return new Response("not found", { status: 404 });
  },
  websocket: { message() {} },
});
await Promise.withResolvers().promise;
server.stop(true);
`);
  chmodSync(browser, 0o755);

  const now = new Date().toISOString();
  const record: SessionRecord = {
    id: "failed-session",
    projectRoot: root,
    target: { kind: "url", value: "http://127.0.0.1:3000" },
    state: "starting",
    createdAt: now,
    updatedAt: now,
    profileDir: "",
    controlPort: null,
    cdpPort: null,
    token: "test-token",
    pid: null,
  };
  writeJsonAtomic(sessionFile(record.id, root), record);

  const previousBrowser = process.env.LAVISH_BROWSER;
  const previousPidFile = process.env.LAVISH_FAKE_PID_FILE;
  const previousTimeout = process.env.LAVISH_CDP_TIMEOUT_MS;
  const previousState = process.env.XDG_STATE_HOME;
  process.env.LAVISH_BROWSER = browser;
  process.env.LAVISH_FAKE_PID_FILE = pidFile;
  process.env.LAVISH_CDP_TIMEOUT_MS = "1000";
  process.env.XDG_STATE_HOME = join(root, "state");
  try {
    await assert.rejects(runDaemon(record.id, root), /timed out waiting for browser page/);
    const failed = readJson<SessionRecord>(sessionFile(record.id, root));
    assert.equal(failed?.state, "failed");
    assert.match(failed?.error ?? "", /timed out waiting for browser page/);
    const pid = Number(readFileSync(pidFile, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    if (previousBrowser === undefined) delete process.env.LAVISH_BROWSER;
    else process.env.LAVISH_BROWSER = previousBrowser;
    if (previousPidFile === undefined) delete process.env.LAVISH_FAKE_PID_FILE;
    else process.env.LAVISH_FAKE_PID_FILE = previousPidFile;
    if (previousTimeout === undefined) delete process.env.LAVISH_CDP_TIMEOUT_MS;
    else process.env.LAVISH_CDP_TIMEOUT_MS = previousTimeout;
    if (previousState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousState;
    rmSync(root, { recursive: true, force: true });
  }
});
