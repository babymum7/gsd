// opencode v2 adapter for GSD, written as a native opencode server plugin. The CLI writes a
// `<configDir>/plugins/gsd/server.mjs` shim that re-exports this module, and opencode loads it
// in-process. It imports nothing from opencode, only Node built-ins and the harness-generic core
// in lib/. See adapters/README.md.
//
// Surfaces:
//   event `session.compaction.ended` -> the compaction dropped the bootstrap, so send it then the
//                                       recovery capsule, reaching a loop that is still running
//   prompt hook                      -> before a root session's prompt, send the bootstrap as a
//                                       synthetic user message unless its context already holds
//                                       one, with the capsule when the context starts from a
//                                       compaction whose event this process never saw
//
// Every message GSD sends carries the `gsd/bootstrap` metadata tag, and both surfaces send only
// when the context holds none, so one history gets one message across processes and resumes.
// Ordinary prompts add nothing, so per-turn token cost stays at zero. Child sessions (sub-agents)
// get nothing, and opencode gets no sub-agent profiles.

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
const TAG = 'gsd/bootstrap';

function renderBootstrap(sessionID) {
  return withSessionOwner(createBootstrap(GSD_ROOT), sessionOwnerToken('opencode', sessionID));
}

function renderAfterCompaction(sessionID, cwd) {
  const bootstrap = renderBootstrap(sessionID);
  const capsule = renderRecoveryCapsule(GSD_ROOT, cwd, sessionOwnerToken('opencode', sessionID));
  return capsule ? `${bootstrap}\n\n${capsule}` : bootstrap;
}

function tagged(entry) {
  return (entry?.payload?.metadata ?? entry?.metadata)?.[TAG] === true;
}

// Null when the context already holds a GSD message, else whether it starts from a compaction.
async function owedAfter(ctx, sessionID) {
  const context = await ctx.session.context({ sessionID }).catch(() => []);
  const list = Array.isArray(context) ? context : [];
  if (list.some(tagged)) return null;
  return { compacted: list.some((entry) => entry?.type === 'compaction') };
}

export default {
  id: 'gsd',
  async setup(ctx) {
    const send = (sessionID, text) =>
      ctx.session.synthetic({ sessionID, text, description: 'GSD bootstrap', metadata: { [TAG]: true }, resume: false });

    // Null for a child session, which gets nothing; otherwise the directory the capsule scans.
    async function rootDirectory(sessionID) {
      const session = await ctx.session.get({ sessionID });
      if (session?.parentID) return null;
      return session?.location?.directory ?? ctx.location?.directory ?? process.cwd();
    }

    // Each surface renders its text, or the sanitized error when the core fails; a failure to
    // send even that is swallowed, because opencode must keep running whatever the plugin hit.
    async function deliver(sessionID, render) {
      let text;
      try {
        text = await render();
      } catch (error) {
        text = sanitizeBootstrapError(error);
      }
      if (text === null) return;
      try {
        await send(sessionID, text);
      } catch {
        // nothing left to report to
      }
    }

    await ctx.session.hook('prompt', async ({ sessionID }) => {
      const owed = await owedAfter(ctx, sessionID);
      if (owed === null) return;
      await deliver(sessionID, async () => {
        const cwd = await rootDirectory(sessionID);
        if (cwd === null) return null;
        return owed.compacted ? renderAfterCompaction(sessionID, cwd) : renderBootstrap(sessionID);
      });
    });

    const controller = new AbortController();
    (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        // A failed compaction emits `session.compaction.failed` and keeps the history, bootstrap
        // included, so only a finished one owes a re-injection.
        if (event?.type !== 'session.compaction.ended') continue;
        const sessionID = event.data?.sessionID;
        if (typeof sessionID !== 'string' || (await owedAfter(ctx, sessionID)) === null) continue;
        await deliver(sessionID, async () => {
          const cwd = await rootDirectory(sessionID);
          return cwd === null ? null : renderAfterCompaction(sessionID, cwd);
        });
      }
    })().catch(() => {
      // the stream ends with an abort when opencode disposes the plugin
    });
    return async () => controller.abort();
  },
};
