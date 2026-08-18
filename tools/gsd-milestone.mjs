#!/usr/bin/env node
// Milestone ledger grammar and lifecycle completion. The ledger's status column was
// prose-controlled, so nothing could tell a session that completed a feature from one that
// silently left every row `pending`. This tool parses the canonical UTF-8/LF grammar
// (skills/gsd/REFERENCE.md § Convergence Ledger publication contract) and performs the only
// two status transitions the contract allows: mark the first pending row `done`, or delete the
// ledger when that row is the final milestone.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MILESTONE_BRANCH_RE, MILESTONE_SLUG_RE, parseMilestoneLedger } from "../lib/gsd-milestone.mjs";

const COMMANDS = new Set(["validate", "complete"]);
const VALUE_FLAGS = new Set(["--path", "--expected-feature", "--expected-base"]);

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const INVOCATION = `node ${JSON.stringify(SCRIPT_PATH)}`;

function quote(value) {
  return JSON.stringify(String(value));
}

function write(lines) {
  process.stdout.write(lines.join("\n"));
}

function commandUsage(command) {
  if (command === "validate") {
    return `${INVOCATION} validate --path docs/gsd/<feature>/milestones.md [--expected-feature <slug>] [--expected-base <branch>]`;
  }
  if (command === "complete") {
    return `${INVOCATION} complete --path docs/gsd/<feature>/milestones.md [--expected-feature <slug>] [--expected-base <branch>]`;
  }
  return `${INVOCATION} <validate|complete> [options]`;
}

function emitHelp(command) {
  write([
    "Usage:",
    commandUsage(command),
    "",
    "Commands:",
    "  validate  Parse and prove the canonical milestone ledger grammar; exit 0 reports",
    "            the rows and first pending row, exit 1 reports an invalid ledger.",
    "  complete  Mark the first pending row done, or delete the ledger when that row is",
    "            the final milestone. Preserves every other byte exactly.",
    "",
    "Flags:",
    "  --path              Path to docs/gsd/<feature>/milestones.md.",
    "  --expected-feature  Require ## Feature to name this exact slug.",
    "  --expected-base     Require ## Base to name this exact branch.",
  ]);
  process.exitCode = 0;
}

function failUsage(message, command = null) {
  write(["status: error", "code: usage", `error: ${quote(message)}`, `help: ${quote(commandUsage(command))}`]);
  process.exitCode = 2;
}

function failLedger(message, command) {
  write(["status: error", "code: invalid-ledger", `error: ${quote(message)}`, `help: ${quote(commandUsage(command))}`]);
  process.exitCode = 1;
}

function failIo(message, command) {
  write(["status: error", "code: io-error", `error: ${quote(message)}`, `help: ${quote(commandUsage(command))}`]);
  process.exitCode = 1;
}

function parseArguments(argv) {
  const [command, ...args] = argv;
  if (!command) return { usageError: "a milestone command is required", command: null };
  if (!COMMANDS.has(command)) return { usageError: `unknown command: ${command}`, command: null };
  if (args.length === 1 && args[0] === "--help") return { command, help: true };

  let path = null;
  let expectedFeature = null;
  let expectedBase = null;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!VALUE_FLAGS.has(flag)) {
      return { usageError: `unknown argument: ${flag}`, command };
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      return { usageError: `${flag} requires a value`, command };
    }
    index += 1;
    if (flag === "--path") {
      if (path !== null) return { usageError: "--path may be supplied only once", command };
      path = value;
    } else if (flag === "--expected-feature") {
      if (expectedFeature !== null) {
        return { usageError: "--expected-feature may be supplied only once", command };
      }
      expectedFeature = value;
    } else {
      if (expectedBase !== null) {
        return { usageError: "--expected-base may be supplied only once", command };
      }
      expectedBase = value;
    }
  }

  if (path === null) return { usageError: "--path is required", command };
  if (expectedFeature !== null && !MILESTONE_SLUG_RE.test(expectedFeature)) {
    return { usageError: "--expected-feature must be a lowercase kebab-case slug", command };
  }
  if (expectedBase !== null && !MILESTONE_BRANCH_RE.test(expectedBase)) {
    return { usageError: "--expected-base must be one branch name", command };
  }
  return { command, path, expectedFeature, expectedBase };
}

function readLedger(path, command) {
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    failIo(`cannot read ${path}: ${error.message}`, command);
    return null;
  }
  try {
    return parseMilestoneLedger(content);
  } catch (error) {
    failLedger(error.message, command);
    return null;
  }
}

function bindMatches(ledger, expectedFeature, expectedBase, command) {
  if (expectedFeature !== null && ledger.feature !== expectedFeature) {
    failLedger(`## Feature is ${JSON.stringify(ledger.feature)}, expected ${JSON.stringify(expectedFeature)}`, command);
    return false;
  }
  if (expectedBase !== null && ledger.base !== expectedBase) {
    failLedger(`## Base is ${JSON.stringify(ledger.base)}, expected ${JSON.stringify(expectedBase)}`, command);
    return false;
  }
  return true;
}

const input = parseArguments(process.argv.slice(2));
if (input.usageError) {
  failUsage(input.usageError, input.command);
} else if (input.help) {
  emitHelp(input.command);
} else if (input.command === "validate") {
  const ledger = readLedger(input.path, input.command);
  if (ledger !== null && bindMatches(ledger, input.expectedFeature, input.expectedBase, input.command)) {
    const ids = ledger.rows.map((row) => row.id).join(",");
    const firstPending = ledger.rows.find((row) => row.status === "pending");
    write([
      "status: valid",
      `feature: ${ledger.feature}`,
      `base: ${ledger.base}`,
      `milestones: ${ids}`,
      `first_pending: ${firstPending.id}`,
    ]);
  }
} else {
  // complete
  const ledger = readLedger(input.path, input.command);
  if (ledger === null || !bindMatches(ledger, input.expectedFeature, input.expectedBase, input.command)) {
    // error already emitted
  } else {
    const firstPendingIndex = ledger.rows.findIndex((row) => row.status === "pending");
    const firstPending = ledger.rows[firstPendingIndex];
    if (firstPendingIndex === ledger.rows.length - 1) {
      try {
        rmSync(input.path);
      } catch (error) {
        failIo(`cannot delete ${input.path}: ${error.message}`, input.command);
      }
      if (process.exitCode !== 1) {
        write(["status: deleted", `deleted: ${firstPending.id}`]);
      }
    } else {
      const line = ledger.lines[ledger.rowLines[firstPendingIndex]];
      const updated = line.replace(/\| pending \|$/, "| done |");
      if (updated === line) {
        failLedger(`failed to mark ${firstPending.id} done`, input.command);
      } else {
        ledger.lines[ledger.rowLines[firstPendingIndex]] = updated;
        try {
          writeFileSync(input.path, ledger.lines.join("\n") + "\n");
        } catch (error) {
          failIo(`cannot write ${input.path}: ${error.message}`, input.command);
        }
        if (process.exitCode !== 1) {
          write(["status: done", `done: ${firstPending.id}`]);
        }
      }
    }
  }
}
