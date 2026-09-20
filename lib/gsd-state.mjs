import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { isSafeBranchRef, PLAN_FEATURE_RE, PLAN_SHA256_RE } from './gsd-contract.mjs';
import { isInside, readDirectoryEntriesBounded, withPinnedDirectoryChain } from './gsd-fs.mjs';
import { MILESTONE_FILE_MAX_BYTES, parseMilestoneLedger } from './gsd-milestone.mjs';

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

const STATE_SCHEMA = 'v0.0.1';
const NONE = 'none';
const STATE_FILE = 'state.toon';
const STATE_FILE_MAX_BYTES = 64 * 1024;
const SCRATCH_ENTRY_LIMIT = 2048;
const FEATURE_ENTRY_LIMIT = 128;
const ACTIVE_STATE_PHASES = Object.freeze([
  'draft',
  'approved',
  'executing',
  'paused',
  'verifying',
  'repair',
  'merged-cleanup-pending',
]);
const COMPLETED_STATE_PHASES = Object.freeze(['completed-retained']);
const ALL_STATE_PHASES = Object.freeze([...ACTIVE_STATE_PHASES, ...COMPLETED_STATE_PHASES]);
const DEFAULT_PHASE_NEXT_ACTIONS = Object.freeze({
  draft: 'converge acceptance criteria',
  approved: 'start/continue task',
  executing: 'start/continue task',
  paused: 'start/continue task',
  verifying: 'enter terminal verification/repair',
  repair: 'enter terminal verification/repair',
  'merged-cleanup-pending': 'complete delete cleanup of the scratch packet and wip branch',
  'completed-retained': NONE,
});

function defaultNextActionForPhase(phase) {
  return DEFAULT_PHASE_NEXT_ACTIONS[phase] ?? null;
}
const STATE_FIELD_ORDER = Object.freeze([
  'schema',
  'feature',
  'phase',
  'next_action',
  'plan_path',
  'plan_sha256',
  'base_ref',
  'wip_branch',
  'last_green_task',
  'last_green_commit',
  'autosync',
  'cleanup_preference',
  'checkpoint_revision',
]);
const STATE_FIELD_SET = new Set(STATE_FIELD_ORDER);
const FEATURE_RE = PLAN_FEATURE_RE;
const SHA256_RE = PLAN_SHA256_RE;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const TASK_RE = /^T[1-9]\d*$/;
const AUTOSYNC_RE = /^(none|on|off)$/;
const CLEANUP_RE = /^(none|delete|retain|archive-and-delete)$/;
function isNone(value) {
  return value === NONE;
}

