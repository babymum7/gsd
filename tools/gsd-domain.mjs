#!/usr/bin/env bun
// Domain model Markdown contract validator. The index/shard/AGENTS schemas in
// skills/gsd-domain-modeling/SKILL.md § Markdown contracts were prose-enforced, so a session
// could silently ship a malformed index, an orphaned shard, or a duplicate AGENTS section.
// This tool parses the canonical grammar and proves the whole domain model is consistent and
// complete before a session returns its changed paths.
import { lstatSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeDomainIndex,
  normalizeDomainScope,
  parseAgentsDomainSection,
  parseDomainIndex,
  parseDomainScope,
} from "../lib/gsd-domain.mjs";
import {
  MAX_LISTED_ERRORS,
  commandsOf,
  errorRows,
  invocationOf,
  quote,
  unknownCommandMessage,
} from "../lib/gsd-commands.mjs";

const COMMANDS = commandsOf("gsd-domain.mjs");
const VALUE_FLAGS = new Set(["--index", "--agents", "--scope"]);

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const INVOCATION = invocationOf(SCRIPT_PATH);

function write(lines) {
  process.stdout.write(lines.join("\n"));
}

function commandUsage() {
  return [
    `${INVOCATION} validate --index docs/domain/index.md [--agents AGENTS.md] [--scope <scope>]...`,
    `${INVOCATION} normalize --index docs/domain/index.md [--write] [--scope <scope>]...`,
  ].join("\n");
}

const NORMALIZE_HELP = `run ${INVOCATION} normalize --index docs/domain/index.md --write, then validate again`;
// The section rejection also covers a missing or extra section, which normalize cannot fix.
const SECTION_HELP = `add a missing section or remove an extra one by hand, then ${NORMALIZE_HELP}`;
const ORDER_ERROR_RE = /must be sorted|lexicographically sorted/;
const SECTION_ERROR_RE = /sections must appear exactly in order/;

function emitHelp() {
  write([
    "Usage:",
    commandUsage(),
    "",
    "Commands:",
    "  validate  Parse the index, every mapped shard, and the AGENTS.md section; exit 0",
    "            reports a complete, sorted, well-formed domain model, exit 1 reports",
    "            a malformed or inconsistent model. Never writes.",
    "  normalize Propose canonical order for Scope rows, Terms rows, and shard sections;",
    "            writes the fixes only with --write, otherwise only prints them.",
    "",
    "Flags:",
    "  --index   Path to docs/domain/index.md. Shards resolve beside it.",
    "  --agents  Path to AGENTS.md; optional, validates its documentation sections.",
    "  --write   normalize only: rewrite the changed files instead of only printing the fixes.",
    "  --scope   Repeatable: parse and normalize only these index scopes; the other shards",
    "            are only checked to exist, so a feature leaves unrelated contexts alone.",
  ]);
  process.exitCode = 0;
}

function failUsage(message) {
  write(errorRows("usage", message, commandUsage()));
  process.exitCode = 2;
}

function domainHelp(message) {
  if (SECTION_ERROR_RE.test(message)) return SECTION_HELP;
  if (ORDER_ERROR_RE.test(message)) return NORMALIZE_HELP;
  return commandUsage();
}

// Every failing file is listed in one run, numbered from 2 as gsd-contract does, so one
// pass fixes them all.
function failDomain(...messages) {
  const [first, ...more] = messages;
  const rows = errorRows("invalid-domain", first, domainHelp(first));
  more.slice(0, MAX_LISTED_ERRORS - 1).forEach((message, index) => {
    rows.push(`error_${index + 2}: ${quote(message)}`);
    rows.push(`help_${index + 2}: ${quote(domainHelp(message))}`);
  });
  if (more.length > 0) rows.push(`errors: ${messages.length}`);
  write(rows);
  process.exitCode = 1;
}

function failIo(message) {
  write(errorRows("io-error", message, commandUsage()));
  process.exitCode = 1;
}

function parseArguments(argv) {
  const [command, ...args] = argv;
  if (args.length === 0 && (command === "--help" || command === "-h")) return { command: null, help: true };
  if (!command) return { usageError: "a domain command is required" };
  if (!COMMANDS.has(command)) return { usageError: unknownCommandMessage("gsd-domain.mjs", command) };
  if (args.length === 1 && args[0] === "--help") return { command, help: true };

  let index = null;
  let agents = null;
  let writeFlag = false;
  const scopes = [];
  for (let position = 0; position < args.length; position += 1) {
    const flag = args[position];
    if (flag === "--write") {
      if (command !== "normalize") return { usageError: "--write is only valid with normalize", command };
      if (writeFlag) return { usageError: "--write may be supplied only once", command };
      writeFlag = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) {
      return { usageError: `unknown argument: ${flag}`, command };
    }
    const value = args[position + 1];
    if (value === undefined || value.startsWith("--")) {
      return { usageError: `${flag} requires a value`, command };
    }
    position += 1;
    if (flag === "--scope") {
      if (!scopes.includes(value)) scopes.push(value);
    } else if (flag === "--index") {
      if (index !== null) return { usageError: "--index may be supplied only once", command };
      index = value;
    } else {
      if (command === "normalize") return { usageError: "--agents is only valid with validate", command };
      if (agents !== null) return { usageError: "--agents may be supplied only once", command };
      agents = value;
    }
  }

  if (index === null) return { usageError: "--index is required", command };
  return { command, index, agents, write: writeFlag, scopes };
}

