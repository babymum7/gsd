// Harness-generic session-context helpers shared by every host adapter: candidate
// discovery for the recovery capsule and the per-session marker store an adapter
// uses to inject the bootstrap once and the capsule once after a compaction. This
// module names no host identifier; each adapter supplies its own base directory and
// maps these results onto its own events.

import fs from 'node:fs';
import path from 'node:path';
import { createCapsule } from './gsd-bootstrap.mjs';
import { detectCandidates } from './gsd-state.mjs';

export function renderRecoveryCapsule(gsdRoot, cwd) {
  let candidates = [];
  try {
    ({ candidates } = detectCandidates(cwd, { faultTolerant: true }));
  } catch {
    candidates = [];
  }
  if (candidates.length === 0) return null;
  return createCapsule(candidates, gsdRoot);
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
