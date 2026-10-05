#!/usr/bin/env bun
// Observed Git state, never asserted Git state. Base derivation and the pre-merge gate were
// prose-only rules, so nothing could tell a session that followed them from one that assumed
// `main`. This tool answers both questions from the work tree and never writes: every Git
// invocation goes through `git()`, which admits only the exact argv shapes below.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { realpathSync, statSync } from "node:fs";
import { isSafeBranchRef, PLAN_FEATURE_RE, validatePlanFile } from "../lib/gsd-contract.mjs";
import { inspectStateFile } from "../lib/gsd-state.mjs";

const COMMANDS = new Set(["derive-base", "preflight", "verify-task-branch"]);
const VALUE_FLAGS = new Set(["--feature-dir", "--cwd", "--task", "--branch", "--wave-base"]);

// A subcommand name is not a permission: `git symbolic-ref <name> <ref>` writes a ref and
// `git symbolic-ref --delete <name>` removes one, so the boundary is the whole argv. These
// five shapes are every query this tool makes; `show-ref`, `merge-base`, and `diff` carry
// variable refs and are handled below. `symbolic-ref` runs without `--short`, which prints
// `heads/main` once a tag is named `main`. `status` runs under `--no-optional-locks` so that reading
// the tree cannot even refresh the index's stat cache.
const READ_ONLY = new Set([
  "rev-parse --is-inside-work-tree",
  "rev-parse --show-toplevel",
  "symbolic-ref --quiet HEAD",
  "--no-optional-locks status --porcelain=v1 --untracked-files=all -z",
  "worktree list --porcelain",
]);
const BRANCH_REF_PREFIX = "refs/heads/";
const WIP_PREFIX = "wip/";
// The child-process runner fails with ENOBUFS once captured output passes its 1 MiB default, and
// a tree with thousands of untracked files lists past that. The largest query is `status -z`.
const GIT_OUTPUT_LIMIT = 64 * 1024 * 1024;

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
  if (
    args.length === 4 &&
    args[0] === "merge-base" &&
    args[1] === "--is-ancestor" &&
    isSafeBranchRef(args[2]) &&
    isSafeBranchRef(args[3])
  ) {
    return;
  }
  // `--no-renames` lists the deleted source of a rename beside its destination, and `-z`
  // keeps every path byte-exact instead of C-quoting non-ASCII ones. The target is a full
  // `refs/heads/` path so a tag with the branch's name can never be read in its place.
  if (
    args.length === 5 &&
    args[0] === "diff" &&
    args[1] === "--name-only" &&
    args[2] === "--no-renames" &&
    args[3] === "-z"
  ) {
    const range = args[4];
    const tripleDot = range.indexOf("...");
    if (tripleDot > 0 && range.indexOf("...", tripleDot + 3) === -1) {
      const base = range.slice(0, tripleDot);
      const target = range.slice(tripleDot + 3);
      if (
        isSafeBranchRef(base) &&
        target.startsWith(BRANCH_REF_PREFIX) &&
        isSafeBranchRef(target.slice(BRANCH_REF_PREFIX.length))
      ) {
        return;
      }
    }
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
  if (command === "verify-task-branch") {
    return `${INVOCATION} verify-task-branch --feature-dir .scratch/<feature> --task <id> --branch <branch> --wave-base <ref> [--cwd <dir>]`;
  }
  return `${INVOCATION} <derive-base|preflight|verify-task-branch> [options]`;
}

