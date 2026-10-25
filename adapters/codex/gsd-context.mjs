#!/usr/bin/env node
// Codex adapter for GSD. It is host-specific by design: it names Codex hook events
// and reads their stdin payloads, then injects the exact bootstrap and recovery
// capsule that the harness-generic core in lib/ renders. See adapters/README.md.
//
// Events handled:
//   SessionStart     -> inject the bootstrap, then the recovery capsule after a compaction;
//                       a resume of a session that already got the bootstrap gets only the
//                       capsule, or nothing when it owns no packet
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
  bootstrapDigest,
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
  const owner = ownerOf(input);
  const bootstrap = renderBootstrap(owner);
  const digest = bootstrapDigest(bootstrap);
  const current = store.read('bootstrap-emitted') === digest;
  store.write('bootstrap-emitted', digest);
  const capsule = input.source === 'compact' || input.source === 'resume'
    ? renderRecoveryCapsule(GSD_ROOT, cwdOf(input), owner)
    : null;
  // A resume replays the transcript, so a bootstrap this session already got is still in it and
  // only the capsule, if any, is new; a bootstrap GSD has since changed, such as a new sub-agent
  // model, comes again. A compaction drops it, so it comes back before the capsule.
  if (input.source === 'resume' && current) {
    emit('SessionStart', capsule);
    return;
  }
  emit('SessionStart', capsule ? `${bootstrap}\n\n${capsule}` : bootstrap);
}

function handleUserPromptSubmit(input) {
  const store = createMarkerStore(STATE_ROOT, input.session_id);
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
