#!/usr/bin/env node
// Claude Code adapter for GSD. It is host-specific by design: it names Claude Code
// hook events and reads their stdin payloads, then injects the exact bootstrap and
// recovery capsule that the harness-generic core in lib/ renders. See
// adapters/README.md for the capability map and the adapter contract.
//
// Events handled:
//   SessionStart     -> inject the bootstrap on a fresh source, or the recovery capsule
//                       when the host re-runs session start after a compaction or resume
//   UserPromptSubmit -> stash the prompt, then inject the bootstrap once if SessionStart
//                       never ran
//
// Ordinary prompts emit nothing, so per-turn token cost stays at zero. Claude Code
// re-runs SessionStart after a compaction (`source: "compact"`) and on resume
// (`source: "resume"`), so no capsule has to be staged on a pre-compaction hook.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBootstrap, sanitizeBootstrapError } from '../../lib/gsd-bootstrap.mjs';
import { loadSubagentProfiles, withSubagentProfiles } from '../../lib/gsd-settings.mjs';
import {
  bootstrapDigest,
  createMarkerStore,
  renderRecoveryCapsule,
  resolveGsdRoot,
  sessionOwnerToken,
  withCurrentRequest,
  withSessionOwner,
} from '../../lib/gsd-session-context.mjs';

const GSD_ROOT = resolveGsdRoot(fileURLToPath(import.meta.url));
const STATE_ROOT = path.join(os.tmpdir(), 'gsd-claude-code');

function readInput() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return null;
  }
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// The core render plus the user's claude sub-agent profiles, when any are set, and the
// session owner token that scopes which packets this session may see.
function renderBootstrap(owner) {
  return withSessionOwner(
    withSubagentProfiles(createBootstrap(GSD_ROOT), loadSubagentProfiles('claude', 'the Agent tool `model`')),
    owner,
  );
}

function ownerOf(input) {
  return sessionOwnerToken('claude', input.session_id);
}

function emit(eventName, text) {
  if (!text) return;
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } }),
  );
}

function cwdOf(input) {
  return typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : process.cwd();
}

function sourceOf(input) {
  return typeof input.source === 'string' && input.source !== '' ? input.source : 'startup';
}

function handleSessionStart(input) {
  const store = createMarkerStore(STATE_ROOT, input.session_id);
  const source = sourceOf(input);
  const bootstrap = renderBootstrap(ownerOf(input));
  const digest = bootstrapDigest(bootstrap);
  // A resumed transcript replays the bootstrap it got; when GSD has since changed it, such as
  // a new sub-agent model, the current one comes again. An unknown session waits for its prompt.
  const stored = store.read('bootstrap-emitted');
  const stale = source === 'resume' && stored !== null && stored !== digest;
  // After a compaction or a resume the host hands the session back; deliver the live
  // capsule so the owner recovers the packets this session owns. A compaction also drops the
  // bootstrap injected earlier, so it comes back first; a resume replays it with the transcript.
  const capsule =
    source === 'compact' || source === 'resume'
      ? renderRecoveryCapsule(GSD_ROOT, cwdOf(input), ownerOf(input))
      : null;
  if (capsule) {
    store.write('bootstrap-emitted', digest);
    const recovery = withCurrentRequest(capsule, store.read('last-request'));
    emit('SessionStart', source === 'compact' || stale ? `${bootstrap}\n\n${recovery}` : recovery);
    return;
  }
  // A resume replays the bootstrap already injected in the resumed transcript, so
  // emitting nothing keeps the refresh free; the next prompt injects it if it is absent.
  if (source === 'resume' && !stale) return;
  store.write('bootstrap-emitted', digest);
  emit('SessionStart', bootstrap);
}

function handleUserPromptSubmit(input) {
  const store = createMarkerStore(STATE_ROOT, input.session_id);
  // A finished background task arrives as a prompt; it is not what the user asked for.
  if (typeof input.prompt === 'string' && input.prompt.trim() !== '' && !input.prompt.startsWith('<task-notification>')) {
    store.write('last-request', input.prompt);
  }
  if (store.read('bootstrap-emitted')) return;
  const bootstrap = renderBootstrap(ownerOf(input));
  store.write('bootstrap-emitted', bootstrapDigest(bootstrap));
  emit('UserPromptSubmit', bootstrap);
}

function main() {
  const input = readInput();
  if (!input) return;
  const event = input.hook_event_name;
  try {
    if (event === 'SessionStart') handleSessionStart(input);
    else if (event === 'UserPromptSubmit') handleUserPromptSubmit(input);
  } catch (error) {
    emit(event, sanitizeBootstrapError(error));
  }
}

main();
