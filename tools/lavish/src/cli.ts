import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ensureRuntimeDirs,
  listSessionRecords,
  projectRoot,
  readJson,
  sessionDir,
  sessionFile,
  writeJsonAtomic,
  type SessionRecord,
  type SessionType,
} from "./paths.ts";
import { readFeedback } from "./feedback/store.ts";
import { launchDaemon, runDaemon, stopSession } from "./session.ts";
import { writeToon, writeToonError, type ToonValue } from "./toon.ts";

const HELP = `lavish — Bun-native live app feedback tool

Commands:
  lavish prototype <file>       Serve a local HTML prototype in Chromium
  lavish app <url>              Open a live app directly in Chromium
  lavish sessions               List project sessions
  lavish poll <id> [options]    Wait for Send now feedback
  lavish feedback <id>          Read delivered feedback and agent replies
  lavish end <id>               End a review session

Poll options:
  --after <cursor>              Return deliveries after this cursor (default: 0)
  --after-reply <cursor>        Return replies after this cursor (default: 0)
  --timeout-ms <milliseconds>   Wait for 10–300000ms (default: 300000)
  --agent-reply <message>       Publish an agent reply before waiting again

Every command is non-interactive. Data goes to stdout as TOON; diagnostics go to stderr.
Requires Bun 1.2 or newer.
`;

function usageError(message: string): never {
  writeToonError("usage", message, "Run lavish --help for the command reference.");
  process.exitCode = 2;
  throw new Error(message);
}

function sessionRows(root: string): ToonValue[] {
  return listSessionRecords(root).map((record) => ({
    id: record.id,
    type: record.sessionType,
    state: record.state,
    target: record.target.value,
  }));
}

function renderHome(root: string): void {
  writeToon({
    bin: "tools/lavish",
    description: "Review live apps and HTML prototypes with interactive feedback and image attachments",
    sessions: sessionRows(root),
  });
}

function readId(args: string[], command: string): string {
  const id = args[0];
  if (!id || id.startsWith("-")) usageError(`lavish ${command} requires a session id`);
  return id;
}

function requireSession(id: string, root: string): SessionRecord | null {
  const record = readJson<SessionRecord>(sessionFile(id, root));
  if (!record) {
    writeToonError("session_not_found", `Unknown session: ${id}`);
    process.exitCode = 1;
    return null;
  }
  return record;
}

function normalizeTarget(sessionType: SessionType, value: string): SessionRecord["target"] {
  if (sessionType === "prototype") {
    const file = resolve(value);
    if (!existsSync(file)) throw new Error(`HTML file does not exist: ${file}`);
    return { kind: "file", value: file };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`invalid app URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("app URL must use http or https");
  }
  return { kind: "url", value: url.toString() };
}

async function openSession(sessionType: SessionType, args: string[], root: string): Promise<void> {
  if (args.length !== 1 || !args[0] || args[0].startsWith("-")) {
    usageError(`lavish ${sessionType} requires exactly one ${sessionType === "prototype" ? "HTML file" : "URL"}`);
  }
  let target: SessionRecord["target"];
  try {
    target = normalizeTarget(sessionType, args[0]);
  } catch (error) {
    writeToonError("invalid_target", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const record: SessionRecord = {
    id,
    sessionType,
    projectRoot: root,
    target,
    state: "starting",
    createdAt: now,
    updatedAt: now,
    profileDir: "",
    controlPort: null,
    cdpPort: null,
    token: randomUUID(),
    pid: null,
  };
  ensureRuntimeDirs(root);
  const directory = sessionDir(id, root);
  writeJsonAtomic(sessionFile(id, root), record);
  const updated = await launchDaemon(record, directory);
  writeToon({
    session: {
      id: updated.id,
      type: updated.sessionType,
      state: updated.state,
      target: updated.target.value,
      control_port: updated.controlPort ?? 0,
    },
    next_step: `lavish poll ${updated.id} --after 0 --after-reply 0`,
  });
}

function listSessions(root: string): void {
  writeToon({ sessions: sessionRows(root) });
}

function showFeedback(args: string[], root: string): void {
  const id = readId(args, "feedback");
  const record = requireSession(id, root);
  if (!record) return;
  const result = readFeedback(id, root);
  writeToon({
    session: id,
    cursor: result.cursor,
    reply_cursor: result.replyCursor,
    deliveries: result.deliveries as unknown as ToonValue,
    replies: result.replies as unknown as ToonValue,
  });
}

interface PollOptions {
  id: string;
  after: number;
  afterReply: number;
  timeoutMs: number;
  agentReply: string | null;
}

function pollOptions(args: string[]): PollOptions {
  const id = readId(args, "poll");
  let after = 0;
  let afterReply = 0;
  let timeoutMs = 300_000;
  let agentReply: string | null = null;
  for (let index = 1; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (!["--after", "--after-reply", "--timeout-ms", "--agent-reply"].includes(option)) {
      usageError(`unknown poll option: ${option}`);
    }
    if (value === undefined) usageError(`${option} requires a value`);
    index += 1;
    if (option === "--agent-reply") {
      agentReply = value.trim();
      if (!agentReply) usageError("--agent-reply must not be empty");
      continue;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) usageError(`${option} requires a non-negative integer`);
    if (option === "--after") after = parsed;
    else if (option === "--after-reply") afterReply = parsed;
    else timeoutMs = parsed;
  }
  if (timeoutMs < 10 || timeoutMs > 300_000) usageError("--timeout-ms must be between 10 and 300000");
  return { id, after, afterReply, timeoutMs, agentReply };
}

async function controlRequest(record: SessionRecord, path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`http://127.0.0.1:${record.controlPort}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${record.token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Lavish control request failed (${response.status}): ${body.slice(0, 1000)}`);
  }
  return response;
}

