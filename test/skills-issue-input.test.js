import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const section = (content, heading) => content.split(`\n## ${heading}\n`)[1]?.split("\n## ")[0] ?? "";

test("the bootstrap routes a well-specified issue to brainstorming", () => {
  const route = read("skills/gsd/SKILL.md")
    .split("\n")
    .find((line) => line.startsWith("- **New or changed behavior**"));
  assert.match(route, /well-specified issue/);
  assert.match(route, /`gsd-brainstorming`/);
});

// Most tracker fixes ship as a branch and pull request; a quick fix that could never commit sent
// that work around GSD entirely (decision 0048).
test("the bootstrap lets a quick fix commit only when the user or repository asks", () => {
  const route = read("skills/gsd/SKILL.md")
    .split("\n")
    .find((line) => line.startsWith("- **Quick fix**"));
  assert.match(route, /No packet or plan/);
  assert.match(route, /[Cc]ommit only when the user or repository asks/);
  assert.match(route, /never `wip\/\*`/);
  assert.match(route, /preflight --base <base>/);
  assert.doesNotMatch(route, /or commit\./);
});

test("brainstorming takes an issue from any tracker as converged input", () => {
  const issue = section(read("skills/gsd-brainstorming/SKILL.md"), "Tracked issue");
  assert.match(issue, /with their comments/);
  assert.match(issue, /acceptance criteria/);
  assert.match(issue, /the Convergence transition without discovery questions/);
  assert.match(issue, /`D-n` decision/);
  assert.match(issue, /repository's instructions say not to ask back/);
  assert.doesNotMatch(issue, /GitHub|Gitea|GitLab|Jira|Linear|`gh`/);
});

test("how issues map to features, tasks, and sub-agents is the agent's recommendation", () => {
  const issue = section(read("skills/gsd-brainstorming/SKILL.md"), "Tracked issue");
  assert.match(issue, /several issues/i);
  assert.match(issue, /one feature, parts, or separate features/);
  assert.match(issue, /own sub-agent/);
  assert.match(issue, /your recommendation/);
});

test("repository landing steps follow a merge into the checked-out branch", () => {
  const brainstorming = read("skills/gsd-brainstorming/SKILL.md");
  assert.match(section(brainstorming, "Delivery question"), /repository's instructions say how work .* lands, record `merge` without asking/);
  const merge = read("skills/gsd-verify/SKILL.md")
    .split("\n")
    .find((line) => line.trim().startsWith("- `merge`:"));
  assert.match(merge, /§ Feature cleanup, then the landing steps the repository's instructions give/);
});
