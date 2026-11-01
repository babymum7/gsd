import { test } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { checkFixture } from "./eval/outcome-eval-contract.mjs";
import { DEFAULT_INTENT_FIXTURES_DIR, loadIntentFixtures } from "./eval/intent-eval-contract.mjs";

const ROOT = join(import.meta.dir, "..");
const FIXTURE_TEST_TIMEOUT_MS = 60000;

test(
  "every intent fixture proves itself: vague or clear, a clarification, and hidden tests only the solution passes",
  () => {
    const loaded = loadIntentFixtures(join(ROOT, DEFAULT_INTENT_FIXTURES_DIR));
    assert.equal(loaded.ok, true, loaded.detail);
    const kinds = loaded.fixtures.map((fixture) => fixture.kind).sort();
    assert.deepEqual(kinds, ["clear", "clear", "vague", "vague", "vague", "vague"]);
    for (const fixture of loaded.fixtures) {
      assert.ok(fixture.clarification.length > 0, `${fixture.id} has no clarification`);
      const checked = checkFixture(fixture);
      assert.equal(checked.ok, true, checked.detail);
    }
  },
  FIXTURE_TEST_TIMEOUT_MS,
);
