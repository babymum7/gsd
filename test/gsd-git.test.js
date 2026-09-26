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
import { execFileSync, spawnSync } from "node:child_process";
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
    const here = cli(["derive-base"], root);
    assert.equal(here.status, 0, here.stdout + here.stderr);
    assert.match(here.stdout, /^status: ok$/m);
    assert.match(here.stdout, /^base: wip\/derive-demo$/m);

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
    assert.equal(cli(["derive-base"], root).status, 0);
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
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all", "-z"],
    ["worktree", "list", "--porcelain"],
    ["show-ref", "--verify", "--quiet", "refs/heads/main"],
    ["show-ref", "--verify", "--quiet", "refs/heads/release/2026.1"],
    ["merge-base", "--is-ancestor", "main", "task-t2"],
    ["diff", "--name-only", "main...task-t2"],
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
    /assertReadOnlyGit\(args\);\n\s*const result = spawnSync\("git", args, \{ cwd, encoding: "utf8", shell: false \}\);/,
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

    git(["checkout", "-q", "-b", `wip/${feature}`], api);
    const ready = cli(["preflight", "--feature-dir", relative], app);
    assert.equal(ready.status, 0, ready.stdout + ready.stderr);
    assert.match(ready.stdout, new RegExp(`^repo: api base=develop wip=wip/${feature}$`, "m"));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
