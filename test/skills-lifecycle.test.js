import { test } from "bun:test";
import assert from "node:assert/strict";
import { read, skillNames, filesUnder, ROOT, SKILLS } from "./support/skills-fixtures.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseActivationResponse, responseMatchesFixture, selectEvalBackend, validateActivationTarget,
  validateFixtureSet,
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
    /rewind[\s\S]{0,240}(?:committed WIP|working tree)/i,
    "recovery contract excludes conversation-rewind tooling and names the tree it leaves behind",
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
    /(?:mode|toolset)[\s\S]{0,240}(?:edit|editing)[\s\S]{0,120}(?:commit|committing)/i,
    "the restricted-mode row names the tools the lifecycle needs",
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

  // README is the human entry point for the same command, so the two must not drift.
  assert.match(read("README.md"), /bun test/, "the README names the bun test command");
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
  assert.match(execution, /current top-level session owner consumes the validated slice/);
  assert.match(execution, /implements or repairs the task inline/);
  assert.match(execution, /next task in strict heading order/);
  assert.match(execution, /dispatches no[\s\S]{0,120}generic child task/);
  // Authorship moved to sub-agents, so the pin has to say who authors and who stays
  // responsible: a dispatched task still returns to the owner for inline sequential repair.
  assert.match(reference, /authored by sub-agents[\s\S]{0,300}repair[\s\S]{0,120}inline[\s\S]{0,80}sequential/i);
  assert.match(execution, /Task `Tn\+1` begins only from the committed green checkpoint of `Tn`/);
  assert.match(execution, /Source mutations never overlap task\/repair or Deferred Slow E2E/i);
  assert.match(verify, /No free-form critique or model-generated verdict is terminal authority/);
  assert.match(domain, /### P-gsd-3: Make the session owner the sole lifecycle authority/);
  assert.match(domain, /### P-gsd-4: Converge only through deterministic blockers/);
  assert.match(domain, /### P-gsd-5: Rehydrate authority from canonical sources/);
  assert.match(readme, /## Session-owner authority/);
  assert.equal(existsSync(join(ROOT, "agents", "gsd-executor.md")), false);
  assert.equal(existsSync(join(ROOT, "agents", "gsd-reviewer.md")), false);
  assert.match(execution, /full parse and binding check at execution entry or resume/);
  assert.match(execution, /At ordinary task selection consume the retained validated task slice/);
  assert.match(execution, /RED before implementation, GREEN after implementation, then refactor after green/);
  assert.match(execution, /rerun only checks invalidated by the repair/);
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
  assert.match(handoff, /Reject an unknown `phase`; preserve an opaque `next_action`/);
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
  assert.match(handoff, /writes atomically to `\.scratch\/<feature>\/state\.toon`/);
  assert.match(handoff, /Active skills are derived from `phase` and `next_action`/);
  assert.match(handoff, /Never serialize a `reload` manifest/);
  assert.match(handoff, /Exact active v1, v2, and v3 records migrate atomically/);
  assert.match(handoff, /v1\/v2 terminal records fail closed unchanged/);
  assert.match(planner, /atomically write canonical `schema:v4` `state\.toon`/);
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

  // Leftover terminal or malformed state gates related and lifecycle intent only. An
  // unrelated direct prompt keeps ordinary behavior, and uncertainty asks one question.
  for (const doc of [master, reference]) {
    assert.match(doc, /(?:unrelated direct work[\s\S]{0,100}never blocked|never blocks[\s\S]{0,100}unrelated direct work)/i);
    assert.match(doc, /one question[\s\S]{0,80}instead of stopping/i);
    assert.match(doc, /Malformed residual bytes without a `plan\.md` \| `ordinary-routing`/);
    assert.doesNotMatch(doc, /Any state is malformed \| `fail-closed`/);
    assert.doesNotMatch(doc, /globally gates recovery|global crash-recovery gate/);
  }
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

  // Validated active state enters through gsd-handoff; next_action picks the peer owner.
  assert.match(master, /`gsd-handoff`[^.\n]{0,160}(?:first|gateway)|(?:first|gateway)[^.\n]{0,160}`gsd-handoff`/);
  assert.match(master, /`next_action`/);
  assert.match(master, /bare resume[^.\n]{0,120}`gsd-handoff`/i);
  assert.match(master, /[Nn]aming the work[^.\n]{0,140}`gsd-executing-plans`/);

  // Runtime discovery decides malformed authority: a feature holding both `plan.md` and
  // malformed `state.toon` throws for every prompt, while plan-less bytes are skipped.
  assert.match(master, /malformed[\s\S]{0,240}`fail-closed`|`fail-closed`[\s\S]{0,240}malformed/);
  assert.match(master, /(?:full|complete) packet|without a `plan\.md`|residual/i);

  // A moved plan hash is an amendment, never a lifecycle stop.
  assert.match(master, /hash mismatch[^.\n]{0,120}amend|amend[^.\n]{0,120}hash mismatch/i);

  // A first-pending ledger row resumes; it never authorizes replacement brainstorming.
  assert.match(master, /first pending[^.\n]{0,160}resum|ledger[^.\n]{0,160}resum/i);

  // gsd-tdd is a helper: it is never the primary owner for direct work.
  assert.match(master, /`gsd-tdd`[^.\n]{0,160}never[^.\n]{0,40}(?:primary|owner)/);

  // `continue` alone is the only bare resume: it enters gsd-handoff even beside exactly
  // one executing packet, while `continue` plus a named feature/task/repair routes
  // straight to that owner. The executing-plans catalog row admits only prompt-named
  // pending work, so `next_action` never competes with the gateway during selection.
  assert.match(master, /`continue` alone is a bare resume/);
  assert.match(master, /even beside one executing packet/);
  assert.match(master, /`continue` plus a named feature, task, or repair is not bare/);
  assert.match(master, /Unrelated new work beside an active or `merged-cleanup-pending` packet is `ordinary-routing`; only a discovered completed-retained or residual record reports `ignore-terminal-record`/);
  // A returned Quick-fix WIP Fail leaves a nameable repair round that loads gsd-verify.
  assert.match(master, /repair round its prompt can name, which loads `gsd-verify` rather than answering directly/);
  assert.match(master, /An unrelated valid `merged-cleanup-pending` state \| `ordinary-routing`[\s\S]{0,120}never `ignore-terminal-record`/);
  // `ignore-terminal-record` is gated on a discovered terminal record: with none present,
  // unrelated work beside an active or merged-cleanup-pending packet stays ordinary.
  assert.match(master, /`ignore-terminal-record` needs a discovered `phase=completed-retained` record or residual terminal bytes; with none present, unrelated work stays `ordinary-routing`/);
  assert.match(reference, /`?ignore-terminal-record`?[\s\S]{0,160}(?:`?phase=completed-retained`?|completed-retained)[\s\S]{0,120}residual terminal bytes[\s\S]{0,160}(?:no such record|none present)[\s\S]{0,160}`?ordinary-routing`?/i);
  // An active packet is never terminal history, so unrelated new work beside one is ordinary.
  assert.match(master, /An active or `merged-cleanup-pending` packet is never terminal history, so unrelated new work beside one is `ordinary-routing`/);
  assert.match(reference, /(?:active or )?`?merged-cleanup-pending`?[\s\S]{0,120}never terminal history[\s\S]{0,160}unrelated[\s\S]{0,120}`?ordinary-routing`?/i);
  // An unrelated valid merged-cleanup-pending state routes ordinarily: ignore-terminal-record
  // names completed-retained and residual records only, so the two rows never collapse.
  assert.match(reference, /`?phase=merged-cleanup-pending`?[\s\S]{0,180}unrelated[\s\S]{0,200}never (?:report )?`?ignore-terminal-record`?[\s\S]{0,160}completed-retained[\s\S]{0,100}residual/i);
  const executing = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(executing, /^description: "[^"]*pending work that the prompt names\."$/m);
  assert.doesNotMatch(executing.match(/^description: .*$/m)[0], /next_action/);

  // A located failure stays direct: diagnosis owns only unlocated or non-obvious causes.
  assert.match(master, /named file\/line or exact failure signature is located/);
  assert.match(master, /`gsd-diagnosing-bugs` owns only unlocated or non-obvious causes/);

  // Hash drift keeps prompt-named work with its executing owner instead of diverting to
  // the resume gateway, and a full malformed packet outranks every other active packet.
  assert.match(master, /never a stop or `gsd-handoff` diversion/);
  assert.match(master, /even one naming another valid feature/);

  // Several valid packets are an ambiguity to resolve through gsd-handoff, not a stop.
  // detectCandidates returns every valid packet and the capsule asks for exactly one
  // validated resume, so generic `continue` selects that owner instead of failing closed.
  assert.match(master, /(?:several|multiple|more than one)[^.\n]{0,120}valid[^.\n]{0,200}`gsd-handoff`/i);
  assert.match(master, /exactly one[^.\n]{0,80}resume/i);

  // The visible catalog description decides selection, so ledger recovery must appear.
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const handoffDescription = handoff.match(/^description: "(.*)"$/m);
  assert.ok(handoffDescription);
  assert.match(handoffDescription[1], /ledger|milestone/i);

  const domain = read("docs/domain/gsd.md");
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

test("Quick-fix owner uses the injected hidden context and deterministic gates", () => {
  const master = read("skills/gsd/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");

  assert.match(master, /PONYTAIL_CONTEXT_PATH/);
  assert.match(master, /session owner[\s\S]{0,220}bounded fix[\s\S]{0,220}PONYTAIL_CONTEXT_PATH/i);
  // A fix the user already diagnosed is direct work: both evaluated models otherwise
  // named `gsd-verify` as the primary owner for a one-line known fix.
  assert.match(master, /already diagnosed[^.\n]{0,80}direct[^.\n]{0,60}never a `primarySkill`/i);
  assert.match(master, /PONYTAIL_CONTEXT_PATH[\s\S]{0,300}gsd-tdd[\s\S]{0,240}gsd-verify/i);
  assert.match(reference, /\| `gsd-verify` \| owner \|[^|\n]*Quick-fix[^|\n]*\|[^|\n]*Quick-fix `plan\.md`[^|\n]*\|/i);
  assert.match(reference, /Quick-fix[\s\S]{0,300}session owner[\s\S]{0,300}gsd-tdd[\s\S]{0,300}gsd-verify/i);
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
  assert.match(execution, /atomically update `state\.toon` with `last_green_task`, `last_green_commit`, `next_action=start\/continue task/);
  assert.match(execution, /Only after every non-superseded task and Fast TDD Check is green/);
  assert.match(execution, /next_action=enter terminal verification\/repair/);
  assert.match(execution, /load `gsd-verify`/);
  assert.doesNotMatch(execution, /After every non-superseded task[\s\S]{0,100}load `gsd-verify`/);
});

test("terminal-conformance AC-2: deterministic cumulative coverage and quality", () => {
  const verify = read("skills/gsd-verify/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.match(verify, /every active AC maps exactly once to one completed task and one public interface pin/);
  assert.match(verify, /every changed path is task-owned/);
  assert.match(verify, /task diffs in plan order/);
  assert.match(verify, /explicit Decisions, invariants, non-goals/);
  assert.match(verify, /focused-check evidence on the unchanged current commit/);
  assert.match(reference, /malformed binding[\s\S]{0,120}ownership\/coverage mismatch[\s\S]{0,120}contract contradiction[\s\S]{0,120}unresolved change[\s\S]{0,120}red deterministic check[\s\S]{0,100}blocks?/i);
});

test("terminal-conformance AC-5: same-commit invalidation and merge gates", () => {
  const verify = read("skills/gsd-verify/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.match(verify, /Any source change invalidates prior conformance/);
  assert.match(verify, /full slow\/E2E GREEN on the same unchanged commit/);
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


// --- session-owner terminal conformance ---
