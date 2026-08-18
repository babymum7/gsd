#!/usr/bin/env bun
// Durable record grammar validator (docs/decisions/ and docs/design/).
// Parses canonical UTF-8/LF records and verifies mandatory header grammar:
// # NNNN — Title, Status, Date, and non-empty Decision section.
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  RECORD_FILE_MAX_BYTES,
  RECORD_KINDS,
  parseRecordHeader,
} from "../lib/gsd-record.mjs";

const COMMANDS = new Set(["validate"]);
const VALUE_FLAGS = new Set(["--path", "--kind"]);

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const INVOCATION = `bun ${JSON.stringify(SCRIPT_PATH)}`;

function quote(value) {
  return JSON.stringify(String(value));
}

function write(lines) {
  process.stdout.write(lines.join("\n"));
}

function commandUsage(command) {
  if (command === "validate") {
    return `${INVOCATION} validate --path <path> --kind <decisions|design>`;
  }
  return `${INVOCATION} validate --path <path> --kind <decisions|design>`;
}

function emitHelp(command) {
  write([
    "Usage:",
    commandUsage(command),
    "",
    "Commands:",
    "  validate  Parse and validate a durable decision or design record; exit 0 reports",
    "            status: valid, exit 1 reports an invalid record or io error.",
    "",
    "Flags:",
    "  --path    Path to the record markdown file.",
    "  --kind    Record kind ('decisions' or 'design').",
  ]);
  process.exitCode = 0;
}

function failUsage(message, command = null) {
  write(["status: error", "code: usage", `error: ${quote(message)}`, `help: ${quote(commandUsage(command))}`]);
  process.exitCode = 2;
}

function failRecord(message, command = "validate") {
  write(["status: error", "code: invalid-record", `error: ${quote(message)}`, `help: ${quote(commandUsage(command))}`]);
  process.exitCode = 1;
}

function failIo(message, command = "validate") {
  write(["status: error", "code: io-error", `error: ${quote(message)}`, `help: ${quote(commandUsage(command))}`]);
  process.exitCode = 1;
}

function parseArguments(argv) {
  const [command, ...args] = argv;
  if (!command) return { usageError: "a record command is required", command: null };
  if (!COMMANDS.has(command)) return { usageError: `unknown command: ${command}`, command: null };
  if (args.length === 1 && args[0] === "--help") return { command, help: true };

  let path = null;
  let kind = null;
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
    } else if (flag === "--kind") {
      if (kind !== null) return { usageError: "--kind may be supplied only once", command };
      kind = value;
    }
  }

  if (path === null) return { usageError: "--path is required", command };
  if (kind === null) return { usageError: "--kind is required", command };
  if (!RECORD_KINDS.has(kind)) {
    return { usageError: "--kind must be 'decisions' or 'design'", command };
  }
  return { command, path, kind };
}

function readRecord(path, command) {
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    failIo(`cannot read ${path}: ${error.message}`, command);
    return null;
  }
  if (stat.size > RECORD_FILE_MAX_BYTES) {
    failRecord(`${path}: file exceeds maximum size of ${RECORD_FILE_MAX_BYTES} bytes`, command);
    return null;
  }
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    failIo(`cannot read ${path}: ${error.message}`, command);
    return null;
  }
  return content;
}

const input = parseArguments(process.argv.slice(2));
if (input.usageError) {
  failUsage(input.usageError, input.command);
} else if (input.help) {
  emitHelp(input.command);
} else if (input.command === "validate") {
  const content = readRecord(input.path, input.command);
  if (content !== null) {
    try {
      const record = parseRecordHeader(content, input.kind);
      write([
        "status: valid",
        `kind: ${record.kind}`,
        `number: ${record.number}`,
        `title: ${record.title}`,
      ]);
    } catch (error) {
      failRecord(error.message, input.command);
    }
  }
}
