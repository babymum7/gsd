#!/usr/bin/env bun
import { fileURLToPath } from "node:url";
import { analyzeWaves, isSafeBranchRef, normalizePlanFile, validatePlanFile } from "../lib/gsd-contract.mjs";

const COMMANDS = new Set(["validate-plan", "validate-quick-fix", "analyze-waves", "normalize-plan"]);

// The lifecycle runs in workspaces that are not this checkout, so every help and error
// surface names the path this process was actually loaded from. A repo-relative form here
// would re-teach the one invocation that never resolves outside the GSD checkout, and a
// `<GSD_ROOT>` placeholder is bootstrap text no shell expands.
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const INVOCATION = `bun ${JSON.stringify(SCRIPT_PATH)}`;

function quote(value) {
  return JSON.stringify(String(value));
}

function write(lines) {
  process.stdout.write(lines.join("\n"));
}

function commandUsage(command) {
  if (command === "validate-plan") {
    return `${INVOCATION} validate-plan --path .scratch/<feature>/plan.md [--expected-sha256 <64-hex>] [--expected-base <branch>]`;
  }
  if (command === "validate-quick-fix") {
    return `${INVOCATION} validate-quick-fix --path .scratch/<feature>/plan.md [--expected-base <branch>]`;
  }
  if (command === "analyze-waves") {
    return `${INVOCATION} analyze-waves --path .scratch/<feature>/plan.md [--expected-sha256 <64-hex>] [--expected-base <branch>]`;
  }
  if (command === "normalize-plan") {
    return `${INVOCATION} normalize-plan --path .scratch/<feature>/plan.md [--write]`;
  }
  return `${INVOCATION} <validate-plan|validate-quick-fix|analyze-waves|normalize-plan> --path <artifact>`;
}

function emitHelp(command) {
  write([
    `bin: ${quote(SCRIPT_PATH)}`,
    `description: ${quote("Validate GSD plan authority in the current workspace")}`,
    `usage: ${quote(commandUsage(command))}`,
  ]);
}

function failUsage(message, command = null) {
  write([
    "status: error",
    "code: usage",
    `error: ${quote(message)}`,
    `help: ${quote(commandUsage(command))}`,
  ]);
  process.exitCode = 2;
}

function failArtifact(error, command) {
  const message = String(error?.message ?? error)
    .replace(/[\x00-\x1F\x7F]+/g, " ")
    .trim()
    .slice(0, 500) || "plan validation failed";
  // Only the library's own tag selects `io-error`; anything else stays malformed
  // authority, so an unexpected tag value can never invent a third code.
  const code = error?.contractFailure === "io-error" ? "io-error" : "invalid-artifact";
  // A semantic rejection carries its own remediation: it replaces the generic usage
  // on the `help:` line so the agent reads the fix, not the flag list.
  let remediation = error?.hint
    ? String(error.hint).replace(/[\x00-\x1F\x7F]+/g, " ").trim()
    : null;
  if (!remediation) {
    if (/hash mismatch/i.test(message)) {
      remediation = "revalidate unbound and rebind through the amendment flow, never silently overwrite";
    } else if (/does not match recorded base_ref/i.test(message)) {
      remediation = "align --expected-base with plan § Base";
    } else {
      remediation = commandUsage(command);
    }
  }
  const rows = [
    "status: error",
    `code: ${code}`,
    `error: ${quote(message)}`,
    // Advisory location for the failing construct: purely additive, emitted only
    // when the library computed a 1-based line for the rejection.
  ];
  if (Number.isInteger(error?.contractLine) && error.contractLine > 0) rows.push(`line: ${error.contractLine}`);
  rows.push(`help: ${quote(remediation)}`);
  write(rows);
  process.exitCode = 1;
}

function parseArguments(argv) {
  const [command, ...args] = argv;
  if (!command) return { usageError: "a validation command is required", command: null };
  if (!COMMANDS.has(command)) return { usageError: `unknown command: ${command}`, command: null };
  if (args.length === 1 && args[0] === "--help") return { command, help: true };

  let planPath = null;
  let expectedSha256 = null;
  let expectedBase = null;
  let write = false;
  const FLAGS = new Set(["--path", "--expected-sha256", "--expected-base", "--write"]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!FLAGS.has(flag)) {
      return { usageError: `unknown argument: ${flag}`, command };
    }
    if (flag === "--write") {
      if (command !== "normalize-plan") {
        return { usageError: `${command} does not accept --write`, command };
      }
      if (write) {
        return { usageError: "--write may be supplied only once", command };
      }
      write = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      return { usageError: `${flag} requires a value`, command };
    }
    index += 1;
    if (flag === "--path") {
      if (planPath !== null) return { usageError: "--path may be supplied only once", command };
      planPath = value;
    } else if (flag === "--expected-sha256") {
      if (expectedSha256 !== null) {
        return { usageError: "--expected-sha256 may be supplied only once", command };
      }
      expectedSha256 = value;
    } else {
      if (expectedBase !== null) {
        return { usageError: "--expected-base may be supplied only once", command };
      }
      expectedBase = value;
    }
  }

  if (planPath === null) return { usageError: "--path is required", command };
  if (command === "normalize-plan") {
    if (expectedSha256 !== null) return { usageError: `${command} does not accept --expected-sha256`, command };
    if (expectedBase !== null) return { usageError: `${command} does not accept --expected-base`, command };
  }
  if (expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    return {
      usageError: "--expected-sha256 must be exactly 64 lowercase hexadecimal characters",
      command,
    };
  }
  if (command === "validate-quick-fix" && expectedSha256 !== null) {
    return { usageError: `${command} does not accept --expected-sha256`, command };
  }
  if (expectedBase !== null && !isSafeBranchRef(expectedBase)) {
    return { usageError: "--expected-base must be one Git branch name able to receive a merge", command };
  }
  return { command, planPath, expectedSha256, expectedBase, write };
}

const input = parseArguments(process.argv.slice(2));
if (input.usageError) {
  failUsage(input.usageError, input.command);
} else if (input.help) {
  emitHelp(input.command);
} else if (input.command === "normalize-plan") {
  try {
    const result = normalizePlanFile(input.planPath, { write: input.write });
    if (!input.write && result.diff) {
      process.stdout.write(result.diff);
    }
  } catch (error) {
    failArtifact(error, input.command);
  }
} else {
  try {
    const result = validatePlanFile(input.planPath, {
      kind: input.command === "validate-quick-fix" ? "quick-fix" : "plan",
      expectedSha256: input.expectedSha256,
      expectedBase: input.expectedBase,
    });
    const lines = [
      "status: valid",
      `kind: ${result.kind}`,
      `feature: ${result.feature}`,
      `base: ${result.base}`,
      `sha256: ${result.sha256}`,
      `tasks: ${result.tasks}`,
    ];
    if (input.command === "analyze-waves") {
      const waves = analyzeWaves(result.parsed.tasks)
        .map((wave) => wave.tasks.join(","))
        .join("|");
      lines.push(`waves: ${waves}`);
    }
    write(lines);
  } catch (error) {
    failArtifact(error, input.command);
  }
}
