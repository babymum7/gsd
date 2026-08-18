#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ACTIVE_STATE_PHASES,
  COMPLETED_STATE_PHASES,
  STATE_FIELD_ORDER,
  inspectStateFile,
  readStateFile,
  writeStateAtomic,
} from "../lib/gsd-state.mjs";

const COMMANDS = new Set(["read-state", "write-state", "validate-state"]);
const VALUE_FLAGS = new Set(["--path", "--feature-dir", "--json", "--json-file"]);

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const INVOCATION = `node ${JSON.stringify(SCRIPT_PATH)}`;

function write_(lines) {
  process.stdout.write(lines.join("\n") + "\n");
}

function commandUsage(command) {
  if (command === "read-state") {
    return `${INVOCATION} read-state --path .scratch/<feature>/state.toon`;
  }
  if (command === "write-state") {
    return `${INVOCATION} write-state --feature-dir .scratch/<feature> --json-file .scratch/<feature>/.state-input.json`;
  }
  if (command === "validate-state") {
    return `${INVOCATION} validate-state --path .scratch/<feature>/state.toon`;
  }
  return `${INVOCATION} <read-state|write-state|validate-state> [options]`;
}

function emitHelp(command) {
  const usage = commandUsage(command);
  if (command === "read-state") {
    write_([
      "Usage: " + usage,
      "",
      "Read and validate a state.toon file. Outputs the parsed fields as JSON.",
      "A legacy v1/v2/v3 packet is migrated in place to canonical v4.",
      "",
      "Options:",
      "  --path <path>    Path to state.toon (required)",
      "",
      "Exit codes: 0 = success, 1 = validation error, 2 = usage error",
    ]);
    return;
  }
  if (command === "write-state") {
    write_([
      "Usage: " + usage,
      "",
      "Write a state.toon file atomically with validation and readback.",
      "The JSON must be an object with exactly these v4 fields (order is normalised):",
      "",
      ...STATE_FIELD_ORDER.map((f) => `  ${f}`),
      "",
      "Unset fields use the literal string \"none\" (never null or \"\").",
      "Constraints:",
      `  phase                  one of: ${[...ACTIVE_STATE_PHASES, ...COMPLETED_STATE_PHASES].join(", ")}`,
      "  plan_path              .scratch/<feature>/plan.md",
      "  wip_branch             wip/<feature>",
      "  plan_sha256            64 lowercase hex chars",
      "  no field value may contain a newline",
      "",
      "Options:",
      "  --feature-dir <dir>    Feature directory (.scratch/<feature>) (required)",
      "  --json-file <path>     Path to JSON file with state fields (preferred, shell-safe)",
      "  --json <json>          State fields as JSON string (legacy, breaks on apostrophes)",
      "",
      "Delete the --json-file temp file after this command succeeds or fails.",
      "",
      "Exit codes: 0 = success, 1 = validation error, 2 = usage error",
    ]);
    return;
  }
  if (command === "validate-state") {
    write_([
      "Usage: " + usage,
      "",
      "Validate a state.toon file without writing anything: a legacy packet is",
      "parsed and reported unmigrated. Outputs parsed fields as JSON.",
      "",
      "Options:",
      "  --path <path>    Path to state.toon (required)",
      "",
      "Exit codes: 0 = valid, 1 = validation error, 2 = usage error",
    ]);
    return;
  }
  write_([
    "Usage: " + INVOCATION + " <command> [options]",
    "",
    "Commands:",
    "  read-state       Read and validate a state.toon file (migrates legacy schemas)",
    "  write-state      Write state.toon atomically with validation",
    "  validate-state   Validate a state.toon file without writing",
    "",
    "Use --help (or -h) <command> for command-specific help.",
  ]);
}

function failUsage(message, command = null) {
  process.stderr.write(`gsd-state: ${message}\n`);
  if (command) {
    process.stderr.write(`Usage: ${commandUsage(command)}\n`);
  } else {
    process.stderr.write(`Usage: ${commandUsage(null)}\n`);
    process.stderr.write("Use --help for available commands.\n");
  }
  process.exit(2);
}

function failArtifact(error, command) {
  process.stderr.write(`gsd-state: ${command}: ${error.message}\n`);
  process.exit(1);
}

function parseArguments(argv) {
  const result = { command: null, help: false, path: null, featureDir: null, json: null, jsonFile: null };

  let i = 0;
  if (i < argv.length && (argv[i] === "--help" || argv[i] === "-h")) {
    result.help = true;
    i++;
  }

  if (i < argv.length && !argv[i].startsWith("-")) {
    result.command = argv[i];
    i++;
  }

  if (result.help && i < argv.length) {
    result.command = argv[i];
    return result;
  }

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      i++;
      continue;
    }
    if (VALUE_FLAGS.has(arg)) {
      if (i + 1 >= argv.length) {
        failUsage(`${arg} requires a value`, result.command);
      }
      const value = argv[++i];
      if (arg === "--path") result.path = value;
      else if (arg === "--feature-dir") result.featureDir = value;
      else if (arg === "--json") result.json = value;
      else result.jsonFile = value;
      i++;
      continue;
    }
    failUsage(`unknown argument: ${arg}`, result.command);
  }

  if (!result.command) {
    if (result.help) {
      result.command = null; // show general help
    } else {
      result.usageError = "missing command";
    }
  } else if (!COMMANDS.has(result.command)) {
    result.usageError = `unknown command: ${result.command}`;
  }

  return result;
}

const input = parseArguments(process.argv.slice(2));
if (input.usageError) {
  failUsage(input.usageError, input.command);
} else if (input.help) {
  emitHelp(input.command);
} else if (input.command === "read-state") {
  if (!input.path) failUsage("--path is required", "read-state");
  try {
    const state = readStateFile(input.path);
    process.stdout.write(JSON.stringify(state, null, 2) + "\n");
  } catch (error) {
    failArtifact(error, "read-state");
  }
} else if (input.command === "validate-state") {
  if (!input.path) failUsage("--path is required", "validate-state");
  try {
    const state = inspectStateFile(input.path);
    process.stdout.write(JSON.stringify(state, null, 2) + "\n");
  } catch (error) {
    failArtifact(error, "validate-state");
  }
} else if (input.command === "write-state") {
  if (!input.featureDir) failUsage("--feature-dir is required", "write-state");
  if (!input.json && !input.jsonFile) failUsage("--json or --json-file is required", "write-state");
  if (input.json && input.jsonFile) failUsage("--json and --json-file are mutually exclusive", "write-state");
  let state;
  try {
    state = JSON.parse(input.jsonFile ? readFileSync(input.jsonFile, "utf8") : input.json);
  } catch (error) {
    const origin = input.jsonFile ? `${input.jsonFile}: ` : "";
    failUsage(`invalid JSON: ${origin}${error.message}`, "write-state");
  }
  try {
    const result = writeStateAtomic(input.featureDir, state);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    failArtifact(error, "write-state");
  }
}
