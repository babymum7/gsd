import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

test("the bootstrap source stays within its word cap", () => {
  const source = readFileSync(join(ROOT, "skills/gsd/SKILL.md"), "utf8");
  const words = source.trim().split(/\s+/).filter(Boolean).length;
  assert.ok(words <= 450, `bootstrap source has ${words} words`);
});
