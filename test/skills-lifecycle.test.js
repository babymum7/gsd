import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { read, readdirSync, skillNames, ROOT, } from "./support/skills-fixtures.js";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBootstrap, discoverSkillCatalog } from "../lib/gsd-bootstrap.mjs";
import {
  describeEvalBackendError, selectEvalBackend,
  evalSurfaceFingerprint, loadLifecycleMatrix,
} from "./eval/activation-eval-contract.mjs";

test("AC-11: the repository manifest publishes the deterministic contract suite", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.version, "0.0.1", "GSD remains explicitly pre-release");

  // The suite is the repository's only deterministic gate, so a fresh clone must be
  // able to run it from the manifest instead of copying a command out of prose.
  assert.equal(manifest.type, "module", "the manifest declares ES module semantics");
  assert.equal(manifest.private, true, "the manifest is private and never published");
  assert.match(manifest.scripts.test, /bun test/, "the test script runs the bun test runner");
  assert.match(manifest.scripts.test, /test\/\*\.test\.js/, "the test script runs every contract suite file");
  assert.ok(!manifest.dependencies, "the contract suite carries no runtime dependency");
  assert.ok(!manifest.devDependencies, "the contract suite carries no development dependency");
  // The description used to name only the OMP extension, which the adapter seam made stale.
  for (const host of ["OMP", "Claude Code", "Codex"]) {
    assert.match(
      manifest.description,
      new RegExp(host),
      `the manifest description must name the supported host ${host}`,
    );
  }

  // README is the human entry point for the same command, so the two must not drift.
  assert.match(read("README.md"), /bun test/, "the README names the bun test command");
});

// The layout tree is the map a reader uses to find the core, and it silently lost
// lib/gsd-session-context.mjs - the module both new host adapters share - because nothing
// tied the tree to the directories it describes.
test("the README layout tree names every core file, adapter, and skill", () => {
  const tree = read("README.md").match(/```text\n(adapters\/[\s\S]*?)```/)?.[1];
  assert.ok(tree, "the README must publish the repository layout tree");
  const missing = [];
  for (const file of readdirSync(join(ROOT, "lib"))) {
    if (!tree.includes(file)) missing.push(`lib/${file}`);
  }
  for (const file of readdirSync(join(ROOT, "tools"))) {
    if (!tree.includes(file)) missing.push(`tools/${file}`);
  }
  for (const entry of readdirSync(join(ROOT, "adapters"), { withFileTypes: true })) {
    if (entry.isDirectory() && !tree.includes(`${entry.name}/`)) {
      missing.push(`adapters/${entry.name}/`);
    }
  }
  for (const entry of readdirSync(join(ROOT, "skills"), { withFileTypes: true })) {
    if (entry.isDirectory() && !tree.includes(`${entry.name}/`)) {
      missing.push(`skills/${entry.name}/`);
    }
  }
  assert.deepEqual(missing, [], "the README layout tree must name every core file and directory");
});

test("the package ships only the unified host plugin CLI", () => {
  const legacyInstallers = [
    "install.sh",
    "adapters/omp/install.sh",
    "adapters/claude-code/install.mjs",
    "adapters/codex/install.mjs",
    "test/install.test.js",
    "test/adapters-claude-code-install.test.js",
    "test/adapters-codex-install.test.js",
  ];
  for (const path of legacyInstallers) {
    assert.equal(existsSync(join(ROOT, path)), false, `${path} must not ship`);
  }

  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.scripts["lint:shell"], undefined, "shell installer lint is not shipped");
  const adapters = read("adapters/README.md");
  const readme = read("README.md");
  assert.match(readme, /bun bin\/gsd\.mjs install/, "the README names the unified install command");
  assert.doesNotMatch(
    adapters,
    /Codex installer/i,
    "current adapter documentation must not claim a removed installer",
  );
  assert.doesNotMatch(
    readme,
    /The older installers remain compatibility entry points/,
    "compatibility installers are not documented",
  );
});

