import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BOOTSTRAP_ERROR_PREFIX,
  BOOTSTRAP_MARKER,
  CAPSULE_TEMPLATE,
  createBootstrap,
  createCapsule,
  discoverSkillCatalog,
  extractLastUserRequest,
  firstNonCompactionSummaryIndex,
  messageContainsBootstrap,
  messageText,
  parseSkillMetadata,
  sanitizeBootstrapError,
} from '../../lib/gsd-bootstrap.mjs';
import {
  ACTIVE_STATE_PHASES,
  DEFAULT_PHASE_NEXT_ACTIONS,
  STATE_FIELD_ORDER,
  defaultNextActionForPhase,
  detectCandidates,
  inspectStateFile,
  parseState,
  readStateFile,
  serializeState,
  validateState,
  writeStateAtomic,
} from '../../lib/gsd-state.mjs';
import { loadSubagentProfiles, withSubagentProfiles } from '../../lib/gsd-settings.mjs';
import {
  composeRecoveryCapsule,
  resolveGsdRoot,
  sessionOwnerToken,
  withSessionOwner,
} from '../../lib/gsd-session-context.mjs';

const EXTENSION_FILE = fileURLToPath(import.meta.url);
const SYSTEM_POLICY_MARKER = 'gsd:system-policy:v1';
const SYSTEM_POLICY = `<GSD_EXTENSION_POLICY>
${SYSTEM_POLICY_MARKER}
The context message marked ${BOOTSTRAP_MARKER} is extension-controlled workflow policy: follow its routing and session-ownership rules.
When a visible GSD skill fits the prompt, read that catalog row's skillPath before acting on it; never imitate a skill from its name or description. Questions, explanations, and quick fixes need no skill: a quick fix is a direct edit plus a focused test, with no packet, plan, or commit. If the context reports ${BOOTSTRAP_ERROR_PREFIX}, do not improvise a GSD workflow.
</GSD_EXTENSION_POLICY>`;
// The session owner token scopes which packets this session sees; it follows the
// session manager's id through switches, branches, and tree moves.
function trackOwner(state, ctx) {
  try {
    const id = ctx?.sessionManager?.getSessionId?.();
    if (id) state.owner = sessionOwnerToken('omp', id);
  } catch {
    // a context without a session manager keeps the last known owner
  }
}

function rebuildBootstrap(state) {
  try {
    state.bootstrap = withSubagentProfiles(createBootstrap(state.root), loadSubagentProfiles('omp', 'the task tool `agent`'));
    state.bootstrapError = null;
    state.lastLoggedBootstrapError = null;
  } catch (error) {
    state.bootstrap = null;
    state.bootstrapError = sanitizeBootstrapError(error);
    if (state.bootstrapError !== state.lastLoggedBootstrapError) {
      state.pi.logger?.error?.(state.bootstrapError);
      state.lastLoggedBootstrapError = state.bootstrapError;
    }
  }
  state.injectBootstrap = true;
}

async function onSessionChange(state, ctx) {
  trackOwner(state, ctx);
  rebuildBootstrap(state);
  state.pendingCapsule = null;
  state.capsuleQueuedForNextTurn = false;
}

async function onSessionShutdown(state) {
  state.bootstrap = null;
  state.bootstrapError = null;
  state.pendingCapsule = null;
  state.capsuleQueuedForNextTurn = false;
  state.injectBootstrap = false;
  state.lastLoggedBootstrapError = null;
  state.owner = null;
}

async function onBeforeAgentStart(state, event) {
  // OMP drains its hidden nextTurn queue immediately before this event
  // (AgentSession prompt setup), so this is the actual consumption boundary.
  state.capsuleQueuedForNextTurn = false;
  if (!state.injectBootstrap || (!state.bootstrap && !state.bootstrapError)) return undefined;
  const systemPrompt = Array.isArray(event.systemPrompt)
    ? event.systemPrompt
    : typeof event.systemPrompt === 'string' && event.systemPrompt !== ''
      ? [event.systemPrompt]
      : [];
  if (
    systemPrompt.some((block) => {
      const text =
        typeof block === 'string'
          ? block
          : block && typeof block === 'object' && typeof block.text === 'string'
            ? block.text
            : '';
      return text.includes(SYSTEM_POLICY_MARKER);
    })
  ) {
    return undefined;
  }
  return { systemPrompt: [...systemPrompt, SYSTEM_POLICY] };
}

