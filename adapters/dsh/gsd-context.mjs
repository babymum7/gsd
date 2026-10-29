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
//   agent/created  -> inject the bootstrap; a resume of a session that already got it gets only
//                     the capsule, or nothing; a `compact` source (not emitted by dsh
//                     0.2.0-rc.2) gets the bootstrap then the capsule
//   session/event  -> remember the session on `compaction/end`
//   agent/pre-step -> after a compaction, add one message with the bootstrap then the capsule to
//                     the next step that enters the model, once
//
// Ordinary steps add nothing, so per-turn token cost stays at zero. dsh gets no sub-agent
// profiles, so the bootstrap is the core render plus the session owner token.

import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBootstrap, sanitizeBootstrapError } from '../../lib/gsd-bootstrap.mjs';
import {
  bootstrapDigest,
  createMarkerStore,
  renderRecoveryCapsule,
  resolveGsdRoot,
  sessionOwnerToken,
  withSessionOwner,
} from '../../lib/gsd-session-context.mjs';

const GSD_ROOT = resolveGsdRoot(fileURLToPath(import.meta.url));
// Read per call, since dsh may set TMPDIR after loading the plugin.
const stateRoot = () => path.join(os.tmpdir(), 'gsd-dsh');

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

// A resume replays the transcript, so a bootstrap this session already got is still in it and
// only the capsule, if any, is new. A session the marker does not know, or whose bootstrap GSD
// has since changed, gets the full set.
function renderForSource(source, owner, cwd, current) {
  if (source === 'resume' && current) return renderRecoveryCapsule(GSD_ROOT, cwd, owner);
  if (source === 'resume' || source === 'compact') return renderAfterCompaction(owner, cwd);
  return renderBootstrap(owner);
}

export function apply(ctx) {
  const compacted = new Set();

  ctx.on('agent/created', async ({ agent, source }) => {
    try {
      const id = agent.session.header.id;
      const store = createMarkerStore(stateRoot(), id);
      const owner = sessionOwnerToken('dsh', id);
      const digest = bootstrapDigest(renderBootstrap(owner));
      const text = renderForSource(source, owner, cwdOf(agent), store.read('bootstrap-emitted') === digest);
      store.write('bootstrap-emitted', digest);
      if (text) agent.inject(userMessage(text));
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
      // A failed compaction also ends with `compaction/end`, carrying an `error` in its `data`
      // like every dsh session event's own fields; the history still holds the bootstrap, so
      // only a successful one owes a re-injection.
      if (event?.type === 'compaction/end' && !event.data?.error) compacted.add(session.header.id);
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
      const owner = sessionOwnerToken('dsh', id);
      text = renderAfterCompaction(owner, cwdOf(agent));
      createMarkerStore(stateRoot(), id).write('bootstrap-emitted', bootstrapDigest(renderBootstrap(owner)));
    } catch (error) {
      text = sanitizeBootstrapError(error);
    }
    return { ...decision, messages: [...decision.messages, userMessage(text)] };
  });
}
