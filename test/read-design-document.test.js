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
  // Original has 1 surface (orders.md). Replacement has 2 surfaces.
  // If a pathname reader followed the symlink it would see 2; the pinned fd
  // must still return 1 from the original tree.
  const replacement = join(workspace, "design-replacement");
  const replacementDocs = join(replacement, "docs");
  fs.mkdirSync(replacementDocs, { recursive: true });
  fs.writeFileSync(join(replacementDocs, "interaction-rules.md"), ruleLedger(["IR-1", "IR-2"]));
  fs.writeFileSync(join(replacementDocs, "orders.md"), surfaceDoc("Orders"));
  fs.writeFileSync(join(replacementDocs, "inventory.md"), surfaceDoc("Inventory"));

  let rootFd, designFd;
  let swapTriggered = false;
  const originalOpenSync = fs.openSync.bind(fs);

  fs.openSync = (...args) => {
    const p = String(args[0]);
    const fd = originalOpenSync(...args);
    if (p === workspace) rootFd = fd;
    if (rootFd && p === `/proc/self/fd/${rootFd}/design`) {
      designFd = fd;
      // Move original design/ aside (renameSync preserves inode).
      // designFd still references the original inode via /proc/self/fd/.
      const saved = join(workspace, ".design-original");
      fs.renameSync(join(workspace, "design"), saved);
      fs.symlinkSync(replacement, join(workspace, "design"));
      swapTriggered = true;
    }
    return fd;
  };

  try {
    const result = validateDesignMap("design/docs", { cwd: workspace });
    assert.ok(swapTriggered, "swap must have been triggered");
    assert.equal(result.kind, "design-map");
    // Must read original tree (1 surface), not replacement (2 surfaces).
    assert.equal(result.surfaces, 1, "pinned fd must read original tree, not symlink target");
  } finally {
    fs.openSync = originalOpenSync;
    try { fs.rmSync(join(workspace, "design"), { recursive: true, force: true }); } catch {}
    try { fs.renameSync(join(workspace, ".design-original"), join(workspace, "design")); } catch {}
    try { fs.rmSync(replacement, { recursive: true, force: true }); } catch {}
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("pre-pin symlink swap is caught by fd-anchored traversal, not resolver", () => {
  const workspace = makeDesignWorkspace();
  // Target has a valid map (2 surfaces) so the resolver would accept it.
  // The fd-anchored traversal must reject it because the swap happens
  // during validateDesignMap's own root-identity lstatSync, after the
  // resolver has already validated the original design/ directory.
  const escapeDir = join(workspace, ".escape-target");
  const escapeDocs = join(escapeDir, "docs");
  fs.mkdirSync(escapeDocs, { recursive: true });
  fs.writeFileSync(join(escapeDocs, "interaction-rules.md"), ruleLedger(["IR-1", "IR-2"]));
  fs.writeFileSync(join(escapeDocs, "orders.md"), surfaceDoc("Orders"));
  fs.writeFileSync(join(escapeDocs, "inventory.md"), surfaceDoc("Inventory"));

  let swapTriggered = false;
  const originalLstatSync = fs.lstatSync.bind(fs);

  // Swap design/ to a symlink when validateDesignMap's own lstatSync(workspace)
  // fires for the root identity check — after resolveDesignDocsLocation has
  // already validated the original design/ directory.
  fs.lstatSync = (...args) => {
    const result = originalLstatSync(...args);
    if (String(args[0]) === workspace && !swapTriggered) {
      swapTriggered = true;
      fs.rmSync(join(workspace, "design"), { recursive: true, force: true });
      fs.symlinkSync(escapeDir, join(workspace, "design"));
    }
    return result;
  };

  try {
    assert.throws(
      () => validateDesignMap("design/docs", { cwd: workspace }),
      /must be a directory|cannot be opened|identity changed|not a directory/,
    );
    // Assert AFTER throws — the swap must have triggered during validation,
    // proving the fd-anchored traversal was exercised.
    assert.ok(swapTriggered, "swap must have triggered during validateDesignMap");
  } finally {
    fs.lstatSync = originalLstatSync;
    try { fs.rmSync(join(workspace, "design"), { recursive: true, force: true }); } catch {}
    try { fs.rmSync(escapeDir, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(join(workspace, "design", "docs"), { recursive: true });
    fs.writeFileSync(join(workspace, "design", "docs", "interaction-rules.md"), ruleLedger(["IR-1"]));
    fs.writeFileSync(join(workspace, "design", "docs", "orders.md"), surfaceDoc("Orders"));
  }
});
