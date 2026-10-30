import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";

const ROOT = join(import.meta.dir, "..");

// Decision 0042: every Markdown file an agent may read under skills/ has a word budget, so a
// new rule has to displace an old one instead of growing the canon. A file well under its
// budget must lower it, so a cut is never spent again without review.
const BUDGETS = {
  "skills/gsd-brainstorming/PARTS.md": 412,
  "skills/gsd-brainstorming/SKILL.md": 943,
  "skills/gsd-cleanup/SKILL.md": 758,
  "skills/gsd-codebase-architecture/DEEPENING.md": 386,
  "skills/gsd-codebase-architecture/DESIGN-IT-TWICE.md": 287,
  "skills/gsd-codebase-architecture/SKILL.md": 877,
  "skills/gsd-diagnosing-bugs/SKILL.md": 560,
  "skills/gsd-domain-modeling/SKILL.md": 1177,
  "skills/gsd-executing-plans/SKILL.md": 1003,
  "skills/gsd-refactor/SKILL.md": 1254,
  "skills/gsd-tdd/SKILL.md": 373,
  "skills/gsd-tdd/refactoring.md": 688,
  "skills/gsd-to-plan/PLAN-GRAMMAR.md": 705,
  "skills/gsd-to-plan/SKILL.md": 507,
  "skills/gsd-upgrade/SKILL.md": 588,
  "skills/gsd-verify/SKILL.md": 1068,
  "skills/gsd/REFERENCE.md": 2577,
  // Decision 0045 caps the bootstrap at 520.
  "skills/gsd/SKILL.md": 520,
};
const SLACK = 0.05;

const wordsOf = (text) => text.trim().split(/\s+/).filter(Boolean).length;

function budgetFailures(counts, budgets) {
  const failures = [];
  for (const [file, words] of Object.entries(counts)) {
    const budget = budgets[file];
    if (budget === undefined) failures.push(`${file} has ${words} words and no budget: add one`);
    else if (words > budget) failures.push(`${file} has ${words} words, over its budget of ${budget}: cut before adding`);
    else if (words < budget * (1 - SLACK)) failures.push(`${file} has ${words} words, more than 5% under its budget of ${budget}: lower it to ${words}`);
  }
  for (const file of Object.keys(budgets)) {
    if (!(file in counts)) failures.push(`${file} has a budget but no file: remove it`);
  }
  return failures;
}

test("every skill Markdown file stays within its word budget", () => {
  const counts = {};
  for (const file of new Glob("skills/**/*.md").scanSync(ROOT)) {
    counts[file] = wordsOf(readFileSync(join(ROOT, file), "utf8"));
  }
  assert.deepEqual(budgetFailures(counts, BUDGETS), []);
});

test("a budget failure names the file, its words, and the budget", () => {
  const failures = budgetFailures(
    { "skills/a.md": 101, "skills/b.md": 90, "skills/c.md": 96, "skills/new.md": 7 },
    { "skills/a.md": 100, "skills/b.md": 100, "skills/c.md": 100, "skills/gone.md": 5 },
  );
  assert.deepEqual(failures, [
    "skills/a.md has 101 words, over its budget of 100: cut before adding",
    "skills/b.md has 90 words, more than 5% under its budget of 100: lower it to 90",
    "skills/new.md has 7 words and no budget: add one",
    "skills/gone.md has a budget but no file: remove it",
  ]);
});
