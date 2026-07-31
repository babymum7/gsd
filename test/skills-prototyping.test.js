import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalPacket, structuredPacket, FILES_BLOCK, filesBlockWith, T1_BLOCK, INTERFACE_ROW,
  replaceOnce, read, skillNames, visibleSkillNames, filesUnder, markdownFiles,
  parseAgentFrontmatter, ROOT, SKILLS,
} from "./support/skills-fixtures.js";
import nodeFs from "node:fs";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  bindApprovedSources, parseMarkdownPacket, parseQuickFixPlan, rejectLegacyPreapprovalFiles,
  sha256, verifyApprovedSources, validateSectionEdges,
} from "../lib/gsd-contract.mjs";
import {
  parseActivationResponse, responseMatchesFixture, selectEvalBackend, validateActivationTarget,
  validateFixtureSet,
} from "./eval/activation-eval-contract.mjs";
import gsdContextExtension, { CAPSULE_TEMPLATE } from "../extensions/gsd-context.js";

test("repository root instructs agents on design ownership", () => {
  const agents = read("AGENTS.md");
  const gitignore = read(".gitignore");

  assert.equal(agents.match(/^## Design documentation$/gm)?.length, 1, "exactly one canonical design section");
  // The root file is the only agent contract and reaches the agent because it is supplied
  // as context. That holds wherever the agent is started, so the contract binds the outcome
  // under `design/` rather than a working directory, a meta directory, or a run mode.
  assert.match(agents, /root `AGENTS\.md`[\s\S]{0,200}only agent contract/i);
  assert.doesNotMatch(agents, /working directory is set to this repository root, so its agent reads this file/i);
  assert.doesNotMatch(agents, /working directory[^.]{0,80}repository root/i);
  assert.doesNotMatch(agents, /meta directory/i);
  assert.doesNotMatch(agents, /inline artifact/i);
  assert.doesNotMatch(agents, /`design\/AGENTS\.md`/);
  assert.match(agents, /prototype artifacts[\s\S]{0,160}under `design\/`/i);
  // design/ is the source of truth for surface behavior; production code converts from it.
  assert.match(agents, /source of truth[\s\S]{0,200}convert/i);
  assert.match(agents, /backend-only[\s\S]{0,160}no design impact/i);
  // A system-wide accepted rule is durable; per-surface states stay with their surface.
  assert.match(agents, /`design\/docs\/interaction-rules\.md`/);
  // Configuration is outcome-based: whichever design tool runs, and whether its agent starts
  // at the repository root or inside `design/`, it is supplied this file plus
  // `design/DESIGN.md` as context, every generated design artifact lands under `design/`
  // already decomposed, and the tool's own runtime output stays uncommitted.
  assert.match(agents, /[Aa]ny AI design tool/);
  assert.doesNotMatch(agents, /design tools open the repository root/i);
  assert.match(agents, /repository root or (?:from )?(?:in|inside) `design\/`/i);
  assert.match(agents, /generated[\s\S]{0,100}`design\/`/i);
  assert.match(agents, /`design\/DESIGN\.md`[\s\S]{0,100}context/i);
  assert.match(agents, /runtime output[\s\S]{0,80}uncommitted/i);
  assert.match(agents, /single[- ]file[\s\S]{0,240}(?:decompose|split)/i);
  assert.match(agents, /before[\s\S]{0,120}lock/i);
  for (const entry of [".od/", ".live-artifacts/", ".file-versions/"]) {
    assert.ok(
      gitignore.split("\n").includes(entry),
      `.gitignore ignores design-tool runtime output directory ${entry}`,
    );
  }
});

test("prototype review captures accepted feedback before the surface locks", () => {
  const prototyping = read("skills/gsd-prototyping/SKILL.md");

  // Review feedback is durable only when it lands in an artifact: a system-wide rule goes
  // to the ledger, a surface-specific decision stays with its surface document.
  assert.match(prototyping, /`design\/docs\/interaction-rules\.md`/);
  assert.match(prototyping, /IR-<n>/);
  assert.match(prototyping, /system-wide[\s\S]{0,240}interaction-rules\.md/i);
  assert.match(prototyping, /surface-specific[\s\S]{0,200}surface(?:'s)? document/i);
  // Capture happens in the same turn as the prototype change, so the artifact never lags
  // behind what the prototype renders.
  assert.match(prototyping, /same turn[\s\S]{0,160}prototype change/i);
  // Lock is the gate that makes capture non-optional.
  assert.match(prototyping, /^\d+\. [^\n]*(?:accepted|unrecorded)[^\n]*$/m, "a lock criterion covers accepted feedback");
  assert.match(prototyping, /read[\s\S]{0,160}interaction-rules\.md[\s\S]{0,200}before/i);

  // The skill reads the root contract, never a nested one, and records the outcome the tool
  // must leave behind rather than how it is invoked. A single-file artifact is decomposed
  // before the surface can lock.
  assert.match(prototyping, /root `AGENTS\.md`/);
  assert.doesNotMatch(prototyping, /`design\/AGENTS\.md`/);
  assert.doesNotMatch(prototyping, /[Rr]un the design tool from the repository root/);
  assert.doesNotMatch(prototyping, /working directory[^.]{0,80}repository root/i);
  assert.doesNotMatch(prototyping, /meta directory/i);
  assert.doesNotMatch(prototyping, /inline artifact/i);
  assert.match(prototyping, /repository root or (?:from )?(?:in|inside) `design\/`/i);
  assert.match(prototyping, /generated[\s\S]{0,100}`design\/`/i);
  assert.match(prototyping, /(?:context|governed by)[\s\S]{0,120}`design\/DESIGN\.md`|`design\/DESIGN\.md`[\s\S]{0,120}(?:context|governed)/i);
  assert.match(prototyping, /single[- ]file[\s\S]{0,240}(?:decompose|split)/i);
  assert.match(prototyping, /^\d+\. [^\n]*(?:decomposed|split into)[^\n]*$/m, "a lock criterion covers the structure");

  // The Design standard states obligations, not one framework's mechanics: the template's
  // light-DOM custom elements are named as its own choice, so a project on a component
  // framework keeps the obligation and swaps the mechanism.
  assert.match(prototyping, /declared token, never an inline literal/i);
  assert.match(prototyping, /one extracted component/i);
  assert.match(prototyping, /component framework uses that framework instead/i);

  // The obligation the standard binds is the outcome under `design/`, not one tool's
  // invocation, so the preamble naming the bound obligations names that outcome.
  assert.match(
    prototyping,
    /bound obligations[\s\S]{0,400}(?:any design tool|whichever design tool|tool-neutral)/i,
    "the Design standard preamble binds a tool-neutral outcome as an obligation",
  );
  // The preamble names which obligations it binds; claiming every following bullet would
  // sweep in the interaction-rule ledger read, which the already-recorded rules require
  // rather than the design-standard obligations.
  assert.doesNotMatch(prototyping, /binds every bullet/i);
  assert.match(
    prototyping,
    /interaction-rule ledger[\s\S]{0,240}(?:rules already recorded|already recorded in it)/i,
    "the preamble attributes the ledger read to the rules already recorded in it",
  );
  assert.doesNotMatch(prototyping, /own invariant/i);

  // Both artifacts carry the tool-neutral outcome obligation, and both attribute the ledger
  // read to the rules already recorded in it, so neither claims the other's scope and
  // neither describes document structure in place of behavior.
  const domain = read("docs/domain/gsd.md");
  const invariant = domain.split("\n").find((line) => /^- The design standard binds obligations/.test(line));
  assert.ok(invariant, "the shard records a design-standard invariant");
  assert.match(invariant, /`design\/`/);
  assert.match(invariant, /any design tool|whichever design tool|tool-neutral/i);
  assert.doesNotMatch(invariant, /working directory[^.]{0,80}repository root/i);
  assert.doesNotMatch(invariant, /meta directory/i);
  assert.doesNotMatch(invariant, /inline artifact/i);
  assert.match(
    invariant,
    /interaction-rule ledger[\s\S]{0,240}(?:rules already recorded|already recorded in it)/i,
    "the invariant attributes the ledger read to the rules already recorded in it",
  );
  assert.doesNotMatch(invariant, /own invariant|part of this enumeration/i);
});

test("prototype lock requires a resolvable production map", () => {
  // The claim is what makes drift detectable after cleanup deletes `.scratch`, so a surface
  // may not lock while nobody can say which production files it governs.
  const prototyping = read("skills/gsd-prototyping/SKILL.md");
  const lockSection = prototyping.split(/^## Lock criteria$/m)[1].split(/^## /m)[0];
  const criteria = [...lockSection.matchAll(/^\d+\. (.+)$/gm)].map(([, text]) => text);

  const mapCriterion = criteria.find((text) => /production surface/i.test(text));
  assert.ok(mapCriterion, "a lock criterion covers the production-surface claim");
  assert.match(mapCriterion, /`none`/, "an unconverted surface declares none rather than omitting the claim");
  assert.match(
    mapCriterion,
    /IR-<n>[\s\S]{0,160}(?:interaction-rules\.md|ledger)/i,
    "the same criterion requires every cited rule to resolve in the ledger",
  );
});

test("the prototype loop is fast-only and its lock gates on per-state coverage", () => {
  // Removing the browser suite without replacing what it proved would weaken lock, so the
  // gate moves onto evidence the fast loop can actually produce: one headless test per
  // state the surface renders.
  const prototyping = read("skills/gsd-prototyping/SKILL.md");
  const lockSection = prototyping.split(/^## Lock criteria$/m)[1].split(/^## /m)[0];
  const criteria = [...lockSection.matchAll(/^\d+\. (.+)$/gm)].map(([, text]) => text);

  const checkCriterion = criteria.find((text) => /check:fast/.test(text));
  assert.ok(checkCriterion, "a lock criterion names the fast check");
  assert.match(
    checkCriterion,
    /headless test[\s\S]{0,160}(?:each|every) state/i,
    "the check criterion requires per-state headless coverage",
  );
  assert.doesNotMatch(prototyping, /check:slow/, "the skill names no slow gate");
  assert.doesNotMatch(prototyping, /playwright|puppeteer|chromium|browser suite/i, "no browser gate survives");

  // The shipped template is what a project copies, so a browser dependency there would
  // reintroduce the cost the design phase just dropped.
  const pkg = JSON.parse(read("skills/gsd-prototyping/template/package.json"));
  assert.equal(typeof pkg.scripts["check:fast"], "string", "the template keeps its fast loop");
  assert.equal(pkg.scripts["check:slow"], undefined, "the template ships no slow script");
  const browser = /playwright|puppeteer|chromium|axe|percy/i;
  for (const script of Object.values(pkg.scripts)) {
    assert.doesNotMatch(script, browser, "no template script runs a browser");
  }
  for (const name of Object.keys(pkg.devDependencies)) {
    assert.doesNotMatch(name, browser, `${name} is a browser dependency`);
  }
  const templateDesign = read("skills/gsd-prototyping/template/DESIGN.md");
  assert.doesNotMatch(templateDesign, /check:slow/, "the template design contract names no slow gate");
  assert.doesNotMatch(templateDesign, browser, "the template design contract names no browser tooling");
  assert.doesNotMatch(
    read("skills/gsd-prototyping/template/primitives/button.test.js"),
    /check:slow/,
    "the shipped primitive spec defers nothing to a slow gate",
  );

  // A prototype-only packet has no production journey to run, so keeping the slow stage
  // would gate the cheapest phase on a suite with nothing to exercise.
  const readme = read("README.md");
  assert.match(
    readme,
    /prototype-only[\s\S]{0,160}Deferred Slow E2E/i,
    "the lifecycle overview exempts prototype-only packets from the slow stage",
  );

  // The shard is the durable record: leaving the slow gate in the Prototype Lock term would
  // contradict the skill that owns the transition.
  const domain = read("docs/domain/gsd.md");
  const lockTerm = domain.split("\n").find((line) => /^\| Prototype Lock \|/.test(line));
  assert.ok(lockTerm, "the shard defines Prototype Lock");
  assert.doesNotMatch(lockTerm, /slow/i, "the term drops the slow gate");
  assert.match(lockTerm, /headless test[\s\S]{0,120}(?:each|every) state/i);
  const standard = domain.split("\n").find((line) => /^- The design standard binds obligations/.test(line));
  assert.doesNotMatch(standard, /split by cost/i, "the design obligation drops the cost split");
  assert.match(standard, /headless test[\s\S]{0,160}(?:each|every) state/i);
});

test("the template surface document declares its conversion state", () => {
  // `## Production surfaces` cannot carry this: a converted surface whose design changed
  // again keeps its claim lines, so it is indistinguishable from a synced one.
  const surface = read("skills/gsd-prototyping/template/docs/surface-example.md");
  const section = surface.split(/^## Conversion$/m)[1];
  assert.ok(section, "the example surface declares a ## Conversion section");
  const body = section.split(/^## /m)[0].split("\n").filter((line) => line.trim() !== "");
  assert.deepEqual(body.length, 1, "the conversion body is a single token");
  assert.match(body[0], /^(?:converted|pending)$/, "the token is converted or pending");

  // The parser rejects prose inside a machine-read section, so the explanation lives above
  // the heading rather than under it.
  const prose = surface.split(/^## Conversion$/m)[0];
  assert.match(prose, /`converted`[\s\S]{0,200}`pending`|`pending`[\s\S]{0,200}`converted`/);

  const lockCriteria = read("skills/gsd-prototyping/SKILL.md")
    .split(/^## Lock criteria$/m)[1].split(/^## /m)[0];
  assert.match(
    lockCriteria,
    /## Conversion/,
    "the map lock criterion requires the declared conversion state",
  );
});

test("prototype lock asks the conversion cadence once and records pending either way", () => {
  // Converting immediately was the only cadence, so a deliberately deferred conversion had
  // nowhere to be recorded. One question at lock is the whole mechanism: it adds no runtime
  // key, and both answers leave the same declared state behind.
  const prototyping = read("skills/gsd-prototyping/SKILL.md");
  const transition = prototyping.split(/^## Transition$/m)[1];
  assert.ok(transition, "the owner declares its transition");

  assert.match(transition, /one question/i, "the cadence is one question, not a menu");
  assert.match(
    transition,
    /convert[\s\S]{0,200}`gsd-brainstorming`/i,
    "the convert-now answer loads requirements convergence",
  );
  assert.match(
    transition,
    /batch[\s\S]{0,240}(?:no lifecycle artifact|stops)/i,
    "the batch answer stops without authoring a lifecycle artifact",
  );
  // `only for convert-now` is the load-bearing half: an implementation loading the peer in
  // both branches would satisfy every positive match above while erasing the choice. The
  // batch sentence must therefore name no owner to load.
  const batchSentence = transition
    .split(/(?<=\.)\s+/)
    .find((sentence) => /batch/i.test(sentence) && /`pending`|stops|no lifecycle artifact/i.test(sentence));
  assert.ok(batchSentence, "the transition states the batch branch in its own sentence");
  assert.doesNotMatch(
    batchSentence,
    /load `gsd-[a-z-]+`/i,
    "the batch branch loads no skill, so deferring authors no lifecycle artifact",
  );
  assert.match(
    transition,
    /both[\s\S]{0,200}`pending`/i,
    "both answers record the same pending conversion state",
  );
  // A deferred conversion must not be reachable only by remembering it: the queue is the
  // declared state the validator counts.
  assert.match(transition, /validate-design-map|`pending`[\s\S]{0,160}queue/i);
  assert.match(
    transition,
    /prototype-only[\s\S]{0,200}Deferred Slow E2E/i,
    "prototype-only work carries no slow stage",
  );

  // The catalog and source-of-truth invariants recorded an unconditional transition, which
  // would contradict the branch the owner now takes.
  const domain = read("docs/domain/gsd.md");
  const catalog = domain.split("\n").find((line) => /^- The visible catalog carries/.test(line));
  assert.ok(catalog, "the shard records the catalog invariant");
  assert.doesNotMatch(
    catalog,
    /transitions to `gsd-brainstorming` on Prototype Lock\./,
    "the catalog invariant no longer records an unconditional transition",
  );
  assert.match(catalog, /cadence|convert now|batch/i, "the catalog invariant records the choice");
  const truth = domain.split("\n").find((line) => /^- A locked `design\/` prototype is the source/.test(line));
  assert.ok(truth, "the shard records the source-of-truth invariant");
  assert.match(truth, /`pending`/, "the invariant records the deferred state");

  const policy = domain.split(/^### P-gsd-15: /m)[1].split(/^### /m)[0];
  assert.match(policy, /one question/i, "the policy records the single cadence question");
  assert.match(policy, /`pending`/, "the policy records the state both answers write");
  assert.match(domain, /\| Choose the conversion cadence \| .+ \|/, "a command row records the cadence");
  // The walkthrough is the shard's own record of the flow, so an unconditional transition
  // there would contradict the batch answer that stops with no lifecycle artifact.
  const walkthrough = domain.split(/^### Lock a prototype before requirements$/m)[1].split(/^### /m)[0];
  assert.match(walkthrough, /one conversion-cadence question/i, "the walkthrough asks the cadence question");
  assert.match(
    walkthrough,
    /batch[\s\S]{0,120}no lifecycle artifact/i,
    "the walkthrough records the batch branch stopping without a lifecycle artifact",
  );
  assert.doesNotMatch(
    walkthrough,
    /lists, then transition to requirements convergence/,
    "the walkthrough no longer transitions unconditionally at lock",
  );
});

test("a conversion task flips the declared state under a scoped terminal gate", () => {
  // The declaration is only trustworthy if the change that converts a surface must move it.
  // The gate has to stay scoped, though: a deferred lock writes `pending` deliberately, so
  // blocking every changed surface document would make the batch cadence block itself.
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(
    execution,
    /`reuse-prototype`[\s\S]{0,320}`## Conversion`[\s\S]{0,200}`converted`/,
    "a conversion task sets the surface's conversion state to converted",
  );
  assert.match(
    execution,
    /`converted`[\s\S]{0,200}same task as the production change/,
    "the flip is owned by the same task as the production change",
  );

  const verify = read("skills/gsd-verify/SKILL.md");
  const step = verify
    .split(/\n(?=\d\. )/)
    .find((chunk) => /^4\. /.test(chunk) && /UI Impact/.test(chunk));
  assert.ok(step, "the terminal gate states UI Impact conformance as step 4");
  assert.match(
    step,
    /`reuse-prototype`[\s\S]{0,240}changed[\s\S]{0,120}`Surfaces`[\s\S]{0,200}`pending`[\s\S]{0,160}(?:blocks|Blocker)/,
    "the gate fires on a reuse-prototype classification whose declared surfaces changed while the state stayed pending",
  );
  // Scope is the load-bearing half: a gate firing on any `pending` surface would satisfy the
  // match above while breaking the deferred cadence, so the exemption must be stated.
  assert.match(
    step,
    /(?:deferred|prototype-authoring|authoring)[\s\S]{0,200}`pending`[\s\S]{0,120}(?:untouched|never blocks|not a blocker)/i,
    "a deferred lock's pending state is left untouched",
  );

  // The obligations must live inside the canonical design section: a stray `## Conversion`
  // mention elsewhere in the contract would satisfy a whole-file match while leaving the
  // one section a future agent is bound by silent.
  const agents = read("AGENTS.md");
  const design = agents.split(/^## Design documentation$/m)[1]?.split(/^## /m)[0];
  assert.ok(design, "the contract carries its canonical design section");
  assert.match(
    design,
    /`## Conversion`[\s\S]{0,200}`converted`[\s\S]{0,40}`pending`/,
    "the contract requires the declared conversion state",
  );
  assert.match(
    design,
    /`pending`[\s\S]{0,200}later batch/i,
    "the contract permits holding a locked surface for a later batch",
  );
  assert.match(
    design,
    /convert[\s\S]{0,240}`converted`[\s\S]{0,160}same task/i,
    "the converting change flips the state in its own task",
  );

  const domain = read("docs/domain/gsd.md");
  const policy = domain.split(/^### P-gsd-17: /m)[1]?.split(/^### /m)[0];
  assert.ok(policy, "the shard records the conversion-flip policy");
  assert.match(policy, /`converted`/, "the policy names the flipped state");
  assert.match(policy, /`reuse-prototype`/, "the policy scopes the gate to conversion work");
  assert.match(policy, /`pending`/, "the policy preserves the deferred state");
  assert.match(domain, /\| Convert a locked surface \| .+ \|/, "a command row records the conversion");
});

test("the drift owner reports three planes and routes both directions", () => {
  // Drift is only actionable when each plane names its own authority pair and its own
  // verdict: one blended verdict would hide which side moved.
  const sync = read("skills/gsd-design-sync/SKILL.md");
  assert.match(sync, /^## Invocation modes$/m, "the owner declares its invocation modes");

  for (const authority of [
    /docs\/domain\/<scope>\.md/,
    /design\/docs\/interaction-rules\.md/,
    /design\/docs\/<surface>\.md/,
  ]) {
    assert.match(sync, authority, `the planes name ${authority.source}`);
  }
  // A plane is only checkable when both of its sides are named: the spec plane compares a
  // domain shard against code, and the UI plane compares prototype artifacts against the
  // production markup converted from them.
  assert.match(sync, /docs\/domain\/<scope>\.md[\s\S]{0,200}\bcode\b/i, "the spec plane pairs its shard with code");
  assert.match(
    sync,
    /prototype artifacts?[\s\S]{0,200}production (?:markup|code)/i,
    "the UI plane pairs prototype artifacts with production markup",
  );
  assert.match(
    sync,
    /design\/docs\/interaction-rules\.md[\s\S]{0,200}design\/docs\/<surface>\.md/,
    "the UX plane pairs the rule ledger with the surface document",
  );
  for (const plane of ["spec", "ux", "ui"]) {
    assert.match(sync, new RegExp(`\\b${plane}\\b`, "i"), `the owner names the ${plane} plane`);
  }
  for (const verdict of ["aligned", "design-ahead", "code-ahead", "conflict"]) {
    assert.match(sync, new RegExp(`\`${verdict}\``), `the owner names the ${verdict} verdict`);
  }

  // Each direction has exactly one existing owner able to write that side, so naming them
  // removes the inversion a single generic "sync" transition would allow.
  assert.match(sync, /`design-ahead`[\s\S]{0,200}`gsd-brainstorming`/, "design-ahead converts into production");
  assert.match(sync, /`code-ahead`[\s\S]{0,240}`gsd-prototyping`/, "code-ahead back-ports into the prototype");
  assert.match(sync, /back-port[\s\S]{0,120}(?:re-lock|lock again)/i);
  assert.match(sync, /`conflict`[\s\S]{0,200}ask/i, "a conflicting plane asks the user rather than picking a winner");

  // The audit is read-only: it is the one owner that inspects both sides, so writing either
  // would make it a second writer for artifacts their owners already own.
  assert.match(sync, /writes no[\s\S]{0,160}(?:production|`design\/`)/i);
  assert.match(sync, /validate-design-map/);
  assert.match(sync, /Role: owner/);

  // Selection is what makes the owner reachable: without a bootstrap rule the catalog row
  // exists but no prompt routes to it.
  const bootstrap = read("skills/gsd/SKILL.md");
  const selectionLine = bootstrap.split("\n").find((line) => /gsd-design-sync/.test(line));
  assert.ok(selectionLine, "the bootstrap names the drift owner");
  assert.match(
    selectionLine,
    /drift|diverge/i,
    "the same selection line binds the drift owner to design/production drift intent",
  );

  // The shard records the same production semantics, and the root contract states the
  // back-port direction so a future agent never treats code-ahead as the prototype's truth.
  const domain = read("docs/domain/gsd.md");
  assert.match(domain, /eleven skills/i, "the shard records the eleven-skill catalog");
  assert.match(domain, /\| Drift Audit \|/, "the shard defines the Drift Audit term");
  const driftInvariant = domain.split("\n").find((line) => /^- Design and production drift/.test(line));
  assert.ok(driftInvariant, "the shard records a drift invariant");
  assert.match(driftInvariant, /spec[\s\S]{0,120}ux[\s\S]{0,120}ui/i);
  assert.match(driftInvariant, /never (?:edits|writes)/i);
  assert.match(read("AGENTS.md"), /back-port[\s\S]{0,200}re-lock/i, "the root contract states the back-port direction");
  assert.match(read("AGENTS.md"), /production paths that surface governs/i);
});

test("the drift audit cross-checks the declared conversion state", () => {
  // The declaration is deterministic only as grammar: the validator proves a token exists and
  // that `converted` carries claims, never that production actually matches. The audit is the
  // only place both sides are read, so it is where a wrong declaration becomes visible — as
  // evidence a human weighs, not as a machine verdict.
  const sync = read("skills/gsd-design-sync/SKILL.md");

  assert.match(
    sync,
    /`pending`[\s\S]{0,200}(?:queue|owe)/i,
    "the queue is the validator's pending count, not a list the audit maintains",
  );
  assert.match(
    sync,
    /validate-design-map[\s\S]{0,400}`pending`/,
    "the pending count comes from the same validator run the audit already makes",
  );
  // Both contradiction shapes must be named, and both are `ui`-plane readings: the declaration
  // is about converted markup, so a generic verdict mention would pass while auditing nothing
  // that can contradict it. Only reporting the `converted`-but-drifted case would also leave a
  // surface silently claiming debt it no longer owes.
  assert.match(
    sync,
    /`converted`[\s\S]{0,200}`ui`[\s\S]{0,120}`design-ahead`/,
    "a converted surface whose ui plane reads design-ahead is evidence of a wrong declaration",
  );
  assert.match(
    sync,
    /`pending`[\s\S]{0,200}`ui`[\s\S]{0,120}`aligned`/,
    "a pending surface whose ui plane reads aligned is evidence of a wrong declaration",
  );
  // The boundary is the load-bearing half: calling the cross-check proof would turn a
  // judgment over rendered differences into a guarantee the audit cannot make.
  assert.match(
    sync,
    /(?:claim|evidence)[\s\S]{0,240}(?:not|never|rather than)[\s\S]{0,80}(?:deterministic|proof|proves)/i,
    "the declaration is an auditable claim rather than deterministic proof",
  );

  const domain = read("docs/domain/gsd.md");
  const driftInvariant = domain.split("\n").find((line) => /^- Design and production drift/.test(line));
  assert.ok(driftInvariant, "the shard records the drift invariant");
  assert.match(driftInvariant, /`pending`/, "the invariant records the queue source");
  assert.match(
    driftInvariant,
    /(?:claim|evidence)/i,
    "the invariant records the declaration as a claim the audit can contradict",
  );

  const policy = domain.split(/^### P-gsd-16: /m)[1]?.split(/^### /m)[0];
  assert.ok(policy, "the shard records the drift-audit policy");
  assert.match(policy, /`pending`/, "the policy names the queue the audit consumes");
  assert.match(
    policy,
    /(?:auditable claim|claim rather than)/i,
    "the policy records the auditable-claim boundary",
  );
});

// invocation and the fields it returns, or an owner has to read the CLI source to use it.
test("AC-4: canonical authority documents the design-map command and its output", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const validatorSection = reference.match(
    /### Executable contract validator\n[\s\S]*?(?=\n### Approval binding)/,
  );
  assert.ok(validatorSection, "REFERENCE must keep its executable-validator section");
  const readmeSection = read("README.md").match(
    /## Plan contract validation\n[\s\S]*?(?=\n## Verification)/,
  );
  assert.ok(readmeSection, "README must keep its plan-contract section");
  const invocation = /"<GSD_ROOT>\/tools\/gsd-contract\.mjs" validate-design-map --path design\/docs/;
  for (const [label, body] of [
    ["reference", validatorSection[0]],
    ["readme", readmeSection[0]],
  ]) {
    assert.match(body, invocation, `${label} carries the design-map invocation`);
    for (const field of ["surfaces", "claims", "pending"]) {
      assert.match(body, new RegExp(`\`${field}\``), `${label} names the ${field} field`);
    }
  }
});

// A harness that injects "parallelize this" reaches the session as authority-looking text. The
// bootstrap forbade child lifecycle work but never said what an injected directive does to
// ownership, and never said that bounded read-only research is still allowed.

test("prototype selection routes on explicit surface intent, never an inferred one", () => {
  // "New or changed user-facing surface work" made every feature with an eventual UI a
  // prototype candidate, so a prompt naming no surface split two models between the
  // prototype owner and requirements convergence. The discriminator is what the prompt
  // says, not what a feature probably renders later.
  const fixtures = JSON.parse(read("test/eval/fixtures.json"));
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

  // The generic-feature fixture is the exact routing case this rule has to settle, so it is
  // pinned here rather than left to the slow activation eval alone.
  const generic = byId.get("new-feature");
  assert.ok(generic, "a fixture pins a generic feature request");
  assert.equal(generic.expectedPrimarySkill, "gsd-brainstorming");
  assert.equal(generic.expectedAction, "load");
  assert.doesNotMatch(
    generic.prompt,
    /\b(?:screen|page|surface|ui|view|dialog|modal)\b/i,
    "the generic fixture names no surface, so only an inferred one could route it to a prototype",
  );
  const surface = byId.get("new-surface-prototype");
  assert.ok(surface, "a fixture pins an explicit surface request");
  assert.equal(surface.expectedPrimarySkill, "gsd-prototyping");
  assert.match(
    surface.prompt,
    /\b(?:screen|page|surface|ui|view)\b/i,
    "the prototype fixture names its surface explicitly",
  );

  // The bootstrap rule must state the boundary both ways: explicit intent selects, and a
  // generic request converges first. Stating only the positive half is what let a model
  // infer a surface behind any feature.
  const bootstrap = read("skills/gsd/SKILL.md");
  const rule = bootstrap.split("\n").find((line) => /gsd-prototyping/.test(line) && /surface/i.test(line));
  assert.ok(rule, "the bootstrap carries a prototype selection rule");
  assert.match(rule, /explicit/i, "selection keys on explicit intent");
  assert.match(rule, /\bscreen\b|\bUI\b|\bsurface\b/, "the rule names the intent it keys on");
  assert.match(
    rule,
    /(?:generic|otherwise|every other)[\s\S]{0,160}`gsd-brainstorming`/,
    "a generic feature request converges through requirements instead",
  );
  assert.doesNotMatch(rule, /OAuth|login|checkout/i, "the rule names no product-specific example");

  // The canonical row is dispatch authority, so a bootstrap-only fix would leave the
  // catalog excluding just backend-only work while the rule excludes far more.
  const reference = read("skills/gsd/REFERENCE.md");
  const row = reference.split("\n").find((line) => /^\| `gsd-prototyping` \|/.test(line));
  assert.ok(row, "the canonical matrix carries the prototyping row");
  const doNotLoad = row.split("|")[5];
  assert.match(
    doNotLoad,
    /(?:generic|no explicit|inferred)/i,
    "the canonical do-not-load excludes more than backend-only work",
  );
  const owner = read("skills/gsd-prototyping/SKILL.md");
  const restated = owner.match(/^- Do-not-load: (.+)$/m);
  assert.ok(restated, "the owner restates its do-not-load");
  assert.match(restated[1], /(?:generic|no explicit|inferred)/i, "the restatement carries the same boundary");

  // The injected payload is the master rules plus each visible frontmatter description, so
  // the description is a real routing input, not metadata: a rule-only fix leaves the
  // catalog itself still advertising any user-facing surface behavior.
  const injected = JSON.parse(owner.match(/^description: (.+)$/m)[1]);
  assert.match(injected, /explicit/i, "the injected description keys on explicit intent");
  assert.doesNotMatch(
    injected,
    /new or changed user-facing surface behavior/i,
    "the description no longer advertises any user-facing surface behavior",
  );

  // The shard records shipped routing semantics, so the boundary belongs in the workflow
  // step and the policy, not only in the skill prose.
  const domain = read("docs/domain/gsd.md");
  const step = domain.split("\n").find((line) => /^1\. Route/.test(line));
  assert.ok(step, "the shard records the prototype-first routing step");
  assert.match(step, /explicit/i, "the routing step keys on explicit surface intent");
  const policy = domain.split(/^### P-gsd-15: /m)[1].split(/^### /m)[0];
  assert.match(policy, /explicit/i, "the policy records the explicit-intent boundary");
});

test("design-first is the default order, never a dispatch guard", () => {
  // Design-first is how surface work is sequenced, not a permission check. A user may open
  // design work from the repository root, change an already-locked surface, or describe a
  // different order; each of those is answered with one question at most, never a refusal.
  const bootstrap = read("skills/gsd/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const prototyping = read("skills/gsd-prototyping/SKILL.md");
  const agents = read("AGENTS.md");
  const domain = read("docs/domain/gsd.md");

  // The explicit-intent routing boundary is unchanged: a default order is not a licence to
  // start inferring surfaces behind generic prompts again.
  const rule = bootstrap.split("\n").find((line) => /gsd-prototyping/.test(line) && /surface/i.test(line));
  assert.ok(rule, "the bootstrap carries a prototype selection rule");
  assert.match(rule, /explicit/i, "explicit surface intent still selects the prototype owner");
  assert.match(
    rule,
    /(?:generic|otherwise|every other)[\s\S]{0,160}`gsd-brainstorming`/,
    "a generic feature request still converges through requirements",
  );

  // Excluding a surface an existing prototype already locks contradicts the mode that
  // exists to change exactly that surface, so no dispatch text may carry it.
  const row = reference.split("\n").find((line) => /^\| `gsd-prototyping` \|/.test(line));
  assert.ok(row, "the canonical matrix carries the prototyping row");
  assert.doesNotMatch(
    row.split("|")[5],
    /already locked/i,
    "changing a locked surface is the Existing surface change mode, not a do-not-load case",
  );
  const restated = prototyping.match(/^- Do-not-load: (.+)$/m);
  assert.ok(restated, "the owner restates its do-not-load");
  assert.doesNotMatch(restated[1], /already locked/i, "the restatement carries no already-locked exclusion");
  const modes = prototyping.split(/^## Invocation modes$/m)[1].split(/^## /m)[0];
  assert.match(modes, /^\| Existing surface change \|/m, "changing a locked surface keeps its own mode");

  // The canonical matrix is dispatch authority, so the ask-instead-of-block default order
  // belongs there too: a root-contract-only statement would leave the table implying a gate.
  const matrix = reference.split(/^## Visible skill mandatory-use matrix$/m)[1].split(/^## /m)[0];
  assert.match(matrix, /default order/i, "the canonical matrix records design-first as the default order");
  assert.match(
    matrix,
    /(?:different|differently|unclear)[\s\S]{0,240}one question/i,
    "the canonical matrix asks one question instead of blocking a different order",
  );

  // The order is a default with a one-question deviation, stated where routing is decided
  // and in the root contract a future agent reads on its own.
  assert.match(rule, /default/i, "the selection rule states the order as a default");
  assert.match(
    rule,
    /(?:different|differently|unclear)[\s\S]{0,200}one question/i,
    "a differently described or unclear order asks one question",
  );
  assert.match(agents, /default order/i, "the root contract states design-first as the default order");
  assert.match(
    agents,
    /(?:different|differently|unclear)[\s\S]{0,240}one question/i,
    "the root contract asks one question instead of guarding the order",
  );
  assert.doesNotMatch(
    agents,
    /never let production markup and styling drift ahead/i,
    "an absolute prohibition is a guard, not a default order",
  );
  assert.match(agents, /source of truth[\s\S]{0,200}convert/i, "the prototype is still the surface source of truth");

  // Relaxing the order changes nothing about ownership: the prototype owner still writes no
  // production code and authors no lifecycle artifact.
  assert.match(prototyping, /authors no lifecycle artifact/);
  const produced = [...modes.matchAll(/^\| ([^|]+) \| [^|]+ \| [^|]+ \| ([^|]+) \|/gm)]
    .filter(([, mode]) => mode !== "Mode")
    .map(([, , cell]) => cell);
  assert.equal(produced.length, 3, "the mode table declares what each mode produces");
  for (const cell of produced) {
    assert.doesNotMatch(cell, /production/i, `${cell} produces prototype artifacts only`);
  }

  // The shard records shipped semantics, so the default order and its deviation belong in
  // the routing step and the policy rather than only in skill prose.
  const step = domain.split("\n").find((line) => /^1\. Route/.test(line));
  assert.ok(step, "the shard records the prototype-first routing step");
  assert.match(step, /default/i, "the routing step records the order as a default");
  const policy = domain.split(/^### P-gsd-15: /m)[1].split(/^### /m)[0];
  assert.match(policy, /default order/i, "the policy records the default order");
  assert.match(
    policy,
    /(?:different|differently|unclear)[\s\S]{0,240}one question/i,
    "the policy records the one-question deviation",
  );
});

test("compaction recovery capsule byte identity and drift protection", async () => {

  const reference = read("skills/gsd/REFERENCE.md");
  const match = reference.match(/#### Compaction Recovery Capsule[\s\S]*?```text\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(match, "Failed to locate Compaction Recovery Capsule text block in REFERENCE.md");

  const extractedTemplate = match[1].replace(/\r\n/g, "\n");
  const normalizedTemplate = CAPSULE_TEMPLATE.replace(/\r\n/g, "\n");

  assert.equal(normalizedTemplate, extractedTemplate, "Drift detected: CAPSULE_TEMPLATE does not match REFERENCE.md exactly");

  // Real evidence for AC-10 lifecycle delivery
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  
  const tempDir = mkdtempSync(join(tmpdir(), "omp-gsd-ac10-"));
  const scratchDir = join(tempDir, ".scratch");
  mkdirSync(scratchDir);

  try {
    const featDir = join(scratchDir, "ac-10");
    mkdirSync(featDir);
    writeFileSync(join(featDir, "plan.md"), "plan");
    writeFileSync(join(featDir, "state.toon"), [
      "schema:v2",
      "feature:ac-10",
      "phase:executing",
      "next_action:start/continue task",
      "plan_path:.scratch/ac-10/plan.md",
      "plan_sha256:" + "a".repeat(64),
      "base_ref:main",
      "wip_branch:wip/ac-10",
      "last_green_task:none",
      "last_green_commit:none",
      "reviewer_model:openai-codex/gpt-5.5:high",
      "review_round:none",
      "blocking_fingerprint:none",
      "reviewed_commit:none",
      "progress_status:none",
      "autosync:none",
      "ponytail_level:none",
      "cleanup_preference:none",
      "checkpoint_revision:1",
      ""
    ].join("\n"));

    // Add an overlong otherwise-active directory (>255 UTF-8 bytes) via readdirSync interception
    const fs = nodeFs;
    const realReaddirSync = fs.readdirSync;
    const overlongName = "ac-10-overlong-" + "a".repeat(250);
    fs.readdirSync = function(p, opts) {
      const res = realReaddirSync.call(this, p, opts);
      if (p === scratchDir && opts?.withFileTypes) {
        return [
          ...res,

          {
            name: overlongName,
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false
          }
        ];
      }
      return res;
    };

    try {
      const registeredEvents = {};
      const sentMessages = [];

      const piMock = {
        on: (event, handler) => {
          registeredEvents[event] = handler;
        },
        sendMessage: async (message, options) => {
          sentMessages.push({ message, options });
        }
      };

      const ctxMock = {
        cwd: tempDir
      };

      gsdContextExtension(piMock);

      // Verify events registered
      assert.ok(registeredEvents["session.compacting"]);
      assert.ok(registeredEvents["session_compact"]);

      // Test session.compacting returns context with capsule for ac-10
      const compactResult = await registeredEvents["session.compacting"]({}, ctxMock);
      assert.ok(compactResult.context);
      assert.equal(compactResult.context.length, 1);
      assert.match(compactResult.context[0], /Active GSD features: ac-10/);

      // Test session_compact queues capsule for ac-10
      await registeredEvents["session_compact"]({}, ctxMock);
      assert.equal(sentMessages.length, 1);
      assert.match(sentMessages[0].message, /Active GSD features: ac-10/);
      assert.deepEqual(sentMessages[0].options, { deliverAs: "nextTurn", triggerTurn: false });
    } finally {
      fs.readdirSync = realReaddirSync;
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
