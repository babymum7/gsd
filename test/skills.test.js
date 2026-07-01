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

test("gsd master self-locates sub-skills (only gsd is registered)", () => {
  const master = readSkill("gsd");
  const section = master.split("## Dynamic Sub-Skill Loading")[1] || "";
  assert.match(section, /readlink/, "gsd must self-locate sub-skills via readlink — only gsd is registered, sub-skills are siblings loaded on demand");
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
    // After dedup: either self-contained (terminal/inline keywords) or references gsd Conventions
    const selfContained = /terminal\/standalone/.test(content) && /inline/.test(content);
    const referencesCanonical = /see gsd Conventions/.test(content);
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

test("gsd-lavish has an explicit 2-part fire gate, opt-in on ambiguity (P4)", () => {
  const master = readSkill("gsd");
  const lavish = readSkill("gsd-lavish");
  assert.match(master, /Gate \(both must hold\)/, "master lavish auto-trigger must state the 2-part gate");
  assert.match(master, /opt-in/, "master lavish must be opt-in on ambiguity");
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

test("install.sh registers only gsd and initializes the lavish submodule", () => {
  const sh = readFileSync(join(ROOT, "install.sh"), "utf8");
  assert.match(sh, /ln -sfn[^\n]*skills\/gsd/, "install.sh must symlink skills/gsd to the registry");
  assert.doesNotMatch(sh, /ln -sfn[^\n]*skills\/gsd-/, "install.sh must not symlink any gsd- sub-skill");
  assert.match(sh, /submodule update --init/, "install.sh must initialize the lavish-axi submodule");
});

test("every gsd-lavish mention is gated by an opt-in cue (no unconditional browser launch)", () => {
  const cue = /opt-?in|opted in|opts in|default to terminal|if the user (?:opts|wants|accepts)|only if the user/i;
  const offenders = [];
  for (const [name, content] of Object.entries(readAllSkills())) {
    if (name === "gsd-lavish") continue; // defines the gate itself
    content.split("\n").forEach((line, i) => {
      if (/gsd-lavish/.test(line) && !cue.test(line)) offenders.push(`${name}:${i + 1}  ${line.trim()}`);
      });
  }
  assert.equal(offenders.length, 0, `lines mention gsd-lavish with no opt-in cue:\n${offenders.join("\n")}`);
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

test("gsd-verify owns an E2E gate that blocks the merge for user-facing features", () => {
  const verify = readSkill("gsd-verify");
  assert.match(verify, /E2E gate/, "gsd-verify must define an explicit E2E gate");
  assert.match(verify, /blocks the merge/, "the E2E gate must block the merge, not run as an afterthought");
  assert.match(verify, /E2E-exempt/, "gsd-verify must let pure non-UI changes opt out explicitly");
});

test("gsd-executing-plans defers E2E to the gsd-verify gate (no orphaned E2E)", () => {
  const exec = readSkill("gsd-executing-plans");
  assert.match(exec, /E2E is excluded from this per-task loop/, "executing-plans must state E2E is excluded by design");
  assert.match(exec, /owned by the `gsd-verify` E2E gate/, "executing-plans must hand E2E ownership to gsd-verify");
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

test("master notes skill:// limitation for unregistered sub-skills (P0-c)", () => {
  const gsd = readSkill("gsd");
  assert.match(gsd, /skill:\/\/.*cannot resolve|skill:\/\/.*unregistered/i, "master must note skill:// limitation");
});
