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

// Without an owner token the capsule stays silent: listing every packet in the work tree
// is what led a second session to resume a feature it never started.
export function renderRecoveryCapsule(gsdRoot, cwd, owner) {
  if (!owner) return null;
  let candidates = [];
  try {
    ({ candidates } = detectCandidates(cwd, { faultTolerant: true, owner }));
  } catch {
    candidates = [];
  }
  if (candidates.length === 0) return null;
  // The compaction may drop the bootstrap that carried the token, so the capsule repeats it.
  return `${createCapsule(candidates, gsdRoot)}\nGSD_SESSION: ${owner}`;
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
