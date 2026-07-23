import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, writeFileSync, existsSync, lstatSync, readlinkSync, symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function writeExecutable(path, body) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function assertPathAbsent(path, message) {
  assert.throws(() => lstatSync(path), { code: "ENOENT" }, message);
}

function makeHomeSandbox() {
  const temporary = mkdtempSync(join(tmpdir(), "gsd-install-"));
  const home = join(temporary, "home");
  const fakeBin = join(temporary, "bin");
  mkdirSync(home);
  mkdirSync(fakeBin);
  return { temporary, home, fakeBin };
}

function populateInstallRepo(repo, { withDist = false } = {}) {
  const lavish = join(repo, "tools", "lavish-axi");
  mkdirSync(lavish, { recursive: true });
  copyFileSync(join(ROOT, "install.sh"), join(repo, "install.sh"));
  mkdirSync(join(repo, "extensions"), { recursive: true });
  copyFileSync(join(ROOT, "extensions", "gsd-context.js"), join(repo, "extensions", "gsd-context.js"));
  copyFileSync(join(ROOT, "VERSION"), join(repo, "VERSION"));
  copyFileSync(join(ROOT, ".gitmodules"), join(repo, ".gitmodules"));
  writeFileSync(join(lavish, "package.json"), '{"name":"lavish-axi-fixture"}\n');
  if (withDist) {
    mkdirSync(join(lavish, "dist"), { recursive: true });
    writeFileSync(join(lavish, "dist", "cli.mjs"), "export default 1;\n");
  }
  return lavish;
}

/**
 * Clone a minimal install-capable repo tree into a temp dir so install.sh's
 * REPO resolves to the fixture (not the live checkout).
 */
function makeInstallFixture({ withDist = false, repoName = "repo" } = {}) {
  const temporary = mkdtempSync(join(tmpdir(), "gsd-install-repo-"));
  const home = join(temporary, "home");
  const fakeBin = join(temporary, "bin");
  const repo = join(temporary, repoName);
  mkdirSync(home);
  mkdirSync(fakeBin);
  const lavish = populateInstallRepo(repo, { withDist });
  return { temporary, home, fakeBin, repo, lavish };
}

function runInstallerAt(repo, home, fakeBin, extraEnv = {}) {
  return spawnSync("bash", ["install.sh"], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      ...extraEnv,
    },
  });
}

function runInstaller(home, fakeBin) {
  return runInstallerAt(ROOT, home, fakeBin);
}

/**
 * Fake git that logs argv and returns scripted SHAs for
 * `git -C <lavish> rev-parse HEAD`. Submodule update is a no-op success.
 *
 * SHA sequence: each successful rev-parse consumes the next entry; leftover
 * calls reuse the last entry.
 */
function installFakeGit(fakeBin, logPath, { lavishPath, shas }) {
  const statePath = join(dirname(logPath), "git-sha-state");
  writeFileSync(statePath, "0");
  writeExecutable(
    join(fakeBin, "git"),
    `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}
# git -C <path> rev-parse HEAD  → scripted SHAs for the lavish tree only
if [ "$1" = "-C" ] && [ "$3" = "rev-parse" ] && [ "$4" = "HEAD" ]; then
  if [ "$2" = ${JSON.stringify(lavishPath)} ]; then
    idx=$(cat ${JSON.stringify(statePath)})
    shas=${JSON.stringify(shas.join(" "))}
    set -- $shas
    i=0
    for s in "$@"; do
      if [ "$i" -eq "$idx" ]; then
        echo "$s"
        echo $((idx + 1)) > ${JSON.stringify(statePath)}
        exit 0
      fi
      i=$((i + 1))
    done
    # past the list: repeat last
    echo "$s"
    exit 0
  fi
  echo "other-sha"
  exit 0
fi
if [ "$1" = "-C" ] && [ "$3" = "submodule" ]; then exit 0; fi
if [ "$1" = "submodule" ]; then exit 0; fi
exit 0
`,
  );
}

function installFakePnpm(fakeBin, logPath, { exitCode = 0 } = {}) {
  writeExecutable(
    join(fakeBin, "pnpm"),
    `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}
exit ${exitCode}
`,
  );
}

function legacyManagedCommand(root, version = "v1") {
  const escaped = root.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `---
description: Legacy GSD command
---
<!-- gsd-managed-command:${version} -->
GSD_ROOT="${escaped}"
`;
}

