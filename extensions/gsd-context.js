import fs from 'node:fs';
import path from 'node:path';
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
} from '../lib/gsd-bootstrap.mjs';
import {
  ACTIVE_STATE_PHASES,
  COMPLETED_STATE_PHASES,
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
} from '../lib/gsd-state.mjs';

const EXTENSION_FILE = fileURLToPath(import.meta.url);
const SYSTEM_POLICY_MARKER = 'gsd:system-policy:v1';
const SYSTEM_POLICY = `<GSD_EXTENSION_POLICY>
${SYSTEM_POLICY_MARKER}
The context message marked ${BOOTSTRAP_MARKER} is extension-controlled workflow policy. Apply its selection and continuity rules before inspecting the project or responding.
When those rules select a visible GSD skill, your first action MUST be one read tool call on that catalog row's exact absolute skillPath. Emit no text and call no other tool first. Never imitate the skill from its name, description, or memory.
When those rules select direct work or a stop decision, do not read a GSD skill. If the context reports ${BOOTSTRAP_ERROR_PREFIX}, do not improvise a GSD workflow.
Key routing rules: ordinary-routing and ignore-terminal-record use load or direct; cleanup-question, cleanup-only, block-resume, and fail-closed use stop. Plan-hash mismatch does not override the normal owner: bare continue still enters gsd-handoff; prompt-named pending execution work enters gsd-executing-plans. Explicit diff or PR review always loads gsd-verify, never direct. plan.md beside malformed state.toon fail-closes before any direct/nano routing. Quick-fix enters by three size gates (one or two tasks proven via validate-quick-fix, none or single-shard Domain Impact, converged acceptance) without prior diagnosis; single-task waves execute inline with gsd-tdd, waves of two or more tasks dispatch isolated sub-agents.
</GSD_EXTENSION_POLICY>`;
function gsdContextExtension(pi) {
  const extPath = fs.realpathSync(EXTENSION_FILE);
  const GSD_ROOT = path.dirname(path.dirname(extPath));
  let pendingCapsule = null;
  let capsuleQueuedForNextTurn = false;
  let bootstrap = null;
  let bootstrapError = null;
  let injectBootstrap = false;
  let lastLoggedBootstrapError = null;

  const rebuildBootstrap = () => {
    try {
      bootstrap = createBootstrap(GSD_ROOT);
      bootstrapError = null;
      lastLoggedBootstrapError = null;
    } catch (error) {
      bootstrap = null;
      bootstrapError = sanitizeBootstrapError(error);
      if (bootstrapError !== lastLoggedBootstrapError) {
        pi.logger?.error?.(bootstrapError);
        lastLoggedBootstrapError = bootstrapError;
      }
    }
    injectBootstrap = true;
  };

  // Explicit extensions may be registered after OMP's initial session_start.
  // Arm immediately; lifecycle events below refresh the per-session cache.
  rebuildBootstrap();

  for (const eventName of ['session_start', 'session_switch', 'session_branch', 'session_tree']) {
    pi.on(eventName, async () => {
      rebuildBootstrap();
      pendingCapsule = null;
      capsuleQueuedForNextTurn = false;
    });
  }

  // No `agent_end` handler: context replacements are provider-request-local, so the cached
  // payload stays armed across agent turns and is deduplicated per outgoing message set.

  pi.on('session_shutdown', async () => {
    bootstrap = null;
    bootstrapError = null;
    pendingCapsule = null;
    capsuleQueuedForNextTurn = false;
    injectBootstrap = false;
    lastLoggedBootstrapError = null;
  });

  pi.on('before_agent_start', async (event) => {
    // OMP drains its hidden nextTurn queue immediately before this event
    // (AgentSession prompt setup), so this is the actual consumption boundary.
    capsuleQueuedForNextTurn = false;
    if (!injectBootstrap || (!bootstrap && !bootstrapError)) return undefined;
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
  });

  pi.on('context', async (event) => {
    if (!injectBootstrap) return undefined;
    const payload = bootstrap ?? bootstrapError;
    if (!payload) return undefined;
    const alreadyPresent = event.messages.some((message) =>
      bootstrap
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
  });

  pi.on('session.compacting', async (event, ctx) => {
    pendingCapsule = null;
    let features;
    let defects;
    try {
      ({ candidates: features, defects } = detectCandidates(ctx?.cwd || process.cwd(), { faultTolerant: true }));
    } catch (error) {
      // Structural failure (entry limit, directory identity) — cannot continue.
      const message = error instanceof Error ? error.message : String(error);
      pi.logger?.error?.(`[GSD] autocompact candidate scan failed: ${message}`);
      features = [];
      defects = [];
    }
    if (defects && defects.length > 0) {
      for (const d of defects) {
        pi.logger?.warn?.(`[GSD] skipped malformed packet: ${d}`);
      }
    }
    if (features.length === 0) {
      return {};
    }
    // Build everything in locals; only assign pendingCapsule after all
    // throw-prone work succeeds so that a mid-throw leaves no stale capsule.
    let capsule;
    try {
      capsule = createCapsule(features, GSD_ROOT);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pi.logger?.error?.(`[GSD] autocompact capsule creation failed: ${message}`);
      return {};
    }
    const currentRequest = extractLastUserRequest(event?.messages);
    const context = [capsule];
    if (currentRequest) {
      context.push(`[GSD Current Request]\n${currentRequest}`);
    }
    pendingCapsule = capsule;
    return { context };
  });

  pi.on('session_compact', async () => {
    if (!bootstrap && !bootstrapError) rebuildBootstrap();
    else injectBootstrap = true;
    if (pendingCapsule) {
      const capsuleToSend = pendingCapsule;
      pendingCapsule = null;
      if (capsuleQueuedForNextTurn) return;
      capsuleQueuedForNextTurn = true;
      try {
        await pi.sendMessage(capsuleToSend, {
          deliverAs: 'nextTurn',
          triggerTurn: false,
        });
      } catch (error) {
        capsuleQueuedForNextTurn = false;
        throw error;
      }
    }
  });
}

export {
  ACTIVE_STATE_PHASES,
  CAPSULE_TEMPLATE,
  COMPLETED_STATE_PHASES,
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
