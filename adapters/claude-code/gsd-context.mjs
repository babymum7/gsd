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

// A transcript Claude Code continues under a new session id starts with the id it began with,
// and its first GSD hook outputs carry that earlier token. Only the head of the file is read,
// since a transcript can be tens of megabytes and those outputs come first.
const TRANSCRIPT_HEAD_BYTES = 4 * 1024 * 1024;
const GSD_HOOK_EVENTS = new Set(['SessionStart', 'UserPromptSubmit']);
const FORK_HOOK_NAME = 'SessionStart:fork';
const OWNER_TOKEN_PATTERN = /GSD_SESSION: (claude-[A-Za-z0-9._:-]+)/g;

function readTranscriptHead(transcriptPath) {
  let fd = null;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    const buffer = Buffer.alloc(TRANSCRIPT_HEAD_BYTES);
    const read = fs.readSync(fd, buffer, 0, TRANSCRIPT_HEAD_BYTES, 0);
    return buffer.toString('utf8', 0, read);
  } catch {
    return '';
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // nothing is left open that a later read needs
      }
    }
  }
}

// Only GSD's own hook attachments count: a tool result or message that quotes a token is not
// a session this transcript ran under. A final line the byte limit cut fails to parse and is skipped.
function inheritedOwners(input, current, forked) {
  if (forked) return [];
  const transcriptPath = input.transcript_path;
  if (typeof transcriptPath !== 'string' || transcriptPath === '') return [];
  const tokens = new Set();
  for (const line of readTranscriptHead(transcriptPath).split('\n')) {
    if (!line.includes('GSD_SESSION: ')) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const attachment = record?.type === 'attachment' ? record.attachment : null;
    if (!attachment || !GSD_HOOK_EVENTS.has(attachment.hookEvent)) continue;
    const text = JSON.stringify(attachment);
    // A fork copies its parent's history but is a second session; the parent may still run.
    if (attachment.hookName === FORK_HOOK_NAME && text.includes(`GSD_SESSION: ${current}`)) return [];
    for (const match of text.matchAll(OWNER_TOKEN_PATTERN)) {
      if (match[1] !== current) tokens.add(match[1]);
    }
  }
  return [...tokens];
}

function handleSessionStart(input) {
  const store = createMarkerStore(STATE_ROOT, input.session_id);
  const source = sourceOf(input);
  // A fork's transcript head carries its parent's token, so the fork never inherits from it.
  if (source === 'fork') store.write('forked');
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
      ? renderRecoveryCapsule(
          GSD_ROOT,
          cwdOf(input),
          ownerOf(input),
          inheritedOwners(input, ownerOf(input), store.read('forked') !== null),
        )
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
