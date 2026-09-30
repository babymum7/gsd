#!/usr/bin/env bun
import readline from 'node:readline/promises';
import { needsAgentPrompt, runCli } from '../adapters/plugin/gsd-cli.mjs';

// Resolves to `{ agent }` for a choice, or `{ error, status }` when the prompt ends without one.
async function selectAgent() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write('Select agent:\n1. all (recommended)\n2. omp\n3. claude\n4. codex\n> ');
    const answer = (await rl.question('')).trim();
    if (answer === '' || answer === '1') return { agent: 'all' };
    if (answer === '2') return { agent: 'omp' };
    if (answer === '3') return { agent: 'claude' };
    if (answer === '4') return { agent: 'codex' };
    return { error: `unknown selection ${JSON.stringify(answer)}: enter 1, 2, 3, or 4, or pass --agent`, status: 2 };
  } catch (error) {
    // Ctrl-D at the prompt rejects the pending question with an AbortError.
    if (error?.name === 'AbortError') return { error: '\nagent selection cancelled', status: 1 };
    throw error;
  } finally {
    rl.close();
  }
}

const argv = process.argv.slice(2);
if (needsAgentPrompt(argv) && process.stdin.isTTY && process.stdout.isTTY) {
  const selection = await selectAgent();
  if (selection.error) {
    process.stderr.write(`${selection.error}\n`);
    process.exit(selection.status);
  }
  argv.push('--agent', selection.agent);
}

const result = runCli(argv);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.status;
