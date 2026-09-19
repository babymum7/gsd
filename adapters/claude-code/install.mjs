#!/usr/bin/env node
// Claude Code adapter installer. It publishes GSD's skills into the Claude Code
// skills directory and registers the lifecycle hooks that deliver the shared
// bootstrap and recovery capsule. Host-specific by design; see adapters/README.md.
//
// Usage:
//   bun adapters/claude-code/install.mjs [--config-dir <path>] [--dry-run]
//
// The config directory defaults to $CLAUDE_CONFIG_DIR, then ~/.claude. Every write
// is atomic and idempotent; a conflicting non-GSD skill entry fails closed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverSkillCatalog } from '../../lib/gsd-bootstrap.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const GSD_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const HOOK_PATH = path.join(SCRIPT_DIR, 'gsd-context.mjs');
const HOOK_MARKER = 'adapters/claude-code/gsd-context.mjs';
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit'];

function findOnPath(binary) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, binary);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

function hookCommand() {
  const runtime = findOnPath('bun') ?? findOnPath('node') ?? 'node';
  return `${runtime} "${HOOK_PATH}"`;
}

function isGsdGroup(group) {
  return (
    group &&
    Array.isArray(group.hooks) &&
    group.hooks.some(
      (handler) => typeof handler?.command === 'string' && handler.command.includes(HOOK_MARKER),
    )
  );
}

function mergeSettings(settings) {
  const hooks = { ...(settings.hooks ?? {}) };
  // Drop our managed group from every event first, so an event a previous install
  // registered but this version no longer uses (PreCompact, once capsule delivery
  // moved to the host-native SessionStart `compact` source) does not linger.
  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue;
    const kept = hooks[event].filter((group) => !isGsdGroup(group));
    if (kept.length === hooks[event].length) continue;
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  for (const event of HOOK_EVENTS) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
    hooks[event] = [...existing, { hooks: [{ type: 'command', command: hookCommand() }] }];
  }
  return { ...settings, hooks };
}

function readSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return {};
  const raw = fs.readFileSync(settingsPath, 'utf8');
  if (raw.trim() === '') return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${settingsPath}: settings.json must contain a JSON object`);
  }
  return parsed;
}

function writeFileAtomic(target, contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.gsd-tmp-${process.pid}`;
  fs.writeFileSync(temp, contents);
  fs.renameSync(temp, target);
}

function linkSkills(skillsDir, dryRun) {
  const linked = [];
  const removed = [];
  // Publish only the visible catalog; hidden skills (the gsd master and gsd-ponytail)
  // stay host-internal and must never appear in a host's user-facing skill list.
  const names = discoverSkillCatalog(GSD_ROOT)
    .map((row) => row.name)
    .sort();
  const visible = new Set(names);
  removeStaleManagedLinks(skillsDir, visible, dryRun, removed);
  for (const name of names) {
    const source = path.join(GSD_ROOT, 'skills', name);
    const target = path.join(skillsDir, name);
    let targetStat = null;
    try {
      targetStat = fs.lstatSync(target);
    } catch {
      targetStat = null;
    }
    if (targetStat) {
      const isManagedLink =
        targetStat.isSymbolicLink() && fs.realpathSync(target) === fs.realpathSync(source);
      if (!isManagedLink) {
        throw new Error(`${target}: exists and is not a GSD-managed link; refusing to overwrite`);
      }
      continue;
    }
    if (!dryRun) {
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.symlinkSync(source, target, 'dir');
    }
    linked.push(name);
  }
  return { linked, removed };
}

// Drop managed links whose canonical source is no longer published (for example the
// hidden skills an earlier install exposed). Only symlinks that resolve to a same-named
// directory directly under our own skills root are touched, so user links are untouched.
function removeStaleManagedLinks(skillsDir, visible, dryRun, removed) {
  let entries;
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return;
  }
  const realSkillsRoot = fs.realpathSync(path.join(GSD_ROOT, 'skills'));
  for (const entry of entries) {
    if (visible.has(entry.name)) continue;
    const target = path.join(skillsDir, entry.name);
    let targetStat;
    try {
      targetStat = fs.lstatSync(target);
    } catch {
      continue;
    }
    if (!targetStat.isSymbolicLink()) continue;
    let resolved;
    try {
      resolved = fs.realpathSync(target);
    } catch {
      continue;
    }
    if (path.dirname(resolved) !== realSkillsRoot) continue;
    if (path.basename(resolved) !== entry.name) continue;
    if (!dryRun) fs.unlinkSync(target);
    removed.push(entry.name);
  }
}

function linkAgents(agentsDir, dryRun) {
  const sourceDir = path.join(SCRIPT_DIR, 'agents');
  let entries;
  try {
    entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const linked = [];
  for (const name of entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()) {
    const source = path.join(sourceDir, name);
    const target = path.join(agentsDir, name);
    let targetStat = null;
    try {
      targetStat = fs.lstatSync(target);
    } catch {
      targetStat = null;
    }
    if (targetStat) {
      const isManagedLink =
        targetStat.isSymbolicLink() && fs.realpathSync(target) === fs.realpathSync(source);
      if (!isManagedLink) {
        throw new Error(`${target}: exists and is not a GSD-managed link; refusing to overwrite`);
      }
      continue;
    }
    if (!dryRun) {
      fs.mkdirSync(agentsDir, { recursive: true });
      fs.symlinkSync(source, target, 'file');
    }
    linked.push(name);
  }
  return linked;
}

function parseArgs(argv) {
  const options = { configDir: null, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config-dir') {
      options.configDir = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

const HELP = `GSD Claude Code adapter installer

Usage:
  bun adapters/claude-code/install.mjs [--config-dir <path>] [--dry-run]

Options:
  --config-dir <path>  Claude Code config directory (default: $CLAUDE_CONFIG_DIR then ~/.claude)
  --dry-run            Print the planned settings and skill links without writing anything
  -h, --help           Show this help
`;

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  const configDir =
    options.configDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const settingsPath = path.join(configDir, 'settings.json');
  const skillsDir = path.join(configDir, 'skills');

  try {
    const merged = mergeSettings(readSettings(settingsPath));
    const planned = JSON.stringify(merged, null, 2).concat('\n');
    if (options.dryRun) {
      process.stdout.write(`settings.json (${settingsPath}):\n${planned}`);
      process.stdout.write(`skills: ${skillsDir}\n`);
      process.stdout.write(`agents: ${path.join(configDir, 'agents')}\n`);
      return;
    }
    writeFileAtomic(settingsPath, planned);
    const { linked, removed } = linkSkills(skillsDir, false);
    const linkedAgents = linkAgents(path.join(configDir, 'agents'), false);
    process.stdout.write(`settings: ${settingsPath}\n`);
    process.stdout.write(`hook: ${HOOK_PATH}\n`);
    const skillParts = [];
    if (linked.length > 0) skillParts.push(`linked ${linked.join(', ')}`);
    if (removed.length > 0) skillParts.push(`removed ${removed.join(', ')}`);
    process.stdout.write(`skills: ${skillParts.length > 0 ? skillParts.join('; ') : 'already linked'}\n`);
    process.stdout.write(
      `agents: ${linkedAgents.length > 0 ? `linked ${linkedAgents.join(', ')}` : 'already linked'}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

main();