test("installer publishes only the extension and is idempotent", () => {
  const { temporary, home, fakeBin } = makeHomeSandbox();
  for (const command of ["git", "pnpm"]) {
    writeExecutable(join(fakeBin, command), "#!/bin/sh\nexit 1\n");
  }

  try {
    const first = runInstaller(home, fakeBin);
    assert.equal(first.status, 0, first.stderr);
    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const execTarget = join(home, ".omp", "agent", "agents", "gsd-executor.md");
    const revTarget = join(home, ".omp", "agent", "agents", "gsd-reviewer.md");
    const commandTarget = join(home, ".omp", "agent", "commands", "gsd.md");

    assert.ok(lstatSync(extTarget).isSymbolicLink());
    assert.equal(readlinkSync(extTarget), join(ROOT, "extensions", "gsd-context.js"));
    assertPathAbsent(execTarget);
    assertPathAbsent(revTarget);
    assert.equal(existsSync(commandTarget), false);
    assert.equal(existsSync(join(home, ".agents", "skills")), false);
    assert.doesNotMatch(first.stdout, /OMP command file|Version:|Managed paths/);
    assert.match(first.stdout, /Source checkout:/);
    assert.match(first.stdout, /OMP extension symlink:/);
    assert.doesNotMatch(first.stdout, /executor agent|reviewer agent/i);
    assert.match(first.stdout, /Lavish:/);
    assert.match(first.stdout, /start a new OMP session/);

    const second = runInstaller(home, fakeBin);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readlinkSync(extTarget), join(ROOT, "extensions", "gsd-context.js"));
    assertPathAbsent(execTarget);
    assertPathAbsent(revTarget);
    assert.equal(existsSync(commandTarget), false);
    assert.deepEqual(readdirSync(dirname(extTarget)), ["gsd-context.js"]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("repository publishes no persistent model-agent roles or config", () => {
  assertPathAbsent(join(ROOT, "agents", "gsd-executor.md"));
  assertPathAbsent(join(ROOT, "agents", "gsd-reviewer.md"));
  assertPathAbsent(join(ROOT, ".omp", "config.yml"));
});

test("installer removes only recognized legacy model-agent links and preserves unrelated agents", () => {
  for (const targetName of ["gsd-executor.md", "gsd-reviewer.md"]) {
    for (const legacyTarget of ["current-root", "dangling-managed-shape"]) {
      const { temporary, home, fakeBin, repo } = makeInstallFixture();
      for (const command of ["git", "pnpm"]) {
        writeExecutable(join(fakeBin, command), "#!/bin/sh\nexit 1\n");
      }
      try {
        const agentsDir = join(home, ".omp", "agent", "agents");
        mkdirSync(agentsDir, { recursive: true });
        const target = join(agentsDir, targetName);
        const linkTarget = legacyTarget === "current-root"
          ? join(repo, "agents", targetName)
          : join(temporary, "removed-checkout", "agents", targetName);
        symlinkSync(linkTarget, target);
        writeFileSync(join(agentsDir, "custom-agent.md"), "keep\n");

        const result = runInstallerAt(repo, home, fakeBin);
        assert.equal(result.status, 0, result.stderr + result.stdout);
        assertPathAbsent(target);
        assert.equal(readFileSync(join(agentsDir, "custom-agent.md"), "utf8"), "keep\n");
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
  }
});

test("installer keeps recognized legacy agent links until extension publication succeeds", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  for (const command of ["git", "pnpm"]) {
    writeExecutable(join(fakeBin, command), "#!/bin/sh\nexit 1\n");
  }
  try {
    const agentsDir = join(home, ".omp", "agent", "agents");
    mkdirSync(agentsDir, { recursive: true });
    const legacyTarget = join(agentsDir, "gsd-executor.md");
    const legacySource = join(repo, "agents", "gsd-executor.md");
    symlinkSync(legacySource, legacyTarget);

    const result = runInstallerAt(repo, home, fakeBin, { GSD_TEST_SEAM_RACE: "regular" });
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.equal(lstatSync(legacyTarget).isSymbolicLink(), true);
    assert.equal(readlinkSync(legacyTarget), legacySource);

    const extensionTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    assert.equal(lstatSync(extensionTarget).isFile(), true);
    assert.equal(readFileSync(extensionTarget, "utf8").trim(), "raced content");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("installer preserves a raced replacement of a managed legacy skill link", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  for (const command of ["git", "pnpm"]) {
    writeExecutable(join(fakeBin, command), "#!/bin/sh\nexit 1\n");
  }
  try {
    const managedSkill = join(repo, "skills", "gsd-legacy");
    mkdirSync(managedSkill, { recursive: true });
    const legacySkillsDir = join(home, ".agents", "skills");
    mkdirSync(legacySkillsDir, { recursive: true });
    const legacyLink = join(legacySkillsDir, "gsd-legacy");
    symlinkSync(managedSkill, legacyLink);

    const result = runInstallerAt(repo, home, fakeBin, {
      GSD_TEST_SEAM_LEGACY_SKILL_REPLACE: "regular",
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(lstatSync(legacyLink).isFile(), true);
    assert.equal(readFileSync(legacyLink, "utf8"), "raced legacy skill content\n");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("installer fails before publication on unsafe legacy executor collisions", () => {
  for (const collision of ["regular", "directory", "foreign-link", "live-prior-checkout-link"]) {
    const { temporary, home, fakeBin, repo } = makeInstallFixture();
    for (const command of ["git", "pnpm"]) {
      writeExecutable(join(fakeBin, command), "#!/bin/sh\nexit 1\n");
    }
    try {
      const agentsDir = join(home, ".omp", "agent", "agents");
      mkdirSync(agentsDir, { recursive: true });
      const executorTarget = join(agentsDir, "gsd-executor.md");
      let preservedIdentity;
      if (collision === "regular") {
        preservedIdentity = "foreign\n";
        writeFileSync(executorTarget, preservedIdentity);
      } else if (collision === "directory") {
        mkdirSync(executorTarget);
        preservedIdentity = join(executorTarget, "sentinel");
        writeFileSync(preservedIdentity, "keep\n");
      } else if (collision === "foreign-link") {
        preservedIdentity = join(temporary, "foreign-agent.md");
        symlinkSync(preservedIdentity, executorTarget);
      } else {
        preservedIdentity = join(temporary, "live-prior", "agents", "gsd-executor.md");
        mkdirSync(dirname(preservedIdentity), { recursive: true });
        writeFileSync(preservedIdentity, "prior\n");
        symlinkSync(preservedIdentity, executorTarget);
      }

      const result = runInstallerAt(repo, home, fakeBin);
      assert.equal(result.status, 1, `${collision}: ${result.stderr}${result.stdout}`);
      assert.match(result.stderr, /legacy executor|unmanaged collision/i);
      if (collision === "regular") {
        assert.equal(readFileSync(executorTarget, "utf8"), preservedIdentity);
      } else if (collision === "directory") {
        assert.equal(readFileSync(preservedIdentity, "utf8"), "keep\n");
      } else {
        assert.equal(readlinkSync(executorTarget), preservedIdentity);
      }
      assert.equal(
        existsSync(join(home, ".omp", "agent", "extensions", "gsd-context.js")),
        false,
      );
      assert.equal(existsSync(join(agentsDir, "gsd-reviewer.md")), false);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
});

test("installer removes supported current-root and dead-root legacy commands", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  for (const command of ["git", "pnpm"]) {
    writeExecutable(join(fakeBin, command), "#!/bin/sh\nexit 1\n");
  }
  const commands = join(home, ".omp", "agent", "commands");
  const target = join(commands, "gsd.md");
  mkdirSync(commands, { recursive: true });

  try {
    writeFileSync(target, legacyManagedCommand(repo));
    const current = runInstallerAt(repo, home, fakeBin);
    assert.equal(current.status, 0, current.stderr + current.stdout);
    assert.equal(existsSync(target), false);
    assert.match(current.stdout, /removed legacy OMP command/);

    const deadRoot = join(temporary, "deleted-checkout");
    writeFileSync(target, legacyManagedCommand(deadRoot));
    const dead = runInstallerAt(repo, home, fakeBin);
    assert.equal(dead.status, 0, dead.stderr + dead.stdout);
    assert.equal(existsSync(target), false);
    assert.match(dead.stdout, /removed legacy OMP command/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("installer preserves ambiguous legacy command objects with warnings", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  for (const command of ["git", "pnpm"]) {
    writeExecutable(join(fakeBin, command), "#!/bin/sh\nexit 1\n");
  }
  const commands = join(home, ".omp", "agent", "commands");
  const target = join(commands, "gsd.md");
  const liveOther = join(temporary, "live-other");
  const symlinkReferent = join(temporary, "user-command.md");
  mkdirSync(commands, { recursive: true });
  mkdirSync(liveOther);
  writeFileSync(symlinkReferent, "user command\n");

  const cases = [
    ["unmanaged file", () => writeFileSync(target, "user-owned command\n")],
    ["missing root", () => writeFileSync(target, "<!-- gsd-managed-command:v1 -->\n")],
    ["unsupported version", () => writeFileSync(target, legacyManagedCommand(repo, "v2"))],
    ["duplicate root", () => writeFileSync(target, `${legacyManagedCommand(repo)}GSD_ROOT="${repo}"\n`)],
    ["carriage return", () => writeFileSync(target, legacyManagedCommand(repo).replace(/\n/g, "\r\n"))],
    ["NUL byte", () => writeFileSync(target, `${legacyManagedCommand(repo)}\0`)],
    ["live other checkout", () => writeFileSync(target, legacyManagedCommand(liveOther))],
    ["symlink target", () => symlinkSync(symlinkReferent, target)],
    ["directory target", () => mkdirSync(target)],
  ];

  try {
    for (const [name, arrange] of cases) {
      rmSync(target, { recursive: true, force: true });
      arrange();
      const before = lstatSync(target);
      const content = before.isFile() ? readFileSync(target) : null;
      const link = before.isSymbolicLink() ? readlinkSync(target) : null;
      const result = runInstallerAt(repo, home, fakeBin);
      assert.equal(result.status, 0, `${name}: ${result.stderr}${result.stdout}`);
      assert.match(result.stderr, /warn: preserving legacy command/, name);
      const after = lstatSync(target);
      assert.equal(after.isSymbolicLink(), before.isSymbolicLink(), name);
      assert.equal(after.isDirectory(), before.isDirectory(), name);
      if (content) assert.deepEqual(readFileSync(target), content, name);
      if (link) assert.equal(readlinkSync(target), link, name);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("unsafe commands directories warn and do not block extension publication", () => {
  for (const kind of ["symlink", "file"]) {
    const { temporary, home, fakeBin, repo } = makeInstallFixture();
    for (const command of ["git", "pnpm"]) {
      writeExecutable(join(fakeBin, command), "#!/bin/sh\nexit 1\n");
    }
    const agentDir = join(home, ".omp", "agent");
    const commands = join(agentDir, "commands");
    mkdirSync(agentDir, { recursive: true });
    if (kind === "symlink") {
      const external = join(temporary, "external-commands");
      mkdirSync(external);
      writeFileSync(join(external, "gsd.md"), legacyManagedCommand(repo));
      symlinkSync(external, commands);
    } else {
      writeFileSync(commands, "user-owned commands object\n");
    }

    try {
      const result = runInstallerAt(repo, home, fakeBin);
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stderr, /warn: preserving legacy command: commands path/);
      const extTarget = join(agentDir, "extensions", "gsd-context.js");
      assert.ok(lstatSync(extTarget).isSymbolicLink());
      if (kind === "symlink") {
        assert.ok(existsSync(join(commands, "gsd.md")));
      } else {
        assert.equal(readFileSync(commands, "utf8"), "user-owned commands object\n");
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
});

test("reject repository roots containing carriage return or newline", () => {
  const { temporary, home, fakeBin } = makeHomeSandbox();
  for (const command of ["git", "pnpm"]) {
    writeExecutable(join(fakeBin, command), "#!/bin/sh\nexit 1\n");
  }

  const lfRepoName = 'repo\nnewline';
  const crRepoName = 'repo\rreturn';
  const lfTerminalRepoName = 'repo-lf-terminal\n';
  const crTerminalRepoName = 'repo-cr-terminal\r';

  const target = join(home, ".omp", "agent", "extensions", "gsd-context.js");

  for (const name of [lfRepoName, crRepoName, lfTerminalRepoName, crTerminalRepoName]) {
    const repo = join(temporary, name);
    populateInstallRepo(repo);

    const result = runInstallerAt(repo, home, fakeBin);
    assert.equal(result.status, 1, `Should fail for repo name: ${JSON.stringify(name)}`);
    assert.match(result.stderr, /repository root cannot contain carriage return or newline/);
    assert.equal(existsSync(target), false, `Target must not be created for repo: ${JSON.stringify(name)}`);
  }

  rmSync(temporary, { recursive: true, force: true });
});

test("portable mktemp templates end in X", () => {
  const installer = readFileSync(join(ROOT, "install.sh"), "utf8");
  const lavish = readFileSync(join(ROOT, "skills", "gsd-lavish", "SKILL.md"), "utf8");
  assert.doesNotMatch(installer, /sync_managed_command|TMP_COMMAND_FILE|mktemp [^\n]*gsd\.md/);
  assert.doesNotMatch(installer, /mktemp [^\n]*XXXXXX\.[A-Za-z]/);
  assert.match(lavish, /mktemp "\$ARTIFACT_DIR\/\$\{STEM\}\.XXXXXX"/);
  assert.doesNotMatch(lavish, /mktemp [^\n]*XXXXXX\.[A-Za-z]/);
});

test("installer refreshes submodules from remote with detached checkout", () => {
  const { temporary, home, fakeBin, repo, lavish } = makeInstallFixture({ withDist: true });
  const gitLog = join(temporary, "git.log");
  installFakeGit(fakeBin, gitLog, { lavishPath: lavish, shas: ["aaa", "aaa"] });
  installFakePnpm(fakeBin, join(temporary, "pnpm.log"));

  try {
    const result = runInstallerAt(repo, home, fakeBin);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const target = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    assert.ok(lstatSync(target).isSymbolicLink());
    const log = readFileSync(gitLog, "utf8");
    assert.match(log, /submodule update --init --remote --checkout --recursive/);
    assert.doesNotMatch(log, /--merge/);
    assert.doesNotMatch(log, /--rebase/);
    // Install must never stage/commit/push.
    assert.doesNotMatch(log, /(?:^|\s)(add|commit|push)(?:\s|$)/m);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("installer rebuilds lavish when submodule SHA changes", () => {
  const { temporary, home, fakeBin, repo, lavish } = makeInstallFixture({ withDist: true });
  const gitLog = join(temporary, "git.log");
  const pnpmLog = join(temporary, "pnpm.log");
  installFakeGit(fakeBin, gitLog, { lavishPath: lavish, shas: ["sha-before", "sha-after"] });
  installFakePnpm(fakeBin, pnpmLog, { exitCode: 0 });

  try {
    assert.ok(existsSync(join(lavish, "dist", "cli.mjs")));
    const result = runInstallerAt(repo, home, fakeBin);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const pnpm = readFileSync(pnpmLog, "utf8");
    assert.match(pnpm, /install --frozen-lockfile/);
    assert.match(pnpm, /build/);
    assert.match(result.stdout, /building lavish-axi/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("installer rebuilds lavish when dist is missing even if SHA is unchanged", () => {
  const { temporary, home, fakeBin, repo, lavish } = makeInstallFixture({ withDist: false });
  const gitLog = join(temporary, "git.log");
  const pnpmLog = join(temporary, "pnpm.log");
  installFakeGit(fakeBin, gitLog, { lavishPath: lavish, shas: ["same", "same"] });
  installFakePnpm(fakeBin, pnpmLog, { exitCode: 0 });

  try {
    assert.equal(existsSync(join(lavish, "dist", "cli.mjs")), false);
    const result = runInstallerAt(repo, home, fakeBin);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const pnpm = readFileSync(pnpmLog, "utf8");
    assert.match(pnpm, /install --frozen-lockfile/);
    assert.match(pnpm, /build/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("installer skips lavish rebuild when SHA is unchanged and dist exists", () => {
  const { temporary, home, fakeBin, repo, lavish } = makeInstallFixture({ withDist: true });
  const gitLog = join(temporary, "git.log");
  const pnpmLog = join(temporary, "pnpm.log");
  installFakeGit(fakeBin, gitLog, { lavishPath: lavish, shas: ["same-sha", "same-sha"] });
  installFakePnpm(fakeBin, pnpmLog, { exitCode: 0 });

  try {
    const result = runInstallerAt(repo, home, fakeBin);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(existsSync(pnpmLog), false, "pnpm must not be invoked");
    assert.doesNotMatch(result.stdout + result.stderr, /building lavish-axi/);
    assert.match(result.stdout, /lavish visual path ready/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("installer warns and still registers when submodule or lavish build fails", () => {
  const { temporary, home, fakeBin, repo, lavish } = makeInstallFixture({ withDist: false });
  // git always fails; pnpm always fails — registration must still succeed.
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    const result = runInstallerAt(repo, home, fakeBin);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const target = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    assert.ok(lstatSync(target).isSymbolicLink());
    assert.match(result.stdout + result.stderr, /warn:|degrade|unavailable/i);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("README documents install as the primary upstream tool refresh path", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.match(readme, /bash install\.sh/);
  assert.match(readme, /--remote --checkout/);
  assert.match(
    readme,
    /Primary path:[\s\S]*bash install\.sh[\s\S]*updates configured submodules from remote/i,
  );
  assert.match(readme, /rebuilds the CLI when the tip SHA changes|rebuilds the optional lavish visual path when the submodule tip changed/i);
  assert.match(readme, /never (auto-)?commits? the parent/i);
  // Manual remote update may remain as optional pin help, but must not be the only path.
  assert.match(readme, /Optional manual pin/i);
  assert.match(readme, /~|\.omp\/agent\/extensions\/gsd-context\.js/);
  assert.match(readme, /extensions\/gsd-context\.js/);
  assert.match(readme, /no wrapper/i);
  assert.match(readme, /collision/i);
  assert.match(readme, /start a new OMP session/i);

  // Reject obsolete strings in normal workflow
  assert.doesNotMatch(readme, /proposal\.md/i);
  assert.doesNotMatch(readme, /spec\.md/i);
  assert.doesNotMatch(readme, /design\.md/i);
  assert.doesNotMatch(readme, /spec flawed/i);
  assert.doesNotMatch(readme, /against the spec/i);
});

test("T4: extension-only fresh install, repeat, and stale relocation", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const execTarget = join(home, ".omp", "agent", "agents", "gsd-executor.md");
    const revTarget = join(home, ".omp", "agent", "agents", "gsd-reviewer.md");
    const agentsDir = dirname(execTarget);

    const first = runInstallerAt(repo, home, fakeBin);
    assert.equal(first.status, 0, first.stderr + first.stdout);
    assert.ok(lstatSync(extTarget).isSymbolicLink());
    assert.equal(readlinkSync(extTarget), join(repo, "extensions", "gsd-context.js"));
    assertPathAbsent(execTarget);
    assertPathAbsent(revTarget);
    assert.equal(existsSync(agentsDir), false);

    const second = runInstallerAt(repo, home, fakeBin);
    assert.equal(second.status, 0, second.stderr + second.stdout);
    assert.equal(readlinkSync(extTarget), join(repo, "extensions", "gsd-context.js"));
    assertPathAbsent(execTarget);
    assertPathAbsent(revTarget);

    const oldRepo = join(temporary, "old-repo");
    mkdirSync(join(oldRepo, "extensions"), { recursive: true });
    mkdirSync(agentsDir, { recursive: true });
    rmSync(extTarget);
    symlinkSync(join(oldRepo, "extensions", "gsd-context.js"), extTarget);
    symlinkSync(join(oldRepo, "agents", "gsd-executor.md"), execTarget);
    symlinkSync(join(oldRepo, "agents", "gsd-reviewer.md"), revTarget);

    const relocateDangling = runInstallerAt(repo, home, fakeBin);
    assert.equal(relocateDangling.status, 0, relocateDangling.stderr + relocateDangling.stdout);
    assert.equal(readlinkSync(extTarget), join(repo, "extensions", "gsd-context.js"));
    assertPathAbsent(execTarget);
    assertPathAbsent(revTarget);
    assert.deepEqual(readdirSync(agentsDir), []);
    assert.deepEqual(readdirSync(dirname(extTarget)), ["gsd-context.js"]);

    const oldExtSource = join(oldRepo, "extensions", "gsd-context.js");
    writeFileSync(oldExtSource, "console.log('old');");
    rmSync(extTarget);
    symlinkSync(oldExtSource, extTarget);
    const relocateLive = runInstallerAt(repo, home, fakeBin);
    assert.equal(relocateLive.status, 1);
    assert.match(relocateLive.stderr, /unmanaged collision/);
    assert.equal(readlinkSync(extTarget), oldExtSource);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: transaction - command remains unchanged when extension preflight fails", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    // Make sure extensions/gsd-context.js exists in the mock repo
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const cmdTarget = join(home, ".omp", "agent", "commands", "gsd.md");
    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    mkdirSync(dirname(cmdTarget), { recursive: true });
    const legacyCommand = legacyManagedCommand(repo);
    writeFileSync(cmdTarget, legacyCommand);

    // Ensure extension target has a collision (e.g. regular file)
    mkdirSync(dirname(extTarget), { recursive: true });
    writeFileSync(extTarget, "original extension file");

    // Run installer
    const res = runInstallerAt(repo, home, fakeBin);
    assert.equal(res.status, 1, "should fail due to extension collision");
    assert.match(res.stderr, /unmanaged collision/);

    // Legacy removal occurs only after successful extension publication.
    assert.equal(readFileSync(cmdTarget, "utf8"), legacyCommand);
    // Verify extension was NOT mutated
    assert.equal(readFileSync(extTarget, "utf8"), "original extension file", "extension target should not be mutated");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: deterministic race/no-clobber coverage using test seam", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);

    // Case 1: Raced regular file
    const resReg = runInstallerAt(repo, home, fakeBin, { GSD_TEST_SEAM_RACE: "regular" });
    assert.equal(resReg.status, 1, "should fail because of raced regular file");
    assert.equal(readFileSync(extTarget, "utf8").trim(), "raced content", "should not overwrite raced regular file");
    assert.deepEqual(readdirSync(extDir), ["gsd-context.js"]);

    // Clean up
    rmSync(extTarget);

    // Case 2: Raced live symlink to another target
    const resSym = runInstallerAt(repo, home, fakeBin, { GSD_TEST_SEAM_RACE: "symlink" });
    assert.equal(resSym.status, 1, "should fail because of raced symlink");
    const statsSym = lstatSync(extTarget);
    assert.ok(statsSym.isSymbolicLink(), "should remain a symbolic link");
    assert.equal(readlinkSync(extTarget), "/some/other/path", "should not overwrite raced symlink");
    assert.deepEqual(readdirSync(extDir), ["gsd-context.js"]);

    // Clean up
    rmSync(extTarget);

    // Case 3: Raced directory
    const resDir = runInstallerAt(repo, home, fakeBin, { GSD_TEST_SEAM_RACE: "directory" });
    assert.equal(resDir.status, 1, "should fail because of raced directory");
    const statsDir = lstatSync(extTarget);
    assert.ok(statsDir.isDirectory() && !statsDir.isSymbolicLink(), "should remain a directory");
    assert.deepEqual(readdirSync(extDir), ["gsd-context.js"]);

    // Clean up
    rmSync(extTarget, { recursive: true });

    // Case 4: Raced same-source symlink (should succeed)
    const resSame = runInstallerAt(repo, home, fakeBin, { GSD_TEST_SEAM_RACE: "same_source" });
    assert.equal(resSame.status, 0, resSame.stderr + resSame.stdout);
    const statsSame = lstatSync(extTarget);
    assert.ok(statsSame.isSymbolicLink(), "should be a symbolic link");
    assert.equal(readlinkSync(extTarget), join(repo, "extensions", "gsd-context.js"));
    assert.deepEqual(readdirSync(extDir), ["gsd-context.js"]);

    // Case 5: Stale relocation: raced regular/live object remains byte-for-byte,
    // install fails, old backup is discarded when it cannot be restored, no artifacts.
    // Setup dangling symlink
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";
    if (existsSync(extTarget) || lstatSync(extTarget).isSymbolicLink()) {
      rmSync(extTarget, { recursive: true, force: true });
    }
    symlinkSync(oldExtSource, extTarget);

    const resRestore = runInstallerAt(repo, home, fakeBin, { GSD_TEST_SEAM_RACE: "regular" });
    assert.equal(resRestore.status, 1, "should fail because of raced regular file during stale relocation");
    const statsRestored = lstatSync(extTarget);
    assert.ok(statsRestored.isFile(), "should be a regular file");
    assert.ok(!statsRestored.isSymbolicLink(), "should not be a symbolic link anymore");
    assert.equal(readFileSync(extTarget, "utf8").trim(), "raced content", "raced regular file should remain byte-for-byte");
    assert.deepEqual(readdirSync(extDir), ["gsd-context.js"], "no backup or temp artifacts should remain");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: live symlink to another source fails closed, regular-file collision fails closed, preservation on failure", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    // Make sure extensions/gsd-context.js exists in the mock repo
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    
    // Ensure parent dir exists
    mkdirSync(join(home, ".omp", "agent", "extensions"), { recursive: true });

    // 1. Live symlink to another source
    const otherFile = join(temporary, "other.js");
    writeFileSync(otherFile, "console.log('other');");
    symlinkSync(otherFile, extTarget);

    const resultOther = runInstallerAt(repo, home, fakeBin);
    assert.equal(resultOther.status, 1, "should fail because of live symlink to another source");
    assert.match(resultOther.stderr, /unmanaged collision/);
    assert.equal(readlinkSync(extTarget), otherFile);

    // Clean up the symlink
    rmSync(extTarget);

    // 2. Dangling symlink to another source
    const nonExistentOther = join(temporary, "non-existent-other.js");
    symlinkSync(nonExistentOther, extTarget);

    const resultDanglingOther = runInstallerAt(repo, home, fakeBin);
    assert.equal(resultDanglingOther.status, 1, "should fail because of dangling symlink to another source");
    assert.match(resultDanglingOther.stderr, /unmanaged collision/);
    assert.equal(readlinkSync(extTarget), nonExistentOther);

    // Clean up the symlink
    rmSync(extTarget);

    // 3. Regular-file collision
    writeFileSync(extTarget, "regular file content");

    const resultFile = runInstallerAt(repo, home, fakeBin);
    assert.equal(resultFile.status, 1, "should fail because of regular-file collision");
    assert.match(resultFile.stderr, /unmanaged collision/);
    assert.equal(readFileSync(extTarget, "utf8"), "regular file content");

    // 4. Directory collision
    rmSync(extTarget);
    mkdirSync(extTarget);
    writeFileSync(join(extTarget, "somefile.js"), "inside dir");

    const resultDir = runInstallerAt(repo, home, fakeBin);
    assert.equal(resultDir.status, 1, "should fail because of directory collision");
    assert.ok(existsSync(join(extTarget, "somefile.js")));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
test("T4: agent targets live/dangling symlink, regular file, and directory collisions fail closed and transactional", () => {
  for (const targetName of ["gsd-executor.md", "gsd-reviewer.md"]) {
    const { temporary, home, fakeBin, repo } = makeInstallFixture();
    writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
    writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

    try {
      mkdirSync(join(repo, "extensions"), { recursive: true });
      writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

      const agentsDir = join(home, ".omp", "agent", "agents");
      mkdirSync(agentsDir, { recursive: true });
      const target = join(agentsDir, targetName);
      const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");

      // 1. Live foreign symlink
      const otherFile = join(temporary, "other-agent.md");
      writeFileSync(otherFile, "foreign agent content");
      symlinkSync(otherFile, target);

      const resLive = runInstallerAt(repo, home, fakeBin);
      assert.equal(resLive.status, 1, `should fail because of live symlink on ${targetName}`);
      assert.match(resLive.stderr, /unmanaged collision/);
      assert.equal(readlinkSync(target), otherFile);
      assert.equal(existsSync(extTarget), false, "extTarget must not be published when agent preflight fails");

      rmSync(target);

      // 2. Dangling foreign symlink
      const nonExistent = join(temporary, "nonexistent-agent.md");
      symlinkSync(nonExistent, target);

      const resDangling = runInstallerAt(repo, home, fakeBin);
      assert.equal(resDangling.status, 1, `should fail because of dangling symlink on ${targetName}`);
      assert.match(resDangling.stderr, /unmanaged collision/);
      assert.equal(readlinkSync(target), nonExistent);
      assert.equal(existsSync(extTarget), false);

      rmSync(target);

      // 3. Regular file collision
      writeFileSync(target, "custom user agent file");

      const resFile = runInstallerAt(repo, home, fakeBin);
      assert.equal(resFile.status, 1, `should fail because of file collision on ${targetName}`);
      assert.match(resFile.stderr, /unmanaged collision/);
      assert.equal(readFileSync(target, "utf8"), "custom user agent file");
      assert.equal(existsSync(extTarget), false);

      // 4. Directory collision
      rmSync(target);
      mkdirSync(target);
      writeFileSync(join(target, "subfile.txt"), "inside dir");

      const resDir = runInstallerAt(repo, home, fakeBin);
      assert.equal(resDir.status, 1, `should fail because of directory collision on ${targetName}`);
      assert.match(resDir.stderr, /unmanaged collision/);
      assert.ok(existsSync(join(target, "subfile.txt")));
      assert.equal(existsSync(extTarget), false);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
});

test("T4: OMP_AGENTS_DIR parent as symlink or file fails closed with exit 1", () => {
  for (const kind of ["symlink", "file"]) {
    const { temporary, home, fakeBin, repo } = makeInstallFixture();
    writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
    writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

    try {
      const ompAgentDir = join(home, ".omp", "agent");
      mkdirSync(ompAgentDir, { recursive: true });
      const agentsParent = join(ompAgentDir, "agents");

      if (kind === "symlink") {
        const extDir = join(temporary, "ext-agents-dir");
        mkdirSync(extDir);
        symlinkSync(extDir, agentsParent);
      } else {
        writeFileSync(agentsParent, "file blocking agents dir");
      }

      const res = runInstallerAt(repo, home, fakeBin);
      assert.equal(res.status, 1, `should fail when agents parent is ${kind}`);
      assert.match(res.stderr, /error: registration parent/);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
});

test("T4: special checkout/home paths with spaces, quotes, dollar signs, glob characters, and leading dashes", () => {
  const specialName = "-special $'*?[] workspace";
  const { temporary, home, fakeBin, repo } = makeInstallFixture({ repoName: specialName });
  
  const specialHome = join(temporary, `${specialName}_home`);
  mkdirSync(specialHome);
  
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const result = runInstallerAt(repo, specialHome, fakeBin);
    assert.equal(result.status, 0, result.stderr + result.stdout);

    const extTarget = join(specialHome, ".omp", "agent", "extensions", "gsd-context.js");
    const stats = lstatSync(extTarget);
    assert.ok(stats.isSymbolicLink(), "should be a symbolic link");
    assert.equal(readlinkSync(extTarget), join(repo, "extensions", "gsd-context.js"));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: late symlink reclassification", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);

    // Scenario A: target was absent at preflight, but a symlink races in before relocation
    const resA = runInstallerAt(repo, home, fakeBin, { GSD_TEST_SEAM_PRE_RELOCATE: "symlink" });
    assert.equal(resA.status, 1, "should fail because target was absent at preflight but a symlink raced in");
    assert.match(resA.stderr, /unmanaged collision/);
    assert.ok(lstatSync(extTarget).isSymbolicLink(), "raced symlink should remain");
    assert.equal(readlinkSync(extTarget), "/some/other/path", "raced symlink target should remain unchanged");
    assert.deepEqual(readdirSync(extDir), ["gsd-context.js"]);

    // Clean up
    rmSync(extTarget);

    // Scenario B: target was a stale link at preflight, but it changes before relocation
    // Ensure parent dir exists before symlinkSync
    mkdirSync(dirname(extTarget), { recursive: true });
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";
    symlinkSync(oldExtSource, extTarget);

    const resB = runInstallerAt(repo, home, fakeBin, { GSD_TEST_SEAM_PRE_RELOCATE: "symlink" });
    assert.equal(resB.status, 1, "should fail because stale link changed before relocation");
    assert.match(resB.stderr, /unmanaged collision/);
    assert.ok(lstatSync(extTarget).isSymbolicLink(), "raced symlink should remain");
    assert.equal(readlinkSync(extTarget), "/some/other/path", "raced symlink target should be the new/changed target");
    assert.deepEqual(readdirSync(extDir), ["gsd-context.js"]);

  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: signal termination and cleanup behavior", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);

    // Setup dangling stale symlink
    // Ensure parent dir exists before symlinkSync
    mkdirSync(dirname(extTarget), { recursive: true });
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";
    symlinkSync(oldExtSource, extTarget);

    // Run installer and trigger SIGTERM race seam
    const res = runInstallerAt(repo, home, fakeBin, { GSD_TEST_SEAM_RACE: "sigterm" });

    // Assert it exited with conventional SIGTERM status (143)
    assert.equal(res.status, 143, "should exit with conventional status 143 on SIGTERM");

    // Assert that the original dangling symlink was restored because the destination was absent
    assert.ok(lstatSync(extTarget).isSymbolicLink(), "should restore original symlink");
    assert.equal(readlinkSync(extTarget), oldExtSource, "restored link should point to original source");

    // Assert no backup or temp files are left behind in the directory
    assert.deepEqual(readdirSync(extDir), ["gsd-context.js"], "no backup or temp files should remain in extensions dir");

    // Case 2: Post-temp-deletion SIGTERM during same-source race
    rmSync(extTarget);
    const extSource = join(repo, "extensions", "gsd-context.js");

    const resSamePostRm = runInstallerAt(repo, home, fakeBin, {
      GSD_TEST_SEAM_RACE: "same_source",
      GSD_TEST_SEAM_POST_RM_TMP_SYMLINK: "sigterm"
    });
    assert.equal(resSamePostRm.status, 143, "should exit with status 143 on SIGTERM after temp symlink deletion");
    assert.ok(lstatSync(extTarget).isSymbolicLink(), "same-source symlink should exist");
    assert.equal(readlinkSync(extTarget), extSource);
    assert.deepEqual(readdirSync(extDir), ["gsd-context.js"], "no temp files should remain after same-source post-rm sigterm");

    // Case 3: Post-temp-deletion SIGTERM during differing race failure
    rmSync(extTarget);

    const resDiffPostRm = runInstallerAt(repo, home, fakeBin, {
      GSD_TEST_SEAM_RACE: "regular",
      GSD_TEST_SEAM_POST_RM_TMP_SYMLINK: "sigterm"
    });
    assert.equal(resDiffPostRm.status, 143, "should exit with status 143 on SIGTERM after temp symlink deletion");
    assert.ok(lstatSync(extTarget).isFile(), "raced file should remain");
    assert.equal(readFileSync(extTarget, "utf8").trim(), "raced content");
    assert.deepEqual(readdirSync(extDir), ["gsd-context.js"], "no temp files should remain after differing race post-rm sigterm");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: first window race - post-classify target replacement", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);

    // Case 1: Post-classify raced regular file
    mkdirSync(extDir, { recursive: true });
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";
    symlinkSync(oldExtSource, extTarget);

    const resReg = runInstallerAt(repo, home, fakeBin, { GSD_TEST_SEAM_POST_CLASSIFY: "regular" });
    assert.equal(resReg.status, 1, "should fail because target was replaced after classification");
    assert.ok(existsSync(extTarget), "raced regular file must remain at canonical target");
    assert.equal(readFileSync(extTarget, "utf8").trim(), "raced content post-classify");
    const filesReg = readdirSync(extDir);
    assert.equal(filesReg.length, 1, "no installer-owned artifacts or backup files must leak");
    assert.deepEqual(filesReg, ["gsd-context.js"]);

    // Clean up target for Case 2
    rmSync(extTarget, { force: true });
    symlinkSync(oldExtSource, extTarget);

    const resSym = runInstallerAt(repo, home, fakeBin, { GSD_TEST_SEAM_POST_CLASSIFY: "symlink" });
    assert.equal(resSym.status, 1, "should fail because target was replaced after classification");
    assert.ok(lstatSync(extTarget).isSymbolicLink(), "raced symlink must remain at canonical target");
    assert.equal(readlinkSync(extTarget), "/some/other/path");
    const filesSym = readdirSync(extDir);
    assert.equal(filesSym.length, 1, "no installer-owned artifacts or backup files must leak");
    assert.deepEqual(filesSym, ["gsd-context.js"]);

  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
test("T4: post-classify failure preserves independently occupied backup path", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";

    // Case 1: Post-classify target replacement combined with independently occupied backup regular file
    mkdirSync(extDir, { recursive: true });
    symlinkSync(oldExtSource, extTarget);

    const resReg = runInstallerAt(repo, home, fakeBin, {
      GSD_TEST_SEAM_POST_CLASSIFY: "regular_and_backup_regular"
    });
    assert.equal(resReg.status, 1, "should fail when post-classify revalidation fails");
    assert.match(resReg.stderr, /unmanaged collision/);
    assert.ok(existsSync(extTarget), "raced regular file must remain at canonical target");
    assert.equal(readFileSync(extTarget, "utf8").trim(), "raced content post-classify");

    const filesReg = readdirSync(extDir);
    const backupFileReg = filesReg.find(f => f.startsWith("gsd-context.js.backup."));
    assert.ok(backupFileReg, "independently occupied backup file must be preserved");
    const backupPathReg = join(extDir, backupFileReg);
    const backupStatsReg = lstatSync(backupPathReg);
    assert.ok(backupStatsReg.isFile(), "independently occupied backup must remain a regular file");
    assert.equal(readFileSync(backupPathReg, "utf8").trim(), "unowned backup content post-classify");
    assert.equal(filesReg.length, 2, "only canonical target and backup file should remain");

    // Case 2: Post-classify target replacement combined with independently occupied backup symlink
    rmSync(extTarget, { force: true });
    rmSync(backupPathReg, { force: true });
    symlinkSync(oldExtSource, extTarget);

    const resSym = runInstallerAt(repo, home, fakeBin, {
      GSD_TEST_SEAM_POST_CLASSIFY: "regular_and_backup_symlink"
    });
    assert.equal(resSym.status, 1, "should fail when post-classify revalidation fails");
    assert.match(resSym.stderr, /unmanaged collision/);
    assert.ok(existsSync(extTarget), "raced regular file must remain at canonical target");
    assert.equal(readFileSync(extTarget, "utf8").trim(), "raced content post-classify");

    const filesSym = readdirSync(extDir);
    const backupFileSym = filesSym.find(f => f.startsWith("gsd-context.js.backup."));
    assert.ok(backupFileSym, "independently occupied backup symlink must be preserved");
    const backupPathSym = join(extDir, backupFileSym);
    const backupStatsSym = lstatSync(backupPathSym);
    assert.ok(backupStatsSym.isSymbolicLink(), "independently occupied backup must remain a symlink");
    assert.equal(readlinkSync(backupPathSym), "/some/other/backup/path");
    assert.equal(filesSym.length, 2, "only canonical target and backup file should remain");

  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: second window race - backup publication skipped due to unowned backup object", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);

    // Case 1: Unowned backup is a regular file
    mkdirSync(extDir, { recursive: true });
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";
    symlinkSync(oldExtSource, extTarget);

    const resReg = runInstallerAt(repo, home, fakeBin, { GSD_TEST_SEAM_BACKUP_PUBLISH: "regular" });
    assert.equal(resReg.status, 1, "should fail because backup target already existed");

    // The original dangling symlink must remain unchanged
    assert.ok(lstatSync(extTarget).isSymbolicLink(), "original target must remain a symlink");
    assert.equal(readlinkSync(extTarget), oldExtSource, "original target target must not change");

    // Find the backup file in extDir
    const filesReg = readdirSync(extDir);
    const backupReg = filesReg.find(f => f.startsWith("gsd-context.js.backup."));
    assert.ok(backupReg, "unowned backup file must exist");
    const backupRegPath = join(extDir, backupReg);
    assert.ok(lstatSync(backupRegPath).isFile(), "unowned backup must remain a regular file");
    assert.equal(readFileSync(backupRegPath, "utf8").trim(), "unowned backup content", "unowned backup content must survive byte-for-byte");

    // Clean up backup and target for Case 2
    rmSync(backupRegPath);
    rmSync(extTarget);

    // Case 2: Unowned backup is a symlink
    symlinkSync(oldExtSource, extTarget);

    const resSym = runInstallerAt(repo, home, fakeBin, { GSD_TEST_SEAM_BACKUP_PUBLISH: "symlink" });
    assert.equal(resSym.status, 1, "should fail because backup target already existed");

    // The original dangling symlink must remain unchanged
    assert.ok(lstatSync(extTarget).isSymbolicLink(), "original target must remain a symlink");
    assert.equal(readlinkSync(extTarget), oldExtSource, "original target target must not change");

    // Find the backup symlink in extDir
    const filesSym = readdirSync(extDir);
    const backupSym = filesSym.find(f => f.startsWith("gsd-context.js.backup."));
    assert.ok(backupSym, "unowned backup symlink must exist");
    const backupSymPath = join(extDir, backupSym);
    assert.ok(lstatSync(backupSymPath).isSymbolicLink(), "unowned backup must remain a symlink");
    assert.equal(readlinkSync(backupSymPath), "/some/other/backup/path", "unowned backup target must survive byte-for-byte");

  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: regression - skipped move with identical inode/target backup preserves both", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);

    mkdirSync(extDir, { recursive: true });
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";
    symlinkSync(oldExtSource, extTarget);

    const res = runInstallerAt(repo, home, fakeBin, { GSD_TEST_SEAM_BACKUP_PUBLISH: "hardlink" });
    assert.equal(res.status, 1, "installer must fail");

    // Canonical stale symlink must survive with exact identity/target
    const extStats = lstatSync(extTarget);
    assert.ok(extStats.isSymbolicLink(), "canonical target must survive and remain a symlink");
    assert.equal(readlinkSync(extTarget), oldExtSource, "canonical target must point to the stale source");

    // Find the backup file in extDir
    const files = readdirSync(extDir);
    const backupFile = files.find(f => f.startsWith("gsd-context.js.backup."));
    assert.ok(backupFile, "backup file must exist");
    const backupPath = join(extDir, backupFile);

    // Independent backup hardlink survives with exact identity/target
    const backupStats = lstatSync(backupPath);
    assert.ok(backupStats.isSymbolicLink(), "independent backup must remain a symlink");
    assert.equal(readlinkSync(backupPath), oldExtSource, "backup must point to the stale source");

    // Inode and link target must be identical
    assert.equal(extStats.ino, backupStats.ino, "canonical target and backup must share the exact same inode");
    assert.ok(extStats.nlink >= 2, "canonical target must have at least 2 hardlinks");
    assert.ok(backupStats.nlink >= 2, "backup must have at least 2 hardlinks");

    // Current extension is not installed
    const expectedNewSource = join(repo, "extensions", "gsd-context.js");
    assert.notEqual(readlinkSync(extTarget), expectedNewSource, "current extension must not be installed");

    // No proven-owned temp leaks
    assert.equal(files.length, 2, "no installer-owned artifacts or backup files must leak");
    assert.deepEqual(files.sort(), [backupFile, "gsd-context.js"].sort());

  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: trailing-newline symlink target is not accepted as same-source or managed stale and remains unchanged", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);
    const extSource = join(repo, "extensions", "gsd-context.js");

    // Case 1: Symlink target is same-source with trailing newline
    mkdirSync(extDir, { recursive: true });
    symlinkSync(extSource + "\n", extTarget);

    const resSameNL = runInstallerAt(repo, home, fakeBin);
    assert.equal(resSameNL.status, 1, "should fail because target has a trailing newline");
    assert.match(resSameNL.stderr, /unmanaged collision/);
    assert.ok(lstatSync(extTarget).isSymbolicLink(), "should remain a symlink");
    assert.equal(readlinkSync(extTarget), extSource + "\n", "target must not change");

    // Clean up
    rmSync(extTarget);

    // Case 2: Symlink target is stale-source with trailing newline
    symlinkSync("/some/old-repo/extensions/gsd-context.js\n", extTarget);

    const resStaleNL = runInstallerAt(repo, home, fakeBin);
    assert.equal(resStaleNL.status, 1, "should fail because stale target has a trailing newline");
    assert.match(resStaleNL.stderr, /unmanaged collision/);
    assert.ok(lstatSync(extTarget).isSymbolicLink(), "should remain a symlink");
    assert.equal(readlinkSync(extTarget), "/some/old-repo/extensions/gsd-context.js\n", "target must not change");

  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: post-backup-move race - target replacement after backup move", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";

    // Case 1: Owned backup is removed, raced target is preserved.
    mkdirSync(extDir, { recursive: true });
    symlinkSync(oldExtSource, extTarget);

    const resReg = runInstallerAt(repo, home, fakeBin, { GSD_TEST_SEAM_POST_BACKUP_MOVE: "regular" });
    assert.equal(resReg.status, 1, "should fail because target was raced in post-backup-move");
    assert.match(resReg.stderr, /unmanaged collision/);

    // The raced target must be preserved
    assert.ok(lstatSync(extTarget).isFile(), "raced target must remain a regular file");
    assert.equal(readFileSync(extTarget, "utf8").trim(), "raced content post-backup-move", "raced target content must be preserved");

    // The owned backup must be removed, and no temp artifacts should remain
    assert.deepEqual(readdirSync(extDir), ["gsd-context.js"], "no backup or temp files should remain in Case 1");

    // Clean up target for Case 2
    rmSync(extTarget);

    // Case 2: Unowned backup is preserved, raced target is preserved.
    symlinkSync(oldExtSource, extTarget);

    // Run with both seams: one to publish an unowned backup, and one to create a raced target post backup move.
    const resUnowned = runInstallerAt(repo, home, fakeBin, {
      GSD_TEST_SEAM_BACKUP_PUBLISH: "regular",
      GSD_TEST_SEAM_POST_BACKUP_MOVE: "regular"
    });
    assert.equal(resUnowned.status, 1, "should fail because target was raced in post-backup-move and backup is unowned");

    // The raced target must be preserved
    assert.ok(lstatSync(extTarget).isFile(), "raced target must remain a regular file in Case 2");
    assert.equal(readFileSync(extTarget, "utf8").trim(), "raced content post-backup-move", "raced target content must be preserved in Case 2");

    // Find the backup file in extDir
    const files = readdirSync(extDir);
    const backup = files.find(f => f.startsWith("gsd-context.js.backup."));
    assert.ok(backup, "unowned backup file must exist in Case 2");
    const backupPath = join(extDir, backup);
    assert.ok(lstatSync(backupPath).isFile(), "unowned backup must remain a regular file");
    assert.equal(readFileSync(backupPath, "utf8").trim(), "unowned backup content", "unowned backup content must survive byte-for-byte");

    // Only "gsd-context.js" and the backup file should exist in the directory (no temp artifacts)
    const expectedFiles = ["gsd-context.js", backup].sort();
    assert.deepEqual(readdirSync(extDir).sort(), expectedFiles, "only raced target and unowned backup should remain in Case 2");

  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
test("T4: replace backup after a successful move while target remains absent", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";

    mkdirSync(extDir, { recursive: true });
    symlinkSync(oldExtSource, extTarget);

    // Run the installer with a seam that replaces the backup target after successful move, while target remains absent
    const res = runInstallerAt(repo, home, fakeBin, {
      GSD_TEST_SEAM_POST_BACKUP_MOVE: "replace_backup_target_absent"
    });

    assert.equal(res.status, 1, "should fail because backup identity was replaced");

    // The target must contain the restored unowned replacement byte-for-byte
    assert.ok(lstatSync(extTarget).isFile(), "gsd-context.js target must be a regular file");
    assert.equal(readFileSync(extTarget, "utf8").trim(), "unowned backup replacement", "gsd-context.js target must match the replacement content");

    // The backup must be absent after successful guarded restore
    const files = readdirSync(extDir);
    const backup = files.find(f => f.startsWith("gsd-context.js.backup."));
    assert.ok(!backup, "backup file must not exist after successful restore");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: post-capture regular replacement in real window is restored on failure", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";

    mkdirSync(extDir, { recursive: true });
    symlinkSync(oldExtSource, extTarget);

    const res = runInstallerAt(repo, home, fakeBin, {
      GSD_TEST_SEAM_POST_CAPTURE_REPLACE: "regular"
    });

    assert.equal(res.status, 1, "should fail because backup identity was replaced post-capture");

    // The target must contain the restored regular file replacement byte-for-byte
    assert.ok(lstatSync(extTarget).isFile(), "gsd-context.js target must be restored to a regular file");
    assert.equal(readFileSync(extTarget, "utf8").trim(), "post-capture regular", "gsd-context.js target must match the post-capture content");

    // The backup must be absent after successful guarded restore
    const files = readdirSync(extDir);
    const backup = files.find(f => f.startsWith("gsd-context.js.backup."));
    assert.ok(!backup, "backup file must not exist after successful restore");

  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: post-capture symlink replacement in real window is restored on failure", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";

    mkdirSync(extDir, { recursive: true });
    symlinkSync(oldExtSource, extTarget);

    const res = runInstallerAt(repo, home, fakeBin, {
      GSD_TEST_SEAM_POST_CAPTURE_REPLACE: "symlink"
    });

    assert.equal(res.status, 1, "should fail because backup identity was replaced post-capture");

    // The target must contain the restored symlink target-byte-for-byte
    assert.ok(lstatSync(extTarget).isSymbolicLink(), "gsd-context.js target must be restored to a symlink");
    assert.equal(readlinkSync(extTarget), "/some/other/replacement/path", "gsd-context.js target must match the post-capture symlink target");

    // The backup must be absent after successful guarded restore
    const files = readdirSync(extDir);
    const backup = files.find(f => f.startsWith("gsd-context.js.backup."));
    assert.ok(!backup, "backup file must not exist after successful restore");

  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: make old referent live after ownership proof and verify still-owned backup is removed", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);
    const oldExtSource = join(temporary, "old-repo", "extensions", "gsd-context.js");

    mkdirSync(extDir, { recursive: true });
    symlinkSync(oldExtSource, extTarget);

    // Run installer: target races in post-backup-move, and referent becomes live after ownership proof
    const res = runInstallerAt(repo, home, fakeBin, {
      GSD_TEST_SEAM_POST_BACKUP_MOVE: "regular",
      GSD_TEST_SEAM_MAKE_REFERENT_LIVE: "1"
    });

    assert.equal(res.status, 1, "should fail due to post-backup-move target race");

    // Raced target behavior remains correct (the raced regular file is preserved)
    assert.ok(lstatSync(extTarget).isFile(), "raced target must remain a regular file");
    assert.equal(readFileSync(extTarget, "utf8").trim(), "raced content post-backup-move", "raced target content must be preserved");

    // The still-owned backup must be removed even though its referent became live
    const files = readdirSync(extDir);
    assert.deepEqual(files, ["gsd-context.js"], "still-owned backup must be removed");

  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: Seam 1 - replace object between validation and quarantine (GSD_TEST_SEAM_PRE_QUARANTINE)", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";

    mkdirSync(extDir, { recursive: true });
    symlinkSync(oldExtSource, extTarget);

    const res = runInstallerAt(repo, home, fakeBin, {
      GSD_TEST_SEAM_PRE_QUARANTINE: "regular"
    });

    assert.equal(res.status, 1, "should fail because backup was replaced pre-quarantine");

    // The target is successfully published (installer-owned), but the unowned replacement is preserved in backup path (never exposed to target)
    assert.ok(lstatSync(extTarget).isSymbolicLink(), "gsd-context.js target must be a symlink");
    assert.equal(readlinkSync(extTarget), join(repo, "extensions", "gsd-context.js"), "target should point to the new extension source");

    // The backup must contain the unowned replacement
    const files = readdirSync(extDir);
    const backup = files.find(f => f.startsWith("gsd-context.js.backup."));
    assert.ok(backup, "backup file must exist at backup path");
    const backupPath = join(extDir, backup);
    assert.ok(lstatSync(backupPath).isFile(), "backup must be a regular file");
    assert.equal(readFileSync(backupPath, "utf8").trim(), "raced content pre-quarantine", "unowned replacement must stay at backup");

    // Only the target and backup should remain in extension dir (installer-owned artifacts resolved)
    assert.deepEqual(readdirSync(extDir).sort(), ["gsd-context.js", backup].sort(), "installer-owned artifacts should be resolved without touching unowned backup");

  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: Seam 2 - replace object between quarantine revalidation and delete/restore (GSD_TEST_SEAM_POST_QUARANTINE_REVALIDATE)", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";

    mkdirSync(extDir, { recursive: true });
    symlinkSync(oldExtSource, extTarget);

    const res = runInstallerAt(repo, home, fakeBin, {
      GSD_TEST_SEAM_POST_QUARANTINE_REVALIDATE: "replace_quarantine"
    });

    assert.equal(res.status, 1, "should fail because quarantine was replaced after revalidation");

    // The target is successfully published (installer-owned), but the unowned replacement is preserved in backup path (never exposed to target)
    assert.ok(lstatSync(extTarget).isSymbolicLink(), "gsd-context.js target must be a symlink");
    assert.equal(readlinkSync(extTarget), join(repo, "extensions", "gsd-context.js"), "target should point to the new extension source");

    // The backup must contain the unowned replacement
    const files = readdirSync(extDir);
    const backup = files.find(f => f.startsWith("gsd-context.js.backup."));
    assert.ok(backup, "backup file must exist at backup path");
    const backupPath = join(extDir, backup);
    assert.ok(lstatSync(backupPath).isFile(), "backup must be a regular file");
    assert.equal(readFileSync(backupPath, "utf8").trim(), "unowned quarantine replacement", "unowned replacement must stay at backup");

    // Only the target and backup should remain in extension dir (installer-owned artifacts resolved)
    assert.deepEqual(readdirSync(extDir).sort(), ["gsd-context.js", backup].sort(), "installer-owned artifacts should be resolved without touching unowned backup");

  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
test("T4: source recreation after successful quarantine move preserves source replacement and processes approved quarantine", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";

    mkdirSync(extDir, { recursive: true });
    symlinkSync(oldExtSource, extTarget);

    const res = runInstallerAt(repo, home, fakeBin, {
      GSD_TEST_SEAM_POST_QUARANTINE_MOVE: "recreate_source"
    });

    assert.equal(res.status, 0, "installer should succeed after quarantine deletion");
    assert.ok(lstatSync(extTarget).isSymbolicLink(), "target must point to new extension source");
    assert.equal(readlinkSync(extTarget), join(repo, "extensions", "gsd-context.js"));

    const files = readdirSync(extDir);
    const backup = files.find(f => f.startsWith("gsd-context.js.backup."));
    assert.ok(backup, "recreated backup source must be preserved at backup path");
    assert.equal(readFileSync(join(extDir, backup), "utf8").trim(), "recreated source content", "source replacement must survive byte-for-byte");

    const orphanQuarantine = files.find(f => f.includes(".quarantine."));
    assert.equal(orphanQuarantine, undefined, "no owned quarantine orphan should remain");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: TERM immediately after quarantine move processes approved quarantine and leaves no owned orphan", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";

    mkdirSync(extDir, { recursive: true });
    symlinkSync(oldExtSource, extTarget);

    const res = runInstallerAt(repo, home, fakeBin, {
      GSD_TEST_SEAM_POST_QUARANTINE_MOVE: "sigterm"
    });

    assert.equal(res.status, 143, "should exit with conventional status 143 on SIGTERM");
    assert.ok(lstatSync(extTarget).isSymbolicLink(), "published symlink must exist at target");
    assert.equal(readlinkSync(extTarget), join(repo, "extensions", "gsd-context.js"), "published link should point to new extension source");

    const files = readdirSync(extDir);
    assert.deepEqual(files, ["gsd-context.js"], "no backup or quarantine orphans should remain");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: skipped quarantine move preserves unowned pre-existing quarantine and owned backup source", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";

    mkdirSync(extDir, { recursive: true });
    symlinkSync(oldExtSource, extTarget);
    const res = runInstallerAt(repo, home, fakeBin, {
      GSD_TEST_SEAM_PRE_QUARANTINE: "quarantine_collision",
      GSD_TEST_SEAM_RACE: "regular"
    });

    assert.equal(res.status, 1, "should fail due to quarantine collision and target race");

    // Assert that the target has the raced content
    assert.ok(lstatSync(extTarget).isFile(), "target must be a regular file");
    assert.equal(readFileSync(extTarget, "utf8").trim(), "raced content", "target must have the raced content");
    const files = readdirSync(extDir);

    // We should find the first quarantine file (collision)
    const quarantineFiles = files.filter(f => f.includes(".quarantine."));
    assert.equal(quarantineFiles.length, 1, "should have exactly one quarantine file");

    const collisionFile = quarantineFiles[0];
    const collisionPath = join(extDir, collisionFile);
    assert.ok(lstatSync(collisionPath).isFile(), "collision must be a regular file");
    assert.equal(readFileSync(collisionPath, "utf8").trim(), "unowned quarantine collision", "unowned quarantine collision file must exist");

    // We should verify the owned backup file (approved backup source) is cleaned up and not leaked
    const backupFiles = files.filter(f => f.startsWith("gsd-context.js.backup.") && !f.includes(".quarantine."));
    assert.equal(backupFiles.length, 0, "owned backup source must be cleaned up and not leaked");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("T4: signal termination after successful publication cleans up backup and quarantine", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";

    mkdirSync(extDir, { recursive: true });
    symlinkSync(oldExtSource, extTarget);

    const res = runInstallerAt(repo, home, fakeBin, {
      GSD_TEST_SEAM_POST_PUBLISH: "sigterm"
    });

    assert.equal(res.status, 143, "should exit with conventional status 143 on SIGTERM");
    assert.ok(lstatSync(extTarget).isSymbolicLink(), "published symlink must exist at target");
    assert.equal(readlinkSync(extTarget), join(repo, "extensions", "gsd-context.js"), "target should point to the new extension source");

    const files = readdirSync(extDir);
    assert.deepEqual(files, ["gsd-context.js"], "no backup or quarantine files should remain after successful publication signal cleanup");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});


test("T4: combined regular race and post-quarantine sigterm cleanup behavior", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  writeExecutable(join(fakeBin, "git"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(fakeBin, "pnpm"), "#!/bin/sh\nexit 1\n");

  try {
    mkdirSync(join(repo, "extensions"), { recursive: true });
    writeFileSync(join(repo, "extensions", "gsd-context.js"), "const foo = 1;");

    const extTarget = join(home, ".omp", "agent", "extensions", "gsd-context.js");
    const extDir = dirname(extTarget);
    const oldExtSource = "/some/old-repo/extensions/gsd-context.js";

    mkdirSync(extDir, { recursive: true });
    symlinkSync(oldExtSource, extTarget);

    const res = runInstallerAt(repo, home, fakeBin, {
      GSD_TEST_SEAM_RACE: "regular",
      GSD_TEST_SEAM_POST_QUARANTINE_MOVE: "sigterm"
    });

    assert.equal(res.status, 143, "should exit with conventional status 143 on SIGTERM");
    assert.ok(lstatSync(extTarget).isFile(), "target must remain a regular file");
    assert.equal(readFileSync(extTarget, "utf8").trim(), "raced content", "target content must remain unchanged");

    const files = readdirSync(extDir);
    assert.deepEqual(files, ["gsd-context.js"], "no backup or quarantine files should remain after cleanup");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
