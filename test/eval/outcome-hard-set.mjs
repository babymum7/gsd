// The hard outcome set (decision 0046): fixtures whose criteria a plausible one-step change
// misses. The unchanged harness runs them with --fixtures and --report-path, so the default set's
// report keeps its fingerprint.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outcomeFingerprint, prepareBundle } from "./outcome-eval-contract.mjs";

export const HARD_FIXTURES_DIR = "test/eval/outcome-fixtures-hard";
export const HARD_REPORT_PATH = "test/eval/outcome-report-hard.json";

// The fingerprint a hard-set run of this checkout would record, from a bundle built and removed
// here, as the runner builds it.
export function liveHardFingerprint(root) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "gsd-outcome-hard-")));
  try {
    return outcomeFingerprint(prepareBundle(root, join(base, "bundle")), join(root, HARD_FIXTURES_DIR));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}
