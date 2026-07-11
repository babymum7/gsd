import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, writeFileSync, existsSync,
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

function makeHomeSandbox() {
  const temporary = mkdtempSync(join(tmpdir(), "gsd-install-"));
  const home = join(temporary, "home");
  const fakeBin = join(temporary, "bin");
  mkdirSync(home);
  mkdirSync(fakeBin);
  return { temporary, home, fakeBin };
}

/**
 * Clone a minimal install-capable repo tree into a temp dir so install.sh's
 * REPO resolves to the fixture (not the live checkout). Copies install.sh,
 * VERSION, .gitmodules, and a lightweight tools/lavish-axi/ tree.
 */
function makeInstallFixture({ withDist = false } = {}) {
  const temporary = mkdtempSync(join(tmpdir(), "gsd-install-repo-"));
  const home = join(temporary, "home");
  const fakeBin = join(temporary, "bin");
  const repo = join(temporary, "repo");
  const lavish = join(repo, "tools", "lavish-axi");
  mkdirSync(home);
  mkdirSync(fakeBin);
  mkdirSync(lavish, { recursive: true });
  copyFileSync(join(ROOT, "install.sh"), join(repo, "install.sh"));
  copyFileSync(join(ROOT, "VERSION"), join(repo, "VERSION"));
  copyFileSync(join(ROOT, ".gitmodules"), join(repo, ".gitmodules"));
  writeFileSync(join(lavish, "package.json"), '{"name":"lavish-axi-fixture"}\n');
  if (withDist) {
    mkdirSync(join(lavish, "dist"), { recursive: true });
    writeFileSync(join(lavish, "dist", "cli.mjs"), "export default 1;\n");
  }
  return { temporary, home, fakeBin, repo, lavish };
}

function runInstallerAt(repo, home, fakeBin) {
  return spawnSync("bash", ["install.sh"], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
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

test("installer registers idempotently and refuses unmanaged collisions", () => {
  const { temporary, home, fakeBin } = makeHomeSandbox();
  for (const command of ["git", "pnpm"]) {
    writeExecutable(join(fakeBin, command), "#!/bin/sh\nexit 1\n");
  }

  try {
    const first = runInstaller(home, fakeBin);
    assert.equal(first.status, 0, first.stderr);
    const commands = join(home, ".omp", "agent", "commands");
    const target = join(commands, "gsd.md");
    const installed = readFileSync(target, "utf8");
    assert.match(installed, /^<!-- gsd-managed-command:v1 -->$/m);
    assert.match(installed, new RegExp(`^GSD_ROOT=${JSON.stringify(ROOT).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
    assert.deepEqual(readdirSync(commands), ["gsd.md"]);

    const second = runInstaller(home, fakeBin);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(target, "utf8"), installed);

    writeFileSync(target, "user-owned command\n");
    const collision = runInstaller(home, fakeBin);
    assert.equal(collision.status, 1);
    assert.match(collision.stderr, /not managed by GSD/);
    assert.equal(readFileSync(target, "utf8"), "user-owned command\n");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("portable mktemp templates end in X", () => {
  const installer = readFileSync(join(ROOT, "install.sh"), "utf8");
  const lavish = readFileSync(join(ROOT, "skills", "gsd-lavish", "SKILL.md"), "utf8");
  assert.match(installer, /mktemp "\$\{OMP_COMMANDS_DIR\}\/gsd\.md\.XXXXXX"/);
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
    const target = join(home, ".omp", "agent", "commands", "gsd.md");
    assert.match(readFileSync(target, "utf8"), /^<!-- gsd-managed-command:v1 -->$/m);
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
    const target = join(home, ".omp", "agent", "commands", "gsd.md");
    assert.match(readFileSync(target, "utf8"), /^<!-- gsd-managed-command:v1 -->$/m);
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
});
