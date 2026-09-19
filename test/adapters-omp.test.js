import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");

// Decision 0015 moved the OMP adapter body under adapters/omp/ while keeping the
// extensions/gsd-context.js and root install.sh entry paths working. These tests
// lock that seam: the entry shims stay thin and host-free, and the installer entry
// forwards to the re-homed adapter instead of naming OMP itself.
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

test("M7: the root install.sh forwards to the re-homed OMP installer", () => {
  const entry = read("install.sh");
  assert.match(entry, /adapters\/omp\/install\.sh/, "root entry must name the adapter installer");
  assert.match(entry, /exec bash/, "root entry must exec the adapter installer, forwarding argv and env");
  assert.ok(
    existsSync(join(ROOT, "adapters", "omp", "install.sh")),
    "the re-homed OMP installer must exist",
  );

  const installer = read("adapters/omp/install.sh");
  assert.match(
    installer,
    /dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\.\/\.\./,
    "the re-homed installer must resolve REPO two levels up to the checkout root",
  );
});
