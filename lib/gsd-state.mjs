import fs from 'node:fs';
import path from 'node:path';
import { isSafeBranchRef, PLAN_FEATURE_RE, PLAN_SHA256_RE } from './gsd-contract.mjs';
import { isInside, readBoundedRegularText, readDirectoryEntriesBounded } from './gsd-fs.mjs';
import { MILESTONE_FILE_MAX_BYTES, parseMilestoneLedger } from './gsd-milestone.mjs';

const STATE_SCHEMA = 'v4';
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
const LEGACY_V3_STATE_FIELD_ORDER = Object.freeze([
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
  'ponytail_level',
  'cleanup_preference',
  'checkpoint_revision',
]);
const LEGACY_V2_STATE_FIELD_ORDER = Object.freeze([
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
  'reviewer_model',
  'review_round',
  'blocking_fingerprint',
  'reviewed_commit',
  'progress_status',
  'autosync',
  'ponytail_level',
  'cleanup_preference',
  'checkpoint_revision',
]);
const LEGACY_V1_STATE_FIELD_ORDER = Object.freeze([
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
  'executor_model',
  'reviewer_model',
  'review_round',
  'blocking_fingerprint',
  'reviewed_commit',
  'progress_status',
  'autosync',
  'ponytail_level',
  'cleanup_preference',
  'checkpoint_revision',
]);
const STATE_FIELD_SET = new Set(STATE_FIELD_ORDER);
const LEGACY_V3_STATE_FIELD_SET = new Set(LEGACY_V3_STATE_FIELD_ORDER);
const LEGACY_V2_STATE_FIELD_SET = new Set(LEGACY_V2_STATE_FIELD_ORDER);
const LEGACY_V1_STATE_FIELD_SET = new Set(LEGACY_V1_STATE_FIELD_ORDER);
const LEGACY_STATE_KEYS = new Set([
  'ponytail_level',
  'mode',
  'executor_model',
  'reviewer_model',
  'review_round',
  'blocking_fingerprint',
  'reviewed_commit',
  'progress_status',
  'executor_agent',
  'reviewer_agent',
  'executor_generation',
  'reviewer_generation',
  'reload',
  'task_attempt',
  'settings',
]);
const FEATURE_RE = PLAN_FEATURE_RE;
const SHA256_RE = PLAN_SHA256_RE;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const TASK_RE = /^T[1-9]\d*$/;
const AUTOSYNC_RE = /^(none|on|off)$/;
const PONYTAIL_RE = /^(none|lite|full|ultra)$/;
const CLEANUP_RE = /^(none|delete|retain|archive-and-delete)$/;
const PROGRESS_RE = /^(none|advanced|blocked|pending)$/;
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
    if (!fieldSet.has(key) && LEGACY_STATE_KEYS.has(key)) {
      throw new Error(`${label}: legacy key rejected: ${key}`);
    }
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
function migrateLegacyState(legacy, label) {
  const migrated = Object.create(null);
  for (const key of STATE_FIELD_ORDER) {
    migrated[key] = key === 'schema' ? STATE_SCHEMA : legacy[key];
  }
  migrated.checkpoint_revision = (BigInt(migrated.checkpoint_revision) + 1n).toString();
  return validateState(migrated, label);
}

function parseLegacyV3State(content, label) {
  const legacy = parseStateFields(
    content,
    label,
    LEGACY_V3_STATE_FIELD_ORDER,
    LEGACY_V3_STATE_FIELD_SET,
  );
  if (legacy.schema !== 'v3') {
    throw new Error(`${label}: unsupported legacy schema: ${legacy.schema}`);
  }
  validateCommonState(legacy, label);
  validateLegacyPonytail(legacy, label);
  return migrateLegacyState(legacy, label);
}

function parseLegacyV2State(content, label) {
  const legacy = parseStateFields(
    content,
    label,
    LEGACY_V2_STATE_FIELD_ORDER,
    LEGACY_V2_STATE_FIELD_SET,
  );
  return migrateLegacyState(validateLegacyV2State(legacy, label), label);
}