test("AC-2: Bun is the sole runtime across engines, shebangs, and prose", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.engines.bun, ">=1.3.14", "engines.bun declares the validated Bun minimum");
  assert.equal(manifest.engines.node, undefined, "Node is no longer a runtime prerequisite");
  assert.match(manifest.scripts.lint, /^bunx --yes @biomejs\/biome@2\.5\.8 lint \.$/, "lint runs through bunx");
  assert.match(manifest.scripts.format, /^bunx --yes @biomejs\/biome@2\.5\.8 format --write$/, "format runs through bunx");
  assert.equal(existsSync(join(ROOT, ".nvmrc")), false, "no Node version pin remains");

  const executables = [
    "tools/gsd-contract.mjs",
    "tools/gsd-domain.mjs",
    "tools/gsd-git.mjs",
    "tools/gsd-record.mjs",
    "tools/gsd-state.mjs",
    "test/eval/activation-eval.mjs",
    "test/eval/eval-models.mjs",
    "test/eval/triage-eval.mjs",
  ];
  for (const path of executables) {
    const body = read(path);
    assert.equal(body.split("\n")[0], "#!/usr/bin/env bun", `${path} uses the Bun shebang`);
    assert.doesNotMatch(body, /INVOCATION = `node /, `${path} must not emit a node invocation`);
    assert.doesNotMatch(body, /\bnode\s+test\//, `${path} must not invoke node in usage prose`);
  }

  const prose = [
    "README.md",
    "skills/gsd/REFERENCE.md",
    ...skillNames().map((name) => `skills/${name}/SKILL.md`),
  ];
  for (const path of prose) {
    const body = read(path);
    assert.doesNotMatch(body, /node\s+"/, `${path} must not invoke node with a quoted tool path`);
    assert.doesNotMatch(body, /node --test/, `${path} must not invoke the node test runner`);
  }
});

test("the activation evaluator runs keyless through the local omp CLI", () => {
  // A bearer key is not the way to reach a model here: the local omp binary already
  // holds credentials, so it is preferred and an ambient OPENAI_API_KEY cannot silently
  // bill an HTTP endpoint. `GSD_EVAL_BACKEND` is the explicit override.
  const ambientKey = selectEvalBackend({ OPENAI_API_KEY: "sk-ambient" }, "/usr/bin/omp");
  assert.equal(ambientKey.kind, "omp");
  assert.equal(ambientKey.command, "/usr/bin/omp");
  assert.deepEqual(ambientKey.models, ["gpt-5.6-luna"]);

  const keyless = selectEvalBackend({}, "/usr/bin/omp");
  assert.equal(keyless.kind, "omp");
  assert.deepEqual(keyless.models, ["gpt-5.6-luna"]);

  // No binary falls back to a bearer key; forcing http uses it even when omp exists.
  assert.equal(selectEvalBackend({ GSD_EVAL_KEY: "sk-test" }, null).kind, "http");
  const forcedHttp = selectEvalBackend({ GSD_EVAL_KEY: "sk-test", GSD_EVAL_BACKEND: "http" }, "/usr/bin/omp");
  assert.equal(forcedHttp.kind, "http");
  assert.deepEqual(forcedHttp.models, ["gpt-4o-mini"]);

  // An explicit model list overrides the default on either backend, and a model dropped
  // from the default set is still reachable that way rather than deleted.
  assert.deepEqual(
    selectEvalBackend({ GSD_EVAL_MODEL: " gemini-3.6-flash , gpt-5.6-luna " }, "/usr/bin/omp").models,
    ["gemini-3.6-flash", "gpt-5.6-luna"],
  );
  assert.deepEqual(
    selectEvalBackend({ GSD_EVAL_MODEL: "gemini-3.6-flash" }, "/usr/bin/omp").models,
    ["gemini-3.6-flash"],
  );
  assert.deepEqual(
    selectEvalBackend({ GSD_EVAL_KEY: "sk-test", GSD_EVAL_MODEL: "gpt-4.1" }, null).models,
    ["gpt-4.1"],
  );

  // A backend without its credential skips instead of pretending to run.
  assert.equal(selectEvalBackend({}, null).kind, "skip");
  assert.equal(selectEvalBackend({ GSD_EVAL_BACKEND: "http" }, "/usr/bin/omp").kind, "skip");
  assert.equal(selectEvalBackend({ GSD_EVAL_KEY: "sk-test", GSD_EVAL_BACKEND: "omp" }, null).kind, "skip");

  // Each model reports its own result, so one model cannot mask the other's failure.
  const runner = read("test/eval/activation-eval.mjs");
  assert.match(runner, /\$\{model\}(?::|\|)\$\{fixture\.id\}|\$\{fixture\.id\}(?::|\|)\$\{model\}/);
  // The omp run is isolated: no repo cwd, discovered extensions, skills, rules, tools, or session.
  for (const flag of [
    "--cwd", "--no-extensions", "--no-skills", "--no-rules", "--no-tools", "--no-session", "--system-prompt",
  ]) {
    assert.ok(runner.includes(flag), `omp eval run must pass ${flag}`);
  }

  // The shipped documentation names the same single default and the opt-in that reaches
  // any de-defaulted model, so a reader cannot infer a two-model baseline.
  const readme = read("README.md");
  const evalDoc = readme.match(/^It prefers the local `omp` binary.*$/m);
  assert.ok(evalDoc, "README must document the eval backend default");
  assert.match(evalDoc[0], /`gpt-5\.6-luna`/);
  assert.doesNotMatch(evalDoc[0], /`gemini-3\.6-flash`/);
  assert.match(readme, /GSD_EVAL_MODEL[\s\S]{0,400}gemini-3\.6-flash/);
});

test("the activation evaluator fails fast on a backend error instead of scoring every fixture", () => {
  // A dead credential or endpoint is not a routing regression: the runner must stop with a
  // distinct exit code and score nothing, rather than printing "0/N checks pass".
  assert.match(
    describeEvalBackendError("omp exit 1: 401 Incorrect API key provided: thk_live"),
    /rejected credentials/,
  );
  assert.match(describeEvalBackendError("fetch failed"), /backend unavailable/);

  const dir = mkdtempSync(join(tmpdir(), "gsd-eval-backend-"));
  const fakeOmp = join(dir, "omp");
  writeFileSync(fakeOmp, "#!/bin/sh\necho '401 Incorrect API key provided: thk_live' >&2\nexit 1\n");
  chmodSync(fakeOmp, 0o755);
  const result = spawnSync(process.execPath, ["test/eval/activation-eval.mjs", "--only", "nano-typo"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, GSD_EVAL_BACKEND: "omp", GSD_EVAL_OMP: fakeOmp, GSD_EVAL_MODEL: "fake-model" },
  });
  assert.equal(result.status, 3, result.stderr);
  assert.match(result.stderr, /eval aborted, no fixture was scored: backend rejected credentials/);
  assert.doesNotMatch(result.stdout, /checks pass/, "a backend error must not be reported as scored fixtures");

  // The two-pass runner shares the same contract, so a backend error cannot be scored there either.
  const modelsRunner = read("test/eval/eval-models.mjs");
  assert.match(modelsRunner, /describeEvalBackendError/);
  assert.match(modelsRunner, /process\.exit\(3\)/);
});

test("the triage eval scores routes through the same fail-fast backend", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-eval-triage-"));
  let seq = 0;
  const runTriageEval = (script) => {
    const fakeOmp = join(dir, `omp-${seq}`);
    const reportPath = join(dir, `triage-report-${seq}.json`);
    seq += 1;
    writeFileSync(fakeOmp, script);
    chmodSync(fakeOmp, 0o755);
    return {
      reportPath,
      run: spawnSync(
        process.execPath,
        ["test/eval/triage-eval.mjs", "--only", "readonly-question", "--report-path", reportPath],
        {
          cwd: ROOT,
          encoding: "utf8",
          env: { ...process.env, GSD_EVAL_BACKEND: "omp", GSD_EVAL_OMP: fakeOmp, GSD_EVAL_MODEL: "fake-model" },
        },
      ),
    };
  };

  const { reportPath: passReport, run: pass } = runTriageEval("#!/bin/sh\nprintf '%s' '{\"route\":\"answer\"}'\n");
  assert.equal(pass.status, 0, pass.stderr);
  assert.match(pass.stdout, /triage/);
  assert.match(pass.stdout, /1\/1 checks pass \(fake-model\)/);
  assert.match(
    pass.stdout,
    /Bootstrap: [0-9a-f]{12} \(\d+ rendered words\)/,
    "every runner names the bytes it measured",
  );
  assert.match(pass.stdout, /Report: .*triage-report-0\.json/);

  // The triage axis writes a durable, fingerprint-bound report just like the activation axis.
  const report = JSON.parse(readFileSync(passReport, "utf8"));
  assert.equal(report.scope, "bootstrap only (triage axis)");
  const printedPrefix = pass.stdout.match(/Bootstrap: ([0-9a-f]{12}) \(\d+ rendered words\)/)?.[1];
  assert.ok(printedPrefix, "the runner prints the fingerprint prefix it measured");
  assert.match(report.bootstrap_sha256, new RegExp(`^${printedPrefix}`), "the report binds the printed bytes");
  assert.ok(report.bootstrap_words > 0, "the report records the rendered word count");
  assert.deepEqual(report.pass["fake-model"], { passed: 1, total: 1, accuracy: 100 });
  assert.equal(report.failures["fake-model"], undefined);

  // A wrong route is a scored failure (exit 1), not a backend abort (exit 3).
  const { reportPath: failReport, run: fail } = runTriageEval("#!/bin/sh\nprintf '%s' '{\"route\":\"plan\"}'\n");
  assert.equal(fail.status, 1, fail.stderr);
  assert.match(fail.stdout, /want route answer, got plan/);
  assert.deepEqual(JSON.parse(readFileSync(failReport, "utf8")).failures["fake-model"], ["readonly-question"]);

  // A dead backend aborts with code 3 and scores nothing, exactly like the activation runner.
  const { run: aborted } = runTriageEval("#!/bin/sh\necho '401 Incorrect API key provided: thk_live' >&2\nexit 1\n");
  assert.equal(aborted.status, 3, aborted.stderr);
  assert.match(aborted.stderr, /backend rejected credentials/);
  assert.doesNotMatch(aborted.stdout, /checks pass/);
});

test("the skill compliance evaluator measures the first visible action", () => {
  const runner = read("test/eval/skill-compliance-eval.mjs");
  assert.match(runner, /parseSkillComplianceEvents/);
  for (const flag of ["--mode\", \"json", "--tools\", \"read", "--auto-approve"]) {
    assert.ok(runner.includes(flag), `skill compliance eval must pass ${flag}`);
  }

  const report = JSON.parse(read("test/eval/skill-compliance-report.json"));
  assert.equal(report.scope, "bootstrap only (skill compliance axis)");

  const bootstrap = createBootstrap(ROOT);
  const fingerprint = evalSurfaceFingerprint({ bootstrap, repoRoot: ROOT });
  assert.equal(report.bootstrap_sha256, fingerprint.bootstrap_sha256);
  assert.equal(report.bootstrap_words, fingerprint.bootstrap_words);

  const models = [
    "opencode-go/deepseek-v4.1-flash",
    "google-antigravity/gemini-3.8-flash",
    "opencode-go/glm-5.3-flash",
  ];
  assert.deepEqual(Object.keys(report.pass), models);
  for (const model of models) {
    assert.equal(report.pass[model].total, 28);
    assert.ok(Number.isFinite(report.pass[model].passed));
    assert.ok(report.pass[model].passed >= 25, `${model} must stay above the 25/28 floor`);
    assert.ok(report.pass[model].accuracy >= 0 && report.pass[model].accuracy <= 100);
  }
  const totalPassed = models.reduce((sum, model) => sum + report.pass[model].passed, 0);
  assert.ok(totalPassed >= 80, `the three-model aggregate must reach 80/84, got ${totalPassed}`);
  assert.ok(report.failures && typeof report.failures === "object");

  const readme = read("README.md");
  assert.match(readme, /skill-compliance-eval\.mjs/);
  assert.match(readme, /opencode-go\/deepseek-v4\.1-flash/);
});

test("the skill compliance evaluator scores before a later OMP timeout", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-skill-compliance-timeout-"));
  const fakeOmp = join(dir, "omp");
  const reportPath = join(dir, "report.json");
  const catalog = discoverSkillCatalog(ROOT);
  const verifyPath = catalog.find(({ name }) => name === "gsd-verify").skillPath;
  const event = JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", text: "select the skill" },
        { type: "toolCall", id: "call-1", name: "read", arguments: { path: verifyPath } },
      ],
    },
  });
  writeFileSync(fakeOmp, `#!/bin/sh\nprintf '%s\\n' '${event}'\nsleep 30\nexit 1\n`);
  chmodSync(fakeOmp, 0o755);

  const result = spawnSync(
    process.execPath,
    ["test/eval/skill-compliance-eval.mjs", "--only", "review-diff", "--report-path", reportPath],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        GSD_EVAL_BACKEND: "omp",
        GSD_EVAL_OMP: fakeOmp,
        GSD_EVAL_MODEL: "fake-model",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1\/1 checks pass \(fake-model\)/);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.deepEqual(report.pass["fake-model"], { passed: 1, total: 1, accuracy: 100 });
});