async function pollSession(args: string[], root: string): Promise<void> {
  const options = pollOptions(args);
  const record = requireSession(options.id, root);
  if (!record) return;
  if (record.state !== "ready" || !record.controlPort) {
    writeToonError("session_not_ready", `Session ${record.id} is ${record.state}`);
    process.exitCode = 1;
    return;
  }
  if (options.agentReply) {
    await controlRequest(record, "/reply", {
      method: "POST",
      body: JSON.stringify({ message: options.agentReply }),
    });
  }
  const query = new URLSearchParams({
    after: String(options.after),
    afterReply: String(options.afterReply),
    timeoutMs: String(options.timeoutMs),
  });
  const response = await controlRequest(record, `/poll?${query}`);
  const result = await response.json() as {
    status: string;
    cursor: number;
    replyCursor?: number;
    deliveries?: unknown[];
    replies?: unknown[];
  };
  const replyCursor = result.replyCursor ?? options.afterReply;
  const next = `lavish poll ${record.id} --after ${result.cursor} --after-reply ${replyCursor}`;
  writeToon({
    session: record.id,
    status: result.status,
    cursor: result.cursor,
    reply_cursor: replyCursor,
    deliveries: (result.deliveries ?? []) as ToonValue,
    replies: (result.replies ?? []) as ToonValue,
    next_step: result.status === "feedback"
      ? `${next} --agent-reply "<agent reply>"`
      : next,
  });
}

async function endSession(args: string[], root: string): Promise<void> {
  const id = readId(args, "end");
  const record = requireSession(id, root);
  if (!record) return;
  if (record.state === "ended") {
    writeToon({ session: { id, state: "ended", result: "already ended" } });
    return;
  }
  const ended = await stopSession(record);
  writeToon({ session: { id: ended.id, state: ended.state } });
}

async function main(): Promise<void> {
  const root = projectRoot();
  const args = process.argv.slice(2);
  const command = args.shift();
  if (!command) {
    renderHome(root);
    return;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "sessions") return listSessions(root);
  if (command === "prototype" || command === "app") return openSession(command, args, root);
  if (command === "poll") return pollSession(args, root);
  if (command === "feedback") return showFeedback(args, root);
  if (command === "end") return endSession(args, root);
  if (command === "daemon") {
    const idIndex = args.indexOf("--id");
    const id = args[idIndex + 1];
    if (!id) usageError("daemon requires --id");
    await runDaemon(id, root);
    return;
  }
  usageError(`unknown command: ${command}`);
}

main().catch((error: unknown) => {
  if (process.exitCode !== 2) {
    writeToonError("internal", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
});