function emitHelp(command) {
  if (command === "derive-base") {
    write_([
      "Usage: " + commandUsage(command),
      "",
      "Print the branch a packet must record as its base: the branch checked out in this",
      "work tree, so a linked worktree derives its own branch. A detached HEAD is blocked",
      "rather than reported as a commit oid, because a commit can receive no merge. A",
      "HEAD on a wip/* branch is blocked too: that branch belongs to another feature, and",
      "work for this one belongs in a separate worktree.",
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
      "Verify the recorded Git identity still holds before a terminal merge. Reads",
      "state.toon without migrating it and checks that:",
      "",
      "  - HEAD is attached, so every commit made is on a branch",
      "  - base_ref and wip_branch are recorded and usable branch names",
      "  - base_ref resolves to a local branch able to receive the merge",
      "  - base_ref is not checked out in another linked worktree",
      "  - wip_branch resolves to a local branch",
      "  - no path outside .scratch/ is uncommitted, staged, or untracked",
      "  - plan.md validates and names base_ref as its Base",
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
  if (command === "verify-task-branch") {
    write_([
      "Usage: " + commandUsage(command),
      "",
      "Verify a completed task branch before merging or testing in the wave gate.",
      "Reads the approved plan in .scratch/<feature>/plan.md and checks that:",
      "",
      "  - the task is defined in the plan",
      "  - the task branch exists as a local branch",
      "  - the wave base is an ancestor of the task branch",
      "  - the diff against wave base is non-empty",
      "  - no path under .scratch/ was touched",
      "  - every changed path is within the task's structured Files list",
      "",
      "Options:",
      "  --feature-dir <dir>    Feature directory (.scratch/<feature>) (required)",
      "  --task <id>            Task identifier (e.g. T1, T2) (required)",
      "  --branch <branch>      Task branch to verify (required)",
      "  --wave-base <ref>      Wave base reference (required)",
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
    "  derive-base         Print the branch this work tree is on, for plan.md Base and base_ref",
    "  preflight           Prove the recorded base and WIP branch still hold before merging",
    "  verify-task-branch  Prove task branch ancestry, diff bounds, and file scope before verification",
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

// Variables that redirect Git to another repository or index. A hook that exports `GIT_DIR`
// would otherwise make every query answer for the hook's repository whatever `--cwd` says.
const REDIRECTING_GIT_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX"];

// `LC_ALL=C` keeps Git's diagnostics in English, because a refusal is recognised by its text.
function gitEnv() {
  const env = { ...process.env, LC_ALL: "C" };
  for (const name of REDIRECTING_GIT_ENV) delete env[name];
  return env;
}

function git(args, cwd) {
  // The read-only boundary is enforced here rather than by review, and a rejected shape is a
  // defect rather than repository drift: it throws instead of emitting a blocked record.
  assertReadOnlyGit(args);
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
    env: gitEnv(),
    maxBuffer: GIT_OUTPUT_LIMIT,
  });
  if (result.error?.code === "ENOBUFS") {
    blocked("git-query-failed", `git ${args[0]} printed more than ${GIT_OUTPUT_LIMIT} bytes, so the tree cannot be proven reviewed`);
  }
  if (result.error) blocked("git-unavailable", `git cannot be executed: ${result.error.message}`);
  const stdout = result.stdout ?? "";
  // `raw` matters for `status --porcelain -z`, whose records begin with a significant space.
  return { status: result.status, stdout: stdout.trim(), raw: stdout, stderr: result.stderr ?? "" };
}

function requireWorkTree(cwd) {
  // A directory that does not exist makes the spawn fail on `git` itself, which would blame
  // Git for a path that is simply absent.
  let isDirectory = false;
  try {
    isDirectory = statSync(cwd).isDirectory();
  } catch {
    // Reported below as not being a work tree.
  }
  if (!isDirectory) blocked("not-a-work-tree", `${cwd} is not a directory, so it is not inside a Git work tree`);
  const probe = git(["rev-parse", "--is-inside-work-tree"], cwd);
  // Git refuses a repository owned by another user. That is neither a missing work tree nor
  // something this tool may override, and the remedy (`safe.directory`) is the user's to choose.
  if (probe.status !== 0 && /dubious ownership/i.test(probe.stderr)) {
    const reason = probe.stderr.split("\n", 1)[0].replace(/[\x00-\x1F\x7F]+/g, " ").trim().slice(0, 300);
    blocked(
      "git-query-failed",
      `git refuses to read ${cwd}: ${reason}; if that owner is trusted, run \`git config --global --add safe.directory <path>\` yourself`,
    );
  }
  if (probe.status !== 0 || probe.stdout !== "true") {
    blocked("not-a-work-tree", `${cwd} is not inside a Git work tree`);
  }
}

// `--is-inside-work-tree` is true for every subdirectory of a repository, so a listed repository
// that is only a folder inside another one would be proven against the parent's branches.
function requireRepositoryRoot(dir, name) {
  requireWorkTree(dir);
  const top = git(["rev-parse", "--show-toplevel"], dir);
  if (top.status !== 0) {
    blocked("git-query-failed", `git could not report the top level of repo ${name} at ${dir}`);
  }
  let real;
  try {
    real = realpathSync(dir);
  } catch {
    real = resolve(dir);
  }
  if (top.stdout !== real) {
    blocked(
      "not-a-repository-root",
      `repo ${name} at ${dir} is inside the repository rooted at ${top.stdout} instead of being a repository root of its own`,
    );
  }
}

// A branch name from state reaches Git as an argument. State validation already shapes it, but
// a packet written by an older version never went through that check, so verify here too and
// address refs by full path so a leading dash can never read as an option.
function requireBranchName(value, field) {
  if (!isSafeBranchRef(value)) {
    blocked(
      "unusable-branch-name",
      `${field} is not a branch name this tool can pass to Git (letters, digits, ".", "_", "-" and "/" only, no leading dash or "..", no ".lock" suffix): ${value}`,
    );
  }
  return value;
}

// The checked-out local branch, or null when HEAD is detached or names no local branch.
function currentBranch(cwd) {
  const head = git(["symbolic-ref", "--quiet", "HEAD"], cwd);
  if (head.status !== 0 || !head.stdout.startsWith(BRANCH_REF_PREFIX)) return null;
  return head.stdout.slice(BRANCH_REF_PREFIX.length);
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
      `git could not report this repository's worktrees, so base_ref ${branch} cannot be proven free to receive the merge`,
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

// Canon requires the reviewed non-scratch tree to be clean before the
// merge. It is not cosmetic: the merge commit `git merge` records takes the whole
// index, so anything staged outside `.scratch/` rides into the merge without being reviewed
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
    // A rename or copy, index-side or worktree-side, reports its destination and carries its
    // origin as the following record. Both are affected: `git mv src/app.js .scratch/<feature>/app.js`
    // names only a scratch destination while staging the removal of a reviewed file, so
    // reading the destination alone would clear a merge that deletes reviewed work.
    if (/^[RC]|^.[RC]/.test(record) && index + 1 < records.length) {
      index += 1;
      paths.push(records[index]);
    }
    for (const path of paths) if (!path.startsWith(".scratch/")) dirty.add(path);
  }
  return [...dirty];
}

function deriveBase(cwd) {
  requireWorkTree(cwd);
  const head = currentBranch(cwd);
  if (head === null) {
    blocked(
      "detached-head",
      "HEAD is detached, so no branch can hold this packet's merge: check out or create the branch this work belongs on, then derive the base again",
    );
  }
  if (head.startsWith(WIP_PREFIX)) blockWipHead(cwd, head);
  return requireBranchName(head, "the checked-out branch");
}

// One work tree has one HEAD, shared by every session open in it. New work derived from
// another feature's WIP branch would land inside that feature, and switching branches here
// would move that session's files as well, so the remedy is a separate worktree. The packet,
// when one is readable, names its owner and the base the worktree should start from.
function blockWipHead(cwd, head) {
  const feature = head.slice(WIP_PREFIX.length);
  let packet = false;
  let owner = "none";
  let base = "<base>";
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  if (top.status === 0 && PLAN_FEATURE_RE.test(feature)) {
    try {
      const state = inspectStateFile(join(top.stdout, ".scratch", feature, "state.toon"));
      packet = true;
      owner = state.owner;
      if (state.base_ref !== "none" && isSafeBranchRef(state.base_ref)) base = state.base_ref;
    } catch {
      // No readable packet: the branch is still a WIP branch, only its owner is unknown.
    }
  }
  const what = packet
    ? `the WIP branch of GSD feature ${feature}${owner === "none" ? "" : ` (recorded owner ${owner})`}`
    : "a WIP branch (no GSD packet describes it)";
  blocked(
    "head-is-wip",
    `HEAD is on ${head}, ${what}: work started here would land inside that branch, and switching branches in this work tree would move the files of whoever works on it. Ask the user where this work belongs: its own worktree (\`git worktree add -b <branch> <dir> ${base}\`, then start the session there), or a non-WIP branch the user checks out to build on that work`,
  );
}

function parseArguments(argv) {
  const result = {
    command: null,
    help: false,
    featureDir: null,
    task: null,
    branch: null,
    waveBase: null,
    cwd: process.cwd(),
  };
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
    else if (flag === "--task") result.task = value;
    else if (flag === "--branch") result.branch = value;
    else if (flag === "--wave-base") result.waveBase = value;
    else result.cwd = value;
    index += 2;
  }

  if (!result.command) result.usageError = "missing command";
  else if (!COMMANDS.has(result.command)) result.usageError = `unknown command: ${result.command}`;
  else if (result.command === "preflight" && result.featureDir === null) {
    result.usageError = "--feature-dir is required";
  }
  else if (result.command === "verify-task-branch") {
    if (result.featureDir === null) result.usageError = "--feature-dir is required";
    else if (result.task === null) result.usageError = "--task is required";
    else if (result.branch === null) result.usageError = "--branch is required";
    else if (result.waveBase === null) result.usageError = "--wave-base is required";
  }
  return result;
}

// One repository's branch identity: base and WIP resolve locally, the base is free to
// receive the merge, HEAD rests on the WIP branch, and nothing outside .scratch/ is dirty.
function proveBranchIdentity(dir, base, wip, where) {
  if (base === wip) blocked("base-is-wip", `base_ref ${base}${where} is the branch being merged`);
  if (!localBranchExists(base, dir)) {
    blocked("base-missing", `base_ref ${base}${where} no longer resolves to a local branch, so the merge has no target`);
  }
  if (!localBranchExists(wip, dir)) {
    blocked("wip-missing", `wip_branch ${wip}${where} no longer resolves to a local branch`);
  }
  const elsewhere = checkedOutElsewhere(base, dir);
  if (elsewhere !== null) {
    blocked(
      "base-checked-out-elsewhere",
      `base_ref ${base}${where} is checked out in the linked worktree ${elsewhere}, which cannot receive this merge`,
    );
  }
  // A detached HEAD at the gate is not a cosmetic detail: commits made there sit on no
  // branch, so merging the recorded WIP branch would silently drop them. The same holds
  // when HEAD sits on any branch other than the recorded WIP branch: the gate observed that
  // exact incident, where HEAD rested on the base while the WIP branch held the work, and
  // the merge landed wherever HEAD pointed. Identity of HEAD with the recorded WIP branch
  // is the proof that the merge target holds the reviewed work.
  const head = currentBranch(dir);
  if (head === null) {
    blocked(
      "detached-head",
      `HEAD${where} is detached, so no branch holds the work about to be merged: check out ${wip} before the gate`,
    );
  }
  if (head !== wip) {
    blocked(
      "head-not-wip",
      `HEAD${where} rests on ${head} while the packet's work is recorded on ${wip}: check out ${wip} before the gate so the merge receives the reviewed work`,
    );
  }
  const dirty = dirtyNonScratchPaths(dir);
  if (dirty.length > 0) {
    const shown = dirty.slice(0, 3).join(", ");
    blocked(
      "dirty-worktree",
      `${dirty.length} non-scratch path(s)${where} are uncommitted, so the merge would carry unreviewed bytes: ${shown}${dirty.length > 3 ? ", …" : ""}`,
    );
  }
  return head;
}

function preflight(cwd, featureDir) {
  requireWorkTree(cwd);
  let state;
  try {
    state = inspectStateFile(resolve(cwd, featureDir, "state.toon"));
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
  const head = proveBranchIdentity(cwd, base, wip, "");
  // A cross-repo plan carries one `wip/<feature>` branch per listed repository, each
  // merging into its own recorded base, so every one must hold before the gate is ready.
  let repos = [];
  try {
    repos = validatePlanFile(join(featureDir, "plan.md"), { cwd, kind: "plan", expectedBase: base }).parsed.repos;
  } catch (error) {
    blocked("plan-invalid", `cannot validate plan ${join(featureDir, "plan.md")}: ${error.message}`);
  }
  const repoLines = [];
  for (const repo of repos.filter((entry) => entry.path !== ".")) {
    const dir = resolve(cwd, repo.path);
    requireRepositoryRoot(dir, repo.name);
    proveBranchIdentity(dir, repo.base, wip, ` in repo ${repo.name}`);
    repoLines.push(`repo: ${repo.name} base=${repo.base} wip=${wip}`);
  }
  // The trailing exit line is the report's own echo of the process exit code. A consumer
  // that reads the report through a pipe sees the last stage's exit status, so without this
  // line a blocked run can travel downstream looking successful; with it, the verdict is
  // observable in the bytes themselves.
  write_([
    "status: ready",
    `base: ${base}`,
    `wip: ${wip}`,
    `head: ${head}`,
    "tree: clean outside .scratch/",
    ...repoLines,
    "exit=0",
  ]);
}

function verifyTaskBranch(cwd, featureDir, taskId, branch, waveBase) {
  requireWorkTree(cwd);

  const planPath = join(featureDir, "plan.md");
  let validated;
  try {
    validated = validatePlanFile(planPath, { cwd, kind: "plan" });
  } catch (planError) {
    blocked("plan-invalid", `cannot read or parse approved plan at ${planPath}: ${planError.message}`);
  }

  const task = validated.parsed.tasks.find((t) => t.id === taskId);
  if (!task) {
    blocked("plan-invalid", `task ${taskId} is not defined in ${planPath}`);
  }
  // A task of a cross-repo plan lives in its own repository: its branch, ancestry,
  // and diff are read there, while the plan stays in this one.
  const repo = validated.parsed.repos.find((entry) => entry.name === task.repo);
  if (repo && repo.path !== ".") {
    cwd = resolve(cwd, repo.path);
    requireRepositoryRoot(cwd, repo.name);
  }

  if (!isSafeBranchRef(branch) || !localBranchExists(branch, cwd)) {
    blocked("branch-missing", `task branch ${branch} does not exist`);
  }

  if (!isSafeBranchRef(waveBase)) {
    blocked("base-not-ancestor", `wave base ${waveBase} is not a usable branch reference`);
  }

  // The branch is addressed by its full ref from here on: the existence check above proved
  // `refs/heads/<branch>`, and a bare name resolves a same-named tag first.
  const branchRef = `${BRANCH_REF_PREFIX}${branch}`;
  const ancestorCheck = git(["merge-base", "--is-ancestor", waveBase, branchRef], cwd);
  if (ancestorCheck.status !== 0) {
    blocked("base-not-ancestor", `wave base ${waveBase} is not an ancestor of task branch ${branch}`);
  }

  const diffResult = git(["diff", "--name-only", "--no-renames", "-z", `${waveBase}...${branchRef}`], cwd);
  if (diffResult.status !== 0) {
    blocked("git-query-failed", `git diff failed for ${waveBase}...${branch}`);
  }

  const changedPaths = diffResult.raw.split("\0").filter(Boolean);
  if (changedPaths.length === 0) {
    blocked("empty-diff", `task branch ${branch} has no changes against wave base ${waveBase}`);
  }

  for (const path of changedPaths) {
    if (path.startsWith(".scratch/") || path === ".scratch") {
      blocked("scratch-mutated", `task branch ${branch} touched protected path under .scratch/: ${path}`);
    }
  }

  const allowedFiles = new Set(task.files);
  for (const path of changedPaths) {
    if (!allowedFiles.has(path)) {
      blocked("out-of-slice-path", `task branch ${branch} touched ${path}, which is outside ${taskId} slice: ${task.files.join(", ")}`);
    }
  }

  write_([
    "status: ready",
    `task: ${taskId}`,
    `branch: ${branch}`,
    `wave_base: ${waveBase}`,
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
  // The verdict is the exit code. A reader that closes the pipe early has stopped caring about
  // the text, and an unhandled EPIPE would replace a ready result with a stack trace.
  process.stdout.on("error", (error) => {
    if (error.code !== "EPIPE") throw error;
  });
  const input = parseArguments(process.argv.slice(2));
  if (input.help) {
    emitHelp(input.command);
  } else if (input.usageError) {
    failUsage(input.usageError, input.command);
  } else if (input.command === "derive-base") {
    write_(["status: ok", `base: ${deriveBase(input.cwd)}`]);
  } else if (input.command === "preflight") {
    preflight(input.cwd, input.featureDir);
  } else {
    verifyTaskBranch(input.cwd, input.featureDir, input.task, input.branch, input.waveBase);
  }
}