function parseLegacyV1State(content, label) {
  const legacy = parseStateFields(
    content,
    label,
    LEGACY_V1_STATE_FIELD_ORDER,
    LEGACY_V1_STATE_FIELD_SET,
  );
  if (legacy.schema !== 'v1') {
    throw new Error(`${label}: unsupported legacy schema: ${legacy.schema}`);
  }
  if (!ACTIVE_STATE_PHASES.includes(legacy.phase)) {
    throw new Error(`${label}: legacy phase must be active`);
  }
  if (!isConcreteModelSelector(legacy.executor_model)) {
    throw new Error(`${label}: legacy executor_model must be a concrete bound model selector`);
  }
  if (!isConcreteModelSelector(legacy.reviewer_model)) {
    throw new Error(`${label}: legacy reviewer_model must be a concrete bound model selector`);
  }
  if (legacy.executor_model === legacy.reviewer_model) {
    throw new Error(`${label}: legacy executor and reviewer models must be distinct`);
  }

  const legacyV2 = Object.create(null);
  for (const key of LEGACY_V2_STATE_FIELD_ORDER) {
    legacyV2[key] = key === 'schema' ? 'v2' : legacy[key];
  }
  return migrateLegacyState(validateLegacyV2State(legacyV2, label), label);
}
function isConcreteModelSelector(value) {
  if (typeof value !== 'string' || value === '' || value === NONE) return false;
  if (value !== value.trim()) return false;
  if (/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) return false;

  const lowered = value.toLowerCase();
  // Reject bare role aliases and built-in OMP generic roles; require a concrete provider/model selector.
  if (
    lowered === 'task' ||
    lowered === 'advisor' ||
    lowered === 'gsdexecutor' ||
    lowered === 'gsdreviewer' ||
    lowered === '@gsdexecutor' ||
    lowered === '@gsdreviewer' ||
    lowered === 'modelroles.gsdexecutor' ||
    lowered === 'modelroles.gsdreviewer' ||
    lowered === 'unassigned' ||
    lowered === 'pending' ||
    lowered === 'none'
  ) {
    return false;
  }

  // Concrete bound selectors: <provider>/<model> with optional :variant on the model.
  // Both provider and model must be non-empty valid segments; reject bare "/", empty sides, and multi-slash forms.
  // Examples accepted: xai-oauth/grok-4.5 , openai-codex/gpt-5.5:high
  const CONCRETE_MODEL_SELECTOR_RE =
    /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
  return CONCRETE_MODEL_SELECTOR_RE.test(value);
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
      if (LEGACY_STATE_KEYS.has(key)) {
        throw new Error(`${label}: legacy key rejected: ${key}`);
      }
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
function validateLegacyPonytail(state, label) {
  if (!PONYTAIL_RE.test(state.ponytail_level)) {
    throw new Error(`${label}: invalid ponytail_level`);
  }
  return state;
}
function validateLegacyV2State(input, label = 'state.toon') {
  const state = copyStateFields(
    input,
    LEGACY_V2_STATE_FIELD_ORDER,
    LEGACY_V2_STATE_FIELD_SET,
    label,
  );
  if (state.schema !== 'v2') {
    throw new Error(`${label}: unsupported legacy schema: ${state.schema}`);
  }
  if (!ACTIVE_STATE_PHASES.includes(state.phase)) {
    throw new Error(`${label}: legacy phase must be active`);
  }
  validateCommonState(state, label);
  validateLegacyPonytail(state, label);

  if (state.phase === 'draft') {
    if (state.reviewer_model !== NONE) {
      throw new Error(`${label}: draft reviewer model selector must be none`);
    }
  } else if (!isConcreteModelSelector(state.reviewer_model)) {
    throw new Error(`${label}: reviewer_model must be a concrete bound model selector`);
  }
  if (state.review_round !== NONE && !/^[1-9]\d*$/.test(state.review_round)) {
    throw new Error(`${label}: invalid review_round`);
  }
  if (state.blocking_fingerprint !== NONE && !SHA256_RE.test(state.blocking_fingerprint)) {
    throw new Error(`${label}: invalid blocking_fingerprint`);
  }
  if (state.reviewed_commit !== NONE && !COMMIT_RE.test(state.reviewed_commit)) {
    throw new Error(`${label}: invalid reviewed_commit`);
  }
  if (!PROGRESS_RE.test(state.progress_status)) {
    throw new Error(`${label}: invalid progress_status`);
  }
  if (['draft', 'approved', 'executing', 'paused'].includes(state.phase)) {
    const populated = ['review_round', 'blocking_fingerprint', 'reviewed_commit', 'progress_status']
      .filter((field) => state[field] !== NONE);
    if (populated.length > 0) {
      throw new Error(
        `${label}: review progress must be none before terminal phases: ${populated.join(', ')} set in phase ${state.phase}`,
      );
    }
  }
  return state;
}
function validateState(input, label = 'state.toon') {
  const state = copyStateFields(input, STATE_FIELD_ORDER, STATE_FIELD_SET, label);
  if (state.schema !== STATE_SCHEMA) {
    throw new Error(`${label}: unsupported schema: ${state.schema}`);
  }
  return validateCommonState(state, label);
}
function serializeState(input) {
  const state = validateState(input);
  return STATE_FIELD_ORDER.map((key) => `${key}:${state[key]}`).join('\n') + '\n';
}
function parseLegacyCompletedState(content, label) {
  let schema;
  let fieldOrder;
  let fieldSet;
  if (/^schema:v1(?:\r?\n|$)/.test(content)) {
    schema = 'v1';
    fieldOrder = LEGACY_V1_STATE_FIELD_ORDER;
    fieldSet = LEGACY_V1_STATE_FIELD_SET;
  } else if (/^schema:v2(?:\r?\n|$)/.test(content)) {
    schema = 'v2';
    fieldOrder = LEGACY_V2_STATE_FIELD_ORDER;
    fieldSet = LEGACY_V2_STATE_FIELD_SET;
  } else if (/^schema:v3(?:\r?\n|$)/.test(content)) {
    schema = 'v3';
    fieldOrder = LEGACY_V3_STATE_FIELD_ORDER;
    fieldSet = LEGACY_V3_STATE_FIELD_SET;
  } else {
    return null;
  }

  const legacy = parseStateFields(content, label, fieldOrder, fieldSet);
  if (legacy.schema !== schema) {
    throw new Error(`${label}: unsupported legacy schema: ${legacy.schema}`);
  }
  if (!COMPLETED_STATE_PHASES.includes(legacy.phase)) return null;

  // Completed legacy packets are inert. Validate their canonical state fields,
  // but leave obsolete review progress untouched and never migrate the file.
  validateLegacyPonytail(legacy, label);
  return validateCommonState(legacy, label);
}
function readStateFileInternal(statePath, allowLegacyCompleted, migrateLegacy = true) {
  if (typeof statePath !== 'string' || path.basename(statePath) !== STATE_FILE) {
    throw new Error(`${statePath}: expected ${STATE_FILE}`);
  }
  const featureMeta = resolveFeatureDirectory(path.dirname(statePath));
  const resolvedStatePath = path.join(featureMeta.absolute, STATE_FILE);

  // fd-anchored read: pin scratch → feature, then read state.toon through feature fd.
  let scratchFd;
  let featureFd;
  try {
    const scratchFlags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0);
    scratchFd = fs.openSync(featureMeta.scratchDir, scratchFlags);
    const scratchOpened = fs.fstatSync(scratchFd);
    if (
      scratchOpened.dev !== featureMeta.scratchIdentity.dev ||
      scratchOpened.ino !== featureMeta.scratchIdentity.ino
    ) {
      throw new Error('.scratch identity changed before feature open');
    }

    const featurePath = process.platform === 'linux'
      ? `/proc/self/fd/${scratchFd}/${featureMeta.feature}`
      : process.platform === 'darwin'
        ? `/dev/fd/${scratchFd}/${featureMeta.feature}`
        : null;
    if (!featurePath) throw new Error('fd-anchored reads unavailable on this platform');
    const featureFlags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0);
    featureFd = fs.openSync(featurePath, featureFlags);
    const featureOpened = fs.fstatSync(featureFd);
    if (
      featureOpened.dev !== featureMeta.featureIdentity.dev ||
      featureOpened.ino !== featureMeta.featureIdentity.ino
    ) {
      throw new Error('feature identity changed before state read');
    }

    const content = readBoundedRegularText(
      resolvedStatePath,
      STATE_FILE_MAX_BYTES,
      resolvedStatePath,
      featureMeta.absolute,
      featureFd,
    );
    return parseStateContent(content, resolvedStatePath, featureMeta, allowLegacyCompleted, migrateLegacy);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('state.toon:')) throw error;
    const wrapped = new Error(`state.toon: ${error.message}`);
    if (error && error.contractFailure === "io-error") wrapped.contractFailure = "io-error";
    throw wrapped;
  } finally {
    if (featureFd !== undefined) try { fs.closeSync(featureFd); } catch { /* ignore */ }
    if (scratchFd !== undefined) try { fs.closeSync(scratchFd); } catch { /* ignore */ }
  }
}
function parseStateContent(content, resolvedStatePath, featureMeta, allowLegacyCompleted, migrateLegacy) {
  const bindFeature = (state) => {
    if (state.feature !== featureMeta.feature) {
      throw new Error(
        `${resolvedStatePath}: featureDir basename/state.feature mismatch: ${featureMeta.feature} != ${state.feature}`,
      );
    }
    return state;
  };

  if (allowLegacyCompleted) {
    const completed = parseLegacyCompletedState(content, resolvedStatePath);
    if (completed) return bindFeature(completed);
  }
  if (/^schema:v1(?:\r?\n|$)/.test(content)) {
    const migrated = bindFeature(parseLegacyV1State(content, resolvedStatePath));
    return migrateLegacy ? writeStateAtomic(featureMeta.absolute, migrated) : migrated;
  }
  if (/^schema:v2(?:\r?\n|$)/.test(content)) {
    const migrated = bindFeature(parseLegacyV2State(content, resolvedStatePath));
    return migrateLegacy ? writeStateAtomic(featureMeta.absolute, migrated) : migrated;
  }
  if (/^schema:v3(?:\r?\n|$)/.test(content)) {
    const migrated = bindFeature(parseLegacyV3State(content, resolvedStatePath));
    return migrateLegacy ? writeStateAtomic(featureMeta.absolute, migrated) : migrated;
  }
  return bindFeature(parseState(content, resolvedStatePath));
}
function readStateFile(statePath) {
  return readStateFileInternal(statePath, false, true);
}