function requireScalar(value, field) {
  if (typeof value !== 'string') {
    throw new Error(`state.toon malformed: ${field} must be a string`);
  }
  if (value === '') {
    throw new Error(`state.toon malformed: ${field} must not be empty`);
  }
  if (/[\r\n]/.test(value) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    throw new Error(`state.toon malformed: ${field} contains invalid characters`);
  }
  return value;
}
function parseStateFields(content, label, fieldOrder, fieldSet) {
  if (typeof content !== 'string') {
    throw new Error(`${label}: content must be text`);
  }
  if (content.includes('\r')) {
    throw new Error(`${label}: state must use LF line endings; carriage return rejected`);
  }
  if (content === '' || content.includes('\0')) {
    throw new Error(`${label}: malformed empty or binary content`);
  }
  const lines = content.endsWith('\n')
    ? content.slice(0, -1).split('\n')
    : content.split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
    throw new Error(`${label}: malformed empty content`);
  }
  const schemaRow = lines[0].match(/^schema:(.*)$/);
  if (schemaRow !== null && schemaRow[1] !== STATE_SCHEMA) {
    const unsupported = new Error(`${label}: unsupported schema: ${schemaRow[1]}`);
    unsupported.contractFailure = 'unsupported-schema';
    throw unsupported;
  }

  const fields = Object.create(null);
  for (const line of lines) {
    if (line === '') {
      throw new Error(`${label}: blank lines are not allowed`);
    }
    const idx = line.indexOf(':');
    if (idx <= 0) {
      throw new Error(`${label}: malformed row: ${line}`);
    }
    const key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    if (!fieldSet.has(key)) {
      throw new Error(`${label}: unknown key: ${key}`);
    }
    if (Object.hasOwn(fields, key)) {
      throw new Error(`${label}: duplicate key: ${key}`);
    }
    if (value === '') {
      throw new Error(`${label}: empty value for ${key}`);
    }
    fields[key] = value;
  }

  for (const key of fieldOrder) {
    if (!Object.hasOwn(fields, key)) {
      throw new Error(`${label}: missing required field: ${key}`);
    }
  }

  const keys = Object.keys(fields);
  for (let i = 0; i < fieldOrder.length; i++) {
    if (keys[i] !== fieldOrder[i]) {
      throw new Error(`${label}: fields must appear in canonical order`);
    }
  }
  return fields;
}
function parseState(content, label = 'state.toon') {
  return validateState(
    parseStateFields(content, label, STATE_FIELD_ORDER, STATE_FIELD_SET),
    label,
  );
}
function isValidWipBranch(wipBranch, feature) {
  if (typeof wipBranch !== 'string' || typeof feature !== 'string') return false;
  return wipBranch === `wip/${feature}`;
}
function copyStateFields(input, fieldOrder, fieldSet, label) {
  if (!input || typeof input !== 'object') {
    throw new Error(`${label}: state must be an object`);
  }
  const state = Object.create(null);
  for (const key of fieldOrder) {
    if (!Object.hasOwn(input, key)) {
      throw new Error(`${label}: missing required field: ${key}`);
    }
    state[key] = requireScalar(input[key], key);
  }
  for (const key of Object.keys(input)) {
    if (!fieldSet.has(key)) {
      throw new Error(`${label}: unknown key: ${key}`);
    }
  }
  return state;
}
function validateCommonState(state, label) {
  if (!FEATURE_RE.test(state.feature) || Buffer.byteLength(state.feature, 'utf8') > 255) {
    throw new Error(`${label}: invalid feature slug`);
  }
  if (!ALL_STATE_PHASES.includes(state.phase)) {
    throw new Error(`${label}: unsupported phase: ${state.phase}`);
  }
  if (state.next_action !== NONE && state.next_action.trim() !== state.next_action) {
    throw new Error(`${label}: invalid next_action`);
  }

  if (state.phase === 'draft') {
    if (state.plan_path !== NONE || state.plan_sha256 !== NONE) {
      throw new Error(`${label}: draft plan binding must be none`);
    }
    if (state.base_ref !== NONE || state.wip_branch !== NONE) {
      throw new Error(`${label}: draft git identity must be none`);
    }
    if (state.last_green_task !== NONE || state.last_green_commit !== NONE) {
      throw new Error(`${label}: draft last-green fields must be none`);
    }
  } else {
    if (state.plan_path === NONE || state.plan_sha256 === NONE) {
      throw new Error(`${label}: approved phases require plan binding`);
    }
    if (!/^\.scratch\/[a-z0-9]+(?:-[a-z0-9]+)*\/plan\.md$/.test(state.plan_path)) {
      throw new Error(`${label}: invalid plan_path`);
    }
    const planFeatureMatch = state.plan_path.match(/^\.scratch\/([a-z0-9]+(?:-[a-z0-9]+)*)\/plan\.md$/);
    if (!planFeatureMatch || planFeatureMatch[1] !== state.feature) {
      throw new Error(`${label}: plan_path feature mismatch`);
    }
    if (!SHA256_RE.test(state.plan_sha256)) {
      throw new Error(`${label}: invalid plan_sha256`);
    }
    if (state.base_ref === NONE || state.wip_branch === NONE) {
      throw new Error(`${label}: git identity required after approval`);
    }
    if (!isValidWipBranch(state.wip_branch, state.feature)) {
      throw new Error(`${label}: wip_branch feature mismatch: expected "wip/${state.feature}"`);
    }
  }

  if (state.phase === 'completed-retained') {
    if (state.next_action !== NONE) {
      throw new Error(`${label}: completed-retained next_action must be none`);
    }
  } else if (isNone(state.next_action)) {
    throw new Error(`${label}: next_action is required for phase ${state.phase}`);
  }

  // `base_ref` is the recorded merge target, so a Git command consumes it verbatim. Shape it
  // here, before any caller interpolates it, and reject a base that names the branch being
  // squashed: the terminal merge would target its own source.
  if (state.base_ref !== NONE) {
    if (!isSafeBranchRef(state.base_ref)) {
      throw new Error(`${label}: base_ref must be a Git branch name able to receive the merge`);
    }
    if (state.base_ref === `wip/${state.feature}`) {
      throw new Error(`${label}: base_ref must not be its own WIP branch wip/${state.feature}`);
    }
  }
  if (state.last_green_task !== NONE && !TASK_RE.test(state.last_green_task)) {
    throw new Error(`${label}: invalid last_green_task`);
  }
  if (state.last_green_commit !== NONE && !COMMIT_RE.test(state.last_green_commit)) {
    throw new Error(`${label}: invalid last_green_commit`);
  }
  if ((state.last_green_task === NONE) !== (state.last_green_commit === NONE)) {
    throw new Error(`${label}: last_green_task and last_green_commit must both be set or none`);
  }
  if (!AUTOSYNC_RE.test(state.autosync)) {
    throw new Error(`${label}: invalid autosync`);
  }
  if (!CLEANUP_RE.test(state.cleanup_preference)) {
    throw new Error(`${label}: invalid cleanup_preference`);
  }
  if (!/^[1-9]\d*$/.test(state.checkpoint_revision)) {
    throw new Error(`${label}: invalid checkpoint_revision`);
  }
  return state;
}
function validateState(input, label = 'state.toon') {
  const state = copyStateFields(input, STATE_FIELD_ORDER, STATE_FIELD_SET, label);
  if (state.schema !== STATE_SCHEMA) {
    const error = new Error(`${label}: unsupported schema: ${state.schema}`);
    error.contractFailure = 'unsupported-schema';
    throw error;
  }
  return validateCommonState(state, label);
}
function serializeState(input) {
  const state = validateState(input);
  return STATE_FIELD_ORDER.map((key) => `${key}:${state[key]}`).join('\n') + '\n';
}
function readStateFileInternal(statePath, candidateMode = false) {
  if (typeof statePath !== 'string' || path.basename(statePath) !== STATE_FILE) {
    throw new Error(`${statePath}: expected ${STATE_FILE}`);
  }
  const featureMeta = resolveFeatureDirectory(path.dirname(statePath));
  const resolvedStatePath = path.join(featureMeta.absolute, STATE_FILE);

  const hops = [
    { name: featureMeta.scratchDir, identity: featureMeta.scratchIdentity },
    { name: featureMeta.feature, identity: featureMeta.featureIdentity },
  ];

  try {
    const content = withPinnedDirectoryChain(hops, () => {
      let fd;
      try {
        const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | fs.constants.O_NONBLOCK;
        try {
          fd = fs.openSync(STATE_FILE, flags);
        } catch (error) {
          if (error.code === 'ELOOP') throw new Error(`${STATE_FILE}: symlink rejected`);
          if (error.code === 'ENOENT') {
            const notFound = new Error(`${STATE_FILE}: file not found`);
            notFound.contractFailure = 'io-error';
            throw notFound;
          }
          const openError = new Error(`${STATE_FILE}: cannot open file (${error.message})`);
          openError.contractFailure = 'io-error';
          throw openError;
        }
        const opened = fs.fstatSync(fd);
        if (!opened.isFile()) throw new Error(`${STATE_FILE}: expected a regular file`);
        if (opened.size > STATE_FILE_MAX_BYTES) {
          throw new Error(`${STATE_FILE}: exceeds size limit of ${STATE_FILE_MAX_BYTES} bytes`);
        }
        const capacity = Math.min(STATE_FILE_MAX_BYTES + 1, opened.size + 1);
        const buffer = Buffer.allocUnsafe(Math.max(1, capacity));
        let total = 0;
        while (total < buffer.length) {
          const bytesRead = fs.readSync(fd, buffer, total, buffer.length - total, null);
          if (bytesRead === 0) break;
          total += bytesRead;
        }
        if (total > STATE_FILE_MAX_BYTES) {
          throw new Error(`${STATE_FILE}: exceeds size limit of ${STATE_FILE_MAX_BYTES} bytes`);
        }
        const afterRead = fs.fstatSync(fd);
        if (
          afterRead.dev !== opened.dev ||
          afterRead.ino !== opened.ino ||
          afterRead.size !== opened.size ||
          afterRead.mtimeMs !== opened.mtimeMs ||
          afterRead.ctimeMs !== opened.ctimeMs
        ) {
          throw new Error(`${STATE_FILE}: file changed during read`);
        }
        try {
          return UTF8_DECODER.decode(buffer.subarray(0, total));
        } catch {
          const utf8Error = new Error(`${STATE_FILE}: file must be valid UTF-8`);
          utf8Error.contractFailure = 'io-error';
          throw utf8Error;
        }
      } finally {
        if (fd !== undefined) {
          try { fs.closeSync(fd); } catch { /* ignore */ }
        }
      }
    });
    return parseStateContent(content, resolvedStatePath, featureMeta, candidateMode);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('state.toon:')) throw error;
    const wrapped = new Error(`state.toon: ${error.message}`);
    if (error && error.contractFailure === "io-error") wrapped.contractFailure = "io-error";
    throw wrapped;
  }
}
function parseStateContent(content, resolvedStatePath, featureMeta, candidateMode) {
  const bindFeature = (state) => {
    if (state.feature !== featureMeta.feature) {
      throw new Error(
        `${resolvedStatePath}: featureDir basename/state.feature mismatch: ${featureMeta.feature} != ${state.feature}`,
      );
    }
    return state;
  };

  try {
    return bindFeature(parseState(content, resolvedStatePath));
  } catch (error) {
    if (candidateMode && error?.contractFailure === 'unsupported-schema') return null;
    throw error;
  }
}
function readStateFile(statePath) {
  return readStateFileInternal(statePath, false);
}