function readText(pathLike, command) {
  try {
    return readFileSync(pathLike, "utf8");
  } catch (error) {
    failIo(`cannot read ${pathLike}: ${error.message}`, command);
    return null;
  }
}

// A --scope naming no index row is a typo that would otherwise check nothing.
function selectScopes(parsed, scopes, index) {
  const known = new Set(parsed.scopes.map((entry) => entry.scope));
  const unknown = scopes.filter((scope) => !known.has(scope));
  if (unknown.length > 0) {
    failDomain(`${index} has no scope ${unknown.join(", ")}; known scopes: ${[...known].join(", ")}`);
    return null;
  }
  return scopes.length === 0 ? known : new Set(scopes);
}

function runValidate({ index, agents, scopes, command }) {
  const indexContent = readText(index, command);
  if (indexContent === null) return;
  let parsed;
  try {
    parsed = parseDomainIndex(indexContent);
  } catch (error) {
    failDomain(`${index}: ${error.message}`);
    return;
  }
  const selected = selectScopes(parsed, scopes, index);
  if (selected === null) return;
  const errors = [];
  const directory = path.dirname(index);
  const mapped = new Set(parsed.scopes.map((entry) => entry.file));
  for (const { scope, file } of parsed.scopes) {
    const shardPath = path.join(directory, file);
    const shardContent = readText(shardPath, command);
    if (shardContent === null) return;
    if (!selected.has(scope)) continue;
    try {
      parseDomainScope(shardContent, scope);
    } catch (error) {
      errors.push(`${shardPath}: ${error.message}`);
    }
  }
  let orphans;
  try {
    orphans = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== path.basename(index))
      .map((entry) => entry.name)
      .filter((name) => !mapped.has(name))
      .sort();
  } catch (error) {
    failIo(`cannot list ${directory}: ${error.message}`, command);
    return;
  }
  if (orphans.length > 0) {
    errors.push(`orphan shard files without an index row: ${orphans.join(", ")}`);
  }
  let sections = null;
  if (agents !== null) {
    const agentsContent = readText(agents, command);
    if (agentsContent === null) return;
    try {
      sections = parseAgentsDomainSection(agentsContent);
    } catch (error) {
      errors.push(`${agents}: ${error.message}`);
    }
  }
  if (errors.length > 0) {
    failDomain(...errors);
    return;
  }
  const output = ["status: valid", `scopes: ${parsed.scopes.length}`];
  if (sections !== null) {
    output.push(`sections: ${Object.keys(sections).join(", ")}`);
  }
  write(output);
}

// Atomic replace: the temp file lives beside the target so the rename never crosses a device.
function writeAtomic(target, content) {
  const temp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, content, { flag: "wx" });
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function isSymlink(target) {
  try {
    return lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

function runNormalize({ index, write: shouldWrite, scopes, command }) {
  const indexContent = readText(index, command);
  if (indexContent === null) return;
  const normalizedIndex = normalizeDomainIndex(indexContent);
  let parsed;
  try {
    parsed = parseDomainIndex(normalizedIndex.content);
  } catch (error) {
    failDomain(`${index}: ${error.message}`);
    return;
  }
  const selected = selectScopes(parsed, scopes, index);
  if (selected === null) return;
  const changes = [];
  if (normalizedIndex.fixes.length > 0) {
    changes.push({ file: index, content: normalizedIndex.content, fixes: normalizedIndex.fixes });
  }
  const directory = path.dirname(index);
  for (const { scope, file } of parsed.scopes) {
    if (!selected.has(scope)) continue;
    const shardPath = path.join(directory, file);
    const shardContent = readText(shardPath, command);
    if (shardContent === null) return;
    const normalized = normalizeDomainScope(shardContent, scope);
    if (normalized.fixes.length > 0) {
      changes.push({ file: shardPath, content: normalized.content, fixes: normalized.fixes });
    }
  }
  if (shouldWrite) {
    for (const change of changes) {
      if (isSymlink(change.file)) {
        failIo(`refusing to write through symlink ${change.file}`, command);
        return;
      }
    }
    for (const change of changes) {
      try {
        writeAtomic(change.file, change.content);
      } catch (error) {
        failIo(`cannot write ${change.file}: ${error.message}`, command);
        return;
      }
    }
  }
  const output = ["status: ok"];
  for (const change of changes) {
    for (const fix of change.fixes) output.push(`fix: ${change.file}: ${fix.type} ${fix.detail}`);
  }
  if (changes.length === 0) output.push("fixes: none");
  else output.push(`written: ${shouldWrite ? changes.length : 0}`);
  write(output);
}

const input = parseArguments(process.argv.slice(2));
if (input.usageError) {
  failUsage(input.usageError);
} else if (input.help) {
  emitHelp();
} else if (input.command === "normalize") {
  runNormalize(input);
} else {
  runValidate(input);
}
