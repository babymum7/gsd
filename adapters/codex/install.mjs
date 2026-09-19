#!/usr/bin/env node
// Codex adapter installer. It publishes GSD's skills into the Codex skills directory
// and registers the lifecycle hooks that deliver the shared bootstrap and recovery
// capsule. Host-specific by design; see adapters/README.md.
//
// Usage:
//   bun adapters/codex/install.mjs [--config-dir <path>] [--skills-dir <path>] [--dry-run]
//
// The config directory defaults to $CODEX_HOME, then ~/.codex. Every write is atomic
// and idempotent; a conflicting non-GSD skill entry fails closed. The installer never
// edits config.toml, so an explicit `[features] hooks = false` (or the deprecated
// `codex_hooks = false` alias) there is reported as advisory.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverSkillCatalog } from '../../lib/gsd-bootstrap.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const GSD_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const HOOK_PATH = path.join(SCRIPT_DIR, 'gsd-context.mjs');
const HOOK_MARKER = 'adapters/codex/gsd-context.mjs';
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit'];
// Codex spills additionalContext larger than its per-handler budget into a saved
// file plus a head-and-tail preview, which would truncate the bootstrap or capsule.
// The rendered bootstrap sits near the 2,500-token default, so pin a budget above
// the worst case (bootstrap, or capsule plus current request) to deliver it whole.
const ADDITIONAL_CONTEXT_LIMIT = 6000;

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

function mergeHooks(document) {
  const merged = { ...document };
  const hooks = { ...(document.hooks ?? {}) };
  for (const event of HOOK_EVENTS) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
    const kept = existing.filter((group) => !isGsdGroup(group));
    kept.push({
      hooks: [
        { type: 'command', command: hookCommand(), additionalContextLimit: ADDITIONAL_CONTEXT_LIMIT },
      ],
    });
    hooks[event] = kept;
  }
  merged.hooks = hooks;
  return merged;
}

function readHooks(hooksPath) {
  if (!fs.existsSync(hooksPath)) return {};
  const raw = fs.readFileSync(hooksPath, 'utf8');
  if (raw.trim() === '') return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${hooksPath}: hooks.json must contain a JSON object`);
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

const AGENTS_MD_START = '<!-- gsd:codex-adapter -->';
const AGENTS_MD_END = '<!-- /gsd:codex-adapter -->';
const AGENTS_MD_SECTION = `${AGENTS_MD_START}
## GSD

GSD injects a session bootstrap and a compaction recovery capsule through Codex
hooks. When that injected text is present, follow its routing and continuity rules:
load the exact skill file it names, keep one process owner, and treat canonical
artifacts as the only authority. The bootstrap arrives as developer context, so no
separate skill invocation is needed.

Codex plan mode and Goal mode are affordances, not authority: recommend \`/plan\` to
shape a multi-step change and \`/goal\` for long milestone work, and keep \`plan.md\`,
the milestone ledger, and the deterministic gates as the only definition of done.
${AGENTS_MD_END}`;

function upsertAgentsMd(agentsMdPath) {
  let existing = '';
  try {
    existing = fs.readFileSync(agentsMdPath, 'utf8');
  } catch {
    existing = '';
  }
  const startIndex = existing.indexOf(AGENTS_MD_START);
  const endIndex = existing.indexOf(AGENTS_MD_END);
  if ((startIndex === -1) !== (endIndex === -1)) {
    throw new Error(`${agentsMdPath}: unbalanced GSD managed section markers`);
  }
  let next;
  if (startIndex !== -1) {
    next = existing.slice(0, startIndex) + AGENTS_MD_SECTION + existing.slice(endIndex + AGENTS_MD_END.length);
  } else {
    const trimmed = existing.replace(/\s*$/, '');
    next = trimmed === '' ? `${AGENTS_MD_SECTION}\n` : `${trimmed}\n\n${AGENTS_MD_SECTION}\n`;
  }
  return next;
}

function hooksDisabled(configTomlPath) {
  try {
    const text = fs.readFileSync(configTomlPath, 'utf8');
    // Codex disables hooks with `[features] hooks = false`; `codex_hooks` is the
    // documented deprecated alias for the same key.
    return /^\s*(?:hooks|codex_hooks)\s*=\s*false\s*$/m.test(text);
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const options = { configDir: null, skillsDir: null, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config-dir') {
      options.configDir = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === '--skills-dir') {
      options.skillsDir = argv[i + 1] ?? null;
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

const HELP = `GSD Codex adapter installer

Usage:
  bun adapters/codex/install.mjs [--config-dir <path>] [--skills-dir <path>] [--dry-run]

Options:
  --config-dir <path>  Codex config directory for hooks, agents, and AGENTS.md
                       (default: $CODEX_HOME then ~/.codex)
  --skills-dir <path>  User skill directory Codex scans (default: ~/.agents/skills)
  --dry-run            Print the planned hooks and skill links without writing anything
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
    options.configDir || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const hooksPath = path.join(configDir, 'hooks.json');
  // Codex scans user skills at ~/.agents/skills, not under $CODEX_HOME.
  const skillsDir = options.skillsDir || path.join(os.homedir(), '.agents', 'skills');

  try {
    const merged = mergeHooks(readHooks(hooksPath));
    const planned = JSON.stringify(merged, null, 2).concat('\n');
    if (options.dryRun) {
      process.stdout.write(`hooks.json (${hooksPath}):\n${planned}`);
      process.stdout.write(`skills: ${skillsDir}\n`);
      process.stdout.write(`agents: ${path.join(configDir, 'agents')}\n`);
      process.stdout.write(`AGENTS.md: ${path.join(configDir, 'AGENTS.md')}\n`);
      return;
    }
    writeFileAtomic(hooksPath, planned);
    const { linked, removed } = linkSkills(skillsDir, false);
    const linkedAgents = linkAgents(path.join(configDir, 'agents'), false);
    writeFileAtomic(path.join(configDir, 'AGENTS.md'), upsertAgentsMd(path.join(configDir, 'AGENTS.md')));
    process.stdout.write(`hooks: ${hooksPath}\n`);
    process.stdout.write(`hook script: ${HOOK_PATH}\n`);
    const skillParts = [];
    if (linked.length > 0) skillParts.push(`linked ${linked.join(', ')}`);
    if (removed.length > 0) skillParts.push(`removed ${removed.join(', ')}`);
    process.stdout.write(`skills: ${skillParts.length > 0 ? skillParts.join('; ') : 'already linked'}\n`);
    process.stdout.write(
      `agents: ${linkedAgents.length > 0 ? `linked ${linkedAgents.join(', ')}` : 'already linked'}\n`,
    );
    process.stdout.write(`AGENTS.md: ${path.join(configDir, 'AGENTS.md')}\n`);
    if (hooksDisabled(path.join(configDir, 'config.toml'))) {
      process.stdout.write(
        `notice: ${path.join(configDir, 'config.toml')} sets [features] hooks = false; enable hooks for GSD to inject context.\n`,
      );
    }
    process.stdout.write('notice: Codex may ask you to trust the new hooks on first run.\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

main();
