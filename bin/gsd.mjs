#!/usr/bin/env bun
import readline from 'node:readline/promises';
import { runCli } from '../adapters/plugin/gsd-cli.mjs';

async function selectAgent() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
  process.stdout.write('Select agent:\n1. all (recommended)\n2. omp\n3. claude\n4. codex\n> ');
    const answer = (await rl.question('')).trim();
    if (answer === '' || answer === '1') return 'all';
    if (answer === '2') return 'omp';
  if (answer === '3') return 'claude';
    if (answer === '4') return 'codex';
    return null;
  } finally {
    rl.close();
  }
}

const argv = process.argv.slice(2);
const command = argv[0];
const hasAgent = argv.includes('--agent');
if ((command === 'install' || command === 'uninstall') && !hasAgent && process.stdin.isTTY && process.stdout.isTTY) {
  const agent = await selectAgent();
  if (agent) argv.push('--agent', agent);
}

const result = runCli(argv);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.status;
