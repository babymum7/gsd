import { test } from "bun:test";
import assert from "node:assert/strict";
import { markdownFiles, ROOT, SKILLS } from "./support/skills-fixtures.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

test("all relative Markdown links resolve", () => {
  const paths = [
    join(ROOT, "README.md"),
    ...markdownFiles(SKILLS),
    ...markdownFiles(join(ROOT, "docs")),
  ];
  for (const path of paths) {
    const content = readFileSync(path, "utf8");
    for (const match of content.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].split("#")[0];
      if (!target || /^[a-z]+:\/\//i.test(target) || target.startsWith("mailto:")) continue;
      assert.ok(existsSync(resolve(dirname(path), target)), `${path}: unresolved link ${target}`);
    }
  }
});


// Sessions stopped after each delivered part until the user typed "continue", and passed a
// moving `wip/<feature>` as the wave base, which failed `base-not-ancestor` after the first merge.
test("delivery moves on to the next part and the wave base is a commit", () => {
  const verify = readFileSync(join(SKILLS, "gsd-verify", "SKILL.md"), "utf8");
  assert.match(verify, /tick its line and start the next unchecked part in the same turn/);
  const executing = readFileSync(join(SKILLS, "gsd-executing-plans", "SKILL.md"), "utf8");
  assert.match(executing, /`--wave-base` is the commit SHA the wave's task branches were cut from/);
});
