import { test } from "node:test";
import assert from "node:assert/strict";
import { read, skillNames, visibleSkillNames, parseAgentFrontmatter, ROOT } from "./support/skills-fixtures.js";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

test("every GSD skill has complete matching frontmatter", () => {
  for (const name of skillNames()) {
    const skill = read(`skills/${name}/SKILL.md`);
    assert.match(skill, new RegExp(`^---\\nname: ${name}\\n`, "m"), name);
    assert.doesNotMatch(skill, /^triggers:/m, `${name} carries no dead triggers field`);
    assert.match(skill, /^produces: \[.*\]$/m, `${name} produces`);
    assert.match(skill, /^consumes: \[.*\]$/m, `${name} consumes`);
  }
});

// The architecture is thin skills over one canonical REFERENCE, so a canon citation is the
// load-bearing link between them. Three were pinned by hand; nothing caught a renamed or
// deleted heading orphaning the rest, and a skill pointing at canon that no longer says
// anything is how an agent ends up improvising the contract — the base bug's own failure mode.
test("every canon citation in a skill resolves to a REFERENCE heading", () => {
  const headings = new Set(
    [
      ...read("skills/gsd/REFERENCE.md")
        // The packet grammar templates are fenced and contain `## Base`, `## Domain Impact`,
        // and friends, which are plan sections rather than REFERENCE headings.
        .replace(/^```[\s\S]*?^```$/gm, "")
        .matchAll(/^#{2,4}\s+(.+)$/gm),
    ].map((match) => match[1].trim()),
  );
  const byLength = [...headings].sort((a, b) => b.length - a.length);

  // Every heading the skills depend on. A rename or deletion fails here rather than silently
  // orphaning the citation, and the inventory is exact because a prefix match alone would
  // still resolve a narrowed heading.
  const CITED = [
    "Artifact Contract",
    "Base derivation and merge target",
    "Candidate discovery",
    "Canonical Markdown contract",
    "Contextual disclosure templates",
    "Git/base/WIP/scratch mechanics",
    "Packet grammar",
    "Plan amendment",
    "Post-approval pipeline contract",
    "Runtime state contract",
    "Skill derivation from phase and next_action",
  ];
  for (const heading of CITED) {
    assert.ok(headings.has(heading), `REFERENCE no longer defines the cited § ${heading}`);
  }

  // `§` also cites `plan.md` sections, so only citations positioned after the REFERENCE.md
  // link on their line — the documented "see canon" form — are canon citations.
  let checked = 0;
  for (const name of skillNames()) {
    for (const line of read(`skills/${name}/SKILL.md`).split("\n")) {
      const link = line.indexOf("REFERENCE.md");
      if (link < 0) continue;
      for (const match of line.matchAll(/§\s+([A-Z][^.,;:)\n]*)/g)) {
        if (match.index < link) continue;
        const cited = match[1].trim();
        const heading = byLength.find((candidate) => cited === candidate || cited.startsWith(candidate));
        assert.ok(heading, `${name} cites § ${cited}, which matches no REFERENCE heading`);
        assert.ok(CITED.includes(heading), `${name} cites § ${heading}, absent from the inventory`);
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 25, `the canon citation layer must stay covered, only found ${checked}`);
});


test("visible catalog descriptions stay within the injected byte budget", () => {
  // Every visible description is injected once per session, so the sum is a real cost.
  let total = 0;
  for (const name of skillNames()) {
    const skill = read(`skills/${name}/SKILL.md`);
    if (/^hide: true$/m.test(skill)) continue;
    const description = JSON.parse(skill.match(/^description: (.+)$/m)[1]);
    assert.doesNotMatch(description, /^Do not use|\. Do not use for read-only questions/, name);
    total += Buffer.byteLength(description, "utf8");
  }
  assert.ok(total < 1800, `summed visible description bytes must stay under 1800, got ${total}`);

  // AC-6: the renderer byte-accounting spec belongs beside createCapsule, not in
  // agent-facing prose. Input caps stay because the renderer validates against them.
  const reference = read("skills/gsd/REFERENCE.md");
  assert.doesNotMatch(reference, /\d+\s*\+\s*\d+\s*\+\s*\d+\s*\+\s*\d+\s*=/);
  assert.doesNotMatch(reference, /UTF-8 bytes\)/);
  assert.doesNotMatch(reference, /Byte-Budget Limits|Caps are a maximum/);
  assert.match(reference, /A rendered capsule over 4000 bytes fails closed/);
  assert.match(read("extensions/gsd-context.js"), /1931|2058/);
  for (const name of skillNames()) {
    assert.doesNotMatch(read(`skills/${name}/SKILL.md`), /^triggers:/m, `${name} triggers`);
  }
});

test("agent-facing skill prose keeps rule lines readable", () => {
  // AC-7: a single line must not stack many distinct rules. Bullets cost the same
  // bytes but let an agent apply one rule at a time.
  const MAX_LINE_CHARS = 600;
  const offenders = [];
  const markdown = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`);
      else if (entry.name.endsWith(".md")) markdown.push(`${dir}/${entry.name}`);
    }
  };
  walk("skills");
  assert.ok(markdown.length >= skillNames().length, "every skill contributes at least one markdown file");
  for (const file of markdown) {
    read(file).split("\n").forEach((line, index) => {
      if (line.length > MAX_LINE_CHARS) offenders.push(`${file}:${index + 1} (${line.length})`);
    });
  }
  assert.deepEqual(offenders, []);
});

test("all skill references resolve to installed skills", () => {
  const names = new Set(skillNames());
  const unresolved = [];
  for (const name of names) {
    const skill = read(`skills/${name}/SKILL.md`);
    for (const match of skill.matchAll(/`(gsd-[a-z-]+)`|(?<![a-z0-9/])\/(gsd-[a-z-]+)/g)) {
      const target = match[1] ?? match[2];
      if (!names.has(target)) unresolved.push(`${name} -> ${target}`);
    }
  }
  assert.deepEqual(unresolved, []);
});

test("core pipeline skills use Markdown authority and preserve runtime TOON", () => {
  const master = read("skills/gsd/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const tdd = read("skills/gsd-tdd/SKILL.md");

  assert.match(master, /gsd-brainstorming` → `gsd-to-plan` → approval/);
  assert.match(master, /stale non-authoritative state/);
  assert.match(reference, /Canonical Markdown contract/);
  assert.match(reference, /SHA-256/);
  assert.match(reference, /Runtime records report progress and bind source bytes/);
  for (const skill of [planner, execution, verify, handoff, tdd]) {
    assert.match(skill, /plan\.md|Markdown/i);
    assert.match(skill, /hash|SHA-256|binding/i);
  }
  assert.match(execution, /amend `\.scratch\/<feature>\/plan\.md` under § Plan amendment, revalidate, rebind/i);
  assert.match(handoff, /writes atomically to `\.scratch\/<feature>\/state\.toon`/i);
  assert.match(tdd, /focused test seam from the approved Markdown plan/);
  assert.match(tdd, /consume the exact validated task slice and relevant pinned sections/);
  assert.doesNotMatch(tdd, /proposal\.toon|spec\.toon|plan\.toon/);
  assert.match(reference, /Quick-fix plan exception/);
  assert.match(master, /Quick-fix plan exception/);
  assert.match(verify, /malformed binding[\s\S]*red deterministic check blocks/i);
  assert.match(planner, /atomically write canonical `schema:v4` `state\.toon`/);
  assert.doesNotMatch(execution, /^produces: \[[^\n]*plan\.md/m);
  assert.match(execution, /ledger byte-for-byte read-only throughout the per-task loop/);
  assert.match(verify, /final milestone deletes the ledger/);
  assert.match(handoff, /Malformed, duplicate, or invalid known values fail closed/i);
  assert.match(handoff, /discover active candidates/i);
  assert.match(planner, /fresh approval after Spec escalation supersedes older binding state/);
  assert.match(execution, /Reject legacy proposal\/spec\/design files, numbered handoffs/);
  assert.match(handoff, /Execution resume \| `state\.toon`; `plan\.md`/);
  assert.match(reference, /session owner rebuilds complete task or terminal slices from canonical plan\/state\/Git/i);
  assert.match(reference, /# Milestones[\s\S]*\| ID \| Slug \| Goal \| Status \|/);
  assert.match(reference, /status is exactly `pending` or `done`/);
  assert.match(master, /all-`done`, fail closed/);
});

test("legacy terminal prose matches discovery and explicit-read behavior", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  const domain = read("docs/domain/gsd.md");

  assert.match(reference, /Exact active `schema:v1`, `schema:v2`, and `schema:v3` records migrate only after full validation/);
  assert.match(reference, /Exact v1\/v2 `completed-retained` records[\s\S]{0,220}candidate discovery[\s\S]{0,180}explicit `readStateFile` rejects[\s\S]{0,160}Retained v3 remains the sole terminal case/i);
  assert.match(handoff, /v1\/v2 terminal records fail closed unchanged[\s\S]{0,180}v3 `completed-retained` compatibility case[\s\S]{0,220}candidate discovery[\s\S]{0,180}explicit read validates and migrates/i);
  assert.match(domain, /retained v1\/v2 terminal records remain inert[\s\S]{0,180}fail closed on explicit read[\s\S]{0,180}retained v3 migrates only on an explicit validated read/i);
});

test("master and visible skills declare automatic lazy activation", () => {
  const master = read("skills/gsd/SKILL.md");
  assert.match(master, /^description: "Session bootstrap injected by the GSD OMP extension;/m);
  assert.match(master, /^hide: true$/m);
  assert.match(master, /choose exactly one primary process owner/i);
  assert.match(master, /same-session continuity/i);
  assert.match(master, /no matching skill.*ordinary direct behavior/is);
  const routeLabel = new RegExp(`\\b${"Rou" + "te"} (?:[0-6N]|meta)\\b`);
  const oldEngine = new RegExp(`Smart ${"Routi" + "ng"} Engine`);
  assert.doesNotMatch(master, routeLabel);
  assert.doesNotMatch(master, oldEngine);
  assert.match(master, /first action must be a `read` tool call/);

  const descriptions = new Set();
  const standaloneCommand = new RegExp(`(?:^|[\`"'(\\s])/${"gsd"}(?:\\s|\`|$)`, "m");
  for (const name of skillNames().filter((skillName) => skillName !== "gsd")) {
    const skill = read(`skills/${name}/SKILL.md`);
    const line = skill.match(/^description: (.+)$/m)?.[1];
    assert.ok(line, `${name} description`);
    assert.equal(line.startsWith('"') && line.endsWith('"'), true, `${name} JSON-quoted description`);
    const description = JSON.parse(line);
    assert.equal(typeof description, "string", `${name} description string`);
    assert.equal(descriptions.has(description), false, `${name} unique description`);
    descriptions.add(description);
    assert.doesNotMatch(skill, new RegExp(`${"routed"} via /${"gsd"}|${routeLabel.source}`), `${name} legacy activation`);
    assert.doesNotMatch(skill, standaloneCommand, `${name} standalone command syntax`);
  }

  assert.match(read("skills/gsd-domain-modeling/SKILL.md"), /## Domain lifecycle[\s\S]*## Markdown contracts/);
  assert.match(read("skills/gsd-codebase-architecture/SKILL.md"), /## Vocabulary[\s\S]*## Domain-aligned architecture[\s\S]*## Seam discipline/);
});

test("AC-1: Ponytail is hidden level-free context", () => {
  const ponytail = read("skills/gsd-ponytail/SKILL.md");
  const frontmatter = parseAgentFrontmatter(ponytail, "gsd-ponytail");
  assert.equal(frontmatter.hide, true);
  assert.match(ponytail, /smallest complete path/i);
  assert.match(ponytail, /enter the normal GSD lifecycle/i);
  assert.doesNotMatch(ponytail, /ponytail_level|Invocation modes|Role:\s*(?:owner|helper)|explicit_level|auto_scope|lite\/full\/ultra/i);
});

test("AC-2 repair: task repair stays session-owner-inline without terminal verification", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(execution, /First checkpoint `next_action=start\/continue task`/);
  assert.match(execution, /repair source-first[\s\S]{0,160}rerun only checks invalidated by the repair/);
  assert.match(execution, /Load no terminal verifier until every task is green/);
  assert.match(reference, /`start\/continue task`[\s\S]{0,120}gsd-executing-plans[\s\S]{0,80}gsd-handoff[\s\S]{0,80}gsd-tdd/);
  assert.doesNotMatch(execution, /run task review\/repair|gsdReviewer|gsd-reviewer/);
});

test("AC-3: Visible skill dispatch is deterministic", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const visible = visibleSkillNames().filter((name) => name !== "gsd").sort();
  assert.equal(visible.length, 9, "exactly 9 visible GSD skills");

  const section = reference.match(
    /## Visible skill mandatory-use matrix\n+([\s\S]*?)(?:\n## |\n### |\n*$)/,
  );
  assert.ok(section, "REFERENCE must define ## Visible skill mandatory-use matrix");
  const body = section[1];
  assert.match(
    body,
    /^\| Skill \| Role \| Intent \| Prerequisites \| Do-not-load \| Transition \| Helper-when \|\n\| --- \| --- \| --- \| --- \| --- \| --- \| --- \|/m,
  );

  const rowRe =
    /^\| `(gsd-[a-z0-9-]+)` \| (owner|helper) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm;
  const rows = [...body.matchAll(rowRe)].map((m) => ({
    skill: m[1],
    role: m[2],
    intent: m[3].trim(),
    prerequisites: m[4].trim(),
    doNotLoad: m[5].trim(),
    transition: m[6].trim(),
    helperWhen: m[7].trim(),
  }));

  assert.equal(rows.length, 9, "matrix must have exactly 9 rows");
  assert.deepEqual(rows.map((row) => row.skill).sort(), visible);
  assert.equal(new Set(rows.map((row) => row.skill)).size, 9, "no multiply mapped skill");

  const vague = /\b(as needed|if useful|when appropriate|sometimes|maybe|etc\.?|TBD|TODO)\b/i;
  // Only the Do-not-load and Transition labels were pinned, so a skill could restate another
  // skill's guard or understate its own exit: `gsd-diagnosing-bugs` carried brainstorming's
  // "known single-spot quick fix" while its row forbids a located failure, and `gsd-verify`
  // claimed only the planned green path squashes. Connectives and plural inflection
  // paraphrase freely; every content word of the canonical cell must survive.
  const CONNECTIVES = new Set(["still", "used", "with", "work", "from", "that", "this", "when", "only", "into"]);
  const stem = (word) => (word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
  const contentWords = (text) =>
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4 && !CONNECTIVES.has(word))
      .map(stem);
  const helpers = [];
  for (const row of rows) {
    assert.ok(row.intent && row.intent !== "—" && row.intent.length > 8, `${row.skill} exact intent`);
    assert.ok(row.prerequisites && row.prerequisites !== "", `${row.skill} prerequisites`);
    assert.ok(row.doNotLoad && row.doNotLoad !== "", `${row.skill} do-not-load`);
    assert.ok(row.transition && row.transition !== "—" && row.transition.length > 3, `${row.skill} transition`);
    for (const field of [row.intent, row.prerequisites, row.doNotLoad, row.transition]) {
      assert.doesNotMatch(field, vague, `${row.skill} field not vague`);
    }
    if (row.role === "helper") {
      helpers.push(row.skill);
      assert.notEqual(row.helperWhen, "—", `${row.skill} helper-when required`);
      assert.match(row.helperWhen, /must load|required when|active if and only if|load when/i);
    } else {
      assert.equal(row.helperWhen, "—", `${row.skill} owner has empty helper-when marker`);
    }

    const skillMd = read(`skills/${row.skill}/SKILL.md`);
    assert.match(skillMd, /Visible skill mandatory-use matrix/);
    assert.match(skillMd, new RegExp(`Role:\\s*${row.role}`));
    const pinRestatement = (label, canonical) => {
      const line = skillMd.match(new RegExp(`^- ${label}: (.+)$`, "m"));
      assert.ok(line, `${row.skill} restates ${label}`);
      const restated = new Set(contentWords(line[1]));
      const dropped = contentWords(canonical).filter((word) => !restated.has(word));
      assert.deepEqual(dropped, [], `${row.skill} drops canonical ${label} terms: ${dropped.join(", ")}`);
    };
    pinRestatement("Do-not-load", row.doNotLoad);
    pinRestatement("Transition", row.transition);
    if (row.role === "helper") pinRestatement("Helper-when", row.helperWhen);
  }

  assert.deepEqual(helpers.sort(), ["gsd-domain-modeling", "gsd-tdd"]);
  assert.doesNotMatch(body, /gsd-ponytail|gsd-codebase-design|gsd-improve-codebase-architecture/);
  assert.doesNotMatch(body, vague);
});

test("AC-4: Concision preserves semantic parity", () => {
  const MAX_VISIBLE_WORDS = 11000;
  const MAX_BOOTSTRAP_WORDS = 1200;
  const MAX_REFERENCE_WORDS = 5600;
  const wordCount = (body) => body.trim().split(/\s+/).filter(Boolean).length;
  const visible = visibleSkillNames().filter((name) => name !== "gsd").sort();
  assert.equal(visible.length, 9);
  const total = visible.reduce(
    (count, name) => count + wordCount(read(`skills/${name}/SKILL.md`)),
    0,
  );
  assert.ok(total <= MAX_VISIBLE_WORDS, `${total} must not exceed ${MAX_VISIBLE_WORDS}`);
  const bootstrapWords = wordCount(read("skills/gsd/SKILL.md"));
  const referenceWords = wordCount(read("skills/gsd/REFERENCE.md"));
  assert.ok(bootstrapWords <= MAX_BOOTSTRAP_WORDS, `${bootstrapWords} must not exceed ${MAX_BOOTSTRAP_WORDS}`);
  assert.ok(referenceWords <= MAX_REFERENCE_WORDS, `${referenceWords} must not exceed ${MAX_REFERENCE_WORDS}`);

  const reference = read("skills/gsd/REFERENCE.md");
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  const tdd = read("skills/gsd-tdd/SKILL.md");
  const verify = read("skills/gsd-verify/SKILL.md");
  const planner = read("skills/gsd-to-plan/SKILL.md");
  const handoff = read("skills/gsd-handoff/SKILL.md");
  assert.match(planner, /REFERENCE\.md[^.\n]*§ Packet grammar/);
  assert.match(handoff, /REFERENCE\.md[^.\n]*§ Runtime state contract/);
  assert.match(verify, /REFERENCE\.md[^.\n]*§ Post-approval pipeline contract/);
  assert.doesNotMatch(planner, /```md\n# Plan/);
  assert.doesNotMatch(handoff, /schema:v4\nfeature:/);
  assert.match(reference, /### Fast TDD and task-loop constraints/);
  assert.match(reference, /deterministic cumulative conformance/);
  // The validator owns the region between the title and the first section, so the grammar
  // section must say so: silent preamble tolerance was the gap that made them disagree.
  assert.match(reference, /any line between the title and its first section/);
  assert.match(execution, /Every observable task loads `gsd-tdd`/);
  assert.match(tdd, /RED before implementation/);
  assert.match(tdd, /GREEN after implementation/);
  assert.match(verify, /Deferred Slow E2E suite only after current-commit conformance/);
  for (const name of visible) {
    assert.match(read(`skills/${name}/SKILL.md`), /## Dispatch contract/);
  }
});

test("AC-4 repair: session-owner inline task repair forbids terminal re-entry", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(execution, /implements or repairs the task inline/);
  assert.match(execution, /red focused check[\s\S]{0,180}bounded inline repair/i);
  assert.match(execution, /rerun only checks invalidated by the repair/);
  assert.match(execution, /Load no terminal verifier until every task is green/);
  assert.doesNotMatch(execution, /submit for re-review|per-task verdict|gsdReviewer/);
});

test("AC-4 repair: ponytail is hidden and absent from runtime dispatch", () => {
  const reference = read("skills/gsd/REFERENCE.md");
  const ponytail = read("skills/gsd-ponytail/SKILL.md");
  assert.equal(parseAgentFrontmatter(ponytail, "gsd-ponytail").hide, true);
  assert.doesNotMatch(reference, /`gsd-ponytail`/);
  assert.doesNotMatch(ponytail, /Visible skill mandatory-use matrix|Helper-when:|ponytail_level/);
});

test("AC-4 repair: ponytail carries no modes or persisted preference", () => {
  const ponytail = read("skills/gsd-ponytail/SKILL.md");
  const reference = read("skills/gsd/REFERENCE.md");
  assert.doesNotMatch(ponytail, /## Invocation modes|explicit_level|auto_scope|ponytail_level|lite\/full\/ultra/i);
  const currentStateBlock = reference.match(/```toon\nschema:v4\n[\s\S]*?\n```/);
  assert.ok(currentStateBlock);
  assert.doesNotMatch(currentStateBlock[0], /ponytail/i);
});

test("AC-4 repair: domain-modeling exact production schema", () => {
  const domain = read("skills/gsd-domain-modeling/SKILL.md");
  assert.match(domain, /## Markdown contracts/);
  assert.match(domain, /# Domain Model/);
  assert.match(domain, /## Scopes/);
  assert.match(domain, /\| Scope \| File \| Purpose \|/);
  assert.match(domain, /# Domain Scope/);
  for (const heading of [
    "Purpose and responsibilities",
    "Terms",
    "Actors",
    "Invariants",
    "Workflows and state transitions",
    "Commands, events, and outcomes",
    "Context relationships",
    "Domain policies",
  ]) {
    assert.match(domain, new RegExp(`## ${heading}`));
  }
  assert.doesNotMatch(domain, /^## Decisions$/m);
  assert.match(domain, /current production behavior/i);
  assert.match(domain, /sole writer/i);
  assert.match(domain, /orphan shard, or any other partial directory fails closed/);
  assert.match(domain, /## Domain lifecycle/);
});

test("AC-4 repair: unified architecture vocabulary and deepening", () => {
  const skill = read("skills/gsd-codebase-architecture/SKILL.md");
  assert.match(skill, /## Vocabulary/);
  assert.match(skill, /deep module|Deep module/i);
  assert.match(skill, /## Domain-aligned architecture/);
  assert.match(skill, /## Seam discipline/);
  assert.match(skill, /DESIGN-IT-TWICE\.md/);
  assert.match(skill, /information hiding|complexity hidden/i);
  assert.match(skill, /Role:\s*owner/);
});

test("AC-4 repair: diagnosing-bugs red-capable flow", () => {
  const skill = read("skills/gsd-diagnosing-bugs/SKILL.md");
  assert.match(skill, /## Phase 1 — Build a feedback loop/);
  assert.match(skill, /red-capable|RED-capable|red capable/i);
  assert.match(skill, /## Phase 2 — Reproduce \+ minimize|## Phase 2 — Reproduce/);
  assert.match(skill, /## Phase 3 — Hypothesize/);
  assert.match(skill, /3–5 ranked hypotheses|3-5 ranked hypotheses|ranked hypotheses/i);
  assert.match(skill, /## Phase 4 — Instrument/);
  assert.match(skill, /## Phase 5 — Fix \+ regression test|## Phase 5 — Fix/);
  assert.match(skill, /## Phase 6 — Cleanup \+ post-mortem|## Phase 6 — Cleanup/);
  assert.match(skill, /regression test/);
  assert.match(skill, /\[DEBUG-/);
  assert.match(skill, /gsd-codebase-architecture/);
  // disclosure pair for AC-4 cross-ref
  assert.match(skill, /^[ ]{0,3}## Contextual disclosure.*\[\.\.\/gsd\/REFERENCE\.md\]\(\.\.\/gsd\/REFERENCE\.md\).*§ Contextual disclosure templates.*\r?\n[ ]{0,3}```/m);
});

test("AC-4 repair: unified architecture candidates selection gate", () => {
  const skill = read("skills/gsd-codebase-architecture/SKILL.md");
  assert.match(skill, /## Explore and design/);
  assert.match(skill, /## Candidate contract/);
  assert.match(skill, /ask the user to select one/i);
  assert.match(skill, /present ranked candidates/i);
  assert.match(skill, /Post-diagnosis architecture/);
});

test("AC-4 repair: brainstorming modes harvest and stress-test", () => {
  const skill = read("skills/gsd-brainstorming/SKILL.md");
  const modes = skill.match(/## Invocation modes\n+([\s\S]*?)(?:\n## |\n*$)/);
  assert.ok(modes);
  const body = modes[1];
  assert.match(body, /[Ss]tress-?test|Discovery and stress-test/);
  assert.match(skill, /## Discovery and stress-test/);
  assert.match(skill, /[Ss]pec-?gap|Spec gap|spec-gap return/i);
  assert.match(skill, /architecture candidate|Architecture-candidate|architecture-candidate/i);
  assert.match(skill, /## Conservative context harvest|context harvest/i);
  assert.match(skill, /## Large-feature decomposition|milestone/i);
  assert.match(skill, /## Acceptance and interface convergence/);
  assert.match(skill, /## Convergence transition|load `gsd-to-plan`/);
  assert.match(skill, /Role:\s*owner/);
});

test("AC-4 repair: unified architecture Adapter and Leverage definitions", () => {
  const skill = read("skills/gsd-codebase-architecture/SKILL.md");
  assert.match(skill, /\*\*Adapter\*\* — concrete implementation occupying a seam; a role/);
  assert.match(skill, /\*\*Leverage\*\* — capability reused across callers and tests per unit of interface learned/);
  assert.doesNotMatch(skill, /\*\*Adapter\*\* — thin translation at a boundary without leaking internals/);
});

test("AC-4 repair: diagnosing no-red-loop blocker vs access ask", () => {
  const skill = read("skills/gsd-diagnosing-bugs/SKILL.md");
  // No red-capable loop is mode-branched: standalone may ask once; execution-blocker is Blocker/pause
  assert.match(skill, /No red-capable command → no Phase 2/i);
  assert.match(
    skill,
    /In standalone diagnosis[\s\S]{0,200}STOP and ask one focused question[\s\S]{0,120}(?:environment )?access|captured artifact|temporary instrumentation/i,
  );
  assert.match(
    skill,
    /In Execution-blocker diagnosis[\s\S]{0,120}ask no question[\s\S]{0,200}canonical post-approval Blocker stop|Blocker stop/i,
  );
  assert.match(skill, /return the blocker evidence to `gsd-executing-plans`/i);
  // Must not universally ask for access regardless of mode
  assert.doesNotMatch(
    skill,
    /If you cannot build one, STOP and ask for env access\/captured artifact\/temp instrumentation permission\./,
  );
});

test("AC-4 repair: existing domain index suppresses broad bootstrap", () => {
  const brainstorm = read("skills/gsd-brainstorming/SKILL.md");
  const architecture = read("skills/gsd-codebase-architecture/SKILL.md");
  const modeler = read("skills/gsd-domain-modeling/SKILL.md");
  for (const body of [brainstorm, architecture, modeler]) {
    assert.match(body, /When `docs\/domain\/index\.md` exists[\s\S]{0,240}(?:do not|never)[\s\S]{0,80}(?:offer|suggest)[\s\S]{0,80}broad/i);
  }
  assert.match(modeler, /When `docs\/domain\/index\.md` is absent[\s\S]{0,280}broad/i);
});

test("AC-4 repair: unified architecture implementation and seam principles", () => {
  const skill = read("skills/gsd-codebase-architecture/SKILL.md");
  assert.match(skill, /\*\*Implementation\*\* — behavior hidden inside a module/);
  assert.match(skill, /\*\*Depth\*\* — behavior and complexity hidden per unit of caller knowledge/);
  assert.match(skill, /deletion test/i);
  assert.match(skill, /One production adapter alone is a hypothetical seam/i);
  assert.match(skill, /Keep internal test seams private/i);
  assert.match(skill, /Tests observe the public interface and survive internal refactors/i);
});

test("AC-4 repair: session-owner task repair does not enter terminal verification", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(execution, /First checkpoint `next_action=start\/continue task`/);
  assert.match(execution, /rerun only checks invalidated by the repair/);
  assert.match(execution, /Load no terminal verifier until every task is green/);
  assert.match(execution, /enter terminal verification\/repair/);
  assert.doesNotMatch(execution, /re-enters review|re-enter review|gsdReviewer/);
});

test("AC-4 repair: architecture Explore friction and domain boundaries", () => {
  const skill = read("skills/gsd-codebase-architecture/SKILL.md");
  assert.match(skill, /## Explore and design/);
  assert.match(skill, /duplicated policy, concepts bouncing across shallow modules, leaky seams, wrong dependency direction/i);
  assert.match(skill, /bounded context is a semantic and language boundary/i);
  assert.match(skill, /Inside approved execution[\s\S]{0,260}Spec-escalation blocker/i);
});

test("AC-4 repair: architecture targetless guard and framework discipline", () => {
  const skill = read("skills/gsd-codebase-architecture/SKILL.md");
  assert.match(skill, /Invocation guard/i);
  assert.match(skill, /ask one focused target question; never survey the repository to invent a target/i);
  assert.match(skill, /Keep domain\/application policy independent/i);
  assert.match(skill, /Do not wrap stable framework APIs merely to appear framework-neutral/i);
});

test("AC-4 repair: architecture candidate enums exact", () => {
  const skill = read("skills/gsd-codebase-architecture/SKILL.md");
  assert.match(skill, /recommendation strength: `Strong`, `Worth exploring`, or `Speculative`/i);
  assert.match(skill, /`in-process`, `local-substitutable`, `remote but owned`, or `true external`/i);
});

test("AC-4 repair: session-owner task-repair evidence grammar", () => {
  const execution = read("skills/gsd-executing-plans/SKILL.md");
  assert.match(execution, /green focused evidence, recorded only in reporting and transcripts/);
  assert.match(execution, /rerun only checks invalidated by the repair/);
  assert.match(execution, /Do not write task-attempt TOON files/);
});
