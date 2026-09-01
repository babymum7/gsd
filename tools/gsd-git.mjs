#!/usr/bin/env bun
// Observed Git state, never asserted Git state. Base derivation and the pre-squash gate were
// prose-only rules, so nothing could tell a session that followed them from one that assumed
// `main`. This tool answers both questions from the work tree and never writes: every Git
// invocation goes through `git()`, which admits only the exact argv shapes below.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { isSafeBranchRef, PLAN_FILE_MAX_BYTES } from "../lib/gsd-contract.mjs";
import { inspectStateFile } from "../lib/gsd-state.mjs";

const COMMANDS = new Set(["derive-base", "preflight"]);
const VALUE_FLAGS = new Set(["--feature-dir", "--cwd"]);

// A subcommand name is not a permission: `git symbolic-ref <name> <ref>` writes a ref and
// `git symbolic-ref --delete <name>` removes one, so the boundary is the whole argv. These
// five shapes are every query this tool makes; `show-ref` is the one with a variable
// argument and is handled below. `status` runs under `--no-optional-locks` so that reading
// the tree cannot even refresh the index's stat cache.
const READ_ONLY = new Set([
  "rev-parse --is-inside-work-tree",
  "rev-parse --show-toplevel",
  "symbolic-ref --quiet --short HEAD",
  "--no-optional-locks status --porcelain=v1 --untracked-files=all -z",
  "worktree list --porcelain",
]);
const BRANCH_REF_PREFIX = "refs/heads/";

export function assertReadOnlyGit(args) {
  const shape = args.join(" ");
  if (READ_ONLY.has(shape)) return;
  const branch = args.length === 4 && args[3].startsWith(BRANCH_REF_PREFIX)
    ? args[3].slice(BRANCH_REF_PREFIX.length)
    : null;
  if (
    branch !== null &&
    args[0] === "show-ref" &&
    args[1] === "--verify" &&
    args[2] === "--quiet" &&
    isSafeBranchRef(branch)
  ) {
    return;
  }
  throw new Error(`refusing a Git invocation that is not an allowed read-only query: git ${shape}`);
}

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const INVOCATION = `bun ${JSON.stringify(SCRIPT_PATH)}`;

function write_(lines) {
  process.stdout.write(lines.join("\n") + "\n");
}

function commandUsage(command) {
  if (command === "derive-base") return `${INVOCATION} derive-base [--cwd <dir>]`;
  if (command === "preflight") return `${INVOCATION} preflight --feature-dir .scratch/<feature> [--cwd <dir>]`;
  return `${INVOCATION} <derive-base|preflight> [options]`;
}

function emitHelp(command) {
  if (command === "derive-base") {
    write_([
      "Usage: " + commandUsage(command),
      "",
      "Print the branch a packet must record as its base: the branch checked out in this",
      "work tree, so a linked worktree derives its own branch. A detached HEAD is blocked",
      "rather than reported as a commit oid, because a commit can receive no squash.",
      "",
      "Options:",
      "  --cwd <dir>    Work tree to inspect (default: current directory)",
      "",
      "Exit codes: 0 = a branch was derived, 1 = blocked, 2 = usage error",
    ]);
    return;
  }
  if (command === "preflight") {
    write_([
      "Usage: " + commandUsage(command),
      "",
      "Verify the recorded Git identity still holds before a terminal squash. Reads",
      "state.toon without migrating it and checks that:",
      "",
      "  - HEAD is attached, so every commit made is on a branch",
      "  - base_ref and wip_branch are recorded and usable branch names",
      "  - base_ref resolves to a local branch able to receive the merge",
      "  - base_ref is not checked out in another linked worktree",
      "  - wip_branch resolves to a local branch",
      "  - no path outside .scratch/ is uncommitted, staged, or untracked",
      "",
      "Blocked means the gate stops; it never retargets the merge.",
      "",
      "Options:",
      "  --feature-dir <dir>    Feature directory (.scratch/<feature>) (required)",
      "  --cwd <dir>            Work tree to inspect (default: current directory)",
      "",
      "Exit codes: 0 = ready, 1 = blocked, 2 = usage error",
    ]);
    return;
  }
  write_([
    "Usage: " + commandUsage(null),
    "",
    "Commands:",
    "  derive-base   Print the branch this work tree is on, for plan.md Base and base_ref",
    "  preflight     Prove the recorded base and WIP branch still hold before squashing",
    "",
    "This tool only ever reads: it runs no Git subcommand that can change a repository.",
    "",
    "Use --help <command> for command-specific help.",
  ]);
}