test("the canon-loaded eval mode supplies the on-demand lifecycle matrix", () => {
  const matrix = loadLifecycleMatrix(ROOT);
  assert.match(matrix, /^### Completed-state and cleanup matrix/, "the slice starts at the heading");
  assert.match(matrix, /Malformed residual bytes without a `plan\.md`/, "the slice carries matrix rows");
  assert.match(matrix, /Terminal mtimes never compete with active packets/, "the slice keeps the tail");
  assert.doesNotMatch(matrix, /Post-plan pipeline contract/, "the slice stops at the next section");

  // A canon that lost the heading fails closed instead of silently scoring as loaded.
  const dir = mkdtempSync(join(tmpdir(), "gsd-canon-missing-"));
  mkdirSync(join(dir, "skills", "gsd"), { recursive: true });
  writeFileSync(join(dir, "skills", "gsd", "REFERENCE.md"), "## Something else\n");
  assert.throws(
    () => loadLifecycleMatrix(dir),
    /Completed-state and cleanup matrix/,
    "a missing matrix heading must throw",
  );
});

test("the eval surface fingerprint binds a report to the bytes it measured", () => {
  const base = evalSurfaceFingerprint({ bootstrap: 'GSD_ROOT: "/tmp/one"\nbody', repoRoot: "/tmp/one" });
  assert.match(base.bootstrap_sha256, /^[0-9a-f]{64}$/);
  assert.equal(base.bootstrap_words, 3);
  assert.equal(base.canon_sha256, null);
  assert.equal(base.canon_words, null);

  // Two checkouts of one revision fingerprint identically: the absolute root is normalized.
  assert.deepEqual(
    evalSurfaceFingerprint({ bootstrap: 'GSD_ROOT: "/tmp/two"\nbody', repoRoot: "/tmp/two" }),
    base,
  );

  // Any changed byte moves the hash, which is the point: a stale report is detectable.
  assert.notEqual(
    evalSurfaceFingerprint({ bootstrap: 'GSD_ROOT: "/tmp/one"\nbody!', repoRoot: "/tmp/one" })
      .bootstrap_sha256,
    base.bootstrap_sha256,
  );

  const canon = evalSurfaceFingerprint({
    bootstrap: "body",
    repoRoot: "/tmp/one",
    canonSection: "| row |",
  });
  assert.match(canon.canon_sha256, /^[0-9a-f]{64}$/);
  assert.equal(canon.canon_words, 3);
});

test("the two-pass runner only loads the canon when the scope flag is set", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-eval-canon-"));
  const fakeOmp = join(dir, "omp");
  const dump = join(dir, "prompt.txt");
  writeFileSync(
    fakeOmp,
    `#!/bin/sh\nprintf '%s' "$*" > "$GSD_EVAL_DUMP"\nprintf '%s' '{"decision":"block-resume","action":"stop","primarySkill":null}'\n`,
  );
  chmodSync(fakeOmp, 0o755);
  const runScope = (extraEnv, reportName) =>
    spawnSync(
      process.execPath,
      [
        "test/eval/eval-models.mjs",
        "--only",
        "result-retained-related-resume",
        "--report-path",
        join(dir, reportName),
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          GSD_EVAL_BACKEND: "omp",
          GSD_EVAL_OMP: fakeOmp,
          GSD_EVAL_MODEL: "fake-model",
          GSD_EVAL_DUMP: dump,
          ...extraEnv,
        },
      },
    );

  const bootstrapOnly = runScope({ GSD_EVAL_CANON: "0" }, "report-bootstrap.json");
  assert.equal(bootstrapOnly.status, 0, bootstrapOnly.stderr);
  assert.match(bootstrapOnly.stdout, /Scope: bootstrap only/);
  assert.match(bootstrapOnly.stdout, /Bootstrap: [0-9a-f]{12} \(\d+ rendered words\)/);
  assert.doesNotMatch(bootstrapOnly.stdout, /Canon: /, "bootstrap-only scope reports no canon hash");
  const withoutMatrix = readFileSync(dump, "utf8");
  assert.doesNotMatch(withoutMatrix, /Malformed residual bytes/, "the default scope stays bootstrap-only");

  const canonLoaded = runScope({ GSD_EVAL_CANON: "1" }, "report-canon.json");
  assert.equal(canonLoaded.status, 0, canonLoaded.stderr);
  assert.match(canonLoaded.stdout, /Scope: bootstrap \+ on-demand lifecycle matrix/);
  assert.match(canonLoaded.stdout, /Canon: [0-9a-f]{12} \(\d+ words\)/);
  const withMatrix = readFileSync(dump, "utf8");
  assert.match(withMatrix, /Malformed residual bytes/, "the canon scope must reach the prompt");
  assert.match(withMatrix, /Selection and continuity/, "the bootstrap still travels");

  // The report records which scope produced its numbers and which bytes it measured, so the
  // artifact cannot be misread as a claim about a different tree.
  const report = JSON.parse(readFileSync(join(dir, "report-canon.json"), "utf8"));
  assert.equal(report.scope, "bootstrap + on-demand lifecycle matrix");
  assert.match(report.bootstrap_sha256, /^[0-9a-f]{64}$/);
  assert.ok(Number.isInteger(report.bootstrap_words) && report.bootstrap_words > 0);
  assert.match(report.canon_sha256, /^[0-9a-f]{64}$/);
  assert.ok(Number.isInteger(report.canon_words) && report.canon_words > 0);

  const bootstrapReport = JSON.parse(readFileSync(join(dir, "report-bootstrap.json"), "utf8"));
  assert.equal(bootstrapReport.scope, "bootstrap only");
  assert.equal(bootstrapReport.bootstrap_sha256, report.bootstrap_sha256);
  assert.equal(bootstrapReport.canon_sha256, null, "the bootstrap-only report carries no canon hash");
});

