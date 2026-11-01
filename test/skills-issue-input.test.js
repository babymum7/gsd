import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const section = (content, heading) => content.split(`\n## ${heading}\n`)[1]?.split("\n## ")[0] ?? "";

// Haiku with GSD skipped every route's steps on vague requests and built a default it announced,
// so the ask rule leads the list, holds on any path, and calls a stated default a guess (decision 0050).
test("the bootstrap asks for an unstated testable outcome before editing, on any path", () => {
  const bootstrap = read("skills/gsd/SKILL.md");
  const first = section(bootstrap, "Routing")
    .split("\n")
    .find((line) => line.startsWith("- "));
  assert.match(first, /^- \*\*Unstated outcome\*\*, on any path:/);
  assert.match(first, /a result a test would pin unstated/);
  assert.match(first, /end the turn with one question proposing defaults, before editing/);
  assert.match(first, /a default you pick and state is still a guess/);
  assert.match(first, /Never ask what the request or code settles/);
  assert.doesNotMatch(bootstrap, /\*\*Unclear intent\*\*/);
});

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
  // A commit on the branch the user stands on lands nowhere else; only a branch that does
  // passes the packet-less preflight, which blocks on the base itself.
  assert.match(route, /a branch landing elsewhere first passes `gsd-git\.mjs preflight --base <base>`/);
  assert.doesNotMatch(route, /or commit\./);
  assert.ok(route.length <= 600, `the quick-fix route is ${route.length} characters`);
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
