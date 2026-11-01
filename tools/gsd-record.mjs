#!/usr/bin/env bun
// Durable record grammar validator (docs/decisions/ and docs/design/).
// Parses canonical UTF-8/LF records and verifies mandatory header grammar:
// # NNNN — Title, Status, Date, and non-empty Decision section. `renumber` moves a record whose
// number a parallel branch took to the next free one.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RECORD_FILE_MAX_BYTES,
  RECORD_KINDS,
  RECORD_NAME_RE,
  nextRecordName,
  parseRecordHeader,
  renumberRecordContent,
} from "../lib/gsd-record.mjs";
import { commandsOf, errorRows, invocationOf, quote, unknownCommandMessage } from "../lib/gsd-commands.mjs";

const COMMANDS = commandsOf("gsd-record.mjs");
const VALUE_FLAGS = new Set(["--path", "--kind"]);

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const INVOCATION = invocationOf(SCRIPT_PATH);

function write(lines) {
  process.stdout.write(lines.join("\n"));
}

function commandUsage(command) {
  if (command === "renumber") {
    return `${INVOCATION} renumber --path <path> --kind <decisions|design>`;
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
    "            status: valid, or status: skipped for a file whose name does not start",
    "            with digits; exit 1 reports an invalid record or io error.",
    "  renumber  Move a record to the highest number in its directory plus one, rewrite",
    "            its title line and every tracked file's link to its old name, and list",
    "            the paths to stage; a bare number is never rewritten.",
    "",
    "Flags:",
    "  --path    Path to the record markdown file.",
    "  --kind    Record kind ('decisions' or 'design').",
  ]);
  process.exitCode = 0;
}

function failUsage(message, command = null) {
  write(errorRows("usage", message, commandUsage(command)));
  process.exitCode = 2;
}

function failRecord(message, command = "validate") {
  write(errorRows("invalid-record", message, commandUsage(command)));
  process.exitCode = 1;
}

function failIo(message, command = "validate") {
  write(errorRows("io-error", message, commandUsage(command)));
  process.exitCode = 1;
}

function parseArguments(argv) {
  const [command, ...args] = argv;
  if (args.length === 0 && (command === "--help" || command === "-h")) return { command: null, help: true };
  if (!command) return { usageError: "a record command is required", command: null };
  if (!COMMANDS.has(command)) return { usageError: unknownCommandMessage("gsd-record.mjs", command), command: null };
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
  // A FIFO reports size 0 and `readFileSync` would block on it forever.
  if (!stat.isFile()) {
    failIo(`cannot read ${path}: expected a regular file`, command);
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

// The tracked files of the repository holding `dir` that name `needle`, as absolute paths;
// none when `dir` is not in a Git work tree.
function trackedFilesNaming(dir, needle) {
  const options = { cwd: dir, encoding: "utf8", shell: false };
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], options);
  if (top.status !== 0) return [];
  const root = top.stdout.trim();
  const found = spawnSync("git", ["grep", "-l", "-z", "-F", "-e", needle], { ...options, cwd: root });
  // `git grep` exits 1 when nothing matches.
  if (found.status !== 0) return [];
  return found.stdout.split("\0").filter(Boolean).map((path) => join(root, path));
}

function renumber(path, kind) {
  const oldName = basename(path);
  if (!RECORD_NAME_RE.test(oldName)) {
    failRecord(`${oldName} is not a numbered record name (NNNN-slug.md)`, "renumber");
    return;
  }
  const content = readRecord(path, "renumber");
  if (content === null) return;
  try {
    parseRecordHeader(content, kind);
  } catch (error) {
    failRecord(`${path}: ${error.message}`, "renumber");
    return;
  }
  const dir = dirname(resolve(path));
  const newName = nextRecordName(readdirSync(dir), oldName);
  const oldPath = join(dir, oldName);
  const newPath = join(dir, newName);
  const oldStem = oldName.replace(/\.md$/, "");
  const here = realpathSync(process.cwd());
  const shown = (absolute) => relative(here, join(realpathSync(dirname(absolute)), basename(absolute)));
  // Git reports real paths, so the record itself is recognised by its real path: rewriting it
  // after the unlink below would bring the old name back.
  const oldReal = realpathSync(oldPath);
  const references = trackedFilesNaming(dir, oldStem).filter((file) => realpathSync(file) !== oldReal);
  const fromShown = shown(oldPath);
  try {
    writeFileSync(newPath, renumberRecordContent(content, oldName, newName));
    unlinkSync(oldPath);
    for (const file of references) {
      writeFileSync(file, readFileSync(file, "utf8").replaceAll(oldStem, newName.replace(/\.md$/, "")));
    }
  } catch (error) {
    failIo(`cannot renumber ${path}: ${error.message}`, "renumber");
    return;
  }
  const staged = [fromShown, shown(newPath), ...references.map(shown)];
  write([
    "status: renumbered",
    `from: ${fromShown}`,
    `to: ${shown(newPath)}`,
    ...staged.map((file) => `stage: ${file}`),
    `next: ${quote(`git add -- ${staged.join(" ")}, commit, and rerun the gate; a mention of number ${oldName.match(RECORD_NAME_RE)[1]} without the name ${oldStem} stays as written, since it may name another record`)}`,
  ]);
}

const input = parseArguments(process.argv.slice(2));
if (input.usageError) {
  failUsage(input.usageError, input.command);
} else if (input.help) {
  emitHelp(input.command);
} else if (input.command === "validate" && !/^\d/.test(basename(input.path))) {
  // Only numbered files are records. A README or a file gathering several records under one
  // theme is the repository's own prose, and an error here sent agents rewriting it.
  write([
    "status: skipped",
    `reason: ${quote(`${basename(input.path)} does not start with digits, so it is not a numbered record`)}`,
  ]);
} else if (input.command === "renumber") {
  renumber(input.path, input.kind);
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
