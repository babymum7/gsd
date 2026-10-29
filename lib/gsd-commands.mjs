// The command set of each GSD tool. After a compaction an agent often recalls a command but
// sends it to the wrong tool (`gsd-git.mjs merge-message`), so an unknown command names the
// tool that has it instead of leaving the agent to probe each one.
export const TOOL_COMMANDS = Object.freeze({
  'gsd-contract.mjs': Object.freeze(['validate-plan', 'analyze-waves', 'normalize-plan', 'init-plan', 'merge-message']),
  'gsd-domain.mjs': Object.freeze(['validate', 'normalize']),
  'gsd-git.mjs': Object.freeze(['derive-base', 'preflight', 'verify-task-branch']),
  'gsd-record.mjs': Object.freeze(['validate']),
  'gsd-state.mjs': Object.freeze(['read-state', 'write-state', 'validate-state', 'set', 'session']),
});

export function commandsOf(tool) {
  return new Set(TOOL_COMMANDS[tool]);
}

export function unknownCommandMessage(tool, command) {
  const owners = Object.keys(TOOL_COMMANDS).filter((name) => name !== tool && TOOL_COMMANDS[name].includes(command));
  const base = `unknown command: ${command}`;
  return owners.length === 0 ? base : `${base}; ${command} is a command of ${owners.join(' or ')} in the same directory`;
}

// Longest message text one refusal row carries, in characters, so a long cause cannot flood the
// agent's context.
export const ERROR_TEXT_MAX_CHARS = 500;
// Most defects one refusal lists; its `errors:` row still counts them all.
export const MAX_LISTED_ERRORS = 10;

// Every row value is one JSON string, so a quote or a newline in it never starts a new row.
export function quote(value) {
  return JSON.stringify(String(value));
}

// The four rows every tool refusal opens with; a tool appends its own rows after them.
export function errorRows(code, message, help) {
  return ['status: error', `code: ${code}`, `error: ${quote(message)}`, `help: ${quote(help)}`];
}

// The command that runs a tool by the path it was loaded from, as its help and refusals print it.
export function invocationOf(scriptPath) {
  return `bun ${quote(scriptPath)}`;
}
