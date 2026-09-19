import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLAUDE_MARKER = 'adapters/claude-code/gsd-context.mjs';
const CODEX_MARKER = 'adapters/codex/gsd-context.mjs';
const CODEX_AGENTS_START = '<!-- gsd:codex-adapter -->';
const CODEX_AGENTS_END = '<!-- /gsd:codex-adapter -->';

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (raw.trim() === '') return {};
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${filePath}: expected a JSON object`);
  }
  return value;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.gsd-tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, filePath);
}

function removeGsdHookGroups(document, marker) {
  let changed = false;
  if (!document || typeof document !== 'object' || !document.hooks) return false;
  const hooks = { ...document.hooks };
  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue;
    const kept = hooks[event].filter((group) => {
      const handlers = Array.isArray(group?.hooks) ? group.hooks : [];
      return !handlers.some((handler) => handler?.command?.includes?.(marker));
    });
    if (kept.length === hooks[event].length) continue;
    changed = true;
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  if (!changed) return false;
  if (Object.keys(hooks).length === 0) delete document.hooks;
  else document.hooks = hooks;
  return true;
}

function isManagedLink(target, sourceRoot) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return false;
  }
  if (!stat.isSymbolicLink()) return false;
  let resolved;
  try {
    resolved = path.resolve(path.dirname(target), fs.readlinkSync(target));
  } catch {
    return false;
  }
  const realSourceRoot = fs.realpathSync(sourceRoot);
  return (
    path.dirname(resolved) === realSourceRoot && path.basename(resolved) === path.basename(target)
  );
}

function removeManagedLinks(directory, sourceRoot) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (isManagedLink(target, sourceRoot)) fs.unlinkSync(target);
  }
}

function removeManagedAgentsSection(filePath) {
  if (!fs.existsSync(filePath)) return;
  const existing = fs.readFileSync(filePath, 'utf8');
  const start = existing.indexOf(CODEX_AGENTS_START);
  const end = existing.indexOf(CODEX_AGENTS_END);
  if (start === -1 || end === -1) return;
  if (end < start) throw new Error(`${filePath}: unbalanced GSD managed section markers`);
  let prefix = existing.slice(0, start);
  if (prefix.endsWith('\n\n')) prefix = prefix.slice(0, -1);
  let suffix = existing.slice(end + CODEX_AGENTS_END.length);
  if (prefix.endsWith('\n') && suffix.startsWith('\n')) suffix = suffix.slice(1);
  const next = prefix + suffix;
  fs.writeFileSync(filePath, next);
}

function uninstallClaudeLegacy(root, configDir) {
  const settingsPath = path.join(configDir, 'settings.json');
  const settings = readJson(settingsPath);
  if (settings && removeGsdHookGroups(settings, CLAUDE_MARKER)) {
    writeJsonAtomic(settingsPath, settings);
  }
  removeManagedLinks(path.join(configDir, 'skills'), path.join(root, 'skills'));
  removeManagedLinks(
    path.join(configDir, 'agents'),
    path.join(root, 'adapters', 'claude-code', 'agents'),
  );
}

function uninstallCodexLegacy(root, configDir, skillsDir) {
  const hooksPath = path.join(configDir, 'hooks.json');
  const hooks = readJson(hooksPath);
  if (hooks && removeGsdHookGroups(hooks, CODEX_MARKER)) {
    writeJsonAtomic(hooksPath, hooks);
  }
  removeManagedAgentsSection(path.join(configDir, 'AGENTS.md'));
  removeManagedLinks(skillsDir, path.join(root, 'skills'));
  removeManagedLinks(
    path.join(configDir, 'agents'),
    path.join(root, 'adapters', 'codex', 'agents'),
  );
}

function removeResolvedLink(target, expectedSource) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return;
  }
  if (!stat.isSymbolicLink()) return;
  let resolved;
  try {
    resolved = path.resolve(path.dirname(target), fs.readlinkSync(target));
  } catch {
    return;
  }
  if (resolved === expectedSource) fs.unlinkSync(target);
}

function uninstallOmpLegacy(root, env) {
  const configured = env.PI_CODING_AGENT_DIR;
  if (configured && !path.isAbsolute(configured)) {
    throw new Error('PI_CODING_AGENT_DIR must be absolute for GSD uninstall');
  }
  const agentDir = configured ?? path.join(env.HOME ?? os.homedir(), '.omp', 'agent');
  removeResolvedLink(
    path.join(agentDir, 'extensions', 'gsd-context.js'),
    path.join(root, 'extensions', 'gsd-context.js'),
  );
  for (const name of ['gsd-executor.md', 'gsd-reviewer.md']) {
    removeResolvedLink(path.join(agentDir, 'agents', name), path.join(root, 'agents', name));
  }
  removeManagedLinks(
    path.join(env.HOME ?? os.homedir(), '.agents', 'skills'),
    path.join(root, 'skills'),
  );
}

export function uninstallLegacyAgent(agent, root, env = process.env) {
  if (agent === 'claude-code') {
    const configDir = env.CLAUDE_CONFIG_DIR ?? path.join(env.HOME ?? os.homedir(), '.claude');
    uninstallClaudeLegacy(root, configDir);
    return;
  }
  if (agent === 'codex') {
    const configDir = env.CODEX_HOME ?? path.join(env.HOME ?? os.homedir(), '.codex');
    const skillsDir = env.CODEX_SKILLS_DIR ?? path.join(env.HOME ?? os.homedir(), '.agents', 'skills');
    uninstallCodexLegacy(root, configDir, skillsDir);
    return;
  }
  if (agent === 'omp') {
    uninstallOmpLegacy(root, env);
    return;
  }
  throw new Error(`unknown agent: ${agent}`);
}
