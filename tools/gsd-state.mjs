#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVE_STATE_PHASES,
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
    return `${INVOCATION} write-state --feature-dir .scratch/<feature> [--takeover] --json-file .scratch/<feature>/.state-input.json`;
  }
  if (command === "validate-state") {
    return `${INVOCATION} validate-state --path .scratch/<feature>/state.toon`;
  }
  if (command === "set") {
    return `${INVOCATION} set --feature-dir .scratch/<feature> [--takeover] [key=value...]`;
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
      "Unsupported experimental schemas are rejected without rewriting the file.",
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
      "The JSON must be an object with exactly these v0.0.3 fields (order is normalised):",
      "",
      ...STATE_FIELD_ORDER.map((f) => `  ${f}`),
      "",
      "Unset fields use the literal string \"none\" (never null or \"\").",
      "Constraints:",
      `  phase                  one of: ${ACTIVE_STATE_PHASES.join(", ")}`,
      "  plan_path              .scratch/<feature>/plan.md",
      "  wip_branch             wip/<feature>",
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
      "Validate a state.toon file without writing anything. Outputs parsed fields as JSON.",
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
      "Accepts key=value pairs for canonical v0.0.3 state fields.",
      "",
      "Options:",
      "  --feature-dir <dir>    Feature directory (.scratch/<feature>) (required)",
      "  --takeover             Allow owner= to replace another session's recorded owner",
      "",
      "Fields:",
      ...STATE_FIELD_ORDER.map((f) => `  ${f}`),
      "",
      "Defaults:",
      "  schema                 v0.0.3",
      "  feature                basename of --feature-dir",
      "  owner                  none (pass the session GSD_SESSION token)",
      "  phase                  approved",
      "  next_action            derived from phase when omitted",
      "  plan_path              .scratch/<feature>/plan.md",
      "  wip_branch             wip/<feature>",
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
    "  read-state       Read and validate a state.toon file",
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

// A packet has one writer. Without this check a session that still believes it owns a packet
// silently takes it back from the session the user handed it to, and both keep executing.
function refuseOwnerChange(feature, recorded, requested, command, takeover) {
  if (recorded === "none" || requested === recorded || takeover) return;
  write_([
    "status: error",
    "code: owner-mismatch",
    `error: ${quote(`packet ${feature} is owned by ${recorded}, not ${requested}`)}`,
    `help: ${quote(`leave it alone unless the user named this packet; then rerun this ${command} with --takeover`)}`,
  ]);
  process.exit(1);
}

function failArtifact(error, command) {
  const message = String(error?.message ?? error)
    .replace(/[\x00-\x1F\x7F]+/g, " ")
    .trim()
    .slice(0, 500) || "state validation failed";
  const code = error?.contractFailure === "io-error" ? "io-error" : "invalid-artifact";
  write_(["status: error", `code: ${code}`, `error: ${quote(message)}`, `help: ${quote(remediation(message, command))}`]);
  process.exit(1);
}

// A retired schema is never migrated in place; the fix is a fresh binding that carries the
// old record's values forward, so the help line names that rebind instead of the flag list.
function remediation(message, command) {
  const retired = /unsupported schema: (\S+)/.exec(message);
  if (!retired) return commandUsage(command);
  return (
    `state schema ${retired[1]} is retired: revalidate plan.md, delete this state.toon, then rebind with ` +
    `${INVOCATION} set --feature-dir .scratch/<feature> owner=<GSD_SESSION> phase=<phase> base_ref=<base_ref> ` +
    "last_green_task=<task> last_green_commit=<commit>, copying those values from the old file"
  );
}

function parseArguments(argv) {
  const result = { command: null, help: false, path: null, featureDir: null, json: null, jsonFile: null, takeover: false, pairs: [] };

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
    if (arg === "--takeover" && (result.command === "set" || result.command === "write-state")) {
      result.takeover = true;
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
  // The fallback writer obeys the same one-owner rule as `set`. An unreadable existing record
  // is left to writeStateAtomic, which a retired-schema rebind relies on.
  const existingPath = path.join(path.resolve(input.featureDir), "state.toon");
  if (existsSync(existingPath) && typeof state?.owner === "string") {
    let recorded = null;
    try {
      recorded = inspectStateFile(existingPath).owner;
    } catch {
      recorded = null;
    }
    if (recorded !== null) refuseOwnerChange(path.basename(path.resolve(input.featureDir)), recorded, state.owner, "write-state", input.takeover);
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
      schema: "v0.0.3",
      feature: featureMetaName,
      owner: "none",
      phase: "approved",
      next_action: "none",
      plan_path: "none",
      base_ref: "none",
      wip_branch: "none",
      last_green_task: "none",
      last_green_commit: "none",
      checkpoint_revision: "1",
    };
  }

  const ownerPair = input.pairs.find((p) => p.key === "owner");
  if (exists && ownerPair) refuseOwnerChange(featureMetaName, baseState.owner, ownerPair.value, "set", input.takeover);

  const state = { ...baseState };
  for (const { key, value } of input.pairs) {
    state[key] = value;
  }

  if (exists) {
    if (!updateKeys.has("checkpoint_revision")) {
      state.checkpoint_revision = (BigInt(baseState.checkpoint_revision) + 1n).toString();
    }
    // Pausing keeps the interrupted action so a resume continues it; every other phase change
    // derives its default.
    if (!updateKeys.has("next_action") && updateKeys.has("phase") && state.phase !== "paused") {
      const defaultNext = defaultNextActionForPhase(state.phase);
      if (defaultNext != null) {
        state.next_action = defaultNext;
      }
    }
  } else {
    if (!updateKeys.has("plan_path")) {
      state.plan_path = `.scratch/${state.feature}/plan.md`;
    }
    if (!updateKeys.has("wip_branch")) {
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
