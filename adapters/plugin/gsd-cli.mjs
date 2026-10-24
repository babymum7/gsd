import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  SETTINGS_PROFILES,
  SETTINGS_VERSION,
  parseSettingsKey,
  readSettings,
  resolveSettingsHome,
  settingsPath,
  writeSettings,
} from '../../lib/gsd-settings.mjs';
import { PLUGIN_BUNDLE_CONSTANTS, buildPluginBundle } from './gsd-plugin-packager.mjs';
import { removeSkillsDir, skillsDirNames, writeSkillsDir } from './gsd-skills-dir.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AGENTS = ['omp', 'claude', 'codex', 'dsh', 'opencode'];
// dsh is only an install agent: its `subagent` tool exposes no model unless the user turns
// `modelSelectionSettings` on, so it has no sub-agent profiles to configure. opencode is one
// too: its `subagent` tool steers callers away from setting a model.
const CONFIG_HOSTS = ['omp', 'claude', 'codex'];
const DSH_BEGIN = '# gsd:dsh-hooks begin';
const DSH_END = '# gsd:dsh-hooks end';
const DSH_ROW_ID = /^\s*(?:-\s+)?id:\s*["']?gsd["']?\s*(?:#.*)?$/;
const PLUGIN_SELECTOR = 'gsd@gsd-local';
const OPENCODE_MARKER = '.gsd-plugin';

const HELP = `GSD host plugin CLI

Usage:
  gsd install [--agent omp|claude|codex|dsh|opencode|all] [--home <path>] [--dry-run]
  gsd install --skills-dir <path> [--home <path>] [--dry-run]
  gsd uninstall [--agent omp|claude|codex|dsh|opencode|all] [--home <path>] [--dry-run]
  gsd uninstall --skills-dir <path> [--home <path>] [--dry-run]
  gsd config list [--home <path>]
  gsd config get <profile>.<host> [--home <path>]
  gsd config set <profile>.<host> <value> [--home <path>]

Config keys:
  profile  scout | worker
  host     claude | codex | omp
  value    an Agent tool model alias for claude (sonnet, opus, haiku, ...),
           a model id for codex, an agent name for omp

Options:
  --agent <name>  Agent to process (omit interactively)
  --skills-dir <path>
                  Skills-only install for a harness without a GSD adapter:
                  writes the visible skills plus a gsd router skill there
  --home <path>   GSD CLI home (default: ~/.gsd)
  --dry-run       Print planned commands without writing
  -h, --help      Show this help
`;

// The value after a flag. A missing value, an empty one, or another flag would otherwise be
// swallowed silently: `--skills-dir --dry-run` wrote a real directory named `--dry-run`.
function flagValue(argv, index, flag, noun) {
  const value = argv[index + 1];
  if (value === undefined || value === '' || value.startsWith('--')) {
    throw new Error(`${flag} requires ${noun}`);
  }
  return value;
}

// True only while a run still lacks the agent it needs: `--skills-dir` and help never take one.
export function needsAgentPrompt(argv) {
  return (
    (argv[0] === 'install' || argv[0] === 'uninstall') &&
    !argv.includes('--agent') &&
    !argv.includes('--skills-dir') &&
    !argv.includes('--help') &&
    !argv.includes('-h')
  );
}

function parseArgs(argv) {
  const first = argv[0];
  const parsed = {
    command: first === '--help' || first === '-h' ? null : (first ?? null),
    agent: null,
    skillsDir: null,
    home: null,
    dryRun: false,
    help: first === '--help' || first === '-h',
  };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--agent') {
      parsed.agent = flagValue(argv, i, arg, 'an agent name');
      i += 1;
    } else if (arg === '--skills-dir') {
      parsed.skillsDir = flagValue(argv, i, arg, 'a path');
      i += 1;
    } else if (arg === '--home') {
      parsed.home = flagValue(argv, i, arg, 'a path');
      i += 1;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function selectedAgents(agent) {
  if (agent === 'all') return AGENTS;
  if (AGENTS.includes(agent)) return [agent];
  throw new Error(`--agent must be one of: ${AGENTS.join(', ')}, all`);
}

function commandPlan(agent, home) {
  const marketplaceRoot = path.join(home, 'marketplace');
  const pluginRoot = path.join(marketplaceRoot, 'gsd');
  if (agent === 'omp') {
    return [{ binary: 'omp', args: ['plugin', 'link', pluginRoot] }];
  }
  if (agent === 'claude') {
    return [
      {
        binary: 'claude',
        args: ['plugin', 'marketplace', 'add', marketplaceRoot, '--scope', 'user'],
      },
      // Claude Code caches an installed plugin by version, and install and update both keep
      // that copy while the version is unchanged, so a rebuilt bundle would never reach it.
      // Removing the old install first forces a fresh copy. It comes after the marketplace
      // add so a failure there leaves the working plugin alone, and it is optional because a
      // first install has nothing to remove.
      {
        binary: 'claude',
        args: ['plugin', 'uninstall', PLUGIN_SELECTOR, '--scope', 'user', '--keep-data'],
        optional: true,
      },
      { binary: 'claude', args: ['plugin', 'install', PLUGIN_SELECTOR, '--scope', 'user'] },
    ];
  }
  return [
    { binary: 'codex', args: ['plugin', 'marketplace', 'add', marketplaceRoot] },
    { binary: 'codex', args: ['plugin', 'add', PLUGIN_SELECTOR] },
  ];
}

// Removing the plugin is optional: it may already be gone, removed by hand or by an earlier
// uninstall whose marketplace removal failed, and stopping there would make every retry fail.
function uninstallCommandPlan(agent) {
  if (agent === 'omp') {
    return [{ binary: 'omp', args: ['plugin', 'uninstall', 'gsd-core'] }];
  }
  if (agent === 'claude') {
    return [
      {
        binary: 'claude',
        args: ['plugin', 'uninstall', PLUGIN_SELECTOR, '--scope', 'user'],
        optional: true,
      },
      {
        binary: 'claude',
        args: ['plugin', 'marketplace', 'remove', 'gsd-local', '--scope', 'user'],
      },
    ];
  }
  return [
    { binary: 'codex', args: ['plugin', 'remove', PLUGIN_SELECTOR], optional: true },
    { binary: 'codex', args: ['plugin', 'marketplace', 'remove', 'gsd-local'] },
  ];
}

function runCommand(command, options) {
  const result = spawnSync(command.binary, command.args, {
    encoding: 'utf8',
    env: options.env,
  });
  if (result.error) {
    return {
      status: 1,
      stderr: `cannot run ${command.binary}: ${result.error.message}\n`,
      stdout: '',
    };
  }
  // A killed host has no exit status, and a null status would leave this process exiting 0.
  if (result.status === null) {
    return {
      status: 1,
      stdout: result.stdout ?? '',
      stderr: `${command.binary} ${command.args.join(' ')} was terminated by ${result.signal}\n`,
    };
  }
  if (result.status !== 0) {
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: `${result.stderr ?? ''}${result.stdout ?? ''}`,
    };
  }
  return { status: 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function readState(home) {
  const statePath = path.join(home, 'state.json');
  if (!fs.existsSync(statePath)) return { version: 1, agents: {} };
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (error) {
    throw new Error(`${statePath}: invalid GSD CLI state (${error.message})`);
  }
  if (state?.version !== 1 || typeof state.agents !== 'object' || state.agents === null) {
    throw new Error(`${statePath}: invalid GSD CLI state`);
  }
  return state;
}

function writeState(home, state) {
  fs.mkdirSync(home, { recursive: true });
  const statePath = path.join(home, 'state.json');
  const temp = `${statePath}.gsd-tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(temp, statePath);
}

function removeState(home) {
  fs.rmSync(path.join(home, 'state.json'), { force: true });
}

function removeMarketplace(home) {
  const marketplaceRoot = path.join(home, 'marketplace');
  if (!fs.existsSync(marketplaceRoot)) return;
  if (!fs.existsSync(path.join(marketplaceRoot, '.gsd-plugin-marketplace'))) {
    throw new Error(`${marketplaceRoot}: exists and is not a GSD-managed plugin marketplace`);
  }
  fs.rmSync(marketplaceRoot, { recursive: true, force: true });
}

function resolveHome(parsed) {
  return path.resolve(parsed.home || process.env.GSD_HOME || path.join(os.homedir(), '.gsd'));
}

// A skills directory is recorded beside the plugin agents because its skills point into the
// same bundle: the bundle is removed only after no plugin agent and no skills directory uses it.
function skillsStateKey(skillsDir) {
  return `skills:${skillsDir}`;
}

function runSkillsInstall(parsed) {
  const home = resolveHome(parsed);
  const skillsDir = path.resolve(parsed.skillsDir);
  const coreRoot = path.join(home, 'marketplace', PLUGIN_BUNDLE_CONSTANTS.PLUGIN_NAME, 'core');
  if (parsed.dryRun) {
    const lines = ['[skills]', ...skillsDirNames(ROOT).map((name) => `write ${path.join(skillsDir, name)}`)];
    return { status: 0, stdout: `${lines.join('\n')}\n`, stderr: '' };
  }
  buildPluginBundle(ROOT, path.join(home, 'marketplace'));
  writeSkillsDir(coreRoot, skillsDir);
  const state = readState(home);
  state.agents[skillsStateKey(skillsDir)] = 'skills';
  writeState(home, state);
  return { status: 0, stdout: `installed skills (${skillsDir})\n`, stderr: '' };
}

function runSkillsUninstall(parsed) {
  const home = resolveHome(parsed);
  const skillsDir = path.resolve(parsed.skillsDir);
  if (parsed.dryRun) return { status: 0, stdout: `[skills]\nremove GSD-managed skills in ${skillsDir}\n`, stderr: '' };
  removeSkillsDir(skillsDir);
  const state = readState(home);
  delete state.agents[skillsStateKey(skillsDir)];
  if (Object.keys(state.agents).length === 0) {
    removeState(home);
    removeMarketplace(home);
  } else writeState(home, state);
  return { status: 0, stdout: `uninstalled skills (${skillsDir})\n`, stderr: '' };
}

// dsh reads `$DSH_HOME`, falling back to `~/.dsh` when it is unset or blank.
function resolveDshHome(options) {
  const value = options.env?.DSH_HOME ?? process.env.DSH_HOME;
  return path.resolve(value && value.trim() !== '' ? value : path.join(os.homedir(), '.dsh'));
}

function dshPatchPath(dshHome) {
  return path.join(dshHome, 'cordis.patch.yml');
}

function dshHookBlock(home) {
  const pluginRoot = path.join(home, 'marketplace', PLUGIN_BUNDLE_CONSTANTS.PLUGIN_NAME);
  const modulePath = path.join(pluginRoot, 'adapters', 'dsh', 'gsd-context.mjs');
  // The GSD adapter is a native Cordis module that dsh loads by absolute path. A bare `- id:` row
  // edits an existing entry and fails as "entry not found"; a new row is inserted.
  return [
    DSH_BEGIN,
    '- insert:',
    `    - id: ${PLUGIN_BUNDLE_CONSTANTS.PLUGIN_NAME}`,
    `      name: ${JSON.stringify(modulePath)}`,
    DSH_END,
    '',
  ].join('\n');
}

// The marked block as byte offsets, from the begin marker line through the end marker line's
// newline. Null when the file has no begin marker; a begin without an end is refused.
function findDshBlock(text, patchPath) {
  const begin = text.startsWith(`${DSH_BEGIN}\n`) ? 0 : text.indexOf(`\n${DSH_BEGIN}\n`) + 1;
  if (begin === 0 && !text.startsWith(`${DSH_BEGIN}\n`)) return null;
  const endMarker = text.indexOf(`\n${DSH_END}`, begin);
  if (endMarker === -1) throw new Error(`${patchPath}: has a "${DSH_BEGIN}" marker without "${DSH_END}"`);
  const lineEnd = text.indexOf('\n', endMarker + 1);
  return { start: begin, end: lineEnd === -1 ? text.length : lineEnd + 1 };
}

function writeFileAtomic(filePath, content) {
  const temp = `${filePath}.gsd-tmp-${process.pid}`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, filePath);
}

// The patch text after install: an existing block is replaced in place, otherwise one is
// appended after a newline-terminated file. Refuses a `gsd` row outside the markers.
function withDshBlock(text, patchPath, block) {
  const found = findDshBlock(text, patchPath);
  const outside = found ? text.slice(0, found.start) + text.slice(found.end) : text;
  if (outside.split('\n').some((line) => DSH_ROW_ID.test(line))) {
    throw new Error(`${patchPath}: already has an "id: gsd" row outside the GSD markers`);
  }
  if (found) return text.slice(0, found.start) + block + text.slice(found.end);
  return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${block}`;
}

function withoutDshBlock(text, patchPath) {
  const found = findDshBlock(text, patchPath);
  return found ? text.slice(0, found.start) + text.slice(found.end) : text;
}

// Everything that can refuse a dsh install is checked here, before any host changes.
function prepareDshInstall(home, options) {
  const dshHome = resolveDshHome(options);
  const patchPath = dshPatchPath(dshHome);
  if (!fs.existsSync(dshHome) || !fs.statSync(dshHome).isDirectory()) {
    throw new Error(`${dshHome}: no DeepSeek Harness home; run dsh once first`);
  }
  const current = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, 'utf8') : '';
  return { dshHome, patchPath, patch: withDshBlock(current, patchPath, dshHookBlock(home)) };
}

function applyDshInstall(home, plan) {
  const coreRoot = path.join(home, 'marketplace', PLUGIN_BUNDLE_CONSTANTS.PLUGIN_NAME, 'core');
  // Skills refuse a foreign directory before writing anything, so they go before the patch.
  writeSkillsDir(coreRoot, path.join(plan.dshHome, 'skills'), { router: false });
  writeFileAtomic(plan.patchPath, plan.patch);
}

function runDshUninstall(options) {
  const dshHome = resolveDshHome(options);
  const patchPath = dshPatchPath(dshHome);
  if (fs.existsSync(patchPath)) {
    const patch = withoutDshBlock(fs.readFileSync(patchPath, 'utf8'), patchPath);
    if (patch === '') fs.rmSync(patchPath);
    else writeFileAtomic(patchPath, patch);
  }
  removeSkillsDir(path.join(dshHome, 'skills'));
}

// What a dsh dry run lists: the patch write and each skill directory it would write.
function dshDryRunLines(options) {
  const dshHome = resolveDshHome(options);
  return [
    `write ${dshPatchPath(dshHome)} (gsd plugin block)`,
    ...skillsDirNames(ROOT, { router: false }).map((name) => `write ${path.join(dshHome, 'skills', name)}`),
  ];
}

// opencode reads `$OPENCODE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/opencode`, else ~/.config/opencode.
function resolveOpencodeConfigDir(options) {
  const env = options.env ?? process.env;
  const set = (value) => value && value.trim() !== '';
  if (set(env.OPENCODE_CONFIG_DIR)) return path.resolve(env.OPENCODE_CONFIG_DIR);
  const xdg = set(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(os.homedir(), '.config');
  return path.resolve(xdg, 'opencode');
}

// opencode loads `<configDir>/plugins/<name>/server.mjs`; GSD's directory holds a re-export of
// the bundled adapter and a marker, so a `gsd` plugin GSD did not write is never replaced.
function opencodePluginDir(configDir) {
  return path.join(configDir, 'plugins', PLUGIN_BUNDLE_CONSTANTS.PLUGIN_NAME);
}

// Everything that can refuse an opencode install is checked here, before any host changes.
function prepareOpencodeInstall(options) {
  const configDir = resolveOpencodeConfigDir(options);
  if (!fs.existsSync(configDir) || !fs.statSync(configDir).isDirectory()) {
    throw new Error(`${configDir}: no opencode config directory; run opencode once first`);
  }
  const pluginDir = opencodePluginDir(configDir);
  if (fs.existsSync(pluginDir) && !fs.existsSync(path.join(pluginDir, OPENCODE_MARKER))) {
    throw new Error(`${pluginDir}: exists and is not a GSD-managed opencode plugin`);
  }
  return { configDir, pluginDir };
}

function applyOpencodeInstall(home, plan) {
  const pluginRoot = path.join(home, 'marketplace', PLUGIN_BUNDLE_CONSTANTS.PLUGIN_NAME);
  const modulePath = path.join(pluginRoot, 'adapters', 'opencode', 'gsd-context.mjs');
  // Skills refuse a foreign directory before writing anything, so they go before the shim.
  writeSkillsDir(path.join(pluginRoot, 'core'), path.join(plan.configDir, 'skills'), { router: false });
  fs.mkdirSync(plan.pluginDir, { recursive: true });
  fs.writeFileSync(path.join(plan.pluginDir, OPENCODE_MARKER), '');
  writeFileAtomic(
    path.join(plan.pluginDir, 'server.mjs'),
    `// Written by gsd install; gsd uninstall removes this directory.\nexport { default } from ${JSON.stringify(pathToFileURL(modulePath).href)};\n`,
  );
}

function runOpencodeUninstall(options) {
  const configDir = resolveOpencodeConfigDir(options);
  const pluginDir = opencodePluginDir(configDir);
  if (fs.existsSync(path.join(pluginDir, OPENCODE_MARKER))) fs.rmSync(pluginDir, { recursive: true, force: true });
  removeSkillsDir(path.join(configDir, 'skills'));
}

function opencodeDryRunLines(options) {
  const configDir = resolveOpencodeConfigDir(options);
  return [
    `write ${path.join(opencodePluginDir(configDir), 'server.mjs')}`,
    ...skillsDirNames(ROOT, { router: false }).map((name) => `write ${path.join(configDir, 'skills', name)}`),
  ];
}

// dsh and opencode are installed by writing files, not by a host plugin command.
const FILE_AGENTS = new Set(['dsh', 'opencode']);

function runInstall(parsed, options) {
  const home = resolveHome(parsed);
  const agents = selectedAgents(parsed.agent);
  const plans = agents.map((agent) => ({ agent, commands: FILE_AGENTS.has(agent) ? [] : commandPlan(agent, home) }));
  if (parsed.dryRun) {
    const lines = plans.flatMap(({ agent, commands }) => [
      `[${agent}]`,
      ...(agent === 'dsh'
        ? dshDryRunLines(options)
        : agent === 'opencode'
          ? opencodeDryRunLines(options)
          : commands.map((command) => `${command.binary} ${command.args.join(' ')}`)),
    ]);
    return { status: 0, stdout: `${lines.join('\n')}\n`, stderr: '' };
  }

  // State is read before any host changes, and each agent is recorded the moment its commands
  // succeed: a host that fails later must not leave an earlier one installed but unrecorded,
  // where uninstall would skip it and delete the marketplace it still links to.
  const state = readState(home);
  const dshPlan = agents.includes('dsh') ? prepareDshInstall(home, options) : null;
  const opencodePlan = agents.includes('opencode') ? prepareOpencodeInstall(options) : null;
  buildPluginBundle(ROOT, path.join(home, 'marketplace'));
  for (const { agent, commands } of plans) {
    if (agent === 'dsh') applyDshInstall(home, dshPlan);
    if (agent === 'opencode') applyOpencodeInstall(home, opencodePlan);
    for (const command of commands) {
      const result = runCommand(command, options);
      if (result.status !== 0 && !command.optional) return result;
    }
    state.agents[agent] = 'plugin';
    writeState(home, state);
  }
  return {
    status: 0,
    stdout: `${agents.map((agent) => `installed ${agent} (plugin)`).join('\n')}\n`,
    stderr: '',
  };
}

function runUninstall(parsed, options) {
  const home = resolveHome(parsed);
  const agents = selectedAgents(parsed.agent);
  const state = readState(home);
  const plans = agents.map((agent) => ({
    agent,
    commands: state.agents[agent] === 'plugin' && !FILE_AGENTS.has(agent) ? uninstallCommandPlan(agent) : [],
  }));
  if (parsed.dryRun) {
    const dshHome = resolveDshHome(options);
    const configDir = resolveOpencodeConfigDir(options);
    const lines = plans.flatMap(({ agent, commands }) => [
      `[${agent}]`,
      ...(agent === 'dsh' && state.agents.dsh === 'plugin'
        ? [`remove the gsd plugin block from ${dshPatchPath(dshHome)}`, `remove GSD-managed skills in ${path.join(dshHome, 'skills')}`]
        : agent === 'opencode' && state.agents.opencode === 'plugin'
          ? [`remove ${opencodePluginDir(configDir)}`, `remove GSD-managed skills in ${path.join(configDir, 'skills')}`]
          : commands.map((command) => `${command.binary} ${command.args.join(' ')}`)),
    ]);
    return { status: 0, stdout: `${lines.join('\n')}\n`, stderr: '' };
  }

  // Each agent leaves the state once its own commands succeed, so a retry after a failure
  // only repeats what is still installed. The marketplace goes with the last agent.
  for (const { agent, commands } of plans) {
    if (agent === 'dsh' && state.agents.dsh === 'plugin') runDshUninstall(options);
    if (agent === 'opencode' && state.agents.opencode === 'plugin') runOpencodeUninstall(options);
    for (const command of commands) {
      const result = runCommand(command, options);
      if (result.status !== 0 && !command.optional) return result;
    }
    delete state.agents[agent];
    if (Object.keys(state.agents).length === 0) removeState(home);
    else writeState(home, state);
  }
  if (Object.keys(state.agents).length === 0) removeMarketplace(home);
  return {
    status: 0,
    stdout: `${agents.map((agent) => `uninstalled ${agent}`).join('\n')}\n`,
    stderr: '',
  };
}

function parseConfigArgs(argv) {
  const positional = [];
  let home = null;
  let help = false;
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--home') {
      home = argv[i + 1] ?? null;
      i += 1;
      if (home === null) throw new Error('--home requires a path');
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown argument: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  const [action, key, value, ...extra] = positional;
  const arity = { list: 0, get: 1, set: 2 };
  if (help) return { help: true };
  if (!Object.hasOwn(arity, action ?? '')) throw new Error(`config action must be one of: ${Object.keys(arity).join(', ')}`);
  const given = [key, value].filter((item) => item !== undefined).length;
  if (given !== arity[action] || extra.length > 0) {
    throw new Error(`config ${action} expects ${arity[action]} argument(s)`);
  }
  if (action !== 'list') parseSettingsKey(key, CONFIG_HOSTS);
  return { action, key, value, home, help: false };
}

function runConfig(argv) {
  let parsed;
  try {
    parsed = parseConfigArgs(argv);
  } catch (error) {
    return { status: 2, stdout: '', stderr: `${error.message}\n` };
  }
  if (parsed.help) return { status: 0, stdout: HELP, stderr: '' };
  try {
    const home = parsed.home ? path.resolve(parsed.home) : resolveSettingsHome();
    const settings = readSettings(home);
    if (parsed.action === 'list') {
      const lines = SETTINGS_PROFILES.flatMap((profile) =>
        CONFIG_HOSTS.flatMap((host) => {
          const value = settings?.profiles?.[profile]?.[host];
          return value ? [`${profile}.${host}=${value}`] : [];
        }),
      );
      const stdout = lines.length > 0 ? `${lines.join('\n')}\n` : `${settingsPath(home)}: no profiles set\n`;
      return { status: 0, stdout, stderr: '' };
    }
    const { profile, host } = parseSettingsKey(parsed.key, CONFIG_HOSTS);
    if (parsed.action === 'get') {
      const value = settings?.profiles?.[profile]?.[host];
      if (!value) return { status: 1, stdout: '', stderr: `${parsed.key} is not set\n` };
      return { status: 0, stdout: `${value}\n`, stderr: '' };
    }
    const next = settings ?? { version: SETTINGS_VERSION, profiles: {} };
    next.profiles ??= {};
    next.profiles[profile] = { ...next.profiles[profile], [host]: parsed.value };
    writeSettings(home, next);
    return { status: 0, stdout: `${parsed.key}=${parsed.value}\n`, stderr: '' };
  } catch (error) {
    return { status: 1, stdout: '', stderr: `${error.message}\n` };
  }
}

export function runCli(argv, options = {}) {
  if (argv[0] === 'config') return runConfig(argv);
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    return { status: 2, stdout: '', stderr: `${error.message}\n` };
  }
  if (parsed.help || !parsed.command) {
    return { status: parsed.help ? 0 : 2, stdout: HELP, stderr: '' };
  }
  if (parsed.command !== 'install' && parsed.command !== 'uninstall') {
    return { status: 2, stdout: '', stderr: `unknown command: ${parsed.command}\n` };
  }
  if (parsed.skillsDir !== null) {
    if (parsed.agent) return { status: 2, stdout: '', stderr: '--skills-dir and --agent are exclusive\n' };
    try {
      return parsed.command === 'install' ? runSkillsInstall(parsed) : runSkillsUninstall(parsed);
    } catch (error) {
      return { status: 1, stdout: '', stderr: `${error.message}\n` };
    }
  }
  if (!parsed.agent) {
    return {
      status: 2,
      stdout: '',
      stderr: '--agent is required when stdin and stdout are not interactive\n',
    };
  }

  try {
    return parsed.command === 'install'
      ? runInstall(parsed, options)
      : runUninstall(parsed, options);
  } catch (error) {
    return { status: 1, stdout: '', stderr: `${error.message}\n` };
  }
}

export const CLI_AGENTS = AGENTS;
