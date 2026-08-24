#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVE_STATE_PHASES,
  COMPLETED_STATE_PHASES,
  STATE_FIELD_ORDER,
  defaultNextActionForPhase,
  inspectStateFile,
  readStateFile,
  writeStateAtomic,
} from "../lib/gsd-state.mjs";

const COMMANDS = new Set(["read-state", "write-state", "validate-state", "set"]);
const VALUE_FLAGS = new Set(["--path", "--feature-dir", "--json", "--json-file"]);
const STATE_FIELD_SET = new Set(STATE_FIELD_ORDER);

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const INVOCATION = `bun ${JSON.stringify(SCRIPT_PATH)}`;

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
  if (command === "set") {
    return `${INVOCATION} set --feature-dir .scratch/<feature> [key=value...]`;
  }
  return `${INVOCATION} <read-state|write-state|validate-state|set> [options]`;
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
  if (command === "set") {
    write_([
      "Usage: " + usage,
      "",
      "Set state fields atomically with validation and derived defaults.",
      "Accepts key=value pairs for canonical v4 state fields.",
      "",
      "Options:",
      "  --feature-dir <dir>    Feature directory (.scratch/<feature>) (required)",
      "",
      "Fields:",
      ...STATE_FIELD_ORDER.map((f) => `  ${f}`),
      "",
      "Defaults:",
      "  schema                 v4",
      "  feature                basename of --feature-dir",
      "  next_action            derived from phase when omitted",
      "  plan_path              .scratch/<feature>/plan.md (when phase != draft)",
      "  wip_branch             wip/<feature> (when phase != draft)",
      "  checkpoint_revision    incremented if existing state.toon, else 1",
      "",
      "Exit codes: 0 = success, 1 = validation error, 2 = usage error",
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
    "  set              Set state fields atomically with validation and defaults",
    "Use --help (or -h) <command> for command-specific help.",
  ]);
}

function quote(value) {
  return JSON.stringify(String(value));
}

function failUsage(message, command = null) {
  write_(["status: error", "code: usage", `error: ${quote(message)}`, `help: ${quote(commandUsage(command))}`]);
  process.exit(2);
}

function failArtifact(error, command) {
  const message = String(error?.message ?? error)
    .replace(/[\x00-\x1F\x7F]+/g, " ")
    .trim()
    .slice(0, 500) || "state validation failed";
  const code = error?.contractFailure === "io-error" ? "io-error" : "invalid-artifact";
  write_(["status: error", `code: ${code}`, `error: ${quote(message)}`, `help: ${quote(commandUsage(command))}`]);
  process.exit(1);
}

function parseArguments(argv) {
  const result = { command: null, help: false, path: null, featureDir: null, json: null, jsonFile: null, pairs: [] };

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
    if (result.command === "set") {
      if (arg.startsWith("-")) {
        failUsage(`unknown argument: ${arg}`, result.command);
      }
      const eqIdx = arg.indexOf("=");
      if (eqIdx <= 0) {
        failUsage(`expected key=value, got: ${arg}`, result.command);
      }
      const key = arg.slice(0, eqIdx);
      const value = arg.slice(eqIdx + 1);
      if (!STATE_FIELD_SET.has(key)) {
        failUsage(`unknown key: ${key}`, result.command);
      }
      result.pairs.push({ key, value });
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
} else if (input.command === "set") {
  if (!input.featureDir) failUsage("--feature-dir is required", "set");
  const featureMetaName = path.basename(path.resolve(input.featureDir));
  const statePath = path.join(path.resolve(input.featureDir), "state.toon");
  const updateKeys = new Set(input.pairs.map((p) => p.key));

  let baseState;
  const exists = existsSync(statePath);
  if (exists) {
    try {
      baseState = inspectStateFile(statePath);
    } catch (error) {
      failArtifact(error, "set");
    }
  } else {
    baseState = {
      schema: "v4",
      feature: featureMetaName,
      phase: "draft",
      next_action: "none",
      plan_path: "none",
      plan_sha256: "none",
      base_ref: "none",
      wip_branch: "none",
      last_green_task: "none",
      last_green_commit: "none",
      autosync: "none",
      cleanup_preference: "none",
      checkpoint_revision: "1",
    };
  }

  const state = { ...baseState };
  for (const { key, value } of input.pairs) {
    state[key] = value;
  }

  if (exists) {
    if (!updateKeys.has("checkpoint_revision")) {
      state.checkpoint_revision = (BigInt(baseState.checkpoint_revision) + 1n).toString();
    }
    if (!updateKeys.has("next_action") && updateKeys.has("phase")) {
      const defaultNext = defaultNextActionForPhase(state.phase);
      if (defaultNext != null) {
        state.next_action = defaultNext;
      }
    }
  } else {
    if (!updateKeys.has("plan_path") && state.phase !== "draft") {
      state.plan_path = `.scratch/${state.feature}/plan.md`;
    }
    if (!updateKeys.has("wip_branch") && state.phase !== "draft") {
      state.wip_branch = `wip/${state.feature}`;
    }
    if (!updateKeys.has("next_action")) {
      const defaultNext = defaultNextActionForPhase(state.phase);
      if (defaultNext != null) {
        state.next_action = defaultNext;
      }
    }
  }

  try {
    const result = writeStateAtomic(input.featureDir, state);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    failArtifact(error, "set");
  }
}
