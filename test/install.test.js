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

function populateInstallRepo(repo, { withDist = false } = {}) {
  const lavish = join(repo, "tools", "lavish-axi");
  mkdirSync(lavish, { recursive: true });
  copyFileSync(join(ROOT, "install.sh"), join(repo, "install.sh"));
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

test("AC-1: special paths round-trip idempotently", () => {
  const specialName = 'repo space " \\ $ ` * ? [ ]';
  const { temporary, home, fakeBin, repo } = makeInstallFixture({ repoName: specialName });
  for (const command of ["git", "pnpm"]) {
    writeExecutable(join(fakeBin, command), "#!/bin/sh\nexit 1\n");
  }

  try {
    const first = runInstallerAt(repo, home, fakeBin);
    assert.equal(first.status, 0, first.stderr + first.stdout);

    const commands = join(home, ".omp", "agent", "commands");
    const target = join(commands, "gsd.md");
    const installed = readFileSync(target, "utf8");
    assert.match(installed, /^<!-- gsd-managed-command:v1 -->$/m);

    const expectedEscaped = repo
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');

    assert.match(installed, new RegExp(`^GSD_ROOT="${expectedEscaped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"$`, "m"));

    const second = runInstallerAt(repo, home, fakeBin);
    assert.equal(second.status, 0, second.stderr + second.stdout);
    assert.equal(readFileSync(target, "utf8"), installed);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("stale-template/same-root refresh scenario", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  for (const command of ["git", "pnpm"]) {
    writeExecutable(join(fakeBin, command), "#!/bin/sh\nexit 1\n");
  }

  const commands = join(home, ".omp", "agent", "commands");
  const target = join(commands, "gsd.md");
  mkdirSync(commands, { recursive: true });

  const staleContent = `---
description: Test stale template
---
<!-- gsd-managed-command:v1 -->
GSD_ROOT="${repo.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"

Old stale template text that is different from new one.
`;

  writeFileSync(target, staleContent);

  try {
    const result = runInstallerAt(repo, home, fakeBin);
    assert.equal(result.status, 0, result.stderr + result.stdout);

    const installed = readFileSync(target, "utf8");
    assert.match(installed, /^# GSD Command$/m);
    assert.match(installed, new RegExp(`^GSD_ROOT="${repo.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"$`, "m"));
    assert.notEqual(installed, staleContent, "Template must be refreshed and not match the stale content");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("AC-2: live checkout ownership is protected", () => {
  const specialName = 'repo space " \\ $ ` * ? [ ]';
  const { temporary, home, fakeBin, repo: repo1 } = makeInstallFixture({ repoName: specialName });
  for (const command of ["git", "pnpm"]) {
    writeExecutable(join(fakeBin, command), "#!/bin/sh\nexit 1\n");
  }

  const repo2 = join(temporary, "repo-second");
  populateInstallRepo(repo2);

  try {
    const first = runInstallerAt(repo1, home, fakeBin);
    assert.equal(first.status, 0, first.stderr + first.stdout);

    const target = join(home, ".omp", "agent", "commands", "gsd.md");
    const firstContent = readFileSync(target, "utf8");

    const second = runInstallerAt(repo2, home, fakeBin);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /live-other-root managed collision/);
    assert.match(second.stderr, new RegExp(repo1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    assert.equal(readFileSync(target, "utf8"), firstContent);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("AC-3: stale checkout ownership relocates safely", () => {
  const specialName = 'repo space " \\ $ ` * ? [ ]';
  const { temporary: temp1, home, fakeBin, repo: repo1 } = makeInstallFixture({ repoName: specialName });
  for (const command of ["git", "pnpm"]) {
    writeExecutable(join(fakeBin, command), "#!/bin/sh\nexit 1\n");
  }

  const temp2 = mkdtempSync(join(tmpdir(), "gsd-install-repo2-"));
  const repo2 = join(temp2, "repo-second");
  populateInstallRepo(repo2);

  try {
    const first = runInstallerAt(repo1, home, fakeBin);
    assert.equal(first.status, 0, first.stderr + first.stdout);

    const target = join(home, ".omp", "agent", "commands", "gsd.md");
    const firstContent = readFileSync(target, "utf8");

    rmSync(repo1, { recursive: true, force: true });

    const second = runInstallerAt(repo2, home, fakeBin);
    assert.equal(second.status, 0, second.stderr + second.stdout);

    const secondContent = readFileSync(target, "utf8");
    assert.notEqual(secondContent, firstContent);
    assert.match(secondContent, new RegExp(`^GSD_ROOT="${repo2.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"$`, "m"));
  } finally {
    rmSync(temp1, { recursive: true, force: true });
    rmSync(temp2, { recursive: true, force: true });
  }
});

test("AC-4: malformed managed roots fail closed", () => {
  const { temporary, home, fakeBin, repo } = makeInstallFixture();
  for (const command of ["git", "pnpm"]) {
    writeExecutable(join(fakeBin, command), "#!/bin/sh\nexit 1\n");
  }

  const commands = join(home, ".omp", "agent", "commands");
  const target = join(commands, "gsd.md");
  mkdirSync(commands, { recursive: true });

  const testCases = [
    {
      name: "unsupported escape",
      content: '---\ndescription: Test\n---\n<!-- gsd-managed-command:v1 -->\nGSD_ROOT="a\\b\\c\\d"\n',
      errorPattern: /malformed target|unsupported escape/
    },
    {
      name: "missing root",
      content: '---\ndescription: Test\n---\n<!-- gsd-managed-command:v1 -->\n',
      errorPattern: /unmarked\/malformed target|no GSD_ROOT/
    },
    {
      name: "empty root",
      content: '---\ndescription: Test\n---\n<!-- gsd-managed-command:v1 -->\nGSD_ROOT=""\n',
      errorPattern: /malformed target|non-absolute/
    },
    {
      name: "relative root",
      content: '---\ndescription: Test\n---\n<!-- gsd-managed-command:v1 -->\nGSD_ROOT="some-path"\n',
      errorPattern: /malformed target|non-absolute/
    },
    {
      name: "duplicate GSD_ROOT lines",
      content: '---\ndescription: Test\n---\n<!-- gsd-managed-command:v1 -->\nGSD_ROOT="path1"\nGSD_ROOT="path2"\n',
      errorPattern: /malformed target|duplicate/
    },
    {
      name: "unsupported escape character",
      content: '---\ndescription: Test\n---\n<!-- gsd-managed-command:v1 -->\nGSD_ROOT="path\\$"\n',
      errorPattern: /malformed target|unsupported escape/
    },
    {
      name: "carriage return in GSD_ROOT line",
      content: "---\r\ndescription: Test\r\n---\r\n<!-- gsd-managed-command:v1 -->\r\nGSD_ROOT=\"path\"\r\n",
      errorPattern: /malformed target|carriage return/
    },
    {
      name: "unsupported managed command version",
      content: '---\ndescription: Test\n---\n<!-- gsd-managed-command:v2 -->\nGSD_ROOT="some-path"\n',
      errorPattern: /malformed target|unsupported managed command version/
    },
    {
      name: "duplicate markers with different versions",
      content: '---\ndescription: Test\n---\n<!-- gsd-managed-command:v1 -->\n<!-- gsd-managed-command:v2 -->\nGSD_ROOT="some-path"\n',
      errorPattern: /malformed target|exactly one/
    },
    {
      name: "NUL bytes in target",
      content: '---\ndescription: Test\n---\n<!-- gsd-managed-command:v1 -->\nG\0SD_ROOT="some-path"\n',
      errorPattern: /malformed target|contains NUL bytes/
    }
  ];

  try {
    for (const tc of testCases) {
      writeFileSync(target, tc.content);
      const result = runInstallerAt(repo, home, fakeBin);
      assert.equal(result.status, 1, `Should fail for: ${tc.name}`);
      assert.match(result.stderr, tc.errorPattern, `Error message for ${tc.name} must match ${tc.errorPattern}`);
      assert.equal(readFileSync(target, "utf8"), tc.content, `Content for ${tc.name} must be unchanged`);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
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

  const commands = join(home, ".omp", "agent", "commands");
  const target = join(commands, "gsd.md");

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
  assert.match(installer, /mktemp "\$\{commands_dir\}\/gsd\.md\.XXXXXX"/);
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
