import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(ROOT, "skills");

// ── Helpers ──────────────────────────────────────────────

function listSkillDirs() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("gsd"))
    .map((d) => d.name);
}

function readSkill(name) {
  const p = join(SKILLS_DIR, name, "SKILL.md");
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

function readAllSkills() {
  const result = {};
  for (const dir of listSkillDirs()) {
    const content = readSkill(dir);
    if (content) result[dir] = content;
  }
  return result;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return fm;
}
/** Parse a frontmatter list value like "[a, b]" or "[]" into an array. */
function parseList(value) {
  if (!value) return [];
  return value.replace(/^\[/, "").replace(/\]$/, "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Extract every `gsd-xxx` or `/gsd-xxx` reference from markdown text. */
function extractSkillRefs(content) {
  const refs = new Set();
  // Backtick-quoted: `gsd-to-plan`
  for (const m of content.matchAll(/`gsd-[a-z-]+`/g)) {
    refs.add(m[0].replaceAll("`", ""));
  }
  // Slash-invoked: /gsd-verify — must NOT follow a word char or "/" (skips URL path segments like open-gsd/gsd-core)
  for (const m of content.matchAll(/(?<![a-z0-9\/])\/gsd-[a-z-]+/g)) {
    refs.add(m[0].slice(1));
  }
  return refs;
}

function extractPeerSection(content, heading) {
  const marker = `## ${heading}\n`;
  const start = content.indexOf(marker);
  if (start === -1) return "";
  const section = content.slice(start + marker.length);
  const nextPeer = section.indexOf("\n## ");
  return nextPeer === -1 ? section : section.slice(0, nextPeer);
}

function parseInvocationModes(content) {
  const section = extractPeerSection(content, "Invocation modes");
  const lines = section.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("|"));
  if (lines.length < 2) return { header: [], rows: [] };
  const cells = (line) => line.slice(1, -1).split("|").map((cell) => cell.trim());
  const header = cells(lines[0]);
  const rows = lines.slice(2).map((line) => Object.fromEntries(
    header.map((column, index) => [column, cells(line)[index]]),
  ));
  return { header, rows };
}

const INVOCATION_MODE_HEADER = ["Mode", "Required", "Optional", "Produced", "Missing required"];

/**
 * Parse a canonical invocation-mode artifact cell. Annotations may follow an
 * artifact in parentheses; `—` is the only representation of an empty set.
 */
function parseArtifactCell(cell, label) {
  const value = cell.trim();
  if (value === "—") return [];
  assert.ok(value, `${label}: artifact cell must not be empty; use —`);

  const artifacts = [];
  const artifactPattern = /`([^`]+)`(?:\s*\([^)]*\))?/g;
  let cursor = 0;
  for (const match of value.matchAll(artifactPattern)) {
    const separator = value.slice(cursor, match.index).trim();
    assert.equal(
      separator,
      artifacts.length === 0 ? "" : ";",
      `${label}: artifacts must be backtick-quoted and separated by semicolons`,
    );
    assert.match(match[1], /^[A-Za-z0-9_.<>\-/]+$/, `${label}: invalid artifact name ${match[1]}`);
    artifacts.push(match[1]);
    cursor = match.index + match[0].length;
  }

  assert.ok(artifacts.length > 0, `${label}: non-empty artifact cell must name an artifact`);
  assert.equal(
    value.slice(cursor).trim(),
    "",
    `${label}: unparsed artifact text; annotations must be parenthesized`,
  );
  assert.equal(new Set(artifacts).size, artifacts.length, `${label}: duplicate artifact`);
  return artifacts;
}

function parseFallbackArtifacts(cell, label) {
  const artifacts = [];
  for (const match of cell.matchAll(/\bFallback\b([\s\S]*?)(?=\s+Missing\s+`|$)/g)) {
    const named = [...match[1].matchAll(/`([^`]+)`/g)]
      .map((artifact) => artifact[1])
      .filter((artifact) => !artifact.startsWith("/") && (artifact.includes(".") || artifact.endsWith("/")));
    assert.ok(named.length > 0, `${label}: Fallback must name a backtick-quoted repository artifact`);
    artifacts.push(...named);
  }
  return artifacts;
}

function assertArtifactSet(cell, expected, label) {
  const actual = parseArtifactCell(cell, label);
  assert.deepEqual([...actual].sort(), [...expected].sort(), `${label}: exact artifact set`);
}

const T1_MODE_CONTRACTS = [
  {
    skill: "gsd-verify",
    mode: "Standalone review (Route 2)",
    required: [],
    optional: ["spec.md", "plan.toon"],
    produced: [],
  },
  {
    skill: "gsd-verify",
    mode: "Planned WIP gate",
    required: ["spec.md", "plan.toon"],
    optional: [],
    produced: [],
    recovery: {
      "spec.md": /Missing `spec\.md` or `plan\.toon`: stop before review or merge with the Blocker stop, then recover or re-plan through `\/gsd`/,
      "plan.toon": /Missing `spec\.md` or `plan\.toon`: stop before review or merge with the Blocker stop, then recover or re-plan through `\/gsd`/,
    },
    noFabrication: /never fabricate either artifact/,
  },
  {
    skill: "gsd-verify",
    mode: "Quick-fix WIP gate",
    required: ["plan.toon"],
    optional: ["spec.md"],
    produced: [],
    recovery: {
      "plan.toon": /Missing `plan\.toon`: stop before review or merge, then recover the real quick-fix plan through `\/gsd`/,
    },
    noFabrication: /never fabricate it/,
  },
  {
    skill: "gsd-handoff",
    mode: "Pre-plan handoff write",
    required: [],
    optional: ["spec.md", "plan.toon"],
    produced: ["handoff-<n>.toon"],
  },
  {
    skill: "gsd-handoff",
    mode: "Execution handoff write",
    required: ["plan.toon"],
    optional: ["spec.md"],
    produced: ["handoff-<n>.toon"],
    recovery: {
      "plan.toon": /Missing `plan\.toon`: stop and recover or block through `\/gsd`/,
    },
    noFabrication: /never record invented execution state/,
  },
  {
    skill: "gsd-handoff",
    mode: "Pre-plan resume",
    required: ["handoff-<n>.toon"],
    optional: ["spec.md", "plan.toon"],
    produced: [],
    recovery: {
      "handoff-<n>.toon": /Missing `handoff-<n>\.toon`: return once to `\/gsd` state detection and preserve explicit intent/,
    },
    noFabrication: /never infer a mode or invent the handoff or a plan/,
  },
  {
    skill: "gsd-handoff",
    mode: "Execution resume",
    required: ["handoff-<n>.toon", "plan.toon"],
    optional: ["spec.md"],
    produced: [],
    recovery: {
      "handoff-<n>.toon": /Missing `handoff-<n>\.toon`: reconstruct from Fallback `plan\.toon` plus git log and status\/diff/,
      "plan.toon": /Missing `plan\.toon` in a claimed execution resume: stop and recover or block through `\/gsd`/,
    },
    noFabrication: /never fabricate either artifact/,
  },
  {
    skill: "gsd-domain-modeling",
    mode: "First-run domain modeling",
    required: [],
    optional: ["CONTEXT.md", "CONTEXT-MAP.md", "docs/context/<area>/CONTEXT.md", "docs/adr/"],
    produced: ["CONTEXT.md", "CONTEXT-MAP.md", "docs/context/<area>/CONTEXT.md", "docs/adr/"],
  },
  {
    skill: "gsd-domain-modeling",
    mode: "Existing-model update",
    required: [],
    optional: ["CONTEXT.md", "CONTEXT-MAP.md", "docs/context/<area>/CONTEXT.md", "docs/adr/"],
    produced: ["CONTEXT.md", "CONTEXT-MAP.md", "docs/context/<area>/CONTEXT.md", "docs/adr/"],
  },
  {
    skill: "gsd-tdd",
    mode: "Dispatched task TDD",
    required: [],
    optional: ["CONTEXT.md", "docs/adr/"],
    produced: [],
  },
  {
    skill: "gsd-tdd",
    mode: "Direct TDD",
    required: [],
    optional: ["CONTEXT.md", "docs/adr/"],
    produced: [],
  },
  {
    skill: "gsd-diagnosing-bugs",
    mode: "Route 4 diagnosis",
    required: [],
    optional: ["CONTEXT.md", "docs/adr/"],
    produced: [],
  },
  {
    skill: "gsd-diagnosing-bugs",
    mode: "Execution-blocker diagnosis",
    required: [],
    optional: ["CONTEXT.md", "docs/adr/"],
    produced: [],
  },
  {
    skill: "gsd-improve-codebase-architecture",
    mode: "Route 5 architecture audit",
    required: [],
    optional: ["CONTEXT.md", "docs/adr/"],
    produced: [],
  },
  {
    skill: "gsd-improve-codebase-architecture",
    mode: "Post-diagnosis architecture audit",
    required: [],
    optional: ["CONTEXT.md", "docs/adr/"],
    produced: [],
  },
  {
    skill: "gsd-to-plan",
    mode: "Converged planning",
    required: ["spec.md"],
    optional: ["handoff-<n>.toon"],
    produced: ["plan.toon"],
    recovery: {
      "spec.md": /Missing `spec\.md`: STOP and return to `\/gsd` Discussion to recover or create a converged spec/,
    },
    noFabrication: /never synthesize `spec\.md` or a plan from unstated requirements/,
  },
  {
    skill: "gsd-executing-plans",
    mode: "Normal plan execution",
    required: ["plan.toon", "spec.md"],
    optional: [],
    produced: ["plan.toon"],
    recovery: {
      "plan.toon": /Missing `plan\.toon`: STOP and recover or block through `\/gsd` state detection/,
      "spec.md": /Missing `spec\.md`: STOP through Spec escalation, revise in `\/gsd` Discussion, and re-plan/,
    },
    noFabrication: /Never dispatch a task or synthesize either state/,
  },
];

// ── Tests ────────────────────────────────────────────────

test("every skill directory has a SKILL.md", () => {
  for (const dir of listSkillDirs()) {
    assert.ok(readSkill(dir), `Missing SKILL.md in skills/${dir}/`);
  }
});

test("frontmatter name matches directory name", () => {
  for (const dir of listSkillDirs()) {
    const content = readSkill(dir);
    const { name } = parseFrontmatter(content);
    assert.equal(
      name,
      dir,
      `skills/${dir}/SKILL.md frontmatter name "${name}" ≠ directory "${dir}"`,
    );
  }
});

test("gsd master references only skills that exist on disk", () => {
  const master = readSkill("gsd");
  assert.ok(master, "gsd/SKILL.md is missing");
  const refs = extractSkillRefs(master);
  const dirs = new Set(listSkillDirs());
  for (const ref of refs) {
    assert.ok(
      dirs.has(ref),
      `gsd master references "${ref}" but skills/${ref}/ does not exist`,
    );
  }
});

test("all cross-references between skills resolve", () => {
  const skills = readAllSkills();
  const dirs = new Set(Object.keys(skills));
  const failures = [];

  for (const [skillName, content] of Object.entries(skills)) {
    const refs = extractSkillRefs(content);
    for (const ref of refs) {
      if (!dirs.has(ref)) {
        failures.push(`${skillName} → ${ref} (not found)`);
      }
    }
  }

  assert.deepEqual(
    failures,
    [],
    `Unresolved skill references:\n${failures.join("\n")}`,
  );
});

test("path conventions use plan.toon, not plans/ or ledger.md", () => {
  const stale = [];
  for (const [skillName, content] of Object.entries(readAllSkills())) {
    if (/\.scratch\/<feature>\/plans\//.test(content)) {
      stale.push(`${skillName}: references .scratch/<feature>/plans/`);
    }
    if (/ledger\.md/.test(content)) {
      stale.push(`${skillName}: references ledger.md`);
    }
  }
  assert.deepEqual(stale, [], `Stale path conventions:\n${stale.join("\n")}`);
});

test("handoff references use handoff-<n>.toon, not gsd-handoff-*.md", () => {
  const stale = [];
  for (const [skillName, content] of Object.entries(readAllSkills())) {
    if (/gsd-handoff-\*\.md/.test(content)) {
      stale.push(`${skillName}: references gsd-handoff-*.md`);
    }
  }
  assert.deepEqual(stale, [], `Stale handoff naming:\n${stale.join("\n")}`);
});

test("no stale names: gsd-review, gsd-grilling, gsd-reviewer", () => {
  const banned = ["gsd-review`", "gsd-grilling", "gsd-reviewer"];
  const hits = [];

  for (const [skillName, content] of Object.entries(readAllSkills())) {
    for (const term of banned) {
      // gsd-review` — match as a skill ref (backtick-delimited) to avoid
      // false positives on compound words like "reviewable"
      if (term.endsWith("`")) {
        const bare = term.slice(0, -1);
        if (content.includes(bare + "`") || content.includes("/" + bare)) {
          hits.push(`${skillName}: contains stale "${term}"`);
        }
      } else if (content.includes(term)) {
        hits.push(`${skillName}: contains stale "${term}"`);
      }
    }
  }
  assert.deepEqual(hits, [], `Stale name references:\n${hits.join("\n")}`);
});

test("gsd master has a .scratch creation step", () => {
  const master = readSkill("gsd");
  assert.match(
    master,
    /mkdir.*\.scratch/,
    "gsd master must include mkdir step for .scratch/",
  );
});

test("CONTEXT.md reads guard with 'if exists' or 'if they exist'", () => {
  const skillsThatReadContext = [
    "gsd-improve-codebase-architecture",
    "gsd-diagnosing-bugs",
    "gsd-tdd",
  ];
  for (const skill of skillsThatReadContext) {
    const content = readSkill(skill);
    if (!content) continue;
    // Find the line mentioning CONTEXT.md read
    const contextLine = content.match(/Read.*CONTEXT\.md.*/i)?.[0] || "";
    if (contextLine && !/if (it|they) exist/i.test(contextLine)) {
      assert.fail(
        `${skill}: reads CONTEXT.md without "if exists" guard: "${contextLine.trim()}"`,
      );
    }
  }
});

