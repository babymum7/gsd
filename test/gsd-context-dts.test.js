import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const extension = await import(join(ROOT, "extensions", "gsd-context.js"));

test("the hand-maintained d.ts mirrors the extension facade's public surface", () => {
  const dts = readFileSync(join(ROOT, "extensions", "gsd-context.d.ts"), "utf8");

  const runtimeNamed = Object.keys(extension)
    .filter((name) => name !== "default")
    .sort();
  const declaredNamed = [...dts.matchAll(/^export (?:const|function) ([A-Za-z0-9_]+)/gm)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(
    declaredNamed,
    runtimeNamed,
    "d.ts named exports must match the extension facade exactly",
  );
  assert.match(dts, /^export default function gsdContextExtension\b/gm, "d.ts must declare the default factory");
});
