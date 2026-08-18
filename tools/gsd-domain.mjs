#!/usr/bin/env node
// Domain model Markdown contract validator. The index/shard/AGENTS schemas in
// skills/gsd-domain-modeling/SKILL.md § Markdown contracts were prose-enforced, so a session
// could silently ship a malformed index, an orphaned shard, or a duplicate AGENTS section.
// This tool parses the canonical grammar and proves the whole domain model is consistent and
// complete before a session returns its changed paths.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseAgentsDomainSection,
  parseDomainIndex,
  parseDomainScope,
} from "../lib/gsd-domain.mjs";

const COMMANDS = new Set(["validate"]);
const VALUE_FLAGS = new Set(["--index", "--agents"]);

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const INVOCATION = `node ${JSON.stringify(SCRIPT_PATH)}`;

function quote(value) {
  return JSON.stringify(String(value));
}

function write(lines) {
  process.stdout.write(lines.join("\n"));
}

function commandUsage() {
  return `${INVOCATION} validate --index docs/domain/index.md [--agents AGENTS.md]`;
}

function emitHelp() {
  write([
    "Usage:",
    commandUsage(),
    "",
    "Commands:",
    "  validate  Parse the index, every mapped shard, and the AGENTS.md section; exit 0",
    "            reports a complete, sorted, well-formed domain model, exit 1 reports",
    "            a malformed or inconsistent model.",
    "",
    "Flags:",
    "  --index   Path to docs/domain/index.md. Shards resolve beside it.",
    "  --agents  Path to AGENTS.md; optional, validates its documentation sections.",
  ]);
  process.exitCode = 0;
}

function failUsage(message) {
  write(["status: error", "code: usage", `error: ${quote(message)}`, `help: ${quote(commandUsage())}`]);
  process.exitCode = 2;
}

function failDomain(message) {
  write(["status: error", "code: invalid-domain", `error: ${quote(message)}`, `help: ${quote(commandUsage())}`]);
  process.exitCode = 1;
}

function failIo(message) {
  write(["status: error", "code: io-error", `error: ${quote(message)}`, `help: ${quote(commandUsage())}`]);
  process.exitCode = 1;
}

function parseArguments(argv) {
  const [command, ...args] = argv;
  if (!command) return { usageError: "a domain command is required" };
  if (!COMMANDS.has(command)) return { usageError: `unknown command: ${command}` };
  if (args.length === 1 && args[0] === "--help") return { command, help: true };

  let index = null;
  let agents = null;
  for (let position = 0; position < args.length; position += 1) {
    const flag = args[position];
    if (!VALUE_FLAGS.has(flag)) {
      return { usageError: `unknown argument: ${flag}`, command };
    }
    const value = args[position + 1];
    if (value === undefined || value.startsWith("--")) {
      return { usageError: `${flag} requires a value`, command };
    }
    position += 1;
    if (flag === "--index") {
      if (index !== null) return { usageError: "--index may be supplied only once", command };
      index = value;
    } else {
      if (agents !== null) return { usageError: "--agents may be supplied only once", command };
      agents = value;
    }
  }

  if (index === null) return { usageError: "--index is required", command };
  return { command, index, agents };
}

function readText(pathLike, command) {
  try {
    return readFileSync(pathLike, "utf8");
  } catch (error) {
    failIo(`cannot read ${pathLike}: ${error.message}`, command);
    return null;
  }
}

function runValidate({ index, agents, command }) {
  const indexContent = readText(index, command);
  if (indexContent === null) return;
  let parsed;
  try {
    parsed = parseDomainIndex(indexContent);
  } catch (error) {
    failDomain(`${index}: ${error.message}`);
    return;
  }
  const directory = path.dirname(index);
  const mapped = new Set(parsed.scopes.map((entry) => entry.file));
  for (const { scope, file } of parsed.scopes) {
    const shardPath = path.join(directory, file);
    const shardContent = readText(shardPath, command);
    if (shardContent === null) return;
    try {
      parseDomainScope(shardContent, scope);
    } catch (error) {
      failDomain(`${shardPath}: ${error.message}`);
      return;
    }
  }
  let orphans;
  try {
    orphans = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md")
      .map((entry) => entry.name)
      .filter((name) => !mapped.has(name))
      .sort();
  } catch (error) {
    failIo(`cannot list ${directory}: ${error.message}`, command);
    return;
  }
  if (orphans.length > 0) {
    failDomain(`orphan shard files without an index row: ${orphans.join(", ")}`);
    return;
  }
  let sections = null;
  if (agents !== null) {
    const agentsContent = readText(agents, command);
    if (agentsContent === null) return;
    try {
      sections = parseAgentsDomainSection(agentsContent);
    } catch (error) {
      failDomain(`${agents}: ${error.message}`);
      return;
    }
  }
  const output = ["status: valid", `scopes: ${parsed.scopes.length}`];
  if (sections !== null) {
    output.push(`sections: ${Object.keys(sections).join(", ")}`);
  }
  write(output);
}

const input = parseArguments(process.argv.slice(2));
if (input.usageError) {
  failUsage(input.usageError);
} else if (input.help) {
  emitHelp();
} else {
  runValidate(input);
}
