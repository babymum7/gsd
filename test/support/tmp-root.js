import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests make their scratch directories under tmpdir() and leave them behind, so each
// test process gets a private TMPDIR that goes once its tests finish. Hooks and CLIs
// the tests spawn inherit it.
const root = mkdtempSync(join(tmpdir(), "gsd-test-"));
// A delegated worker running this suite inherits GSD_DELEGATED=1 (decision 0052); every
// adapter would then render the worker variant. Tests start from the default and set it themselves.
delete process.env.GSD_DELEGATED;
process.env.TMPDIR = root;
afterAll(() => rmSync(root, { recursive: true, force: true }));
