import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPluginBundle } from './gsd-plugin-packager.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AGENTS = ['omp', 'claude', 'codex'];
const PLUGIN_SELECTOR = 'gsd@gsd-local';

const HELP = `GSD host plugin CLI

Usage:
  gsd install [--agent omp|claude|codex|all] [--home <path>] [--dry-run]
  gsd uninstall [--agent omp|claude|codex|all] [--home <path>] [--dry-run]

Options:
  --agent <name>  Agent to process (omit interactively)
  --home <path>   GSD CLI home (default: ~/.gsd)
  --dry-run       Print planned commands without writing
  -h, --help      Show this help
`;

function parseArgs(argv) {
  const first = argv[0];
  const parsed = {
    command: first === '--help' || first === '-h' ? null : (first ?? null),
    agent: null,
    home: null,
    dryRun: false,
    help: first === '--help' || first === '-h',
  };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--agent') {
      parsed.agent = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === '--home') {
      parsed.home = argv[i + 1] ?? null;
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
      { binary: 'claude', args: ['plugin', 'install', PLUGIN_SELECTOR, '--scope', 'user'] },
    ];
  }
  return [
    { binary: 'codex', args: ['plugin', 'marketplace', 'add', marketplaceRoot] },
    { binary: 'codex', args: ['plugin', 'add', PLUGIN_SELECTOR] },
  ];
}

function uninstallCommandPlan(agent) {
  if (agent === 'omp') {
    return [{ binary: 'omp', args: ['plugin', 'uninstall', 'gsd-core'] }];
  }
  if (agent === 'claude') {
    return [
      { binary: 'claude', args: ['plugin', 'uninstall', PLUGIN_SELECTOR, '--scope', 'user'] },
      {
        binary: 'claude',
        args: ['plugin', 'marketplace', 'remove', 'gsd-local', '--scope', 'user'],
      },
    ];
  }
  return [
    { binary: 'codex', args: ['plugin', 'remove', PLUGIN_SELECTOR] },
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
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
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

function runInstall(parsed, options) {
  const home = path.resolve(parsed.home ?? process.env.GSD_HOME ?? path.join(os.homedir(), '.gsd'));
  const agents = selectedAgents(parsed.agent);
  const plans = agents.map((agent) => ({ agent, commands: commandPlan(agent, home) }));
  if (parsed.dryRun) {
    const lines = plans.flatMap(({ agent, commands }) => [
      `[${agent}]`,
      ...commands.map((command) => `${command.binary} ${command.args.join(' ')}`),
    ]);
    return { status: 0, stdout: `${lines.join('\n')}\n`, stderr: '' };
  }

  buildPluginBundle(ROOT, path.join(home, 'marketplace'));
  for (const { commands } of plans) {
    for (const command of commands) {
      const result = runCommand(command, options);
      if (result.status !== 0) return result;
    }
  }

  const state = readState(home);
  for (const agent of agents) state.agents[agent] = 'plugin';
  writeState(home, state);
  return {
    status: 0,
    stdout: `${agents.map((agent) => `installed ${agent} (plugin)`).join('\n')}\n`,
    stderr: '',
  };
}

function runUninstall(parsed, options) {
  const home = path.resolve(parsed.home ?? process.env.GSD_HOME ?? path.join(os.homedir(), '.gsd'));
  const agents = selectedAgents(parsed.agent);
  const state = readState(home);
  const plans = agents.map((agent) => ({
    agent,
    commands: state.agents[agent] === 'plugin' ? uninstallCommandPlan(agent) : [],
  }));
  if (parsed.dryRun) {
    const lines = plans.flatMap(({ agent, commands }) => [
      `[${agent}]`,
      ...commands.map((command) => `${command.binary} ${command.args.join(' ')}`),
    ]);
    return { status: 0, stdout: `${lines.join('\n')}\n`, stderr: '' };
  }

  for (const { commands } of plans) {
    for (const command of commands) {
      const result = runCommand(command, options);
      if (result.status !== 0) return result;
    }
  }
  for (const agent of agents) delete state.agents[agent];
  if (Object.keys(state.agents).length === 0) removeState(home);
  else writeState(home, state);
  if (Object.keys(state.agents).length === 0) removeMarketplace(home);
  return {
    status: 0,
    stdout: `${agents.map((agent) => `uninstalled ${agent}`).join('\n')}\n`,
    stderr: '',
  };
}

export function runCli(argv, options = {}) {
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
