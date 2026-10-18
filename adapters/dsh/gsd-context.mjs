// DeepSeek Harness adapter for GSD, written as a native dsh (Cordis) plugin. The home patch
// inserts this module by absolute path, so dsh loads it in-process under node. The hooks bridge
// is not used: dsh announces only `startup` and `resume` on `agent/created`, so a bridge never
// sees a compaction and the bootstrap and capsule would be lost with the compacted history.
// A plugin sees the `compaction/end` session event and can add a message to the next step, and
// it costs no subprocess per prompt. It imports nothing from dsh (`@deepseek-ai/*` does not
// resolve from this bundle), only Node built-ins and the harness-generic core in lib/, and it
// builds its own frozen user message. See adapters/README.md.
//
// Listeners:
//   agent/created  -> inject the bootstrap, or the capsule when resuming; a `compact` source
//                     (not emitted by dsh 0.2.0-rc.2) gets the bootstrap then the capsule
//   session/event  -> remember the session on `compaction/end`
//   agent/pre-step -> after a compaction, add one message with the bootstrap then the capsule to
//                     the next step that enters the model, once
//
// Ordinary steps add nothing, so per-turn token cost stays at zero. dsh gets no sub-agent
// profiles, so the bootstrap is the core render plus the session owner token.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBootstrap, sanitizeBootstrapError } from '../../lib/gsd-bootstrap.mjs';
import {
  renderRecoveryCapsule,
  sessionOwnerToken,
  withSessionOwner,
} from '../../lib/gsd-session-context.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GSD_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
// A generated plugin keeps canonical skills/tools under core/ and only the visible
// host skills at the plugin root; this marker distinguishes that layout.
const GSD_ROOT = fs.existsSync(path.join(DEFAULT_GSD_ROOT, '.gsd-plugin'))
  ? path.join(DEFAULT_GSD_ROOT, 'core')
  : DEFAULT_GSD_ROOT;

export const name = 'gsd';

// The shape dsh's own message helper produces: a frozen user message with one text item.
function userMessage(text) {
  return Object.freeze({
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze({ kind: 'gsd' }),
    id: randomUUID(),
  });
}

// The core render plus the session owner token that scopes which packets this session may see.
function renderBootstrap(owner) {
  return withSessionOwner(createBootstrap(GSD_ROOT), owner);
}

function cwdOf(agent) {
  const cwd = agent.session.header.cwd;
  return typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd();
}

// A compaction drops the bootstrap injected earlier, so it comes back before the capsule.
function renderAfterCompaction(owner, cwd) {
  const bootstrap = renderBootstrap(owner);
  const capsule = renderRecoveryCapsule(GSD_ROOT, cwd, owner);
  return capsule ? `${bootstrap}\n\n${capsule}` : bootstrap;
}

function renderForSource(source, owner, cwd) {
  if (source === 'resume') {
    // A resume replays the bootstrap with the transcript, so the capsule alone is enough.
    return renderRecoveryCapsule(GSD_ROOT, cwd, owner) ?? renderBootstrap(owner);
  }
  if (source === 'compact') return renderAfterCompaction(owner, cwd);
  return renderBootstrap(owner);
}

export function apply(ctx) {
  const compacted = new Set();

  ctx.on('agent/created', async ({ agent, source }) => {
    try {
      const owner = sessionOwnerToken('dsh', agent.session.header.id);
      agent.inject(userMessage(renderForSource(source, owner, cwdOf(agent))));
    } catch (error) {
      try {
        agent.inject(userMessage(sanitizeBootstrapError(error)));
      } catch {
        // dsh must keep running whatever the plugin hit
      }
    }
  });

  ctx.on('session/event', (session, event) => {
    try {
      if (event?.type === 'compaction/end') compacted.add(session.header.id);
    } catch {
      // an unreadable session id leaves the session unmarked
    }
  });

  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next();
    // Only a step that owes a re-injection is touched, so a broken session never gains an
    // error on every step.
    const id = agent?.session?.header?.id;
    if (id === undefined || !compacted.has(id) || decision?.kind !== 'enter') return decision;
    compacted.delete(id);
    let text;
    try {
      text = renderAfterCompaction(sessionOwnerToken('dsh', id), cwdOf(agent));
    } catch (error) {
      text = sanitizeBootstrapError(error);
    }
    return { ...decision, messages: [...decision.messages, userMessage(text)] };
  });
}
