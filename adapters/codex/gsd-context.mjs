#!/usr/bin/env node
// Codex adapter for GSD. It is host-specific by design: it names Codex hook events
// and reads their stdin payloads, then injects the exact bootstrap and recovery
// capsule that the harness-generic core in lib/ renders. See adapters/README.md.
//
// Events handled:
//   SessionStart     -> inject the bootstrap, or the recovery capsule when the session
//                       started from a compaction or a resume (`source: "compact"`/`"resume"`)
//   UserPromptSubmit -> inject the bootstrap once when no SessionStart ran
//
// Ordinary prompts emit nothing, so per-turn token cost stays at zero. Codex fires
// SessionStart with `source: "compact"` or `"resume"` before the next model request,
// so no capsule has to be staged on a pre-compaction hook.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBootstrap, sanitizeBootstrapError } from '../../lib/gsd-bootstrap.mjs';
import { loadSubagentProfiles, withSubagentProfiles } from '../../lib/gsd-settings.mjs';
import {
  createMarkerStore,
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
const STATE_ROOT = path.join(os.tmpdir(), 'gsd-codex');

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

// The core render plus the user's codex sub-agent profiles, when any are set, and the
// session owner token that scopes which packets this session may see.
function renderBootstrap(owner) {
  return withSessionOwner(
    withSubagentProfiles(createBootstrap(GSD_ROOT), loadSubagentProfiles('codex', '`spawn_agent` `model`')),
    owner,
  );
}

function ownerOf(input) {
  return sessionOwnerToken('codex', input.session_id);
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

function handleSessionStart(input) {
  const store = createMarkerStore(STATE_ROOT, input.session_id);
  store.write('bootstrap-emitted');
  if (input.source === 'compact' || input.source === 'resume') {
    const capsule = renderRecoveryCapsule(GSD_ROOT, cwdOf(input), ownerOf(input));
    // A compaction drops the bootstrap injected earlier, so it comes back before the capsule;
    // a resume replays it with the transcript.
    if (capsule) {
      emit('SessionStart', input.source === 'compact' ? `${renderBootstrap(ownerOf(input))}\n\n${capsule}` : capsule);
      return;
    }
  }
  emit('SessionStart', renderBootstrap(ownerOf(input)));
}

function handleUserPromptSubmit(input) {
  const store = createMarkerStore(STATE_ROOT, input.session_id);
  if (store.read('bootstrap-emitted')) return;
  store.write('bootstrap-emitted');
  emit('UserPromptSubmit', renderBootstrap(ownerOf(input)));
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
