import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { read, readdirSync, skillNames, filesUnder, ROOT, SKILLS } from "./support/skills-fixtures.js";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBootstrap, discoverSkillCatalog } from "../lib/gsd-bootstrap.mjs";
import {
  describeEvalBackendError, parseActivationResponse, responseMatchesFixture, selectEvalBackend,
  evalSurfaceFingerprint, loadLifecycleMatrix,
  parseTriageResponse, TRIAGE_ROUTES, validateActivationTarget, validateFixtureSet,
  validateTriageFixtureSet,
} from "./eval/activation-eval-contract.mjs";

test("session owner is sole lifecycle authority without model agents", () => {
  const paths = [
    "README.md",
    "docs/domain/gsd.md",
    ...filesUnder(SKILLS).map((path) => path.slice(ROOT.length + 1)),
  ];
  const corpus = paths.map((path) => [path, read(path)]);
  const reference = read("skills/gsd/REFERENCE.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const designTwice = read("skills/gsd-codebase-architecture/DESIGN-IT-TWICE.md");
  const designSkill = read("skills/gsd-codebase-architecture/SKILL.md");
  const ponytail = read("skills/gsd-ponytail/SKILL.md");

  for (const [path, body] of corpus) {
    assert.doesNotMatch(
      body,
      /gsdReviewer|gsd-reviewer|gsdExecutor|gsd-executor|reviewer_model|executor_model|review_round|blocking_fingerprint|reviewed_commit|progress_status|terminal_repair_round|Adaptive Chunked Cumulative Review|\breducer\b|review shard|shard review|per-shard|shard lifecycle|root integrator|root-integrator|reviewer PASS|\bparent (?:owner|authority)\b/i,
      path,
    );
  }
  assert.match(reference, /schema:v4[\s\S]{0,3100}session owner/i);
  assert.match(handoff, /schema:v4[\s\S]{0,60}session owner/i);
  assert.match(reference, /sole lifecycle authority/i);
  assert.match(verify, /plan hash[\s\S]{0,60}binding/i);
  assert.match(verify, /every active AC[\s\S]{0,120}changed path/i);
  assert.match(verify, /changed path[\s\S]{0,80}task diffs in plan order/i);
  assert.match(verify, /malformed binding[\s\S]{0,40}ownership\/coverage mismatch/i);
  assert.match(verify, /ownership\/coverage mismatch[\s\S]{0,60}contract contradiction/i);
  assert.match(verify, /contract contradiction[\s\S]{0,80}red deterministic check/i);
  assert.match(verify, /Deferred Slow E2E/i);
  assert.doesNotMatch(designTwice, /sub-?agents?|`task`/i);
  assert.match(designTwice, /three self-contained shapes/i);
  assert.match(designSkill, /DESIGN-IT-TWICE\.md/);
  assert.match(ponytail, /^hide: true$/m);
  assert.doesNotMatch(ponytail, /ponytail_level|Invocation modes|explicit_level|auto_scope|lite\/full\/ultra/i);
});

test("AC-9/AC-10: conversation-only recovery is excluded and restricted modes resolve first", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const bootstrap = read("skills/gsd/SKILL.md");
  assert.match(
    reference,
    /excluded from lifecycle recovery[\s\S]{0,40}rewind[\s\S]{0,60}committed WIP and working tree remain/i,
    "recovery excludes conversation-rewind tooling while committed WIP and working tree remain",
  );
  assert.match(
    reference,
    /`state\.toon`[\s\S]{0,200}ahead of the restored conversation/i,
    "the exclusion names state.toon running ahead of the restored conversation",
  );
  assert.match(
    reference,
    /(?:memory|recall)[\s\S]{0,200}never lifecycle authority/i,
    "a memory backend recall is never lifecycle authority",
  );
  assert.match(
    reference,
    /excluding[\s\S]{0,20}edits[\s\S]{0,10}commits[\s\S]{0,10}checks[\s\S]{0,40}cannot own[\s\S]{0,80}leaves/i,
    "a restricted mode excluding edits, commits, and checks cannot own lifecycle work and is left first",
  );
  assert.match(
    bootstrap,
    /(?:leave|exit)[\s\S]{0,160}mode[\s\S]{0,200}before[\s\S]{0,80}lifecycle/i,
    "bootstrap requires leaving a restricted mode before lifecycle work",
  );
  assert.match(
    bootstrap,
    /plan mode[\s\S]{0,240}one question|one question[\s\S]{0,240}plan mode/i,
    "a coexisting harness plan-mode artifact asks exactly one question",
  );
});