// Hardened read without legacy migration: validation must never write.
function inspectStateFile(statePath) {
  return readStateFileInternal(statePath, false, false);
}

function readCandidateStateFile(statePath) {
  return readStateFileInternal(statePath, true, false);
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
function openStableFeatureDirectory(featureMeta) {
  let fd;
  try {
    const flags =
      fs.constants.O_RDONLY |
      (fs.constants.O_DIRECTORY ?? 0) |
      (fs.constants.O_NOFOLLOW ?? 0);
    fd = fs.openSync(featureMeta.absolute, flags);
    const opened = fs.fstatSync(fd);
    if (
      opened.dev !== featureMeta.featureIdentity.dev ||
      opened.ino !== featureMeta.featureIdentity.ino
    ) {
      throw new Error(`featureDir identity changed before write: ${featureMeta.absolute}`);
    }

    const fdPath = process.platform === 'linux'
      ? `/proc/self/fd/${fd}`
      : process.platform === 'darwin'
        ? `/dev/fd/${fd}`
        : null;
    if (!fdPath) {
      throw new Error('stable feature directory handles are unavailable on this platform');
    }
    let resolvedFdPath;
    try {
      resolvedFdPath = fs.realpathSync(fdPath);
    } catch (error) {
      throw new Error(`cannot resolve stable feature directory handle (${error.message})`);
    }
    if (resolvedFdPath !== featureMeta.absolute) {
      throw new Error(`featureDir handle resolved unexpectedly: ${resolvedFdPath}`);
    }
    return { fd, path: fdPath };
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    throw error;
  }
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

  let directoryFd;
  let target;
  let temp;
  let fd;
  let ownsTemp = false;
  let tempIdentity = null;
  try {
    const stableDirectory = openStableFeatureDirectory(featureMeta);
    directoryFd = stableDirectory.fd;
    target = path.join(stableDirectory.path, STATE_FILE);
    temp = path.join(stableDirectory.path, `.${STATE_FILE}.${process.pid}.${Date.now()}.tmp`);

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

    fs.renameSync(temp, target);
    ownsTemp = false;
    tempIdentity = null;

    try {
      fs.fsyncSync(directoryFd);
    } catch {
      // Directory fsync is best-effort where unsupported.
    }

    const stableRoot = fs.realpathSync(path.dirname(target));
    const readBack = parseState(
      readBoundedRegularText(target, STATE_FILE_MAX_BYTES, target, stableRoot),
      target,
    );
    if (readBack.feature !== state.feature || serializeState(readBack) !== body) {
      throw new Error(`${target}: read-back validation failed`);
    }
    return readBack;
  } catch (error) {
    try {
      if (ownsTemp && tempIdentity && temp) {
        const current = fs.lstatSync(temp);
        if (current.isFile() && current.dev === tempIdentity.dev && current.ino === tempIdentity.ino) {
          fs.unlinkSync(temp);
        }
      }
    } catch {
      // Preserve any path whose identity no longer matches this invocation.
    }
    throw sanitizeStateError(error, 'state.toon');
  } finally {
    if (directoryFd !== undefined) {
      try { fs.closeSync(directoryFd); } catch { /* ignore */ }
    }
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
      content = readBoundedRegularText(path.join(gsdDocs, name, 'milestones.md'), MILESTONE_FILE_MAX_BYTES, `${name}/milestones.md`);
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
    } catch {
      continue;
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
