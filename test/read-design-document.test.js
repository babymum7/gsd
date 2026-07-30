import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateDesignMap } from "../lib/gsd-contract.mjs";

function ruleLedger(ids) {
  return [
    "# Interaction rules",
    "",
    "## Rules",
    "",
    ...ids.flatMap((id) => [
      `### ${id}: A rule the ledger records`,
      "",
      "- **Trigger:** An observable condition occurs.",
      "- **Behavior:** The surface responds the same way everywhere.",
      "- **Reason:** A checkable rule beats a preference.",
      "",
    ]),
  ].join("\n");
}

function surfaceDoc(name) {
  return [
    `# Surface: ${name}`,
    "",
    "## States",
    "",
    "| State | Reached when | Renders |",
    "| --- | --- | --- |",
    "| populated | Data exists | The list |",
    "",
    "## Flows",
    "",
    "1. populated: the user opens the list.",
    "",
    "## Production surfaces",
    "",
    "`none`",
    "",
    "## Conversion",
    "",
    "pending",
    "",
  ].join("\n");
}

function makeDesignWorkspace() {
  const workspace = fs.mkdtempSync(join(tmpdir(), "gsd-design-toctou-"));
  const docsDir = join(workspace, "design", "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(join(docsDir, "interaction-rules.md"), ruleLedger(["IR-1"]));
  fs.writeFileSync(join(docsDir, "orders.md"), surfaceDoc("Orders"));
  return workspace;
}

test("validateDesignMap closes all fds on read failure", () => {
  const workspace = makeDesignWorkspace();
  const closedFds = [];
  const originalCloseSync = fs.closeSync.bind(fs);
  fs.closeSync = (fd, ...rest) => { closedFds.push(fd); return originalCloseSync(fd, ...rest); };
  const originalReadSync = fs.readSync.bind(fs);
  fs.readSync = () => { throw new Error("simulated read failure"); };

  try {
    assert.throws(() => validateDesignMap("design/docs", { cwd: workspace }), /cannot be read/);
    assert.ok(closedFds.length >= 4, `expected >= 4 closed fds, got ${closedFds.length}`);
  } finally {
    fs.readSync = originalReadSync;
    fs.closeSync = originalCloseSync;
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("pinned design fd survives post-pin swap: validation reads original tree", () => {
  const workspace = makeDesignWorkspace();
  let rootFd, designFd;
  let swapTriggered = false;
  const originalOpenSync = fs.openSync.bind(fs);

  fs.openSync = (...args) => {
    const p = String(args[0]);
    const fd = originalOpenSync(...args);
    if (p === workspace) rootFd = fd;
    if (rootFd && p === `/proc/self/fd/${rootFd}/design`) {
      designFd = fd;
      // Move original design/ aside (renameSync preserves inode),
      // install symlink. designFd still references the original inode.
      const saved = join(workspace, ".design-original");
      fs.renameSync(join(workspace, "design"), saved);
      fs.symlinkSync(saved, join(workspace, "design"));
      swapTriggered = true;
    }
    return fd;
  };

  try {
    const result = validateDesignMap("design/docs", { cwd: workspace });
    assert.ok(swapTriggered, "swap must have been triggered");
    assert.equal(result.kind, "design-map");
    assert.equal(result.surfaces, 1);
  } finally {
    fs.openSync = originalOpenSync;
    try { fs.rmSync(join(workspace, "design"), { recursive: true, force: true }); } catch {}
    try { fs.renameSync(join(workspace, ".design-original"), join(workspace, "design")); } catch {}
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("pre-pin symlink swap is caught by validation before fd pinning", () => {
  const workspace = makeDesignWorkspace();

  // Swap design/ to a symlink before calling validateDesignMap.
  // resolveDesignDocsLocation catches this via lstatSync (isSymbolicLink check).
  const escapeDir = join(workspace, ".escape-target");
  fs.mkdirSync(escapeDir, { recursive: true });
  fs.rmSync(join(workspace, "design"), { recursive: true, force: true });
  fs.symlinkSync(escapeDir, join(workspace, "design"));

  try {
    assert.throws(
      () => validateDesignMap("design/docs", { cwd: workspace }),
      /must be a real directory|must resolve without indirection/,
    );
  } finally {
    try { fs.rmSync(join(workspace, "design"), { recursive: true, force: true }); } catch {}
    try { fs.rmSync(escapeDir, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(join(workspace, "design", "docs"), { recursive: true });
    fs.writeFileSync(join(workspace, "design", "docs", "interaction-rules.md"), ruleLedger(["IR-1"]));
    fs.writeFileSync(join(workspace, "design", "docs", "orders.md"), surfaceDoc("Orders"));
  }
});
