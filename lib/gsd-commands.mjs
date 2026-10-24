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
