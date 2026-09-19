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
import {
  createMarkerStore,
  renderRecoveryCapsule,
  withCurrentRequest,
} from '../../lib/gsd-session-context.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GSD_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
// A generated plugin keeps canonical skills/tools under core/ and only the visible
// host skills at the plugin root; this marker distinguishes that layout.
const GSD_ROOT = fs.existsSync(path.join(DEFAULT_GSD_ROOT, '.gsd-plugin'))
  ? path.join(DEFAULT_GSD_ROOT, 'core')
  : DEFAULT_GSD_ROOT;
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
  // After a compaction or a resume the host hands the session back; deliver the live
  // capsule so the owner recovers state. A capsule staged by an older install is
  // honoured once, then rendering from disk keeps the refresh current.
  const capsule =
    source === 'compact' || source === 'resume'
      ? (store.read('capsule') ?? renderRecoveryCapsule(GSD_ROOT, cwdOf(input)))
      : null;
  store.clear('capsule');
  if (capsule) {
    store.write('bootstrap-emitted');
    emit('SessionStart', withCurrentRequest(capsule, store.read('last-request')));
    return;
  }
  // A resume replays the bootstrap already injected in the resumed transcript, so
  // emitting nothing keeps the refresh free; the next prompt injects it if it is absent.
  if (source === 'resume') return;
  store.write('bootstrap-emitted');
  emit('SessionStart', createBootstrap(GSD_ROOT));
}

function handleUserPromptSubmit(input) {
  const store = createMarkerStore(STATE_ROOT, input.session_id);
  if (typeof input.prompt === 'string' && input.prompt.trim() !== '') {
    store.write('last-request', input.prompt);
  }
  if (store.read('bootstrap-emitted')) return;
  store.write('bootstrap-emitted');
  emit('UserPromptSubmit', createBootstrap(GSD_ROOT));
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