function failUsage(message, command = null) {
  write_(["status: error", "code: usage", `error: ${JSON.stringify(message)}`, `help: ${JSON.stringify(commandUsage(command))}`]);
  process.exit(2);
}

function blocked(code, message) {
  write_(["status: blocked", `code: ${code}`, `error: ${JSON.stringify(message)}`, "exit=1"]);
  process.exit(1);
}

function git(args, cwd) {
  // The read-only boundary is enforced here rather than by review, and a rejected shape is a
  // defect rather than repository drift: it throws instead of emitting a blocked record.
  assertReadOnlyGit(args);
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if (result.error) blocked("git-unavailable", `git cannot be executed: ${result.error.message}`);
  const stdout = result.stdout ?? "";
  // `raw` matters for `status --porcelain -z`, whose records begin with a significant space.
  return { status: result.status, stdout: stdout.trim(), raw: stdout };
}

function requireWorkTree(cwd) {
  const probe = git(["rev-parse", "--is-inside-work-tree"], cwd);
  if (probe.status !== 0 || probe.stdout !== "true") {
    blocked("not-a-work-tree", `${cwd} is not inside a Git work tree`);
  }
}

// A branch name from state reaches Git as an argument. State validation already shapes it, but
// a packet written by an older version never went through that check, so verify here too and
// address refs by full path so a leading dash can never read as an option.
function requireBranchName(value, field) {
  if (!isSafeBranchRef(value)) {
    blocked("unusable-branch-name", `${field} is not a Git branch name able to receive a merge: ${value}`);
  }
  return value;
}

function localBranchExists(branch, cwd) {
  return git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], cwd).status === 0;
}

function checkedOutElsewhere(branch, cwd) {
  const listing = git(["worktree", "list", "--porcelain"], cwd);
  const self = git(["rev-parse", "--show-toplevel"], cwd);
  // A query that did not answer proves nothing. Returning "no conflict" here would let the
  // gate report ready without ever establishing that the base is free to be checked out.
  if (listing.status !== 0 || self.status !== 0) {
    blocked(
      "git-query-failed",
      `git could not report this repository's worktrees, so base_ref ${branch} cannot be proven free to receive the squash`,
    );
  }
  let current = null;
  for (const line of listing.stdout.split("\n")) {
    if (line.startsWith("worktree ")) current = line.slice(9);
    else if (line === `branch refs/heads/${branch}` && current !== null && current !== self.stdout) {
      return current;
    }
  }
  return null;
}

// Canon requires the reviewed non-scratch tree to match the recorded binding before the
// squash. It is not cosmetic: the commit that follows `git merge --squash` commits the whole
// index, so anything staged outside `.scratch/` rides into the squash without being reviewed
// or covered by the conformance run, which proved only the current commit.
function dirtyNonScratchPaths(cwd) {
  const report = git(
    ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all", "-z"],
    cwd,
  );
  if (report.status !== 0) {
    blocked("git-query-failed", "git could not report the working tree state, so it cannot be proven reviewed");
  }
  const records = report.raw.split("\0").filter((record) => record !== "");
  const dirty = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const paths = [record.slice(3)];
    // An index-side rename or copy reports its destination and carries its origin as the
    // following record. Both are affected: `git mv src/app.js .scratch/<feature>/app.js`
    // names only a scratch destination while staging the removal of a reviewed file, so
    // reading the destination alone would clear a squash that deletes reviewed work.
    if ((record[0] === "R" || record[0] === "C") && index + 1 < records.length) {
      index += 1;
      paths.push(records[index]);
    }
    for (const path of paths) if (!path.startsWith(".scratch/")) dirty.add(path);
  }
  return [...dirty];
}

