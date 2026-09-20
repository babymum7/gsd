import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createBootstrap } from "../lib/gsd-bootstrap.mjs";

const ROOT = join(import.meta.dir, "..");

test("the rendered bootstrap makes the selected skill read the first visible action", () => {
  const bootstrap = createBootstrap(ROOT);

  assert.match(
    bootstrap,
    /first visible action must be one exact `read` call on its catalog `skillPath`/,
  );
  assert.match(
    bootstrap,
    /no prose, memory, workspace\/state\/domain\/reference exploration, or other tool may precede the skill read/,
  );
  assert.match(bootstrap, /supplied workspace state is context, not files/);
  assert.match(bootstrap, /Green WIP and Quick-fix repair go to `gsd-verify`/);
  assert.match(
    bootstrap,
    /equal to `continue` or `continue implementation` selects `gsd-handoff`/,
  );

  const renderedWords = bootstrap.trim().split(/\s+/).filter(Boolean).length;
  assert.ok(renderedWords <= 900, `rendered bootstrap has ${renderedWords} words`);
});

test("the bootstrap source stays within its word cap", () => {
  const source = readFileSync(join(ROOT, "skills/gsd/SKILL.md"), "utf8");
  const words = source.trim().split(/\s+/).filter(Boolean).length;
  assert.ok(words <= 800, `bootstrap source has ${words} words`);
});
