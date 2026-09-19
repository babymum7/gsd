import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");

// The OMP adapter body lives under adapters/omp/. The extensions/gsd-context.js
// entry remains a thin host-free compatibility surface for importers, while host
// installation is owned by the unified plugin CLI.
test("M7: the extensions/gsd-context.js entry re-exports the re-homed OMP adapter", async () => {
  const shim = await import(join(ROOT, "extensions", "gsd-context.js"));
  const adapter = await import(join(ROOT, "adapters", "omp", "gsd-context.js"));

  assert.deepEqual(
    Object.keys(shim).sort(),
    Object.keys(adapter).sort(),
    "the entry path must expose exactly the adapter's public surface",
  );
  assert.equal(shim.default, adapter.default, "the default factory must be the adapter's, not a copy");
  for (const name of Object.keys(adapter)) {
    if (name === "default") continue;
    assert.equal(shim[name], adapter[name], `${name} must be the adapter's live binding`);
  }
});

test("M7: the OMP entry shims name no host identifier", () => {
  const HARNESS_PATTERNS = [
    /OMP_/,
    /PI_CODING_AGENT_DIR/,
    /PI_PROFILE/,
    /pi\.on\(/,
    /pi\.logger/,
    /pi\.sendMessage/,
    /\.omp\//,
    /omp config/,
    /omp\/task\//,
    /session\.compacting/,
    /event\.messages/,
  ];
  for (const file of ["extensions/gsd-context.js", "extensions/gsd-context.d.ts"]) {
    const content = read(file);
    for (const pattern of HARNESS_PATTERNS) {
      assert.doesNotMatch(content, pattern, `${file} must stay host-identifier-free (${pattern})`);
    }
  }
});
