import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { sessionFile, writeJsonAtomic, type SessionRecord } from "../src/paths.ts";

const ROOT = join(import.meta.dir, "..");
const CLI = join(ROOT, "src", "cli.ts");

function cliEnvironment(projectRoot: string): Record<string, string | undefined> {
  return { ...process.env, LAVISH_PROJECT_ROOT: projectRoot };
}

function runCli(args: string[], projectRoot: string) {
  return spawnSync("bun", [CLI, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: cliEnvironment(projectRoot),
  });
}

async function runCliAsync(args: string[], projectRoot: string) {
  const child = Bun.spawn(["bun", CLI, ...args], {
    cwd: projectRoot,
    env: cliEnvironment(projectRoot),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function sessionRecord(
  root: string,
  id: string,
  controlPort: number,
  sessionType: "prototype" | "app" = "app",
): SessionRecord {
  const now = new Date().toISOString();
  return {
    id,
    sessionType,
    projectRoot: root,
    target: sessionType === "prototype"
      ? { kind: "file", value: join(root, "prototype.html") }
      : { kind: "url", value: "http://fixture.test" },
    state: "ready",
    createdAt: now,
    updatedAt: now,
    profileDir: "/state/lavish/profile",
    controlPort,
    cdpPort: 9222,
    token: "test-control-token",
    pid: null,
  };
}

test("help exposes typed sessions and the attached poll contract", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lavish-cli-help-"));
  try {
    const result = runCli(["--help"], projectRoot);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /lavish prototype <file>/);
    assert.match(result.stdout, /lavish app <url>/);
    assert.match(result.stdout, /lavish poll <id>/);
    assert.doesNotMatch(result.stdout, /lavish open/);
    assert.match(result.stdout, /Bun/);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("sessions reports explicit empty and typed TOON results", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lavish-cli-sessions-"));
  try {
    const empty = runCli(["sessions"], projectRoot);
    assert.equal(empty.status, 0, empty.stderr);
    assert.match(empty.stdout, /sessions\[0\]/);
    assert.doesNotMatch(empty.stdout, /undefined|null/);

    const record = sessionRecord(projectRoot, "typed-session", 4321, "prototype");
    writeJsonAtomic(sessionFile(record.id, projectRoot), record);
    const populated = runCli(["sessions"], projectRoot);
    assert.equal(populated.status, 0, populated.stderr);
    assert.match(populated.stdout, /typed-session,prototype,ready/);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("poll sends the agent reply first and returns the delivered batch cursor", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lavish-cli-poll-"));
  let reply = "";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      assert.equal(request.headers.get("authorization"), "Bearer test-control-token");
      const url = new URL(request.url);
      if (url.pathname === "/reply" && request.method === "POST") {
        const body = await request.json() as { message?: string };
        reply = body.message ?? "";
        return Response.json({ status: "recorded" });
      }
      if (url.pathname === "/poll" && request.method === "GET") {
        assert.equal(url.searchParams.get("after"), "0");
        assert.equal(reply, "Applying the requested changes.");
        return Response.json({
          status: "feedback",
          cursor: 1,
          deliveries: [{
            cursor: 1,
            deliveryId: "delivery-0001",
            createdAt: "2026-07-23T00:00:00.000Z",
            items: [{
              draftId: "draft-0001",
              createdAt: "2026-07-23T00:00:00.000Z",
              comment: "Tighten this layout",
              anchor: null,
              attachments: [],
            }],
          }],
        });
      }
      return new Response("not found", { status: 404 });
    },
  });

  try {
    const record = sessionRecord(projectRoot, "poll-session", server.port);
    writeJsonAtomic(sessionFile(record.id, projectRoot), record);
    const result = await runCliAsync([
      "poll",
      record.id,
      "--after",
      "0",
      "--agent-reply",
      "Applying the requested changes.",
    ], projectRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /session:poll-session/);
    assert.match(result.stdout, /status:feedback/);
    assert.match(result.stdout, /cursor:1/);
    assert.match(result.stdout, /Tighten this layout/);
  } finally {
    server.stop(true);
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
