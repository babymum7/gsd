#!/usr/bin/env node
import { validateDesignMap, validatePlanFile } from "../lib/gsd-contract.mjs";

const COMMANDS = new Set(["validate-plan", "validate-quick-fix", "validate-design-map"]);

function quote(value) {
  return JSON.stringify(String(value));
}

function write(lines) {
  process.stdout.write(lines.join("\n"));
}

function commandUsage(command) {
  if (command === "validate-plan") {
    return "node tools/gsd-contract.mjs validate-plan --path .scratch/<feature>/plan.md [--expected-sha256 <64-hex>]";
  }
  if (command === "validate-quick-fix") {
    return "node tools/gsd-contract.mjs validate-quick-fix --path .scratch/<feature>/plan.md";
  }
  if (command === "validate-design-map") {
    return "node tools/gsd-contract.mjs validate-design-map --path design/docs";
  }
  return "node tools/gsd-contract.mjs <validate-plan|validate-quick-fix|validate-design-map> --path <artifact>";
}

function emitHelp(command) {
  write([
    `bin: ${quote("tools/gsd-contract.mjs")}`,
    `description: ${quote("Validate GSD plan and design-map authority in the current workspace")}`,
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
  write([
    "status: error",
    "code: invalid-artifact",
    `error: ${quote(message)}`,
    `help: ${quote(commandUsage(command))}`,
  ]);
  process.exitCode = 1;
}

function parseArguments(argv) {
  const [command, ...args] = argv;
  if (!command) return { usageError: "a validation command is required", command: null };
  if (!COMMANDS.has(command)) return { usageError: `unknown command: ${command}`, command: null };
  if (args.length === 1 && args[0] === "--help") return { command, help: true };

  let planPath = null;
  let expectedSha256 = null;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== "--path" && flag !== "--expected-sha256") {
      return { usageError: `unknown argument: ${flag}`, command };
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      return { usageError: `${flag} requires a value`, command };
    }
    index += 1;
    if (flag === "--path") {
      if (planPath !== null) return { usageError: "--path may be supplied only once", command };
      planPath = value;
    } else {
      if (expectedSha256 !== null) {
        return { usageError: "--expected-sha256 may be supplied only once", command };
      }
      expectedSha256 = value;
    }
  }

  if (planPath === null) return { usageError: "--path is required", command };
  if (expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    return {
      usageError: "--expected-sha256 must be exactly 64 lowercase hexadecimal characters",
      command,
    };
  }
  if (command !== "validate-plan" && expectedSha256 !== null) {
    return { usageError: `${command} does not accept --expected-sha256`, command };
  }
  return { command, planPath, expectedSha256 };
}

const input = parseArguments(process.argv.slice(2));
if (input.usageError) {
  failUsage(input.usageError, input.command);
} else if (input.help) {
  emitHelp(input.command);
} else {
  try {
    if (input.command === "validate-design-map") {
      const map = validateDesignMap(input.planPath);
      write([
        "status: valid",
        `kind: ${map.kind}`,
        `surfaces: ${map.surfaces}`,
        `claims: ${map.claims}`,
      ]);
    } else {
      const result = validatePlanFile(input.planPath, {
        kind: input.command === "validate-plan" ? "plan" : "quick-fix",
        expectedSha256: input.expectedSha256,
      });
      write([
        "status: valid",
        `kind: ${result.kind}`,
        `feature: ${result.feature}`,
        `sha256: ${result.sha256}`,
        `tasks: ${result.tasks}`,
      ]);
    }
  } catch (error) {
    failArtifact(error, input.command);
  }
}
