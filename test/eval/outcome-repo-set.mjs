// The repository-knowledge outcome set (decision 0047): fixtures whose deciding rules sit in the
// starting repository instead of the prompt. The unchanged harness runs them with --fixtures and
// --report-path, so the other sets' reports keep their fingerprints.
import { liveSetFingerprint } from "./outcome-hard-set.mjs";

export const REPO_FIXTURES_DIR = "test/eval/outcome-fixtures-repo";
export const REPO_REPORT_PATH = "test/eval/outcome-report-repo.json";

export function liveRepoFingerprint(root) {
  return liveSetFingerprint(root, REPO_FIXTURES_DIR);
}
