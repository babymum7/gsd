import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type SessionState = "starting" | "ready" | "ended" | "failed";

export interface SessionRecord {
  id: string;
  projectRoot: string;
  target: { kind: "url" | "file"; value: string };
  state: SessionState;
  createdAt: string;
  updatedAt: string;
  profileDir: string;
  controlPort: number | null;
  cdpPort: number | null;
  token: string;
  pid: number | null;
  error?: string;
}

export function projectRoot(): string {
  return resolve(process.env.LAVISH_PROJECT_ROOT || process.cwd());
}

export function runtimeRoot(root = projectRoot()): string {
  return join(root, ".lavish");
}

export function sessionsRoot(root = projectRoot()): string {
  return join(runtimeRoot(root), "sessions");
}

export function projectProfileRoot(root = projectRoot()): string {
  const stateRoot = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  const key = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 24);
  return join(stateRoot, "lavish", "profiles", key);
}

export function sessionDir(id: string, root = projectRoot()): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error("invalid session id");
  return join(sessionsRoot(root), id);
}

export function sessionFile(id: string, root = projectRoot()): string {
  return join(sessionDir(id, root), "session.json");
}

export function feedbackFile(id: string, root = projectRoot()): string {
  return join(sessionDir(id, root), "feedback.json");
}

export function ensureRuntimeDirs(root = projectRoot()): void {
  mkdirSync(sessionsRoot(root), { recursive: true, mode: 0o700 });
  mkdirSync(projectProfileRoot(root), { recursive: true, mode: 0o700 });
  for (const path of [runtimeRoot(root), sessionsRoot(root), projectProfileRoot(root)]) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`runtime path is not a real directory: ${path}`);
  }
}

export function writeJsonAtomic(path: string, value: unknown): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
}

export function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`runtime file is not regular: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
export function listSessionRecords(root = projectRoot()): SessionRecord[] {
  if (!existsSync(sessionsRoot(root))) return [];
  const entries = readdirSync(sessionsRoot(root), { withFileTypes: true }) as Dirent[];
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .flatMap((entry) => {
      try {
        const record = readJson<SessionRecord>(sessionFile(entry.name, root));
        return record ? [record] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
