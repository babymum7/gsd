// Harness-generic session-context helpers shared by every host adapter: the session owner
// token, candidate discovery for the recovery capsule, and the per-session marker store an
// adapter uses to inject the bootstrap once and the capsule once after a compaction. This
// module names no host identifier; each adapter supplies its own base directory and
// maps these results onto its own events.

import { spawnSync } from 'node:child_process';
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

// A session no host id names mints its own token, so two such sessions never share an owner.
// Nothing carries the minted token across a compaction, so the line says what that costs.
export function unsetSessionLine(gsdRoot = '<GSD_ROOT>') {
  return (
    'GSD_SESSION: unset. No host session id names this session: before the first `.scratch` write, ' +
    `run \`bun "${gsdRoot}/tools/gsd-state.mjs" session\` once and use the token it prints as GSD_SESSION ` +
    'for the rest of the session. If a compaction loses it, mint another; a packet recorded under the old ' +
    'token then resumes only when the user names it.'
  );
}

export function withSessionOwner(bootstrap, token) {
  const closing = '\n</GSD_BOOTSTRAP>';
  if (!bootstrap.endsWith(closing)) return bootstrap;
  const line = token ? `GSD_SESSION: ${token}` : unsetSessionLine();
  return `${bootstrap.slice(0, -closing.length)}\n\n${line}${closing}`;
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
export function renderPacketNotes({ malformed = [], retired = [], elsewhere = [] } = {}) {
  const lines = [];
  for (const { worktree, features } of elsewhere) {
    lines.push(`GSD features owned by this session in the worktree ${worktree} (resume them from there): ${listNames(features)}`);
  }
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

// The work tree holding `cwd` and the repository's other worktrees. A session started in a
// subdirectory keeps its packets at the work tree root, and one that cut a linked worktree
// keeps them there; outside Git, `cwd` is the only place to look.
function worktreesOf(cwd) {
  const run = (args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  const top = run(['rev-parse', '--show-toplevel']);
  if (top.error || top.status !== 0) return { self: cwd, others: [] };
  const self = top.stdout.trim();
  const listing = run(['worktree', 'list', '--porcelain']);
  const all = listing.status === 0
    ? listing.stdout.split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice(9))
    : [];
  return { self, others: all.filter((dir) => dir !== self) };
}

function scanOwned(dir, owner) {
  try {
    return detectCandidates(dir, { faultTolerant: true, owner });
  } catch {
    return null;
  }
}

// Without an owner token the capsule stays silent: listing every packet in the work tree
// is what led a second session to resume a feature it never started. Packets this session
// owns in another worktree are named with that path; tools run against the cwd's `.scratch/`,
// so only the current work tree's packets resume in place.
export function renderRecoveryCapsule(gsdRoot, cwd, owner) {
  if (!owner) return null;
  const { self, others } = worktreesOf(cwd);
  const scan = scanOwned(self, owner) ?? {};
  const elsewhere = others
    .map((worktree) => ({ worktree, features: scanOwned(worktree, owner)?.candidates ?? [] }))
    .filter(({ features }) => features.length > 0);
  return composeRecoveryCapsule({ ...scan, elsewhere }, gsdRoot, owner);
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
