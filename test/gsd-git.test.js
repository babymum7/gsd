import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeStateAtomic } from "../extensions/gsd-context.js";
import { assertReadOnlyGit } from "../tools/gsd-git.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "tools", "gsd-git.mjs");

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function cli(args, cwd, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// A `git` earlier on PATH that forwards everything except the one query under test, so the
// tool's own failure handling is exercised against a real repository.
function fakeGitPath(failWhen) {
  const dir = mkdtempSync(join(tmpdir(), "gsd-git-fake-"));
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  writeFileSync(
    join(dir, "git"),
    `#!/bin/sh\nif ${failWhen}; then exit 1; fi\nexec ${real} "$@"\n`,
    { mode: 0o755 },
  );
  return dir;
}

// The smallest plan the validator accepts: only the required sections.
function minimalPlan(feature, base, { repos = null, repo = null } = {}) {
  return [
    "# Plan",
    "## Feature",
    `\`${feature}\``,
    "## Base",
    `\`${base}\``,
    ...(repos ? ["## Repos", "| Repo | Path | Base |", "| --- | --- | --- |", ...repos] : []),
    "## Acceptance Criteria",
    "### AC-1: App updates",
    "- **State:** active",
    "- **Outcome:** The app file changes.",
    "- **Action:** Edit the app file.",
    "- **Expected:** The app file holds new bytes.",
    "- **Scenario:** GIVEN the base app WHEN the task edits it THEN the app file holds new bytes.",
    "## Tasks",
    "### T1: Update app",
    "- **Satisfies:** AC-1",
    ...(repo ? [`- **Repo:** ${repo}`] : []),
    "- **Files:**",
    "  - `src/app.js` — modify: update the app file",
    "- **Test:** `bun test`",
    "- **Status:** pending",
    "",
  ].join("\n");
}

// A packet the preflight can read: a real repo on a WIP branch cut from a real base.
function makePacket({ feature = "git-demo", base = "main" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "gsd-git-test-"));
  git(["init", "-q", "--initial-branch", base, "."], root);
  git(["config", "user.email", "test@example.com"], root);
  git(["config", "user.name", "test"], root);
  writeFileSync(join(root, "file.txt"), "base\n");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.js"), "code\n");
  git(["add", "-A"], root);
  git(["commit", "-qm", "init"], root);
  git(["checkout", "-q", "-b", `wip/${feature}`], root);

  const featureDir = join(root, ".scratch", feature);
  mkdirSync(featureDir, { recursive: true });
  const planPath = join(featureDir, "plan.md");
  writeFileSync(planPath, minimalPlan(feature, base));
  writeStateAtomic(featureDir, {
    schema: "v0.0.3",
    feature,
    owner: "none",
    phase: "verifying",
    next_action: "terminal gate",
    plan_path: `.scratch/${feature}/plan.md`,
    base_ref: base,
    wip_branch: `wip/${feature}`,
    last_green_task: "T1",
    last_green_commit: git(["rev-parse", "HEAD"], root),
    checkpoint_revision: "1",
  });
  return { root, feature, relative: join(".scratch", feature) };
}

