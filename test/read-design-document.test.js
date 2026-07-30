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

function surfaceDoc(name, { claims = "none", conversion = "pending" } = {}) {
  const claimLines = claims === "none"
    ? ["`none`"]
    : claims.map(({ path, intent }) => `- \`${path}\` — ${intent}`);
  const conversionLines = conversion === false
    ? []
    : ["", "## Conversion", "", ...(Array.isArray(conversion) ? conversion : [conversion])];
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
    ...claimLines,
    ...conversionLines,
    "",
  ].join("\n");
}

function makeDesignWorkspace() {
  const workspace = fs.mkdtempSync(join(tmpdir(), "gsd-design-toctou-"));
  const docsDir = join(workspace, "design", "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(
    join(docsDir, "interaction-rules.md"),
    ruleLedger(["IR-1"]),
  );
  fs.writeFileSync(join(docsDir, "orders.md"), surfaceDoc("Orders"));
  return workspace;
}

test("readDesignDocument rejects file identity changed before open", () => {
  const workspace = makeDesignWorkspace();
  const targetFile = join(workspace, "design", "docs", "orders.md");

  let targetFd = null;
  const originalOpenSync = fs.openSync.bind(fs);
  fs.openSync = (...args) => {
    const fd = originalOpenSync(...args);
    if (String(args[0]) === targetFile) {
      targetFd = fd;
      // Reset close tracking when target opens to avoid fd-reuse false positives.
      closedFd = null;
    }
    return fd;
  };

  let closedFd = null;
  const originalCloseSync = fs.closeSync.bind(fs);
  fs.closeSync = (fd, ...rest) => {
    closedFd = fd;
    return originalCloseSync(fd, ...rest);
  };

  // readDesignDocument calls fstatSync(fd) exactly twice:
  //   call 1 = post-open identity check
  //   call 2 = post-read identity check
  const originalFstatSync = fs.fstatSync.bind(fs);
  let targetFstatCalls = 0;
  fs.fstatSync = (fd, ...rest) => {
    const result = originalFstatSync(fd, ...rest);
    if (fd === targetFd) {
      targetFstatCalls++;
      if (targetFstatCalls === 1) {
        Object.defineProperty(result, "dev", { value: 99999, writable: false });
        Object.defineProperty(result, "ino", { value: 99999, writable: false });
      }
    }
    return result;
  };

  try {
    assert.throws(
      () => validateDesignMap("design/docs", { cwd: workspace }),
      /identity changed before open/,
    );
    assert.equal(closedFd, targetFd, "closeSync must receive the target fd after its open");
  } finally {
    fs.openSync = originalOpenSync;
    fs.fstatSync = originalFstatSync;
    fs.closeSync = originalCloseSync;
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("readDesignDocument rejects file changed during read", () => {
  const workspace = makeDesignWorkspace();
  const targetFile = join(workspace, "design", "docs", "orders.md");

  let targetFd = null;
  const originalOpenSync = fs.openSync.bind(fs);
  fs.openSync = (...args) => {
    const fd = originalOpenSync(...args);
    if (String(args[0]) === targetFile) {
      targetFd = fd;
      closedFd = null;
    }
    return fd;
  };

  let closedFd = null;
  const originalCloseSync = fs.closeSync.bind(fs);
  fs.closeSync = (fd, ...rest) => {
    closedFd = fd;
    return originalCloseSync(fd, ...rest);
  };

  // call 2 = post-read identity check
  const originalFstatSync = fs.fstatSync.bind(fs);
  let targetFstatCalls = 0;
  fs.fstatSync = (fd, ...rest) => {
    const result = originalFstatSync(fd, ...rest);
    if (fd === targetFd) {
      targetFstatCalls++;
      if (targetFstatCalls === 2) {
        Object.defineProperty(result, "size", { value: result.size + 1000, writable: false });
      }
    }
    return result;
  };

  try {
    assert.throws(
      () => validateDesignMap("design/docs", { cwd: workspace }),
      /changed during read/,
    );
    assert.equal(closedFd, targetFd, "closeSync must receive the target fd after its open");
  } finally {
    fs.openSync = originalOpenSync;
    fs.fstatSync = originalFstatSync;
    fs.closeSync = originalCloseSync;
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("readDesignDocument closes fd on read failure", () => {
  const workspace = makeDesignWorkspace();
  const targetFile = join(workspace, "design", "docs", "orders.md");

  let targetFd = null;
  const originalOpenSync = fs.openSync.bind(fs);
  fs.openSync = (...args) => {
    const fd = originalOpenSync(...args);
    if (String(args[0]) === targetFile) {
      targetFd = fd;
      closedFd = null;
    }
    return fd;
  };

  let closedFd = null;
  const originalCloseSync = fs.closeSync.bind(fs);
  fs.closeSync = (fd, ...rest) => {
    closedFd = fd;
    return originalCloseSync(fd, ...rest);
  };

  const originalReadSync = fs.readSync.bind(fs);
  fs.readSync = (fd, ...rest) => {
    if (fd === targetFd) throw new Error("simulated read failure");
    return originalReadSync(fd, ...rest);
  };

  try {
    assert.throws(
      () => validateDesignMap("design/docs", { cwd: workspace }),
      /cannot be read/,
    );
    assert.equal(closedFd, targetFd, "closeSync must receive the target fd after its open");
  } finally {
    fs.openSync = originalOpenSync;
    fs.readSync = originalReadSync;
    fs.closeSync = originalCloseSync;
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
