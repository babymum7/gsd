// Harness-generic session-context helpers shared by every host adapter: the session owner
// token, candidate discovery for the recovery capsule, and the per-session marker store an
// adapter uses to inject the bootstrap once and the capsule once after a compaction. This
// module names no host identifier; each adapter supplies its own base directory and
// maps these results onto its own events.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { capCurrentRequest, createCapsule } from './gsd-bootstrap.mjs';
import { detectCandidates } from './gsd-state.mjs';

// Rewriting or cutting an id can merge two sessions into one name, so a name that had to change
// carries a digest of the original id. An id that needs no change keeps its plain name, which
// keeps every name a host's own ids already produced.
const DIGEST_LENGTH = 16;
function digestOf(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, DIGEST_LENGTH);
}
function distinctName(raw, cleaned, limit) {
  if (cleaned === raw && cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit - DIGEST_LENGTH - 1)}-${digestOf(raw)}`;
}

// A packet's `owner` is this token, so parallel sessions in one work tree never see each
// other's features. The adapter supplies its host label as `prefix`; no id means no token.
export function sessionOwnerToken(prefix, sessionId) {
  const raw = String(sessionId ?? '');
  if (!raw) return null;
  return distinctName(`${prefix}-${raw}`, `${prefix}-${raw.replace(/[^A-Za-z0-9._:-]/g, '_')}`, 160);
}

export function withSessionOwner(bootstrap, token) {
  const closing = '\n</GSD_BOOTSTRAP>';
  if (!token || !bootstrap.endsWith(closing)) return bootstrap;
  return `${bootstrap.slice(0, -closing.length)}\n\nGSD_SESSION: ${token}${closing}`;
}

const NOTE_LIST_LIMIT = 5;

function listNames(names) {
  const shown = names.slice(0, NOTE_LIST_LIMIT).join(', ');
  const omitted = names.length - NOTE_LIST_LIMIT;
  return omitted > 0 ? `${shown} (and ${omitted} more)` : shown;
}

// Packets the scan skipped are named so the model stops on them instead of inferring from a
// silent gap: a malformed packet never resumes, and a retired schema needs a rebind first.
// Names are safe feature slugs, so they are interpolated verbatim.
export function renderPacketNotes({ malformed = [], retired = [] } = {}) {
  const lines = [];
  if (malformed.length > 0) {
    lines.push(`Malformed GSD packets (stop before resuming these and report the defect): ${listNames(malformed)}`);
  }
  if (retired.length > 0) {
    lines.push(`GSD packets on a retired state schema (read-state names the rebind): ${listNames(retired)}`);
  }
  return lines.length > 0 ? `[GSD Packet Notes]\n${lines.join('\n')}` : null;
}

// One composition for every adapter, so hosts inject identical recovery bytes.
// The compaction may drop the bootstrap that carried the token, so the capsule repeats it.
export function composeRecoveryCapsule(scan, gsdRoot, owner) {
  const { candidates = [] } = scan ?? {};
  const notes = renderPacketNotes(scan ?? {});
  if (candidates.length === 0 && !notes) return null;
  const parts = [];
  if (candidates.length > 0) parts.push(createCapsule(candidates, gsdRoot));
  if (notes) parts.push(notes);
  parts.push(`GSD_SESSION: ${owner}`);
  return parts.join('\n');
}

// Without an owner token the capsule stays silent: listing every packet in the work tree
// is what led a second session to resume a feature it never started.
export function renderRecoveryCapsule(gsdRoot, cwd, owner) {
  if (!owner) return null;
  let scan = null;
  try {
    scan = detectCandidates(cwd, { faultTolerant: true, owner });
  } catch {
    scan = null;
  }
  return composeRecoveryCapsule(scan, gsdRoot, owner);
}

export function withCurrentRequest(capsule, request) {
  if (!capsule || !request) return capsule;
  return `${capsule}\n[GSD Current Request]\n${capCurrentRequest(request)}`;
}

export function createMarkerStore(baseDir, sessionId) {
  // A name made only of dots would resolve to the base directory or its parent.
  const raw = String(sessionId ?? 'unknown');
  const safe = distinctName(raw, raw.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+$/, '_'), 128);
  const dir = path.join(baseDir, safe || 'unknown');
  return {
    dir,
    read(name) {
      try {
        return fs.readFileSync(path.join(dir, name), 'utf8');
      } catch {
        return null;
      }
    },
    // Best effort: a marker only saves a later prompt from repeating the bootstrap, so a
    // full or read-only temp directory must cost a repeat, never the bootstrap itself. The
    // last request is a user prompt, so the files stay owner-only.
    write(name, text = '1') {
      try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(dir, name), text, { mode: 0o600 });
      } catch {
        // the marker stays absent, which every reader already treats as "not emitted"
      }
    },
    clear(name) {
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch {
        // an absent marker is already the cleared state
      }
    },
  };
}
