// The hard outcome set (decision 0046): fixtures whose criteria a plausible one-step change
// misses. The unchanged harness runs them with --fixtures and --report-path, so the default set's
// report keeps its fingerprint.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outcomeFingerprint, prepareBundle } from "./outcome-eval-contract.mjs";

export const HARD_FIXTURES_DIR = "test/eval/outcome-fixtures-hard";
export const HARD_REPORT_PATH = "test/eval/outcome-report-hard.json";

// The fingerprint a run of this checkout over fixturesDir would record, from a bundle built and
// removed here, as the runner builds it. The repository-knowledge set (decision 0047) shares it.
export function liveSetFingerprint(root, fixturesDir) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "gsd-outcome-set-")));
  try {
    return outcomeFingerprint(prepareBundle(root, join(base, "bundle")), join(root, fixturesDir));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

export function liveHardFingerprint(root) {
  return liveSetFingerprint(root, HARD_FIXTURES_DIR);
}
