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