test("AC-11: the repository manifest publishes the deterministic contract suite", () => {
  const manifest = JSON.parse(read("package.json"));

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
    "tools/gsd-milestone.mjs",
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

test("T1 session-owner execution contract and lifecycle roles", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const readme = read("README.md");
  const domain = read("docs/domain/gsd.md");

  for (const body of [planner, execution, verify, handoff, reference, readme, domain]) {
    assert.doesNotMatch(
      body,
      /gsdReviewer|gsd-reviewer|gsdExecutor|gsd-executor|reviewer_model|executor_model|review_round|blocking_fingerprint|reviewed_commit|progress_status/i,
    );
  }
  assert.match(execution, /current top-level session owner[\s\S]{0,60}consumes the validated slice/i);
  assert.match(execution, /implements or repairs[\s\S]{0,40}task inline/i);
  assert.match(execution, /next task[\s\S]{0,40}strict heading order/i);
  assert.match(execution, /dispatches no[\s\S]{0,120}generic child task/);
  // Authorship moved to sub-agents, so the pin has to say who authors and who stays
  // responsible: a dispatched task still returns to the owner for inline sequential repair.
  assert.match(reference, /authored by sub-agents[\s\S]{0,300}repair[\s\S]{0,120}inline[\s\S]{0,80}sequential/i);
  assert.match(execution, /single independent task[\s\S]{0,160}dispatch[\s\S]{0,140}clear(?:ly)? beneficial/i);
  assert.match(execution, /inline[\s\S]{0,120}fallback[\s\S]{0,100}dispatch is unavailable or not clearly beneficial/i);
  assert.match(execution, /Task `Tn\+1` begins only from[\s\S]{0,60}committed green checkpoint of `Tn`/i);
  assert.match(execution, /Source mutations never overlap[\s\S]{0,60}task\/repair[\s\S]{0,60}Deferred Slow E2E/i);
  assert.match(verify, /No free-form critique[\s\S]{0,60}model-generated verdict[\s\S]{0,60}terminal authority/i);
  assert.match(domain, /### P-gsd-3: Make the session owner the sole lifecycle authority/);
  assert.match(domain, /### P-gsd-4: Converge only through deterministic blockers/);
  assert.match(domain, /### P-gsd-5: Rehydrate authority from canonical sources/);
  assert.match(readme, /## Session-owner authority/);
  assert.equal(existsSync(join(ROOT, "agents", "gsd-executor.md")), false);
  assert.equal(existsSync(join(ROOT, "agents", "gsd-reviewer.md")), false);
  assert.match(execution, /full parse and binding check[\s\S]{0,60}execution entry or resume/i);
  assert.match(execution, /ordinary task selection[\s\S]{0,60}consume the retained validated task slice/i);
  assert.match(execution, /RED before implementation[\s\S]{0,60}GREEN after implementation[\s\S]{0,60}refactor after green/i);
  assert.match(execution, /rerun only checks[\s\S]{0,60}invalidated by the repair/i);
  assert.match(execution, /Reject legacy proposal\/spec\/design files/);
  assert.match(execution, /[Aa]n amended plan/);
});

test("T2 schema:v4 state.toon contract and skill derivation", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const master = read("skills/gsd/SKILL.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");

  assert.match(reference, /## Runtime state contract/);
  const currentStateBlock = reference.match(/```toon\nschema:v4\n[\s\S]*?\n```/);
  assert.ok(currentStateBlock, "REFERENCE must contain canonical schema:v4");
  assert.doesNotMatch(currentStateBlock[0], /model|agent|review|ponytail/);
  assert.match(currentStateBlock[0], /phase:draft\|approved\|executing\|paused\|verifying\|repair\|merged-cleanup-pending\|completed-retained/);
  assert.match(currentStateBlock[0], /checkpoint_revision/);
  assert.match(currentStateBlock[0], /cleanup_preference:none\|delete\|retain\|archive-and-delete/);
  assert.match(reference, /active[\s\S]{0,80}schema:v1[\s\S]{0,60}schema:v2[\s\S]{0,60}schema:v3[\s\S]{0,240}migrate[\s\S]{0,120}full validation/i);
  assert.match(reference, /schema:v3[\s\S]{0,80}completed-retained[\s\S]{0,160}sole terminal[\s\S]{0,120}compatibility[\s\S]{0,240}candidate discovery[\s\S]{0,200}readStateFile[\s\S]{0,200}schema:v4/i);
  assert.match(reference, /validate[\s\S]{0,60}phase[\s\S]{0,120}fixed schema enum/i);
  assert.match(handoff, /Reject an unknown `phase`[\s\S]{0,60}preserve an opaque `next_action`/i);
  assert.doesNotMatch(reference, /opaque state `phase`|opaque `phase`/);
  assert.doesNotMatch(handoff, /unknown opaque `phase`|opaque `phase`/);
  assert.match(reference, /Atomic write/);
  assert.match(reference, /atomically[\s\S]{0,80}rename[s]?[\s\S]{0,80}`?state\.toon`?/i);
  assert.match(reference, /no dispatch[\s\S]{0,160}unvalidated[\s\S]{0,80}partially written/i);
  assert.match(reference, /Skill derivation from phase and next_action/);
  assert.match(reference, /`start\/continue task`[\s\S]{0,200}gsd-executing-plans[\s\S]{0,80}gsd-handoff[\s\S]{0,80}gsd-tdd/);
  assert.match(reference, /`enter terminal verification\/repair`[\s\S]{0,160}gsd-verify[\s\S]{0,80}gsd-handoff/);
  assert.doesNotMatch(reference, /reload\[N\]\{skill,path\}/);
  assert.doesNotMatch(handoff, /reload\[N\]\{skill,path\}/);
  assert.match(handoff, /writes atomically[\s\S]{0,60}`\.scratch\/<feature>\/state\.toon`/i);
  assert.match(handoff, /Active skills are derived from[\s\S]{0,40}`phase`[\s\S]{0,40}`next_action`/i);
  assert.match(handoff, /Never serialize a `reload` manifest/);
  assert.match(handoff, /Exact active v1, v2, and v3 records[\s\S]{0,60}migrate atomically/i);
  assert.match(handoff, /v1\/v2 terminal records[\s\S]{0,60}fail closed unchanged/i);
  assert.match(planner, /atomically write canonical `schema:v4`[\s\S]{0,40}`state\.toon`/);
  for (const skill of [planner, execution, handoff, verify]) {
    assert.doesNotMatch(skill, /state-input\.json/, "skills never teach the temp-JSON ceremony");
    assert.match(skill, /set --feature-dir/, "skills teach the set-based write path");
  }
  assert.match(
    verify,
    /preflight[^\n]{0,200}unpiped or under `set -o pipefail`[^\n]{0,200}exit=0/,
    "verify teaches unmasked gate consumption",
  );
  assert.match(
    execution,
    /before the first task commit[^\n]{0,200}wip_branch[^\n]{0,200}plan_sha256/,
    "execution proves binding before the first commit",
  );
  assert.match(read("skills/gsd/REFERENCE.md"), /State updates are recorded through `gsd-state\.mjs set key=value…`/);
  assert.match(read("skills/gsd/REFERENCE.md"), /`write-state --json-file` remains the fallback/);
  assert.match(execution, /validated task slice/);
  assert.match(execution, /Do not write task-attempt TOON files/);
  assert.match(verify, /phase=merged-cleanup-pending|merged-cleanup-pending/);
  assert.match(master, /state\.toon/);
  assert.doesNotMatch(master, /result\.toon/);
});

test("activation fixtures and response parser enforce lazy primary-skill selection", () => {
  const fixtureText = read("test/eval/fixtures.json");
  const fixtures = JSON.parse(fixtureText);
  const installed = new Set(skillNames().filter((name) => name !== "gsd"));
  assert.deepEqual(validateFixtureSet(fixtures, installed), { ok: true });
  const documentedFixtureCount = read("README.md").match(/(\d+) workspace-state \+ prompt fixtures/);
  assert.ok(documentedFixtureCount);
  assert.equal(fixtures.length, Number(documentedFixtureCount[1]));
  assert.match(fixtureText, /bound plan\.md exist|state\.toon/);
  assert.doesNotMatch(fixtureText, /proposal\.toon|spec\.toon|design\.toon|plan\.toon/);
  assert.doesNotMatch(fixtureText, /"route"|"skill"/);
  assert.doesNotMatch(fixtureText, /handoff-\d+\.toon|result\.toon/);

  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  for (const id of ["nano-typo", "readonly-question", "mention-not-ask", "catalog"]) {
    assert.deepEqual(
      {
        action: byId.get(id).expectedAction,
        primarySkill: byId.get(id).expectedPrimarySkill,
      },
      { action: "direct", primarySkill: null },
      id,
    );
  }
  assert.deepEqual(
    {
      action: byId.get("new-feature").expectedAction,
      primarySkill: byId.get("new-feature").expectedPrimarySkill,
    },
    { action: "load", primarySkill: "gsd-brainstorming" },
  );
  assert.deepEqual(
    {
      decision: byId.get("result-retained-newer-than-active").decision,
      action: byId.get("result-retained-newer-than-active").expectedAction,
      primarySkill: byId.get("result-retained-newer-than-active").expectedPrimarySkill,
    },
    { decision: "ignore-terminal-record", action: "load", primarySkill: "gsd-handoff" },
  );

  assert.deepEqual(
    validateActivationTarget(
      { decision: "block-resume", action: "stop", primarySkill: null },
      installed,
    ),
    { ok: true },
  );
  assert.match(
    validateActivationTarget(
      { decision: "block-resume", action: "direct", primarySkill: null },
      installed,
    ).detail,
    /requires stop/,
  );
  assert.deepEqual(
    parseActivationResponse(
      '{"decision":"ordinary-routing","action":"direct","primarySkill":null}',
      installed,
    ),
    {
      ok: true,
      value: { decision: "ordinary-routing", action: "direct", primarySkill: null },
    },
  );
  assert.deepEqual(
    parseActivationResponse(
      '{"decision":"ordinary-routing","action":"load","primarySkill":"gsd-verify"}',
      installed,
    ),
    {
      ok: true,
      value: { decision: "ordinary-routing", action: "load", primarySkill: "gsd-verify" },
    },
  );
  assert.match(
    parseActivationResponse(
      '{"decision":"ordinary-routing","action":"direct","primarySkill":null,"action":"load"}',
      installed,
    ).detail,
    /duplicate keys/,
  );
  assert.equal(
    responseMatchesFixture(
      { decision: "ordinary-routing", action: "direct", primarySkill: null },
      byId.get("readonly-question"),
    ),
    true,
  );
  assert.equal(
    responseMatchesFixture(
      { decision: "ordinary-routing", action: "load", primarySkill: "gsd-handoff" },
      byId.get("readonly-question"),
    ),
    false,
  );

  const master = read("skills/gsd/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const evalRunner = read("test/eval/activation-eval.mjs");
  for (const decision of [
    "ordinary-routing",
    "ignore-terminal-record",
    "cleanup-question",
    "cleanup-only",
    "block-resume",
    "fail-closed",
  ]) {
    assert.ok(reference.includes(`\`${decision}\``));
  }
  assert.match(reference, /generic `continue`/);
  assert.match(reference, /completed-retained|merged-cleanup-pending/);

  // Leftover terminal or malformed state gates related and lifecycle intent only. The matrix
  // itself moved to the on-demand canon in the lightness revamp, so the bootstrap now carries
  // a pointer plus the decision names; both halves are asserted so neither drifts apart.
  assert.match(master, /`REFERENCE\.md` § Completed-state and cleanup matrix/);
  for (const decision of [
    "fail-closed",
    "ordinary-routing",
    "cleanup-question",
    "cleanup-only",
    "block-resume",
    "ignore-terminal-record",
  ]) {
    assert.ok(master.includes(`\`${decision}\``), `bootstrap must name the ${decision} decision`);
  }
  assert.match(reference, /(?:unrelated direct work[\s\S]{0,100}never blocked|never blocks[\s\S]{0,100}unrelated direct work)/i);
  assert.match(reference, /one question[\s\S]{0,80}instead of stopping/i);
  assert.match(reference, /Malformed residual bytes without a `plan\.md` \| `ordinary-routing`/);
  assert.doesNotMatch(reference, /Any state is malformed \| `fail-closed`/);
  assert.doesNotMatch(reference, /globally gates recovery|global crash-recovery gate/);
  // Malformed bytes cannot be parsed, so only the directory name may decide relatedness.
  assert.match(reference, /`?\.scratch\/<feature>\/`?[\s\S]{0,100}directory name[\s\S]{0,120}(?:trusted )?relatedness(?: signal)?/i);
  assert.deepEqual(
    {
      decision: byId.get("result-pending-unrelated").decision,
      action: byId.get("result-pending-unrelated").expectedAction,
      primarySkill: byId.get("result-pending-unrelated").expectedPrimarySkill,
    },
    { decision: "ordinary-routing", action: "direct", primarySkill: null },
  );
  assert.deepEqual(
    {
      decision: byId.get("result-malformed-unrelated").decision,
      action: byId.get("result-malformed-unrelated").expectedAction,
    },
    { decision: "ordinary-routing", action: "load" },
  );
  assert.equal(byId.get("result-malformed-with-active").decision, "fail-closed");
  assert.match(evalRunner, /createBootstrap\(repoRoot\)/);
  assert.match(evalRunner, /discoverSkillCatalog\(repoRoot\)/);
  // The runner pins the stable text transport; it never parses omp's JSON event stream.
  assert.doesNotMatch(evalRunner, /REFERENCE\.md|route|trace/);
  assert.match(evalRunner, /--mode", "text|--mode text/);
  assert.doesNotMatch(evalRunner, /--mode", "json|message_end|assistantMessageEvent/);
  assert.match(master, /Completed-state decision matrix|completed-state decision matrix/i);
});

test("the bootstrap names the resume gateway, fail-closed precedence, and helper limits", () => {
  // The live activation eval measured these five rules wrong on both evaluated models,
  // so the injected routing authority must state each one instead of implying it.
  const master = read("skills/gsd/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const domain = read("docs/domain/gsd.md");

  // Validated active state enters through gsd-handoff; next_action picks the peer owner.
  assert.match(master, /`gsd-handoff`[^.\n]{0,160}(?:first|gateway)|(?:first|gateway)[^.\n]{0,160}`gsd-handoff`/);
  assert.match(master, /`next_action`/);
  assert.match(master, /bare (?:resume|continue)[\s\S]{0,120}`gsd-handoff`/i);
  assert.match(master, /[Nn]amed (?:work|execution)[^.\n]{0,140}`gsd-executing-plans`/);

  // Runtime discovery decides malformed authority: a feature holding both `plan.md` and
  // malformed `state.toon` throws for every prompt, while plan-less bytes are skipped. The
  // matrix moved to the on-demand canon, so this now asserts canon bytes, not the pointer.
  assert.match(reference, /malformed[\s\S]{0,240}`fail-closed`|`fail-closed`[\s\S]{0,240}malformed/);
  assert.match(reference, /(?:full|complete) packet|without a `plan\.md`|residual/i);

  // A moved plan hash is an amendment, never a lifecycle stop.
  assert.match(reference, /hash mismatch[^.\n]{0,120}amend|amend[^.\n]{0,120}hash mismatch/i);

  // A first-pending ledger row resumes; it never authorizes replacement brainstorming.
  assert.match(master, /first pending[^.\n]{0,160}resum|ledger[^.\n]{0,160}resum/i);

  // gsd-tdd is a helper: it is never the primary owner for direct work.
  assert.match(domain, /`gsd-tdd`[^.\n]{0,160}never[^.\n]{0,40}(?:primary|owner)/);

  // `continue` alone is the only bare resume: it enters gsd-handoff even beside exactly
  // one executing packet, while `continue` plus a named feature/task/repair routes
  // straight to that owner. The executing-plans catalog row admits only prompt-named
  // pending work, so `next_action` never competes with the gateway during selection.
  assert.match(domain, /`continue` alone[^.\n]{0,80}bare resume/);
  assert.match(domain, /even beside one executing packet/);
  assert.match(domain, /`continue` plus a named feature, task, or repair is not bare/);
  assert.match(domain, /active or `merged-cleanup-pending` packet is never terminal history[^.\n]{0,200}unrelated[^.\n]{0,100}`ordinary-routing`/);
  // A returned Quick-fix WIP Fail leaves a nameable repair round that loads gsd-verify.
  assert.match(domain, /repair round[^.\n]*`gsd-verify`[^.\n]*answered directly/i);
  // These matrix rows live in canon after the lightness revamp; the bootstrap now only names
  // the decisions, so the row semantics are asserted on the canon bytes.
  // `ignore-terminal-record` is gated on a discovered terminal record: with none present,
  // unrelated work beside an active or merged-cleanup-pending packet stays ordinary.
  assert.match(reference, /`?ignore-terminal-record`?[\s\S]{0,160}(?:`?phase=completed-retained`?|completed-retained)[\s\S]{0,120}residual terminal bytes[\s\S]{0,160}(?:no such record|none present)[\s\S]{0,160}`?ordinary-routing`?/i);
  // An active packet is never terminal history, so unrelated new work beside one is ordinary.
  assert.match(reference, /(?:active or )?`?merged-cleanup-pending`?[\s\S]{0,120}never terminal history[\s\S]{0,160}unrelated[\s\S]{0,120}`?ordinary-routing`?/i);
  // An unrelated valid merged-cleanup-pending state routes ordinarily: ignore-terminal-record
  // names completed-retained and residual records only, so the two rows never collapse.
  assert.match(reference, /`?phase=merged-cleanup-pending`?[\s\S]{0,180}unrelated[\s\S]{0,200}never (?:report )?`?ignore-terminal-record`?[\s\S]{0,160}completed-retained[\s\S]{0,100}residual/i);
  const executing = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(executing, /^description: "[^"]*pending work that the prompt names\."$/m);
  assert.doesNotMatch(executing.match(/^description: .*$/m)[0], /next_action/);

  // A located failure is bounded work; an unknown cause must be diagnosed first.
  assert.match(domain, /(?:named|naming) the file\/line or exact failure signature is located/);
  assert.match(domain, /trigger plus an observed failure is sufficient scope to investigate/);
  assert.match(domain, /confirmed non-architectural cause enters the Quick-fix lane/);

  // Hash drift keeps prompt-named work with its executing owner instead of diverting to
  // the resume gateway, and a full malformed packet outranks every other active packet.
  assert.match(domain, /Hash drift never diverts prompt-named work to `gsd-handoff`/);
  assert.match(reference, /even one naming another valid feature/);

  // Several valid packets are an ambiguity to resolve through gsd-handoff, not a stop.
  // detectCandidates returns every valid packet and the capsule asks for exactly one
  // validated resume, so generic `continue` selects that owner instead of failing closed.
  assert.match(domain, /(?:several|multiple|more than one)[^.\n]{0,120}valid[^.\n]{0,200}`gsd-handoff`/i);
  assert.match(domain, /exactly one[^.\n]{0,80}resume/i);

  // The visible catalog description decides selection, so ledger recovery must appear.
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const handoffDescription = handoff.match(/^description: "(.*)"$/m);
  assert.ok(handoffDescription);
  assert.match(handoffDescription[1], /ledger|milestone/i);

  assert.match(domain, /Several valid active packets[\s\S]{0,240}`gsd-handoff`/);
  assert.match(domain, /full malformed packet[\s\S]{0,200}fails closed/i);
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

test("the triage front door has a fixture harness that covers every canon route", () => {
  const triageFixtures = JSON.parse(read("test/eval/triage-fixtures.json"));
  assert.deepEqual(validateTriageFixtureSet(triageFixtures), { ok: true });

  // The fixtures exercise the whole route enum, and the injected bootstrap names each route,
  // so the harness and the canon cannot drift apart.
  const master = read("skills/gsd/SKILL.md");
  for (const route of TRIAGE_ROUTES) {
    assert.ok(
      triageFixtures.some((fixture) => fixture.route === route),
      `triage fixtures must cover ${route}`,
    );
    assert.ok(master.includes(`\`${route}\``), `the bootstrap triage must name ${route}`);
  }

  // The reply contract is exact JSON with one route key drawn from the enum.
  assert.deepEqual(parseTriageResponse('{"route":"clarify"}'), { ok: true, value: { route: "clarify" } });
  assert.equal(parseTriageResponse('{"route":"clarify","extra":1}').ok, false);
  assert.equal(parseTriageResponse('{"route":"nope"}').ok, false);
  assert.equal(parseTriageResponse('{"route":"answer"} ').ok, false);

  // A fixture set that drops a route is rejected, so coverage cannot silently shrink.
  const shrunk = triageFixtures.filter((fixture) => fixture.route !== "milestone");
  assert.equal(validateTriageFixtureSet(shrunk).ok, false);
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

test("the capsule-resume miss stays bounded by the executing-plans entry guard", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");

  // The stable eval miss is a front-door classification miss on an ambiguous phrase: the model
  // reads "continue implementation" as named work and picks gsd-executing-plans for a capsule
  // resume. Supplying the whole canon instead of the matrix slice did not change it, so the miss
  // cannot be fixed by more context. What keeps it bounded is the owner skill's own entry guard:
  // a resume without bound `state.toon` must stop there rather than execute.
  assert.match(execution, /Invocation guard[\s\S]{0,160}load only for validated bound plan state/i);
  assert.match(
    execution,
    /Normal plan execution \| `plan\.md`; bound `state\.toon`[\s\S]{0,220}Stop only when `plan\.md` or `state\.toon` is missing\/malformed/,
    "normal plan execution requires bound state.toon and stops without it",
  );
  assert.match(handoff, /capsule/i, "gsd-handoff owns capsule resume");
  assert.match(
    reference,
    /`gsd-handoff`[\s\S]{0,240}capsule[\s\S]{0,140}every bare resume naming no work enters here first/i,
    "the canon owner row gives gsd-handoff every bare resume naming no work",
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

test("Quick-fix owner uses the injected hidden context and deterministic gates", () => {
  const master = read("skills/gsd/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");

  assert.match(master, /PONYTAIL_CONTEXT_PATH/);
  assert.match(master, /bounded (?:fix|Quick-fix)[\s\S]{0,220}PONYTAIL_CONTEXT_PATH/i);
  assert.match(master, /A concrete failure symptom with an unknown cause routes through `gsd-diagnosing-bugs`/i);
  assert.match(master, /PONYTAIL_CONTEXT_PATH[\s\S]{0,300}validate-quick-fix[\s\S]{0,240}gsd-verify/i);
  assert.match(reference, /\| `gsd-verify` \| owner \|[^|\n]*Quick-fix[^|\n]*\|[^|\n]*Quick-fix `plan\.md`[^|\n]*\|/i);
  assert.match(reference, /Quick-fix[\s\S]{0,300}session owner[\s\S]{0,500}RED→GREEN→refactor[\s\S]{0,300}gsd-verify/i);
  assert.match(reference, /Every observable task loads `gsd-tdd`/i);
  assert.match(master, /Gates: grammar fit/i);
  assert.match(master, /grammar fit \(one\/two tasks\)/i);
  assert.match(master, /Domain Impact none\/single shard/i);
  assert.match(master, /converged acceptance/i);
  assert.match(master, /prior diagnosis is not required/i);
  assert.match(master, /prove[^.\n]{0,80}validate-quick-fix/i);
  assert.match(reference, /(?:validate-quick-fix[^.\n]{0,80}draft plan|draft plan[^.\n]{0,80}validate-quick-fix)/i);
  assert.match(reference, /Ponytail stays hidden and never enters the matrix or runtime state/i);
  assert.match(reference, /same-shape independent tasks[\s\S]{0,120}one wave/i);
  assert.match(reference, /single independent task[\s\S]{0,180}dispatch[\s\S]{0,140}clear(?:ly)? beneficial/i);
});

test("debug prompts route through diagnosis before a bounded Quick-fix", () => {
  const master = read("skills/gsd/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const diagnosis = read("skills/gsd-diagnosing-bugs/SKILL.md");
  const triageFixtures = JSON.parse(read("test/eval/triage-fixtures.json"));
  const fixture = (id) => triageFixtures.find((row) => row.id === id);

  assert.equal(fixture("vague-debug-fix")?.route, "clarify");
  assert.equal(fixture("symptom-debug-fix")?.route, "research");
  assert.equal(fixture("named-error-debug-fix")?.route, "quick");
  assert.equal(fixture("multiple-debug-fixes")?.route, "clarify");

  assert.match(
    master,
    /A concrete failure symptom with an unknown cause routes through `gsd-diagnosing-bugs`/i,
  );
  assert.doesNotMatch(master, /A diagnosed fix is direct, never a `primarySkill`/i);
  assert.match(
    diagnosis,
    /confirmed non-architectural cause[\s\S]{0,120}bounded Quick-fix/i,
  );
  assert.match(
    reference,
    /A trigger plus an observed failure is sufficient scope to investigate[\s\S]{0,180}confirmed non-architectural cause[\s\S]{0,140}bounded Quick-fix/i,
  );
});

test("AC-4: hidden bootstrap uses state.toon and terminal conformance", () => {
  const master = read("skills/gsd/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.match(master, /Deferred Slow E2E/i);
  assert.match(master, /state\.toon/);
  assert.match(master, /deterministic terminal conformance/i);
  assert.match(reference, /merged-cleanup-pending|completed-retained/);
  assert.doesNotMatch(master, /result\.toon|gsdReviewer|gsd-reviewer/);
});

test("terminal-conformance AC-1: enter verification only after all tasks", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(execution, /atomically update `state\.toon`[\s\S]{0,60}`last_green_task`[\s\S]{0,60}`last_green_commit`[\s\S]{0,60}`next_action=start\/continue task`/i);
  assert.match(execution, /Only after every non-superseded task[\s\S]{0,60}Fast TDD Check is green/i);
  assert.match(execution, /next_action=enter terminal verification\/repair/);
  assert.match(execution, /load `gsd-verify`/);
  assert.doesNotMatch(execution, /After every non-superseded task[\s\S]{0,100}load `gsd-verify`/);
});

test("terminal-conformance AC-2: deterministic cumulative coverage and quality", () => {
  const verify = read("skills/gsd-verify/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.match(verify, /every active AC maps exactly once[\s\S]{0,60}one completed task[\s\S]{0,60}one public interface pin/i);
  assert.match(verify, /every changed path is task-owned/);
  assert.match(verify, /task diffs in plan order/);
  assert.match(verify, /explicit Decisions, invariants, non-goals/);
  assert.match(verify, /focused-check evidence[\s\S]{0,60}unchanged current commit/i);
  assert.match(reference, /malformed binding[\s\S]{0,120}ownership\/coverage mismatch[\s\S]{0,120}contract contradiction[\s\S]{0,120}unresolved change[\s\S]{0,120}red deterministic check[\s\S]{0,100}blocks?/i);
});

test("terminal-conformance AC-5: same-commit invalidation and merge gates", () => {
  const verify = read("skills/gsd-verify/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.match(verify, /source change invalidates[\s\S]{0,40}prior conformance/i);
  assert.match(verify, /full slow\/E2E GREEN[\s\S]{0,60}same unchanged commit/i);
  assert.match(reference, /source change[s]?[\s\S]{0,80}invalidate[s]?[\s\S]{0,80}conformance/i);
  assert.match(reference, /green[\s\S]{0,60}unchanged[\s\S]{0,80}(?:one-squash|squash)[\s\S]{0,80}merge[\s\S]{0,60}cleanup/i);
});

test("terminal-conformance AC-4: verify gate proves owned durable records", () => {
  const verify = read("skills/gsd-verify/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.match(verify, /gsd-record\.mjs/);
  assert.match(verify, /--kind decisions\|design/);
  assert.match(verify, /docs\/decisions\/NNNN-slug\.md/);
  assert.match(verify, /docs\/design\/NNNN-slug\.md/);
  assert.match(reference, /Durable decision and design records/);
});

test("planner skill wires init-plan scaffold and reference contract", () => {
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");

  assert.match(
    planner,
    /REFERENCE\.md[^.\n]*§ Packet grammar[\s\S]{0,160}init-plan[\s\S]{0,160}refuses/i,
    "planner SKILL.md names init-plan scaffold near canon § Packet grammar citation and notes refuse-overwrite",
  );
  assert.match(
    reference,
    /init-plan --path[^\n]+--base/,
    "reference executable contract validator lists init-plan invocation with path and base flags",
  );
});

test("AC-2 and AC-3: layered wave reconciliation gate and post-merge integration evidence", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");

  const refWave = reference.match(/### Wave dispatch\n([\s\S]*?)(?=\n### |\n## |$)/)?.[1];
  assert.ok(refWave, "REFERENCE.md must have a ### Wave dispatch section");

  const execWave = execution.match(/## Wave dispatch\n([\s\S]*?)(?=\n## |$)/)?.[1];
  assert.ok(execWave, "SKILL.md must have a ## Wave dispatch section");

  for (const [name, text] of [["REFERENCE.md", refWave], ["SKILL.md", execWave]]) {
    // 1. Report inadmissibility
    assert.match(
      text,
      /inadmissible/i,
      `${name} must state sub-agent reports are inadmissible as evidence`,
    );

    // 2. Mechanical proof: verify-task-branch
    assert.match(
      text,
      /verify-task-branch/,
      `${name} must require verify-task-branch mechanical proof`,
    );

    // 3. RED re-proof on wave base
    assert.match(
      text,
      /RED re-proof[\s\S]{0,120}fail[s]? on (?:the )?wave base/i,
      `${name} must require RED re-proof on wave base`,
    );

    // 4. Weakened-guard scan
    assert.match(
      text,
      /weakened-guard scan[\s\S]{0,200}(?:delete|skip|rename)[\s\S]{0,80}existing test/i,
      `${name} must require weakened-guard scan rejecting deleted/skipped/renamed tests or loosened config`,
    );

    // 5. Integration proof: post-merge focused check before checkpoint
    assert.match(
      text,
      /re-runs? every merged wave task's focused check[\s\S]{0,160}(?:before|prior to)[\s\S]{0,80}gsd-state\.mjs set/i,
      `${name} must require re-running every merged wave task's focused check on wip branch before checkpoint`,
    );
    assert.match(
      text,
      /pre-merge (?:branch )?checks? (?:are|is) never sufficient/i,
      `${name} must state that pre-merge checks are never sufficient for a checkpoint`,
    );

    // Failure routing: never re-dispatch integrity failure
    assert.match(
      text,
      /integrity failure[\s\S]{0,140}never re-dispatch/i,
      `${name} must state integrity failures return to inline repair and are never re-dispatched`,
    );

    // Order check: layer 1 -> layer 2 -> layer 3 -> layer 4 -> layer 5 -> failure routing
    assert.match(
      text,
      /inadmissible[\s\S]+verify-task-branch[\s\S]+fail[s]? on (?:the )?wave base[\s\S]+weakened-guard scan[\s\S]+re-runs? every merged wave task's focused check[\s\S]+never re-dispatch/i,
      `${name} must present the five layers and failure routing in strict order`,
    );
  }

  // Pre-merge checkpoint wording is deleted in executing-plans
  assert.doesNotMatch(
    execWave,
    /commit one green checkpoint, then write `state\.toon`/i,
    "SKILL.md must drop pre-merge-only checkpoint wording",
  );
});

test("AC-3: efficient dispatch separates task review from final review", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const domain = read("docs/domain/gsd.md");

  const refWave = reference.match(/### Wave dispatch\n([\s\S]*?)(?=\n### |\n## |$)/)?.[1];
  const execWave = execution.match(/## Wave dispatch\n([\s\S]*?)(?=\n## |$)/)?.[1];
  assert.ok(refWave, "REFERENCE.md must have a ### Wave dispatch section");
  assert.ok(execWave, "SKILL.md must have a ## Wave dispatch section");

  for (const [name, text] of [["REFERENCE.md", refWave], ["SKILL.md", execWave]]) {
    assert.match(
      text,
      /same-shape independent tasks[\s\S]{0,120}one wave/i,
      `${name} must batch same-shape independent tasks efficiently`,
    );
    assert.match(
      text,
      /single independent task[\s\S]{0,180}dispatch[\s\S]{0,140}clear(?:ly)? beneficial/i,
      `${name} must permit beneficial single-task dispatch`,
    );
    assert.match(
      text,
      /inline[\s\S]{0,120}(?:fallback|default)[\s\S]{0,100}(?:dispatch is unavailable|not clearly beneficial)/i,
      `${name} must keep inline execution as the fallback`,
    );
    assert.match(
      text,
      /after task or batch reconciliation[\s\S]{0,180}independent read-only review/i,
      `${name} must run task/batch review after reconciliation`,
    );
    assert.match(
      text,
      /repair, diagnosis, architecture, or verification[\s\S]{0,120}(?:never|not) dispatch/i,
      `${name} must keep lifecycle repair and verification inline`,
    );
  }

  assert.match(
    verify,
    /does not repeat task or batch review[\s\S]{0,160}final whole-diff review/i,
    "terminal verification must be a separate whole-diff review",
  );
  assert.match(
    verify,
    /deterministic gates remain the only terminal authority[\s\S]{0,160}citing bound plan text[\s\S]{0,120}red deterministic check/i,
    "final review must stay deterministic and advisory findings must be sourced",
  );
  assert.match(
    domain,
    /batch(?:es|ing)? same-shape independent tasks[\s\S]{0,120}one wave/i,
    "domain policy must describe efficient batching",
  );
  assert.match(
    domain,
    /single independent task[\s\S]{0,180}dispatch[\s\S]{0,140}clear(?:ly)? beneficial/i,
    "domain policy must describe beneficial single-task dispatch",
  );
  assert.match(
    domain,
    /task or batch review[\s\S]{0,140}final whole-diff review/i,
    "domain policy must separate task/batch and final review",
  );
});


// --- session-owner terminal conformance ---
test("AC-4: bootstrap routing has no backend escape hatch, proper quick-fix order, and clean ledger deletion", () => {
  const master = read("skills/gsd/SKILL.md");

  // Rule 4 carries no backend escape hatch
  assert.doesNotMatch(master, /backend-only work stays direct/i, "bootstrap must not route backend work directly");

  // Rule 6 orders Quick-fix plan writing before validate-quick-fix proof
  assert.match(
    master,
    /writes its plan[\s\S]{0,100}proves fit[\s\S]{0,80}validate-quick-fix/i,
    "bootstrap must order Quick-fix plan writing before validate-quick-fix proof",
  );

  // Rule 8 names owner reconciliation where it names wave authorship
  assert.match(
    master,
    /The owner reconciles every result/i,
    "bootstrap must name owner reconciliation where it names wave authorship",
  );

  // Canonical authority states final-milestone ledger deletion instead of all-done survival case
  assert.match(
    master,
    /all-`done`, fail closed/i,
    "bootstrap must keep all-done fail closed rule",
  );
  assert.doesNotMatch(
    master,
    /unless canonical completion conditions hold/i,
    "bootstrap must drop the all-done ledger survival claim",
  );
  assert.match(
    master,
    /final milestone deletes the (?:milestone )?ledger/i,
    "bootstrap must state final milestone deletes the ledger",
  );
});

test("AC-5: planner binds state without detour and names reachable escalation route", () => {
  const planner = read("skills/gsd-to-plan/SKILL.md");

  // Writes state through gsd-state.mjs set and loads gsd-executing-plans with no gsd-handoff step
  assert.match(
    planner,
    /gsd-state\.mjs[" ]+set[\s\S]{0,400}load `gsd-executing-plans`/i,
    "planner must write state through gsd-state.mjs set and load gsd-executing-plans directly",
  );
  assert.doesNotMatch(
    planner,
    /load `gsd-handoff` in `Execution state write` mode/i,
    "planner must not detour through gsd-handoff for state binding",
  );

  // Rejection paths name Spec escalation through gsd-handoff, never bare Discussion destination
  assert.doesNotMatch(
    planner,
    /(?:return|returns)(?: [^.\n]+)? to Discussion/i,
    "planner rejection paths must not use Discussion as destination",
  );
  assert.match(
    planner,
    /Spec escalation through `gsd-handoff`/i,
    "planner rejection paths must name Spec escalation through gsd-handoff",
  );
});

test("AC-6: diagnosis returns evidence only and routes architectural causes before repair", () => {
  const diagnosing = read("skills/gsd-diagnosing-bugs/SKILL.md");
  const architecture = read("skills/gsd-codebase-architecture/SKILL.md");

  // Diagnosis contains no phase that implements or commits a fix
  assert.doesNotMatch(
    diagnosing,
    /## Phase \d+ — Fix/i,
    "diagnosis must not contain a phase that implements a fix",
  );
  assert.doesNotMatch(
    diagnosing,
    /commit message records/i,
    "diagnosis must not contain a phase that commits a fix",
  );

  // States evidence-only inline scope in dispatch contract or invocation guard
  assert.match(
    diagnosing,
    /diagnosis is (?:always )?performed inline in the top-level session/i,
    "diagnosis must state inline top-level session scope up front",
  );
  assert.match(
    diagnosing,
    /evidence only|root-cause evidence only/i,
    "diagnosis must state evidence-only scope in dispatch contract or invocation guard",
  );

  // `produces:` is the catalog's artifact union and a consumer resolves each entry as a
  // path, so an evidence-only owner declares an empty list exactly like `gsd-tdd`; the
  // Produced cells carry the returned evidence in prose instead.
  assert.match(
    diagnosing,
    /^produces: \[\]$/m,
    "diagnosis writes no artifact, so its produces list stays empty",
  );
  assert.match(
    diagnosing,
    /\|\s*root-cause evidence\s*\|/i,
    "diagnosis Invocation modes Produced cells must state root-cause evidence",
  );

  // Routes architectural cause to gsd-brainstorming before repair
  assert.match(
    diagnosing,
    /transition to `gsd-brainstorming` before repair|route[sd]? (?:an )?architectural cause to `gsd-brainstorming` before repair/i,
    "diagnosis must route architectural causes before repair",
  );

  // Architecture skill states intake arrives before repair lands
  assert.match(
    architecture,
    /architectural cause arrives from diagnosis before (?:any )?repair lands|arriving before (?:any )?repair lands/i,
    "architecture skill must state architectural intake arrives before repair lands",
  );
});

test("M4: a reconciled task or batch runs one independent advisory review across hosts", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const adapters = read("adapters/README.md");

  const refWave = reference.match(/### Wave dispatch\n([\s\S]*?)(?=\n### |\n## |$)/)?.[1];
  assert.ok(refWave, "REFERENCE.md must have a ### Wave dispatch section");

  // Canon: exactly one independent read-only review per dispatched task or batch, with a
  // host-reviewer-or-verify fallback and advisory-only authority.
  assert.match(
    refWave,
    /after task or batch reconciliation[\s\S]{0,180}independent read-only review[\s\S]{0,160}reviewer sub-agent where the host can spawn one, otherwise the standalone review of `gsd-verify`/i,
    "canon must require one independent read-only review per dispatched task or batch with a host-or-verify fallback",
  );
  assert.match(
    refWave,
    /review is advisory[\s\S]{0,160}deterministic gates remain the only terminal authority[\s\S]{0,160}blocks only by citing bound plan text or a red deterministic check/i,
    "the wave review stays advisory and blocks only on bound plan text or a red check",
  );

  // The wave owner wires the review into reconciliation.
  assert.match(
    execution,
    /after task or batch reconciliation[\s\S]{0,120}independent read-only review[\s\S]{0,80}merged diff for every dispatched task or batch/i,
    "gsd-executing-plans must wire the review into task/batch reconciliation",
  );
  // Host generalization lives in the adapter map, not the host-neutral core.
  const capability = adapters.match(/## Capability map\n([\s\S]*?)(?=\n## )/)?.[1];
  assert.ok(capability, "adapters/README.md must declare a capability map");
  for (const host of ["OMP", "Claude Code", "Codex"]) {
    assert.match(capability, new RegExp(`\\| ${host} \\|`), `capability map must cover ${host}`);
  }
  assert.match(capability, /\| Sub-agent implementation \|/, "the map names sub-agent dispatch per host");
  assert.match(capability, /\| Isolated task workspaces \|/, "the map names isolation per host");
  assert.match(capability, /\| Independent review \|/, "the map names the host review feature");
  for (const reviewer of ["adapters/claude-code/agents/gsd-reviewer.md", "adapters/codex/agents/gsd-reviewer.toml"]) {
    assert.equal(existsSync(join(ROOT, reviewer)), true, `${reviewer} must ship the host reviewer`);
  }
  // OMP spawns sub-agents from a prompt, so its review runs as one isolated task carrying the
  // canonical brief rather than through a shipped agent definition. The map and the domain
  // workflow must both say that, or an adapter reader would expect a definition OMP never gets.
  assert.match(
    capability,
    /\| Independent review \| One isolated read-only reviewer sub-agent task[\s\S]{0,80}`gsd-verify` standalone-review brief \|/,
    "the OMP review cell must name the isolated reviewer task and its brief",
  );
  const domain = read("docs/domain/gsd.md");
  assert.match(
    domain,
    /plugin bundle includes read-only reviewer definitions for hosts that select[\s\S]{0,40}reviewers by definition/i,
    "the plugin bundle must provide reviewer definitions only where the host selects reviewers by definition",
  );
  assert.match(
    domain,
    /OMP dispatches one isolated read-only reviewer task carrying[\s\S]{0,20}the[\s\S]{0,40}`gsd-verify` standalone-review brief/i,
    "the plugin workflow must name OMP's isolated reviewer task and canonical brief",
  );
  assert.doesNotMatch(domain, /host.s agent directory/i);
});

test("M4: the host reviewer subagent is read-only and holds no lifecycle authority", () => {
  const claude = read("adapters/claude-code/agents/gsd-reviewer.md");
  const codex = read("adapters/codex/agents/gsd-reviewer.toml");

  // Claude Code: the tools frontmatter grants read-only inspection only, so the reviewer
  // cannot edit, run lifecycle commands, or spawn work of its own.
  const tools = claude.match(/^tools:\s*(.+)$/m)?.[1] ?? "";
  const granted = tools.split(",").map((tool) => tool.trim()).filter(Boolean).sort();
  assert.deepEqual(granted, ["Glob", "Grep", "Read"], "the Claude Code reviewer may only Read, Grep, and Glob");
  for (const forbidden of ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "Task"]) {
    assert.ok(!granted.includes(forbidden), `the Claude Code reviewer must not grant ${forbidden}`);
  }
  assert.match(
    claude,
    /never edit files[\s\S]{0,80}commit[\s\S]{0,40}decide completion/i,
    "the reviewer states it never edits, commits, or decides completion",
  );

  // Codex: the agent is sandboxed read-only rather than granted a writable workspace.
  assert.match(codex, /sandbox_mode\s*=\s*"read-only"/, "the Codex reviewer must be sandboxed read-only");
  assert.doesNotMatch(codex, /sandbox_mode\s*=\s*"workspace-write"/);

  // Both definitions keep the review advisory: blocking only on bound plan text or a red check.
  for (const [host, body] of [["claude-code", claude], ["codex", codex]]) {
    assert.match(
      body,
      /advisory[\s\S]{0,120}deterministic gates[\s\S]{0,40}terminal[\s\S]{0,10}authority/i,
      `${host}: the reviewer must stay advisory`,
    );
    assert.match(
      body,
      /only blocks when it cites bound plan text[\s\S]{0,120}red deterministic check/i,
      `${host}: the reviewer blocks only on bound plan text or a red deterministic check`,
    );
  }
});

test("M6: each adapter maps the depth ladder onto its declared host features", () => {
  const adapters = read("adapters/README.md");

  const map = adapters.match(/## Depth ladder mapping\n([\s\S]*?)(?=\n## )/)?.[1];
  assert.ok(map, "adapters/README.md must declare a depth ladder mapping");
  for (const depth of ["direct", "quick", "plan", "milestone"]) {
    assert.ok(map.includes(`\`${depth}\``), `depth mapping must name ${depth}`);
  }
  for (const host of ["OMP", "Claude Code", "Codex"]) {
    assert.match(map, new RegExp(`\\| ${host} \\|`), `depth mapping must cover ${host}`);
  }

  // Shallow depths stay host-free; deep depths land on declared host features and never
  // invent authority a host lacks.
  assert.match(map, /`direct`[\s\S]{0,200}(?:no skill, artifact, or host feature|no host-specific setup)/i);
  assert.match(map, /presentation-only[\s\S]{0,200}never binds/i);
  assert.match(map, /non-authoritative/i);
  assert.match(
    map,
    /host `\/goal` runs a persistent goal of its own[\s\S]{0,40}ledger is the goal record/i,
  );
  assert.match(map, /only `plan` and\s+`milestone` reach dispatch, isolation, milestone, and review features/i);

  // The mapping cites the canon that defines the ladder, so a rename cannot orphan it.
  assert.match(adapters, /REFERENCE\.md`? § Triage and depth ladder/);
  assert.match(adapters, /never faked/);

  // Decision 0017: host plan and goal features are affordances, never authority. The adapter
  // names the recommendation the owner gets, and neither artifact may become lifecycle state.
  assert.match(map, /host plan and goal features are affordances, not authority/i);
  assert.match(
    map,
    /Codex recommends `\/plan` to shape a multi-step change/i,
    "the map names the Codex plan affordance the adapter recommends",
  );
  assert.match(
    map,
    /Claude Code and Codex\s+`\/goal` completion condition is judged by a separate evaluator/i,
    "the map names both `/goal` affordances and their separate evaluator",
  );
  assert.match(
    map,
    /only definition of done[\s\S]{0,140}ever\s+lifecycle state/i,
    "the map keeps host plan and goal artifacts out of lifecycle state",
  );
  // Both hosts with a goal feature get the same non-authority rule in the capability row.
  for (const cell of [
    /\| Goals \| None; milestone ledger is the goal record \| `\/goal` runs a host completion condition judged by a separate evaluator; GSD never treats it as the goal record \|/,
    /\| Goals \|[^\n]*`\/goal` runs a persistent host goal with its own completion criteria; GSD never treats it as the goal record \|/,
  ]) {
    assert.match(adapters, cell, "the capability map keeps each host goal out of the goal record");
  }
  // OMP is the primary host: its read-only plan mode and plan todo list are declared as
  // display state rather than a missing feature, and plan.md stays the only planner.
  assert.match(
    adapters,
    /\| Plan mode \| Read-only plan mode with a plan todo list; the canonical `plan\.md` is the only authority \|/,
    "the capability map names the OMP read-only plan mode and keeps plan.md authoritative",
  );
  assert.match(
    map,
    /`plan` \| Canonical `plan\.md`; the host plan and its todo list stay display-only/,
    "the depth map keeps the OMP host plan and todo list display-only",
  );
  assert.equal(
    existsSync(join(ROOT, "docs/decisions/0017-host-plan-and-goal-affordances.md")),
    true,
    "the plan/goal affordance rule is a durable decision record",
  );
});

// M3 shipped the triage front door: the prompt is classified before any route or artifact
// load, ambiguity asks one recommended-default question, research happens before answering,
// every choice carries a recommendation, and depth is chosen from the work rather than a
// fixed heavyweight path. Nothing locked those contracts, so the objective's first
// requirement could silently drift.
test("M3: the triage front door classifies before routing with clarify, research, and recommend-always", () => {
  const bootstrap = read("skills/gsd/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const domain = read("docs/domain/gsd.md");
  const ROUTES = ["answer", "clarify", "research", "quick", "plan", "milestone"];

  for (const [label, body] of [
    ["bootstrap", bootstrap],
    ["canon", reference],
  ]) {
    const section = body.match(/## Triage(?: and depth ladder)?\n([\s\S]*?)(?=\n## )/)?.[1];
    assert.ok(section, `${label} must carry the triage front door`);
    for (const route of ROUTES) {
      assert.ok(section.includes(`\`${route}\``), `${label} triage must name \`${route}\``);
    }
    assert.match(
      section,
      /never a repository sweep|never sweep|read only what (?:it|the prompt) names/i,
      `${label} triage stays prompt-scoped`,
    );
    assert.match(section, /(?:never|not) file count/i, `${label} depth never follows file count`);
    assert.match(
      section,
      /never silently fall(?:s|ing) to ship a subset|never silently shipping a subset/i,
      `${label} depth never silently falls to ship a subset`,
    );
    assert.match(
      section,
      /Every choice names one (?:recommended option|recommendation), (?:its )?alternatives, and (?:their )?costs\./,
      `${label} states recommend-always`,
    );
  }

  // Clarify asks exactly one question carrying a recommended default; research is proactive
  // and never from memory.
  assert.match(
    reference,
    /`clarify`[\s\S]{0,200}exactly one question[\s\S]{0,80}recommended default/i,
  );
  assert.match(bootstrap, /ask (?:exactly )?one recommended-default question/i);
  assert.match(reference, /`research`[\s\S]{0,200}before answering, never from memory/i);
  assert.match(bootstrap, /never from memory/i);

  // The four depth levels bind their artifacts so a shallow case never loads one.
  assert.match(reference, /`direct`[\s\S]{0,160}no scratch, branch, commit, or skill/);
  assert.match(reference, /`quick`[\s\S]{0,160}Quick-fix plan/);
  assert.match(reference, /`plan`[\s\S]{0,160}canonical `plan\.md`/);
  assert.match(reference, /`milestone`[\s\S]{0,160}full plan plus the milestone ledger/);

  // The domain shard records the same front door and ladder as production behavior.
  assert.match(domain, /Triage[^.\n]{0,200}exactly one of `answer`, `clarify`, `research`/i);
  assert.match(domain, /Depth Ladder[^.\n]{0,120}`direct`, `quick`, `plan`, and `milestone`/i);
});

// Decision 0018: the three route boundaries the front door needs are defined in the
// bootstrap rather than left to inference. An undefined "Nano" made a one-line literal edit
// as consistent with `answer` as with `quick`, an asserted behavior read as a codebase
// question, and "read-only" described the answer mode but was taken as an effort marker.
// Each undefined boundary cost measured routes across three models, so all three ship as
// contract text in the bootstrap, the canon parity mirror, the injected OMP policy, the
// triage instrument, and the domain shard.
test("M3: the triage route boundaries are defined, not inferred", () => {
  const bootstrap = read("skills/gsd/SKILL.md");
  const domain = read("docs/domain/gsd.md");
  const ompPolicy = read("adapters/omp/gsd-context.js");
  const triageRunner = read("test/eval/triage-eval.mjs");

  for (const [label, body] of [
    ["bootstrap", bootstrap],
    ["domain shard", domain],
  ]) {
    assert.match(
      body,
      /Nano[^.\n]{0,40}one literal edit needing no test/i,
      `${label} defines a Nano edit instead of naming an undefined route word`,
    );
    assert.match(
      body,
      /asserts a behavior[^.\n]{0,80}`clarify`, never `research`|asserts a behavior[^.\n]{0,120}is `clarify` rather than `research`|unconfirmable assertion[^.\n]{0,80}is `clarify` rather than `research`/i,
      `${label} routes an unconfirmable asserted behavior to clarify over research`,
    );
    assert.match(
      body,
      /(?:answerable from|answer lives in) this repo, a document, or a reference[^.\n]{0,40}`research`|(?:answerable from|answer lives in) this repo, a document, or a reference[^.\n]{0,40}is `research` rather than `answer`/i,
      `${label} routes a lookup question to research over answer`,
    );
  }

  // The OMP system policy reinforces the same vocabulary, so the host that injects both
  // must not leave "Nano" undefined in the text a model reads first.
  assert.match(ompPolicy, /Nano edit: one literal edit needing no test/);

  // The instrument mirrors the production rule, so a fixture can never be scored against
  // vocabulary the live bootstrap does not carry.
  assert.match(triageRunner, /one literal edit needing no test/);
  assert.match(triageRunner, /asserts a behavior it cannot confirm/);
  assert.match(triageRunner, /answer lives in this repo, a document, or a reference/);
});

// Decision 0019: the README's claims about the three upstream references are verified against
// upstream source paths, and each borrowed idea is stated beside the deliberate difference.
// The claims were paraphrase before, and one of them mis-attributed a question style that the
// upstream repo explicitly refuses to cap, so the citations are the part worth locking.
test("M3: the README's reference claims cite upstream sources and their decision record", () => {
  const readme = read("README.md");

  for (const url of [
    "https://github.com/mattpocock/skills",
    "https://github.com/obra/superpowers",
    "https://github.com/Fission-AI/openspec",
  ]) {
    assert.ok(readme.includes(url), `the README must keep naming ${url}`);
  }

  // Each borrowed idea names the upstream file it came from, so a paraphrase cannot drift
  // into an unattributed claim again.
  assert.match(readme, /skills\/productivity\/grilling\/SKILL\.md/, "mattpocock citation");
  assert.match(readme, /hooks\/hooks\.json[\s\S]{0,200}hooks\/session-start/, "superpowers citations");
  assert.match(readme, /`## ADDED Requirements`[\s\S]{0,120}`### Requirement:`/, "openspec citation");
  assert.match(
    readme,
    /docs\/decisions\/0019-reference-repo-alignment\.md/,
    "the README must point at the alignment record",
  );
  assert.ok(existsSync(join(ROOT, "docs/decisions/0019-reference-repo-alignment.md")));

  // The counter-position stays recorded rather than smoothed away: upstream names GSD as a
  // process-owning framework, and the record states how the revamp answers that.
  const alignment = read("docs/decisions/0019-reference-repo-alignment.md");
  assert.match(alignment, /owning the process[\s\S]{0,80}take away your control/);
  assert.match(alignment, /exactly one question instead of a round/);
  assert.match(alignment, /explicit catalog[\s\S]{0,80}skillPath/);
  assert.match(alignment, /Domain Impact classification[\s\S]{0,160}ADDED\/MODIFIED\/REMOVED/);
});