// Hardened read: validation must never write.
function inspectStateFile(statePath) {
  return readStateFileInternal(statePath, false);
}

function readCandidateStateFile(statePath) {
  return readStateFileInternal(statePath, true);
}
function sanitizeStateError(error, label = 'state.toon') {
  const message = error && typeof error.message === 'string' ? error.message : 'invalid state';
  const cleaned = message
    .replace(/\r?\n/g, ' ')
    .replace(/\/{2,}/g, '/')
    .slice(0, 300);
  if (cleaned.startsWith(label)) {
    return new Error(cleaned);
  }
  if (cleaned.startsWith('state.toon:')) {
    const stripped = cleaned.slice('state.toon:'.length).trimStart();
    return new Error(stripped ? `${label}: ${stripped}` : label);
  }
  return new Error(`${label}: ${cleaned}`);
}
function resolveFeatureDirectory(featureDir, expectedFeature = null) {
  if (typeof featureDir !== 'string' || featureDir === '') {
    throw new Error('featureDir is required');
  }
  const absolute = path.resolve(featureDir);
  let lst;
  try {
    lst = fs.lstatSync(absolute);
  } catch {
    throw new Error(`featureDir does not exist: ${featureDir}`);
  }
  if (lst.isSymbolicLink()) {
    throw new Error(`featureDir symlink rejected: ${featureDir}`);
  }
  if (!lst.isDirectory()) {
    throw new Error(`featureDir must be a directory: ${featureDir}`);
  }

  const base = path.basename(absolute);
  if (!FEATURE_RE.test(base) || Buffer.byteLength(base, 'utf8') > 255) {
    throw new Error(`featureDir basename is not a safe feature slug: ${base}`);
  }
  if (expectedFeature != null && base !== expectedFeature) {
    throw new Error(`featureDir basename/state.feature mismatch: ${base} != ${expectedFeature}`);
  }

  const parent = path.dirname(absolute);
  let parentLst;
  try {
    parentLst = fs.lstatSync(parent);
  } catch {
    throw new Error(`featureDir parent is not accessible: ${parent}`);
  }
  if (parentLst.isSymbolicLink()) {
    throw new Error(`featureDir parent symlink rejected: ${parent}`);
  }
  if (!parentLst.isDirectory() || path.basename(parent) !== '.scratch') {
    throw new Error(`featureDir must be a real directory under .scratch: ${featureDir}`);
  }

  let scratchDir;
  let realFeatureDir;
  try {
    scratchDir = fs.realpathSync(parent);
    realFeatureDir = fs.realpathSync(absolute);
  } catch (error) {
    throw new Error(`featureDir cannot resolve real path: ${featureDir} (${error.message})`);
  }
  if (path.basename(scratchDir) !== '.scratch' || !isInside(scratchDir, realFeatureDir)) {
    throw new Error(`featureDir escapes .scratch: ${featureDir}`);
  }
  const realParent = path.dirname(realFeatureDir);
  if (realParent !== scratchDir) {
    throw new Error(`featureDir must be a direct child of .scratch: ${featureDir}`);
  }

  let realParentStat;
  let realFeatureStat;
  try {
    realParentStat = fs.statSync(scratchDir);
    realFeatureStat = fs.statSync(realFeatureDir);
  } catch (error) {
    throw new Error(`featureDir cannot validate identity: ${featureDir} (${error.message})`);
  }
  if (
    realParentStat.dev !== parentLst.dev ||
    realParentStat.ino !== parentLst.ino ||
    realFeatureStat.dev !== lst.dev ||
    realFeatureStat.ino !== lst.ino
  ) {
    throw new Error(`featureDir identity changed during validation: ${featureDir}`);
  }

  return {
    absolute: realFeatureDir,
    feature: base,
    scratchDir,
    scratchIdentity: { dev: realParentStat.dev, ino: realParentStat.ino },
    featureIdentity: { dev: realFeatureStat.dev, ino: realFeatureStat.ino },
  };
}
function writeStateAtomic(featureDir, input) {
  const state = validateState(input);
  const featureMeta = resolveFeatureDirectory(featureDir, state.feature);
  if (state.plan_path !== NONE) {
    const expectedPlan = `.scratch/${state.feature}/plan.md`;
    if (state.plan_path !== expectedPlan) {
      throw new Error(`state.toon plan_path must be ${expectedPlan}`);
    }
  }
  const body = serializeState(state);
  if (Buffer.byteLength(body, 'utf8') > STATE_FILE_MAX_BYTES) {
    throw new Error(`state.toon exceeds size limit of ${STATE_FILE_MAX_BYTES} bytes`);
  }

  const hops = [
    { name: featureMeta.scratchDir, identity: featureMeta.scratchIdentity },
    { name: featureMeta.feature, identity: featureMeta.featureIdentity },
  ];
  const resolvedStatePath = path.join(featureMeta.absolute, STATE_FILE);

  try {
    return withPinnedDirectoryChain(hops, () => {
      const temp = `.${STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
      let fd;
      let ownsTemp = false;
      let tempIdentity = null;
      try {
        const flags =
          fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          (fs.constants.O_NOFOLLOW ?? 0);
        fd = fs.openSync(temp, flags, 0o644);
        const opened = fs.fstatSync(fd);
        tempIdentity = { dev: opened.dev, ino: opened.ino };
        ownsTemp = true;
        fs.writeSync(fd, body, 0, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        if (fd !== undefined) {
          try { fs.closeSync(fd); } catch { /* ignore */ }
        }
      }

      try {
        fs.renameSync(temp, STATE_FILE);
        ownsTemp = false;
        tempIdentity = null;

        let dirFd;
        try {
          const dirFlags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0);
          dirFd = fs.openSync('.', dirFlags);
          fs.fsyncSync(dirFd);
        } catch {
          // Directory fsync is best-effort where unsupported.
        } finally {
          if (dirFd !== undefined) {
            try { fs.closeSync(dirFd); } catch { /* ignore */ }
          }
        }

        let readFd;
        let readOpened;
        let content;
        try {
          const readFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | fs.constants.O_NONBLOCK;
          readFd = fs.openSync(STATE_FILE, readFlags);
          readOpened = fs.fstatSync(readFd);
          if (!readOpened.isFile()) throw new Error(`${STATE_FILE}: expected a regular file`);
          if (readOpened.size > STATE_FILE_MAX_BYTES) {
            throw new Error(`${STATE_FILE}: exceeds size limit of ${STATE_FILE_MAX_BYTES} bytes`);
          }
          const capacity = Math.min(STATE_FILE_MAX_BYTES + 1, readOpened.size + 1);
          const buffer = Buffer.allocUnsafe(Math.max(1, capacity));
          let total = 0;
          while (total < buffer.length) {
            const bytesRead = fs.readSync(readFd, buffer, total, buffer.length - total, null);
            if (bytesRead === 0) break;
            total += bytesRead;
          }
          if (total > STATE_FILE_MAX_BYTES) {
            throw new Error(`${STATE_FILE}: exceeds size limit of ${STATE_FILE_MAX_BYTES} bytes`);
          }
          const afterRead = fs.fstatSync(readFd);
          if (
            afterRead.dev !== readOpened.dev ||
            afterRead.ino !== readOpened.ino ||
            afterRead.size !== readOpened.size ||
            afterRead.mtimeMs !== readOpened.mtimeMs ||
            afterRead.ctimeMs !== readOpened.ctimeMs
          ) {
            throw new Error(`${STATE_FILE}: file changed during read`);
          }
          content = UTF8_DECODER.decode(buffer.subarray(0, total));
        } finally {
          if (readFd !== undefined) {
            try { fs.closeSync(readFd); } catch { /* ignore */ }
          }
        }

        const readBack = parseState(content, resolvedStatePath);
        if (readBack.feature !== state.feature || serializeState(readBack) !== body) {
          throw new Error(`${resolvedStatePath}: read-back validation failed`);
        }
        return readBack;
      } catch (error) {
        if (ownsTemp && tempIdentity && temp) {
          try {
            const current = fs.lstatSync(temp);
            if (current.isFile() && current.dev === tempIdentity.dev && current.ino === tempIdentity.ino) {
              fs.unlinkSync(temp);
            }
          } catch {
            // Preserve any path whose identity no longer matches this invocation.
          }
        }
        throw error;
      }
    });
  } catch (error) {
    throw sanitizeStateError(error, 'state.toon');
  }
}
// A durable ledger with a pending row survives scratch cleanup, so an incomplete feature can
// be recovered even after its `.scratch/<feature>/` packet is gone. Discovery surfaces only
// ledger-only features (no scratch directory): an existing scratch packet is the lifecycle
// authority, active or terminal, and must never be shadowed by the ledger.
function discoverMilestoneCandidates(cwd, faultTolerant) {
  const gsdDocs = path.join(cwd, 'docs', 'gsd');
  let entries;
  try {
    entries = readDirectoryEntriesBounded(gsdDocs, FEATURE_ENTRY_LIMIT, gsdDocs);
  } catch (error) {
    if (error instanceof Error && error.message.includes('entry limit')) throw error;
    return { names: [], defects: [] };
  }
  const names = [];
  const defects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (Buffer.byteLength(name, 'utf8') > 255 || !FEATURE_RE.test(name)) continue;
    if (fs.existsSync(path.join(cwd, '.scratch', name))) continue;
    let content;
    try {
      const ledgerDir = path.join(gsdDocs, name);
      const ledgerLst = fs.lstatSync(ledgerDir);
      if (ledgerLst.isSymbolicLink() || !ledgerLst.isDirectory()) continue;
      content = withPinnedDirectoryChain([
        { name: path.join(cwd, 'docs'), identity: identityAt(path.join(cwd, 'docs')) },
        { name: 'gsd', identity: identityAt(path.join(cwd, 'docs', 'gsd')) },
        { name, identity: { dev: ledgerLst.dev, ino: ledgerLst.ino } },
      ], () => readBoundedRelativeLedger('milestones.md'));
      if (content === null) continue;
    } catch {
      continue;
    }
    let ledger;
    try {
      ledger = parseMilestoneLedger(content);
    } catch (error) {
      if (faultTolerant) defects.push(`${name}: ${error.message}`);
      continue;
    }
    if (ledger.feature !== name) continue;
    if (!ledger.rows.some((row) => row.status === 'pending')) continue;
    names.push(name);
  }
  return { names, defects };
}

function mergeMilestoneCandidates(scratchCandidates, scratchDefects, milestone) {
  const candidates = [...scratchCandidates];
  for (const name of milestone.names) {
    if (!candidates.includes(name)) candidates.push(name);
  }
  return { candidates: candidates.sort(), defects: [...scratchDefects, ...milestone.defects] };
}

function detectCandidates(cwd, { faultTolerant = false } = {}) {
  const milestone = discoverMilestoneCandidates(cwd, faultTolerant);
  const requestedScratchDir = path.join(cwd, '.scratch');
  if (!fs.existsSync(requestedScratchDir)) return mergeMilestoneCandidates([], [], milestone);

  let scratchLst;
  let scratchDir;
  try {
    scratchLst = fs.lstatSync(requestedScratchDir);
    if (scratchLst.isSymbolicLink() || !scratchLst.isDirectory()) return mergeMilestoneCandidates([], [], milestone);
    scratchDir = fs.realpathSync(requestedScratchDir);
    const current = fs.statSync(scratchDir);
    if (current.dev !== scratchLst.dev || current.ino !== scratchLst.ino) {
      throw new Error(`${requestedScratchDir}: directory identity changed during validation`);
    }
  } catch (error) {
    // TOCTOU directory swap is structural, not "no features" — surface it.
    if (error instanceof Error && error.message.includes('directory identity changed')) throw error;
    return mergeMilestoneCandidates([], [], milestone);
  }

  let entries;
  try {
    entries = readDirectoryEntriesBounded(scratchDir, SCRATCH_ENTRY_LIMIT, scratchDir);
  } catch (error) {
    if (error instanceof Error && error.message.includes('entry limit')) throw error;
    return mergeMilestoneCandidates([], [], milestone);
  }

  const candidates = [];
  const defects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (Buffer.byteLength(name, 'utf8') > 255 || !FEATURE_RE.test(name)) continue;

    const featureDir = path.join(scratchDir, name);
    let featureMeta;
    try {
      featureMeta = resolveFeatureDirectory(featureDir, name);
    } catch (error) {
      if (faultTolerant) continue;
      const message = error instanceof Error ? error.message : String(error);
      if (/does not exist/.test(message)) continue;
      throw sanitizeStateError(new Error(`${name}: ${message}`), 'state.toon');
    }

    let subEntries;
    try {
      subEntries = readDirectoryEntriesBounded(
        featureMeta.absolute,
        FEATURE_ENTRY_LIMIT,
        featureMeta.absolute,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('entry limit')) throw error;
      continue;
    }

    let hasPlan = false;
    let hasState = false;
    let stateDefect = null;
    for (const subEntry of subEntries) {
      if (subEntry.name === 'plan.md' && subEntry.isFile()) hasPlan = true;
      else if (subEntry.name === STATE_FILE) {
        if (typeof subEntry.isSymbolicLink === 'function' && subEntry.isSymbolicLink()) {
          stateDefect = `${name}: symlink state.toon rejected`;
        } else if (subEntry.isFile()) hasState = true;
        else stateDefect = `${name}: state.toon must be a regular file`;
      }
    }

    if (stateDefect) {
      if (!hasPlan) continue;
      if (faultTolerant) {
        defects.push(sanitizeStateError(new Error(stateDefect), 'state.toon').message);
        continue;
      }
      throw sanitizeStateError(new Error(stateDefect), 'state.toon');
    }

    if (!hasPlan || !hasState) continue;

    let state;
    try {
      state = readCandidateStateFile(path.join(featureMeta.absolute, STATE_FILE));
    } catch (error) {
      if (faultTolerant) {
        defects.push(sanitizeStateError(error, `state.toon (${name})`).message);
        continue;
      }
      throw sanitizeStateError(error, `state.toon (${name})`);
    }
    if (state === null) continue;
    if (state.feature !== name) {
      const msg = sanitizeStateError(
        new Error(`${name}: state.feature mismatch: ${state.feature}`),
        'state.toon',
      ).message;
      if (faultTolerant) { defects.push(msg); continue; }
      throw sanitizeStateError(new Error(msg), 'state.toon');
    }
    if (COMPLETED_STATE_PHASES.includes(state.phase)) continue;
    if (!ACTIVE_STATE_PHASES.includes(state.phase)) {
      const msg = sanitizeStateError(
        new Error(`${name}: unsupported active phase ${state.phase}`),
        'state.toon',
      ).message;
      if (faultTolerant) { defects.push(msg); continue; }
      throw sanitizeStateError(new Error(msg), 'state.toon');
    }
    candidates.push(name);
  }
  return mergeMilestoneCandidates(candidates, defects, milestone);
}

export {
  ACTIVE_STATE_PHASES,
  COMPLETED_STATE_PHASES,
  DEFAULT_PHASE_NEXT_ACTIONS,
  STATE_FIELD_ORDER,
  defaultNextActionForPhase,
  detectCandidates,
  inspectStateFile,
  parseState,
  readStateFile,
  serializeState,
  validateState,
  writeStateAtomic,
};

function identityAt(p) {
  const st = fs.lstatSync(p);
  return { dev: st.dev, ino: st.ino };
}

function readBoundedRelativeLedger(basename) {
  let fd;
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | fs.constants.O_NONBLOCK;
    try {
      fd = fs.openSync(basename, flags);
    } catch {
      return null;
    }
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.size > MILESTONE_FILE_MAX_BYTES) return null;
    const capacity = Math.min(MILESTONE_FILE_MAX_BYTES + 1, opened.size + 1);
    const buffer = Buffer.allocUnsafe(Math.max(1, capacity));
    let total = 0;
    while (total < buffer.length) {
      const bytesRead = fs.readSync(fd, buffer, total, buffer.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MILESTONE_FILE_MAX_BYTES) return null;
    const afterRead = fs.fstatSync(fd);
    if (
      afterRead.dev !== opened.dev ||
      afterRead.ino !== opened.ino ||
      afterRead.size !== opened.size ||
      afterRead.mtimeMs !== opened.mtimeMs ||
      afterRead.ctimeMs !== opened.ctimeMs
    ) return null;
    try {
      return UTF8_DECODER.decode(buffer.subarray(0, total));
    } catch {
      return null;
    }
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}
