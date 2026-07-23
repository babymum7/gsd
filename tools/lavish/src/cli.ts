import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  ensureRuntimeDirs,
  listSessionRecords,
  projectRoot,
  readJson,
  sessionDir,
  sessionFile,
  writeJsonAtomic,
  type SessionRecord,
} from "./paths.ts";
import { readFeedback } from "./feedback/store.ts";
import { launchDaemon, runDaemon, stopSession } from "./session.ts";
import { writeToon, writeToonError, type ToonValue } from "./toon.ts";

const HELP = `lavish — Bun-native live app feedback tool

Commands:
  lavish open --url <url>       Open a live app in an isolated Chromium session
  lavish open --file <path>     Serve and open a local HTML file
  lavish sessions               List sessions in the current project
  lavish feedback <id>          Read queued feedback for a session
  lavish end <id>               End a review session

Every command is non-interactive. Data goes to stdout as TOON; diagnostics go to stderr.
`;

function usageError(message: string): never {
  writeToonError("usage", message, "Run lavish --help for the command reference.");
  process.exitCode = 2;
  throw new Error(message);
}

function sessionRows(root: string): ToonValue[] {
  return listSessionRecords(root).map((record) => ({
    id: record.id,
    state: record.state,
    target: record.target.value,
  }));
}

function renderHome(root: string): void {
  const sessions = sessionRows(root);
  writeToon({
    bin: "tools/lavish",
    description: "Review live apps and HTML files with interactive feedback and image attachments",
    sessions,
  });
}

function readId(args: string[], command: string): string {
  const id = args[0];
  if (!id || id.startsWith("-")) usageError(`lavish ${command} requires a session id`);
  return id;
}

async function openSession(args: string[], root: string): Promise<void> {
  const urlIndex = args.indexOf("--url");
  const fileIndex = args.indexOf("--file");
  if ((urlIndex >= 0) === (fileIndex >= 0)) {
    usageError("open requires exactly one of --url or --file");
  }
  const kind = urlIndex >= 0 ? "url" : "file";
  const index = urlIndex >= 0 ? urlIndex : fileIndex;
  const target = args[index + 1];
  if (!target || target.startsWith("-")) usageError(`open ${kind} requires a value`);
  if (kind === "file" && !existsSync(target)) {
    writeToonError("target_not_found", `HTML file does not exist: ${target}`);
    process.exitCode = 1;
    return;
  }

  const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const record: SessionRecord = {
    id,
    projectRoot: root,
    target: { kind, value: target },
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
      state: updated.state,
      target: updated.target.value,
      control_port: updated.controlPort ?? 0,
    },
  });
}

function listSessions(root: string): void {
  writeToon({ sessions: sessionRows(root) });
}

async function showFeedback(args: string[], root: string): Promise<void> {
  const id = readId(args, "feedback");
  const record = readJson<SessionRecord>(sessionFile(id, root));
  if (!record) {
    writeToonError("session_not_found", `Unknown session: ${id}`);
    process.exitCode = 1;
    return;
  }
  const result = readFeedback(id, root);
  writeToon({
    session: id,
    cursor: result.cursor,
    feedback: result.items as unknown as ToonValue,
  });
}

async function endSession(args: string[], root: string): Promise<void> {
  const id = readId(args, "end");
  const record = readJson<SessionRecord>(sessionFile(id, root));
  if (!record) {
    writeToonError("session_not_found", `Unknown session: ${id}`);
    process.exitCode = 1;
    return;
  }
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
  if (command === "sessions") {
    listSessions(root);
    return;
  }
  if (command === "open") {
    await openSession(args, root);
    return;
  }
  if (command === "feedback") {
    await showFeedback(args, root);
    return;
  }
  if (command === "end") {
    await endSession(args, root);
    return;
  }
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
