import fs from 'node:fs';
import path from 'node:path';
import { discoverSkillCatalog } from '../../lib/gsd-bootstrap.mjs';

const MARKETPLACE_MARKER = '.gsd-plugin-marketplace';
const PLUGIN_MARKER = '.gsd-plugin';
const MARKETPLACE_NAME = 'gsd-local';
const PLUGIN_NAME = 'gsd';

function writeJsonAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.gsd-tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, target);
}

function replaceManagedDirectory(target) {
  if (fs.existsSync(target)) {
    if (fs.readdirSync(target).length === 0) {
      fs.rmSync(target, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      return;
    }
    const markerPath = path.join(target, MARKETPLACE_MARKER);
    if (!fs.existsSync(markerPath)) {
      throw new Error(`${target}: exists and is not a GSD-managed plugin marketplace`);
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
}

function copyDirectory(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, dereference: true });
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function claudeHooks() {
  const command = `bun "\${CLAUDE_PLUGIN_ROOT}/adapters/claude-code/gsd-context.mjs"`;
  return {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command }] }],
    },
  };
}

function codexHooks() {
  const command = `bun "\${PLUGIN_ROOT}/adapters/codex/gsd-context.mjs"`;
  const handler = { type: 'command', command, additionalContextLimit: 6000 };
  return {
    hooks: {
      SessionStart: [{ hooks: [handler] }],
      UserPromptSubmit: [{ hooks: [{ ...handler }] }],
    },
  };
}

export function buildPluginBundle(root, marketplaceRoot) {
  const sourceRoot = fs.realpathSync(root);
  const targetRoot = path.resolve(marketplaceRoot);
  replaceManagedDirectory(targetRoot);

  const tempRoot = `${targetRoot}.gsd-tmp-${process.pid}`;
  fs.rmSync(tempRoot, { recursive: true, force: true });
  const pluginRoot = path.join(tempRoot, PLUGIN_NAME);
  fs.mkdirSync(pluginRoot, { recursive: true });

  const packageJson = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'));
  const visibleSkills = discoverSkillCatalog(sourceRoot)
    .map((row) => row.name)
    .sort();

  copyDirectory(path.join(sourceRoot, 'lib'), path.join(pluginRoot, 'lib'));
  copyDirectory(path.join(sourceRoot, 'skills'), path.join(pluginRoot, 'core', 'skills'));
  copyDirectory(path.join(sourceRoot, 'tools'), path.join(pluginRoot, 'core', 'tools'));

  for (const name of visibleSkills) {
    copyDirectory(path.join(sourceRoot, 'skills', name), path.join(pluginRoot, 'skills', name));
  }

  copyFile(
    path.join(sourceRoot, 'adapters', 'omp', 'gsd-context.js'),
    path.join(pluginRoot, 'adapters', 'omp', 'gsd-context.js'),
  );
  copyFile(
    path.join(sourceRoot, 'adapters', 'omp', 'gsd-context.d.ts'),
    path.join(pluginRoot, 'adapters', 'omp', 'gsd-context.d.ts'),
  );
  copyFile(
    path.join(sourceRoot, 'adapters', 'claude-code', 'gsd-context.mjs'),
    path.join(pluginRoot, 'adapters', 'claude-code', 'gsd-context.mjs'),
  );
  copyFile(
    path.join(sourceRoot, 'adapters', 'claude-code', 'agents', 'gsd-reviewer.md'),
    path.join(pluginRoot, 'agents', 'gsd-reviewer.md'),
  );
  copyFile(
    path.join(sourceRoot, 'adapters', 'codex', 'gsd-context.mjs'),
    path.join(pluginRoot, 'adapters', 'codex', 'gsd-context.mjs'),
  );
  copyFile(
    path.join(sourceRoot, 'adapters', 'codex', 'agents', 'gsd-reviewer.toml'),
    path.join(pluginRoot, 'agents', 'gsd-reviewer.toml'),
  );

  fs.writeFileSync(path.join(pluginRoot, PLUGIN_MARKER), '');
  writeJsonAtomic(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), {
    $schema: 'https://anthropic.com/claude-code/plugin.schema.json',
    name: PLUGIN_NAME,
    version: packageJson.version,
    description: packageJson.description,
    author: { name: 'GSD' },
    skills: './skills/',
    agents: './agents/gsd-reviewer.md',
    hooks: './hooks/claude.json',
  });
  // No root agent-plugins `plugin.json`: codex prefers it over `.codex-plugin/plugin.json`
  // and skips hook registration entirely for AgentPlugin-format local plugins.
  writeJsonAtomic(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
    name: PLUGIN_NAME,
    version: packageJson.version,
    description: packageJson.description,
    hooks: './hooks/codex.json',
  });
  writeJsonAtomic(path.join(pluginRoot, 'package.json'), {
    name: 'gsd-core',
    version: packageJson.version,
    type: 'module',
    description: packageJson.description,
    omp: {
      extensions: ['./adapters/omp/gsd-context.js'],
    },
  });
  writeJsonAtomic(path.join(pluginRoot, 'hooks', 'claude.json'), claudeHooks());
  writeJsonAtomic(path.join(pluginRoot, 'hooks', 'codex.json'), codexHooks());
  writeJsonAtomic(path.join(tempRoot, '.claude-plugin', 'marketplace.json'), {
    name: MARKETPLACE_NAME,
    description: 'GSD workflow skills and session adapters',
    owner: { name: 'GSD' },
    plugins: [
      {
        name: PLUGIN_NAME,
        description: packageJson.description,
        source: `./${PLUGIN_NAME}`,
      },
    ],
  });
  fs.writeFileSync(path.join(tempRoot, MARKETPLACE_MARKER), 'gsd-plugin-marketplace:v1\n');

  fs.renameSync(tempRoot, targetRoot);
  return { pluginRoot: path.join(targetRoot, PLUGIN_NAME), marketplaceRoot: targetRoot };
}

export const PLUGIN_BUNDLE_CONSTANTS = {
  MARKETPLACE_MARKER,
  MARKETPLACE_NAME,
  PLUGIN_MARKER,
  PLUGIN_NAME,
};