function deriveBase(cwd) {
  requireWorkTree(cwd);
  const head = git(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
  if (head.status !== 0 || head.stdout === "") {
    blocked(
      "detached-head",
      "HEAD is detached, so no branch can hold this packet's squash: check out or create the branch this work belongs on, then derive the base again",
    );
  }
  return requireBranchName(head.stdout, "the checked-out branch");
}

function parseArguments(argv) {
  const result = { command: null, help: false, featureDir: null, cwd: process.cwd() };
  let index = 0;
  if (argv[index] === "--help" || argv[index] === "-h") {
    result.help = true;
    index += 1;
  }
  if (index < argv.length && !argv[index].startsWith("-")) {
    result.command = argv[index];
    index += 1;
  }
  if (result.help) return result;

  while (index < argv.length) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      result.help = true;
      index += 1;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) failUsage(`unknown argument: ${flag}`, result.command);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) failUsage(`${flag} requires a value`, result.command);
    if (flag === "--feature-dir") result.featureDir = value;
    else result.cwd = value;
    index += 2;
  }

  if (!result.command) result.usageError = "missing command";
  else if (!COMMANDS.has(result.command)) result.usageError = `unknown command: ${result.command}`;
  else if (result.command === "preflight" && result.featureDir === null) {
    result.usageError = "--feature-dir is required";
  }
  return result;
}

function readBoundedFile(filePath, maxBytes, label) {
  let lst;
  try {
    lst = lstatSync(filePath);
  } catch (error) {
    throw new Error(`${label}: cannot inspect file (${error.message})`);
  }
  if (lst.isSymbolicLink()) throw new Error(`${label}: symlink rejected`);
  if (!lst.isFile()) throw new Error(`${label}: expected a regular file`);
  if (lst.size > maxBytes) {
    throw new Error(`${label}: exceeds size limit of ${maxBytes} bytes`);
  }
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK;
  let fd;
  try {
    fd = openSync(filePath, flags);
  } catch (error) {
    if (error.code === "ELOOP") throw new Error(`${label}: symlink rejected`);
    if (error.code === "ENOENT") throw new Error(`${label}: file not found`);
    throw new Error(`${label}: cannot open file (${error.message})`);
  }
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile()) throw new Error(`${label}: expected a regular file`);
    if (opened.dev !== lst.dev || opened.ino !== lst.ino) {
      throw new Error(`${label}: file identity changed before open`);
    }
    if (opened.size > maxBytes) {
      throw new Error(`${label}: exceeds size limit of ${maxBytes} bytes`);
    }
    const capacity = Math.min(maxBytes + 1, opened.size + 1);
    const buffer = Buffer.allocUnsafe(Math.max(1, capacity));
    let total = 0;
    while (total < buffer.length) {
      const bytesRead = readSync(fd, buffer, total, buffer.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > maxBytes) {
      throw new Error(`${label}: exceeds size limit of ${maxBytes} bytes`);
    }
    const afterRead = fstatSync(fd);
    if (
      afterRead.dev !== opened.dev ||
      afterRead.ino !== opened.ino ||
      afterRead.size !== opened.size ||
      afterRead.mtimeMs !== opened.mtimeMs ||
      afterRead.ctimeMs !== opened.ctimeMs
    ) {
      throw new Error(`${label}: file changed during read`);
    }
    return buffer.subarray(0, total);
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }
}

