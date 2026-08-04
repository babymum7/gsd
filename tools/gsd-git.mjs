#!/usr/bin/env node
// Observed Git state, never asserted Git state. Base derivation and the pre-squash gate were
// prose-only rules, so nothing could tell a session that followed them from one that assumed
// `main`. This tool answers both questions from the work tree and never writes: every Git
// invocation goes through `git()`, which refuses any subcommand outside READ_ONLY.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { isSafeBranchRef } from "../lib/gsd-contract.mjs";
import { inspectStateFile } from "../extensions/gsd-context.js";

const COMMANDS = new Set(["derive-base", "preflight"]);
const VALUE_FLAGS = new Set(["--feature-dir", "--cwd"]);
const READ_ONLY = new Set(["rev-parse", "symbolic-ref", "show-ref", "worktree"]);

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const INVOCATION = `node ${JSON.stringify(SCRIPT_PATH)}`;

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
  process.stderr.write(`gsd-git: ${message}\n`);
  process.stderr.write(`Usage: ${commandUsage(command)}\n`);
  if (!command) process.stderr.write("Use --help for available commands.\n");
  process.exit(2);
}

function blocked(code, message) {
  write_(["status: blocked", `code: ${code}`, `error: ${JSON.stringify(message)}`]);
  process.exit(1);
}

function git(args, cwd) {
  // The read-only boundary is enforced here rather than by review: `worktree` is readable
  // only through `worktree list`, and every other subcommand must be in READ_ONLY.
  if (!READ_ONLY.has(args[0]) || (args[0] === "worktree" && args[1] !== "list")) {
    throw new Error(`refusing a Git subcommand that is not read-only: ${args.join(" ")}`);
  }
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if (result.error) blocked("git-unavailable", `git cannot be executed: ${result.error.message}`);
  return { status: result.status, stdout: (result.stdout ?? "").trim() };
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

const input = parseArguments(process.argv.slice(2));
if (input.help) {
  emitHelp(input.command);
} else if (input.usageError) {
  failUsage(input.usageError, input.command);
} else if (input.command === "derive-base") {
  write_(["status: ok", `base: ${deriveBase(input.cwd)}`]);
} else {
  requireWorkTree(input.cwd);
  let state;
  try {
    state = inspectStateFile(join(input.cwd, input.featureDir, "state.toon"));
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
  if (!localBranchExists(base, input.cwd)) {
    blocked("base-missing", `base_ref ${base} no longer resolves to a local branch, so the squash has no target`);
  }
  if (!localBranchExists(wip, input.cwd)) {
    blocked("wip-missing", `wip_branch ${wip} no longer resolves to a local branch`);
  }
  const elsewhere = checkedOutElsewhere(base, input.cwd);
  if (elsewhere !== null) {
    blocked(
      "base-checked-out-elsewhere",
      `base_ref ${base} is checked out in the linked worktree ${elsewhere}, which cannot receive this squash`,
    );
  }
  // A detached HEAD at the gate is not a cosmetic detail: commits made there sit on no
  // branch, so squashing the recorded WIP branch would silently drop them.
  const head = git(["symbolic-ref", "--quiet", "--short", "HEAD"], input.cwd);
  if (head.status !== 0 || head.stdout === "") {
    blocked(
      "detached-head",
      `HEAD is detached, so no branch holds the work about to be squashed: check out ${wip} before the gate`,
    );
  }
  write_(["status: ready", `base: ${base}`, `wip: ${wip}`, `head: ${head.stdout}`]);
}
