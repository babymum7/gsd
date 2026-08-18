import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
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
  const result = spawnSync("node", [CLI, ...args], {
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
  writeFileSync(join(featureDir, "plan.md"), "# Plan\n");
  writeStateAtomic(featureDir, {
    schema: "v4",
    feature,
    phase: "verifying",
    next_action: "terminal gate",
    plan_path: `.scratch/${feature}/plan.md`,
    plan_sha256: "9f442276796394adad4621299c7dc29d70e910975e8f065d5bff894686d4d386",
    base_ref: base,
    wip_branch: `wip/${feature}`,
    last_green_task: "T1",
    last_green_commit: git(["rev-parse", "HEAD"], root),
    autosync: "none",
    cleanup_preference: "none",
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
    writeFileSync(join(packet.root, packet.relative, "plan.md"), "# Plan\nrewritten\n");
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

test("preflight verifies archive-and-delete materialized the exact approved plan", () => {
  const { root, feature, relative } = makePacket({ feature: "archive-demo", base: "trunk" });
  const featureDir = join(root, ".scratch", feature);
  try {
    writeStateAtomic(featureDir, {
      schema: "v4",
      feature,
      phase: "verifying",
      next_action: "terminal gate",
      plan_path: `.scratch/${feature}/plan.md`,
      plan_sha256: "9f442276796394adad4621299c7dc29d70e910975e8f065d5bff894686d4d386",
      base_ref: "trunk",
      wip_branch: `wip/${feature}`,
      last_green_task: "T1",
      last_green_commit: git(["rev-parse", "HEAD"], root),
      autosync: "none",
      cleanup_preference: "archive-and-delete",
      checkpoint_revision: "1",
    });

    // No archive yet: the gate blocks instead of squashing an undocumented feature.
    let result = cli(["preflight", "--feature-dir", relative], root);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /^code: archive-missing$/m);

    // A rewritten archive plan is not the approved bytes and must not ride into the squash.
    // The archive lands on the WIP branch first, so the reviewed tree is clean at the gate.
    const archiveDir = join(root, "docs", "gsd", feature, "archive");
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(join(archiveDir, "plan.md"), "# Rewritten\n");
    writeFileSync(join(archiveDir, "implementation.md"), "Feature outcome summary.\n");
    git(["add", "-A"], root);
    git(["commit", "-qm", "materialize archive"], root);
    result = cli(["preflight", "--feature-dir", relative], root);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /^code: archive-plan-mismatch$/m);

    // The exact approved bytes pass, and the gate reports ready.
    writeFileSync(join(archiveDir, "plan.md"), readFileSync(join(featureDir, "plan.md")));
    git(["add", "-A"], root);
    git(["commit", "-qm", "fix archive plan"], root);
    result = cli(["preflight", "--feature-dir", relative], root);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /^status: ready$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
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
    assert.match(general.stdout, new RegExp(`node "${CLI.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.equal(cli(["preflight", "--feature-dir", relative], root).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
