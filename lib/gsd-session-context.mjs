// Harness-generic session-context helpers shared by every host adapter: the session owner
// token, candidate discovery for the recovery capsule, and the per-session marker store an
// adapter uses to inject the bootstrap once and the capsule once after a compaction. This
// module names no host identifier; each adapter supplies its own base directory and
// maps these results onto its own events.

import fs from 'node:fs';
import path from 'node:path';
import { createCapsule } from './gsd-bootstrap.mjs';
import { detectCandidates } from './gsd-state.mjs';

// A packet's `owner` is this token, so parallel sessions in one work tree never see each
// other's features. The adapter supplies its host label as `prefix`; no id means no token.
export function sessionOwnerToken(prefix, sessionId) {
  const id = String(sessionId ?? '').replace(/[^A-Za-z0-9._:-]/g, '_');
  if (!id) return null;
  return `${prefix}-${id}`.slice(0, 160);
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
  return `${capsule}\n[GSD Current Request]\n${request}`;
}

export function createMarkerStore(baseDir, sessionId) {
  const safe = String(sessionId ?? 'unknown')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 128);
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
    write(name, text = '1') {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), text);
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
