import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests make their scratch directories under tmpdir() and leave them behind, so each
// test process gets a private TMPDIR that goes once its tests finish. Hooks and CLIs
// the tests spawn inherit it.
const root = mkdtempSync(join(tmpdir(), "gsd-test-"));
process.env.TMPDIR = root;
afterAll(() => rmSync(root, { recursive: true, force: true }));