// Archive-and-delete materializes non-authoritative history before the squash, but the
// contract (skills/gsd/REFERENCE.md § Feature archive contract) was prose-only, so nothing
// could tell a correct copy from a forgotten or rewritten one. The pre-squash gate verifies
// the archive exists and the archived plan is the exact approved bytes before it lands.
function verifyArchive(cwd, state, scratchPlan) {
  if (state.cleanup_preference !== "archive-and-delete") return;
  const archiveDir = join(cwd, "docs", "gsd", state.feature, "archive");
  const archivePlanPath = join(archiveDir, "plan.md");
  const implementationPath = join(archiveDir, "implementation.md");
  let archivePlan;
  try {
    archivePlan = readBoundedFile(archivePlanPath, PLAN_FILE_MAX_BYTES, "archive plan");
  } catch (error) {
    blocked("archive-missing", `archive-and-delete requires ${archivePlanPath}: ${error.message}`);
  }
  if (!scratchPlan.equals(archivePlan)) {
    blocked("archive-plan-mismatch", `${archivePlanPath} must be byte-for-byte the approved .scratch plan`);
  }
  let implementationBytes;
  try {
    implementationBytes = readBoundedFile(implementationPath, PLAN_FILE_MAX_BYTES, "archive implementation");
  } catch (error) {
    blocked("archive-missing", `archive-and-delete requires ${implementationPath}: ${error.message}`);
  }
  const implementation = implementationBytes.toString("utf8");
  if (implementation.trim() === "") {
    blocked("archive-implementation-empty", `${implementationPath} must summarize the feature outcome`);
  }
}
function preflight(cwd, featureDir) {
  requireWorkTree(cwd);
  let state;
  try {
    state = inspectStateFile(join(cwd, featureDir, "state.toon"));
  } catch (error) {
    blocked("state-unusable", error.message);
  }
  if (state.base_ref === "none" || state.wip_branch === "none") {
    blocked(
      "no-git-identity",
      `state records no Git identity: base_ref ${state.base_ref}, wip_branch ${state.wip_branch}`,
    );
  }
  const base = requireBranchName(state.base_ref, "base_ref");
  const wip = requireBranchName(state.wip_branch, "wip_branch");
  if (base === wip) blocked("base-is-wip", `base_ref ${base} is the branch being squashed`);
  if (!localBranchExists(base, cwd)) {
    blocked("base-missing", `base_ref ${base} no longer resolves to a local branch, so the squash has no target`);
  }
  if (!localBranchExists(wip, cwd)) {
    blocked("wip-missing", `wip_branch ${wip} no longer resolves to a local branch`);
  }
  const elsewhere = checkedOutElsewhere(base, cwd);
  if (elsewhere !== null) {
    blocked(
      "base-checked-out-elsewhere",
      `base_ref ${base} is checked out in the linked worktree ${elsewhere}, which cannot receive this squash`,
    );
  }
  // A detached HEAD at the gate is not a cosmetic detail: commits made there sit on no
  // branch, so squashing the recorded WIP branch would silently drop them. The same holds
  // when HEAD sits on any branch other than the recorded WIP branch: the gate observed that
  // exact incident, where HEAD rested on the base while the WIP branch held the work, and
  // the squash landed wherever HEAD pointed. Identity of HEAD with the recorded WIP branch
  // is the proof that the squash target holds the reviewed work.
  const head = git(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
  if (head.status !== 0 || head.stdout === "") {
    blocked(
      "detached-head",
      `HEAD is detached, so no branch holds the work about to be squashed: check out ${wip} before the gate`,
    );
  }
  if (head.stdout !== wip) {
    blocked(
      "head-not-wip",
      `HEAD rests on ${head.stdout} while the packet's work is recorded on ${wip}: check out ${wip} before the gate so the squash receives the reviewed work`,
    );
  }
  const dirty = dirtyNonScratchPaths(cwd);
  if (dirty.length > 0) {
    const shown = dirty.slice(0, 3).join(", ");
    blocked(
      "dirty-worktree",
      `${dirty.length} non-scratch path(s) are uncommitted, so the squash would carry unreviewed bytes: ${shown}${dirty.length > 3 ? ", …" : ""}`,
    );
  }
  const scratchPlanPath = join(cwd, featureDir, "plan.md");
  let scratchBytes;
  try {
    scratchBytes = readBoundedFile(scratchPlanPath, PLAN_FILE_MAX_BYTES, "plan");
  } catch (error) {
    blocked("plan-unbound", `cannot read approved plan ${scratchPlanPath}: ${error.message}`);
  }
  const scratchHash = createHash("sha256").update(scratchBytes).digest("hex");
  if (scratchHash !== state.plan_sha256) {
    blocked(
      "plan-unbound",
      `plan.md SHA-256 (${scratchHash}) does not match bound plan_sha256 (${state.plan_sha256})`,
    );
  }
  verifyArchive(cwd, state, scratchBytes);
  // The trailing exit line is the report's own echo of the process exit code. A consumer
  // that reads the report through a pipe sees the last stage's exit status, so without this
  // line a blocked run can travel downstream looking successful; with it, the verdict is
  // observable in the bytes themselves.
  write_([
    "status: ready",
    `base: ${base}`,
    `wip: ${wip}`,
    `head: ${head.stdout}`,
    "tree: clean outside .scratch/",
    "exit=0",
  ]);
}

// Importable so the read-only boundary can be unit-tested directly; running the CLI stays the
// only side effect of executing this file.
function isMain() {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(SCRIPT_PATH);
  } catch {
    return false;
  }
}

if (isMain()) {
  const input = parseArguments(process.argv.slice(2));
  if (input.help) {
    emitHelp(input.command);
  } else if (input.usageError) {
    failUsage(input.usageError, input.command);
  } else if (input.command === "derive-base") {
    write_(["status: ok", `base: ${deriveBase(input.cwd)}`]);
  } else {
    preflight(input.cwd, input.featureDir);
  }
}
