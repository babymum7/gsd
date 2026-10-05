import { test } from "bun:test";
import assert from "node:assert/strict";
import { read, skillNames, ROOT } from "./support/skills-fixtures.js";
import { readdirSync } from "node:fs";
import { join } from "node:path";

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
  // orphaning the citation, and the inventory is exact because resolving a citation by prefix
  // would still accept a heading that was narrowed.
  const CITED = [
    "Artifact Contract",
    "Base derivation and merge target",
    "Candidate discovery",
    "Canonical Markdown contract",
    "Durable decision and design records",
    "Fast TDD and task-loop constraints",
    "Feature cleanup",
    "Git/base/WIP/scratch mechanics",
    "Plan amendment",
    "Post-plan pipeline contract",
    "Runtime state contract",
    "Skill derivation from phase and next_action",
    "Visible skill mandatory-use matrix",
  ];
  for (const heading of CITED) {
    assert.ok(headings.has(heading), `REFERENCE no longer defines the cited § ${heading}`);
  }

  // `§` cites `plan.md` sections too, so those citations name their artifact first and every
  // unqualified one is canon. Scanning the citation itself rather than its position on the
  // line is what covers the mid-sentence form, which an earlier positional rule skipped.
  let canon = 0;
  let artifact = 0;
  for (const name of skillNames()) {
    read(`skills/${name}/SKILL.md`)
      .split("\n")
      .forEach((line, index) => {
        const where = `${name}:${index + 1}`;
        for (const match of line.matchAll(/§\s+([A-Z][^.,;:§\n]*)/g)) {
          const cited = match[1].trim();
          if (/`(plan\.md|state\.toon)`\s*$/.test(line.slice(0, match.index))) {
            artifact += 1;
            continue;
          }
          const heading = byLength.find((candidate) => cited.startsWith(candidate));
          assert.ok(heading, `${where} cites § ${cited}, which matches no REFERENCE heading`);
          // A citation may be followed by prose, so anything after the heading must read as
          // continuing prose rather than as more of a section name.
          const rest = cited.slice(heading.length);
          assert.match(
            rest,
            /^$|^(\s+[a-z]|\]|\)|\s*\|)/,
            `${where} cites § ${cited}, which extends the heading § ${heading}`,
          );
          assert.ok(CITED.includes(heading), `${where} cites § ${heading}, absent from the inventory`);
          canon += 1;
        }
      });
  }
  assert.ok(canon > 0, "skills must cite the canon");
  assert.ok(artifact >= 1, `plan-section citations must stay qualified, found ${artifact}`);
});

test("visible catalog descriptions stay within the injected byte budget", () => {
  // Every visible description is injected once per session, so the sum is a real cost.
  let total = 0;
  for (const name of skillNames()) {
    const skill = read(`skills/${name}/SKILL.md`);
    if (/^hide: true$/m.test(skill)) continue;
    const description = JSON.parse(skill.match(/^description: (.+)$/m)[1]);
    total += Buffer.byteLength(description, "utf8");
  }
  assert.ok(total < 1800, `summed visible description bytes must stay under 1800, got ${total}`);
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


// A hidden skill is a file under `core/skills/`, not a registered skill: Claude Code answers a
// Skill call for it with `Unknown skill`, and Codex agents guess `skills/<name>/SKILL.md` inside
// the plugin, which ships only visible skills. An instruction to load, run, or trigger one by
// bare name therefore sends the agent down a path that does not exist.
test("instructions never load a hidden skill by bare name", () => {
  const dirs = readdirSync(join(ROOT, "skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const hidden = dirs
    .filter((entry) => /^hide: true$/m.test(read(`skills/${entry.name}/SKILL.md`)))
    .map((entry) => entry.name);
  assert.ok(hidden.length > 0, "the fixture finds the hidden helper skills");

  const bareName = new RegExp(`\`(${hidden.join("|")})\``, "g");
  const imperative = /\b(?:load|loads|loading|trigger|triggers|run|runs|invoke|invokes)\b[^.]*$/i;
  const files = ["skills/gsd/REFERENCE.md"];
  for (const entry of dirs) {
    for (const file of readdirSync(join(ROOT, "skills", entry.name))) {
      if (file.endsWith(".md")) files.push(`skills/${entry.name}/${file}`);
    }
  }
  for (const file of files) {
    for (const [number, line] of read(file).split("\n").entries()) {
      for (const match of line.matchAll(bareName)) {
        assert.doesNotMatch(
          line.slice(0, match.index),
          imperative,
          `${file}:${number + 1} loads hidden skill ${match[1]} by bare name; read GSD_ROOT/skills/${match[1]}/SKILL.md instead`,
        );
      }
    }
  }
});