test("gsd master does not have duplicate next-steps sections", () => {
  const master = readSkill("gsd");
  const matches = master.match(/## .*(End-session|Contextual disclosure)/gi);
  assert.ok(
    matches && matches.length === 1,
    `gsd master should have exactly one next-steps section, found ${matches?.length || 0}`,
  );
});

test("gsd master routing covers resume, review, spec/plan, bug, exploration, new work", () => {
  const master = readSkill("gsd");
  const requiredRoutes = [
    /Resume/i,
    /Review|Diff/i,
    /Spec.*Plan|Plan.*Spec/i,
    /Issue|Bug/i,
    /Codebase Exploration|Exploration/i,
    /New Work|Vague/i,
  ];
  for (const route of requiredRoutes) {
    assert.match(master, route, `gsd master missing routing rule matching ${route}`);
  }
});

test("TOON format for plan.toon has required columns", () => {
  const planSkill = readSkill("gsd-to-plan");
  assert.ok(planSkill, "gsd-to-plan/SKILL.md missing");
  // Verify the TOON format definition includes the key columns
  assert.match(planSkill, /plan\[.*\]\{.*id.*task.*satisfies.*files.*test.*status.*\}/s,
    "plan.toon format missing required columns (id, task, satisfies, files, test, status)");
});

test("TOON format for handoff has required fields", () => {
  const handoffSkill = readSkill("gsd-handoff");
  assert.ok(handoffSkill, "gsd-handoff/SKILL.md missing");
  assert.match(handoffSkill, /handoff\[.*\]\{.*mode.*phase.*next_action.*\}/s,
    "handoff.toon format missing required fields (mode, phase, next_action)");
});

test("every markdown-linked local file referenced by a skill exists", () => {
  const skills = readAllSkills();
  const failures = [];
  for (const [skillName, content] of Object.entries(skills)) {
    const dir = join(SKILLS_DIR, skillName);
    for (const m of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      let target = m[1].split(/[#?]/)[0];
      // skip URLs, mailto, and template placeholders
      if (!target || /^https?:|^mailto:/.test(target)) continue;
      if (/[<>{}]/.test(target)) continue;
      if (!existsSync(join(dir, target))) {
        failures.push(`${skillName}: references missing file "${target}"`);
      }
    }
  }
  assert.deepEqual(failures, [], `Missing referenced files:\n${failures.join("\n")}`);
});

test("the lavish-axi CLI the skills invoke exists", () => {
  const cli = join(ROOT, "tools/lavish-axi/dist/cli.mjs");
  assert.ok(existsSync(cli), `gsd-lavish invokes ${cli} but it does not exist (submodule not built?)`);
});

test("gsd master loads registered sub-skills directly, readlink only as fallback", () => {
  const master = readSkill("gsd");
  const section = master.split("## Dynamic Sub-Skill Loading")[1] || "";
  assert.match(section, /load one directly \(`skill:\/\/gsd-<sub>`/, "primary path must be the registered skill — no resolution turn");
  assert.match(section, /\*\*Fallback \(partial\/old install\):\*\*[\s\S]*readlink/, "readlink must appear only under the fallback");
});

test("master enforces scope discipline against over-exploration", () => {
  const master = readSkill("gsd");
  const scope = master.split("## Scope discipline")[1] || "";
  assert.ok(scope.length > 0, "gsd master must have a Scope discipline section");
  assert.match(scope, /git-scoped|git-tracked|git space/i, "scope discipline must keep exploration inside the project's git scope");
  assert.match(scope, /node_modules|dependency|non-git/i, "scope discipline must tell the agent to skip dependency/non-git noise dirs");
});

test("gsd-improve-codebase-architecture scopes its codebase walk", () => {
  const skill = readSkill("gsd-improve-codebase-architecture");
  const explore = skill.split("## 1. Explore")[1]?.split("\n## ")[0] || "";
  assert.match(explore, /git-tracked|git scope|node_modules|relevant area/i, "the Explore step must scope its walk to git-tracked relevant files — not the whole tree");
});

test("every skill declares triggers/produces/consumes frontmatter", () => {
  for (const [name, content] of Object.entries(readAllSkills())) {
    const fm = parseFrontmatter(content);
    for (const key of ["triggers", "produces", "consumes"]) {
      assert.ok(key in fm, `${name}: missing '${key}' frontmatter`);
    }
  }
});

test("pipeline closure — every consumed artifact is produced by some skill", () => {
  const produced = new Set();
  const consumed = new Set();
  for (const content of Object.values(readAllSkills())) {
    const fm = parseFrontmatter(content);
    for (const a of parseList(fm.produces)) produced.add(a);
    for (const a of parseList(fm.consumes)) consumed.add(a);
  }
  const orphans = [...consumed].filter((a) => !produced.has(a));
  assert.deepEqual(orphans, [], `consumed artifact with no producer (pipeline gap): ${orphans.join(", ")}`);
});


test("no sub-skill uses the contradictory 'always append/suggest' Next-steps phrasing (P1)", () => {
  const old = [/At the end of every response, always append/, /At the end of every response, always suggest/];
  for (const [name, content] of Object.entries(readAllSkills())) {
    if (name === "gsd") continue; // master is exempt; its End-session block is the human surface
    for (const re of old) {
      assert.ok(!re.test(content), `${name} still uses the contradictory Next-steps phrasing: ${re}`);
    }
  }
});

test("sub-skills with a contextual-disclosure section state the terminal/inline rule (P1)", () => {
  for (const [name, content] of Object.entries(readAllSkills())) {
    if (name === "gsd") continue; // master's para is the coordinator-level two-surfaces rule (P3), not the per-skill disclosure
    if (!/Contextual disclosure/.test(content)) continue;
    // After dedup: either self-contained (terminal/inline keywords), references old gsd Conventions, or references the canonical templates.
    const selfContained = /terminal\/standalone/.test(content) && /inline/.test(content);
    const referencesCanonical = /see gsd Conventions/.test(content) || /Contextual disclosure templates/.test(content);
    assert.ok(selfContained || referencesCanonical,
      `${name}: contextual disclosure must either state the terminal/inline rule or reference gsd Conventions`);
  }
});

test("Route 0 captures obvious failures; Route 4 is scoped to hard bugs (P2)", () => {
  const master = readSkill("gsd");
  assert.ok(master, "gsd master missing");
  // Route 0 must absorb obvious failing-test/error fixes so trivial ones never reach full diagnosis
  assert.match(master, /failing-test\/error fix/, "Route 0 must capture obvious failing-test/error fixes");
  // Route 4 must be scoped to hard/obscure bugs, deferring obvious ones to Route 0
  assert.match(master, /hard\/obscure/, "Route 4 must be scoped to hard bugs");
  assert.match(master, /were caught by Route 0/, "Route 4 must defer obvious failures to Route 0");
});

test("gsd-lavish has an explicit 2-part fire gate and ask-first launch consent (P4)", () => {
  const master = readSkill("gsd");
  const lavish = readSkill("gsd-lavish");
  assert.match(master, /Gate \(both must hold\)/, "master lavish trigger must state the 2-part gate");
  assert.match(master, /MUST proactively ask before launching/, "master must require asking first before launching, not bare opt-in");
  assert.match(lavish, /Fire gate \(both must hold\)/, "gsd-lavish SKILL must mirror the gate");
  assert.match(lavish, /default to terminal output and ask/);
});

test("gsd-executing-plans declares plan.toon in produces — it updates the progress ledger (P5)", () => {
  const fm = parseFrontmatter(readSkill("gsd-executing-plans"));
  const produces = parseList(fm.produces);
  const consumes = parseList(fm.consumes);
  assert.ok(produces.includes("plan.toon"), "executing-plans must produce plan.toon (writes status back to the ledger)");
  assert.ok(consumes.includes("plan.toon"), "executing-plans must still consume plan.toon");
});

test("master routing has a route trace and a feature list/switch affordance (Minor 1+3)", () => {
  const master = readSkill("gsd");
  assert.match(master, /Route trace/, "master must require a route trace on entry");
  assert.match(master, /auditable/, "route trace must be justified as auditable");
  assert.match(master, /To list\/switch/, "master must offer a feature list/switch affordance");
});

test("ponytail states its persistence contract (Minor 2)", () => {
  const ponytail = readSkill("gsd-ponytail");
  assert.match(ponytail, /only via a `gsd-handoff`/, "ponytail must state it persists only via a handoff");
  assert.match(ponytail, /hard reset/, "ponytail must warn a hard reset loses the level");
});

// ── Gap tests added by the gsd-audit pass ────────────────

test("no orphaned files in skill directories (each non-SKILL.md is referenced by a SKILL.md)", () => {
  const allSkillText = Object.values(readAllSkills()).join("\n");
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
  const orphans = [];
  for (const skill of listSkillDirs()) {
    for (const f of walk(join(SKILLS_DIR, skill))) {
      const base = f.split("/").pop();
      if (base !== "SKILL.md" && !allSkillText.includes(base)) orphans.push(f.split("/").slice(-2).join("/"));
    }
  }
  assert.equal(orphans.length, 0, `orphaned files not referenced by any SKILL.md: ${orphans.join(", ")}`);
});

test("install.sh registers all gsd skills and initializes the lavish submodule", () => {
  const sh = readFileSync(join(ROOT, "install.sh"), "utf8");
  assert.match(sh, /ln -sfn[^\n]*\$dir/, "install.sh must symlink the gsd* skills to the registry");
  assert.match(sh, /submodule update --init/, "install.sh must initialize the lavish-axi submodule");
});

test("no gsd-lavish mention describes an unconditional browser launch", () => {
  // The invariant is narrow: a line that actually describes *launching/firing/rendering*
  // the browser flow must carry a consent cue. Offer/ask/menu lines legitimately lack one —
  // asking is mandatory, launching waits for the user to accept.
  const launchVerb = /\b(launch|launching|launches|fire|firing|render|rendering)\b/i;
  const consent = /opt-?in|opted in|opts in|the user (?:accepts|picks|opts|wants)|picking|only (?:after|when|on) [^.]*(?:accept|opt|pick|request|explicit)|waits for the user to accept|launch on accept|prior explicit opt-in|explicit request/i;
  const offenders = [];
  for (const [name, content] of Object.entries(readAllSkills())) {
    if (name === "gsd-lavish") continue; // defines the gate itself
    content.split("\n").forEach((line, i) => {
      if (/gsd-lavish/.test(line) && launchVerb.test(line) && !consent.test(line)) {
        offenders.push(`${name}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  assert.equal(offenders.length, 0, `lines describe launching gsd-lavish with no consent cue:\n${offenders.join("\n")}`);
});

test("offer-eligible deliverables must proactively ask for visual review (the original bug)", () => {
  // The bug: lavish stayed invisible unless explicitly demanded. Each deliverable-producing
  // surface MUST proactively ask — not merely *may offer*.
  const ref = readFileSync(join(SKILLS_DIR, "gsd", "REFERENCE.md"), "utf8");
  assert.match(ref, /Offer-eligible deliverable → ask first, mandatory/, "taxonomy must make the visual-review ask mandatory, not optional");
  assert.match(ref, /MUST proactively ask|never stays silent waiting to be asked/, "taxonomy must forbid silent-until-asked behavior");

  const master = readSkill("gsd");
  assert.match(master, /MUST proactively ask before launching/, "master must require a proactive ask on eligible deliverables");
  assert.doesNotMatch(master, /auto-\*?offers\*?/, "master must not frame lavish as auto-offering (user rejected 'auto')");
  // System map summary line must not label lavish as bare "opt-in" — it must carry ask-first framing.
  const sysMapLavish = master.match(/\*\*Auto-composed:\*\*[^\n]*`gsd-lavish` \(([^)]*)\)/)?.[1] || "";
  assert.match(sysMapLavish, /ask first|launch on accept/i, "System map lavish label must state ask-first/launch-on-accept, not bare 'opt-in'");

  const toPlan = readSkill("gsd-to-plan");
  assert.match(toPlan, /you MUST surface the visual-review option/, "to-plan must fold the visual-review ask into the approval gate");

  const verify = readSkill("gsd-verify");
  assert.match(verify, /standalone review MUST ask whether to review visually/, "verify standalone report must ask for visual review when eligible");

  // Frontmatter `description:` lines are read first by catalog/routing — a bare "lavish ... opt-in"
  // there re-seeds the silent bias. If a description mentions lavish/visual opt-in, it must carry
  // ask-first or launch-on-accept framing.
  const fmOffenders = [];
  for (const [name, content] of Object.entries(readAllSkills())) {
    const desc = content.match(/^description:.*$/m)?.[0] || "";
    if (/lavish|visual/i.test(desc) && /opt-?in/i.test(desc) && !/ask first|launch on accept|ask.*eligible/i.test(desc)) {
      fmOffenders.push(`${name}: ${desc.trim()}`);
    }
  }
  assert.equal(fmOffenders.length, 0, `frontmatter descriptions frame lavish as bare opt-in (no ask-first/launch-on-accept):\n${fmOffenders.join("\n")}`);
});

test("master defines the Route 0↔4 bug-routing boundary with a fix-loop escalation fallback", () => {
  const gsd = readSkill("gsd");
  assert.match(gsd, /0↔4/, "master must name the Route 0↔4 boundary");
  assert.match(gsd, /fails twice/, "master must state the escalation trigger (fix loop fails twice)");
});

test("master has a git repo guard qualifying read-only vs write/commit paths", () => {
  const gsd = readSkill("gsd");
  assert.match(gsd, /git rev-parse/, "master must check git repo status");
  assert.match(gsd, /git init/, "master must git init when not in a repo");
  assert.match(gsd, /read-only.*without git|works without git/i, "read-only Route 0 must be explicitly git-free");
  assert.match(gsd, /pasted-diff.*without git|Route 2.*without git/i, "pasted-diff review (Route 2) must be explicitly git-free — it is read-only");
  const guardLine = gsd.split("\n").find(l => l.includes("Git repo guard")) || "";
  assert.ok(!/Routes\s*1.\s*3/.test(guardLine), "git guard line must not blanket-require git for Routes 1–3 (Route 2 pasted-diff is read-only)");
});

test("master has a Route 0→5 escalation rule for scope blow-up", () => {
  const gsd = readSkill("gsd");
  assert.match(gsd, /0→5/, "master must name the Route 0→5 escalation");
  assert.match(gsd, /escalate to Route 5/, "master must state the escalation target");
});

test("Route 3 relevance guard prevents swallowing unrelated prompts when a plan exists", () => {
  const gsd = readSkill("gsd");
  assert.match(gsd, /relates to that feature/, "Route 3 must require prompt relevance to the existing feature");
  assert.match(gsd, /falls through|fall through/, "Route 3 must let unrelated prompts fall through, not swallow them");
  assert.match(gsd, /not a claim on every prompt/, "an existing plan must not claim every prompt");
});

test("master states graceful degradation for optional capabilities (browser/lavish)", () => {
  const gsd = readSkill("gsd");
  assert.match(gsd, /degrad/i, "master must state optional capabilities degrade to terminal when unavailable");
});

test("master bounds read-only/exploratory questions to the targeted scope (L2)", () => {
  const gsd = readSkill("gsd");
  assert.match(gsd, /read-only question|exploratory question|a question is not/i, "master must bound read-only questions to the targeted scope, not a tree walk");
});

// ── Gap tests added by the second gsd-audit pass ─────────

test("gsd-tdd Planning distinguishes headless dispatch from direct user invocation", () => {
  const tdd = readSkill("gsd-tdd");
  assert.ok(tdd, "gsd-tdd missing");
  // Dispatched headless by executing-plans: no user, derive from the task-brief — must NOT block on approval
  assert.match(tdd, /headless/i, "gsd-tdd Planning must name the headless dispatch path");
  assert.match(tdd, /task-brief/, "gsd-tdd headless path must derive behaviors from the task-brief");
  // Direct invocation still confirms with the user
  assert.match(tdd, /[Ii]nvoked directly/, "gsd-tdd must keep the direct-invocation confirm path");
});

test("gsd-tdd refactoring.md is a concrete refactor loop, not a sparse checklist", () => {
  // Regression against the sparse-doc bug: refactoring.md was an 11-line bullet list with no
  // safety loop, example, or stop rule. It must carry the same depth as tests.md / mocking.md.
  const refactoring = readFileSync(join(SKILLS_DIR, "gsd-tdd", "refactoring.md"), "utf8");
  assert.match(refactoring, /Never refactor while RED/i, "must forbid refactoring on RED");
  assert.match(refactoring, /[Rr]un tests?.*(each|between|after)|tests? (green|between each)/, "must require running tests between structural steps");
  assert.match(refactoring, /One change at a time/i, "safety loop must isolate one structural change at a time");
  assert.match(refactoring, /BEFORE[\s\S]*AFTER/, "must carry a concrete before/after example pair like tests.md/mocking.md");
  assert.match(refactoring, /when to stop|Boundary|gold-plate/i, "must define a stop boundary so refactoring isn't endless polishing");
  assert.ok(refactoring.split("\n").length > 40, "refactoring.md must be a developed doc, not a sparse checklist");
});

test("gsd-verify owns an acceptance/E2E gate that blocks the merge, absorbing deferrals", () => {
  const verify = readSkill("gsd-verify");
  assert.match(verify, /acceptance\/E2E gate/, "gsd-verify must define an explicit acceptance/E2E gate");
  assert.match(verify, /blocks the merge/, "the gate must block the merge, not run as an afterthought");
  assert.match(verify, /every non-superseded AC that is runtime-observable/, "the gate must exercise every runtime-observable AC");
  assert.match(verify, /Acceptance Check: deferred/, "the gate must explicitly absorb per-task deferrals");
  assert.match(verify, /acceptance-exempt/, "gsd-verify must let ACs with no runtime-observable behavior opt out explicitly");
});

test("gsd-executing-plans runs targeted per-task acceptance, deferring only non-runnable slices to the terminal gate", () => {
  const exec = readSkill("gsd-executing-plans");
  assert.match(exec, /Per-task acceptance \/ targeted E2E/, "executing-plans must run targeted per-task acceptance when the AC is runnable now");
  assert.match(exec, /Acceptance Check: deferred/, "executing-plans must state the explicit deferral form for non-runnable slices");
  assert.match(exec, /Whole-journey E2E stays terminal/, "the whole user journey must stay owned by the terminal gate");
  assert.match(exec, /every non-superseded AC that is runtime-observable/, "executing-plans must not claim a stronger guarantee than the verify contract");
  assert.doesNotMatch(exec, /E2E is excluded from this per-task loop/, "the old blanket per-task E2E exclusion must be gone");
});

test("master mirrors the user's language, anchored to the user's own prompt (ignores injected text)", () => {
  const gsd = readSkill("gsd");
  assert.match(gsd, /Respond in the user's language/, "master must instruct responding in the user's language");
  assert.match(gsd, /verbatim/, "master must exempt code/identifiers/paths from translation");
  // The language anchor is the user's prompt — injected advisory/system/tool text must not switch it
  assert.match(gsd, /user's own prompt/, "master must anchor on the user's own prompt");
  assert.match(gsd, /advisory|system-directive/, "master must say injected text never switches the response language");
});

test("CONTEXT.md has a single writer: only gsd-domain-modeling declares it in produces", () => {
  const writers = [];
  for (const name of listSkillDirs()) {
    const produces = parseList(parseFrontmatter(readSkill(name)).produces);
    if (produces.includes("CONTEXT.md")) writers.push(name);
  }
  assert.deepEqual(writers, ["gsd-domain-modeling"], `exactly gsd-domain-modeling may produce CONTEXT.md; got: ${writers.join(", ")}`);
});

test("gsd-domain-modeling declares itself the sole writer of CONTEXT.md", () => {
  const dm = readSkill("gsd-domain-modeling");
  assert.match(dm, /sole writer/, "gsd-domain-modeling must declare itself CONTEXT.md's sole writer");
});

test("lavish CLI resolves to the vendored local tool (no global/bare drift)", () => {
  const offenders = [];
  for (const [name, content] of Object.entries(readAllSkills())) {
    content.split("\n").forEach((line, i) => {
      // Only check lines that reference the lavish-axi binary or cli.mjs
      if (!/cli\.mjs|lavish-axi/.test(line)) return;
      // Accepted: vendored path (direct invocation or variable assignment)
      if (/tools\/lavish-axi\/dist\/cli\.mjs/.test(line)) return;
      // Accepted: using the resolved $CLI variable
      if (/\$CLI/.test(line)) return;
      // Accepted: frontmatter metadata (name/description/triggers/produces/consumes)
      if (/^\s*(name|description|triggers|produces|consumes):/.test(line)) return;
      // Reject: anything else — global (npx/pnpm dlx/yarn/bun lavish-axi) or bare (lavish-axi <file>)
      offenders.push(`${name}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.equal(offenders.length, 0,
    `lavish must use the vendored tools/lavish-axi/dist/cli.mjs or $CLI variable — no global/bare invocations:\n${offenders.join("\n")}`);
});

test("gsd-lavish resolves CLI path cross-project via symlink (not bare relative path)", () => {
  const lavish = readSkill("gsd-lavish");
  assert.match(lavish, /readlink/, "gsd-lavish must resolve its CLI via readlink symlink resolution");
  assert.match(lavish, /\$CLI/, "gsd-lavish must use a $CLI variable for invocations");
});

test("gsd-codebase-design defines deep vs shallow in prose (not ASCII art)", () => {
  const design = readSkill("gsd-codebase-design");
  const section = design.split("## Deep vs shallow")[1]?.split("\n## ")[0] || "";
  assert.match(section, /Deep module.*small interface/i, "deep module definition must be in prose");
  assert.match(section, /Shallow module.*large interface/i, "shallow module definition must be in prose");
  assert.ok(!/┌─/.test(section), "deep vs shallow section should not contain ASCII box art");
});

test("gsd-codebase-design carries its vocabulary into actionable companion guidance", () => {
  const design = readSkill("gsd-codebase-design");
  const glossary = design.split("## Glossary")[1]?.split("\n## ")[0] || "";
  for (const term of ["Module", "Interface", "Implementation", "Depth", "Seam", "Adapter", "Leverage", "Locality"]) {
    assert.match(glossary, new RegExp(`\\*\\*${term}\\*\\*`), `glossary must define ${term}`);
  }

  const deepening = readFileSync(join(SKILLS_DIR, "gsd-codebase-design", "DEEPENING.md"), "utf8");
  const designItTwice = readFileSync(join(SKILLS_DIR, "gsd-codebase-design", "DESIGN-IT-TWICE.md"), "utf8");
  assert.match(designItTwice, /adapter seam for cross-seam dependencies/i, "DESIGN-IT-TWICE must frame remote dependencies with an adapter seam");
  assert.doesNotMatch(designItTwice, /\bports?\s*(?:&|and)\s*adapters?\b|\bports?-and-adapters?\b/i, "DESIGN-IT-TWICE must not revert the adapter seam to ports-and-adapters terminology");
  assert.doesNotMatch(deepening, /\bports?\s*(?:&|and)\s*adapters?\b|\bports?-and-adapters?\b/i, "DEEPENING must not revert adapter guidance to ports-and-adapters terminology");
  assert.match(designItTwice, /compare[\s\S]{0,250}\*\*depth\*\*[\s\S]{0,100}\*\*locality\*\*[\s\S]{0,100}\*\*seam placement\*\*/i, "DESIGN-IT-TWICE must compare alternatives by depth, locality, and seam placement");

  assert.match(deepening, /^### 3\. Remote but owned \(Adapters\)$/m, "DEEPENING must classify remote-but-owned dependencies as Adapters");
  const remoteOwned = deepening.split("### 3. Remote but owned (Adapters)")[1]?.split("\n### ")[0] || "";
  assert.match(remoteOwned, /Define an \*\*interface\*\* at the seam/, "remote-but-owned guidance must place an interface at the seam");
  assert.match(remoteOwned, /transport is injected as an \*\*adapter\*\*[\s\S]*in-memory adapter[\s\S]*HTTP\/gRPC\/queue adapter/, "remote-but-owned guidance must supply test and production adapters at that seam");
});

test("design-context skill prose avoids substituting component/service/API/boundary", () => {
  const designContexts = {
    "gsd-codebase-design/SKILL.md": readSkill("gsd-codebase-design"),
    "gsd-codebase-design/DEEPENING.md": readFileSync(join(SKILLS_DIR, "gsd-codebase-design", "DEEPENING.md"), "utf8"),
    "gsd-codebase-design/DESIGN-IT-TWICE.md": readFileSync(join(SKILLS_DIR, "gsd-codebase-design", "DESIGN-IT-TWICE.md"), "utf8"),
    "gsd-improve-codebase-architecture/SKILL.md": readSkill("gsd-improve-codebase-architecture"),
    "gsd-diagnosing-bugs/SKILL.md": readSkill("gsd-diagnosing-bugs"),
    "gsd-tdd/SKILL.md": readSkill("gsd-tdd"),
  };
  assert.doesNotMatch(readSkill("gsd-handoff"), /Sync seams/, "git autosync timing must not misuse the design seam vocabulary");
  const banned = /\b(component|components|service|services|API|APIs|boundary|boundaries)\b/;
  const explicitRejection = /\b(Avoid|_Avoid_|don't substitute|don't drift|Rejected framings|overloaded with DDD|component\/service\/API\/boundary)\b/i;
  const offenders = [];

  for (const [file, content] of Object.entries(designContexts)) {
    content.split("\n").forEach((line, index) => {
      if (!banned.test(line) || explicitRejection.test(line)) return;
      offenders.push(`${file}:${index + 1} ${line.trim()}`);
    });
  }

  assert.deepEqual(offenders, [], `Design vocabulary drifted from module/interface/implementation/depth/seam/adapter/leverage/locality:\n${offenders.join("\n")}`);
});

test("plan.toon declares schema version and every consumer tolerates the header", () => {
  const toPlan = readSkill("gsd-to-plan");
  assert.match(toPlan, /schema:v1/, "gsd-to-plan must write schema:v1 in the format");
  // Every skill that consumes plan.toon must mention schema:v1 in its own SKILL.md
  // (sub-skills load independently — a note only in the writer is invisible to consumers)
  const consumers = ["gsd-executing-plans", "gsd-verify", "gsd-handoff"];
  for (const skill of consumers) {
    const content = readSkill(skill);
    assert.match(
      content,
      /schema:v1/,
      `${skill} consumes plan.toon but its SKILL.md has no schema:v1 tolerance note`,
    );
  }
});

test("master has monorepo guidance in Conventions", () => {
  const gsd = readSkill("gsd");
 const conventions = gsd.split("## Conventions")[1]?.split("## ")[0] || "";
  assert.match(conventions, /monorepo/i, "Conventions must mention monorepo handling");
  assert.match(conventions, /\.scratch.*repo root/i, "Conventions must place .scratch at repo root for monorepos");
});

test("gsd-handoff handles numbering collision without breaking the read contract", () => {
  const handoff = readSkill("gsd-handoff");
  assert.match(handoff, /max \+ 1|max\+1/i, "handoff must use max+1 numbering");
  assert.match(handoff, /re-glob|increment until free/i, "handoff must retry-increment on collision");
  assert.match(handoff, /never.*suffixed/i, "handoff must forbid suffixed variants that break the read contract");
});

test("VERSION file exists and install.sh echoes it", () => {
  const versionPath = join(ROOT, "VERSION");
  assert.ok(existsSync(versionPath), "VERSION file must exist at repo root");
  const version = readFileSync(versionPath, "utf-8").trim();
  assert.match(version, /^\d+\.\d+\.\d+$/, "VERSION must be semantic (x.y.z)");
  const install = readFileSync(join(ROOT, "install.sh"), "utf-8");
  assert.match(install, /VERSION.*cat.*VERSION/, "install.sh must read and echo the VERSION file");
});

// ── P0/P1 audit pass: invocation surface + <base> branch ──

test("master defines <base> convention replacing hard-coded main (P0-b)", () => {
  const gsd = readSkill("gsd");
  const conventions = gsd.split("## Conventions")[1]?.split("## ")[0] || "";
  assert.match(conventions, /<base>/, "Conventions must define <base> placeholder");
  assert.match(conventions, /git branch --show-current/, "Conventions must capture base via git branch --show-current");
  assert.match(conventions, /detached HEAD/, "Conventions must handle detached HEAD fallback");
  assert.match(conventions, /base:.*plan\.toon/, "Conventions must persist base in plan.toon");
});

test("no hard-coded 'main' in git commands of gsd-verify or gsd-executing-plans (P0-b)", () => {
  for (const skillName of ["gsd-verify", "gsd-executing-plans"]) {
    const content = readSkill(skillName);
    assert.doesNotMatch(content, /git diff main/, `${skillName}: diff must use <base>, not literal main`);
    assert.doesNotMatch(content, /git checkout main/, `${skillName}: checkout must use <base>, not literal main`);
    assert.doesNotMatch(content, /commit to main/, `${skillName}: commit target must be <base>, not main`);
    assert.match(content, /<base>/, `${skillName}: must reference <base>`);
  }
});

test("verify and to-plan operationalize base: as writer/consumer (P0-b)", () => {
  const verify = readSkill("gsd-verify");
  assert.match(verify, /base:.*plan\.toon|read.*base.*plan\.toon/i, "verify must read base: from plan.toon");
  const toPlan = readSkill("gsd-to-plan");
  assert.match(toPlan, /base:<base>/, "to-plan must show base:<base> in format example");
  assert.match(toPlan, /base:.*default branch/, "to-plan must document the base: line");
});

test("ponytail toggle goes through /gsd, not /gsd-ponytail (P0-a)", () => {
  const ponytail = readSkill("gsd-ponytail");
  assert.doesNotMatch(ponytail, /\/gsd-ponytail/, "ponytail must not present /gsd-ponytail as a user command");
  assert.match(ponytail, /\/gsd ponytail/, "ponytail toggle must route through /gsd");
});

test("end-session suggestions do not expose /gsd-* as user commands (P0-a)", () => {
  const gsd = readSkill("gsd");
  const suggestions = gsd.split("End-session")[1] || "";
  assert.doesNotMatch(suggestions, /routes to \/gsd-/, "end-session must not show /gsd-* route labels");
});

test("master does not say sub-skills are directly user-invokable (P0-a)", () => {
  const gsd = readSkill("gsd");
  assert.doesNotMatch(gsd, /any skill is also directly invokable/, "master must not claim /gsd-* are user commands");
  assert.match(gsd, /internal routing targets, not user commands/, "master must clarify sub-skills are agent-internal");
});

test("master documents registered skill:// loading with read fallback (P0-c)", () => {
  const gsd = readSkill("gsd");
  assert.match(gsd, /`skill:\/\/gsd-<sub>`, registered/, "hard rule must name the registered skill:// path first");
  assert.match(gsd, /`skill:\/\/` can't resolve a `gsd-<sub>`/, "fallback must trigger only when skill:// can't resolve");
});

test("master has a safe feature-cleanup flow (P2)", () => {
  const gsd = readSkill("gsd");
  const cleanup = gsd.split("Feature cleanup")[1]?.split("## ")[0] || "";
  assert.ok(cleanup.length > 0, "master must have a Feature cleanup section");
  assert.match(cleanup, /REFERENCE\.md/, "master cleanup must point at the load-on-demand flow");
  const ref = readFileSync(join(SKILLS_DIR, "gsd", "REFERENCE.md"), "utf8");
  const flow = ref.split("Feature cleanup")[1] || "";
  assert.match(flow, /git checkout <base>/, "cleanup must checkout <base> before deleting the WIP branch");
  assert.match(flow, /git branch -d/, "cleanup must prefer safe delete (-d) first");
  assert.match(flow, /-D.*force/i, "cleanup must only use -D after explicit force confirmation");
  assert.match(flow, /dirty|status/i, "cleanup must check git status before proceeding");
});

test("handoff format declares schema version (P3)", () => {
  const handoff = readSkill("gsd-handoff");
  assert.match(handoff, /schema:v1/, "handoff format must include schema:v1 header");
});

test("quick-fix path captures <base> before branching (P0-b)", () => {
  const gsd = readSkill("gsd");
  const fastPaths = gsd.split("Fix fast-paths")[1]?.split("## ")[0] || "";
  const quickFix = fastPaths.split("Quick-fix")[1] || "";
  assert.match(quickFix, /capture.*<base>/i, "quick-fix must capture <base> before branching");
  assert.match(quickFix, /base:<base>/, "quick-fix must write base:<base> in plan.toon");
});

test("master handles ponytail manual toggle explicitly (P0-a)", () => {
  const gsd = readSkill("gsd");
  const triggers = gsd.split("## Triggers")[1]?.split("## ")[0] || "";
  assert.match(triggers, /Manual toggle/i, "master must handle ponytail manual toggle");
  assert.match(triggers, /stop ponytail|normal mode/i, "master must handle ponytail stop/normal");
});

test("master has universal clarify-when-materially-ambiguous principle", () => {
  const gsd = readSkill("gsd");
  const engine = gsd.split("## Smart Routing Engine")[1] || gsd;
  assert.match(engine, /clarify.*ambiguous|ambiguous.*clarif/i, "must have clarify-when-materially-ambiguous principle");
  assert.match(engine, /all routes|regardless of route/i, "principle must apply to all routes, not just Discussion");
  assert.match(engine, /safe default/i, "must say proceed-with-safe-default when not materially ambiguous");
});

test("master has intent-signal table with frontmatter-derived aliases", () => {
  const gsd = readSkill("gsd");
  const engine = gsd.split("## Smart Routing Engine")[1]?.split("## Scope discipline")[0] || gsd;
  // Table exists with the right header
  assert.match(engine, /intent signal/i, "must have intent-signal section");
  assert.match(engine, /\| Prompt asks to/i, "must have a signal table");
  // Key aliases from sub-skill frontmatter
  assert.match(engine, /diagnose.*debug|debug.*diagnose/i, "must include diagnose/debug aliases");
  assert.match(engine, /review.*verify|verify.*review/i, "must include verify/review aliases");
  assert.match(engine, /audit.*refactor|refactor.*audit/i, "must include audit/refactor aliases");
  assert.match(engine, /domain.*glossary|glossary.*domain/i, "must include domain/glossary aliases");
});

test("signal table splits resume (read) vs pause/save (write)", () => {
  const gsd = readSkill("gsd");
  const engine = gsd.split("## Smart Routing Engine")[1]?.split("## Scope discipline")[0] || gsd;
  assert.match(engine, /resume.*read|read.*resume/i, "resume must map to handoff read");
  assert.match(engine, /pause.*save.*write|save.*pause.*write/i, "pause/save must map to handoff write");
});

test("signal table has mention-is-not-ask guard and signals-precede-Route-0 rule", () => {
  const gsd = readSkill("gsd");
  assert.match(gsd, /mentioning.*passing|passing.*mention/i, "must warn that mention ≠ ask");
  assert.match(gsd, /signals precede route 0/i, "must state signals-precede-Route-0 rule");
  // TDD/ponytail must NOT be routes
  assert.match(gsd, /TDD.*preference|preference.*TDD/i, "TDD must be noted as preference, not route");
});

test("signal table frames lavish as ask-first launch-on-accept, not a route", () => {
  const gsd = readSkill("gsd");
  const engine = gsd.split("## Smart Routing Engine")[1]?.split("## Scope discipline")[0] || gsd;
  // The row must map the lavish aliases to the meta lane (gsd-lavish), not a numbered route.
  const lavishRow = engine.split("\n").find(l => l.includes("gsd-lavish") && l.includes("|")) || "";
  assert.match(lavishRow, /visual report|render this|HTML artifact/i, "signal row must carry the lavish aliases");
  assert.match(lavishRow, /meta/, "signal row must map lavish to the meta lane, not a numbered route");
  // The signal note must carry ask-first / launch-on-accept framing, not bare opt-in that re-seeds silence.
  assert.match(engine, /ask first/i, "signal note must state lavish asks first on an offer-eligible deliverable");
  assert.match(engine, /launch|launches/i, "signal note must distinguish launching from asking");
  assert.match(engine, /accept|explicit request|picking the offer/i, "signal note must gate launching on the user accepting");
});

test("Route 4 signal row excludes bare 'error' (obvious errors stay Route 0)", () => {
  const gsd = readSkill("gsd");
  const engine = gsd.split("## Smart Routing Engine")[1]?.split("## Scope discipline")[0] || gsd;
 const r4Row = engine.split("\n").find(l => l.includes("gsd-diagnosing-bugs") && l.includes("|")) || "";
  assert.ok(!/\berror\b/.test(r4Row), "Route 4 row must NOT contain bare 'error' — obvious errors are Route 0");
  assert.match(r4Row, /non-obvious/i, "stack-trace qualifier must say 'non-obvious'");
  // Routing examples must show the negative case
  assert.match(gsd, /obvious error.*→ 0/i, "examples must show obvious error → Route 0");
});

test("gsd description is keyword-rich for harness auto-discovery", () => {
  const gsd = readSkill("gsd");
  const desc = gsd.match(/^description:\s*(.+)$/m)?.[1] || "";
  // Must cover the main coding intents so harness auto-suggests /gsd
  assert.match(desc, /debug/i, "description must mention debugging");
  assert.match(desc, /review/i, "description must mention code review");
  assert.match(desc, /architect|refactor/i, "description must mention architecture/refactoring");
  assert.match(desc, /test/i, "description must mention testing");
  assert.match(desc, /domain model/i, "description must mention domain modeling");
  assert.match(desc, /\/gsd/i, "description must say the command is /gsd");
});

test("intent-signal table has all 9 rows with correct route+skill mapping (table-scoped)", () => {
  const gsd = readSkill("gsd");
  // Isolate ONLY the table region: between header and the footnote/Route 0
  const tableStart = gsd.indexOf("| Prompt asks to");
  const tableEnd = gsd.indexOf("*TDD");
  assert.ok(tableStart > 0 && tableEnd > tableStart, "signal table region must exist");
  const table = gsd.slice(tableStart, tableEnd);
  // Each row: signal keywords → correct route number + skill name
  assert.match(table, /review.*2.*gsd-verify/i, "row 1: review → 2 · gsd-verify");
  assert.match(table, /diagnose.*4.*gsd-diagnosing-bugs/i, "row 2: diagnose → 4 · gsd-diagnosing-bugs");
  assert.match(table, /audit.*5.*gsd-improve/i, "row 3: audit → 5 · gsd-improve-codebase-architecture");
  assert.match(table, /design.*5.*gsd-codebase-design/i, "row 4: design → 5 · gsd-codebase-design");
  assert.match(table, /domain.*5.*gsd-domain-modeling/i, "row 5: domain → 5 · gsd-domain-modeling");
  assert.match(table, /resume.*1.*gsd-handoff/i, "row 6: resume → 1 · gsd-handoff");
  assert.match(table, /pause.*meta.*gsd-handoff/i, "row 7: pause → meta · gsd-handoff");
  assert.match(table, /lavish.*meta.*gsd-lavish/i, "row 8: lavish → meta · gsd-lavish");
  assert.match(table, /list skills.*meta.*skill catalog/i, "row 9: capability discovery → meta · skill catalog");
  // Route 4 row must NOT contain bare 'error' (table-scoped, not whole-engine)
  const r4Row = table.split("\n").find(l => l.includes("gsd-diagnosing-bugs")) || "";
  assert.ok(!/\berror\b/.test(r4Row), "Route 4 row must NOT contain bare 'error'");
});

test("master covers multi-feature resume rule (most-recently-modified + name it)", () => {
  const gsd = readSkill("gsd");
  assert.match(gsd, /most-recently-modified/i, "must say resume most-recently-modified feature");
  assert.match(gsd, /name it in.*first line|name.*redirect/i, "must tell agent to name the feature so user can redirect");
});

test("master requires Step 0 state detection before route matching", () => {
  const gsd = readSkill("gsd");
  assert.match(gsd, /Step 0.*Detect state/i, "must have Step 0 state-first detection");
  assert.match(gsd, /workspace state.*drives/i, "must say workspace state drives routing");
});

test("master documents spec-gap feedback loops (sub-skills route back to Discussion)", () => {
  const gsd = readSkill("gsd");
  assert.match(gsd, /spec.*gap|spec.*flawed|spec escalation/i, "must document spec-gap/spec-escalation feedback");
  assert.match(gsd, /route.*back.*gsd|routes back.*discussion/i, "must say sub-skills route back to gsd Discussion");
});

test("gsd-verify blocks merge on Critical/Important findings", () => {
  const verify = readSkill("gsd-verify");
  assert.match(verify, /critical/i, "must mention Critical verdict");
  assert.match(verify, /important/i, "must mention Important verdict");
  assert.match(verify, /block/i, "must say it blocks the merge");
});

// ── Gap tests added by the third gsd-audit pass ──────────

test("gsd-verify defines a standalone Route 2 review mode (read-only, no merge)", () => {
  const verify = readSkill("gsd-verify");
  assert.match(verify, /## Standalone review/, "must split Route 2 review from the WIP gate");
  assert.match(verify, /review-and-report only, read-only/, "standalone mode must be read-only report-only");
  assert.match(verify, /apply only to the WIP-branch gate/, "merge mechanics must be scoped to the WIP gate");
});

test("gsd-verify spec-compliance excludes superseded ACs", () => {
  assert.match(readSkill("gsd-verify"), /non-superseded acceptance criterion/);
});

test("missing reviewer degrades to self-review with unchanged blocking semantics", () => {
  const verify = readSkill("gsd-verify");
  assert.match(verify, /No `reviewer` subagent/, "verify must state the no-reviewer fallback");
  assert.match(verify, /same blocking semantics/, "degraded self-review must not weaken the gate");
  const exec = readSkill("gsd-executing-plans");
  assert.match(exec, /No subagents in the harness/, "executing-plans must state the no-subagent fallback");
  assert.match(exec, /same blocking semantics/, "inline execution must keep the verdict contract");
  assert.match(readSkill("gsd"), /`task`\/`reviewer` subagents/, "master degradation line must cover subagents");
});

test("executing-plans resumes an existing wip branch and creates from persisted base", () => {
  const exec = readSkill("gsd-executing-plans");
  assert.match(exec, /branch already exists/, "must handle resume/rerun when wip/<feature> exists");
  assert.match(exec, /git checkout wip\/<feature>/, "must check out the existing branch, not recreate it");
  assert.match(exec, /git checkout -b wip\/<feature> <base>/, "creation must start from the persisted base");
  assert.match(exec, /never recapture/, "a present base: is authoritative");
});

test("test:none is defined by to-plan and adapted by the per-task review", () => {
  const plan = readSkill("gsd-to-plan");
  assert.match(plan, /test-exempt covers ONLY docs\/comments\/metadata or mechanically verifiable non-behavioral/i,
    "to-plan must bound the exemption");
  assert.match(plan, /alters runtime behavior \(including config\)/, "behavior-altering config is not exempt");
  const exec = readSkill("gsd-executing-plans");
  assert.match(exec, /`test:none` task .*drops the TDD check/, "per-task review must adapt for test:none");
});

test("master right-sizes the recommendation and spec to the ask (anti-over-engineering)", () => {
  const master = readSkill("gsd");
  assert.match(master, /smallest approach that meets the ask/, "must default to the smallest sufficient approach");
  assert.match(master, /Never pad a spec with speculative scope/, "must forbid speculative spec padding");
});

test("conflict escalation has no hard harness coupling (irc optional)", () => {
  const exec = readSkill("gsd-executing-plans");
  assert.match(exec, /surface it to the user/, "escalation must target the user/parent, not a specific tool");
  assert.match(exec, /where the harness has one/, "irc must be optional, not assumed");
});

test("ponytail auto-fire is scoped to the fix; only the explicit toggle persists", () => {
  const p = readSkill("gsd-ponytail");
  assert.match(p, /scoped to that fix only/, "auto-fire must not leak past the quick-fix");
  assert.match(p, /explicit toggle/, "persistence belongs to the explicit toggle");
  assert.match(p, /never silently minimizes the next, unrelated prompt/);
});

test("to-plan calibrates detail: rows are pointers, task-brief carries the how", () => {
  const plan = readSkill("gsd-to-plan");
  assert.match(plan, /Rows are pointers, not payloads/, "plan detail must live in spec + dispatch-time brief");
  assert.match(plan, /task needing a paragraph .*is two tasks/i, "must cap per-task detail");
});

test("large features split into milestone features, never one giant plan", () => {
  const plan = readSkill("gsd-to-plan");
  assert.match(plan, /~10 tasks/, "to-plan must name a size smell");
  assert.match(plan, /milestone features \(`<feature>-m1`/, "to-plan must route back to gsd for the split");
  const master = readSkill("gsd");
  assert.match(master, /Large feature → milestone specs/, "master Convergence must own the split");
  assert.match(master, /landing on `<base>` before the next/, "milestones must merge sequentially, not stack branches");
});

test(".scratch is git-ignored so resume survives branch switches", () => {
  const master = readSkill("gsd");
  assert.match(master, /`\.scratch\/` is \*\*git-ignored\*\*/, "Conventions must declare .scratch untracked");
  assert.match(master, /breaks cross-branch resume/, "must state the load-bearing reason");
});

test("REFERENCE.md carries load-on-demand payloads; master links but never duplicates them", () => {
  const ref = readFileSync(join(SKILLS_DIR, "gsd", "REFERENCE.md"), "utf8");
  assert.match(ref, /## spec\.md — template & rules/, "spec template section must exist");
  assert.match(ref, /## Acceptance Criteria/, "the template itself must live in REFERENCE");
  assert.match(ref, /checkable/, "AC rules move with the template");
  assert.match(ref, /## Milestones/, "full milestone rule must live in REFERENCE");
  assert.match(ref, /## Feature cleanup/, "cleanup flow must live in REFERENCE");
  assert.match(ref, /## Post-approval pipeline contract/, "canonical post-approval pipeline contract must live in REFERENCE");
  const master = readSkill("gsd");
  assert.match(master, /\[REFERENCE\.md\]\(REFERENCE\.md\)/, "master must markdown-link REFERENCE.md (loaded on route, not at entry)");
  assert.ok(!/## Acceptance Criteria/.test(master), "spec template must not be duplicated in master");
});

test("portable handoff: scratch travels via wip branch with full hygiene", () => {
  const handoff = readSkill("gsd-handoff");
  assert.match(handoff, /## Portable handoff/, "handoff must define the cross-machine mode");
  assert.match(handoff, /git checkout wip\/<feature>/, "sync must sit on the wip branch first");
  assert.match(handoff, /git add -f \.scratch\/<feature>\//, "sync must force-add the ignored scratch");
  assert.match(handoff, /chore\(gsd\): wip snapshot/, "portable handoff must snapshot uncommitted mid-task code");
  assert.match(handoff, /Never snapshot silently/, "snapshot must be consent-gated, not automatic");
  assert.match(handoff, /\*\*skip\*\* — dirty code stays local/, "dirty files must not block scratch sync (skip option)");
  assert.match(handoff, /:\(exclude\)\.scratch/, "snapshot commit must exclude scratch (scratch has its own commit)");
  assert.match(handoff, /-- \.scratch\/<feature>/, "sync commit must be pathspec'd to scratch only");
  assert.match(handoff, /git push/, "portable handoff must push the wip branch");
  const verify = readSkill("gsd-verify");
  assert.match(verify, /git rm -r --cached --ignore-unmatch \.scratch\/<feature>/, "strip must be a safe no-op on non-portable runs");
  assert.match(verify, /:\(exclude\)\.scratch/, "terminal reviewer diff must exclude scratch paths");
  const exec = readSkill("gsd-executing-plans");
  assert.match(exec, /:\(exclude\)\.scratch/, "per-task review diff must exclude scratch paths");
  assert.match(exec, /never stage `\.scratch\/` in a task commit/, "task commits must be code-only");
  const master = readSkill("gsd");
  assert.match(master, /machine-local/, "Conventions must state scratch is machine-local by default");
  assert.match(master, /git switch --track origin\/wip\/<feature>/, "Step 0 must recover remote-only wip branches");
  assert.match(master, /git fetch --prune/, "Step 0 must fetch before listing remote wip branches");
});

test("autosync: opt-in toggle persisted via settings[], synced per pause and per task", () => {
  const handoff = readSkill("gsd-handoff");
  assert.match(handoff, /\*\*Autosync\*\* — `\/gsd autosync on\|off`, \*\*tri-state\*\*/, "autosync must be tri-state: unset asks, on syncs, off stays quiet");
  assert.match(handoff, /unset \(no `settings\[\]` row, the default\) = ask-once/, "unset must trigger the ask-once, not silence");
  assert.match(handoff, /`off` = remembered decline, no asking/, "explicit off must be durable and never re-ask");
  assert.match(handoff, /\*\*Ask-once on first pause\*\*/, "first pause must offer the sync choice");
  assert.match(handoff, /yes \/ no \/ always/, "ask-once must offer one-time, decline, and persistent options");
  assert.match(handoff, /skips the question — it IS the consent/, "cross-machine phrasing must bypass the ask-once");
  assert.match(handoff, /`autosync,on` and `autosync,off` are both explicit user choices worth a row/, "settings note must allow the explicit off row");
  assert.match(handoff, /[Pp]ersisted like `ponytail_level` via `settings\[\]`/, "autosync must reuse the settings[] persistence contract");
  assert.match(handoff, /Requires a remote: none → stay machine-local and say so/, "autosync must degrade gracefully without a remote");
  assert.match(handoff, /active non-default toggles only/, "settings template rows must be marked as examples, not defaults");
  assert.match(handoff, /omit the table entirely when nothing is toggled/, "settings table must be omitted when no toggle is active");
  const exec = readSkill("gsd-executing-plans");
  assert.match(exec, /\*\*Autosync on\*\* \(handoff `settings\[\]`\)/, "executing-plans must re-sync scratch per task when autosync is on");
  const master = readSkill("gsd");
  assert.match(exec, /iff dirty/, "autosync must guard the scratch commit on dirtiness");
  assert.match(exec, /\*\*always\*\* `git push`/, "push must be unconditional so code commits travel");
  assert.match(master, /"autosync on\/off" → persist the explicit row/, "master must intercept the autosync toggle like ponytail");
  assert.match(master, /never cleared back to unset/, "explicit off must persist as a row, not clear to unset");
  assert.match(exec, /No remote → skip the sync\/push and stay machine-local/, "per-task autosync must degrade without a remote, not error");
});

test("pre-plan portable handoff: base survives the machine switch", () => {
  const handoff = readSkill("gsd-handoff");
  assert.match(handoff, /no wip branch yet \(paused before execution/, "portable step 1 must bootstrap the wip branch pre-plan");
  assert.match(handoff, /record `base,<base>` in this handoff's `settings\[\]`/, "bootstrapped base must persist in the handoff settings");
  assert.match(handoff, /pre-plan portable sync records `base,<branch>`/, "settings note must carve out the base row exception");
  assert.match(handoff, /restore the toggle `settings\[\]` values \(`ponytail_level`, `autosync`\)/, "resume must restore only real toggles");
  assert.match(handoff, /A `base` row is metadata, not a toggle — don't "restore" it/, "base row must not be restored as a session toggle");
  const toPlan = readSkill("gsd-to-plan");
  assert.match(toPlan, /read the `base` row from the latest handoff `settings\[\]`, never the wip branch itself/, "to-plan must source base from the handoff when already on wip");
  const master = readSkill("gsd");
  assert.match(master, /or a `wip\/\*` branch/, "capture chain must treat show-current on wip/* as invalid");
  assert.match(master, /`base` row in the latest handoff `settings\[\]`/, "capture chain must fall back to the handoff base row");
});

test("sub-skill loading is imperative: route = load skill, catalog on capability asks", () => {
  const gsd = readSkill("gsd");
  assert.match(gsd, /\*\*Route = load the sub-skill \(hard rule\)\.\*\*/, "master must open with the route-equals-load hard rule");
  assert.match(gsd, /never execute a sub-flow from memory or from its one-line description/, "rule must forbid acting from summaries");
  assert.match(gsd, /\*\*Load timing:\*\*/, "loading section must state when to load the sub-skill file");
  assert.doesNotMatch(gsd, /discovered by reading files, not by the harness/, "stale sibling-only discovery claim must be gone");
  assert.match(gsd, /enumerate the registered `gsd-\*` skills/, "catalog must prefer registered skills over path glob");
  assert.match(gsd, /partial install → glob `\$SKILLS_DIR\/gsd-\*\/SKILL\.md`/, "path glob must be the partial-install fallback only");
  assert.match(gsd, /Never answer from this file's System map alone/, "catalog must come from skill files, not the system map");
  assert.match(gsd, /very next tool call/, "route trace must be followed immediately by loading the target skill");
  assert.doesNotMatch(gsd, /make reading that skill's SKILL\.md/, "trace rule must load via skill://, not force a file-read turn");
  assert.match(gsd, /`skill:\/\/gsd-<sub>`; `read` fallback only if unresolved/, "trace rule must name skill:// first with read as fallback");
});

test("all skills registered: sub-skills declare internality and a direct-invocation guard", () => {
  const sh = readFileSync(join(ROOT, "install.sh"), "utf8");
  assert.match(sh, /for dir in "\$REPO"\/skills\/gsd\*/, "install.sh must loop over every skills/gsd* dir");
  assert.match(sh, /ln -sfn "\$dir" "\$REG\/\$\(basename "\$dir"\)"/, "install.sh must symlink each skill into the registry");
  assert.doesNotMatch(sh, /\[ -L "\$link" \] && rm/, "install.sh must not unregister sub-skills anymore");
  for (const name of listSkillDirs()) {
    if (name === "gsd") continue;
    const c = readSkill(name);
    assert.match(c, /Internal GSD sub-skill \(routed via \/gsd\)/, `${name} description must declare internality`);
    assert.match(c, /Direct invocation guard/, `${name} must carry the direct-invocation guard`);
  }
});

test("System map names every sub-skill on disk (discovery completeness)", () => {
  const gsd = readSkill("gsd");
  const map = gsd.split("## System map")[1]?.split("## Smart Routing Engine")[0] || "";
  for (const name of listSkillDirs()) {
    if (name === "gsd") continue;
    assert.ok(map.includes("`" + name + "`"), `${name} must be listed in the master System map — an installed but unlisted skill is invisible to /gsd discovery and the skill catalog`);
  }
});

test("eval harness: fixtures well-formed, routes valid, target skills exist", () => {
  const fixtures = JSON.parse(readFileSync(join(ROOT, "test", "eval", "fixtures.json"), "utf8"));
  assert.ok(fixtures.length >= 10, "eval needs a meaningful fixture set");
  const dirs = new Set(listSkillDirs());
  const routes = new Set(["0", "1", "2", "3", "4", "5", "6", "meta"]);
  for (const fx of fixtures) {
    for (const want of [fx, ...(fx.accept ?? [])]) {
      assert.ok(routes.has(want.route), `${fx.id}: invalid route ${want.route}`);
      assert.ok(
        want.skill === "none" || want.skill === "catalog" || dirs.has(want.skill),
        `${fx.id}: expected skill ${want.skill} does not exist on disk`,
      );
    }
    assert.ok(fx.id && fx.state && fx.prompt, `fixture missing id/state/prompt`);
  }
  // Runner stays opt-in: present, but never picked up by `node --test` (not *.test.js).
  assert.ok(existsSync(join(ROOT, "test", "eval", "route-eval.mjs")));
});

test("install.sh auto-builds lavish when pnpm exists, degrades to terminal otherwise", () => {
  const sh = readFileSync(join(ROOT, "install.sh"), "utf8");
  assert.match(sh, /command -v pnpm/, "build must be gated on pnpm availability");
  assert.match(sh, /! -f "\$LAVISH\/dist\/cli\.mjs"/, "build must fire only when dist/cli.mjs is missing");
  assert.match(sh, /build failed[^\n]*degrade to terminal/, "a failed build must warn and degrade, not abort the install");
  assert.match(sh, /LAVISH_STATE/, "final echo must report the real lavish state");
});

test("content audit: per-task diff base, bounded fix loop, executable squash, lavish degradation", () => {
  const exec = readSkill("gsd-executing-plans");
  assert.match(exec, /TASK_BASE=\$\(git rev-parse HEAD\)/, "per-task review diff base must be recorded before dispatch, distinct from the branch base:");
  assert.doesNotMatch(exec, /git diff <BASE>/, "the ambiguous <BASE> placeholder (colliding with base:) must be gone");
  assert.match(exec, /two fix rounds[^\n]*gsd-diagnosing-bugs/, "the per-task fix loop must be bounded with an escalation");
  const verify = readSkill("gsd-verify");
  assert.match(verify, /git checkout <base>` → `git merge --squash wip\/<feature>`/, "the squash must be an exact executable sequence");
  const lavish = readSkill("gsd-lavish");
  assert.match(lavish, /\$CLI` missing[\s\S]{0,80}Degrade to terminal/, "lavish must define its own missing-CLI degradation");
  const domain = readSkill("gsd-domain-modeling");
  assert.match(domain, /created \*\*only\*\* when a second context appears/, "CONTEXT-MAP.md must have a concrete creation trigger");
  // The map must carry a schema + read/selection rule, not just a trigger — else it's a declared-but-shapeless artifact.
  assert.match(domain, /# Context Map[\s\S]*\| Context \| Glossary \| Owns \|/, "CONTEXT-MAP.md must show its table schema, not just name the file");
  assert.match(domain, /docs\/context\/<area>\/CONTEXT\.md/, "map must define the per-area glossary path convention");
  assert.match(domain, /consult it first and pick the relevant area/, "map must carry a read/selection rule, not just an index");
});

test("to-plan prints an inline plan summary and asks one approval question after writing plan.toon", () => {
  const toPlan = readSkill("gsd-to-plan");
  assert.match(toPlan, /## Plan summary \+ approval gate/, "to-plan must have a mandatory summary+approval section");
  assert.match(toPlan, /the user never has to open the file/, "summary must remove the need to read plan.toon");
  assert.match(toPlan, /One line per task/, "summary must enumerate tasks");
  assert.match(toPlan, /AC coverage/, "summary must report AC coverage");
  assert.match(toPlan, /\*\*one approval question\*\*/, "exactly one approval ask, no interview");
  assert.match(toPlan, /last prompt of the cycle/, "approval must be the final human gate");
});

test("canonical post-approval pipeline contract defines approval-to-merge behavior (AC-1)", () => {
  const ref = readFileSync(join(SKILLS_DIR, "gsd", "REFERENCE.md"), "utf8");
  const contract = extractPeerSection(ref, "Post-approval pipeline contract");
  assert.match(contract, /Approval is the last prompt/, "approval must be defined as the final human gate");
  assert.match(contract, /Hands-free after approval/, "contract must require hands-free execution after approval");
  assert.match(contract, /`gsd-executing-plans`[\s\S]*`gsd-verify`/, "hands-free path must run through execute and verify");
  assert.match(contract, /Pass merges automatically/, "passing terminal gate must auto-merge");
  assert.match(contract, /squash-merges `wip\/<feature>` to `<base>`/, "merge must be a squash to base");
  assert.match(contract, /spec flaws\/escalations/, "spec flaws must stop the pipeline");
  assert.match(contract, /unresolvable conflicts/, "unresolvable conflicts must stop the pipeline");
  assert.match(contract, /non-converging task or verify fix loops/, "non-converging fix loops must stop the pipeline");
  assert.match(contract, /Critical\/Important review findings/, "Critical/Important findings must stop the pipeline");
  assert.match(contract, /red build\/test suite/, "red build/test suite must stop the pipeline");
  assert.match(contract, /failing\/unrunnable required E2E/, "failing or unrunnable E2E must stop the pipeline");
  assert.match(contract, /does not merge/, "blockers must prevent merging");
});

test("pipeline skills consume canonical post-approval contract without owning divergent full definitions (AC-2)", () => {
  const ref = readFileSync(join(SKILLS_DIR, "gsd", "REFERENCE.md"), "utf8");
  assert.match(ref, /## Post-approval pipeline contract/, "reference must own the canonical contract");
  const consumers = ["gsd", "gsd-to-plan", "gsd-executing-plans", "gsd-verify"];
  for (const name of consumers) {
    const content = readSkill(name);
    assert.match(content, /Post-approval pipeline contract/, `${name} must reference the canonical contract`);
  }
  const allSkillText = consumers.map((name) => readSkill(name)).join("\n");
  assert.equal((allSkillText.match(/## Post-approval pipeline contract/g) || []).length, 0, "pipeline skill files must not duplicate the canonical section heading");
  const exec = readSkill("gsd-executing-plans");
  assert.match(exec, /## Auto-pilot \(canonical contract implementation\)/, "exec must locally implement the canonical contract");
  assert.match(exec, /no questions, confirmations, or end-of-response menus/i, "exec must forbid mid-pipeline prompts");
  assert.match(exec, /invoke `gsd-verify` \*\*immediately\*\*/, "terminal gate must fire without a prompt");
  const verify = readSkill("gsd-verify");
  assert.match(verify, /## WIP-branch gate — non-interactive/, "verify must declare the WIP gate non-interactive");
  assert.match(verify, /Never ask permission to merge/, "pass must merge without asking");
  assert.match(verify, /report the findings, the build\/suite result, the E2E outcome, and the final commit/, "no-prompt must not mean no visibility");
  assert.match(verify, /Standalone review \(Route 2, above\) is unaffected/, "Route 2 must stay read-only, never merging");
});

test("canonical contextual disclosure templates cover every surface (AC-3)", () => {
  const ref = readFileSync(join(SKILLS_DIR, "gsd", "REFERENCE.md"), "utf8");
  const templates = extractPeerSection(ref, "Contextual disclosure templates");
  assert.match(templates, /### Master end-session menu/, "master numbered menu template must be canonical");
  assert.match(templates, /Next steps \(reply with number or text\):/, "master menu must be numbered human choices");
  assert.match(templates, /### Direct sub-skill Next steps/, "direct sub-skill template must be canonical");
  assert.match(templates, /Next steps:\n- \/gsd/, "direct sub-skill template must use technical command bullets");
  assert.match(templates, /### Post-approval pipeline progress/, "pipeline progress template must be canonical");
  assert.match(templates, /<phase>: <observable fact>\. Next: <automatic next action>\./, "pipeline progress must be status, not a choice");
  assert.match(templates, /### Blocker stop/, "blocker stop template must be canonical");
  assert.match(templates, /Blocked at <task\/gate>: <why>/, "blockers must name where and why they stopped");
  assert.match(templates, /Stopped before merge; <base> is unchanged/, "blockers must explicitly preserve base");
  assert.match(templates, /### Standalone review\/report surface/, "standalone review/report template must be canonical");
  assert.match(templates, /Review report:[\s\S]*Verdict:[\s\S]*Findings:/, "standalone reports must have verdict and findings fields");
});

test("skills consume contextual disclosure templates consistently (AC-4)", () => {
  const master = readSkill("gsd");
  assert.match(master, /Contextual disclosure templates/, "master must reference canonical disclosure templates");
  assert.match(master, /Master end-session menu/, "master must use the master menu template");
  assert.match(master, /"Start executing tasks" is never a menu item/, "master must forbid manual execute menu items");

  const toPlan = readSkill("gsd-to-plan");
  assert.match(toPlan, /Contextual disclosure templates/, "to-plan must reference canonical disclosure templates");
  assert.match(toPlan, /one approval question/, "to-plan must keep one approval prompt");
  assert.match(toPlan, /no further menus or offers after approval/, "to-plan must preserve post-approval no-menu semantics");

  const exec = readSkill("gsd-executing-plans");
  assert.match(exec, /Post-approval pipeline progress/, "exec must use pipeline progress template");
  assert.match(exec, /Blocker stop/, "exec must use blocker stop template");
  assert.match(exec, /no `Next steps:`/, "exec must forbid mid-pipeline Next steps prompts");
  assert.match(exec, /invoke `gsd-verify` \*\*immediately\*\*/, "exec must proceed to verify without manual start/continue prompt");

  const verify = readSkill("gsd-verify");
  assert.match(verify, /Standalone review\/report surface/, "verify Route 2 must use standalone report template");
  assert.match(verify, /Post-approval pipeline progress/, "verify WIP gate must use pipeline progress template");
  assert.match(verify, /Blocker stop/, "verify WIP gate must use blocker stop template");
  assert.match(verify, /Never ask permission to merge/, "verify must not ask for a manual post-verify merge");
  assert.doesNotMatch(verify, /git checkout <base> \(to merge/, "verify must not disclose a manual merge command");

  const handoff = readSkill("gsd-handoff");
  assert.match(handoff, /Contextual disclosure templates → Direct sub-skill Next steps/, "handoff must use direct sub-skill template");
  assert.match(handoff, /Inline firing from `\/gsd` appends nothing/, "handoff must not append inline disclosure");
});

test("canonical lavish opt-in gate taxonomy distinguishes all required modes (AC-5)", () => {
  const ref = readFileSync(join(SKILLS_DIR, "gsd", "REFERENCE.md"), "utf8");
  const taxonomy = extractPeerSection(ref, "Lavish opt-in gate taxonomy");
  assert.match(taxonomy, /Explicit acceptance = launch consent/, "taxonomy must define explicit acceptance as launch consent");
  assert.match(taxonomy, /Offer-eligible deliverable/, "taxonomy must define offer-eligible deliverables");
  assert.match(taxonomy, /Post-approval pipeline no-offer mode/, "taxonomy must define no-offer pipeline mode");
  assert.match(taxonomy, /Graceful terminal degradation/, "taxonomy must define graceful terminal degradation");
  assert.match(taxonomy, /Both checks must hold/, "taxonomy must retain the 2-part Fire gate");
  assert.match(taxonomy, /Inline Q&A[\s\S]*never offer-eligible/, "inline Q&A must not be eligible for lavish offers");
  assert.match(taxonomy, /Missing CLI[\s\S]*degrades to[\s\S]*terminal prose/, "missing lavish capability must degrade to terminal prose");
});

test("skills consume lavish opt-in taxonomy without post-approval prompt drift (AC-6)", () => {
  const consumers = ["gsd-lavish", "gsd-to-plan", "gsd-verify", "gsd-improve-codebase-architecture"];
  for (const name of consumers) {
    const content = readSkill(name);
    assert.match(content, /Lavish opt-in gate taxonomy/, `${name} must reference the canonical taxonomy`);
  }

  const lavish = readSkill("gsd-lavish");
  assert.match(lavish, /Fire gate \(both must hold\)/, "gsd-lavish must keep the Fire gate local implementation");
  assert.match(lavish, /post-approval pipeline no-offer mode[\s\S]*asking is forbidden/i, "gsd-lavish must not prompt in pipeline no-offer mode");
  assert.match(lavish, /Degrade to terminal/, "gsd-lavish must keep terminal degradation");

  const toPlan = readSkill("gsd-to-plan");
  assert.match(toPlan, /After the approval question is answered, post-approval pipeline no-offer mode begins/, "to-plan must start no-offer mode after approval");

  const verify = readSkill("gsd-verify");
  assert.match(verify, /post-approval\) is no-offer mode/, "verify must treat WIP gate as no-offer mode");
  assert.match(verify, /offer nothing/, "verify must not offer lavish mid-pipeline");
  assert.match(verify, /Standalone review[\s\S]*offer-eligible/, "standalone verify reports may still be offer-eligible");

  const architecture = extractPeerSection(readSkill("gsd-improve-codebase-architecture"), "2. Present candidates — terminal default, lavish offer when eligible");
  assert.match(architecture, /Before plan approval[\s\S]*MUST surface the lavish option/i, "architecture audits must proactively surface lavish pre-approval when offer-eligible and both Fire gate checks hold");
  assert.match(architecture, /post-approval pipeline no-offer mode is not active/i, "architecture audits must respect post-approval no-offer mode");
  assert.match(architecture, /An offer is not launch consent/i, "an eligible lavish offer must not count as consent to launch");
  assert.match(architecture, /launch `gsd-lavish` only after explicit opt-in/i, "architecture audits must launch lavish only after explicit opt-in");
});


test("canonical git mechanics define base, WIP, scratch, and conflicts (AC-7)", () => {
  const ref = readFileSync(join(SKILLS_DIR, "gsd", "REFERENCE.md"), "utf8");
  const mechanics = ref.split("## Git/base/WIP/scratch mechanics")[1]?.split("## Feature cleanup")[0] || "";
  assert.match(mechanics, /Base detection/, "canonical mechanics must define base detection");
  assert.match(mechanics, /git branch --show-current/, "base capture must start from current branch");
  assert.match(mechanics, /empty \(detached HEAD\)[\s\S]*`wip\/\*` branch/, "base detection must not self-reference detached or WIP state");
  assert.match(mechanics, /handoff `settings\[\]`[\s\S]*origin\/HEAD[\s\S]*init\.defaultBranch[\s\S]*main/, "base fallback ladder must be canonical");
  assert.match(mechanics, /base:<branch>[\s\S]*immediately after `schema:v1`/, "base must persist in plan.toon before plan table");
  assert.match(mechanics, /WIP branch lifecycle[\s\S]*wip\/<feature>/, "canonical mechanics must define WIP lifecycle");
  assert.match(mechanics, /Scratch sync and strip[\s\S]*git add -f[\s\S]*git push -u origin wip\/<feature>/, "canonical mechanics must define portable scratch sync");
  assert.match(mechanics, /git rm -r --cached --ignore-unmatch \.scratch\/<feature>/, "canonical mechanics must define scratch stripping before base commit");
  assert.match(mechanics, /Conflict handling[\s\S]*:conflicts[\s\S]*do not route to `gsd-diagnosing-bugs`/, "canonical mechanics must define conflict handling as a blocker, not a bug route");
});

test("listed skills consume canonical git mechanics instead of long fallback drift (AC-8)", () => {
  const consumers = ["gsd", "gsd-to-plan", "gsd-executing-plans", "gsd-handoff", "gsd-verify"];
  for (const name of consumers) {
    assert.match(readSkill(name), /Git\/base\/WIP\/scratch mechanics/, `${name} must reference canonical git mechanics`);
  }

  const master = readSkill("gsd");
  assert.doesNotMatch(master, /fall back to: `base` row[\s\S]*git symbolic-ref[\s\S]*init\.defaultBranch[\s\S]*main/, "gsd must not own the full base fallback ladder");

  const toPlan = readSkill("gsd-to-plan");
  assert.doesNotMatch(toPlan, /git symbolic-ref[\s\S]*init\.defaultBranch[\s\S]*main/, "to-plan must defer base fallback details");

  const exec = readSkill("gsd-executing-plans");
  assert.doesNotMatch(exec, /git branch --show-current[\s\S]*git symbolic-ref[\s\S]*init\.defaultBranch[\s\S]*main/, "exec must defer base fallback details");
  assert.match(exec, /TASK_BASE=\$\(git rev-parse HEAD\)/, "exec must preserve per-task diff base contract");

  const handoff = readSkill("gsd-handoff");
  assert.doesNotMatch(handoff, /1\. `git checkout wip\/<feature>`[\s\S]*2\. Uncommitted code changes[\s\S]*3\. `git add -f \.scratch\/<feature>\/`[\s\S]*4\. \*\*always\*\* `git push -u origin wip\/<feature>`/, "handoff must not duplicate the full portable sync sequence");

  const verify = readSkill("gsd-verify");
  assert.match(verify, /git checkout <base>` → `git merge --squash wip\/<feature>` → `git rm -r --cached --ignore-unmatch \.scratch\/<feature>`/, "verify must preserve the exact executable squash sequence");
  assert.doesNotMatch(verify, /git symbolic-ref[\s\S]*init\.defaultBranch[\s\S]*main/, "verify must defer base fallback details");
});
test("no surface suggests a manual post-verify merge or a 'start executing' menu item", () => {
  const verify = readSkill("gsd-verify");
  assert.doesNotMatch(verify, /git checkout <base> \(to merge/, "verify disclosure must not suggest manual merge");
  const master = readSkill("gsd");
  assert.match(master, /"Start executing tasks" is never a menu item/, "master must drop the manual execute choice");
  assert.match(master, /last prompt of the cycle/, "master pipeline must name the approval as the final prompt");
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.match(readme, /inline plan summary/, "README must document the inline summary");
  assert.match(readme, /last prompt of the cycle/, "README must document approval as the final prompt");
  assert.doesNotMatch(readme, /\d\. Start executing tasks/, "README menu must not offer manual execution");
});

test("executing-plans defines the deterministic task-brief template", () => {
  const exec = readSkill("gsd-executing-plans");
  assert.match(exec, /# Task Brief: <ID> - <Task Description>/, "must define the task-brief header");
  assert.match(exec, /## Context & Objectives/, "must define Context & Objectives section");
  assert.match(exec, /## Implementation Scope/, "must define Implementation Scope section");
  assert.match(exec, /## Verification & Done Criteria/, "must define Verification & Done Criteria section");
  assert.match(exec, /none\/unknown/, "must state fields can be none/unknown");
  assert.match(exec, /MUST NOT invent design decisions/, "must forbid inventing design decisions");
  assert.match(exec, /escalate to spec revision/, "must require escalation if missing decision is load-bearing");
});

test("REFERENCE.md spec.md template includes Design & Invariants", () => {
  const ref = readFileSync(join(SKILLS_DIR, "gsd", "REFERENCE.md"), "utf8");
  assert.match(ref, /## Design & Invariants \(Optional\)/, "spec template must have Design & Invariants");
  assert.match(ref, /Constraints\/Invariants/, "spec template must list constraints/invariants");
  assert.match(ref, /Non-Goals/, "spec template must list non-goals");
  assert.match(ref, /not speculative implementation steps/, "rule must forbid speculative implementation steps");
  assert.match(ref, /absence means "none".*not.*license to infer/, "rule must baseline absence to none");
});

test("to-plan references the deterministic task-brief template", () => {
  const toPlan = readSkill("gsd-to-plan");
  assert.match(toPlan, /deterministic task-brief template/, "to-plan must reference the deterministic template");
});

test("spec ACs pin final behavior as the convergence contract", () => {
  const ref = readFileSync(join(SKILLS_DIR, "gsd", "REFERENCE.md"), "utf8");
  assert.match(ref, /ACs pin the final behavior/, "spec rules must name ACs as the convergence contract");
  assert.match(ref, /converges? to the \*same\* end behavior/, "ACs must make every implementer converge to the same behavior");
  assert.match(ref, /Creativity belongs in Discussion/, "creativity must be scoped to Discussion, not implementation");
});

test("master scopes creativity to Discussion, convergence downstream", () => {
  const gsd = readSkill("gsd");
  assert.match(gsd, /Discussion is where creativity lives/, "master must name Discussion as the creative phase");
  assert.match(gsd, /Downstream \(plan\/execute\/verify\) is convergent/, "downstream must be convergent, not creative");
  assert.match(gsd, /same pinned behavior \*and\* the same architecture/, "convergence must cover both behavior (ACs) and design (Design & Invariants)");
});

test("task-brief carries an Acceptance Check for the task's AC", () => {
  const exec = readSkill("gsd-executing-plans");
  assert.match(exec, /- \*\*Acceptance Check:\*\*/, "task-brief template must include an Acceptance Check field");
  assert.match(exec, /before the commit/, "behavior verification must gate the commit, not follow it");
  assert.doesNotMatch(exec, /done\|e2e:deferred/, "deferral must not overload the plan.toon status cell");
});
test("every AC carries a Check sketch — the convergence gate", () => {
  const ref = readFileSync(join(SKILLS_DIR, "gsd", "REFERENCE.md"), "utf8");
  // spec.md template pairs each AC with a Check sketch
  assert.match(ref, /- Check: <acceptance-check sketch/, "spec template must pair each AC with a Check sketch");
  assert.match(ref, /A sketch, not a runnable command/, "Check must be a spec-time sketch, not a runnable command");
  // rule: the sketch is the writability/convergence gate
  assert.match(ref, /the acceptance-check sketch is the convergence gate/, "rules must name the sketch as the convergence gate");
  assert.match(ref, /cannot\* sketch a concrete expected result.*not yet converged/s, "an un-sketchable AC must block convergence");
});

test("master gates convergence on a Check sketch per AC", () => {
  const gsd = readSkill("gsd");
  assert.match(gsd, /Every AC needs a `Check:` sketch — the convergence gate/, "master Convergence must gate on a Check sketch");
  assert.match(gsd, /Can't sketch a concrete expected result → the AC is still vague/, "master must send un-sketchable ACs back to Discussion");
  assert.match(gsd, /spec-time oracle \(not a runnable command\)/, "master must frame the sketch as a spec-time oracle");
});

test("task-brief specializes the AC Check sketch, never invents an oracle", () => {
  const exec = readSkill("gsd-executing-plans");
  assert.match(exec, /start from the `Check:` sketch of each AC/, "Acceptance Check must start from the spec's Check sketch");
  assert.match(exec, /never invent an oracle the spec didn't sketch/, "dispatcher must not improvise an oracle absent from the spec");
  assert.match(exec, /unsketched `Check:` is a spec gap → escalate/, "a missing Check sketch must escalate to spec revision");
});

// ── Mode-aware artifact contract ─────────────────────────

test("canonical Artifact Contract defines catalog unions, all four roles, and mode-before-validation (AC-1)", () => {
  const reference = readFileSync(join(SKILLS_DIR, "gsd", "REFERENCE.md"), "utf8");
  const contract = extractPeerSection(reference, "Artifact Contract");
  assert.ok(contract, "REFERENCE.md must own one canonical Artifact Contract section");
  assert.match(contract, /`consumes: \[\.\.\.\]` is the catalog union/, "consumes must be a cross-mode catalog union");
  assert.match(contract, /`produces: \[\.\.\.\]` is the catalog union/, "produces must be a cross-mode catalog union");
  assert.match(contract, /discovery metadata, not runtime preconditions/, "flat frontmatter must not become a runtime precondition");
  const roleBehaviors = {
    Required: /\*\*Required\*\*[^]*?must exist before that mode can run[^]*?(?:recovery, reconstruction, or blocker path)[^]*?never invent/,
    Optional: /\*\*Optional\*\*[^]*?Absence is normal: continue without it[^]*?never redirect to `\/gsd` merely because it is missing/,
    Produced: /\*\*Produced\*\*[^]*?authorized to create or update[^]*?need not exist on entry[^]*?created lazily/,
    Fallback: /\*\*Fallback\*\*[^]*?reconstruct missing Required state[^]*?only for that documented reconstruction[^]*?rather than fabricate it/,
  };
  for (const [role, behavior] of Object.entries(roleBehaviors)) {
    assert.match(contract, behavior, `Artifact Contract must preserve ${role} behavior`);
  }
  assert.match(contract, /\| Mode \| Required \| Optional \| Produced \| Missing required \|/, "canonical mode-table columns must remain exact");
  const selectMode = contract.indexOf("Select the target skill and its **Invocation Mode** from explicit intent and entry context");
  const validateRequired = contract.indexOf("validate only that mode's **Required** artifacts");
  const tolerateNonRequired = contract.indexOf("Treat missing **Optional** and not-yet-created **Produced** artifacts as normal");
  const recoverRequired = contract.indexOf("For a missing **Required** artifact, execute the row's **Missing required** action");
  assert.ok(
    selectMode >= 0
      && validateRequired > selectMode
      && tolerateNonRequired > validateRequired
      && recoverRequired > tolerateNonRequired,
    "Invocation Mode selection must precede selected-Required validation, normal missing non-required state, and row-specific recovery",
  );

  const master = readSkill("gsd");
  assert.match(master, /Artifact validation — mode before requirements/, "master must point routing to mode-before-requirements validation");
  assert.match(master, /never infer a mode solely from `spec\.md` or `plan\.toon` presence/, "artifact presence alone must not select a mode");
  assert.doesNotMatch(master, /routes back here when its consumed artifacts are missing/, "master must not treat the consumes union as a blanket guard");

  for (const [name, content] of Object.entries(readAllSkills())) {
    const frontmatter = parseFrontmatter(content);
    for (const field of ["consumes", "produces"]) {
      assert.match(frontmatter[field], /^\[[^{}\[\]\n]*\]$/, `${name}: ${field} must remain a flat parseable array`);
      assert.ok(Array.isArray(parseList(frontmatter[field])), `${name}: existing frontmatter helper must parse ${field}`);
    }
  }

  const masterFrontmatter = parseFrontmatter(master);
  const masterConsumes = parseList(masterFrontmatter.consumes);
  assert.deepEqual(
    [...masterConsumes].sort(),
    ["CONTEXT-MAP.md", "CONTEXT.md", "docs/adr/", "docs/context/<area>/CONTEXT.md", "handoff-<n>.toon", "plan.toon", "spec.md"].sort(),
    "gsd consumes must catalog every artifact inspected by state detection and spec revision",
  );
  const masterProduces = parseList(masterFrontmatter.produces);
  assert.deepEqual(
    [...masterProduces].sort(),
    ["plan.toon", "spec.md"].sort(),
    "gsd produces must catalog both the converged spec and quick-fix plan",
  );

  const domainFrontmatter = parseFrontmatter(readSkill("gsd-domain-modeling"));
  const domainArtifacts = ["CONTEXT.md", "CONTEXT-MAP.md", "docs/context/<area>/CONTEXT.md", "docs/adr/"];
  for (const field of ["consumes", "produces"]) {
    assert.deepEqual(
      [...parseList(domainFrontmatter[field])].sort(),
      [...domainArtifacts].sort(),
      `gsd-domain-modeling ${field} must catalog root, mapped-area, and ADR artifacts`,
    );
  }
});

test("every T1 mode-aware direct guard validates only the selected mode's Required artifacts", () => {
  const modeAwareSkills = [...new Set(T1_MODE_CONTRACTS.map(({ skill }) => skill))];
  const blanketConsumesRedirects = [
    /Invoked standalone with (?:its )?`consumes:` artifacts missing/i,
    /(?:all|any|the flat)\s+`?consumes:`?.{0,80}(?:missing|absent).{0,100}(?:load|route|redirect|return).{0,40}(?:\/gsd|`gsd`)/i,
  ];

  for (const skill of modeAwareSkills) {
    const content = readSkill(skill);
    const guard = content.match(/^> \*\*Direct invocation guard\*\*.*$/m)?.[0] ?? "";
    assert.match(
      guard,
      /select an Invocation Mode below before validating only that row's Required artifacts/,
      `${skill}: direct invocation must select the mode before validating only that mode's Required artifacts`,
    );
    assert.match(
      guard,
      /follow its Missing required action/,
      `${skill}: a missing Required artifact must use the selected row's recovery or blocker`,
    );
    assert.match(
      guard,
      /A missing Optional artifact never reroutes the invocation/,
      `${skill}: missing Optional context must remain a normal direct invocation`,
    );
    for (const blanketRedirect of blanketConsumesRedirects) {
      assert.doesNotMatch(
        guard,
        blanketRedirect,
        `${skill}: the flat consumes catalog must not become a blanket redirect to /gsd`,
      );
    }
  }
});

test("invocation-mode artifacts exactly match each owning skill's flat catalogs", () => {
  for (const [skill, content] of Object.entries(readAllSkills())) {
    const table = parseInvocationModes(content);
    if (table.rows.length === 0) continue;
    assert.deepEqual(table.header, INVOCATION_MODE_HEADER, `${skill}: invocation-mode table interface`);

    const frontmatter = parseFrontmatter(content);
    const consumes = parseList(frontmatter.consumes);
    const produces = parseList(frontmatter.produces);
    assert.equal(new Set(consumes).size, consumes.length, `${skill}: consumes catalog has duplicates`);
    assert.equal(new Set(produces).size, produces.length, `${skill}: produces catalog has duplicates`);

    const namedConsumes = [];
    const namedProduces = [];
    for (const row of table.rows) {
      const prefix = `${skill}/${row.Mode}`;
      const required = parseArtifactCell(row.Required, `${prefix}/Required`);
      const optional = parseArtifactCell(row.Optional, `${prefix}/Optional`);
      const produced = parseArtifactCell(row.Produced, `${prefix}/Produced`);
      const fallback = parseFallbackArtifacts(row["Missing required"], `${prefix}/Missing required`);

      for (const artifact of [...required, ...optional, ...fallback]) {
        assert.ok(
          consumes.includes(artifact),
          `${prefix}: consumed artifact ${artifact} is missing from frontmatter consumes`,
        );
      }
      for (const artifact of produced) {
        assert.ok(
          produces.includes(artifact),
          `${prefix}: produced artifact ${artifact} is missing from frontmatter produces`,
        );
      }
      namedConsumes.push(...required, ...optional, ...fallback);
      namedProduces.push(...produced);
    }

    assert.deepEqual(
      [...new Set(namedConsumes)].sort(),
      [...consumes].sort(),
      `${skill}: consumes must be the complete invocation-mode catalog union`,
    );
    assert.deepEqual(
      [...new Set(namedProduces)].sort(),
      [...produces].sort(),
      `${skill}: produces must be the complete invocation-mode catalog union`,
    );
  }
});

test("every T1 invocation row has exact artifact sets and optional-only rows have no recovery action (AC-2)", () => {
  const fixturesBySkill = Map.groupBy(T1_MODE_CONTRACTS, ({ skill }) => skill);
  for (const [skill, fixtures] of fixturesBySkill) {
    const table = parseInvocationModes(readSkill(skill));
    assert.deepEqual(table.header, INVOCATION_MODE_HEADER, `${skill}: invocation-mode table interface`);
    assert.deepEqual(
      table.rows.map(({ Mode }) => Mode).sort(),
      fixtures.map(({ mode }) => mode).sort(),
      `${skill}: every invocation row must have an exact T1 contract fixture`,
    );

    for (const fixture of fixtures) {
      const row = table.rows.find(({ Mode }) => Mode === fixture.mode);
      assert.ok(row, `${skill}: missing mode row ${fixture.mode}`);
      const prefix = `${skill}/${fixture.mode}`;
      assertArtifactSet(row.Required, fixture.required, `${prefix}/Required`);
      assertArtifactSet(row.Optional, fixture.optional, `${prefix}/Optional`);
      assertArtifactSet(row.Produced, fixture.produced, `${prefix}/Produced`);
      if (fixture.required.length === 0) {
        assert.equal(
          row["Missing required"],
          "—",
          `${prefix}: Optional absence follows the canonical rule, not recovery prose`,
        );
      }
    }
  }
});

test("required workflow modes define recovery for each exact Required artifact (AC-3)", () => {
  for (const fixture of T1_MODE_CONTRACTS.filter(({ required }) => required.length > 0)) {
    const row = parseInvocationModes(readSkill(fixture.skill)).rows.find(({ Mode }) => Mode === fixture.mode);
    assert.ok(row, `${fixture.skill}: missing mode row ${fixture.mode}`);
    const recoveryArtifacts = Object.keys(fixture.recovery);
    assert.deepEqual(
      [...recoveryArtifacts].sort(),
      [...fixture.required].sort(),
      `${fixture.skill}/${fixture.mode}: every Required artifact needs a recovery assertion`,
    );
    for (const artifact of fixture.required) {
      assert.match(
        row["Missing required"],
        fixture.recovery[artifact],
        `${fixture.skill}/${fixture.mode}: missing ${artifact} needs its documented recovery path`,
      );
    }
    assert.match(
      row["Missing required"],
      fixture.noFabrication,
      `${fixture.skill}/${fixture.mode}: recovery must not fabricate workflow state`,
    );
  }

  const verify = readSkill("gsd-verify");
  assert.match(
    verify,
    /Quick-fix reaches this same WIP gate.*Spec-compliance is N\/A.*whole-branch build.*behavior\/E2E checks.*blockers/s,
    "no spec ACs must not exempt quick-fix from applicable build, behavior, E2E, or blocker gates",
  );

  const handoff = readSkill("gsd-handoff");
  assert.match(handoff, /open, opaque values.*preserve unknown values/s, "handoff mode and phase values must remain forward-compatible");
  assert.match(handoff, /Without an explicit execution-resume claim.*do not infer a handoff mode solely from available artifacts/s, "missing handoff must not trigger artifact-only mode inference");
});

// ── Conservative context harvest (T2) ───────────────────

const CONTEXT_HARVEST_POLICY_HEADER = [
  "Scenario",
  "Inputs",
  "Route",
  "Reads",
  "Writes",
  "Questions",
  "Escalation",
  "Owning task",
];

function unwrapPolicyCell(cell) {
  return cell.replace(/^`|`$/g, "");
}

function parsePolicyAssignments(cell) {
  const value = unwrapPolicyCell(cell);
  if (value === "none") return {};
  return Object.fromEntries(value.split(";").map((assignment) => {
    const separator = assignment.indexOf("=");
    assert.ok(separator > 0, `invalid policy assignment: ${assignment}`);
    return [assignment.slice(0, separator), assignment.slice(separator + 1)];
  }));
}

function parseContextHarvestPolicy(master) {
  const marker = "### Executable policy scenario matrix (normative)\n";
  const start = master.indexOf(marker);
  assert.ok(start >= 0, "master must document the executable context-harvest policy matrix");
  const lines = master.slice(start + marker.length).split("\n");
  const firstRow = lines.findIndex((line) => line.startsWith("|"));
  assert.ok(firstRow >= 0, "context-harvest policy matrix must contain a Markdown table");
  const tableLines = [];
  for (const line of lines.slice(firstRow)) {
    if (!line.startsWith("|")) break;
    tableLines.push(line);
  }
  const cells = (line) => line.slice(1, -1).split("|").map((cell) => cell.trim());
  const header = cells(tableLines[0]);
  assert.deepEqual(header, CONTEXT_HARVEST_POLICY_HEADER, "context-harvest policy matrix interface");
  return tableLines.slice(2).map((line) => {
    const values = cells(line);
    return {
      ...Object.fromEntries(header.map((column, index) => [column, values[index]])),
      inputs: parsePolicyAssignments(values[1]),
    };
  });
}

function resolvePolicyTemplate(value, facts) {
  const keys = {
    area: "area",
    "adr-path": "adrPath",
    "changed-path": "changedPath",
    "task-id": "taskId",
    "write-path": "writePath",
  };
  return value.replaceAll(/<([a-z-]+)>/g, (placeholder, key) => {
    const fact = facts[keys[key]];
    return fact === undefined ? placeholder : fact;
  });
}

function parsePolicyList(cell, facts) {
  const value = unwrapPolicyCell(cell);
  return value === "none"
    ? []
    : value.split(",").map((item) => resolvePolicyTemplate(item, facts));
}

function evaluateContextHarvestPolicy(policy, facts) {
  const matches = policy.filter(({ inputs }) => Object.entries(inputs)
    .every(([key, value]) => String(facts[key]) === value));
  assert.equal(matches.length, 1, `policy fixture must resolve exactly once, got ${matches.length}`);
  const row = matches[0];
  const escalation = unwrapPolicyCell(row.Escalation);
  const owningTask = unwrapPolicyCell(row["Owning task"]);
  return {
    route: resolvePolicyTemplate(unwrapPolicyCell(row.Route), facts),
    reads: parsePolicyList(row.Reads, facts),
    writes: parsePolicyList(row.Writes, facts),
    questions: Number(unwrapPolicyCell(row.Questions)),
    escalation: escalation === "none" ? null : escalation,
    owningTask: owningTask === "none" ? null : resolvePolicyTemplate(owningTask, facts),
  };
}

function replaceContextPolicyCell(master, scenario, column, replacement) {
  const lines = master.split("\n");
  const headerIndex = lines.findIndex((line) => line.startsWith("| Scenario | Inputs | Route |"));
  assert.ok(headerIndex >= 0, "policy table header must exist before mutation");
  const cells = (line) => line.slice(1, -1).split("|").map((cell) => cell.trim());
  const header = cells(lines[headerIndex]);
  const columnIndex = header.indexOf(column);
  const rowIndex = lines.findIndex(
    (line, index) => index > headerIndex && cells(line)[0] === scenario,
  );
  assert.ok(columnIndex >= 0 && rowIndex > headerIndex, `policy mutation target ${scenario}/${column}`);
  const row = cells(lines[rowIndex]);
  row[columnIndex] = replacement;
  lines[rowIndex] = `| ${row.join(" | ")} |`;
  return lines.join("\n");
}

function validateContextHarvestContract({ master, domain, execution }) {
  const expectedCatalog = [
    "CONTEXT.md",
    "CONTEXT-MAP.md",
    "docs/context/<area>/CONTEXT.md",
    "docs/adr/",
    "handoff-<n>.toon",
    "plan.toon",
    "spec.md",
  ];
  assert.deepEqual(
    [...parseList(parseFrontmatter(master).consumes)].sort(),
    [...expectedCatalog].sort(),
    "master consumes must preserve the exact domain-artifact semantic union",
  );

  const harvest = extractPeerSection(master, "Conservative context harvest");
  const authority = harvest.indexOf("**Authority gate (before every domain write).**");
  const authorizedOutcome = harvest.indexOf("**Write-authorized outcomes.**");
  assert.ok(
    authority >= 0 && authorizedOutcome > authority,
    "domain write authority/order must gate every certain-write outcome",
  );
  const unconditionalWrite = master.split("\n").find((line) => (
    /^(?:\d+\.\s+|-\s+)?(?:Write|Create|Update) (?:a |the |every )?(?:domain artifact|`CONTEXT(?:-MAP)?\.md`|ADR)/i.test(line.trim())
  ));
  assert.equal(
    unconditionalWrite,
    undefined,
    "domain write authority/order forbids an unconditional master write path",
  );

  const policy = parseContextHarvestPolicy(master);
  const material = policy.find(({ Scenario }) => Scenario === "Material pre-approval ambiguity");
  assert.ok(material, "material pre-approval scenario must exist");
  assert.equal(
    Number(unwrapPolicyCell(material.Questions)),
    1,
    "material pre-approval ambiguity must ask exactly one question",
  );
  assert.deepEqual(parsePolicyList(material.Writes, {}), [], "material ambiguity must write nothing");

  for (const row of policy) {
    const writes = parsePolicyList(row.Writes, {});
    if (writes.length === 0) continue;
    assert.equal(
      row.inputs.authority,
      "write-authorized",
      `${row.Scenario}: every domain write must require write-authorized authority`,
    );
    if (row.inputs.phase === "pre-approval") {
      assert.match(
        unwrapPolicyCell(row["Owning task"]),
        /^return=<write-path>;state=pending-transfer$/,
        `${row.Scenario}: every pre-approval changed path must be returned for task ownership`,
      );
    }
  }

  const ownership = policy.find(({ Scenario }) => Scenario === "Pre-approval write ownership");
  assert.match(
    unwrapPolicyCell(ownership?.["Owning task"] ?? ""),
    /^task=<task-id>;files=<changed-path>;commit=with-task$/,
    "every pre-approval write must have one owning task files entry and task commit",
  );
  assert.match(
    extractPeerSection(domain, "Tracked-document lifecycle"),
    /return the exact repository-relative changed paths to the master/,
    "domain modeling must transfer exact changed paths",
  );
  assert.match(
    extractPeerSection(master, "Convergence — write `spec.md`"),
    /assign every returned path to exactly one named owning plan task's `files`/,
    "convergence must assign every pre-approval changed path before approval",
  );
  assert.match(
    execution,
    /“code only” excludes scratch and session artifacts, not intentional tracked project documents/,
    "execution code-only scope must retain task-owned domain documents",
  );
  return policy;
}

function validatePreApprovalDomainOwnershipContract({ master, domain, toPlan, execution }) {
  const masterConvergence = extractPeerSection(master, "Convergence — write `spec.md`");
  assert.match(
    masterConvergence,
    /`gsd-domain-modeling` returns the exact repository-relative changed paths/,
    "master must receive the exact pre-approval domain paths",
  );
  assert.match(
    masterConvergence,
    /Before the plan approval question, assign every returned path to exactly one named owning plan task's `files`/,
    "master must transfer every returned path into exactly one plan row before approval",
  );
  const ownershipPolicy = parseContextHarvestPolicy(master)
    .find(({ Scenario }) => Scenario === "Pre-approval write ownership");
  assert.equal(
    unwrapPolicyCell(ownershipPolicy?.Route ?? ""),
    "3:gsd-to-plan",
    "master must route ownership convergence through gsd-to-plan",
  );
  assert.deepEqual(
    parsePolicyList(ownershipPolicy?.Reads ?? "none", {}),
    ["returned-changed-paths"],
    "master must give gsd-to-plan the returned path set without a scan",
  );

  const lifecycle = extractPeerSection(domain, "Tracked-document lifecycle");
  assert.match(
    lifecycle,
    /return the exact repository-relative changed paths to the master/,
    "domain modeling must return exact changed paths upstream",
  );
  assert.match(
    lifecycle,
    /only after convergence assigns each returned path to exactly one named plan task's `files`/,
    "domain modeling must keep pre-approval writes pending until plan ownership",
  );

  const intakeStart = toPlan.indexOf("At intake, also accept");
  const gateStart = toPlan.indexOf("## Pre-approval domain-path ownership gate");
  const summaryStart = toPlan.indexOf("## Plan summary + approval gate");
  assert.ok(
    intakeStart >= 0 && gateStart > intakeStart && summaryStart > gateStart,
    "gsd-to-plan must order returned-path intake, ownership gate, then summary/approval",
  );
  const intake = toPlan.slice(intakeStart, gateStart);
  assert.match(
    intake,
    /exact set of repository-relative pre-approval domain artifact paths returned by `gsd-domain-modeling`/,
    "gsd-to-plan intake must accept the exact returned path set",
  );
  assert.match(
    intake,
    /no returned paths \(an empty or absent set\) is normal/,
    "gsd-to-plan intake must treat no returned paths as normal",
  );
  assert.match(
    intake,
    /pre-plan resume[\s\S]*still present in conversational\/handoff state/,
    "gsd-to-plan resume must reuse only a path set retained in conversation/handoff state",
  );
  assert.match(
    intake,
    /If no returned-path set exists, use the empty set[\s\S]*do not invent paths[\s\S]*infer domain changes from arbitrary dirty files/,
    "gsd-to-plan resume must not reconstruct ownership from scans or dirty files",
  );

  const gate = extractPeerSection(toPlan, "Pre-approval domain-path ownership gate");
  assert.match(
    gate,
    /ordinary, exact `files` entry on the behavior-owning task/,
    "gsd-to-plan must use the existing files field and a behavior-owning task",
  );
  assert.match(
    gate,
    /Never create a generic documentation task/,
    "gsd-to-plan must not invent a generic documentation owner",
  );
  assert.match(
    gate,
    /before printing the inline summary or asking approval[\s\S]*parse every completed row in the `plan\[\.\.\.\]` table/,
    "gsd-to-plan must parse completed rows before exposing approval",
  );
  assert.match(
    gate,
    /Split each row's `files` field on `\|` and compare whole path tokens exactly/,
    "gsd-to-plan must count exact files tokens rather than substrings",
  );
  assert.match(
    gate,
    /count its occurrences across all rows[\s\S]*only when each path occurs once and its sole owning row has `status=pending`/,
    "gsd-to-plan must require exactly one pending owner",
  );
  assert.match(
    gate,
    /The empty returned-path set passes without adding or inferring work/,
    "gsd-to-plan gate must be a no-op for an empty returned set",
  );
  assert.match(
    gate,
    /Zero occurrences, more than one occurrence[\s\S]*is a plan defect/,
    "gsd-to-plan must reject unowned and duplicate paths",
  );
  assert.match(
    gate,
    /Revise or redistribute the plan rows[\s\S]*parse and run the entire check again/,
    "gsd-to-plan must repair and rerun the ownership check",
  );
  assert.match(
    gate,
    /\*\*Do not print the summary, ask the approval question, or launch plan review until the check passes\.\*\*/,
    "gsd-to-plan must suppress every approval surface until ownership passes",
  );
  assert.match(
    gate,
    /changes neither `schema:v1`, the columns, nor sequential task order, and creates no state artifact/,
    "gsd-to-plan ownership must preserve the plan schema and state model",
  );
  assert.equal(
    (toPlan.match(/plan\[count\]\{id,task,satisfies,files,test,status\}:/g) ?? []).length,
    1,
    "gsd-to-plan must retain the exact schema:v1 plan columns",
  );

  const summary = extractPeerSection(
    toPlan,
    "Plan summary + approval gate (mandatory, only after the ownership and serialization gates pass)",
  );
  assert.match(
    summary,
    /block approval until both domain-path ownership and AC coverage are complete/,
    "gsd-to-plan approval must remain behind both completeness checks",
  );
  assert.match(
    summary,
    /\*\*This approval is the last prompt of the cycle\*\*/,
    "gsd-to-plan approval must remain the last prompt",
  );

  const executionIntake = extractPeerSection(execution, "Intake");
  assert.match(
    executionIntake,
    /before the first dispatch, verify that every exact pre-approval domain path returned by `gsd-domain-modeling` appears in exactly one named task's `files`/,
    "execution must enforce the same exact-path ownership contract downstream",
  );
  assert.match(
    executionIntake,
    /A missing or multiply owned path is an invalid approved plan: stop before dispatch/,
    "execution must block an invalid approved plan",
  );
}

function parseDomainOwnershipPlan(plan) {
  const lines = plan.trim().split("\n").map((line) => line.trim()).filter(Boolean);
  assert.equal(lines[0], "schema:v1", "ownership fixture must preserve schema:v1");
  assert.match(lines[1], /^base:[^,]+$/, "ownership fixture must declare base");
  const header = lines[2].match(
    /^plan\[(\d+)\]\{id,task,satisfies,files,test,status\}:$/,
  );
  assert.ok(header, "ownership fixture must use the exact plan columns");
  const rows = lines.slice(3);
  assert.equal(rows.length, Number(header[1]), "ownership fixture row count");
  return rows.map((row, index) => {
    const cells = row.split(",");
    assert.equal(cells.length, 6, `ownership fixture row ${index + 1} column count`);
    assert.equal(cells[0], `T${index + 1}`, "ownership fixture task IDs stay sequential");
    return {
      id: cells[0],
      files: cells[3] === "none" ? [] : cells[3].split("|"),
      status: cells[5],
    };
  });
}

function evaluatePreApprovalDomainOwnership(plan, returnedPaths) {
  assert.equal(
    new Set(returnedPaths).size,
    returnedPaths.length,
    "returned domain paths are an exact set",
  );
  const rows = parseDomainOwnershipPlan(plan);
  const ownership = {};
  let passes = true;
  for (const path of returnedPaths) {
    const occurrences = [];
    for (const row of rows) {
      for (const file of row.files) {
        if (file === path) occurrences.push({ id: row.id, status: row.status });
      }
    }
    ownership[path] = occurrences.map(({ id }) => id);
    if (occurrences.length !== 1 || occurrences[0].status !== "pending") passes = false;
  }
  return { passes, ownership };
}

test("T2 pre-approval domain ownership is continuous across all four workflow seams", () => {
  validatePreApprovalDomainOwnershipContract({
    master: readSkill("gsd"),
    domain: readSkill("gsd-domain-modeling"),
    toPlan: readSkill("gsd-to-plan"),
    execution: readSkill("gsd-executing-plans"),
  });
});

test("T2 gsd-to-plan ownership gate evaluates the exact returned-path fixtures", () => {
  const source = {
    master: readSkill("gsd"),
    domain: readSkill("gsd-domain-modeling"),
    toPlan: readSkill("gsd-to-plan"),
    execution: readSkill("gsd-executing-plans"),
  };
  validatePreApprovalDomainOwnershipContract(source);

  const fixtures = [
    {
      name: "no returned paths passes",
      returnedPaths: [],
      plan: `schema:v1
base:main
plan[1]{id,task,satisfies,files,test,status}:
  T1,Implement account behavior,AC-1,src/account.js,tests/account.test.js,pending`,
      expected: { passes: true, ownership: {} },
    },
    {
      name: "one path owned once passes",
      returnedPaths: ["CONTEXT.md"],
      plan: `schema:v1
base:main
plan[1]{id,task,satisfies,files,test,status}:
  T1,Implement account behavior,AC-1,src/account.js|CONTEXT.md,tests/account.test.js,pending`,
      expected: { passes: true, ownership: { "CONTEXT.md": ["T1"] } },
    },
    {
      name: "unowned path fails",
      returnedPaths: ["CONTEXT.md"],
      plan: `schema:v1
base:main
plan[1]{id,task,satisfies,files,test,status}:
  T1,Implement account behavior,AC-1,src/account.js,tests/account.test.js,pending`,
      expected: { passes: false, ownership: { "CONTEXT.md": [] } },
    },
    {
      name: "duplicate path fails",
      returnedPaths: ["CONTEXT.md"],
      plan: `schema:v1
base:main
plan[2]{id,task,satisfies,files,test,status}:
  T1,Implement account behavior,AC-1,src/account.js|CONTEXT.md,tests/account.test.js,pending
  T2,Expose account behavior,AC-2,src/router.js|CONTEXT.md,tests/router.test.js,pending`,
      expected: { passes: false, ownership: { "CONTEXT.md": ["T1", "T2"] } },
    },
    {
      name: "two paths owned by respective tasks pass",
      returnedPaths: ["CONTEXT.md", "docs/adr/0042-storage.md"],
      plan: `schema:v1
base:main
plan[2]{id,task,satisfies,files,test,status}:
  T1,Implement account behavior,AC-1,src/account.js|CONTEXT.md,tests/account.test.js,pending
  T2,Select account storage,AC-2,src/storage.js|docs/adr/0042-storage.md,tests/storage.test.js,pending`,
      expected: {
        passes: true,
        ownership: {
          "CONTEXT.md": ["T1"],
          "docs/adr/0042-storage.md": ["T2"],
        },
      },
    },
  ];

  for (const fixture of fixtures) {
    assert.deepEqual(
      evaluatePreApprovalDomainOwnership(fixture.plan, fixture.returnedPaths),
      fixture.expected,
      fixture.name,
    );
  }
});

test("T2 mutation guard rejects removing or bypassing only the gsd-to-plan ownership gate", () => {
  const source = {
    master: readSkill("gsd"),
    domain: readSkill("gsd-domain-modeling"),
    toPlan: readSkill("gsd-to-plan"),
    execution: readSkill("gsd-executing-plans"),
  };
  const removed = source.toPlan.replace(
    /## Pre-approval domain-path ownership gate\n[\s\S]*?(?=\n## Plan summary \+ approval gate)/,
    "",
  );
  const bypassed = source.toPlan.replace(
    "**Do not print the summary, ask the approval question, or launch plan review until the check passes.**",
    "Print the summary and ask approval even when the ownership check fails.",
  );
  assert.notEqual(removed, source.toPlan, "removal mutation must alter gsd-to-plan");
  assert.notEqual(bypassed, source.toPlan, "bypass mutation must alter gsd-to-plan");

  for (const [name, toPlan] of [["removed", removed], ["bypassed", bypassed]]) {
    assert.throws(
      () => validatePreApprovalDomainOwnershipContract({ ...source, toPlan }),
      /gsd-to-plan/,
      `${name} planner-gate mutant must fail while master/domain/execution stay intact`,
    );
  }
});

test("T2 documented policy matrix evaluates route/read/write/question/escalation/ownership exactly", () => {
  const source = {
    master: readSkill("gsd"),
    domain: readSkill("gsd-domain-modeling"),
    execution: readSkill("gsd-executing-plans"),
  };
  const policy = validateContextHarvestContract(source);
  const metadataReads = [
    "meta:CONTEXT.md",
    "meta:CONTEXT-MAP.md",
    "meta:docs/context/<area>/CONTEXT.md",
    "meta:docs/adr/",
  ];
  const fixtures = [
    {
      name: "entry typo is presence-only",
      facts: { phase: "entry", authority: "read-only", mode: "typo", signal: "none" },
      expected: {
        route: "0:direct",
        reads: metadataReads,
        writes: [],
        questions: 0,
        escalation: null,
        owningTask: null,
      },
    },
    {
      name: "nano has no domain write authority",
      facts: { phase: "entry", authority: "no-domain-write", mode: "nano", signal: "none" },
      expected: {
        route: "0:direct",
        reads: metadataReads,
        writes: [],
        questions: 0,
        escalation: null,
        owningTask: null,
      },
    },
    {
      name: "standalone review reports strong evidence without mutation",
      facts: { phase: "selected-route", authority: "read-only", mode: "standalone-review", signal: "decision" },
      expected: {
        route: "2:gsd-verify",
        reads: ["selected-route-evidence", "related-ADRs"],
        writes: [],
        questions: 0,
        escalation: null,
        owningTask: null,
      },
    },
    {
      name: "write-authorized certain term",
      facts: {
        phase: "pre-approval",
        authority: "write-authorized",
        signal: "term",
        certainty: "certain",
        map: "absent",
        writePath: "CONTEXT.md",
      },
      expected: {
        route: "5:gsd-domain-modeling",
        reads: ["selected-route-evidence", "targeted-term-evidence"],
        writes: ["CONTEXT.md"],
        questions: 0,
        escalation: null,
        owningTask: "return=CONTEXT.md;state=pending-transfer",
      },
    },
    {
      name: "mapped area term",
      facts: {
        phase: "pre-approval",
        authority: "write-authorized",
        signal: "term",
        certainty: "certain",
        map: "mapped",
        area: "billing",
        writePath: "docs/context/billing/CONTEXT.md",
      },
      expected: {
        route: "5:gsd-domain-modeling",
        reads: ["selected-route-evidence", "CONTEXT-MAP.md", "targeted-term-evidence"],
        writes: ["docs/context/billing/CONTEXT.md"],
        questions: 0,
        escalation: null,
        owningTask: "return=docs/context/billing/CONTEXT.md;state=pending-transfer",
      },
    },
    {
      name: "material pre-approval ambiguity",
      facts: {
        phase: "pre-approval",
        authority: "write-authorized",
        signal: "term",
        certainty: "material-ambiguous",
        map: "unresolved",
      },
      expected: {
        route: "5:gsd-domain-modeling",
        reads: ["selected-route-evidence", "CONTEXT-MAP.md", "targeted-term-evidence"],
        writes: [],
        questions: 1,
        escalation: null,
        owningTask: null,
      },
    },
    {
      name: "fully evidenced ADR",
      facts: {
        phase: "pre-approval",
        authority: "write-authorized",
        signal: "decision",
        reversibility: "hard",
        surprise: "yes",
        tradeoff: "real",
        rationale: "evidenced",
        existingADR: "none",
        adrPath: "docs/adr/0042-storage.md",
        writePath: "docs/adr/0042-storage.md",
      },
      expected: {
        route: "5:gsd-domain-modeling",
        reads: ["selected-route-evidence", "related-ADRs"],
        writes: ["docs/adr/0042-storage.md"],
        questions: 0,
        escalation: null,
        owningTask: "return=docs/adr/0042-storage.md;state=pending-transfer",
      },
    },
    {
      name: "reversible preference",
      facts: {
        phase: "pre-approval",
        authority: "write-authorized",
        signal: "decision",
        reversibility: "reversible",
      },
      expected: {
        route: "5:gsd-domain-modeling",
        reads: ["selected-route-evidence"],
        writes: [],
        questions: 0,
        escalation: null,
        owningTask: null,
      },
    },
    {
      name: "post-approval load-bearing ambiguity",
      facts: {
        phase: "post-approval",
        authority: "write-authorized",
        signal: "domain",
        certainty: "material-ambiguous",
        loadBearing: "yes",
      },
      expected: {
        route: "3:gsd-executing-plans",
        reads: ["selected-route-evidence", "targeted-domain-evidence"],
        writes: [],
        questions: 0,
        escalation: "spec",
        owningTask: null,
      },
    },
    {
      name: "post-approval non-load-bearing ambiguity",
      facts: {
        phase: "post-approval",
        authority: "write-authorized",
        signal: "domain",
        certainty: "material-ambiguous",
        loadBearing: "no",
      },
      expected: {
        route: "3:gsd-executing-plans",
        reads: ["selected-route-evidence", "targeted-domain-evidence"],
        writes: [],
        questions: 0,
        escalation: null,
        owningTask: null,
      },
    },
    {
      name: "pre-approval write receives one owning task and commit",
      facts: {
        phase: "convergence",
        authority: "write-authorized",
        intentionalWrite: "yes",
        changedPaths: "returned",
        ownership: "assigned",
        taskId: "T2",
        changedPath: "docs/adr/0042-storage.md",
      },
      expected: {
        route: "3:gsd-to-plan",
        reads: ["returned-changed-paths"],
        writes: [],
        questions: 0,
        escalation: null,
        owningTask: "task=T2;files=docs/adr/0042-storage.md;commit=with-task",
      },
    },
  ];

  for (const fixture of fixtures) {
    assert.deepEqual(
      evaluateContextHarvestPolicy(policy, fixture.facts),
      fixture.expected,
      fixture.name,
    );
  }
});

test("T2 mutation guard rejects an unconditional write outside authority/order", () => {
  const source = {
    master: `${readSkill("gsd")}\nWrite a domain artifact for every selected-route candidate.\n`,
    domain: readSkill("gsd-domain-modeling"),
    execution: readSkill("gsd-executing-plans"),
  };
  assert.throws(
    () => validateContextHarvestContract(source),
    /domain write authority\/order forbids an unconditional master write path/,
  );
});

test("T2 mutation guard rejects a missing master domain catalog entry", () => {
  const source = {
    master: readSkill("gsd").replace(", docs/adr/", ""),
    domain: readSkill("gsd-domain-modeling"),
    execution: readSkill("gsd-executing-plans"),
  };
  assert.throws(
    () => validateContextHarvestContract(source),
    /master consumes must preserve the exact domain-artifact semantic union/,
  );
});

test("T2 mutation guard rejects zero material pre-approval questions", () => {
  const source = {
    master: replaceContextPolicyCell(
      readSkill("gsd"),
      "Material pre-approval ambiguity",
      "Questions",
      "`0`",
    ),
    domain: readSkill("gsd-domain-modeling"),
    execution: readSkill("gsd-executing-plans"),
  };
  assert.throws(
    () => validateContextHarvestContract(source),
    /material pre-approval ambiguity must ask exactly one question/,
  );
});

test("T2 mutation guard rejects an unowned pre-approval write", () => {
  const source = {
    master: replaceContextPolicyCell(
      readSkill("gsd"),
      "Certain recurring domain term",
      "Owning task",
      "`none`",
    ),
    domain: readSkill("gsd-domain-modeling"),
    execution: readSkill("gsd-executing-plans"),
  };
  assert.throws(
    () => validateContextHarvestContract(source),
    /every pre-approval changed path must be returned for task ownership/,
  );
});

test("T2 master entry checks domain artifact presence only and Route 0 remains no-write (AC-4)", () => {
  const master = readSkill("gsd");
  const presenceStart = master.indexOf("**Step 0 — domain artifacts are presence-only metadata.**");
  const presenceEnd = master.indexOf("**Artifact validation — mode before requirements.**", presenceStart);
  assert.ok(presenceStart >= 0 && presenceEnd > presenceStart, "domain presence check must be a bounded part of Step 0");
  const presence = master.slice(presenceStart, presenceEnd);

  for (const artifact of [
    /`CONTEXT\.md`/,
    /`CONTEXT-MAP\.md`/,
    /`docs\/context\/<area>\/CONTEXT\.md`/,
    /`docs\/adr\/`/,
  ]) {
    assert.match(presence, artifact, `Step 0 must check ${artifact} presence`);
  }
  assert.match(presence, /existence\/glob metadata only/, "Step 0 must use metadata, not domain content");
  assert.match(presence, /Do not open or sweep their contents/, "Step 0 must forbid a content sweep");
  assert.match(presence, /propose an artifact, or write one at entry/, "Step 0 must be no-propose/no-write");
  assert.match(presence, /Missing domain docs are normal/, "missing domain docs must not alter routing");

  const route0Start = master.indexOf("0. **Direct / Trivial (check first)**");
  const route0End = master.indexOf("1. **Resume**", route0Start);
  const route0 = master.slice(route0Start, route0End);
  assert.match(route0, /typo, read-only fixture[\s\S]*stops at the Step 0 presence check/, "typo/read-only no-signal work must remain Route 0");
  assert.match(route0, /Perform no glossary\/ADR scan/, "Route 0 must perform no broad domain read");
  assert.match(route0, /propose or write no `CONTEXT\.md`, `CONTEXT-MAP\.md`, area context, or ADR/, "Route 0 must create no domain artifact");
});

test("T2 harvest routes first, reuses relevant evidence, and gates every extra read (AC-4, AC-5)", () => {
  const master = extractPeerSection(readSkill("gsd"), "Conservative context harvest");
  const domain = extractPeerSection(readSkill("gsd-domain-modeling"), "Conservative context harvest");

  assert.match(master, /after route selection/, "master must route before harvesting");
  assert.match(master, /existence check → selected-route evidence → no-op \| certain write \| one ambiguity question/, "master must define the deterministic harvest flow");
  assert.match(master, /Reuse the code, docs, task brief, spec, and relevant existing domain artifacts already read/, "master must reuse route evidence first");
  assert.match(master, /Only then may .* targeted reads/s, "master must gate targeted reads on a durable signal");
  assert.match(master, /Missing artifacts never create empty scaffolds/, "master must not create empty docs");

  const start = domain.indexOf("Start with selected-route evidence");
  const signal = domain.indexOf("Require a durable signal before extra reads");
  const weak = domain.indexOf("Reject weak signals");
  const outcome = domain.indexOf("Choose exactly one outcome");
  assert.ok(start >= 0 && signal > start && weak > signal && outcome > weak, "domain harvest policy must order evidence → signal → rejection → outcome");
  assert.match(domain, /Only after that signal may you make narrow reads/, "extra domain reads require a durable signal");
  assert.match(domain, /Generic vocabulary, a one-off identifier, implementation detail, code shape without stated rationale, reversible preference, and absent or contradictory evidence are \*\*no-op\*\*/, "weak evidence must deterministically no-op");
  assert.match(domain, /Do not scan the repository to try to upgrade them into candidates/, "weak signals must not trigger a broad scan");
  assert.match(readSkill("gsd-domain-modeling"), /This skill is the \*\*sole writer\*\*/, "harvest must preserve domain modeling as sole writer");
});

test("T2 glossary scenario matrix resolves certain, mapped, and ambiguous terms exactly (AC-5)", () => {
  const domainSkill = readSkill("gsd-domain-modeling");
  const harvest = extractPeerSection(domainSkill, "Conservative context harvest");
  const row = (label) => harvest.split("\n").find((line) => line.startsWith(`| ${label} |`)) ?? "";

  const certain = row("Certain recurring domain term");
  assert.match(certain, /use one project-specific concept repeatedly and establish one meaning/, "certain scenario must require recurring evidence and certain meaning");
  assert.match(certain, /Create or update exactly one root `CONTEXT\.md` glossary entry/, "certain scenario must write exactly one root entry");

  const mapped = row("Mapped multi-context term");
  assert.match(mapped, /`CONTEXT-MAP\.md` exists and assigns the evidenced term/, "mapped scenario must derive ownership from the map");
  assert.match(mapped, /Consult the map first; create or update only that area's `docs\/context\/<area>\/CONTEXT\.md` entry/, "mapped scenario must select only the owned area");

  const ambiguous = row("Ambiguous overloaded term");
  assert.match(ambiguous, /materially different meanings or owners/, "ambiguous scenario must be materially overloaded");
  assert.match(ambiguous, /Ask one focused meaning\/ownership question; write nothing until resolved/, "ambiguous pre-approval scenario must ask once and not write");

  const files = extractPeerSection(domainSkill, "Files (lazy — create only when you have something to write)");
  assert.match(files, /consult it first and pick the relevant area.*before choosing root versus `docs\/context\/<area>\/CONTEXT\.md`/s, "map must be consulted before root-versus-area selection");
});

test("T2 ADR policy requires all gates, evidenced rationale, and dedupe (AC-6)", () => {
  const adr = extractPeerSection(readSkill("gsd-domain-modeling"), "ADR capture — all gates plus evidence");
  assert.match(adr, /only when \*\*all three\*\* gates hold/, "ADR must require the complete gate conjunction");
  assert.match(adr, /Hard to reverse[\s\S]*Surprising without context[\s\S]*The result of a real trade-off/, "ADR must name all three gates");
  assert.match(adr, /evidence must also state the decision's rationale/, "ADR rationale must be evidenced");
  assert.match(adr, /Code shape alone cannot supply or invent that rationale/, "code shape alone must never invent an ADR");
  assert.match(adr, /read only related existing ADRs before proposing one/, "ADR lookup must be targeted and precede proposal");
  assert.match(adr, /already carries the rationale, no-op[\s\S]*materially evolved, update it[\s\S]*only for a distinct decision/s, "ADR handling must dedupe, update, or create only when distinct");

  const row = (label) => adr.split("\n").find((line) => line.startsWith(`| ${label} |`)) ?? "";
  assert.match(row("Evidenced durable decision"), /Hard to reverse \+ surprising without context \+ real trade-off, with evidenced rationale[\s\S]*Write exactly one ADR/, "fully evidenced durable decision must write one ADR");
  assert.match(row("Reversible preference"), /Hard-to-reverse gate fails[\s\S]*No-op; write no ADR/, "reversible preference must not write an ADR");
  assert.match(row("Ambiguous post-approval decision"), /Zero prompts; Spec escalation only when load-bearing, otherwise no-op/, "post-approval ambiguity must escalate or no-op without prompting");
});

test("T2 phase and tracked-document lifecycle preserve post-approval auto-pilot (AC-6)", () => {
  const domainSkill = readSkill("gsd-domain-modeling");
  const phase = extractPeerSection(domainSkill, "Ambiguity by phase");
  assert.match(phase, /Before approval:[\s\S]*one-question outcome[\s\S]*unresolved answer remains no-op/, "pre-approval ambiguity must ask at most once and remain no-op unresolved");
  assert.match(phase, /After approval:[\s\S]*zero documentation questions[\s\S]*changes an AC, interface, or invariant, or prevents correct implementation[\s\S]*Spec escalation[\s\S]*skip the documentation write and continue/s, "post-approval ambiguity must escalate only when load-bearing and never prompt");

  const lifecycle = extractPeerSection(domainSkill, "Tracked-document lifecycle");
  assert.match(lifecycle, /tracked project artifacts, \*\*never scratch\*\*/, "domain docs must be tracked, not scratch");
  assert.match(lifecycle, /intentional working-tree change[\s\S]*approved WIP plan and work/, "pre-approval writes must survive into approved WIP");
  assert.match(lifecycle, /post-approval, in-scope write is committed with the task whose evidence owns it/, "post-approval writes must join their owning task");
  assert.match(lifecycle, /Never silently commit `<base>`[\s\S]*unplanned generic documentation commit[\s\S]*“code only,”/, "lifecycle must forbid base commits, generic docs commits, and code-only loss");

  const execution = extractPeerSection(readSkill("gsd-executing-plans"), "Post-approval context harvest");
  assert.match(execution, /optional and task-scoped/, "execution harvest must remain bounded");
  assert.match(execution, /sole writer/, "execution must delegate every write to domain modeling");
  assert.match(execution, /include it in the owning task commit/, "execution must keep certain domain writes with their task");
  assert.match(execution, /ask zero documentation questions/, "approved execution must never prompt for documentation ambiguity");
  assert.match(execution, /changes an AC, interface, or invariant, or prevents correct implementation[\s\S]*Spec escalation[\s\S]*otherwise make the documentation outcome no-op/s, "execution ambiguity must choose escalation or no-op");
  assert.match(execution, /No durable signal:[\s\S]*no-op[\s\S]*separate documentation task\/commit/, "no signal must not create work");
});

test("T2 TDD, diagnosis, and architecture callers stay optional and scope-bounded", () => {
  for (const skill of [
    "gsd-tdd",
    "gsd-diagnosing-bugs",
    "gsd-improve-codebase-architecture",
  ]) {
    const content = readSkill(skill);
    assert.match(content, /Optional context signal/, `${skill}: must make context harvesting optional`);
    assert.match(content, /already[- ]relevant|already needed|already read/, `${skill}: must reuse route evidence`);
    assert.match(content, /Trigger `gsd-domain-modeling` only/, `${skill}: must gate the domain-modeling trigger`);
    assert.match(content, /recurring project-specific term or (?:an )?explicit decision\/rationale signal/, `${skill}: must require a durable signal`);
    assert.match(content, /never (?:run|widen into).*scan|do not scan beyond/, `${skill}: must forbid a broad context scan`);
    assert.match(content, /never writes? (?:a )?domain artifacts? (?:itself)?/i, `${skill}: must not become a second writer`);
    assert.match(content, /scaffolds?/, `${skill}: missing docs must not create scaffolding`);
    assert.match(content, /asks? zero documentation questions/, `${skill}: post-approval domain uncertainty must not prompt`);
  }
});

// ── Explicit Ponytail routing state (T3) ────────────────

const ROUTE0_CLASSIFIER_HEADER = [
  "Class",
  "Deterministic boundary",
  "Route",
  "Skill",
  "Activation cue",
];

const PONYTAIL_STATE_HEADER = [
  "Scenario",
  "Inputs",
  "Next state",
  "Route",
  "Skill/load",
  "Output",
  "Handoff row",
];

const PONYTAIL_EVENTS = Object.freeze({
  nano: "nano",
  quickFix: "quick-fix",
  fixLanded: "fix-landed",
  blockerStop: "blocker-stop",
  unrelatedPrompt: "unrelated-prompt",
  toggle: "toggle",
  stop: "stop",
  dispatch: "dispatch",
  handoffWrite: "handoff-write",
  handoffRestore: "handoff-restore",
});

function parseT3Table(content, marker, expectedHeader) {
  const start = content.indexOf(marker);
  assert.ok(start >= 0, `missing T3 table marker: ${marker.trim()}`);
  const lines = content.slice(start + marker.length).split("\n");
  const firstRow = lines.findIndex((line) => line.startsWith("|"));
  assert.ok(firstRow >= 0, `missing Markdown table after ${marker.trim()}`);
  const tableLines = [];
  for (const line of lines.slice(firstRow)) {
    if (!line.startsWith("|")) break;
    tableLines.push(line);
  }
  const cells = (line) => line.slice(1, -1).split("|").map((cell) => cell.trim());
  assert.ok(tableLines.length >= 3, `${marker.trim()} must contain a header and rows`);
  const header = cells(tableLines[0]);
  assert.deepEqual(header, expectedHeader, `${marker.trim()} table interface`);
  return tableLines.slice(2).map((line) => {
    const values = cells(line);
    assert.equal(values.length, header.length, `${marker.trim()} row width`);
    return Object.fromEntries(header.map((column, index) => [column, values[index]]));
  });
}

function firstT3CodeValue(cell) {
  return cell.match(/`([^`]+)`/)?.[1] ?? cell;
}

function parseRoute0Classifier(master) {
  return parseT3Table(
    master,
    "**Route 0 classifier (normative).**\n",
    ROUTE0_CLASSIFIER_HEADER,
  );
}

function validateRoute0ClassBoundaries(classifier) {
  const nanoRows = classifier.filter((row) => row.Class === "Nano");
  const quickFixRows = classifier.filter((row) => row.Class === "Real quick-fix");
  assert.equal(nanoRows.length, 1, "classifier must define Nano exactly once");
  assert.equal(quickFixRows.length, 1, "classifier must define Real quick-fix exactly once");

  const nanoBoundary = nanoRows[0]["Deterministic boundary"];
  const quickFixBoundary = quickFixRows[0]["Deterministic boundary"];
  assert.match(nanoBoundary, /Purely mechanical/i, "Nano must require mechanical work");
  assert.match(nanoBoundary, /non-behavioral/i, "Nano must exclude behavioral changes");
  assert.match(nanoBoundary, /line count alone is insufficient/i, "one line alone must not imply Nano");
  assert.match(quickFixBoundary, /Behavioral small code change/i, "real quick-fix must own behavioral changes");
  assert.match(quickFixBoundary, /at most one module/, "quick-fix must stay within one module");
  assert.match(quickFixBoundary, /known single spot\/root cause/, "quick-fix must require a known cause");
  assert.match(quickFixBoundary, /no investigation/, "unclear bugs must not be forced through Ponytail");
  assert.match(quickFixBoundary, /one-line known-root-cause fix/, "one-line behavioral fixes must remain real quick-fixes");
}

function classifyRoute0Fixture(fixture, classifier) {
  const prompt = fixture.prompt.toLowerCase();
  let className;
  if (
    /\bknown off-by-one\b/.test(prompt)
    && /\bat\s+\S+:\d+/.test(prompt)
    && /\bfix\b/.test(prompt)
  ) {
    className = "Real quick-fix";
  } else if (/\btypo\b/.test(prompt) && /(?:->|→)/.test(prompt)) {
    className = "Nano";
  } else if (
    /(?:tests? fail|typeerror)/.test(prompt)
    && /\bat\s+\S+:\d+/.test(prompt)
    && /\bfix\b/.test(prompt)
  ) {
    className = "Real quick-fix";
  } else if (prompt.endsWith("?")) {
    className = "Direct/read-only";
  } else {
    throw new Error(`${fixture.id}: fixture does not meet a deterministic Route 0 boundary`);
  }

  const matches = classifier.filter((row) => row.Class === className);
  assert.equal(matches.length, 1, `${fixture.id}: classifier must resolve ${className} exactly once`);
  const row = matches[0];
  const cue = firstT3CodeValue(row["Activation cue"]);
  return {
    route: firstT3CodeValue(row.Route),
    skill: firstT3CodeValue(row.Skill),
    cue: cue === "none" ? null : cue,
  };
}

function validateT3RouteContract(master, fixtures) {
  const classifier = parseRoute0Classifier(master);
  validateRoute0ClassBoundaries(classifier);
  const expected = new Map([
    ["nano-typo", { route: "0", skill: "none", cue: null }],
    ["obvious-error", {
      route: "0",
      skill: "gsd-ponytail",
      cue: "Ponytail: full — scoped to this quick-fix.",
    }],
    ["behavioral-one-line", {
      route: "0",
      skill: "gsd-ponytail",
      cue: "Ponytail: full — scoped to this quick-fix.",
    }],
  ]);

  for (const [id, want] of expected) {
    const fixture = fixtures.find((candidate) => candidate.id === id);
    assert.ok(fixture, `missing ${id} fixture`);
    const actual = classifyRoute0Fixture(fixture, classifier);
    assert.deepEqual(actual, want, `${id}: exact Route 0 classification`);
    assert.equal(fixture.route, actual.route, `${id}: canonical route must match classifier`);
    assert.equal(fixture.skill, actual.skill, `${id}: canonical skill must match classifier`);
    if (id === "obvious-error" || id === "behavioral-one-line") {
      assert.deepEqual(fixture.accept ?? [], [], `${id}: canonical result must have no ambiguous alternate`);
    }
  }
  return classifier;
}

function parsePonytailPolicy(ponytail) {
  const runtimeDomains = ponytail.match(
    /runtime keeps two distinct fields: `explicit_level` is exactly `([^`]+)`, and `auto_scope` is exactly `([^`]+)`/,
  );
  assert.ok(runtimeDomains, "Ponytail must declare both literal runtime-field domains");
  const acceptedDomain = ponytail.match(
    /Accepted explicit toggle levels \(normative\): `([^`]+)`/,
  );
  assert.ok(acceptedDomain, "Ponytail must declare its accepted toggle-level domain normatively");

  const splitDomain = (value, label) => {
    const values = value.split("|");
    assert.ok(values.every(Boolean), `${label} must not contain empty values`);
    assert.equal(new Set(values).size, values.length, `${label} values must be unique`);
    return values;
  };
  const domains = {
    explicit_level: splitDomain(runtimeDomains[1], "explicit_level domain"),
    auto_scope: splitDomain(runtimeDomains[2], "auto_scope domain"),
  };
  const acceptedLevels = splitDomain(acceptedDomain[1], "accepted toggle domain");
  assert.deepEqual(
    acceptedLevels,
    domains.explicit_level.filter((value) => value !== "none"),
    "accepted toggles must equal the non-none explicit_level domain",
  );
  return {
    acceptedLevels,
    domains,
    rows: parseT3Table(
      ponytail,
      "## State transitions (normative)\n",
      PONYTAIL_STATE_HEADER,
    ),
  };
}

function resolvePonytailTemplate(cell, state, input) {
  const current = state.explicit_level;
  const supplied = input.level ?? (current === "none" ? undefined : current);
  const level = supplied === "omitted" ? "full" : supplied;
  return unwrapPolicyCell(cell)
    .replaceAll("<level-or-full>", level ?? "<missing-level>")
    .replaceAll("<current>", current)
    .replaceAll("<scope>", state.auto_scope)
    .replaceAll("<invalid>", level ?? "<missing-level>")
    .replaceAll("<level>", level ?? "<missing-level>");
}

function resolvedPonytailLevel(state, input) {
  const supplied = input.level ?? (state.explicit_level === "none" ? undefined : state.explicit_level);
  return supplied === "omitted" ? "full" : supplied;
}

function validatePonytailInputs(policy, row, scenario, state, input) {
  const rawInputs = parsePolicyAssignments(row.Inputs);
  for (const required of ["event", "explicit_level", "auto_scope"]) {
    assert.ok(
      Object.hasOwn(rawInputs, required),
      `${scenario}: Inputs must include ${required}`,
    );
  }
  const rawValues = Object.values(rawInputs);
  const level = resolvedPonytailLevel(state, input);
  if (rawValues.some((value) => value.includes("<level>") || value.includes("<level-or-full>"))) {
    assert.ok(
      policy.acceptedLevels.includes(level),
      `${scenario}: accepted-level Inputs must receive a policy-accepted level`,
    );
  }
  if (rawValues.some((value) => value.includes("<invalid>"))) {
    assert.ok(
      level !== undefined && !policy.acceptedLevels.includes(level),
      `${scenario}: invalid-level Inputs must reject a policy-accepted level`,
    );
  }

  const expectedInputs = parsePolicyAssignments(resolvePonytailTemplate(row.Inputs, state, input));
  const actualInputs = {
    event: input.event,
    explicit_level: state.explicit_level,
    auto_scope: state.auto_scope,
    level,
    row: input.row,
  };
  for (const [name, expected] of Object.entries(expectedInputs)) {
    assert.ok(
      Object.hasOwn(actualInputs, name),
      `${scenario}: unsupported Inputs field ${name}`,
    );
    assert.equal(actualInputs[name], expected, `${scenario}: Inputs ${name}`);
  }
}

function applyPonytailTransition(policy, scenario, state, input = {}) {
  assert.deepEqual(
    Object.keys(state).sort(),
    ["auto_scope", "explicit_level"],
    "runtime state must use only explicit_level and auto_scope",
  );
  assert.ok(
    policy.domains.explicit_level.includes(state.explicit_level),
    "explicit_level state must be in the policy domain",
  );
  assert.ok(
    policy.domains.auto_scope.includes(state.auto_scope),
    "auto_scope state must be in the policy domain",
  );
  const matches = policy.rows.filter((row) => row.Scenario === scenario);
  assert.equal(matches.length, 1, `${scenario}: state table must resolve exactly once`);
  const row = matches[0];
  validatePonytailInputs(policy, row, scenario, state, input);

  const next = parsePolicyAssignments(resolvePonytailTemplate(row["Next state"], state, input));
  assert.deepEqual(
    Object.keys(next).sort(),
    ["auto_scope", "explicit_level"],
    `${scenario}: next state must assign only explicit_level and auto_scope`,
  );
  assert.ok(
    policy.domains.explicit_level.includes(next.explicit_level),
    `${scenario}: next explicit_level must be in the policy domain`,
  );
  assert.ok(
    policy.domains.auto_scope.includes(next.auto_scope),
    `${scenario}: next auto_scope must be in the policy domain`,
  );

  const nullable = (column) => {
    const value = resolvePonytailTemplate(row[column], state, input);
    return value === "none" || value === "omit" || value === "n/a" ? null : value;
  };
  return {
    state: {
      explicit_level: next.explicit_level,
      auto_scope: next.auto_scope,
    },
    route: nullable("Route"),
    skill: nullable("Skill/load"),
    output: nullable("Output"),
    handoffRow: nullable("Handoff row"),
  };
}

function replaceT3TableCell(content, marker, scenario, column, replacement) {
  const markerStart = content.indexOf(marker);
  assert.ok(markerStart >= 0, `mutation marker missing: ${marker.trim()}`);
  const lines = content.split("\n");
  const markerLine = content.slice(0, markerStart).split("\n").length - 1;
  const headerLine = lines.findIndex((line, index) => index > markerLine && line.startsWith("|"));
  assert.ok(headerLine >= 0, "mutation table header missing");
  const header = lines[headerLine].slice(1, -1).split("|").map((cell) => cell.trim());
  const columnIndex = header.indexOf(column);
  assert.ok(columnIndex >= 0, `mutation column missing: ${column}`);
  const rowLine = lines.findIndex(
    (line, index) => index > headerLine + 1 && line.startsWith(`| ${scenario} |`),
  );
  assert.ok(rowLine >= 0, `mutation scenario missing: ${scenario}`);
  const cells = lines[rowLine].slice(1, -1).split("|").map((cell) => cell.trim());
  cells[columnIndex] = replacement;
  lines[rowLine] = `| ${cells.join(" | ")} |`;
  return lines.join("\n");
}

function deleteT3TableRow(content, marker, scenario) {
  const markerStart = content.indexOf(marker);
  assert.ok(markerStart >= 0, `mutation marker missing: ${marker.trim()}`);
  const lines = content.split("\n");
  const markerLine = content.slice(0, markerStart).split("\n").length - 1;
  const rowLine = lines.findIndex(
    (line, index) => index > markerLine && line.startsWith(`| ${scenario} |`),
  );
  assert.ok(rowLine >= 0, `mutation scenario missing: ${scenario}`);
  lines.splice(rowLine, 1);
  return lines.join("\n");
}

function allowedLevelFeedback(levels) {
  assert.ok(levels.length >= 2, "feedback formatter requires at least two accepted levels");
  return `Ponytail level must be ${levels.slice(0, -1).join(", ")}, or ${levels.at(-1)}.`;
}

function assertSingleActivationCue(transition, label) {
  assert.equal(
    transition.output?.match(/Ponytail:/g)?.length ?? 0,
    1,
    `${label}: activation must emit exactly one cue`,
  );
  assert.doesNotMatch(
    transition.output,
    /\?|Next steps:|(?:^|\n)\s*\d+\./,
    `${label}: activation must not append a question or menu`,
  );
}

function validateT3StateContract(ponytail) {
  const policy = parsePonytailPolicy(ponytail);
  const initial = { explicit_level: "none", auto_scope: "none" };
  const auto = applyPonytailTransition(
    policy,
    "Quick-fix without explicit toggle",
    initial,
    { event: PONYTAIL_EVENTS.quickFix },
  );
  assert.deepEqual(
    auto.state,
    { explicit_level: "none", auto_scope: "quick-fix" },
    "auto-fire must be prompt-local state",
  );
  assertSingleActivationCue(auto, "auto quick-fix");

  const write = applyPonytailTransition(
    policy,
    "Handoff write without explicit toggle",
    auto.state,
    { event: PONYTAIL_EVENTS.handoffWrite },
  );
  assert.equal(write.handoffRow, null, "auto-fire must never be serialized");

  const landed = applyPonytailTransition(
    policy,
    "Fix lands/merges",
    auto.state,
    { event: PONYTAIL_EVENTS.fixLanded },
  );
  assert.deepEqual(landed.state, initial, "landing must clear auto_scope");
  const unrelated = applyPonytailTransition(
    policy,
    "Unrelated prompt",
    auto.state,
    { event: PONYTAIL_EVENTS.unrelatedPrompt },
  );
  assert.deepEqual(unrelated.state, initial, "an unrelated prompt must clear auto_scope");

  const blocked = applyPonytailTransition(
    policy,
    "Hard-blocker or verify-fail stop",
    auto.state,
    { event: PONYTAIL_EVENTS.blockerStop },
  );
  assert.deepEqual(blocked.state, initial, "a blocker stop must clear auto_scope");
  const resumed = applyPonytailTransition(
    policy,
    "Quick-fix without explicit toggle",
    blocked.state,
    { event: PONYTAIL_EVENTS.quickFix },
  );
  assert.equal(resumed.state.auto_scope, "quick-fix", "resume must reclassify and may auto-fire anew");

  const ultraToggle = applyPonytailTransition(
    policy,
    "Explicit toggle",
    initial,
    { event: PONYTAIL_EVENTS.toggle, level: "ultra" },
  );
  const explicitQuickFix = applyPonytailTransition(
    policy,
    "Quick-fix with explicit toggle",
    ultraToggle.state,
    { event: PONYTAIL_EVENTS.quickFix },
  );
  assert.deepEqual(
    explicitQuickFix.state,
    { explicit_level: "ultra", auto_scope: "none" },
    "explicit level must take precedence without auto_scope",
  );
  assert.equal(
    explicitQuickFix.output,
    "Ponytail: ultra — explicit session scope; applied to this quick-fix.",
  );
  assertSingleActivationCue(explicitQuickFix, "explicit quick-fix");
  const explicitBlocked = applyPonytailTransition(
    policy,
    "Hard-blocker or verify-fail stop",
    explicitQuickFix.state,
    { event: PONYTAIL_EVENTS.blockerStop },
  );
  assert.deepEqual(
    explicitBlocked.state,
    { explicit_level: "ultra", auto_scope: "none" },
    "blocker stop must preserve explicit_level",
  );

  for (const level of policy.acceptedLevels) {
    const restored = applyPonytailTransition(
      policy,
      "Handoff restore with explicit toggle",
      { explicit_level: "ultra", auto_scope: "quick-fix" },
      {
        event: PONYTAIL_EVENTS.handoffRestore,
        level,
        row: `ponytail_level,${level}`,
      },
    );
    assert.deepEqual(
      restored.state,
      { explicit_level: level, auto_scope: "none" },
      `handoff restore must accept ${level} and clear auto_scope`,
    );
  }
  const absentRestore = applyPonytailTransition(
    policy,
    "Handoff restore without explicit toggle",
    { explicit_level: "ultra", auto_scope: "quick-fix" },
    { event: PONYTAIL_EVENTS.handoffRestore, row: "missing" },
  );
  assert.deepEqual(absentRestore.state, initial, "absent restore must initialize both fields to none");

  const invalidLevel = ["extreme", "maximum"].find(
    (candidate) => !policy.acceptedLevels.includes(candidate),
  );
  const invalidRestore = applyPonytailTransition(
    policy,
    "Handoff restore with invalid explicit toggle",
    { explicit_level: "ultra", auto_scope: "quick-fix" },
    {
      event: PONYTAIL_EVENTS.handoffRestore,
      level: invalidLevel,
      row: `ponytail_level,${invalidLevel}`,
    },
  );
  assert.deepEqual(invalidRestore.state, initial, "invalid restore must initialize both fields to none");

  const invalidToggle = applyPonytailTransition(
    policy,
    "Invalid explicit toggle",
    { explicit_level: "lite", auto_scope: "quick-fix" },
    { event: PONYTAIL_EVENTS.toggle, level: invalidLevel },
  );
  assert.deepEqual(
    invalidToggle.state,
    { explicit_level: "lite", auto_scope: "none" },
    "invalid toggle must preserve explicit_level and clear auto_scope",
  );
  assert.equal(
    invalidToggle.output,
    allowedLevelFeedback(policy.acceptedLevels),
    "invalid toggle feedback must derive from the policy domain",
  );
  assert.ok(
    !Object.values(invalidToggle.state).includes(invalidLevel),
    "invalid toggle value must never become runtime state",
  );

  const defaultToggle = applyPonytailTransition(
    policy,
    "Explicit toggle",
    initial,
    { event: PONYTAIL_EVENTS.toggle, level: "omitted" },
  );
  assert.equal(defaultToggle.state.explicit_level, "full", "omitted level must default to full");
  const stop = applyPonytailTransition(
    policy,
    "Stop or normal mode",
    explicitQuickFix.state,
    { event: PONYTAIL_EVENTS.stop },
  );
  assert.deepEqual(stop.state, initial, "stop must set both fields to none");
  const dispatch = applyPonytailTransition(
    policy,
    "Fresh task dispatch",
    explicitQuickFix.state,
    { event: PONYTAIL_EVENTS.dispatch },
  );
  assert.deepEqual(
    dispatch.state,
    { explicit_level: "ultra", auto_scope: "none" },
    "dispatch must derive only explicit_level",
  );
  const nano = applyPonytailTransition(
    policy,
    "Nano",
    initial,
    { event: PONYTAIL_EVENTS.nano },
  );
  assert.deepEqual(
    { route: nano.route, skill: nano.skill, output: nano.output },
    { route: "0", skill: null, output: null },
    "nano must remain direct without Ponytail",
  );
  return policy;
}

test("T3 Route 0 classes are disjoint for typo, obvious error, and one-line behavioral fixtures (AC-7)", () => {
  const fixtures = JSON.parse(readFileSync(join(ROOT, "test", "eval", "fixtures.json"), "utf8"));
  validateT3RouteContract(readSkill("gsd"), fixtures);
});

test("T3 state table uses the literal runtime schema and validates Inputs events", () => {
  const policy = validateT3StateContract(readSkill("gsd-ponytail"));
  assert.deepEqual(policy.domains, {
    explicit_level: ["none", "lite", "full", "ultra"],
    auto_scope: ["none", "quick-fix"],
  });
  for (const row of policy.rows) {
    assert.doesNotMatch(
      `${row.Inputs};${row["Next state"]}`,
      /(?:^|;)(?:explicit|auto)=/,
      `${row.Scenario}: state-key aliases are forbidden`,
    );
  }
  assert.throws(
    () => applyPonytailTransition(
      policy,
      "Quick-fix without explicit toggle",
      { explicit_level: "none", auto_scope: "none" },
      { event: PONYTAIL_EVENTS.nano },
    ),
    /Quick-fix without explicit toggle: Inputs event/,
    "the evaluator must reject an event that does not match the Inputs cell",
  );
});

test("T3 explicit ultra wins over quick-fix auto-fire and full survives handoff", () => {
  const policy = parsePonytailPolicy(readSkill("gsd-ponytail"));
  const none = { explicit_level: "none", auto_scope: "none" };
  const ultra = applyPonytailTransition(
    policy,
    "Explicit toggle",
    none,
    { event: PONYTAIL_EVENTS.toggle, level: "ultra" },
  );
  const quickFix = applyPonytailTransition(
    policy,
    "Quick-fix with explicit toggle",
    ultra.state,
    { event: PONYTAIL_EVENTS.quickFix },
  );
  assert.equal(
    quickFix.output,
    "Ponytail: ultra — explicit session scope; applied to this quick-fix.",
  );
  assert.deepEqual(quickFix.state, { explicit_level: "ultra", auto_scope: "none" });
  assertSingleActivationCue(quickFix, "explicit ultra quick-fix");

  const full = applyPonytailTransition(
    policy,
    "Explicit toggle",
    none,
    { event: PONYTAIL_EVENTS.toggle, level: "full" },
  );
  const write = applyPonytailTransition(
    policy,
    "Handoff write with explicit toggle",
    full.state,
    { event: PONYTAIL_EVENTS.handoffWrite },
  );
  assert.equal(write.handoffRow, "ponytail_level,full");
  const restore = applyPonytailTransition(
    policy,
    "Handoff restore with explicit toggle",
    { explicit_level: "ultra", auto_scope: "quick-fix" },
    {
      event: PONYTAIL_EVENTS.handoffRestore,
      level: "full",
      row: "ponytail_level,full",
    },
  );
  assert.deepEqual(restore.state, { explicit_level: "full", auto_scope: "none" });
});

test("T3 blocker stop expires auto scope and resume reclassifies the same fix", () => {
  const policy = parsePonytailPolicy(readSkill("gsd-ponytail"));
  const initial = { explicit_level: "none", auto_scope: "none" };
  const auto = applyPonytailTransition(
    policy,
    "Quick-fix without explicit toggle",
    initial,
    { event: PONYTAIL_EVENTS.quickFix },
  );
  const blocked = applyPonytailTransition(
    policy,
    "Hard-blocker or verify-fail stop",
    auto.state,
    { event: PONYTAIL_EVENTS.blockerStop },
  );
  assert.deepEqual(blocked.state, initial);
  const resumed = applyPonytailTransition(
    policy,
    "Quick-fix without explicit toggle",
    blocked.state,
    { event: PONYTAIL_EVENTS.quickFix },
  );
  assert.deepEqual(resumed.state, { explicit_level: "none", auto_scope: "quick-fix" });
});

test("T3 handoff restore covers lite/full/ultra, absent, and invalid rows", () => {
  const policy = parsePonytailPolicy(readSkill("gsd-ponytail"));
  const stale = { explicit_level: "ultra", auto_scope: "quick-fix" };
  for (const level of policy.acceptedLevels) {
    const restored = applyPonytailTransition(
      policy,
      "Handoff restore with explicit toggle",
      stale,
      {
        event: PONYTAIL_EVENTS.handoffRestore,
        level,
        row: `ponytail_level,${level}`,
      },
    );
    assert.deepEqual(restored.state, { explicit_level: level, auto_scope: "none" });
  }
  const absent = applyPonytailTransition(
    policy,
    "Handoff restore without explicit toggle",
    stale,
    { event: PONYTAIL_EVENTS.handoffRestore, row: "missing" },
  );
  assert.deepEqual(absent.state, { explicit_level: "none", auto_scope: "none" });
  const invalid = applyPonytailTransition(
    policy,
    "Handoff restore with invalid explicit toggle",
    stale,
    {
      event: PONYTAIL_EVENTS.handoffRestore,
      level: "extreme",
      row: "ponytail_level,extreme",
    },
  );
  assert.deepEqual(invalid.state, { explicit_level: "none", auto_scope: "none" });
});

test("T3 dispatch, handoff, blocker, and invalid-toggle boundaries share the policy schema (AC-8)", () => {
  const execution = readSkill("gsd-executing-plans");
  assert.match(execution, /copy only `explicit_level`/, "task dispatch must read explicit_level");
  assert.match(execution, /never propagate `auto_scope`/, "task dispatch must exclude auto_scope");
  assert.match(
    execution,
    /hard-blocker or verify-fail stop[\s\S]*preserve `explicit_level`[\s\S]*`auto_scope=none`/,
    "execution blocker boundary must expire auto_scope",
  );

  const handoff = readSkill("gsd-handoff");
  assert.match(handoff, /write exactly `ponytail_level,<level>` for that valid active level/, "handoff writer must persist explicit state");
  assert.match(handoff, /never write `ponytail_level,none`/, "handoff writer must omit stopped/default state");
  assert.match(handoff, /Quick-fix auto-fire[\s\S]*MUST NOT be serialized/, "handoff writer must exclude auto scope");
  assert.match(
    handoff,
    /Before `next_action`, initialize[\s\S]*`explicit_level=none` and `auto_scope=none`[\s\S]*valid row overrides only `explicit_level`[\s\S]*absent or invalid row leaves both fields at `none`/,
    "handoff reader must reset both fields before validating the row",
  );
  assert.match(handoff, /preserve its `mode` and `phase` exactly/, "Ponytail restoration must not narrow opaque handoff fields");

  const policy = parsePonytailPolicy(readSkill("gsd-ponytail"));
  assert.deepEqual(policy.acceptedLevels, ["lite", "full", "ultra"]);
  const invalid = applyPonytailTransition(
    policy,
    "Invalid explicit toggle",
    { explicit_level: "full", auto_scope: "quick-fix" },
    { event: PONYTAIL_EVENTS.toggle, level: "extreme" },
  );
  assert.deepEqual(invalid.state, { explicit_level: "full", auto_scope: "none" });
  assert.equal(invalid.output, allowedLevelFeedback(policy.acceptedLevels));
});

test("T3 mutation guard rejects canonical quick-fix fixture drift", () => {
  const fixtures = JSON.parse(readFileSync(join(ROOT, "test", "eval", "fixtures.json"), "utf8"));
  for (const id of ["obvious-error", "behavioral-one-line"]) {
    const mutated = structuredClone(fixtures);
    const fixture = mutated.find((candidate) => candidate.id === id);
    fixture.skill = "none";
    assert.throws(
      () => validateT3RouteContract(readSkill("gsd"), mutated),
      new RegExp(`${id}: canonical skill must match classifier`),
    );
  }
});

test("T3 mutation guard rejects a behavioral one-line Nano overlap", () => {
  const marker = "**Route 0 classifier (normative).**\n";
  const mutated = replaceT3TableCell(
    readSkill("gsd"),
    marker,
    "Nano",
    "Deterministic boundary",
    "One-line or purely mechanical typo, literal, import, rename, or format change",
  );
  const fixtures = JSON.parse(readFileSync(join(ROOT, "test", "eval", "fixtures.json"), "utf8"));
  assert.throws(
    () => validateT3RouteContract(mutated, fixtures),
    /Nano must exclude behavioral changes/,
  );
});

test("T3 mutation guard rejects runtime field-name drift", () => {
  const marker = "## State transitions (normative)\n";
  const mutated = replaceT3TableCell(
    readSkill("gsd-ponytail"),
    marker,
    "Quick-fix without explicit toggle",
    "Next state",
    "`wrong_explicit_level=none;auto_scope=quick-fix`",
  );
  assert.throws(
    () => validateT3StateContract(mutated),
    /next state must assign only explicit_level and auto_scope/,
  );
});

test("T3 mutation guard rejects blocker expiry and explicit-over-auto drift", () => {
  const marker = "## State transitions (normative)\n";
  const ponytail = readSkill("gsd-ponytail");
  const blockerMutant = replaceT3TableCell(
    ponytail,
    marker,
    "Hard-blocker or verify-fail stop",
    "Next state",
    "`explicit_level=<current>;auto_scope=quick-fix`",
  );
  assert.throws(
    () => validateT3StateContract(blockerMutant),
    /a blocker stop must clear auto_scope/,
  );

  const precedenceMutant = replaceT3TableCell(
    ponytail,
    marker,
    "Quick-fix with explicit toggle",
    "Next state",
    "`explicit_level=full;auto_scope=quick-fix`",
  );
  assert.throws(
    () => validateT3StateContract(precedenceMutant),
    /explicit level must take precedence without auto_scope/,
  );
});

test("T3 mutation guard rejects deleted precedence, blocker, absent, and invalid restore rows", () => {
  const marker = "## State transitions (normative)\n";
  const ponytail = readSkill("gsd-ponytail");
  for (const scenario of [
    "Quick-fix with explicit toggle",
    "Hard-blocker or verify-fail stop",
    "Handoff restore without explicit toggle",
    "Handoff restore with invalid explicit toggle",
  ]) {
    const mutated = deleteT3TableRow(ponytail, marker, scenario);
    assert.throws(
      () => validateT3StateContract(mutated),
      new RegExp(`${scenario}: state table must resolve exactly once`),
    );
  }
});

test("T3 mutation guard rejects policy-domain drift and policy-derived invalid-level behavior", () => {
  const ponytail = readSkill("gsd-ponytail");
  const domainMutant = ponytail.replace(
    "Accepted explicit toggle levels (normative): `lite|full|ultra`",
    "Accepted explicit toggle levels (normative): `lite|full|ultra|extreme`",
  );
  assert.notEqual(domainMutant, ponytail, "policy-domain mutation must apply");
  assert.throws(
    () => validateT3StateContract(domainMutant),
    /accepted toggles must equal the non-none explicit_level domain/,
  );

  const marker = "## State transitions (normative)\n";
  const outcomeMutant = replaceT3TableCell(
    ponytail,
    marker,
    "Invalid explicit toggle",
    "Next state",
    "`explicit_level=none;auto_scope=quick-fix`",
  );
  assert.throws(
    () => validateT3StateContract(outcomeMutant),
    /invalid toggle must preserve explicit_level and clear auto_scope/,
  );
});

test("T3 mutation guard rejects Inputs-event drift and auto-fire handoff leakage", () => {
  const marker = "## State transitions (normative)\n";
  const ponytail = readSkill("gsd-ponytail");
  const inputMutant = replaceT3TableCell(
    ponytail,
    marker,
    "Quick-fix without explicit toggle",
    "Inputs",
    "`explicit_level=none;auto_scope=none`",
  );
  assert.throws(
    () => validateT3StateContract(inputMutant),
    /Quick-fix without explicit toggle: Inputs must include event/,
  );

  const handoffMutant = replaceT3TableCell(
    ponytail,
    marker,
    "Handoff write without explicit toggle",
    "Handoff row",
    "`ponytail_level,full`",
  );
  assert.throws(
    () => validateT3StateContract(handoffMutant),
    /auto-fire must never be serialized/,
  );
});

// ── Planning decomposition and precision (T4) ───────────

const T4_PLANNING_POLICY_MARKER = "### Executable planning policy scenarios (normative)\n";
const T4_PLANNING_POLICY_HEADER = [
  "Scenario",
  "Inputs",
  "Output",
  "Proposal handling",
  "Tasks/order",
  "Test seam",
  "Lower seam",
  "Green/check",
  "Artifact",
];
const T4_SEAM_RANK = Object.freeze({
  "public-module": 1,
  boundary: 2,
});
const T4_POLICY_ROWS = Object.freeze({
  "Cross-layer user behavior": {
    Inputs: "phase=plan;kind=behavior;proposal=cross-layer;wide-refactor=no",
    Output: "vertical-behavior-slice",
    "Proposal handling": "accept",
    "Tasks/order": "Vertical:all-required-layers",
    "Test seam": "highest-existing-deterministic-public",
    "Lower seam": "concrete-reason-required",
    "Green/check": "each-row-focused-and-green",
    Artifact: "plan.toon",
  },
  "Ordinary three-layer proposal": {
    Inputs: "phase=plan;kind=behavior;proposal=horizontal-layers;wide-refactor=no",
    Output: "vertical-behavior-slice",
    "Proposal handling": "reject-and-rewrite",
    "Tasks/order": "Vertical:all-required-layers",
    "Test seam": "highest-existing-deterministic-public",
    "Lower seam": "concrete-reason-required",
    "Green/check": "each-row-focused-and-green",
    Artifact: "plan.toon",
  },
  "Blast-radius mechanical refactor": {
    Inputs: "phase=plan;kind=mechanical-refactor;blast-radius=wide;atomic-green=no",
    Output: "ordered-expand-migrate-contract",
    "Proposal handling": "allowed-only-for-unavoidable-wide-refactor",
    "Tasks/order": "Expand:backward-compatible-new-seam;Migrate+:bounded-callers;Contract:remove-old-seam",
    "Test seam": "highest-existing-deterministic-public",
    "Lower seam": "concrete-reason-required",
    "Green/check": "each-row-focused-and-green",
    Artifact: "plan.toon",
  },
  "Precise future milestone": {
    Inputs: "phase=discussion;kind=future;precision=question-or-ac-check",
    Output: "precise-milestone-or-spec",
    "Proposal handling": "eligible",
    "Tasks/order": "none",
    "Test seam": "pin-at-convergence",
    "Lower seam": "not-applicable",
    "Green/check": "precise-question-or-checked-ACs+Check;unchecked-remainder-one-note",
    Artifact: "spec.md-if-AC+Check",
  },
  "Vague future area": {
    Inputs: "phase=discussion;kind=future;precision=vague",
    Output: "one-fog/future/out-of-scope-note",
    "Proposal handling": "hold-until-new-evidence",
    "Tasks/order": "none",
    "Test seam": "none",
    "Lower seam": "not-applicable",
    "Green/check": "one-note-no-task",
    Artifact: "none",
  },
});

function readPlanningReference() {
  return readFileSync(join(SKILLS_DIR, "gsd", "REFERENCE.md"), "utf8");
}

function parseT4PlanningPolicy(reference) {
  return parseT3Table(
    reference,
    T4_PLANNING_POLICY_MARKER,
    T4_PLANNING_POLICY_HEADER,
  ).map((row) => ({
    ...row,
    inputs: parsePolicyAssignments(row.Inputs),
  }));
}

function validateT4PlanningPolicy(policy) {
  assert.equal(
    policy.length,
    Object.keys(T4_POLICY_ROWS).length,
    "planning policy must contain exactly the five contract scenarios",
  );
  for (const [scenario, expected] of Object.entries(T4_POLICY_ROWS)) {
    const matches = policy.filter((row) => row.Scenario === scenario);
    assert.equal(matches.length, 1, `${scenario}: policy must resolve exactly once`);
    const actual = Object.fromEntries(
      Object.keys(expected).map((column) => [column, unwrapPolicyCell(matches[0][column])]),
    );
    assert.deepEqual(actual, expected, `${scenario}: policy row`);
  }
  assert.deepEqual(
    [...new Set(policy.map((row) => unwrapPolicyCell(row.Artifact)))].sort(),
    ["none", "plan.toon", "spec.md-if-AC+Check"],
    "planning policy must use only existing plan/spec artifacts or none",
  );
  return policy;
}

function matchT4PlanningPolicy(policy, fixture) {
  const matches = policy.filter(({ inputs }) => Object.entries(inputs)
    .every(([key, value]) => String(fixture[key]) === value));
  assert.equal(
    matches.length,
    1,
    `${fixture.id}: planning policy must resolve exactly once`,
  );
  return matches[0];
}

function isUsableT4Seam(seam) {
  return seam.existing === true
    && seam.public === true
    && seam.testOnly !== true
    && seam.testOnlyBypass !== true
    && seam.deterministic === true
    && seam.isolatesAc === true;
}


function classifyT4ClaimedLowerCause(reason, fixtureId) {
  const value = reason ?? "";
  const claims = [
    {
      cause: "absent",
      matches: /(?:does not exist|\bmissing\b|\babsent\b)/i.test(value),
    },
    {
      cause: "deterministic-isolation-failure",
      matches: /(?:nondeterministic|not deterministic|cannot deterministically isolate|cannot isolate)/i.test(value),
    },
  ].filter(({ matches }) => matches);
  assert.equal(
    claims.length,
    1,
    `${fixtureId}: lower public seam requires a concrete higher-boundary reason`,
  );
  return claims[0].cause;
}

function actualT4LowerCause(fixture, selected) {
  const existingHigherPublic = fixture.seams.filter(
    (seam) => T4_SEAM_RANK[seam.level] > T4_SEAM_RANK[selected.level]
      && seam.existing === true
      && seam.public === true
      && seam.testOnly !== true,
  );
  return existingHigherPublic.length === 0
    ? "absent"
    : "deterministic-isolation-failure";
}

function validateT4SpecAcSet(fixture) {
  assert.ok(
    Array.isArray(fixture.specAcIds) && fixture.specAcIds.length > 0,
    `${fixture.id}: actual spec AC ID set is required`,
  );
  assert.equal(
    new Set(fixture.specAcIds).size,
    fixture.specAcIds.length,
    `${fixture.id}: actual spec AC IDs must be unique`,
  );
  assert.ok(
    fixture.specAcIds.every((id) => /^AC-\d+[A-Z0-9-]*$/.test(id)),
    `${fixture.id}: actual spec contains an invalid AC ID`,
  );
}

function validateT4RowAcReferences(fixture, satisfies, taskId) {
  const satisfiedAcIds = typeof satisfies === "string" ? satisfies.split("|") : [];
  assert.ok(
    satisfiedAcIds.length > 0 && satisfiedAcIds.every(Boolean),
    `${fixture.id}: ${taskId} must satisfy at least one AC`,
  );
  assert.equal(
    new Set(satisfiedAcIds).size,
    satisfiedAcIds.length,
    `${fixture.id}: ${taskId} satisfies IDs must be unique`,
  );
  for (const acId of satisfiedAcIds) {
    assert.ok(
      fixture.specAcIds.includes(acId),
      `${fixture.id}: ${taskId} has unknown satisfies AC ID ${acId}`,
    );
  }
  return satisfiedAcIds;
}

function validateT4PlanAcReferences(fixture, tasks, selected) {
  validateT4SpecAcSet(fixture);
  const covered = tasks.flatMap((task) => (
    validateT4RowAcReferences(fixture, task.satisfies, task.id)
  ));
  const coveredAcIds = [...new Set(covered)];
  assert.deepEqual(
    coveredAcIds.sort(),
    [...fixture.specAcIds].sort(),
    `${fixture.id}: global plan AC coverage must match the actual spec AC set`,
  );
  validateT4AcSeamPins(fixture, coveredAcIds, selected);
}


function chooseT4SameTierSeam(fixture, usable) {
  const highestRank = Math.max(...usable.map((seam) => T4_SEAM_RANK[seam.level]));
  let candidates = usable.filter((seam) => T4_SEAM_RANK[seam.level] === highestRank);
  assert.ok(
    typeof fixture.acEntrypoint === "string" && fixture.acEntrypoint.trim(),
    `${fixture.id}: AC/Check must name its production entrypoint`,
  );
  const entrypointCandidates = candidates.filter(
    (seam) => seam.entrypoint === fixture.acEntrypoint,
  );
  if (entrypointCandidates.length > 0) {
    candidates = entrypointCandidates;
  } else {
    assert.ok(
      highestRank < T4_SEAM_RANK.boundary,
      `${fixture.id}: no highest-tier boundary harness observes the AC/Check production entrypoint`,
    );
  }
  const canonical = candidates.filter((seam) => seam.canonical === true);
  if (canonical.length > 0) candidates = canonical;
  for (const seam of candidates) {
    assert.ok(
      Number.isFinite(seam.productionPathCoverage) && seam.productionPathCoverage >= 0,
      `${fixture.id}: same-tier harness needs production-path coverage evidence`,
    );
  }
  const greatestCoverage = Math.max(...candidates.map((seam) => seam.productionPathCoverage));
  candidates = candidates.filter((seam) => seam.productionPathCoverage === greatestCoverage);
  assert.equal(
    candidates.length,
    1,
    `${fixture.id}: same-tier public harnesses remain materially ambiguous; stop in Discussion`,
  );
  return candidates[0];
}

function validateT4AcSeamPins(fixture, satisfiedAcIds, selected) {
  const normalizeReason = (reason) => reason ?? "none";
  if (fixture.specEra === "legacy") {
    assert.equal(
      fixture.acPins,
      undefined,
      `${fixture.id}: legacy no-pin fixture must not fabricate AC seam pins`,
    );
    return;
  }
  assert.equal(
    fixture.specEra,
    "current",
    `${fixture.id}: spec era must be current or legacy`,
  );
  assert.ok(Array.isArray(fixture.acPins), `${fixture.id}: current spec needs AC seam pins`);
  assert.equal(
    fixture.acPins.length,
    satisfiedAcIds.length,
    `${fixture.id}: every satisfied AC needs exactly one seam pin`,
  );
  for (const pin of fixture.acPins) {
    assert.ok(
      fixture.specAcIds.includes(pin.id),
      `${fixture.id}: seam pin references unknown AC ID ${pin.id}`,
    );
  }
  assert.equal(
    new Set(fixture.acPins.map((pin) => pin.id)).size,
    fixture.acPins.length,
    `${fixture.id}: duplicate AC seam pins are invalid`,
  );
  for (const acId of satisfiedAcIds) {
    const pins = fixture.acPins.filter((pin) => pin.id === acId);
    assert.equal(pins.length, 1, `${fixture.id}: ${acId} needs exactly one seam pin`);
    assert.equal(
      pins[0].test,
      selected.path,
      `${fixture.id}: every satisfied AC must share the selected test seam`,
    );
    assert.equal(
      normalizeReason(pins[0].lowerSeamReason),
      normalizeReason(fixture.lowerSeamReason),
      `${fixture.id}: every satisfied AC must share the selected lower-seam reason`,
    );
  }
}

function selectT4PublicSeam(row, fixture) {
  const directive = unwrapPolicyCell(row["Test seam"]);
  if (directive !== "highest-existing-deterministic-public") return null;
  assert.ok(
    Array.isArray(fixture.seams) && fixture.seams.length > 0,
    `${fixture.id}: planning requires the relevant existing seam layout`,
  );
  for (const seam of fixture.seams) {
    assert.ok(
      Object.hasOwn(T4_SEAM_RANK, seam.level),
      `${fixture.id}: unknown public seam level ${seam.level}`,
    );
  }
  const proposed = fixture.seams.find((seam) => seam.path === fixture.planTest);
  assert.ok(
    proposed,
    `${fixture.id}: existing plan row test must propose a seam in the relevant live layout`,
  );
  assert.ok(
    isUsableT4Seam(proposed),
    `${fixture.id}: proposed plan-row seam must be public deterministic existing and observe the AC`,
  );
  const usable = fixture.seams.filter(isUsableT4Seam);
  assert.ok(usable.length > 0, `${fixture.id}: no usable existing public seam`);
  const selected = chooseT4SameTierSeam(fixture, usable);
  assert.equal(
    proposed.path,
    selected.path,
    `${fixture.id}: plan row test must equal the deterministic highest usable public seam`,
  );

  if (T4_SEAM_RANK[selected.level] < T4_SEAM_RANK.boundary) {
    assert.equal(
      unwrapPolicyCell(row["Lower seam"]),
      "concrete-reason-required",
      `${fixture.id}: lower-seam policy must require a reason`,
    );
    assert.equal(
      classifyT4ClaimedLowerCause(fixture.lowerSeamReason, fixture.id),
      actualT4LowerCause(fixture, selected),
      `${fixture.id}: lower-seam reason must match the live higher-boundary cause`,
    );
    const usableHigher = fixture.seams.filter(
      (seam) => T4_SEAM_RANK[seam.level] > T4_SEAM_RANK[selected.level]
        && isUsableT4Seam(seam),
    );
    assert.deepEqual(
      usableHigher,
      [],
      `${fixture.id}: a concrete reason cannot bypass a usable higher boundary`,
    );
  } else {
    assert.ok(
      fixture.lowerSeamReason == null || fixture.lowerSeamReason === "none",
      `${fixture.id}: highest boundary seam must record Lower-Seam Reason: none`,
    );
  }
  return {
    ...selected,
    lowerSeamReason: fixture.lowerSeamReason ?? "none",
  };
}


function parseT4TaskTemplates(cell) {
  const value = unwrapPolicyCell(cell);
  if (value === "none") return [];
  return value.split(";").map((template) => {
    const separator = template.indexOf(":");
    assert.ok(separator > 0, `invalid planning task template: ${template}`);
    const rawStage = template.slice(0, separator);
    return {
      repeated: rawStage.endsWith("+"),
      stage: rawStage.replace(/\+$/, ""),
      scope: template.slice(separator + 1),
    };
  });
}

const T4_PLACEHOLDER_TEXT = /\b(?:TBD|TODO|FIXME|placeholder|something|somehow|later)\b/i;
const T4_GENERIC_CHECK_WORDS = new Set([
  "a", "all", "an", "and", "as", "at", "correct", "correctly", "do", "done",
  "everything", "expected", "for", "it", "of", "on", "perform", "run", "some",
  "stuff", "task", "test", "that", "the", "thing", "this", "to", "verify", "work",
  "works", "working",
]);
const T4_CONCRETE_ACTION_START = /^(?:submit|create|fetch|request|invoke|call|send|open|select|enter|click|query|read|write|load|save|delete|update|attempt|replay|compare|inspect|list|render|navigate|upload|download|inventory|post|get|put|patch|head)\b/i;
const T4_OBSERVABLE_RESULT = /\b(?:contains?|equals?|includes?|match(?:es)?|prints?|rejects?|responds?|returns?|shows?)\b\s+([^,;.]+)/gi;

const T4_BARE_OUTCOME_WORDS = new Set([
  "status", "state", "result", "results",
  "value", "values", "outcome", "output",
]);

function normalizeT4SemanticPhrase(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function t4IncludesSemanticPhrase(value, phrase) {
  return ` ${normalizeT4SemanticPhrase(value)} `
    .includes(` ${normalizeT4SemanticPhrase(phrase)} `);
}

function t4SpecificWords(value) {
  return (value.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) ?? [])
    .filter((word) => word.length > 1 && !T4_GENERIC_CHECK_WORDS.has(word));
}

function hasT4ObservableExpectedResult(expected) {
  for (const match of expected.matchAll(T4_OBSERVABLE_RESULT)) {
    const observableSubject = expected.slice(0, match.index);
    const resultWords = t4SpecificWords(match[1])
      .filter((word) => !T4_BARE_OUTCOME_WORDS.has(word));
    if (
      t4SpecificWords(observableSubject).length > 0
      && resultWords.length > 0
    ) return true;
  }
  return false;
}

function parseT4ConcreteCheck(check) {
  if (typeof check !== "string") return null;
  const value = check.trim();
  if (!value || T4_PLACEHOLDER_TEXT.test(value)) return null;
  const parts = value.split("→");
  if (parts.length !== 2) return null;
  const [action, expected] = parts.map((part) => part.trim());
  if (
    action.length < 4
    || expected.length < 2
    || !T4_CONCRETE_ACTION_START.test(action)
    || t4SpecificWords(action).length < 3
    || !hasT4ObservableExpectedResult(expected)
  ) return null;
  return { action, expected };
}

function assertT4CheckOracle(parsed, oracle, fixtureId, context) {
  assert.ok(oracle && typeof oracle === "object", `${fixtureId}: ${context} needs an AC-derived semantic oracle`);
  assert.ok(
    normalizeT4SemanticPhrase(parsed.action)
      .startsWith(`${normalizeT4SemanticPhrase(oracle.operation)} `),
    `${fixtureId}: ${context} action must match the AC-derived operation`,
  );
  for (const phrase of oracle.actionPhrases) {
    assert.ok(
      t4IncludesSemanticPhrase(parsed.action, phrase),
      `${fixtureId}: ${context} action must include AC-derived ${phrase}`,
    );
  }
  const observations = [...parsed.expected.matchAll(T4_OBSERVABLE_RESULT)];
  assert.ok(
    observations.some((match) => {
      const subject = parsed.expected.slice(0, match.index);
      return oracle.observerPhrases.every((phrase) => t4IncludesSemanticPhrase(subject, phrase))
        && oracle.statePhrases.every((phrase) => t4IncludesSemanticPhrase(match[1], phrase));
    }),
    `${fixtureId}: ${context} expected result must match the AC-derived observation`,
  );
}

function assertT4ConcreteCheck(check, fixtureId, context, oracle = null) {
  const parsed = parseT4ConcreteCheck(check);
  assert.ok(
    parsed,
    `${fixtureId}: ${context} needs concrete action → expected observable result, not a placeholder`,
  );
  if (oracle) assertT4CheckOracle(parsed, oracle, fixtureId, context);
  return parsed;
}

function isMateriallyAnswerableT4Question(question, oracle) {
  if (
    typeof question !== "string"
    || !oracle
    || T4_PLACEHOLDER_TEXT.test(question)
  ) return false;
  const canonical = `Which ${oracle.subject} ${oracle.property} is ${oracle.constraint} for ${oracle.context}?`;
  return normalizeT4SemanticPhrase(question) === normalizeT4SemanticPhrase(canonical);
}

function t4CheckClauses(value) {
  return value.split(/\b(?:and|then|while|but)\b|[,;]/i)
    .map((clause) => normalizeT4SemanticPhrase(clause))
    .filter(Boolean);
}

function validateT4EmcCheck(fixture, task, parsedCheck, oracle) {
  if (task.stage === "Expand" || task.stage === "Migrate") {
    assert.ok(
      oracle && Array.isArray(oracle.actionClauses) && Array.isArray(oracle.expectedClauses),
      `${fixture.id}: ${task.stage} needs AC-derived per-seam check clauses`,
    );
    assert.deepEqual(
      t4CheckClauses(parsedCheck.action),
      oracle.actionClauses.map(normalizeT4SemanticPhrase),
      `${fixture.id}: ${task.stage} check must affirmatively exercise each old and new seam`,
    );
    assert.deepEqual(
      t4CheckClauses(parsedCheck.expected),
      oracle.expectedClauses.map(normalizeT4SemanticPhrase),
      `${fixture.id}: ${task.stage} check must expect an affirmative safe result from each old and new seam`,
    );
    return;
  }
  assert.equal(task.stage, "Contract", `${fixture.id}: unknown EMC stage ${task.stage}`);
  assert.match(
    parsedCheck.action,
    /\binventor(?:y|ied|ies)\b[\s\S]*(?:caller|reference)|(?:caller|reference)[\s\S]*\binventor(?:y|ied|ies)\b/i,
    `${fixture.id}: Contract check must explicitly inventory callers/references`,
  );
  assert.match(
    parsedCheck.expected,
    /^(?=[\s\S]*\b(?:zero|no|none|gone|absent|removed|eliminated)\b)(?=[\s\S]*\b(?:stale|old|obsolete|remaining)\b(?:\s+(?!and\b|then\b|but\b|or\b)\w+){0,2}\s+(?:caller|reference)s?\b)/i,
    `${fixture.id}: Contract check must expect zero stale callers/references`,
  );
  assert.match(
    parsedCheck.expected,
    /\b(?:public\s+)?api\s+(?:response|status)\s+(?:returns?|equals?|is|remains)\s+green\b/i,
    `${fixture.id}: Contract check must expect the public API to remain green`,
  );
}

function validateT4EmcSafetyResult(fixture, task, fact) {
  assert.ok(fact && typeof fact === "object", `${fixture.id}: ${task.stage} needs safety facts`);
  if (task.stage === "Expand") {
    assert.equal(
      fact.backwardCompatible,
      true,
      `${fixture.id}: Expand must be verified backward-compatible`,
    );
    return;
  }
  if (task.stage === "Migrate") {
    assert.equal(fact.bounded, true, `${fixture.id}: every Migrate must be bounded`);
    assert.equal(
      fact.bothSeamsWorking,
      true,
      `${fixture.id}: every Migrate must keep both seams working`,
    );
    return;
  }
  assert.equal(task.stage, "Contract", `${fixture.id}: unknown EMC stage ${task.stage}`);
  assert.equal(
    fact.inventoryComplete,
    true,
    `${fixture.id}: Contract requires a complete caller/reference inventory`,
  );
  assert.equal(
    fact.repositoryReferencesGone,
    true,
    `${fixture.id}: Contract cannot run with stale repository references`,
  );
  assert.equal(
    fact.consumerOwnershipKnown,
    true,
    `${fixture.id}: unknown consumer ownership must retain the old seam`,
  );
  assert.equal(
    fact.ownedConsumersMigrated,
    true,
    `${fixture.id}: Contract requires every owned consumer migrated`,
  );
  assert.ok(
    fact.externalConsumers === "none"
      || fact.externalConsumers === "migrated"
      || fact.externalConsumers === "known-unmigrated",
    `${fixture.id}: external-consumer inventory must be a known state (none, migrated, or known-unmigrated), not unknown, missing, or bogus`,
  );
  assert.ok(
    fact.externalConsumers === "none"
      || fact.externalConsumers === "migrated"
      || fact.compatibilityObligationCompleted === true,
    `${fixture.id}: external consumers need migration or a completed compatibility/deprecation obligation`,
  );
}

function validateT4VerticalCompleteness(fixture, task) {
  assert.ok(
    Array.isArray(fixture.requiredLayers) && fixture.requiredLayers.length > 0,
    `${fixture.id}: required behavior layers must be derived from the AC/codebase`,
  );
  assert.ok(
    Array.isArray(fixture.emittedLayers) && fixture.emittedLayers.length > 0,
    `${fixture.id}: emitted task layers are required`,
  );
  assert.equal(
    new Set(fixture.requiredLayers).size,
    fixture.requiredLayers.length,
    `${fixture.id}: required behavior layers must be unique`,
  );
  assert.equal(
    new Set(fixture.emittedLayers).size,
    fixture.emittedLayers.length,
    `${fixture.id}: emitted task layers must be unique`,
  );
  assert.deepEqual(
    [...fixture.emittedLayers].sort(),
    [...fixture.requiredLayers].sort(),
    `${fixture.id}: vertical task must cover exactly every required behavior layer`,
  );
  assert.deepEqual(
    [...task.layers].sort(),
    [...fixture.requiredLayers].sort(),
    `${fixture.id}: validated task layers must exactly cover required behavior layers`,
  );
  for (const layer of fixture.requiredLayers) {
    assert.ok(
      task.files.some((file) => fixture.fileLayers?.[file] === layer),
      `${fixture.id}: vertical task needs at least one owned file for required layer ${layer}`,
    );
  }
}

function buildT4PlanTasks(row, fixture, seam) {
  const templates = parseT4TaskTemplates(row["Tasks/order"]);
  const tasks = [];
  for (const template of templates) {
    const names = template.repeated
      ? fixture.taskNames?.[template.stage]
      : [fixture.taskNames?.[template.stage]];
    const checks = template.repeated
      ? fixture.checks?.[template.stage]
      : [fixture.checks?.[template.stage]];
    const files = template.repeated
      ? fixture.filesByStage?.[template.stage]
      : [fixture.filesByStage?.[template.stage]];
    const semanticOracles = template.repeated
      ? fixture.semanticChecksByStage?.[template.stage]
      : [fixture.semanticChecksByStage?.[template.stage]];
    const satisfiesValues = fixture.satisfiesByStage
      ? (template.repeated
        ? fixture.satisfiesByStage[template.stage]
        : [fixture.satisfiesByStage[template.stage]])
      : names.map(() => fixture.satisfies);
    assert.ok(
      Array.isArray(names) && names.length > 0 && names.every(Boolean),
      `${fixture.id}: ${template.stage} requires at least one named task`,
    );
    assert.equal(
      checks?.length,
      names.length,
      `${fixture.id}: every ${template.stage} row needs its own focused check`,
    );
    assert.equal(
      semanticOracles?.length,
      names.length,
      `${fixture.id}: every ${template.stage} row needs an AC-derived semantic oracle`,
    );
    assert.equal(
      files?.length,
      names.length,
      `${fixture.id}: every ${template.stage} row needs bounded files`,
    );
    assert.equal(
      satisfiesValues?.length,
      names.length,
      `${fixture.id}: every ${template.stage} row needs its own satisfies value`,
    );
    for (let index = 0; index < names.length; index += 1) {
      const wordCount = names[index].trim().split(/\s+/).length;
      assert.ok(
        wordCount >= 5 && wordCount <= 8,
        `${fixture.id}: task descriptions remain 5-8 words`,
      );
      if (template.stage !== "Vertical") {
        assert.match(
          names[index],
          new RegExp(`^${template.stage}\\b`),
          `${fixture.id}: EMC task description must retain ${template.stage} identity`,
        );
      }
      const semanticOracle = semanticOracles[index];
      const parsedCheck = assertT4ConcreteCheck(
        checks[index],
        fixture.id,
        `${template.stage} focused check`,
        template.stage === "Vertical" ? semanticOracle : null,
      );
      assert.ok(
        Array.isArray(files[index]) && files[index].length > 0,
        `${fixture.id}: every emitted row needs bounded files`,
      );
      const task = {
        stage: template.stage,
        task: names[index],
        scope: template.scope,
        layers: template.stage === "Vertical" ? [...fixture.emittedLayers] : [],
        files: [...files[index]],
        test: seam.path,
        check: checks[index],
        greenVerification: "required-after-implementation",
        lowerSeamReason: seam.lowerSeamReason,
        satisfies: satisfiesValues[index],
        status: "pending",
      };
      if (template.stage !== "Vertical") {
        validateT4EmcCheck(fixture, task, parsedCheck, semanticOracle);
      }
      tasks.push(task);
    }
  }
  assert.equal(
    unwrapPolicyCell(row["Green/check"]),
    "each-row-focused-and-green",
    `${fixture.id}: plan rows must carry focused green verification`,
  );
  return tasks.map((task, index) => ({ id: `T${index + 1}`, ...task }));
}

function verifyT4CandidateRows(fixture, tasks) {
  const stageIndexes = new Map();
  const stageCounts = new Map();
  for (const task of tasks) {
    stageCounts.set(task.stage, (stageCounts.get(task.stage) ?? 0) + 1);
  }
  return tasks.map((task) => {
    const stageIndex = stageIndexes.get(task.stage) ?? 0;
    stageIndexes.set(task.stage, stageIndex + 1);
    const repeated = stageCounts.get(task.stage) > 1;
    const greenSource = fixture.candidateGreenByStage?.[task.stage];
    if (repeated) {
      assert.ok(
        Array.isArray(greenSource),
        `${fixture.id}: repeated ${task.stage} needs a per-row green result array`,
      );
    }
    const greenResult = Array.isArray(greenSource) ? greenSource[stageIndex] : greenSource;
    assert.equal(
      greenResult,
      true,
      `${fixture.id}: candidate ${task.stage} row needs a verified true green result`,
    );
    if (task.stage !== "Vertical") {
      const safetySource = fixture.candidateSafetyByStage?.[task.stage];
      if (repeated) {
        assert.ok(
          Array.isArray(safetySource),
          `${fixture.id}: repeated ${task.stage} needs a per-row safety fact array`,
        );
      }
      const safetyResult = Array.isArray(safetySource) ? safetySource[stageIndex] : safetySource;
      validateT4EmcSafetyResult(fixture, task, safetyResult);
    }
    return { ...task, verifiedGreen: true };
  });
}


function partitionT4FutureCriteria(fixture) {
  const checked = [];
  const unchecked = [];
  for (const criterion of fixture.acceptanceCriteria ?? []) {
    const outcome = criterion.outcome?.trim();
    const concreteOutcome = outcome
      && !T4_PLACEHOLDER_TEXT.test(outcome)
      && outcome.split(/\s+/).length >= 4;
    if (concreteOutcome && parseT4ConcreteCheck(criterion.check)) {
      checked.push(criterion);
    } else {
      unchecked.push(criterion);
    }
  }
  return { checked, unchecked };
}


function evaluateT4PlanningPolicy(policy, fixture) {
  const row = matchT4PlanningPolicy(policy, fixture);
  const output = unwrapPolicyCell(row.Output);
  const proposalHandling = unwrapPolicyCell(row["Proposal handling"]);
  const taskTemplates = parseT4TaskTemplates(row["Tasks/order"]);

  if (fixture.phase === "plan") {
    const seam = selectT4PublicSeam(row, fixture);
    const tasks = buildT4PlanTasks(row, fixture, seam);
    assert.ok(tasks.length > 0, `${fixture.id}: plan output must emit tasks`);
    validateT4PlanAcReferences(fixture, tasks, seam);
    if (output === "vertical-behavior-slice") {
      assert.deepEqual(
        tasks.map((task) => task.stage),
        ["Vertical"],
        `${fixture.id}: ordinary behavior must be one vertical task`,
      );
      validateT4VerticalCompleteness(fixture, tasks[0]);
    } else {
      assert.equal(
        output,
        "ordered-expand-migrate-contract",
        `${fixture.id}: unsupported plan output`,
      );
      assert.equal(
        fixture.kind,
        "mechanical-refactor",
        `${fixture.id}: Expand/Migrate/Contract is not ordinary feature ceremony`,
      );
      assert.equal(
        fixture["blast-radius"],
        "wide",
        `${fixture.id}: Expand/Migrate/Contract requires wide blast radius`,
      );
      assert.equal(
        fixture["atomic-green"],
        "no",
        `${fixture.id}: atomic-green refactors must not force migration ceremony`,
      );
      assert.equal(tasks[0].stage, "Expand", `${fixture.id}: Expand must be first`);
      assert.equal(tasks.at(-1).stage, "Contract", `${fixture.id}: Contract must be last`);
      assert.ok(
        tasks.slice(1, -1).every((task) => task.stage === "Migrate"),
        `${fixture.id}: only bounded Migrate rows may occur between Expand and Contract`,
      );
    }
    return {
      output,
      proposalHandling,
      tasks,
      milestoneEligible: false,
      artifact: "plan.toon",
      specAcceptanceCriteria: [],
      notes: [],
    };
  }

  assert.deepEqual(taskTemplates, [], `${fixture.id}: future policy must not emit plan tasks`);
  const preciseQuestion = isMateriallyAnswerableT4Question(fixture.preciseQuestion, fixture.questionOracle)
    ? fixture.preciseQuestion.trim()
    : null;
  const { checked: checkedCriteria, unchecked: uncheckedCriteria } = partitionT4FutureCriteria(fixture);
  const checkableAc = checkedCriteria.length > 0;
  if (output === "precise-milestone-or-spec") {
    assert.ok(
      preciseQuestion || checkableAc,
      `${fixture.id}: milestone eligibility requires a materially answerable question or concrete AC Check`,
    );
    const notes = [];
    if (uncheckedCriteria.length > 0) {
      assert.ok(
        fixture.uncheckedNote?.trim()
          && !fixture.uncheckedNote.includes("\n")
          && fixture.uncheckedNote.length <= 160,
        `${fixture.id}: unchecked future remainder collapses to one concise note`,
      );
      notes.push(fixture.uncheckedNote);
    }
    return {
      output,
      proposalHandling,
      tasks: [],
      milestoneEligible: true,
      artifact: checkableAc ? "spec.md" : null,
      specAcceptanceCriteria: checkedCriteria,
      notes,
    };
  }

  assert.equal(
    output,
    "one-fog/future/out-of-scope-note",
    `${fixture.id}: unsupported Discussion output`,
  );
  assert.ok(
    !preciseQuestion && !checkableAc,
    `${fixture.id}: a precise future item must not be treated as fog`,
  );
  assert.ok(
    fixture.note?.trim() && !fixture.note.includes("\n") && fixture.note.length <= 160,
    `${fixture.id}: fog stays one concise note`,
  );
  return {
    output,
    proposalHandling,
    tasks: [],
    milestoneEligible: false,
    artifact: null,
    specAcceptanceCriteria: [],
    notes: [fixture.note],
  };
}


function validateT4PlanningOutcome(policy, fixture, actual) {
  const expected = evaluateT4PlanningPolicy(policy, fixture);
  assert.equal(actual.output, expected.output, `${fixture.id}: policy output`);
  assert.equal(
    actual.proposalHandling,
    expected.proposalHandling,
    `${fixture.id}: proposal handling`,
  );
  assert.deepEqual(actual.tasks, expected.tasks, `${fixture.id}: exact task shape/order/test seam`);
  assert.equal(
    actual.milestoneEligible,
    expected.milestoneEligible,
    `${fixture.id}: milestone eligibility`,
  );
  assert.equal(actual.artifact, expected.artifact, `${fixture.id}: artifact boundary`);
  assert.deepEqual(
    actual.specAcceptanceCriteria,
    expected.specAcceptanceCriteria,
    `${fixture.id}: only checked ACs may enter spec`,
  );
  assert.deepEqual(actual.notes, expected.notes, `${fixture.id}: fog note boundary`);
  return expected;
}

function t4CrossLayerFixture() {
  return {
    id: "cross-layer-checkout",
    phase: "plan",
    kind: "behavior",
    proposal: "cross-layer",
    "wide-refactor": "no",
    seams: [
      {
        path: "test/e2e/checkout.test.js",
        level: "boundary",
        entrypoint: "browser",
        canonical: true,
        productionPathCoverage: 4,
        existing: true,
        public: true,
        deterministic: true,
        isolatesAc: true,
      },
      {
        path: "test/checkout-module.test.js",
        level: "public-module",
        entrypoint: "module",
        canonical: true,
        productionPathCoverage: 2,
        existing: true,
        public: true,
        deterministic: true,
        isolatesAc: true,
      },
    ],
    acEntrypoint: "browser",
    planTest: "test/e2e/checkout.test.js",
    lowerSeamReason: null,
    specEra: "current",
    specAcIds: ["AC-9"],
    acPins: [{ id: "AC-9", test: "test/e2e/checkout.test.js", lowerSeamReason: null }],
    requiredLayers: ["ui", "api", "domain", "storage"],
    emittedLayers: ["ui", "api", "domain", "storage"],
    fileLayers: {
      "src/checkout-ui.js": "ui",
      "src/checkout-api.js": "api",
      "src/checkout.js": "domain",
      "src/orders.js": "storage",
    },
    taskNames: {
      Vertical: "Deliver confirmed checkout across stack",
    },
    checks: {
      Vertical: "Submit checkout in the browser → confirmation shows the persisted order",
    },
    semanticChecksByStage: {
      Vertical: {
        operation: "Submit checkout",
        actionPhrases: ["in the browser"],
        observerPhrases: ["confirmation"],
        statePhrases: ["persisted order"],
      },
    },
    candidateGreenByStage: {
      Vertical: true,
    },
    filesByStage: {
      Vertical: [
        "src/checkout-ui.js",
        "src/checkout-api.js",
        "src/checkout.js",
        "src/orders.js",
        "test/e2e/checkout.test.js",
      ],
    },
    satisfies: "AC-9",
  };
}

function t4EntrypointTieBreakFixture() {
  const fixture = t4CrossLayerFixture();
  fixture.id = "two-boundaries-entrypoint-wins";
  fixture.seams = [
    {
      path: "test/browser/checkout.test.js",
      level: "boundary",
      entrypoint: "browser",
      canonical: false,
      productionPathCoverage: 3,
      existing: true,
      public: true,
      deterministic: true,
      isolatesAc: true,
    },
    {
      path: "test/http/checkout.test.js",
      level: "boundary",
      entrypoint: "http",
      canonical: true,
      productionPathCoverage: 9,
      existing: true,
      public: true,
      deterministic: true,
      isolatesAc: true,
    },
  ];
  fixture.planTest = "test/browser/checkout.test.js";
  fixture.acPins[0].test = fixture.planTest;
  fixture.filesByStage.Vertical[4] = fixture.planTest;
  return fixture;
}

function t4CanonicalTieBreakFixture() {
  const fixture = t4CrossLayerFixture();
  fixture.id = "two-browser-boundaries-canonical-wins";
  fixture.seams = [
    {
      path: "test/browser/canonical-checkout.test.js",
      level: "boundary",
      entrypoint: "browser",
      canonical: true,
      productionPathCoverage: 3,
      existing: true,
      public: true,
      deterministic: true,
      isolatesAc: true,
    },
    {
      path: "test/browser/alternate-checkout.test.js",
      level: "boundary",
      entrypoint: "browser",
      canonical: false,
      productionPathCoverage: 9,
      existing: true,
      public: true,
      deterministic: true,
      isolatesAc: true,
    },
  ];
  fixture.planTest = "test/browser/canonical-checkout.test.js";
  fixture.acPins[0].test = fixture.planTest;
  fixture.filesByStage.Vertical[4] = fixture.planTest;
  return fixture;
}

function t4CoverageTieBreakFixture() {
  const fixture = t4CrossLayerFixture();
  fixture.id = "two-browser-boundaries-greater-coverage-wins";
  fixture.seams = [
    {
      path: "test/browser/shallow-checkout.test.js",
      level: "boundary",
      entrypoint: "browser",
      canonical: false,
      productionPathCoverage: 3,
      existing: true,
      public: true,
      deterministic: true,
      isolatesAc: true,
    },
    {
      path: "test/browser/full-checkout.test.js",
      level: "boundary",
      entrypoint: "browser",
      canonical: false,
      productionPathCoverage: 9,
      existing: true,
      public: true,
      deterministic: true,
      isolatesAc: true,
    },
  ];
  fixture.planTest = "test/browser/full-checkout.test.js";
  fixture.acPins[0].test = fixture.planTest;
  fixture.filesByStage.Vertical[4] = fixture.planTest;
  return fixture;
}


function t4OrdinaryLayerFixture() {
  return {
    id: "ordinary-three-layer",
    phase: "plan",
    kind: "behavior",
    proposal: "horizontal-layers",
    "wide-refactor": "no",
    seams: [
      {
        path: "test/http/accounts.test.js",
        level: "boundary",
        entrypoint: "http",
        canonical: true,
        productionPathCoverage: 3,
        existing: true,
        public: true,
        deterministic: true,
        isolatesAc: true,
      },
    ],
    acEntrypoint: "http",
    planTest: "test/http/accounts.test.js",
    lowerSeamReason: null,
    specEra: "current",
    specAcIds: ["AC-9"],
    acPins: [{ id: "AC-9", test: "test/http/accounts.test.js", lowerSeamReason: null }],
    requiredLayers: ["api", "domain", "storage"],
    emittedLayers: ["api", "domain", "storage"],
    fileLayers: {
      "src/accounts-api.js": "api",
      "src/accounts.js": "domain",
      "src/account-store.js": "storage",
    },
    taskNames: {
      Vertical: "Deliver retrievable account creation behavior",
    },
    checks: {
      Vertical: "Create then fetch an account over HTTP → response returns the stored account",
    },
    candidateGreenByStage: {
      Vertical: true,
    },
    filesByStage: {
      Vertical: [
        "src/accounts-api.js",
        "src/accounts.js",
        "src/account-store.js",
        "test/http/accounts.test.js",
      ],
    },
    satisfies: "AC-9",
  };
}


function t4WideRefactorFixture() {
  return {
    id: "wide-account-id-refactor",
    phase: "plan",
    kind: "mechanical-refactor",
    "blast-radius": "wide",
    "atomic-green": "no",
    seams: [
      {
        path: "test/account-api.test.js",
        level: "public-module",
        entrypoint: "module",
        canonical: true,
        productionPathCoverage: 2,
        existing: true,
        public: true,
        deterministic: true,
        isolatesAc: true,
      },
    ],
    acEntrypoint: "module",
    planTest: "test/account-api.test.js",
    lowerSeamReason: "A user/browser/CLI/HTTP boundary harness does not exist for this public module contract.",
    specEra: "current",
    specAcIds: ["AC-9"],
    acPins: [{
      id: "AC-9",
      test: "test/account-api.test.js",
      lowerSeamReason: "A user/browser/CLI/HTTP boundary harness does not exist for this public module contract.",
    }],
    requiredLayers: [],
    emittedLayers: [],
    taskNames: {
      Expand: "Expand compatible account identifier seam",
      Migrate: [
        "Migrate bounded billing callers safely",
        "Migrate bounded reporting callers safely",
      ],
      Contract: "Contract obsolete account identifier seam",
    },
    checks: {
      Expand: "Invoke the old account identifier seam and invoke the new account identifier seam → old account identifier seam response returns success for the public API contract and new account identifier seam response returns success for the public API contract",
      Migrate: [
        "Invoke billing callers through the old identifier seam and invoke billing callers through the new identifier seam → old identifier seam response returns success for billing and new identifier seam response returns success for billing",
        "Invoke reporting callers through the old identifier seam and invoke reporting callers through the new identifier seam → old identifier seam response returns success for reporting and new identifier seam response returns success for reporting",
      ],
      Contract: "Inventory repository callers and references then invoke the public API contract → caller/reference inventory returns zero old references and public API response remains green",
    },
    semanticChecksByStage: {
      Expand: {
        actionClauses: [
          "Invoke the old account identifier seam",
          "invoke the new account identifier seam",
        ],
        expectedClauses: [
          "old account identifier seam response returns success for the public API contract",
          "new account identifier seam response returns success for the public API contract",
        ],
      },
      Migrate: [
        {
          actionClauses: [
            "Invoke billing callers through the old identifier seam",
            "invoke billing callers through the new identifier seam",
          ],
          expectedClauses: [
            "old identifier seam response returns success for billing",
            "new identifier seam response returns success for billing",
          ],
        },
        {
          actionClauses: [
            "Invoke reporting callers through the old identifier seam",
            "invoke reporting callers through the new identifier seam",
          ],
          expectedClauses: [
            "old identifier seam response returns success for reporting",
            "new identifier seam response returns success for reporting",
          ],
        },
      ],
    },
    candidateGreenByStage: {
      Expand: true,
      Migrate: [true, true],
      Contract: true,
    },
    candidateSafetyByStage: {
      Expand: {
        backwardCompatible: true,
      },
      Migrate: [
        {
          bounded: true,
          bothSeamsWorking: true,
        },
        {
          bounded: true,
          bothSeamsWorking: true,
        },
      ],
      Contract: {
        inventoryComplete: true,
        repositoryReferencesGone: true,
        consumerOwnershipKnown: true,
        ownedConsumersMigrated: true,
        externalConsumers: "none",
        compatibilityObligationCompleted: false,
      },
    },
    filesByStage: {
      Expand: ["src/account-id.js", "test/account-api.test.js"],
      Migrate: [
        ["src/billing.js", "test/account-api.test.js"],
        ["src/reporting.js", "test/account-api.test.js"],
      ],
      Contract: ["src/account-id.js", "test/account-api.test.js"],
    },
    satisfies: "AC-9",
  };
}


function t4PreciseFutureFixture() {
  return {
    id: "precise-future-milestone",
    phase: "discussion",
    kind: "future",
    precision: "question-or-ac-check",
    preciseQuestion: null,
    acceptanceCriteria: [
      {
        outcome: "A user can export one account statement as CSV",
        check: "Request CSV export for a known statement → downloaded rows match that statement",
      },
    ],
    note: null,
  };
}

function t4PreciseQuestionFixture() {
  return {
    id: "precise-question-milestone",
    phase: "discussion",
    kind: "future",
    precision: "question-or-ac-check",
    preciseQuestion: "Which statement export format is deterministic for current account data?",
    questionOracle: {
      subject: "statement",
      property: "export format",
      constraint: "deterministic",
      context: "current account data",
    },
    acceptanceCriteria: [],
    note: null,
  };
}

function t4MixedFutureFixture() {
  return {
    id: "mixed-checked-unchecked-future",
    phase: "discussion",
    kind: "future",
    precision: "question-or-ac-check",
    preciseQuestion: null,
    acceptanceCriteria: [
      {
        outcome: "A user can export one account statement as CSV",
        check: "Request CSV export for a known statement → downloaded rows match that statement",
      },
      {
        outcome: "Users get smarter statement recommendations",
        check: "TBD",
      },
    ],
    uncheckedNote: "Future/out-of-scope: define recommendation evidence and an observable check before planning.",
    note: null,
  };
}

function t4VagueFutureFixture() {
  return {
    id: "vague-future-area",
    phase: "discussion",
    kind: "future",
    precision: "vague",
    preciseQuestion: null,
    acceptanceCriteria: [],
    note: "Future/out-of-scope: explore smarter recommendations after usage evidence sharpens the behavior.",
  };
}

function t4UncheckedFutureFixture() {
  return {
    id: "future-outcome-without-check",
    phase: "discussion",
    kind: "future",
    precision: "vague",
    preciseQuestion: null,
    acceptanceCriteria: [{
      outcome: "Users get smarter recommendations",
      check: "",
    }],
    note: "Future/out-of-scope: define recommendation evidence and an observable check before planning.",
  };
}

function parseDocumentedT4PlanSchema(toPlan) {
  const match = toPlan.match(
    /Format:\s*```\s*(schema:v\d+)\s*base:<base>\s*plan\[count\]\{([^}]+)\}:/,
  );
  assert.ok(match, "gsd-to-plan must document its concrete plan schema");
  return {
    version: match[1],
    columns: match[2].split(","),
  };
}

function serializeT4Plan(outcome, fixture, schema) {
  assert.equal(outcome.artifact, "plan.toon", `${fixture.id}: only plan output can serialize`);
  const rows = outcome.tasks.map((task) => [
    task.id,
    task.task,
    task.satisfies,
    task.files.join("|"),
    task.test,
    task.status,
  ].join(","));
  return [
    schema.version,
    "base:main",
    `plan[${rows.length}]{${schema.columns.join(",")}}:`,
    ...rows.map((row) => `  ${row}`),
  ].join("\n");
}


function parseT4Plan(plan, schema, specAcIds) {
  const lines = plan.trim().split("\n").map((line) => line.trim()).filter(Boolean);
  assert.equal(lines[0], schema.version, "T4 plan must preserve documented schema version");
  assert.match(lines[1], /^base:[^,]+$/, "T4 plan must preserve the base row");
  const header = lines[2].match(/^plan\[(\d+)\]\{([^}]+)\}:$/);
  assert.ok(header, "T4 plan must preserve the plan table shape");
  assert.deepEqual(
    header[2].split(","),
    schema.columns,
    "T4 plan must preserve the exact existing columns",
  );
  const rows = lines.slice(3);
  assert.equal(rows.length, Number(header[1]), "T4 plan row count");
  const parsedRows = rows.map((row, index) => {
    const cells = row.split(",");
    assert.equal(cells.length, schema.columns.length, `T4 plan row ${index + 1} columns`);
    const parsed = Object.fromEntries(schema.columns.map((column, cell) => [column, cells[cell]]));
    assert.equal(parsed.id, `T${index + 1}`, "T4 plan task IDs remain sequential");
    assert.notEqual(parsed.test, "none", `${parsed.id}: behavior/refactor task keeps focused verification`);
    assert.equal(parsed.status, "pending", `${parsed.id}: new plan row starts pending`);
    const satisfies = parsed.satisfies.split("|");
    assert.ok(
      satisfies.length > 0 && satisfies.every(Boolean),
      `${parsed.id}: serialized satisfies must not be missing`,
    );
    assert.equal(
      new Set(satisfies).size,
      satisfies.length,
      `${parsed.id}: serialized satisfies must not contain duplicate AC IDs`,
    );
    for (const acId of satisfies) {
      assert.ok(specAcIds.includes(acId), `${parsed.id}: serialized plan references unknown AC ID ${acId}`);
    }
    return parsed;
  });
  assert.deepEqual(
    [...new Set(parsedRows.flatMap((row) => row.satisfies.split("|")))].sort(),
    [...specAcIds].sort(),
    "T4 serialized plan must preserve global AC coverage",
  );
  return parsedRows;
}

function expectedT4PlanRows(outcome) {
  return outcome.tasks.map((task) => ({
    id: task.id,
    task: task.task,
    satisfies: task.satisfies,
    files: task.files.join("|"),
    test: task.test,
    status: task.status,
  }));
}

function inferSerializedT4EmcStage(taskDescription) {
  return ["Expand", "Migrate", "Contract"]
    .find((stage) => new RegExp(`^${stage}\\b`).test(taskDescription));
}

function validateT4PlanRoundTrip(outcome, fixture, schema, plan) {
  const parsed = parseT4Plan(plan, schema, fixture.specAcIds);
  if (outcome.output === "ordered-expand-migrate-contract") {
    assert.deepEqual(
      parsed.map((row) => inferSerializedT4EmcStage(row.task)),
      outcome.tasks.map((task) => task.stage),
      `${fixture.id}: serialized EMC descriptions/order must retain stage identity`,
    );
  }
  assert.deepEqual(
    parsed,
    expectedT4PlanRows(outcome),
    `${fixture.id}: serialized plan must round-trip exact id/task/satisfies/files/test/status`,
  );
  return parsed;
}


test("T4 canonical planning policy exposes exactly the five deterministic outcomes (AC-9, AC-10)", () => {
  const policy = validateT4PlanningPolicy(parseT4PlanningPolicy(readPlanningReference()));
  assert.deepEqual(
    policy.map((row) => row.Scenario),
    [
      "Cross-layer user behavior",
      "Ordinary three-layer proposal",
      "Blast-radius mechanical refactor",
      "Precise future milestone",
      "Vague future area",
    ],
  );
});

test("T4 planning seam contract flows through Discussion plan dispatch review and TDD (AC-9)", () => {
  const master = readSkill("gsd");
  const body = extractPeerSection(master, "Body");
  assert.match(
    body,
    /Pin the existing public test seam before convergence[\s\S]*existing user\/browser\/CLI\/HTTP boundary first[\s\S]*same tier[\s\S]*production entrypoint[\s\S]*canonical existing harness[\s\S]*production-path coverage[\s\S]*materially ambiguous[\s\S]*Lower-Seam Reason: none[\s\S]*Never invent a lower test-only interface/,
  );
  const convergence = extractPeerSection(master, "Convergence — write `spec.md`");
  assert.match(
    convergence,
    /materially answerable precise question[\s\S]*further Discussion[\s\S]*writing any `spec.md` requires[\s\S]*checkable AC with its `Check:`[\s\S]*no plan task[\s\S]*tracker\/map artifact[\s\S]*new skill/,
  );
  assert.match(
    convergence,
    /mixed candidate[\s\S]*only fully checked ACs enter `spec.md`[\s\S]*unchecked remainder into one such note/,
  );
  assert.match(
    convergence,
    /canonical `action → expected observable result`[\s\S]*`TBD`[\s\S]*vague placeholders are not checks/,
  );
  assert.match(
    convergence,
    /Concreteness is semantic, not word count[\s\S]*actual operation\/input[\s\S]*observed subject[\s\S]*exact decision\/property[\s\S]*worth discussing/,
  );

  const reference = extractPeerSection(readPlanningReference(), "Planning decomposition & precision contract");
  assert.match(
    reference,
    /multiple usable harnesses at the same highest tier[\s\S]*production entrypoint named by the AC[\s\S]*canonical existing harness[\s\S]*greater coverage[\s\S]*materially ambiguous/,
  );
  assert.match(
    reference,
    /pre-contract spec[\s\S]*plan-row `test` as the proposed seam[\s\S]*highest usable seam[\s\S]*Lower-Seam Reason: none[\s\S]*If it is lower[\s\S]*reason already present in the existing spec/,
  );
  assert.match(
    reference,
    /At planning time, `each-row-focused-and-green`[\s\S]*obligation to run it[\s\S]*never requires or predicts a pass[\s\S]*Execution supplies the verified-green fact after implementation[\s\S]*false or missing/,
  );
  assert.match(
    reference,
    /affirmatively invokes or exercises each old and new seam[\s\S]*positive observed result from each seam[\s\S]*exact decision\/property[\s\S]*worth discussing/,
  );

  const toPlan = readSkill("gsd-to-plan");
  assert.match(
    toPlan,
    /`test` — the focused automated test\/path\/self-check at the selected public seam[\s\S]*unit test, integration test, CLI check, or focused browser\/HTTP check/,
  );
  const rules = extractPeerSection(toPlan, "Rules");
  assert.match(
    rules,
    /complete observable behavior, not architectural layer[\s\S]*Derive the required layers[\s\S]*exactly all required behavior layers[\s\S]*one affected file per required layer/,
  );
  assert.match(
    rules,
    /One row has one seam decision[\s\S]*same `test` path and lower-seam reason[\s\S]*split them into separate vertical behavior rows/,
  );
  assert.match(
    rules,
    /Expand → Migrate → Contract[\s\S]*unavoidable wide mechanical refactors[\s\S]*backward-compatible[\s\S]*both seams[\s\S]*caller\/reference inventory[\s\S]*External consumers[\s\S]*unknown ownership[\s\S]*later precise milestone\/evidence gate/,
  );
  assert.match(
    rules,
    /Make green verification mandatory without predicting a pass[\s\S]*Planning never fabricates the future green result[\s\S]*runs the check after implementation[\s\S]*before the row lands/,
  );
  assert.match(
    rules,
    /Validate Check semantics, not keyword padding[\s\S]*actual operation\/input[\s\S]*observed subject[\s\S]*separate affirmative clauses[\s\S]*positive result from each/,
  );
  const serialization = extractPeerSection(toPlan, "Exact plan serialization gate");
  assert.match(
    serialization,
    /parse every generated row back[\s\S]*exact `id`, `task`, `satisfies`, `files`, `test`, and `status`[\s\S]*Expand[\s\S]*Migrate[\s\S]*Contract[\s\S]*semantic safety facts stay in the validated spec\/task brief/,
  );

  const execution = extractPeerSection(readSkill("gsd-executing-plans"), "Per task");
  assert.match(execution, /\*\*Public Test Seam:\*\*/);
  assert.match(execution, /\*\*Lower-Seam Reason:\*\*/);
  assert.match(
    execution,
    /\*\*Green Verification Obligation:\*\*[\s\S]*run after implementation[\s\S]*do not predict its result at dispatch/,
  );
  assert.doesNotMatch(execution, /\*\*Verified Green Fact:\*\*/);
  assert.match(
    execution,
    /“Concrete” means the action names the actual operation\/input[\s\S]*observed subject[\s\S]*separately invoke or exercise each old and new seam[\s\S]*positive observed result from each/,
  );
  assert.match(
    execution,
    /Legacy no-pin compatibility[\s\S]*existing plan row `test` as the proposed seam[\s\S]*Lower-Seam Reason: none[\s\S]*if it is lower[\s\S]*existing spec[\s\S]*Never invent behavior/,
  );
  assert.match(
    execution,
    /copied lower-seam reason is not self-validating[\s\S]*claimed cause with the live higher-seam facts[\s\S]*stale\/contradictory cause is a spec gap/,
  );
  assert.match(execution, /Public-seam compliance is part of \*\*task-compliance\*\*/);
  assert.match(
    execution,
    /exact required-layer\/file coverage[\s\S]*returned implementation's recorded focused-check result[\s\S]*Expand backward-compatible[\s\S]*Migrate keeps both seams working[\s\S]*Contract's explicit inventory check/,
  );
  assert.match(
    execution,
    /\*\*Focused TDD test\*\* \(always\)[\s\S]*unit, integration, CLI, focused browser, or focused HTTP[\s\S]*not a whole-journey run/,
  );
  assert.match(
    execution,
    /Focused per-task boundary test|focused per-task boundary test/i,
  );
  assert.match(
    execution,
    /Whole-journey E2E stays terminal[\s\S]*terminal whole-journey E2E proves the rows compose/,
  );

  const tdd = readSkill("gsd-tdd");
  assert.match(tdd, /Start at the \*\*highest deterministic existing public interface\/harness\*\*/);
  assert.match(
    extractPeerSection(tdd, "Anti-pattern: horizontal slices"),
    /selected public seam[\s\S]*required production layers[\s\S]*exactly every required layer[\s\S]*verified green/,
  );
  assert.match(
    extractPeerSection(tdd, "Workflow"),
    /selected public seam[\s\S]*exact required behavior layers[\s\S]*one complete task seam end-to-end[\s\S]*focused browser\/HTTP test[\s\S]*terminal whole-journey E2E/,
  );
  assert.match(
    extractPeerSection(tdd, "Per-cycle checklist"),
    /complete behavior through the production path[\s\S]*produces and records its verified-green fact[\s\S]*blocks landing/,
  );
  assert.match(
    extractPeerSection(tdd, "Per-cycle checklist"),
    /actual operation\/input at the seam[\s\S]*observed subject with explicit state\/value[\s\S]*never padded generic pass prose/,
  );
});


test("T4 cross-layer behavior and blast-radius refactor yield exact vertical and ordered green tasks (AC-9)", () => {
  const policy = validateT4PlanningPolicy(parseT4PlanningPolicy(readPlanningReference()));
  const crossFixture = t4CrossLayerFixture();
  const cross = evaluateT4PlanningPolicy(policy, crossFixture);
  const crossCandidate = verifyT4CandidateRows(crossFixture, cross.tasks);
  assert.deepEqual(
    cross.tasks.map(({ id, stage, scope, layers, test, greenVerification }) => ({
      id,
      stage,
      scope,
      layers,
      test,
      greenVerification,
    })),
    [{
      id: "T1",
      stage: "Vertical",
      scope: "all-required-layers",
      layers: ["ui", "api", "domain", "storage"],
      test: "test/e2e/checkout.test.js",
      greenVerification: "required-after-implementation",
    }],
    "cross-layer behavior must remain one complete vertical slice at the boundary harness",
  );

  const refactorFixture = t4WideRefactorFixture();
  const refactor = evaluateT4PlanningPolicy(policy, refactorFixture);
  const refactorCandidate = verifyT4CandidateRows(refactorFixture, refactor.tasks);
  assert.deepEqual(
    refactor.tasks.map(({ id, stage, scope, test, check, greenVerification }) => ({
      id,
      stage,
      scope,
      test,
      check,
      greenVerification,
    })),
    [
      {
        id: "T1",
        stage: "Expand",
        scope: "backward-compatible-new-seam",
        test: "test/account-api.test.js",
        check: "Invoke the old account identifier seam and invoke the new account identifier seam → old account identifier seam response returns success for the public API contract and new account identifier seam response returns success for the public API contract",
        greenVerification: "required-after-implementation",
      },
      {
        id: "T2",
        stage: "Migrate",
        scope: "bounded-callers",
        test: "test/account-api.test.js",
        check: "Invoke billing callers through the old identifier seam and invoke billing callers through the new identifier seam → old identifier seam response returns success for billing and new identifier seam response returns success for billing",
        greenVerification: "required-after-implementation",
      },
      {
        id: "T3",
        stage: "Migrate",
        scope: "bounded-callers",
        test: "test/account-api.test.js",
        check: "Invoke reporting callers through the old identifier seam and invoke reporting callers through the new identifier seam → old identifier seam response returns success for reporting and new identifier seam response returns success for reporting",
        greenVerification: "required-after-implementation",
      },
      {
        id: "T4",
        stage: "Contract",
        scope: "remove-old-seam",
        test: "test/account-api.test.js",
        check: "Inventory repository callers and references then invoke the public API contract → caller/reference inventory returns zero old references and public API response remains green",
        greenVerification: "required-after-implementation",
      },
    ],
    "wide non-atomic refactor must remain Expand then one-or-more Migrate rows then Contract",
  );
  assert.deepEqual(
    crossCandidate.map(({ stage, verifiedGreen }) => ({ stage, verifiedGreen })),
    [{ stage: "Vertical", verifiedGreen: true }],
    "planning records only an obligation; candidate execution produces the green fact",
  );
  const wrongVerticalAction = t4CrossLayerFixture();
  wrongVerticalAction.id = "vertical-check-wrong-operation";
  wrongVerticalAction.checks.Vertical = "Invoke the checkout module directly → module confirmation shows the persisted order";
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, wrongVerticalAction),
    /Vertical focused check action must match the AC-derived operation/,
    "a parseable vertical check whose action drifts from the AC operation must fail",
  );
  const wrongVerticalResult = t4CrossLayerFixture();
  wrongVerticalResult.id = "vertical-check-wrong-observation";
  wrongVerticalResult.checks.Vertical = "Submit checkout in the browser → confirmation shows a random toast";
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, wrongVerticalResult),
    /Vertical focused check expected result must match the AC-derived observation/,
    "a parseable vertical check whose result drifts from the AC observation must fail",
  );
  assert.deepEqual(
    refactorCandidate.map(({ stage, verifiedGreen }) => ({ stage, verifiedGreen })),
    [
      { stage: "Expand", verifiedGreen: true },
      { stage: "Migrate", verifiedGreen: true },
      { stage: "Migrate", verifiedGreen: true },
      { stage: "Contract", verifiedGreen: true },
    ],
    "every migration stage must verify green before the next stage",
  );
  assert.equal(
    new Set(refactor.tasks.map((task) => task.check)).size,
    refactor.tasks.length,
    "each refactor row must own a focused check",
  );

  const schema = parseDocumentedT4PlanSchema(readSkill("gsd-to-plan"));
  assert.deepEqual(schema, {
    version: "schema:v1",
    columns: ["id", "task", "satisfies", "files", "test", "status"],
  });
  const crossPlan = serializeT4Plan(cross, crossFixture, schema);
  const refactorPlan = serializeT4Plan(refactor, refactorFixture, schema);
  const crossRows = validateT4PlanRoundTrip(cross, crossFixture, schema, crossPlan);
  const refactorRows = validateT4PlanRoundTrip(refactor, refactorFixture, schema, refactorPlan);
  assert.deepEqual(crossRows, [{
    id: "T1",
    task: "Deliver confirmed checkout across stack",
    satisfies: "AC-9",
    files: "src/checkout-ui.js|src/checkout-api.js|src/checkout.js|src/orders.js|test/e2e/checkout.test.js",
    test: "test/e2e/checkout.test.js",
    status: "pending",
  }]);
  assert.deepEqual(refactorRows, [
    {
      id: "T1",
      task: "Expand compatible account identifier seam",
      satisfies: "AC-9",
      files: "src/account-id.js|test/account-api.test.js",
      test: "test/account-api.test.js",
      status: "pending",
    },
    {
      id: "T2",
      task: "Migrate bounded billing callers safely",
      satisfies: "AC-9",
      files: "src/billing.js|test/account-api.test.js",
      test: "test/account-api.test.js",
      status: "pending",
    },
    {
      id: "T3",
      task: "Migrate bounded reporting callers safely",
      satisfies: "AC-9",
      files: "src/reporting.js|test/account-api.test.js",
      test: "test/account-api.test.js",
      status: "pending",
    },
    {
      id: "T4",
      task: "Contract obsolete account identifier seam",
      satisfies: "AC-9",
      files: "src/account-id.js|test/account-api.test.js",
      test: "test/account-api.test.js",
      status: "pending",
    },
  ]);
});

test("T4 ordinary three-layer proposal is rejected and rewritten as one vertical contract (AC-9)", () => {
  const policy = validateT4PlanningPolicy(parseT4PlanningPolicy(readPlanningReference()));
  const fixture = t4OrdinaryLayerFixture();
  const outcome = evaluateT4PlanningPolicy(policy, fixture);
  assert.equal(outcome.output, "vertical-behavior-slice");
  assert.equal(outcome.proposalHandling, "reject-and-rewrite");
  assert.deepEqual(outcome.tasks.map((task) => task.stage), ["Vertical"]);
  assert.deepEqual(outcome.tasks[0].layers, ["api", "domain", "storage"]);
  assert.equal(outcome.tasks[0].test, "test/http/accounts.test.js");
  assert.equal(outcome.tasks[0].greenVerification, "required-after-implementation");
  assert.equal(verifyT4CandidateRows(fixture, outcome.tasks)[0].verifiedGreen, true);
});

test("T4 precision gate admits precise forms partitions mixed scope and keeps fog to one note (AC-10)", () => {
  const policy = validateT4PlanningPolicy(parseT4PlanningPolicy(readPlanningReference()));
  const checkedCriterion = t4PreciseFutureFixture().acceptanceCriteria[0];
  const preciseAc = evaluateT4PlanningPolicy(policy, t4PreciseFutureFixture());
  assert.deepEqual(preciseAc, {
    output: "precise-milestone-or-spec",
    proposalHandling: "eligible",
    tasks: [],
    milestoneEligible: true,
    artifact: "spec.md",
    specAcceptanceCriteria: [checkedCriterion],
    notes: [],
  });

  const preciseQuestion = evaluateT4PlanningPolicy(policy, t4PreciseQuestionFixture());
  assert.deepEqual(preciseQuestion, {
    output: "precise-milestone-or-spec",
    proposalHandling: "eligible",
    tasks: [],
    milestoneEligible: true,
    artifact: null,
    specAcceptanceCriteria: [],
    notes: [],
  }, "a precise question keeps a milestone eligible for Discussion but cannot write spec.md");

  const mixedFixture = t4MixedFutureFixture();
  const mixed = evaluateT4PlanningPolicy(policy, mixedFixture);
  assert.deepEqual(mixed, {
    output: "precise-milestone-or-spec",
    proposalHandling: "eligible",
    tasks: [],
    milestoneEligible: true,
    artifact: "spec.md",
    specAcceptanceCriteria: [mixedFixture.acceptanceCriteria[0]],
    notes: [mixedFixture.uncheckedNote],
  }, "only checked ACs enter spec and all unchecked remainder collapses to one note");

  const vagueFixtures = [t4UncheckedFutureFixture(), t4VagueFutureFixture()];
  for (const fixture of vagueFixtures) {
    const vague = evaluateT4PlanningPolicy(policy, fixture);
    assert.deepEqual(vague, {
      output: "one-fog/future/out-of-scope-note",
      proposalHandling: "hold-until-new-evidence",
      tasks: [],
      milestoneEligible: false,
      artifact: null,
      specAcceptanceCriteria: [],
      notes: [fixture.note],
    });
  }
  assert.deepEqual(
    [...new Set([
      preciseAc.artifact,
      preciseQuestion.artifact,
      mixed.artifact,
      ...vagueFixtures.map((fixture) => evaluateT4PlanningPolicy(policy, fixture).artifact),
    ].filter(Boolean))],
    ["spec.md"],
    "future precision gate introduces no artifact type beyond the existing spec",
  );
  assert.equal(
    listSkillDirs().includes("gsd-wayfinder"),
    false,
    "precision policy must not introduce a Wayfinder skill",
  );
});

test("T4 mutation guards reject selector drift horizontal rows and ordinary forced migration ceremony", () => {
  const reference = readPlanningReference();
  const selectorMutant = replaceT3TableCell(
    reference,
    T4_PLANNING_POLICY_MARKER,
    "Cross-layer user behavior",
    "Inputs",
    "`phase=plan;kind=behavior;proposal=cross-layer`",
  );
  assert.throws(
    () => validateT4PlanningPolicy(parseT4PlanningPolicy(selectorMutant)),
    /Cross-layer user behavior: policy row/,
    "removing a routing selector must change the policy contract",
  );

  const horizontalMutant = replaceT3TableCell(
    reference,
    T4_PLANNING_POLICY_MARKER,
    "Ordinary three-layer proposal",
    "Tasks/order",
    "`DB:storage;Service:domain;API:http`",
  );
  assert.throws(
    () => validateT4PlanningPolicy(parseT4PlanningPolicy(horizontalMutant)),
    /Ordinary three-layer proposal: policy row/,
    "ordinary layer split must be rejected",
  );

  let ceremonyMutant = replaceT3TableCell(
    reference,
    T4_PLANNING_POLICY_MARKER,
    "Ordinary three-layer proposal",
    "Output",
    "`ordered-expand-migrate-contract`",
  );
  ceremonyMutant = replaceT3TableCell(
    ceremonyMutant,
    T4_PLANNING_POLICY_MARKER,
    "Ordinary three-layer proposal",
    "Tasks/order",
    "`Expand:backward-compatible-new-seam;Migrate+:bounded-callers;Contract:remove-old-seam`",
  );
  assert.throws(
    () => validateT4PlanningPolicy(parseT4PlanningPolicy(ceremonyMutant)),
    /Ordinary three-layer proposal: policy row/,
    "ordinary behavior must not force Expand/Migrate/Contract",
  );
});

test("T4 mutation guards reject missing or causally false lower-seam reasons", () => {
  const policy = validateT4PlanningPolicy(parseT4PlanningPolicy(readPlanningReference()));
  const lowerFixture = t4CrossLayerFixture();
  lowerFixture.id = "lower-module-with-reason";
  lowerFixture.seams[0].deterministic = false;
  lowerFixture.planTest = "test/checkout-module.test.js";
  lowerFixture.lowerSeamReason = "The browser harness cannot deterministically isolate duplicate-submit timing.";
  lowerFixture.acPins = [{
    id: "AC-9",
    test: "test/checkout-module.test.js",
    lowerSeamReason: lowerFixture.lowerSeamReason,
  }];
  const valid = evaluateT4PlanningPolicy(policy, lowerFixture);
  assert.equal(valid.tasks[0].test, "test/checkout-module.test.js");

  const missingReason = structuredClone(lowerFixture);
  missingReason.id = "lower-module-without-reason";
  missingReason.lowerSeamReason = null;
  missingReason.acPins[0].lowerSeamReason = null;
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, missingReason),
    /lower public seam requires a concrete higher-boundary reason/,
  );

  const contradictoryCause = structuredClone(lowerFixture);
  contradictoryCause.id = "lower-module-false-absence";
  contradictoryCause.lowerSeamReason = "The browser boundary harness does not exist.";
  contradictoryCause.acPins[0].lowerSeamReason = contradictoryCause.lowerSeamReason;
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, contradictoryCause),
    /lower-seam reason must match the live higher-boundary cause/,
    "an existing nondeterministic boundary cannot be described as absent",
  );
});

test("T4 seam mutations reject each ineligible seam property usable-higher bypass and conflicting AC pins", () => {
  const policy = validateT4PlanningPolicy(parseT4PlanningPolicy(readPlanningReference()));
  const propertyMutations = [
    ["existing", false],
    ["public", false],
    ["testOnly", true],
    ["testOnlyBypass", true],
    ["deterministic", false],
    ["isolatesAc", false],
  ];
  for (const [property, value] of propertyMutations) {
    const mutant = t4CrossLayerFixture();
    mutant.id = `invalid-selected-${property}`;
    mutant.seams[0][property] = value;
    assert.throws(
      () => evaluateT4PlanningPolicy(policy, mutant),
      /proposed plan-row seam must be public deterministic existing and observe the AC/,
      `${property} must independently participate in seam eligibility`,
    );
  }

  const bypass = t4CrossLayerFixture();
  bypass.id = "bypass-usable-browser";
  bypass.planTest = "test/checkout-module.test.js";
  bypass.lowerSeamReason = "The browser harness cannot deterministically isolate the AC.";
  bypass.acPins = [{
    id: "AC-9",
    test: "test/checkout-module.test.js",
    lowerSeamReason: bypass.lowerSeamReason,
  }];
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, bypass),
    /plan row test must equal the deterministic highest usable public seam/,
  );

  const conflictingPins = t4CrossLayerFixture();
  conflictingPins.id = "conflicting-ac-seams";
  conflictingPins.specAcIds = ["AC-9", "AC-9B"];
  conflictingPins.satisfies = "AC-9|AC-9B";
  conflictingPins.acPins.push({
    id: "AC-9B",
    test: "test/checkout-module.test.js",
    lowerSeamReason: "The browser harness cannot deterministically isolate AC-9B.",
  });
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, conflictingPins),
    /every satisfied AC must share the selected test seam/,
  );

  const conflictingReasons = t4CrossLayerFixture();
  conflictingReasons.id = "same-seam-conflicting-reasons";
  conflictingReasons.seams[0].deterministic = false;
  conflictingReasons.planTest = "test/checkout-module.test.js";
  conflictingReasons.lowerSeamReason = "The browser harness is nondeterministic for checkout timing.";
  conflictingReasons.satisfies = "AC-9|AC-9B";
  conflictingReasons.specAcIds = ["AC-9", "AC-9B"];
  conflictingReasons.acPins = [
    {
      id: "AC-9",
      test: "test/checkout-module.test.js",
      lowerSeamReason: conflictingReasons.lowerSeamReason,
    },
    {
      id: "AC-9B",
      test: "test/checkout-module.test.js",
      lowerSeamReason: "The browser harness cannot deterministically isolate only AC-9B.",
    },
  ];
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, conflictingReasons),
    /every satisfied AC must share the selected lower-seam reason/,
  );
});

test("T4 same-tier boundary selection follows entrypoint convention coverage then stops on ambiguity", () => {
  const policy = validateT4PlanningPolicy(parseT4PlanningPolicy(readPlanningReference()));
  const entrypointFixture = t4EntrypointTieBreakFixture();
  const entrypoint = evaluateT4PlanningPolicy(policy, entrypointFixture);
  assert.equal(
    entrypoint.tasks[0].test,
    "test/browser/checkout.test.js",
    "the AC-named browser entrypoint wins before an HTTP canonical/coverage preference",
  );

  const canonicalFixture = t4CanonicalTieBreakFixture();
  const canonical = evaluateT4PlanningPolicy(policy, canonicalFixture);
  assert.equal(
    canonical.tasks[0].test,
    "test/browser/canonical-checkout.test.js",
    "repository canonical convention wins before greater coverage at the same entrypoint",
  );

  const coverageFixture = t4CoverageTieBreakFixture();
  const coverage = evaluateT4PlanningPolicy(policy, coverageFixture);
  assert.equal(
    coverage.tasks[0].test,
    "test/browser/full-checkout.test.js",
    "greater production-path coverage wins after equal entrypoint and convention",
  );

  const ambiguous = t4CoverageTieBreakFixture();
  ambiguous.id = "indistinguishable-browser-harnesses";
  ambiguous.seams[1].productionPathCoverage = ambiguous.seams[0].productionPathCoverage;
  ambiguous.planTest = ambiguous.seams[0].path;
  ambiguous.acPins[0].test = ambiguous.planTest;
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, ambiguous),
    /same-tier public harnesses remain materially ambiguous; stop in Discussion/,
    "two indistinguishable boundary harnesses must not be selected by array order",
  );
});

test("T4 legacy no-pin dispatch accepts a valid highest row and rejects unjustified lower rows", () => {
  const policy = validateT4PlanningPolicy(parseT4PlanningPolicy(readPlanningReference()));
  const legacyHighest = t4CrossLayerFixture();
  legacyHighest.id = "legacy-highest-no-pin";
  legacyHighest.specEra = "legacy";
  delete legacyHighest.acPins;
  const highest = evaluateT4PlanningPolicy(policy, legacyHighest);
  assert.equal(highest.tasks[0].test, legacyHighest.planTest);
  assert.equal(highest.tasks[0].lowerSeamReason, "none");

  const legacyLower = t4CrossLayerFixture();
  legacyLower.id = "legacy-lower-no-pin-valid-reason";
  legacyLower.specEra = "legacy";
  delete legacyLower.acPins;
  legacyLower.seams[0].deterministic = false;
  legacyLower.planTest = "test/checkout-module.test.js";
  legacyLower.lowerSeamReason = "The browser harness cannot deterministically isolate duplicate-submit timing.";
  const lower = evaluateT4PlanningPolicy(policy, legacyLower);
  assert.equal(lower.tasks[0].test, legacyLower.planTest);
  assert.equal(lower.tasks[0].lowerSeamReason, legacyLower.lowerSeamReason);

  const unjustifiedLower = structuredClone(legacyLower);
  unjustifiedLower.id = "legacy-lower-no-pin-no-reason";
  unjustifiedLower.lowerSeamReason = null;
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, unjustifiedLower),
    /lower public seam requires a concrete higher-boundary reason/,
    "a missing legacy pin does not excuse an unjustified lower plan-row seam",
  );
});

test("T4 vertical completeness and candidate green results reject partial or red rows", () => {
  const policy = validateT4PlanningPolicy(parseT4PlanningPolicy(readPlanningReference()));
  const apiOnly = t4CrossLayerFixture();
  apiOnly.id = "api-only-vertical";
  apiOnly.emittedLayers = ["api"];
  apiOnly.filesByStage.Vertical = [
    "src/checkout-api.js",
    "test/e2e/checkout.test.js",
  ];
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, apiOnly),
    /vertical task must cover exactly every required behavior layer/,
    "a cross-layer fixture reduced to API-only must fail",
  );

  const missingOwnedLayer = t4CrossLayerFixture();
  missingOwnedLayer.id = "vertical-storage-file-missing";
  missingOwnedLayer.filesByStage.Vertical = missingOwnedLayer.filesByStage.Vertical
    .filter((file) => file !== "src/orders.js");
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, missingOwnedLayer),
    /at least one owned file for required layer storage/,
  );

  const redVertical = t4CrossLayerFixture();
  redVertical.id = "vertical-lands-green-false";
  redVertical.candidateGreenByStage.Vertical = false;
  const redVerticalPlan = evaluateT4PlanningPolicy(policy, redVertical);
  assert.equal(redVerticalPlan.tasks[0].greenVerification, "required-after-implementation");
  assert.throws(
    () => verifyT4CandidateRows(redVertical, redVerticalPlan.tasks),
    /candidate Vertical row needs a verified true green result/,
  );

  const missingVerticalGreen = t4CrossLayerFixture();
  missingVerticalGreen.id = "vertical-green-missing";
  delete missingVerticalGreen.candidateGreenByStage.Vertical;
  const missingVerticalPlan = evaluateT4PlanningPolicy(policy, missingVerticalGreen);
  assert.throws(
    () => verifyT4CandidateRows(missingVerticalGreen, missingVerticalPlan.tasks),
    /candidate Vertical row needs a verified true green result/,
  );

  const greenMutations = [
    ["Expand", (fixture) => { fixture.candidateGreenByStage.Expand = false; }],
    ["first Migrate", (fixture) => { fixture.candidateGreenByStage.Migrate[0] = false; }],
    ["second Migrate", (fixture) => { fixture.candidateGreenByStage.Migrate[1] = false; }],
    ["Contract", (fixture) => { delete fixture.candidateGreenByStage.Contract; }],
  ];
  for (const [name, mutate] of greenMutations) {
    const fixture = t4WideRefactorFixture();
    fixture.id = `${name.toLowerCase().replace(" ", "-")}-green-invalid`;
    mutate(fixture);
    const candidatePlan = evaluateT4PlanningPolicy(policy, fixture);
    assert.throws(
      () => verifyT4CandidateRows(fixture, candidatePlan.tasks),
      /candidate (?:Expand|Migrate|Contract) row needs a verified true green result/,
      `${name} must produce verified green evidence after implementation`,
    );
  }
});

test("T4 EMC semantic safety rejects incompatible unsafe or premature stages", () => {
  const policy = validateT4PlanningPolicy(parseT4PlanningPolicy(readPlanningReference()));
  const mutations = [
    {
      id: "incompatible-expand",
      mutate: (fixture) => { fixture.candidateSafetyByStage.Expand.backwardCompatible = false; },
      error: /Expand must be verified backward-compatible/,
    },
    {
      id: "unbounded-migrate",
      mutate: (fixture) => { fixture.candidateSafetyByStage.Migrate[0].bounded = false; },
      error: /every Migrate must be bounded/,
    },
    {
      id: "both-seams-off-migrate",
      mutate: (fixture) => { fixture.candidateSafetyByStage.Migrate[0].bothSeamsWorking = false; },
      error: /every Migrate must keep both seams working/,
    },
    {
      id: "migrate-check-exercises-only-old-seam",
      mutate: (fixture) => {
        fixture.checks.Migrate[0] = "Invoke billing callers through the old identifier seam and mention the new identifier seam → old identifier seam response returns success for billing and new identifier seam response returns success for billing";
      },
      error: /Migrate check must affirmatively exercise each old and new seam/,
    },
    {
      id: "migrate-check-expects-negated-safety",
      mutate: (fixture) => {
        fixture.checks.Migrate[0] = "Invoke billing callers through the old identifier seam and invoke billing callers through the new identifier seam → old identifier seam response returns failure for billing and new identifier seam response returns failure for billing";
      },
      error: /Migrate check must expect an affirmative safe result from each old and new seam/,
    },
    {
      id: "expand-check-expects-negated-safety",
      mutate: (fixture) => {
        fixture.checks.Expand = "Invoke the old account identifier seam and invoke the new account identifier seam → old account identifier seam response returns failure and new account identifier seam response returns failure";
      },
      error: /Expand check must expect an affirmative safe result from each old and new seam/,
    },
    {
      id: "expand-check-exercises-negated-one-seam",
      mutate: (fixture) => {
        fixture.checks.Expand = "Invoke only the old account identifier seam and omit the new account identifier seam → old account identifier seam response returns success and new account identifier seam response returns success";
      },
      error: /Expand check must affirmatively exercise each old and new seam/,
    },
    {
      id: "expand-check-expects-stopped-seams",
      mutate: (fixture) => {
        fixture.checks.Expand = "Invoke the old account identifier seam and invoke the new account identifier seam → old account identifier seam response returns stopped support and new account identifier seam response returns stopped support";
      },
      error: /Expand check must expect an affirmative safe result from each old and new seam/,
    },
    {
      id: "migrate-check-loses-working-support",
      mutate: (fixture) => {
        fixture.checks.Migrate[0] = "Run old and new billing seams → both seams lose working support for billing";
      },
      error: /needs concrete action → expected observable result, not a placeholder/,
    },
    {
      id: "stale-reference-contract",
      mutate: (fixture) => { fixture.candidateSafetyByStage.Contract.repositoryReferencesGone = false; },
      error: /Contract cannot run with stale repository references/,
    },
    {
      id: "unknown-ownership-contract",
      mutate: (fixture) => { fixture.candidateSafetyByStage.Contract.consumerOwnershipKnown = false; },
      error: /unknown consumer ownership must retain the old seam/,
    },
    {
      id: "unknown-external-consumers-contract",
      mutate: (fixture) => { fixture.candidateSafetyByStage.Contract.externalConsumers = "unknown"; },
      error: /external-consumer inventory must be a known state/,
    },
    {
      id: "unmigrated-external-consumers-contract",
      mutate: (fixture) => { fixture.candidateSafetyByStage.Contract.externalConsumers = "known-unmigrated"; },
      error: /external consumers need migration or a completed compatibility\/deprecation obligation/,
    },
    {
      id: "missing-external-consumers-contract",
      mutate: (fixture) => { delete fixture.candidateSafetyByStage.Contract.externalConsumers; },
      error: /external-consumer inventory must be a known state/,
    },
    {
      id: "bogus-external-consumers-with-obligation-contract",
      mutate: (fixture) => {
        fixture.candidateSafetyByStage.Contract.externalConsumers = "partial";
        fixture.candidateSafetyByStage.Contract.compatibilityObligationCompleted = true;
      },
      error: /external-consumer inventory must be a known state/,
    },
    {
      id: "contract-check-targets-new-not-stale-references",
      mutate: (fixture) => {
        fixture.checks.Contract = "Inventory repository callers and references then invoke the public API contract → caller/reference inventory returns zero new references and public API response remains green";
      },
      error: /Contract check must expect zero stale callers\/references/,
    },
    {
      id: "contract-check-omits-api-green",
      mutate: (fixture) => {
        fixture.checks.Contract = "Inventory repository callers and references then invoke the public API contract → caller/reference inventory returns zero old references";
      },
      error: /Contract check must expect the public API to remain green/,
    },
    {
      id: "incomplete-inventory-contract",
      mutate: (fixture) => { fixture.candidateSafetyByStage.Contract.inventoryComplete = false; },
      error: /Contract requires a complete caller\/reference inventory/,
    },
    {
      id: "unmigrated-owned-consumers-contract",
      mutate: (fixture) => { fixture.candidateSafetyByStage.Contract.ownedConsumersMigrated = false; },
      error: /Contract requires every owned consumer migrated/,
    },
    {
      id: "scalar-green-for-repeated-migrate",
      mutate: (fixture) => { fixture.candidateGreenByStage.Migrate = true; },
      error: /repeated Migrate needs a per-row green result array/,
    },
    {
      id: "contract-check-skips-inventory",
      mutate: (fixture) => {
        fixture.checks.Contract = "Invoke the public API contract → public API response returns green";
      },
      error: /Contract check must explicitly inventory callers\/references/,
    },
  ];
  for (const { id, mutate, error } of mutations) {
    const fixture = t4WideRefactorFixture();
    fixture.id = id;
    mutate(fixture);
    assert.throws(
      () => {
        const candidatePlan = evaluateT4PlanningPolicy(policy, fixture);
        verifyT4CandidateRows(fixture, candidatePlan.tasks);
      },
      error,
      `${id} must fail before Contract can remove the old seam`,
    );
  }
});

test("T4 concrete Check and precise-question gates reject placeholders while partitioning mixed scope", () => {
  const policy = validateT4PlanningPolicy(parseT4PlanningPolicy(readPlanningReference()));
  const planTbd = t4CrossLayerFixture();
  planTbd.id = "plan-check-tbd";
  planTbd.checks.Vertical = "TBD";
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, planTbd),
    /needs concrete action → expected observable result, not a placeholder/,
    "the reproduced Check: TBD counterexample must fail",
  );
  const genericCheck = t4CrossLayerFixture();
  genericCheck.id = "verbose-but-vague-check";
  genericCheck.checks.Vertical = "Do work → it works";
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, genericCheck),
    /needs concrete action → expected observable result, not a placeholder/,
  );
  const paddedGenericCheck = t4CrossLayerFixture();
  paddedGenericCheck.id = "padded-verbose-vague-check";
  paddedGenericCheck.checks.Vertical = "Perform all the work → it works correctly";
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, paddedGenericCheck),
    /needs concrete action → expected observable result, not a placeholder/,
  );
  const domainPaddedGenericCheck = t4CrossLayerFixture();
  domainPaddedGenericCheck.id = "domain-padded-verbose-vague-check";
  domainPaddedGenericCheck.checks.Vertical = "Perform account export work → account export works correctly";
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, domainPaddedGenericCheck),
    /needs concrete action → expected observable result, not a placeholder/,
  );


  const specTbd = t4PreciseFutureFixture();
  specTbd.id = "spec-check-tbd";
  specTbd.acceptanceCriteria[0].check = "TBD";
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, specTbd),
    /materially answerable question or concrete AC Check/,
  );

  const specBareLabel = t4PreciseFutureFixture();
  specBareLabel.id = "spec-check-bare-result-label";
  specBareLabel.acceptanceCriteria[0].check = "Request account export over HTTP → account export status returns status";
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, specBareLabel),
    /materially answerable question or concrete AC Check/,
    "a future AC Check whose expected side is only a bare result label must stay unchecked",
  );

  const questionLabel = t4PreciseQuestionFixture();
  questionLabel.id = "question-is-only-a-label";
  questionLabel.preciseQuestion = "Export format?";
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, questionLabel),
    /materially answerable question or concrete AC Check/,
  );
  const vagueQuestion = t4PreciseQuestionFixture();
  vagueQuestion.id = "verbose-but-vague-question";
  vagueQuestion.preciseQuestion = "What should we do about this area?";
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, vagueQuestion),
    /materially answerable question or concrete AC Check/,
  );
  const domainWordVagueQuestion = t4PreciseQuestionFixture();
  domainWordVagueQuestion.id = "domain-word-but-vague-question";
  domainWordVagueQuestion.preciseQuestion = "What should we do about account behavior?";
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, domainWordVagueQuestion),
    /materially answerable question or concrete AC Check/,
  );
  const discussionTopicQuestion = t4PreciseQuestionFixture();
  discussionTopicQuestion.id = "bounded-nouns-but-unbounded-question";
  discussionTopicQuestion.preciseQuestion = "What account export format is worth discussing?";
  assert.throws(
    () => evaluateT4PlanningPolicy(policy, discussionTopicQuestion),
    /materially answerable question or concrete AC Check/,
  );


  const mixed = t4MixedFutureFixture();
  assert.equal(mixed.acceptanceCriteria[1].check, "TBD");
  const outcome = evaluateT4PlanningPolicy(policy, mixed);
  assert.deepEqual(outcome.specAcceptanceCriteria, [mixed.acceptanceCriteria[0]]);
  assert.deepEqual(outcome.notes, [mixed.uncheckedNote]);
});

test("T4 actual spec AC set rejects missing duplicate bogus and duplicate-pin references", () => {
  const policy = validateT4PlanningPolicy(parseT4PlanningPolicy(readPlanningReference()));
  const mutations = [
    {
      id: "missing-satisfies",
      mutate: (fixture) => { fixture.satisfies = ""; },
      error: /T1 must satisfy at least one AC/,
    },
    {
      id: "duplicate-satisfies",
      mutate: (fixture) => { fixture.satisfies = "AC-9|AC-9"; },
      error: /T1 satisfies IDs must be unique/,
    },
    {
      id: "bogus-ac-404",
      mutate: (fixture) => { fixture.satisfies = "AC-404"; },
      error: /T1 has unknown satisfies AC ID AC-404/,
    },
    {
      id: "current-pin-missing",
      mutate: (fixture) => { delete fixture.acPins; },
      error: /current spec needs AC seam pins/,
    },
    {
      id: "duplicate-pin",
      mutate: (fixture) => {
        fixture.specAcIds = ["AC-9", "AC-10"];
        fixture.satisfies = "AC-9|AC-10";
        fixture.acPins = [
          structuredClone(fixture.acPins[0]),
          structuredClone(fixture.acPins[0]),
        ];
      },
      error: /duplicate AC seam pins are invalid/,
    },
  ];
  for (const { id, mutate, error } of mutations) {
    const fixture = t4CrossLayerFixture();
    fixture.id = id;
    mutate(fixture);
    assert.throws(() => evaluateT4PlanningPolicy(policy, fixture), error);
  }

  const disjoint = t4WideRefactorFixture();
  disjoint.id = "disjoint-row-ac-coverage";
  disjoint.specAcIds = ["AC-9", "AC-10", "AC-11", "AC-12"];
  disjoint.satisfiesByStage = {
    Expand: "AC-9",
    Migrate: ["AC-10", "AC-11"],
    Contract: "AC-12",
  };
  delete disjoint.satisfies;
  disjoint.acPins = disjoint.specAcIds.map((id) => ({
    id,
    test: disjoint.planTest,
    lowerSeamReason: disjoint.lowerSeamReason,
  }));
  const disjointOutcome = evaluateT4PlanningPolicy(policy, disjoint);
  assert.deepEqual(
    disjointOutcome.tasks.map((task) => task.satisfies),
    ["AC-9", "AC-10", "AC-11", "AC-12"],
    "row-local AC references may be disjoint while their union covers the actual spec set",
  );
});

test("T4 plan serialization rejects stage files test and AC drift after exact round-trip", () => {
  const policy = validateT4PlanningPolicy(parseT4PlanningPolicy(readPlanningReference()));
  const fixture = t4WideRefactorFixture();
  const outcome = evaluateT4PlanningPolicy(policy, fixture);
  const schema = parseDocumentedT4PlanSchema(readSkill("gsd-to-plan"));
  const plan = serializeT4Plan(outcome, fixture, schema);
  validateT4PlanRoundTrip(outcome, fixture, schema, plan);

  const swappedStage = plan
    .replace("Expand compatible account identifier seam", "__EXPAND__")
    .replace("Contract obsolete account identifier seam", "Expand compatible account identifier seam")
    .replace("__EXPAND__", "Contract obsolete account identifier seam");
  assert.throws(
    () => validateT4PlanRoundTrip(outcome, fixture, schema, swappedStage),
    /serialized EMC descriptions\/order must retain stage identity/,
  );

  const changedFiles = plan.replace("src/billing.js", "src/billing-v2.js");
  assert.throws(
    () => validateT4PlanRoundTrip(outcome, fixture, schema, changedFiles),
    /serialized plan must round-trip exact id\/task\/satisfies\/files\/test\/status/,
  );

  const changedTest = plan.replace(
    ",test/account-api.test.js,pending",
    ",test/other-api.test.js,pending",
  );
  assert.throws(
    () => validateT4PlanRoundTrip(outcome, fixture, schema, changedTest),
    /serialized plan must round-trip exact id\/task\/satisfies\/files\/test\/status/,
  );

  const bogusAc = plan.replace(",AC-9,", ",AC-404,");
  assert.throws(
    () => validateT4PlanRoundTrip(outcome, fixture, schema, bogusAc),
    /serialized plan references unknown AC ID AC-404/,
  );
});

test("T4 mutation guards reject vague task or artifact creation", () => {
  const policy = validateT4PlanningPolicy(parseT4PlanningPolicy(readPlanningReference()));
  const fixture = t4VagueFutureFixture();
  const canonical = evaluateT4PlanningPolicy(policy, fixture);

  const taskMutant = structuredClone(canonical);
  taskMutant.tasks.push({
    id: "T1",
    stage: "Vertical",
    task: "Speculate about recommendation service architecture",
    test: "none",
  });
  assert.throws(
    () => validateT4PlanningOutcome(policy, fixture, taskMutant),
    /exact task shape\/order\/test seam/,
    "vague future area must not create a task",
  );

  const artifactMutant = structuredClone(canonical);
  artifactMutant.artifact = "future-map.toon";
  assert.throws(
    () => validateT4PlanningOutcome(policy, fixture, artifactMutant),
    /artifact boundary/,
    "vague future area must not create a tracker/map artifact",
  );
});

// ── T5: AC-11 coverage inventory + AC-12 load-profile audit ──────────────

test("AC-11 contract coverage inventory exercises every runtime-contract area so past contradictions cannot pass silently", () => {
  const loadFixtures = () =>
    JSON.parse(readFileSync(join(ROOT, "test", "eval", "fixtures.json"), "utf8"));
  const t4Policy = () =>
    validateT4PlanningPolicy(parseT4PlanningPolicy(readPlanningReference()));

  // Each area names its executable evidence; a real regression makes that evidence throw.
  const inventory = [
    {
      area: "trigger-to-route reachability",
      evidence: () => {
        const fixtures = loadFixtures();
        const reached = new Set(fixtures.map((fx) => fx.route));
        for (const route of ["0", "1", "2", "3", "4", "5", "6", "meta"]) {
          assert.ok(reached.has(route), `route ${route} has no triggering fixture`);
        }
        validateT3RouteContract(readSkill("gsd"), fixtures);
      },
    },
    {
      area: "mode-specific Required/Optional artifacts",
      evidence: () => {
        for (const fx of T1_MODE_CONTRACTS) {
          const row = parseInvocationModes(readSkill(fx.skill)).rows.find(
            (candidate) => candidate.Mode === fx.mode,
          );
          assert.ok(row, `${fx.skill}: missing invocation mode ${fx.mode}`);
          assertArtifactSet(row.Required, fx.required, `${fx.skill}/${fx.mode}/Required`);
          assertArtifactSet(row.Optional, fx.optional, `${fx.skill}/${fx.mode}/Optional`);
        }
        // The "missing required plan" scenario lives here, not in fixtures.json.
        assert.ok(
          T1_MODE_CONTRACTS.some(
            (fx) => fx.required.includes("plan.toon") && fx.recovery?.["plan.toon"],
          ),
          "a Required plan.toon mode with recovery must cover missing-required-plan",
        );
      },
    },
    {
      area: "redirect cycles bounded",
      evidence: () => {
        // Mode-before-validation is the structural cycle guard: select the mode, validate only that
        // mode's Required, tolerate missing Optional/Produced, then recover per-row — never a blanket bounce.
        const contract = extractPeerSection(
          readFileSync(join(SKILLS_DIR, "gsd", "REFERENCE.md"), "utf8"),
          "Artifact Contract",
        );
        const selectMode = contract.indexOf(
          "Select the target skill and its **Invocation Mode** from explicit intent and entry context",
        );
        const validateRequired = contract.indexOf("validate only that mode's **Required** artifacts");
        const tolerateNonRequired = contract.indexOf(
          "Treat missing **Optional** and not-yet-created **Produced** artifacts as normal",
        );
        const recoverRequired = contract.indexOf(
          "For a missing **Required** artifact, execute the row's **Missing required** action",
        );
        assert.ok(
          selectMode >= 0
            && validateRequired > selectMode
            && tolerateNonRequired > validateRequired
            && recoverRequired > tolerateNonRequired,
          "mode-before-validation ordering (the redirect-cycle guard) must hold",
        );
        assert.match(
          readSkill("gsd"),
          /missing Optional artifacts never redirect/,
          "missing Optional must never bounce to /gsd (cycle guard)",
        );
      },
    },
    {
      area: "Ponytail activation/propagation",
      evidence: () => {
        validateT3RouteContract(readSkill("gsd"), loadFixtures());
        validateT3StateContract(readSkill("gsd-ponytail"));
      },
    },
    {
      area: "context-harvest no-op/write/ambiguity",
      evidence: () => {
        const source = {
          master: readSkill("gsd"),
          domain: readSkill("gsd-domain-modeling"),
          execution: readSkill("gsd-executing-plans"),
        };
        // validateContextHarvestContract asserts the whole no-op/write/ambiguity matrix.
        const policy = validateContextHarvestContract(source);
        const noop = evaluateContextHarvestPolicy(policy, {
          phase: "entry", authority: "read-only", mode: "typo", signal: "none",
        });
        assert.equal(noop.writes.length, 0, "no-op harvest must not write");
        assert.equal(noop.questions, 0, "no-op harvest must not ask");
        const write = evaluateContextHarvestPolicy(policy, {
          phase: "pre-approval", authority: "write-authorized", signal: "term",
          certainty: "certain", map: "absent", writePath: "CONTEXT.md",
        });
        assert.deepEqual(write.writes, ["CONTEXT.md"], "certain term must write its context doc");
        assert.equal(write.questions, 0, "certain write must not ask");
        const ambiguity = evaluateContextHarvestPolicy(policy, {
          phase: "pre-approval", authority: "write-authorized", signal: "term",
          certainty: "material-ambiguous", map: "unresolved",
        });
        assert.equal(ambiguity.questions, 1, "material ambiguity must ask exactly one question");
        assert.equal(ambiguity.writes.length, 0, "unresolved ambiguity must not write");
      },
    },
    {
      area: "planning decomposition rules",
      evidence: () => {
        const policy = t4Policy();
        evaluateT4PlanningPolicy(policy, t4CrossLayerFixture());
        evaluateT4PlanningPolicy(policy, t4WideRefactorFixture());
      },
    },
  ];

  for (const { area, evidence } of inventory) {
    assert.doesNotThrow(evidence, `coverage gap in area: ${area}`);
  }
  // Locking the area list prevents silently dropping a covered contract area.
  assert.deepEqual(
    inventory.map(({ area }) => area),
    [
      "trigger-to-route reachability",
      "mode-specific Required/Optional artifacts",
      "redirect cycles bounded",
      "Ponytail activation/propagation",
      "context-harvest no-op/write/ambiguity",
      "planning decomposition rules",
    ],
    "all six runtime-contract areas must stay inventoried",
  );
});

test("AC-11 meta-guard: promoting a mode's Optional artifacts into Required fails the exact T1 artifact-set contract", () => {
  const fixture = T1_MODE_CONTRACTS.find(
    (fx) => fx.skill === "gsd-verify" && fx.mode === "Standalone review (Route 2)",
  );
  assert.ok(fixture, "standalone-review contract fixture must exist");
  const row = parseInvocationModes(readSkill(fixture.skill)).rows.find(
    (candidate) => candidate.Mode === fixture.mode,
  );
  assert.ok(row, "standalone-review invocation row must exist");

  // Baseline: the shipped contract has an empty Required set and spec.md/plan.toon Optional.
  assert.doesNotThrow(() => {
    assertArtifactSet(row.Required, fixture.required, "baseline/Required");
    assertArtifactSet(row.Optional, fixture.optional, "baseline/Optional");
  });

  // Regression: reintroduce the optional-as-required rule by moving Optional into Required.
  const regressed = { ...row, Required: row.Optional, Optional: "—" };
  assert.throws(
    () => assertArtifactSet(regressed.Required, fixture.required, "regressed/Required"),
    /exact artifact set/,
    "an Optional artifact promoted into Required must fail the exact T1 artifact-set contract",
  );
});

test("AC-12 load-profile audit: skill inventory, registration, plan schema, and lazy master ownership are unchanged", () => {
  const CANONICAL_GSD_SKILLS = [
    "gsd",
    "gsd-codebase-design",
    "gsd-diagnosing-bugs",
    "gsd-domain-modeling",
    "gsd-executing-plans",
    "gsd-handoff",
    "gsd-improve-codebase-architecture",
    "gsd-lavish",
    "gsd-ponytail",
    "gsd-tdd",
    "gsd-to-plan",
    "gsd-verify",
  ];
  // 1. Registered skill inventory — exact set: no skill deleted, renamed, or newly registered.
  assert.deepEqual(
    listSkillDirs().sort(),
    [...CANONICAL_GSD_SKILLS].sort(),
    "registered gsd* skill inventory must be unchanged",
  );
  // 2. Registration mechanism + no new root/executable manifest for the skills load profile.
  const install = readFileSync(join(ROOT, "install.sh"), "utf8");
  assert.match(
    install,
    /for dir in "\$REPO"\/skills\/gsd\*; do/,
    "install.sh must register the skills/gsd* set via its symlink loop",
  );
  assert.ok(
    !existsSync(join(ROOT, "package.json")),
    "no root package.json/executable manifest may be introduced for the skills system",
  );
  // 3. plan.toon schema unchanged — anchored to the documented Format block header, not incidental prose.
  const planSchema = parseDocumentedT4PlanSchema(readSkill("gsd-to-plan"));
  assert.deepEqual(
    planSchema,
    { version: "schema:v1", columns: ["id", "task", "satisfies", "files", "test", "status"] },
    "plan.toon must stay schema:v1 with exactly id,task,satisfies,files,test,status",
  );
  // 4. Routing-critical master points to lazy canonical detail; it never copies the Artifact Contract into the hot path.
  const master = readSkill("gsd");
  assert.match(
    master,
    /invocation-mode table under \[REFERENCE\.md\]\(REFERENCE\.md\) § Artifact Contract/,
    "master must point its direct-invocation mode-table rule to the lazy canonical [REFERENCE.md] § Artifact Contract",
  );
  assert.doesNotMatch(
    master,
    /^## Artifact Contract/m,
    "the canonical Artifact Contract section must live only in REFERENCE.md",
  );
  assert.doesNotMatch(
    master,
    /\| Mode \| Required \| Optional \| Produced \| Missing required \|/,
    "the canonical mode-table interface must not be duplicated into master",
  );
});