test("the two-pass runner records expected and actual activation misses", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-eval-failure-detail-"));
  const fakeOmp = join(dir, "omp");
  const reportPath = join(dir, "report.json");
  const wrongAnswer = '{"decision":"ordinary-routing","action":"direct","primarySkill":null}';
  writeFileSync(fakeOmp, `#!/bin/sh\nprintf '%s' '${wrongAnswer}'\n`);
  chmodSync(fakeOmp, 0o755);

  const result = spawnSync(
    process.execPath,
    ["test/eval/eval-models.mjs", "--only", "result-retained-related-resume", "--report-path", reportPath],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        GSD_EVAL_BACKEND: "omp",
        GSD_EVAL_OMP: fakeOmp,
        GSD_EVAL_MODEL: "fake-model",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.deepEqual(report.failures["fake-model"], [
    {
      fixture: "result-retained-related-resume",
      expected: { decision: "block-resume", action: "stop", primarySkill: null },
      actual: { decision: "ordinary-routing", action: "direct", primarySkill: null },
      detail: "want block-resume:stop->null, got ordinary-routing:direct->null",
    },
  ]);
});

// The README tells a reader to trust a report only while its fingerprint matches the tree, and
// the eval sections quote the committed reports by number. Nothing enforced that, so a bootstrap
// edit could leave the committed evidence describing a previous revision while every check
// stayed green. This recomputes the live fingerprint exactly as the runners do and holds the
// committed artifacts and the README's quoted numbers to it.
test("the committed eval reports describe the live bytes they claim", () => {
  const bootstrap = createBootstrap(ROOT);
  const live = evalSurfaceFingerprint({ bootstrap, repoRoot: ROOT });
  const canon = evalSurfaceFingerprint({
    bootstrap,
    repoRoot: ROOT,
    canonSection: loadLifecycleMatrix(ROOT),
  });

  const committed = [
    ["test/eval/eval-report.json", "bootstrap only", null],
    ["test/eval/eval-report-canon.json", "bootstrap + on-demand lifecycle matrix", canon],
    ["test/eval/triage-report.json", "bootstrap only (triage axis)", null],
    ["test/eval/brainstorm-compliance-report.json", "bootstrap + brainstorm skill (behavior compliance axis)", null],
  ];
  // The fixture sets are the instrument. Their own contract is already checked above
  // (`validateFixtureSet`/`validateTriageFixtureSet` against these same files); what was
  // missing is that the committed reports name totals for a fixture set nobody re-reads.
  const activationFixtures = JSON.parse(read("test/eval/fixtures.json"));
  const triageFixtures = JSON.parse(read("test/eval/triage-fixtures.json"));
  const brainstormFixtures = JSON.parse(read("test/eval/brainstorm-fixtures.json"));
  const brainstormSkillSha256 = createHash("sha256")
    .update(read("skills/gsd-brainstorming/SKILL.md"))
    .digest("hex");

  // A report also names how many fixtures it scored, and the README says each committed
  // report scores three models. Both are claims about the live instrument, so a fixture
  // added or dropped without re-running has to fail here rather than in a reader's head.
  const liveTotals = new Map([
    ["test/eval/eval-report.json", activationFixtures.length],
    ["test/eval/eval-report-canon.json", activationFixtures.length],
    ["test/eval/triage-report.json", triageFixtures.length],
    ["test/eval/brainstorm-compliance-report.json", brainstormFixtures.length],
  ]);
  let scoredModels = null;
  for (const [path, scope, canonFingerprint] of committed) {
    const report = JSON.parse(read(path));
    assert.equal(report.scope, scope, `${path} must keep its declared scope`);
    assert.equal(
      report.bootstrap_sha256,
      live.bootstrap_sha256,
      `${path} was measured on different bootstrap bytes: re-run its evaluator before quoting it`,
    );
    assert.equal(
      report.bootstrap_words,
      live.bootstrap_words,
      `${path} must record the live rendered word count`,
    );
    if (canonFingerprint) {
      assert.equal(
        report.canon_sha256,
        canonFingerprint.canon_sha256,
        `${path} was measured on a different canon section: re-run its evaluator`,
      );
      assert.equal(report.canon_words, canonFingerprint.canon_words);
    } else {
      assert.equal(report.canon_sha256, null, `${path} must stay a bootstrap-only report`);
    }
    if (path === "test/eval/brainstorm-compliance-report.json") {
      assert.equal(
        report.brainstorm_skill_sha256,
        brainstormSkillSha256,
        `${path} was measured on different brainstorm skill bytes`,
      );
    }
    const scores = report.pass1 ?? report.pass;
    assert.ok(scores && typeof scores === "object", `${path} must record per-model scores`);
    const models = Object.keys(scores).sort();
    assert.equal(
      models.length,
      3,
      `${path} must score the three models the README names`,
    );
    scoredModels = scoredModels ?? models;
    assert.deepEqual(models, scoredModels, `${path} must score the same model set as the others`);
    for (const model of models) {
      assert.equal(
        scores[model].total,
        liveTotals.get(path),
        `${path} must be scored against the live fixture set for ${model}`,
      );
      if (path === "test/eval/eval-report.json" || path === "test/eval/eval-report-canon.json") {
        for (const failure of report.failures?.[model] ?? []) {
          assert.equal(typeof failure.fixture, "string");
          assert.deepEqual(
            Object.keys(failure.expected).sort(),
            ["action", "decision", "primarySkill"],
          );
          assert.ok(failure.actual === null || typeof failure.actual === "object");
          assert.match(failure.detail, /want .+, got .+|parse error: .+/);
        }
      }
    }
  }

  // The README quotes both numbers, so they move with the bytes instead of aging quietly.
  const readme = read("README.md");
  assert.match(
    readme,
    new RegExp(`at fingerprint \`${live.bootstrap_sha256.slice(0, 12)}\``),
    "the README must quote the live fingerprint",
  );
  assert.match(
    readme,
    new RegExp(`currently measures ${live.bootstrap_words} words`),
    "the README must quote the live rendered word count",
  );
});