async function onContext(state, event, ctx) {
  if (!state.injectBootstrap) return undefined;
  trackOwner(state, ctx);
  const payload = state.bootstrap ? withSessionOwner(state.bootstrap, state.owner) : state.bootstrapError;
  if (!payload) return undefined;
  const alreadyPresent = event.messages.some((message) =>
    state.bootstrap
      ? messageContainsBootstrap(message, payload)
      : messageText(message) === payload,
  );
  if (alreadyPresent) return undefined;

  const messages = [...event.messages];
  messages.splice(firstNonCompactionSummaryIndex(messages), 0, {
    role: 'user',
    content: payload,
    timestamp: Date.now(),
  });
  return { messages };
}

async function onSessionCompacting(state, event, ctx) {
  state.pendingCapsule = null;
  trackOwner(state, ctx);
  // Without an owner token no packet is this session's, so no capsule is sent.
  if (!state.owner) return {};
  let scan;
  try {
    scan = detectCandidates(ctx?.cwd || process.cwd(), { faultTolerant: true, owner: state.owner });
  } catch (error) {
    // Structural failure (entry limit, directory identity) — cannot continue.
    const message = error instanceof Error ? error.message : String(error);
    state.pi.logger?.error?.(`[GSD] autocompact candidate scan failed: ${message}`);
    scan = null;
  }
  for (const d of scan?.defects ?? []) {
    state.pi.logger?.warn?.(`[GSD] skipped malformed packet: ${d}`);
  }
  // Build everything in locals; only assign pendingCapsule after all
  // throw-prone work succeeds so that a mid-throw leaves no stale capsule.
  let capsule;
  try {
    capsule = composeRecoveryCapsule(scan, state.root, state.owner);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.pi.logger?.error?.(`[GSD] autocompact capsule creation failed: ${message}`);
    return {};
  }
  if (!capsule) return {};
  const currentRequest = extractLastUserRequest(event?.messages);
  const context = [capsule];
  if (currentRequest) {
    context.push(`[GSD Current Request]\n${currentRequest}`);
  }
  state.pendingCapsule = capsule;
  return { context };
}

async function onSessionCompact(state) {
  if (!state.bootstrap && !state.bootstrapError) rebuildBootstrap(state);
  else state.injectBootstrap = true;
  if (state.pendingCapsule) {
    const capsuleToSend = state.pendingCapsule;
    state.pendingCapsule = null;
    if (state.capsuleQueuedForNextTurn) return;
    state.capsuleQueuedForNextTurn = true;
    try {
      await state.pi.sendMessage(capsuleToSend, {
        deliverAs: 'nextTurn',
        triggerTurn: false,
      });
    } catch (error) {
      state.capsuleQueuedForNextTurn = false;
      throw error;
    }
  }
}

function gsdContextExtension(pi) {
  const state = {
    pi,
    // The root is found from the extension's real path, after symlinks.
    root: resolveGsdRoot(fs.realpathSync(EXTENSION_FILE)),
    pendingCapsule: null,
    capsuleQueuedForNextTurn: false,
    bootstrap: null,
    bootstrapError: null,
    injectBootstrap: false,
    lastLoggedBootstrapError: null,
    owner: null,
  };

  // Explicit extensions may be registered after OMP's initial session_start.
  // Arm immediately; lifecycle events below refresh the per-session cache.
  rebuildBootstrap(state);

  for (const eventName of ['session_start', 'session_switch', 'session_branch', 'session_tree']) {
    pi.on(eventName, (_event, ctx) => onSessionChange(state, ctx));
  }

  // No `agent_end` handler: context replacements are provider-request-local, so the cached
  // payload stays armed across agent turns and is deduplicated per outgoing message set.

  pi.on('session_shutdown', () => onSessionShutdown(state));
  pi.on('before_agent_start', (event) => onBeforeAgentStart(state, event));
  pi.on('context', (event, ctx) => onContext(state, event, ctx));
  pi.on('session.compacting', (event, ctx) => onSessionCompacting(state, event, ctx));
  pi.on('session_compact', () => onSessionCompact(state));
}

export {
  ACTIVE_STATE_PHASES,
  CAPSULE_TEMPLATE,
  DEFAULT_PHASE_NEXT_ACTIONS,
  STATE_FIELD_ORDER,
  createBootstrap,
  createCapsule,
  defaultNextActionForPhase,
  detectCandidates,
  discoverSkillCatalog,
  firstNonCompactionSummaryIndex,
  inspectStateFile,
  messageContainsBootstrap,
  parseSkillMetadata,
  parseState,
  readStateFile,
  serializeState,
  validateState,
  writeStateAtomic,
};

export default gsdContextExtension;