test("derive-base reports the branch this work tree is on, including a linked worktree", () => {
  const { root } = makePacket({ feature: "derive-demo", base: "release-2026" });
  const linked = `${root}-linked`;
  try {
    git(["checkout", "-q", "release-2026"], root);
    const here = cli(["derive-base"], root);
    assert.equal(here.status, 0, here.stdout + here.stderr);
    assert.match(here.stdout, /^status: ok$/m);
    assert.match(here.stdout, /^base: release-2026$/m);

    // A linked worktree is checked out on its own branch, which is its own base: this is the
    // case a conventional `main` default gets wrong.
    git(["worktree", "add", "-q", "-b", "worktree-onboarding", linked], root);
    const there = cli(["derive-base", "--cwd", linked], root);
    assert.equal(there.status, 0, there.stdout + there.stderr);
    assert.match(there.stdout, /^base: worktree-onboarding$/m);
  } finally {
    rmSync(linked, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// One work tree has one HEAD. A second session that starts here while another feature is on
// its WIP branch would cut its packet from that branch, or quick-fix straight into it, and
// switching branches would drag the first session's files along, so the tool stops instead.
test("derive-base blocks a HEAD on another feature's WIP branch and points at a worktree", () => {
  const { root } = makePacket({ feature: "billing-export", base: "trunk" });
  try {
    const featureDir = join(root, ".scratch", "billing-export");
    const state = readFileSync(join(featureDir, "state.toon"), "utf8").replace(/^owner:none$/m, "owner:claude-abc");
    writeFileSync(join(featureDir, "state.toon"), state);
    const result = cli(["derive-base", "--cwd", join(root, "src")], root);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /^status: blocked$/m);
    assert.match(result.stdout, /^code: head-is-wip$/m);
    assert.match(result.stdout, /wip\/billing-export/);
    assert.match(result.stdout, /recorded owner claude-abc/);
    assert.match(result.stdout, /git worktree add -b <branch> <dir> trunk/);
    assert.doesNotMatch(result.stdout, /^base: /m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The tool cannot see the session token, so its message carries the owner rule: the owner's
// own quick fix proceeds, while the skills-only owner, shared by every session, proves nothing.
test("derive-base states when a WIP branch may still be the reader's own", () => {
  const { root } = makePacket({ feature: "billing-export", base: "trunk" });
  try {
    const statePath = join(root, ".scratch", "billing-export", "state.toon");
    const original = readFileSync(statePath, "utf8");
    writeFileSync(statePath, original.replace(/^owner:none$/m, "owner:claude-abc"));
    const owned = cli(["derive-base"], root);
    assert.match(owned.stdout, /If claude-abc is your GSD_SESSION, this is your own feature: a quick fix on it may proceed/);
    writeFileSync(statePath, original.replace(/^owner:none$/m, "owner:skills-only"));
    const shared = cli(["derive-base"], root);
    assert.match(shared.stdout, /shared by every skills-only session/);
    assert.doesNotMatch(shared.stdout, /may proceed/);
    writeFileSync(statePath, original);
    assert.doesNotMatch(cli(["derive-base"], root).stdout, /may proceed|skills-only/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Another feature merged into the base after this branch was cut: merging now would ship a
// combination nobody ran.
test("preflight blocks a base that advanced past the WIP branch", () => {
  const { root, feature, relative } = makePacket({ feature: "stale-demo" });
  try {
    git(["checkout", "-q", "main"], root);
    writeFileSync(join(root, "other.txt"), "other feature\n");
    git(["add", "other.txt"], root);
    git(["commit", "-qm", "other feature"], root);
    git(["checkout", "-q", `wip/${feature}`], root);
    const stale = cli(["preflight", "--feature-dir", relative], root);
    assert.equal(stale.status, 1, stale.stdout);
    assert.match(stale.stdout, /^code: base-advanced$/m);
    assert.match(stale.stdout, /merge main into wip\/stale-demo/);
    git(["merge", "-q", "--no-edit", "main"], root);
    const ready = cli(["preflight", "--feature-dir", relative], root);
    assert.equal(ready.status, 0, ready.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("derive-base blocks a WIP branch even when no packet describes it", () => {
  const { root } = makePacket({ feature: "orphan-demo", base: "trunk" });
  try {
    rmSync(join(root, ".scratch"), { recursive: true, force: true });
    const result = cli(["derive-base"], root);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /^code: head-is-wip$/m);
    assert.match(result.stdout, /git worktree add -b <branch> <dir> <base>/);
    assert.match(result.stdout, /no GSD packet describes it/);
    assert.doesNotMatch(result.stdout, /recorded owner/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("derive-base reports a branch whose name carries #, + or @", () => {
  const { root } = makePacket({ feature: "symbol-demo", base: "main" });
  try {
    git(["checkout", "-q", "-b", "fix/#123"], root);
    const result = cli(["derive-base"], root);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /^base: fix\/#123$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The whole point of deriving instead of assuming: an oid can hold no squash, so there is
// nothing to record and packet creation stops rather than falling back to a default.
test("derive-base blocks a detached HEAD instead of reporting a commit oid", () => {
  const { root } = makePacket({ feature: "detached-demo" });
  try {
    git(["checkout", "-q", "--detach", "HEAD"], root);
    const result = cli(["derive-base"], root);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /^status: blocked$/m);
    assert.match(result.stdout, /^code: detached-head$/m);
    assert.match(result.stdout, /check out or create the branch/);
    assert.doesNotMatch(result.stdout, /^base: [0-9a-f]{40}$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preflight passes when the recorded base and WIP branch both still hold", () => {
  const { root, relative } = makePacket({ feature: "ready-demo", base: "trunk" });
  try {
    const result = cli(["preflight", "--feature-dir", relative], root);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(
      result.stdout,
      [
        "status: ready",
        "base: trunk",
        "wip: wip/ready-demo",
        "head: wip/ready-demo",
        "tree: clean outside .scratch/",
        "exit=0",
        "",
      ].join("\n"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Canon requires the reviewed non-scratch tree to match the recorded binding before the
// squash, and the requirement has teeth: the commit after `git merge --squash` commits the
// whole index, so a staged path outside `.scratch/` lands in the squash unreviewed.
// verify-task-branch already takes an absolute feature directory; preflight joined it onto cwd.
test("preflight accepts an absolute feature directory", () => {
  const { root, relative } = makePacket({ feature: "absolute-demo" });
  try {
    const result = cli(["preflight", "--feature-dir", join(root, relative)], root);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /^status: ready$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preflight blocks a dirty non-scratch tree and ignores scratch churn", () => {
  const dirtyCases = [
    {
      label: "modified tracked file",
      paths: ["src/app.js"],
      prepare: ({ root }) => writeFileSync(join(root, "src", "app.js"), "changed\n"),
    },
    {
      label: "staged change",
      paths: ["file.txt"],
      prepare: ({ root }) => {
        writeFileSync(join(root, "file.txt"), "staged\n");
        git(["add", "file.txt"], root);
      },
    },
    {
      label: "new untracked file",
      paths: ["notes.md"],
      prepare: ({ root }) => writeFileSync(join(root, "notes.md"), "note\n"),
    },
    {
      // A rename affects both of its paths: the origin is deleted and the destination added.
      label: "staged rename",
      paths: ["src/main.js", "src/app.js"],
      prepare: ({ root }) => git(["mv", "src/app.js", "src/main.js"], root),
    },
    {
      // Git names only the destination first, so reading that record alone would clear a
      // squash that deletes a reviewed file by hiding it in the packet's own scratch dir.
      label: "reviewed file moved into scratch",
      paths: ["src/app.js"],
      prepare: ({ root, relative }) => git(["mv", "src/app.js", join(relative, "app.js")], root),
    },
  ];

  for (const { label, paths, prepare } of dirtyCases) {
    const packet = makePacket({ feature: "dirty-demo", base: "trunk" });
    try {
      prepare(packet);
      const result = cli(["preflight", "--feature-dir", packet.relative], packet.root);
      assert.equal(result.status, 1, `${label} must block: ${result.stdout}`);
      assert.match(result.stdout, /^code: dirty-worktree$/m, label);
      // Every affected path outside scratch is counted exactly once and named.
      assert.match(result.stdout, new RegExp(`${paths.length} non-scratch path\\(s\\)`), label);
      assert.match(result.stdout, /\(\d+ staged\), so the merge/, label);
      if (label === "staged change") assert.match(result.stdout, /\(1 staged\)/);
      if (label === "new untracked file") assert.match(result.stdout, /\(0 staged\)/);
      assert.match(result.stdout, /Commit the paths this feature owns on wip\/dirty-demo/, label);
      for (const path of paths) {
        assert.match(result.stdout, new RegExp(path.replace(/\./g, "\\.")), label);
      }
    } finally {
      rmSync(packet.root, { recursive: true, force: true });
    }
  }

  // Review diffs exclude scratch, so the packet's own churn must never block its gate.
  const packet = makePacket({ feature: "dirty-demo", base: "trunk" });
  try {
    writeFileSync(join(packet.root, packet.relative, "scratch-note.txt"), "working note\n");
    const result = cli(["preflight", "--feature-dir", packet.relative], packet.root);
    assert.equal(result.status, 0, `scratch churn must not block: ${result.stdout}`);
    assert.match(result.stdout, /^tree: clean outside \.scratch\/$/m);
  } finally {
    rmSync(packet.root, { recursive: true, force: true });
  }
});

// Each case is a prose rule that previously had no enforcement: the gate stops rather than
// retargeting the squash at whatever branch happens to be available.
test("preflight blocks every way the recorded Git identity can stop holding", () => {
  const cases = [
    {
      label: "base deleted",
      code: "base-missing",
      prepare: ({ root }) => git(["branch", "-q", "-D", "trunk"], root),
    },
    {
      label: "wip deleted",
      code: "wip-missing",
      prepare: ({ root }) => {
        git(["checkout", "-q", "trunk"], root);
        git(["branch", "-q", "-D", "wip/blocked-demo"], root);
      },
    },
    {
      label: "base checked out in another worktree",
      code: "base-checked-out-elsewhere",
      prepare: ({ root }) => git(["worktree", "add", "-q", `${root}-other`, "trunk"], root),
      cleanup: ({ root }) => rmSync(`${root}-other`, { recursive: true, force: true }),
    },
    {
      // Commits made on a detached HEAD are on no branch, so squashing the WIP branch
      // would drop them: the gate must stop before the merge, not report it as a detail.
      label: "detached HEAD at the gate",
      code: "detached-head",
      prepare: ({ root }) => git(["checkout", "-q", "--detach", "HEAD"], root),
    },
    {
      label: "no recorded identity",
      code: "state-unusable",
      prepare: ({ root, relative }) => {
        const statePath = join(root, relative, "state.toon");
        const draft = readFileSync(statePath, "utf8")
          .replace(/^base_ref:.*$/m, "base_ref:none")
          .replace(/^wip_branch:.*$/m, "wip_branch:none");
        writeFileSync(statePath, draft);
      },
    },
  ];

  for (const { label, code, prepare, cleanup } of cases) {
    const packet = makePacket({ feature: "blocked-demo", base: "trunk" });
    try {
      prepare(packet);
      const result = cli(["preflight", "--feature-dir", packet.relative], packet.root);
      assert.equal(result.status, 1, `${label} must block: ${result.stdout}`);
      assert.match(result.stdout, /^status: blocked$/m, label);
      assert.match(result.stdout, new RegExp(`^code: ${code}$`, "m"), `${label}: ${result.stdout}`);
    } finally {
      cleanup?.(packet);
      rmSync(packet.root, { recursive: true, force: true });
    }
  }
});

test("preflight blocks a rewritten plan", () => {
  const packet = makePacket({ feature: "rewritten-plan", base: "trunk" });
  try {
    const planPath = join(packet.root, packet.relative, "plan.md");
    writeFileSync(planPath, readFileSync(planPath, "utf8") + "extra\n");
    const result = cli(["preflight", "--feature-dir", packet.relative], packet.root);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /^status: blocked$/m);
    assert.match(result.stdout, /^code: plan-invalid$/m);
    assert.doesNotMatch(result.stdout, /^status: ready$/m);
  } finally {
    rmSync(packet.root, { recursive: true, force: true });
  }
});

test("preflight blocks when plan.md does not exist", () => {
  const packet = makePacket({ feature: "missing-plan", base: "trunk" });
  try {
    rmSync(join(packet.root, packet.relative, "plan.md"), { force: true });
    const result = cli(["preflight", "--feature-dir", packet.relative], packet.root);
    assert.equal(result.status, 1, `missing plan must block: ${result.stdout}`);
    assert.match(result.stdout, /^status: blocked$/m);
    assert.match(result.stdout, /^code: plan-invalid$/m);
    assert.doesNotMatch(result.stdout, /^status: ready$/m);
  } finally {
    rmSync(packet.root, { recursive: true, force: true });
  }
});
test("preflight blocks a symlinked plan and refuses to read the target", () => {
  const packet = makePacket({ feature: "symlink-plan", base: "trunk" });
  const outsideDir = mkdtempSync(join(tmpdir(), "gsd-symlink-target-"));
  const outside = join(outsideDir, "outside-secret.txt");
  try {
    writeFileSync(outside, "SECRET_TOKEN_DO_NOT_READ\n");
    const planPath = join(packet.root, packet.relative, "plan.md");
    rmSync(planPath, { force: true });
    symlinkSync(outside, planPath);
    const result = cli(["preflight", "--feature-dir", packet.relative], packet.root);
    assert.equal(result.status, 1, `symlink must block: ${result.stdout}`);
    assert.match(result.stdout, /^status: blocked$/m);
    assert.match(result.stdout, /^code: plan-invalid$/m);
    assert.match(result.stdout, /plan file is a symlink/);
    assert.doesNotMatch(result.stdout, /SECRET_TOKEN_DO_NOT_READ/);
    assert.doesNotMatch(result.stdout, /^status: ready$/m);
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
    rmSync(packet.root, { recursive: true, force: true });
  }
});
test("preflight blocks an oversized plan without allocating over-bound memory", () => {
  const packet = makePacket({ feature: "oversized-plan", base: "trunk" });
  try {
    const planPath = join(packet.root, packet.relative, "plan.md");
    const large = Buffer.alloc(1024 * 1024 + 10, 0x61);
    writeFileSync(planPath, large);
    const result = cli(["preflight", "--feature-dir", packet.relative], packet.root);
    assert.equal(result.status, 1, `oversized plan must block: ${result.stdout}`);
    assert.match(result.stdout, /^status: blocked$/m);
    assert.match(result.stdout, /^code: plan-invalid$/m);
    assert.match(result.stdout, /plan file exceeds 1048576 bytes/);
    assert.doesNotMatch(result.stdout, /^status: ready$/m);
  } finally {
    rmSync(packet.root, { recursive: true, force: true });
  }
});

test("both commands refuse a directory that is not a Git work tree", () => {
  const bare = mkdtempSync(join(tmpdir(), "gsd-git-bare-"));
  try {
    for (const args of [["derive-base"], ["preflight", "--feature-dir", ".scratch/x"]]) {
      const result = cli(args, bare);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stdout, /^code: not-a-work-tree$/m);
    }
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});

test("both commands name a missing directory as not-a-work-tree, not as a missing git", () => {
  // `spawnSync` reports a nonexistent `cwd` as ENOENT on the `git` binary itself, so the gate
  // blamed an absent Git for a path that simply was not there.
  const missing = join(tmpdir(), "gsd-git-definitely-missing", "nested");
  for (const args of [["derive-base"], ["preflight", "--feature-dir", ".scratch/x"]]) {
    const result = cli([...args, "--cwd", missing], tmpdir());
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /^code: not-a-work-tree$/m, result.stdout);
    assert.doesNotMatch(result.stdout, /git-unavailable/);
  }
});

test("a repository Git refuses over ownership is not reported as a missing work tree", () => {
  // Git exits 128 with "detected dubious ownership" for a repository owned by another user.
  // That is an environment refusal, and the fix (`safe.directory`) differs from a bad path.
  const { root } = makePacket({ feature: "owner-demo" });
  const fakeDir = mkdtempSync(join(tmpdir(), "gsd-git-fake-"));
  writeFileSync(
    join(fakeDir, "git"),
    `#!/bin/sh\necho "fatal: detected dubious ownership in repository at '$PWD'" >&2\nexit 128\n`,
    { mode: 0o755 },
  );
  try {
    const result = cli(["derive-base"], root, { PATH: `${fakeDir}:${process.env.PATH}` });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /^code: git-query-failed$/m, result.stdout);
    assert.match(result.stdout, /dubious ownership/);
    assert.match(result.stdout, /safe\.directory/);
  } finally {
    rmSync(fakeDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("preflight reads a status listing larger than the default child-process buffer", () => {
  // `spawnSync` caps captured output at 1 MiB and fails with ENOBUFS beyond it, which the
  // gate reported as a missing git. A tree with thousands of untracked files is dirty, and
  // the gate must say so.
  const { root, relative } = makePacket({ feature: "buffer-demo" });
  try {
    const noise = join(root, "noise");
    mkdirSync(noise);
    for (let index = 0; index < 5000; index += 1) {
      writeFileSync(join(noise, `${String(index).padStart(5, "0")}-${"a".repeat(230)}`), "");
    }
    const result = cli(["preflight", "--feature-dir", relative], root);
    assert.equal(result.status, 1, result.stdout.slice(0, 500));
    assert.match(result.stdout, /^code: dirty-worktree$/m, result.stdout.slice(0, 500));
    assert.doesNotMatch(result.stdout, /git-unavailable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a reader that closes the pipe early does not crash the tool", async () => {
  // The verdict is the exit code; an unguarded `process.stdout.write` turned a closed pipe
  // into an uncaught EPIPE with a stack trace and exit 1, even for a ready result.
  const { root } = makePacket({ feature: "epipe-demo" });
  try {
    git(["checkout", "-q", "main"], root);
    const child = spawn(process.execPath, [CLI, "derive-base", "--cwd", root], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.destroy();
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const status = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(stderr, "");
    assert.equal(status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The worktree check is the only claim in the record that cannot be re-derived from the other
// checks, so a query that fails to answer must block: reporting ready would assert the base is
// free to be checked out without ever having established it.
test("preflight blocks when a Git query it depends on cannot answer", () => {
  const queries = [
    '[ "$1" = "worktree" ]',
    '[ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]',
  ];
  for (const failWhen of queries) {
    const { root, relative } = makePacket({ feature: "queryfail-demo", base: "trunk" });
    const fake = fakeGitPath(failWhen);
    try {
      const ready = cli(["preflight", "--feature-dir", relative], root);
      assert.equal(ready.status, 0, `control run must pass: ${ready.stdout}`);
      const result = cli(["preflight", "--feature-dir", relative], root, {
        PATH: `${fake}:${process.env.PATH}`,
      });
      assert.equal(result.status, 1, `${failWhen} must block: ${result.stdout}`);
      assert.match(result.stdout, /^code: git-query-failed$/m, `${failWhen}: ${result.stdout}`);
      assert.doesNotMatch(result.stdout, /^status: ready$/m);
    } finally {
      rmSync(fake, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  }
});

// This tool exists to observe Git, so its value depends on never changing Git.
test("neither command mutates the repository", () => {
  const { root, relative } = makePacket({ feature: "readonly-demo", base: "trunk" });
  const snapshot = () =>
    [
      git(["rev-parse", "HEAD"], root),
      git(["show-ref"], root),
      git(["status", "--porcelain"], root),
      git(["reflog", "--format=%H%gd"], root),
      git(["config", "--local", "--list"], root),
    ].join("\n");
  // Reading the tree must not even refresh the index stat cache, which plain `git status`
  // rewrites; the snapshot above cannot see that, so hash the index bytes directly.
  const indexDigest = () =>
    createHash("sha256").update(readFileSync(join(root, ".git", "index"))).digest("hex");
  try {
    const before = snapshot();
    // `snapshot()` just refreshed the cache, so stale it again: a plain `git status` would
    // now rewrite the index, and the lock-free query this tool uses must not.
    const future = new Date(Date.now() + 5000);
    utimesSync(join(root, "file.txt"), future, future);
    const indexBefore = indexDigest();
    assert.equal(cli(["preflight", "--feature-dir", relative], root).status, 0);
    // HEAD rests on the WIP branch, so derive-base blocks; it still reads the tree and state.
    assert.equal(cli(["derive-base"], root).status, 1);
    assert.equal(indexDigest(), indexBefore, "the index must be byte-identical");
    assert.equal(snapshot(), before, "the repository must be unchanged");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A subcommand name is not a permission: `git symbolic-ref <name> <ref>` writes a ref and
// `--delete` removes one, so an allowlist of subcommands would have admitted a mutating call
// the moment someone added one. The boundary is the whole argv, tested directly.
test("the read-only boundary rejects every mutating Git invocation", () => {
  const rejected = [
    // `symbolic-ref` is read-only in exactly one shape and writes refs in the others.
    ["symbolic-ref", "HEAD", "refs/heads/hijacked"],
    ["symbolic-ref", "--delete", "HEAD"],
    ["symbolic-ref", "-m", "reason", "HEAD", "refs/heads/hijacked"],
    ["symbolic-ref", "--short", "HEAD"],
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    ["worktree", "add", "/tmp/anywhere"],
    ["worktree", "remove", "/tmp/anywhere"],
    ["worktree", "list"],
    ["update-ref", "refs/heads/main", "HEAD"],
    ["checkout", "main"],
    ["merge", "--squash", "wip/x"],
    ["rev-parse", "HEAD"],
    // The derivation that prints the literal `HEAD` when detached is not even executable.
    ["rev-parse", "--abbrev-ref", "HEAD"],
    ["show-ref"],
    ["show-ref", "--verify", "--quiet", "refs/tags/v1"],
    // A ref path that escapes `refs/heads/` or is not a usable branch name is refused.
    ["show-ref", "--verify", "--quiet", "refs/heads/../../evil"],
    ["show-ref", "--verify", "--quiet", "refs/heads/-x"],
    ["show-ref", "--verify", "--quiet", "refs/heads/"],
    // Plain `status` may refresh the index stat cache, so only the lock-free form is a query.
    ["status"],
    ["status", "--porcelain=v1", "--untracked-files=all", "-z"],
    ["--no-optional-locks", "status"],
    [],
    ["merge-base", "main", "task-t2"],
    ["merge-base", "--is-ancestor", "-m", "task-t2"],
    ["merge-base", "--is-ancestor", "main", "task..t2"],
    ["diff", "--name-only", "main"],
    ["diff", "--name-only", "-m", "main...task-t2"],
    ["diff", "--name-only", "main..task-t2"],
    ["diff", "--name-only", "-o", "out", "main...task-t2"],
    // A bare name can resolve to a same-named tag, and rename detection hides a source path.
    ["diff", "--name-only", "main...task-t2"],
    ["diff", "--name-only", "--no-renames", "-z", "main...task-t2"],
    ["diff", "--name-only", "--no-renames", "-z", "main...refs/heads/-x"],
    ["diff", "--name-only", "--no-renames", "-z", "main..refs/heads/task-t2"],
    ["diff", "--name-only", "--no-renames", "-o", "out", "main...refs/heads/task-t2"],
    // Only reading one branch's base pin is a query; any write, other key, or extra flag is not.
    ["config", "branch.wip/x.gsdbase", "main"],
    ["config", "--unset", "branch.wip/x.gsdbase"],
    ["config", "--get", "user.email"],
    ["config", "--get", "branch.-x.gsdbase"],
    ["config", "--get", "branch.wip/x.gsdbase", "main"],
    ["config", "--global", "--get", "branch.wip/x.gsdbase"],
  ];
  for (const args of rejected) {
    assert.throws(
      () => assertReadOnlyGit(args),
      /refusing a Git invocation that is not an allowed read-only query/,
      `git ${args.join(" ")} must be refused`,
    );
  }

  // Exactly the queries this tool makes, and nothing else, are admitted.
  for (const args of [
    ["rev-parse", "--is-inside-work-tree"],
    ["rev-parse", "--show-toplevel"],
    ["symbolic-ref", "--quiet", "HEAD"],
    ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all", "-z"],
    ["worktree", "list", "--porcelain"],
    ["show-ref", "--verify", "--quiet", "refs/heads/main"],
    ["show-ref", "--verify", "--quiet", "refs/heads/release/2026.1"],
    ["merge-base", "--is-ancestor", "main", "task-t2"],
    ["diff", "--name-only", "--no-renames", "-z", "main...refs/heads/task-t2"],
    ["config", "--get", "branch.wip/x.gsdbase"],
  ]) {
    assertReadOnlyGit(args);
  }

});

// The guard only guarantees anything if it is unavoidable. Counting `spawnSync` alone left
// `execFileSync`, `exec`, `spawn`, and a dynamic import as ways to reach Git around it, so the
// whole process-execution surface of this file is pinned: one import, one name, one call site.
test("no Git call can reach a process except through the guard", () => {
  const source = readFileSync(CLI, "utf8");

  const imports = [...source.matchAll(/import\s+\{([^}]*)\}\s+from\s+"node:child_process";/g)];
  assert.equal(imports.length, 1, "child_process must be imported exactly once");
  assert.deepEqual(
    imports[0][1].split(",").map((name) => name.trim()).filter(Boolean),
    ["spawnSync"],
    "only the guarded runner may be imported",
  );

  // Every other route to a child process, including CommonJS and dynamic forms.
  for (const escapePattern of [
    /\bexecSync\s*\(/,
    /\bexecFileSync\s*\(/,
    /\bexecFile\s*\(/,
    /\bexec\s*\(/,
    /\bspawn\s*\(/,
    /\bfork\s*\(/,
    /require\s*\(\s*["']child_process["']\s*\)/,
    /require\s*\(\s*["']node:child_process["']\s*\)/,
    /import\s*\(\s*["']n?o?d?e?:?child_process["']\s*\)/,
    /from\s+["']child_process["']/,
  ]) {
    assert.doesNotMatch(source, escapePattern, `${escapePattern} would bypass the read-only guard`);
  }

  // Counting call sites still allowed `const raw = spawnSync; raw("git", …)`, so the
  // capability itself is pinned: it may appear exactly where it enters the module and exactly
  // where it is used. Any alias, re-export, or second call site is a third occurrence.
  assert.equal(
    (source.match(/\bspawnSync\b/g) ?? []).length,
    2,
    "spawnSync may appear only as the import and the one guarded call",
  );

  // And that one call must execute the argv the guard just checked, in that order.
  assert.match(
    source,
    /assertReadOnlyGit\(args\);\n\s*const result = spawnSync\("git", args, \{\n\s*cwd,\n\s*encoding: "utf8",\n\s*shell: false,\n\s*env: gitEnv\(\),\n\s*maxBuffer: GIT_OUTPUT_LIMIT,\n\s*\}\);/,
    "the guarded argv must be exactly what reaches the process",
  );
});

test("usage errors name the flag and exit 2", () => {
  const { root, relative } = makePacket({ feature: "usage-demo", base: "trunk" });
  try {
    for (const args of [["preflight"], ["preflight", "--feature-dir"], ["nonsense"], []]) {
      const result = cli(args, root);
      assert.equal(result.status, 2, `${args.join(" ")}: ${result.stdout}${result.stderr}`);
      assert.match(result.stdout, /^status: error$/m);
      assert.match(result.stdout, /^code: usage$/m);
    }
    const help = cli(["--help", "preflight"], root);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--feature-dir <dir>/);
    // The lifecycle runs from a project checkout, not from here, so help must name a
    // runnable absolute path.
    const general = cli(["--help"], root);
    assert.match(general.stdout, new RegExp(`bun "${CLI.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.equal(cli(["preflight", "--feature-dir", relative], root).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The incident this closes: with HEAD sitting on the base (or anywhere but the recorded WIP
// branch), the gate reported ready and the squash landed on whatever HEAD held. Identity of
// HEAD with the recorded WIP branch is load-bearing, not cosmetic. The trailing exit line is
// the machine-readable echo of the process exit code, so a piped consumer can observe a
// blocked run even where shell plumbing hides the exit status itself.
test("preflight requires attached HEAD to be the recorded WIP branch and reports its exit line", () => {
  const onBase = makePacket({ feature: "head-base", base: "trunk" });
  try {
    git(["checkout", "-q", "trunk"], onBase.root);
    const result = cli(["preflight", "--feature-dir", onBase.relative], onBase.root);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /^status: blocked$/m);
    assert.match(result.stdout, /^code: head-not-wip$/m);
    assert.match(result.stdout, /^exit=1$/m);
  } finally {
    rmSync(onBase.root, { recursive: true, force: true });
  }

  const onStray = makePacket({ feature: "head-stray", base: "trunk" });
  try {
    git(["checkout", "-q", "-b", "stray-branch"], onStray.root);
    const result = cli(["preflight", "--feature-dir", onStray.relative], onStray.root);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /^code: head-not-wip$/m);
    assert.match(result.stdout, /^exit=1$/m);
  } finally {
    rmSync(onStray.root, { recursive: true, force: true });
  }
});

function makeTaskBranchPacket({ feature = "verify-demo", base = "main" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "gsd-task-test-"));
  git(["init", "-q", "--initial-branch", base, "."], root);
  git(["config", "user.email", "test@example.com"], root);
  git(["config", "user.name", "test"], root);
  writeFileSync(join(root, "file.txt"), "base file\n");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.js"), "base app\n");
  git(["add", "-A"], root);
  git(["commit", "-qm", "init"], root);

  const featureDir = join(root, ".scratch", feature);
  mkdirSync(featureDir, { recursive: true });
  const planContent = [
    "# Plan",
    "## Feature",
    `\`${feature}\``,
    "## Base",
    `\`${base}\``,
    "## Summary",
    "Summary for task branch test.",
    "## Context",
    "gsd",
    "## Domain Impact",
    "- **Classification:** none",
    "- **Contexts:** none",
    "- **Documentation:** none",
    "- **Broad bootstrap:** not-offered",
    "- **Evidence:** Evidence text.",
    "## Scope",
    "- Scope item.",
    "## Acceptance Criteria",
    "### AC-1: Criterion 1",
    "- **State:** active",
    "- **Outcome:** Outcome 1.",
    "- **Action:** Action 1.",
    "- **Expected:** Expected 1.",
    "- **Scenario:** GIVEN task branch one WHEN the branch is verified THEN its slice is admitted.",
    "### AC-2: Criterion 2",
    "- **State:** active",
    "- **Outcome:** Outcome 2.",
    "- **Action:** Action 2.",
    "- **Expected:** Expected 2.",
    "- **Scenario:** GIVEN task branch two WHEN the branch is verified THEN its slice is admitted.",
    "## Decisions",
    "None.",
    "## Invariants",
    "- **I-1:** Invariant 1.",
    "## Non-goals",
    "- **NG-1:** Non-goal 1.",
    "## Interfaces",
    "| Criterion | Seam | Path | Lower-seam reason |",
    "| --- | --- | --- | --- |",
    "| AC-1 | seam | `path` | none |",
    "| AC-2 | seam | `path` | none |",
    "## Tasks",
    "### T1: First task",
    "- **Satisfies:** AC-1",
    "- **Files:**",
    "  - `file.txt` — modify: update file.txt",
    "- **Test:** `bun test`",
    "- **Status:** pending",
    "### T2: Second task",
    "- **Satisfies:** AC-2",
    "- **Files:**",
    "  - `src/app.js` — modify: update src/app.js",
    "- **Test:** `bun test`",
    "- **Status:** pending",
    "",
  ].join("\n");
  writeFileSync(join(featureDir, "plan.md"), planContent);

  return { root, feature, relative: join(".scratch", feature) };
}

test("verify-task-branch reports ready on a compliant task branch", () => {
  const { root, relative } = makeTaskBranchPacket();
  try {
    git(["checkout", "-q", "-b", "task-t2", "main"], root);
    writeFileSync(join(root, "src", "app.js"), "updated app\n");
    git(["commit", "-qam", "work for t2"], root);
    git(["checkout", "-q", "main"], root);

    const result = cli(
      [
        "verify-task-branch",
        "--feature-dir",
        relative,
        "--task",
        "T2",
        "--branch",
        "task-t2",
        "--wave-base",
        "main",
      ],
      root,
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^status: ready$/m);
    assert.match(result.stdout, /^task: T2$/m);
    assert.match(result.stdout, /^exit=0$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify-task-branch blocks an absent task branch", () => {
  const { root, relative } = makeTaskBranchPacket();
  try {
    const result = cli(
      [
        "verify-task-branch",
        "--feature-dir",
        relative,
        "--task",
        "T2",
        "--branch",
        "non-existent-branch",
        "--wave-base",
        "main",
      ],
      root,
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^status: blocked$/m);
    assert.match(result.stdout, /^code: branch-missing$/m);
    assert.match(result.stdout, /^exit=1$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify-task-branch blocks a task branch not descended from the wave base", () => {
  const { root, relative } = makeTaskBranchPacket();
  try {
    git(["checkout", "-q", "-b", "other-base", "main"], root);
    writeFileSync(join(root, "file.txt"), "diverged on other-base\n");
    git(["commit", "-qam", "diverged commit"], root);

    git(["checkout", "-q", "-b", "task-t2", "main"], root);
    writeFileSync(join(root, "src", "app.js"), "t2 change\n");
    git(["commit", "-qam", "t2 commit"], root);

    const result = cli(
      [
        "verify-task-branch",
        "--feature-dir",
        relative,
        "--task",
        "T2",
        "--branch",
        "task-t2",
        "--wave-base",
        "other-base",
      ],
      root,
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^status: blocked$/m);
    assert.match(result.stdout, /^code: base-not-ancestor$/m);
    assert.match(result.stdout, /^exit=1$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify-task-branch blocks an empty diff against wave base", () => {
  const { root, relative } = makeTaskBranchPacket();
  try {
    git(["checkout", "-q", "-b", "task-t2-empty", "main"], root);

    const result = cli(
      [
        "verify-task-branch",
        "--feature-dir",
        relative,
        "--task",
        "T2",
        "--branch",
        "task-t2-empty",
        "--wave-base",
        "main",
      ],
      root,
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^status: blocked$/m);
    assert.match(result.stdout, /^code: empty-diff$/m);
    assert.match(result.stdout, /^exit=1$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify-task-branch blocks a task branch modifying paths outside task plan Files", () => {
  const { root, relative } = makeTaskBranchPacket();
  try {
    git(["checkout", "-q", "-b", "task-t2-outside", "main"], root);
    writeFileSync(join(root, "file.txt"), "tampered by t2\n");
    git(["commit", "-qam", "tampered file"], root);

    const result = cli(
      [
        "verify-task-branch",
        "--feature-dir",
        relative,
        "--task",
        "T2",
        "--branch",
        "task-t2-outside",
        "--wave-base",
        "main",
      ],
      root,
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^status: blocked$/m);
    assert.match(result.stdout, /^code: out-of-slice-path$/m);
    assert.match(result.stdout, /^exit=1$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify-task-branch blocks a task branch mutating .scratch/", () => {
  const { root, relative } = makeTaskBranchPacket();
  try {
    git(["checkout", "-q", "-b", "task-t2-scratch", "main"], root);
    writeFileSync(join(root, "src", "app.js"), "app change\n");
    writeFileSync(join(root, relative, "stray.txt"), "stray scratch file\n");
    git(["add", "-A"], root);
    git(["commit", "-qm", "stray scratch commit"], root);

    const result = cli(
      [
        "verify-task-branch",
        "--feature-dir",
        relative,
        "--task",
        "T2",
        "--branch",
        "task-t2-scratch",
        "--wave-base",
        "main",
      ],
      root,
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^status: blocked$/m);
    assert.match(result.stdout, /^code: scratch-mutated$/m);
    assert.match(result.stdout, /^exit=1$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify-task-branch blocks when plan is missing, malformed, or does not define task", () => {
  const { root, relative } = makeTaskBranchPacket();
  try {
    git(["checkout", "-q", "-b", "task-t2", "main"], root);
    writeFileSync(join(root, "src", "app.js"), "app change\n");
    git(["commit", "-qam", "t2 commit"], root);

    const notFound = cli(
      [
        "verify-task-branch",
        "--feature-dir",
        relative,
        "--task",
        "T99",
        "--branch",
        "task-t2",
        "--wave-base",
        "main",
      ],
      root,
    );
    assert.equal(notFound.status, 1, notFound.stdout + notFound.stderr);
    assert.match(notFound.stdout, /^status: blocked$/m);
    assert.match(notFound.stdout, /^code: plan-invalid$/m);
    assert.match(notFound.stdout, /^exit=1$/m);

    writeFileSync(join(root, relative, "plan.md"), "malformed garbage\n");
    const malformed = cli(
      [
        "verify-task-branch",
        "--feature-dir",
        relative,
        "--task",
        "T2",
        "--branch",
        "task-t2",
        "--wave-base",
        "main",
      ],
      root,
    );
    assert.equal(malformed.status, 1, malformed.stdout + malformed.stderr);
    assert.match(malformed.stdout, /^status: blocked$/m);
    assert.match(malformed.stdout, /^code: plan-invalid$/m);
    assert.match(malformed.stdout, /^exit=1$/m);

    rmSync(join(root, relative, "plan.md"));
    const missing = cli(
      [
        "verify-task-branch",
        "--feature-dir",
        relative,
        "--task",
        "T2",
        "--branch",
        "task-t2",
        "--wave-base",
        "main",
      ],
      root,
    );
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.match(missing.stdout, /^status: blocked$/m);
    assert.match(missing.stdout, /^code: plan-invalid$/m);
    assert.match(missing.stdout, /^exit=1$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify-task-branch exits 2 with code: usage on unknown argument or missing required flags", () => {
  const { root, relative } = makeTaskBranchPacket();
  try {
    const unknownFlag = cli(
      [
        "verify-task-branch",
        "--feature-dir",
        relative,
        "--task",
        "T2",
        "--branch",
        "task-t2",
        "--wave-base",
        "main",
        "--bogus-flag",
      ],
      root,
    );
    assert.equal(unknownFlag.status, 2, unknownFlag.stdout + unknownFlag.stderr);
    assert.match(unknownFlag.stdout, /^status: error$/m);
    assert.match(unknownFlag.stdout, /^code: usage$/m);

    const missingFlag = cli(
      [
        "verify-task-branch",
        "--feature-dir",
        relative,
        "--task",
        "T2",
      ],
      root,
    );
    assert.equal(missingFlag.status, 2, missingFlag.stdout + missingFlag.stderr);
    assert.match(missingFlag.stdout, /^status: error$/m);
    assert.match(missingFlag.stdout, /^code: usage$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


// Two sibling repositories: `app` holds `.scratch/`, `api` is listed under ## Repos.
function makeCrossRepoPacket({ feature = "cross-demo" } = {}) {
  const parent = mkdtempSync(join(tmpdir(), "gsd-cross-test-"));
  const init = (name, base) => {
    const dir = join(parent, name);
    mkdirSync(join(dir, "src"), { recursive: true });
    git(["init", "-q", "--initial-branch", base, "."], dir);
    git(["config", "user.email", "test@example.com"], dir);
    git(["config", "user.name", "test"], dir);
    writeFileSync(join(dir, "src", "app.js"), `${name}\n`);
    git(["add", "-A"], dir);
    git(["commit", "-qm", "init"], dir);
    return dir;
  };
  const app = init("app", "main");
  const api = init("api", "develop");
  const featureDir = join(app, ".scratch", feature);
  mkdirSync(featureDir, { recursive: true });
  const plan = minimalPlan(feature, "main", {
    repos: ["| app | `.` | `main` |", "| api | `../api` | `develop` |"],
    repo: "api",
  });
  writeFileSync(join(featureDir, "plan.md"), plan);
  return { parent, app, api, feature, relative: join(".scratch", feature), plan };
}

test("verify-task-branch reads a cross-repo task's branch in its own repository", () => {
  const { parent, app, api, relative } = makeCrossRepoPacket();
  try {
    git(["checkout", "-q", "-b", "task-t1", "develop"], api);
    writeFileSync(join(api, "src", "app.js"), "api updated\n");
    git(["commit", "-qam", "work for t1"], api);
    const args = ["verify-task-branch", "--feature-dir", relative, "--task", "T1", "--branch", "task-t1", "--wave-base", "develop"];
    const ready = cli(args, app);
    assert.equal(ready.status, 0, ready.stdout + ready.stderr);
    assert.match(ready.stdout, /^status: ready$/m);

    writeFileSync(join(api, "stray.txt"), "stray\n");
    git(["add", "stray.txt"], api);
    git(["commit", "-qm", "stray"], api);
    const stray = cli(args, app);
    assert.equal(stray.status, 1, stray.stdout);
    assert.match(stray.stdout, /^code: out-of-slice-path$/m);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("preflight proves every listed repository sits on its WIP branch", () => {
  const { parent, app, api, feature, relative } = makeCrossRepoPacket();
  try {
    git(["checkout", "-q", "-b", `wip/${feature}`], app);
    writeStateAtomic(join(app, relative), {
      schema: "v0.0.3",
      feature,
      owner: "none",
      phase: "verifying",
      next_action: "terminal gate",
      plan_path: `.scratch/${feature}/plan.md`,
      base_ref: "main",
      wip_branch: `wip/${feature}`,
      last_green_task: "T1",
      last_green_commit: git(["rev-parse", "HEAD"], api),
      checkpoint_revision: "1",
    });
    const missing = cli(["preflight", "--feature-dir", relative], app);
    assert.equal(missing.status, 1, missing.stdout);
    assert.match(missing.stdout, /^code: wip-missing$/m);
    assert.match(missing.stdout, /in repo api/);
    assert.match(missing.stdout, /execution never created it\. If no task committed yet, run `git switch -c wip\/cross-demo develop` in that repository/);

    git(["checkout", "-q", "-b", `wip/${feature}`], api);
    const ready = cli(["preflight", "--feature-dir", relative], app);
    assert.equal(ready.status, 0, ready.stdout + ready.stderr);
    assert.match(ready.stdout, new RegExp(`^repo: api base=develop wip=wip/${feature} unpinned$`, "m"));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

// The listed repositories merge first; a run interrupted before the home merge must be able
// to pass the gate again instead of stopping on the repositories it already merged.
test("preflight counts a listed repository that already merged its WIP branch", () => {
  const { parent, app, api, feature, relative } = makeCrossRepoPacket();
  try {
    git(["checkout", "-q", "-b", `wip/${feature}`], app);
    writeStateAtomic(join(app, relative), {
      schema: "v0.0.3",
      feature,
      owner: "none",
      phase: "ready",
      next_action: "ask merge or pull request",
      plan_path: `.scratch/${feature}/plan.md`,
      base_ref: "main",
      wip_branch: `wip/${feature}`,
      last_green_task: "T1",
      last_green_commit: git(["rev-parse", "HEAD"], app),
      checkpoint_revision: "1",
    });
    git(["checkout", "-q", "-b", `wip/${feature}`], api);
    writeFileSync(join(api, "src", "app.js"), "api work\n");
    git(["commit", "-qam", "api work"], api);
    git(["checkout", "-q", "develop"], api);
    git(["merge", "-q", "--no-ff", "--no-edit", `wip/${feature}`], api);
    const ready = cli(["preflight", "--feature-dir", relative], app);
    assert.equal(ready.status, 0, ready.stdout + ready.stderr);
    assert.match(ready.stdout, new RegExp(`^repo: api base=develop wip=wip/${feature} merged unpinned$`, "m"));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

// plan.md stays editable, so an amended Repos row could move a listed repository's merge
// target; the base recorded on its WIP branch at creation catches that.
test("preflight blocks a listed repository whose plan base differs from its WIP branch's pin", () => {
  const { parent, app, api, feature, relative, plan } = makeCrossRepoPacket();
  try {
    git(["checkout", "-q", "-b", `wip/${feature}`], app);
    writeStateAtomic(join(app, relative), {
      schema: "v0.0.3",
      feature,
      owner: "none",
      phase: "verifying",
      next_action: "terminal gate",
      plan_path: `.scratch/${feature}/plan.md`,
      base_ref: "main",
      wip_branch: `wip/${feature}`,
      last_green_task: "T1",
      last_green_commit: git(["rev-parse", "HEAD"], app),
      checkpoint_revision: "1",
    });
    git(["branch", "release"], api);
    git(["checkout", "-q", "-b", `wip/${feature}`, "develop"], api);
    git(["config", `branch.wip/${feature}.gsdBase`, "develop"], api);
    const ready = cli(["preflight", "--feature-dir", relative], app);
    assert.equal(ready.status, 0, ready.stdout + ready.stderr);
    assert.match(ready.stdout, new RegExp(`^repo: api base=develop wip=wip/${feature}$`, "m"));

    writeFileSync(join(app, relative, "plan.md"), plan.replace("| api | `../api` | `develop` |", "| api | `../api` | `release` |"));
    const moved = cli(["preflight", "--feature-dir", relative], app);
    assert.equal(moved.status, 1, moved.stdout);
    assert.match(moved.stdout, /^code: base-changed$/m);
    assert.match(moved.stdout, /restore that Repos row to develop/);
    assert.match(moved.stdout, new RegExp(`git -C \\.\\./api config branch\\.wip/${feature}\\.gsdBase release`));

    // Deleting the branch drops its pin, so a later feature of the same name starts clean.
    git(["checkout", "-q", "develop"], api);
    git(["branch", "-D", `wip/${feature}`], api);
    assert.equal(spawnSync("git", ["config", "--get", `branch.wip/${feature}.gsdbase`], { cwd: api }).status, 1);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

// Checking out this packet's branch in a repository where another feature's WIP branch sits
// would move that feature's files; the advice must not tell the agent to do it.
test("preflight does not advise checking out over another feature's WIP branch", () => {
  const { parent, app, api, feature, relative } = makeCrossRepoPacket();
  try {
    git(["checkout", "-q", "-b", `wip/${feature}`], app);
    writeStateAtomic(join(app, relative), {
      schema: "v0.0.3",
      feature,
      owner: "none",
      phase: "verifying",
      next_action: "terminal gate",
      plan_path: `.scratch/${feature}/plan.md`,
      base_ref: "main",
      wip_branch: `wip/${feature}`,
      last_green_task: "T1",
      last_green_commit: git(["rev-parse", "HEAD"], app),
      checkpoint_revision: "1",
    });
    git(["branch", `wip/${feature}`], api);
    git(["checkout", "-q", "-b", "wip/other"], api);
    const result = cli(["preflight", "--feature-dir", relative], app);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /^code: head-not-wip$/m);
    assert.match(result.stdout, /another feature's WIP branch/);
    assert.match(result.stdout, /ask the user/);
    assert.doesNotMatch(result.stdout, /check out wip\/cross-demo before the gate/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("a listed repository must be a repository root, not a directory inside another one", () => {
  // `rev-parse --is-inside-work-tree` is true for any subdirectory, so a Repos row pointing at
  // `src` was "proven" against the parent repository's branches and the gate reported ready.
  const { parent, app, api, feature, relative } = makeCrossRepoPacket();
  try {
    git(["checkout", "-q", "-b", `wip/${feature}`], app);
    const nested = minimalPlan(feature, "main", {
      repos: ["| app | `.` | `main` |", "| api | `src` | `main` |"],
      repo: "api",
    });
    writeFileSync(join(app, relative, "plan.md"), nested);
    writeStateAtomic(join(app, relative), {
      schema: "v0.0.3",
      feature,
      owner: "none",
      phase: "verifying",
      next_action: "terminal gate",
      plan_path: `.scratch/${feature}/plan.md`,
      base_ref: "main",
      wip_branch: `wip/${feature}`,
      last_green_task: "T1",
      last_green_commit: git(["rev-parse", "HEAD"], api),
      checkpoint_revision: "1",
    });
    const preflight = cli(["preflight", "--feature-dir", relative], app);
    assert.equal(preflight.status, 1, preflight.stdout);
    assert.match(preflight.stdout, /^code: not-a-repository-root$/m);
    assert.match(preflight.stdout, /repo api/);

    const verify = cli(
      ["verify-task-branch", "--feature-dir", relative, "--task", "T1", "--branch", `wip/${feature}`, "--wave-base", "main"],
      app,
    );
    assert.equal(verify.status, 1, verify.stdout);
    assert.match(verify.stdout, /^code: not-a-repository-root$/m);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

// The slice gate reads the branch's changed paths, so every way a change can hide from that
// list is a way out of the slice: a rename reports only its destination, a C-quoted path never
// equals the plan's spelling, and a tag named like the branch makes Git read the tag instead.
function ownOnlyForT2(root, relative, path) {
  const planPath = join(root, relative, "plan.md");
  const plan = readFileSync(planPath, "utf8");
  const entry = "  - `src/app.js` — modify: update src/app.js";
  assert.ok(plan.includes(entry), "the fixture's T2 Files entry moved");
  writeFileSync(planPath, plan.replace(entry, `  - \`${path}\` — create: new file`));
}

function verifyT2(root, relative, branch) {
  return cli(
    ["verify-task-branch", "--feature-dir", relative, "--task", "T2", "--branch", branch, "--wave-base", "main"],
    root,
  );
}

test("verify-task-branch blocks a rename that moves an unowned file into an owned path", () => {
  const { root, relative } = makeTaskBranchPacket();
  try {
    ownOnlyForT2(root, relative, "src/moved.js");
    writeFileSync(join(root, "other.txt"), "one\ntwo\nthree\nfour\nfive\n");
    git(["add", "other.txt"], root);
    git(["commit", "-qm", "unowned file"], root);
    git(["checkout", "-q", "-b", "task-rename", "main"], root);
    git(["mv", "other.txt", "src/moved.js"], root);
    git(["commit", "-qm", "rename into slice"], root);
    git(["checkout", "-q", "main"], root);

    const result = verifyT2(root, relative, "task-rename");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^code: out-of-slice-path$/m);
    assert.match(result.stdout, /other\.txt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify-task-branch diffs the branch, not a tag that shares its name", () => {
  const { root, relative } = makeTaskBranchPacket();
  try {
    git(["checkout", "-q", "-b", "task-tagged", "main"], root);
    writeFileSync(join(root, "src", "app.js"), "in slice\n");
    git(["commit", "-qam", "in slice"], root);
    git(["tag", "task-tagged"], root);
    writeFileSync(join(root, "stray.txt"), "outside the slice\n");
    git(["add", "stray.txt"], root);
    git(["commit", "-qm", "stray"], root);
    git(["checkout", "-q", "main"], root);

    const result = verifyT2(root, relative, "task-tagged");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^code: out-of-slice-path$/m);
    assert.match(result.stdout, /stray\.txt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify-task-branch admits an owned path that Git would C-quote", () => {
  const { root, relative } = makeTaskBranchPacket();
  try {
    ownOnlyForT2(root, relative, "src/café.js");
    git(["checkout", "-q", "-b", "task-unicode", "main"], root);
    writeFileSync(join(root, "src", "café.js"), "accented\n");
    git(["add", "src"], root);
    git(["commit", "-qm", "owned unicode path"], root);
    git(["checkout", "-q", "main"], root);

    const result = verifyT2(root, relative, "task-unicode");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^status: ready$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// `symbolic-ref --short` prints `heads/main` once a tag named `main` exists, which is a name
// no branch has: derive-base would record a base that cannot receive the merge.
test("derive-base and preflight read the branch name even when a tag shares it", () => {
  const { root, relative } = makePacket({ feature: "tag-demo", base: "trunk" });
  try {
    git(["tag", "wip/tag-demo"], root);
    const ready = cli(["preflight", "--feature-dir", relative], root);
    assert.equal(ready.status, 0, ready.stdout + ready.stderr);

    git(["checkout", "-q", "trunk"], root);
    git(["tag", "trunk"], root);
    const derived = cli(["derive-base"], root);
    assert.equal(derived.status, 0, derived.stdout + derived.stderr);
    assert.match(derived.stdout, /^base: trunk$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Git reports a worktree-side rename with its origin as the next record, exactly as it does an
// index-side one. The origin of `lib.scratch/x.js` read as a path starts `.scratch/` after the
// status prefix is cut, so a tracked file deleted out of the reviewed tree counted as scratch.
test("preflight counts the origin of a worktree-side rename as dirty", () => {
  const { root, relative } = makePacket({ feature: "rename-demo" });
  try {
    writeFileSync(join(root, ".gitignore"), ".scratch/\n");
    mkdirSync(join(root, "lib.scratch"), { recursive: true });
    writeFileSync(join(root, "lib.scratch", "x.js"), "one\ntwo\nthree\nfour\nfive\n");
    git(["add", ".gitignore", "lib.scratch"], root);
    git(["commit", "-qm", "tracked file"], root);
    assert.equal(cli(["preflight", "--feature-dir", relative], root).status, 0, "the tree starts clean");

    git(["mv", "lib.scratch/x.js", `${relative}/x.js`], root);
    git(["reset", "-q"], root);
    git(["add", "-N", "-f", `${relative}/x.js`], root);
    const result = cli(["preflight", "--feature-dir", relative], root);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^code: dirty-worktree$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A hook that exports `GIT_DIR` would otherwise point every query at the hook's repository
// whatever `--cwd` says, so the gate would prove the wrong repository.
test("derive-base ignores an inherited GIT_DIR", () => {
  const first = makePacket({ feature: "env-first", base: "trunk" });
  const second = makePacket({ feature: "env-second", base: "release" });
  try {
    git(["checkout", "-q", "trunk"], first.root);
    git(["checkout", "-q", "release"], second.root);
    const result = cli(["derive-base", "--cwd", second.root], first.root, {
      GIT_DIR: join(first.root, ".git"),
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^base: release$/m);
  } finally {
    rmSync(first.root, { recursive: true, force: true });
    rmSync(second.root, { recursive: true, force: true });
  }
});
