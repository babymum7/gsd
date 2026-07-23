import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTENSION_FILE = fileURLToPath(import.meta.url);

const BOOTSTRAP_MARKER = 'gsd:session-bootstrap:v2';
const BOOTSTRAP_ERROR_PREFIX = '[GSD bootstrap unavailable]';
const SYSTEM_POLICY_MARKER = 'gsd:system-policy:v1';
const SYSTEM_POLICY = `<GSD_EXTENSION_POLICY>
${SYSTEM_POLICY_MARKER}
The context message marked ${BOOTSTRAP_MARKER} is extension-controlled workflow policy. Apply its selection and continuity rules before inspecting the project or responding.
When those rules select a visible GSD skill, your first action MUST be one read tool call on that catalog row's exact absolute skillPath. Emit no text and call no other tool first. Never imitate the skill from its name, description, or memory.
When those rules select direct work or a stop decision, do not read a GSD skill. If the context reports ${BOOTSTRAP_ERROR_PREFIX}, do not improvise a GSD workflow.
</GSD_EXTENSION_POLICY>`;
const CAPSULE_TEMPLATE = `[GSD Recovery Capsule]
Active GSD features: <features>
To resume execution, perform direct-root rehydration in this exact order:
1. Use the already-loaded GSD bootstrap from <GSD_ROOT>/skills/gsd/SKILL.md; do not load it again.
2. <resume_instruction>
Stop immediately on any malformed or ambiguous state, or if the intent is unrelated to the active features.`;

function validateGsdRoot(gsdRoot) {
  if (!gsdRoot || typeof gsdRoot !== 'string') {
    throw new Error('GSD_ROOT is a required capsule input');
  }
  if (!path.isAbsolute(gsdRoot)) {
    throw new Error('GSD_ROOT must be an absolute path');
  }
  if (/[\x00-\x1F\x7F]/.test(gsdRoot)) {
    throw new Error('GSD_ROOT contains invalid control characters');
  }
  if (Buffer.byteLength(gsdRoot, 'utf8') > 1024) {
    throw new Error('GSD_ROOT path length exceeds limit of 1024 bytes');
  }
}

function createCapsule(features, gsdRoot) {
  if (!Array.isArray(features) || features.length === 0) {
    throw new Error('At least one active feature is required');
  }
  validateGsdRoot(gsdRoot);

  const masterPath = `${gsdRoot}/skills/gsd/SKILL.md`;
  if (Buffer.byteLength(masterPath, 'utf8') > 1024) {
    throw new Error('Emitted master path length exceeds limit of 1024 bytes');
  }

  const seen = new Set();
  for (const feature of features) {
    if (typeof feature !== 'string') {
      throw new Error('Feature must be a string');
    }
    if (Buffer.byteLength(feature, 'utf8') > 255) {
      throw new Error('Feature slug exceeds field length cap of 255 bytes');
    }
    if (/[\x00-\x1F\x7F]/.test(feature)) {
      throw new Error('Invalid feature slug: must be kebab-case (control characters are rejected)');
    }
    if (/[/\\.]/.test(feature)) {
      throw new Error('Invalid feature slug: must be kebab-case (path separators or dots are rejected)');
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature)) {
      throw new Error('Invalid feature slug: must be kebab-case');
    }
    if (seen.has(feature)) {
      throw new Error('Duplicate features are not allowed');
    }
    seen.add(feature);
  }

  const sorted = [...features].sort();
  const isOverCap = features.length > 5;
  const prefix = isOverCap ? sorted.slice(0, 5) : sorted;
  const omittedCount = isOverCap ? features.length - 5 : 0;
  let featuresStr = prefix.join(', ');
  if (isOverCap) featuresStr += ` (and ${omittedCount} more)`;

  const resumeInstruction = isOverCap
    ? 'Stop immediately and select exactly one active feature to resume.'
    : 'Load gsd-handoff from the injected catalog and perform exactly one validated resume.';
  const capsule = `[GSD Recovery Capsule]
Active GSD features: ${featuresStr}
To resume execution, perform direct-root rehydration in this exact order:
1. Use the already-loaded GSD bootstrap from ${masterPath}; do not load it again.
2. ${resumeInstruction}
Stop immediately on any malformed or ambiguous state, or if the intent is unrelated to the active features.`;

  const capsuleBytes = Buffer.byteLength(capsule, 'utf8');
  if (capsuleBytes > 4000) {
    throw new Error(`Complete capsule size (${capsuleBytes} bytes) exceeds limit of 4000 bytes`);
  }
  return capsule;
}


const STATE_SCHEMA = 'v3';
const STATE_FILE = 'state.toon';
const STATE_FILE_MAX_BYTES = 64 * 1024;
const SKILL_FILE_MAX_BYTES = 128 * 1024;
const SCRATCH_ENTRY_LIMIT = 2048;
const FEATURE_ENTRY_LIMIT = 128;
const SKILL_ENTRY_LIMIT = 128;
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
const LEGACY_V2_STATE_FIELD_SET = new Set(LEGACY_V2_STATE_FIELD_ORDER);
const LEGACY_V1_STATE_FIELD_SET = new Set(LEGACY_V1_STATE_FIELD_ORDER);
const LEGACY_STATE_KEYS = new Set([
  'mode',
  'manual_ui_review',
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

const NONE = 'none';
const FEATURE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
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

function readBoundedRegularText(filePath, maxBytes, label, expectedRoot = null) {
  let lst;
  try {
    lst = fs.lstatSync(filePath);
  } catch (error) {
    throw new Error(`${label}: cannot inspect file (${error.message})`);
  }
  if (lst.isSymbolicLink()) throw new Error(`${label}: symlink rejected`);
  if (!lst.isFile()) throw new Error(`${label}: expected a regular file`);
  if (lst.size > maxBytes) {
    throw new Error(`${label}: exceeds size limit of ${maxBytes} bytes`);
  }

  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let fd;
  try {
    fd = fs.openSync(filePath, flags);
    const opened = fs.fstatSync(fd);
    if (!opened.isFile()) throw new Error(`${label}: expected a regular file`);
    if (opened.dev !== lst.dev || opened.ino !== lst.ino) {
      throw new Error(`${label}: file identity changed before open`);
    }
    if (opened.size > maxBytes) {
      throw new Error(`${label}: exceeds size limit of ${maxBytes} bytes`);
    }

    const realFile = fs.realpathSync(filePath);
    if (expectedRoot && !isInside(expectedRoot, realFile)) {
      throw new Error(`${label}: resolved outside ${expectedRoot}`);
    }
    const current = fs.statSync(realFile);
    if (current.dev !== opened.dev || current.ino !== opened.ino) {
      throw new Error(`${label}: file identity changed during validation`);
    }

    const capacity = Math.min(maxBytes + 1, opened.size + 1);
    const buffer = Buffer.allocUnsafe(Math.max(1, capacity));
    let total = 0;
    while (total < buffer.length) {
      const bytesRead = fs.readSync(fd, buffer, total, buffer.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > maxBytes) {
      throw new Error(`${label}: exceeds size limit of ${maxBytes} bytes`);
    }

    const afterRead = fs.fstatSync(fd);
    if (
      afterRead.dev !== opened.dev ||
      afterRead.ino !== opened.ino ||
      afterRead.size !== opened.size ||
      afterRead.mtimeMs !== opened.mtimeMs ||
      afterRead.ctimeMs !== opened.ctimeMs
    ) {
      throw new Error(`${label}: file changed during read`);
    }
    return buffer.subarray(0, total).toString('utf8');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${label}:`)) throw error;
    throw new Error(`${label}: cannot read file (${error.message})`);
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function readDirectoryEntriesBounded(directory, limit, label) {
  let handle;
  const entries = [];
  try {
    handle = fs.opendirSync(directory);
    while (true) {
      const entry = handle.readSync();
      if (!entry) break;
      if (entries.length >= limit) {
        throw new Error(`${label}: entry limit of ${limit} entries exceeded`);
      }
      entries.push(entry);
    }
    return entries;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${label}:`)) throw error;
    throw new Error(`${label}: cannot enumerate directory (${error.message})`);
  } finally {
    if (handle) {
      try { handle.closeSync(); } catch { /* ignore */ }
    }
  }
}

function parseStateFields(content, label, fieldOrder, fieldSet) {
  if (typeof content !== 'string') {
    throw new Error(`${label}: content must be text`);
  }
  const normalized = content.replace(/\r\n/g, '\n');
  if (normalized === '' || normalized.includes('\0')) {
    throw new Error(`${label}: malformed empty or binary content`);
  }
  const lines = normalized.endsWith('\n')
    ? normalized.slice(0, -1).split('\n')
    : normalized.split('\n');
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
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      throw new Error(`${label}: duplicate key: ${key}`);
    }
    if (value === '') {
      throw new Error(`${label}: empty value for ${key}`);
    }
    fields[key] = value;
  }

  for (const key of fieldOrder) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) {
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
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
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
      throw new Error(`${label}: wip_branch feature mismatch`);
    }
  }

  if (state.phase === 'completed-retained') {
    if (state.next_action !== NONE) {
      throw new Error(`${label}: completed-retained next_action must be none`);
    }
  } else if (isNone(state.next_action)) {
    throw new Error(`${label}: next_action is required for phase ${state.phase}`);
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
  if (!PONYTAIL_RE.test(state.ponytail_level)) {
    throw new Error(`${label}: invalid ponytail_level`);
  }
  if (!CLEANUP_RE.test(state.cleanup_preference)) {
    throw new Error(`${label}: invalid cleanup_preference`);
  }
  if (!/^[1-9]\d*$/.test(state.checkpoint_revision)) {
    throw new Error(`${label}: invalid checkpoint_revision`);
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
    if (
      state.review_round !== NONE ||
      state.blocking_fingerprint !== NONE ||
      state.reviewed_commit !== NONE ||
      state.progress_status !== NONE
    ) {
      throw new Error(`${label}: review progress must be none before terminal phases`);
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
  return validateCommonState(legacy, label);
}

function readStateFileInternal(statePath, allowLegacyCompleted, migrateLegacy = true) {
  if (typeof statePath !== 'string' || path.basename(statePath) !== STATE_FILE) {
    throw new Error(`${statePath}: expected ${STATE_FILE}`);
  }
  const featureMeta = resolveFeatureDirectory(path.dirname(statePath));
  const resolvedStatePath = path.join(featureMeta.absolute, STATE_FILE);
  const content = readBoundedRegularText(
    resolvedStatePath,
    STATE_FILE_MAX_BYTES,
    resolvedStatePath,
    featureMeta.absolute,
  );
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
  return bindFeature(parseState(content, resolvedStatePath));
}

function readStateFile(statePath) {
  return readStateFileInternal(statePath, false, true);
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
  if (
    cleaned.startsWith(label) ||
    cleaned.includes('state.toon') ||
    cleaned.includes('featureDir')
  ) {
    return new Error(cleaned);
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
  const { absolute } = featureMeta;
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


function detectCandidates(cwd) {
  const requestedScratchDir = path.join(cwd, '.scratch');
  if (!fs.existsSync(requestedScratchDir)) return [];

  let scratchLst;
  let scratchDir;
  try {
    scratchLst = fs.lstatSync(requestedScratchDir);
    if (scratchLst.isSymbolicLink() || !scratchLst.isDirectory()) return [];
    scratchDir = fs.realpathSync(requestedScratchDir);
    const current = fs.statSync(scratchDir);
    if (current.dev !== scratchLst.dev || current.ino !== scratchLst.ino) {
      throw new Error(`${requestedScratchDir}: directory identity changed during validation`);
    }
  } catch {
    return [];
  }

  let entries;
  try {
    entries = readDirectoryEntriesBounded(scratchDir, SCRATCH_ENTRY_LIMIT, scratchDir);
  } catch (error) {
    if (error instanceof Error && error.message.includes('entry limit')) throw error;
    return [];
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (Buffer.byteLength(name, 'utf8') > 255 || !FEATURE_RE.test(name)) continue;

    const featureDir = path.join(scratchDir, name);
    let featureMeta;
    try {
      featureMeta = resolveFeatureDirectory(featureDir, name);
    } catch {
      // Symlinked/unsafe dirs are ignored (not ordinary authority packets).
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
    for (const subEntry of subEntries) {
      if (subEntry.name === 'plan.md' && subEntry.isFile()) hasPlan = true;
      else if (subEntry.name === STATE_FILE) {
        if (typeof subEntry.isSymbolicLink === 'function' && subEntry.isSymbolicLink()) {
          throw sanitizeStateError(new Error(`${name}: symlink state.toon rejected`), 'state.toon');
        }
        if (subEntry.isFile()) hasState = true;
        else throw sanitizeStateError(new Error(`${name}: state.toon must be a regular file`), 'state.toon');
      }
    }

    // No state authority => ignore (legacy handoff-only, plan-only, etc.).
    if (!hasPlan || !hasState) continue;

    let state;
    try {
      state = readCandidateStateFile(path.join(featureMeta.absolute, STATE_FILE));
    } catch (error) {
      throw sanitizeStateError(error, `state.toon (${name})`);
    }
    if (state.feature !== name) {
      throw sanitizeStateError(
        new Error(`${name}: state.feature mismatch: ${state.feature}`),
        'state.toon',
      );
    }
    if (COMPLETED_STATE_PHASES.includes(state.phase)) continue;
    if (!ACTIVE_STATE_PHASES.includes(state.phase)) {
      throw sanitizeStateError(
        new Error(`${name}: unsupported active phase ${state.phase}`),
        'state.toon',
      );
    }
    candidates.push(name);
  }
  return candidates.sort();
}

function parseSkillMetadata(content, filePath) {
  if (typeof content !== 'string') throw new Error(`${filePath}: SKILL.md content must be text`);
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) throw new Error(`${filePath}: missing YAML frontmatter`);
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) throw new Error(`${filePath}: unterminated YAML frontmatter`);

  const fields = new Map();
  for (const line of normalized.slice(4, end).split('\n')) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?: (.*))?$/);
    if (!match) continue;
    const [, key, rawValue = ''] = match;
    if (!['name', 'description', 'hide'].includes(key)) continue;
    if (fields.has(key)) throw new Error(`${filePath}: duplicate ${key} field`);
    fields.set(key, rawValue);
  }

  const name = fields.get('name');
  if (!name || !/^gsd(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`${filePath}: missing or invalid name`);
  }
  const rawDescription = fields.get('description');
  if (!rawDescription || !rawDescription.startsWith('"') || !rawDescription.endsWith('"')) {
    throw new Error(`${filePath}: description must be a single-line JSON-quoted string`);
  }
  let description;
  try {
    description = JSON.parse(rawDescription);
  } catch {
    throw new Error(`${filePath}: description must be a valid single-line JSON-quoted string`);
  }
  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error(`${filePath}: description must be a non-empty string`);
  }
  if (/[\x00-\x1F\x7F]/.test(description)) {
    throw new Error(`${filePath}: description contains a control character`);
  }

  const rawHide = fields.get('hide');
  if (rawHide !== undefined && rawHide !== 'true') {
    throw new Error(`${filePath}: hide must be the literal true when present`);
  }
  return { name, description, hidden: rawHide === 'true' };
}

function frontmatterBody(content, filePath) {
  const normalized = content.replace(/\r\n/g, '\n');
  const end = normalized.indexOf('\n---\n', 4);
  if (!normalized.startsWith('---\n') || end === -1) {
    throw new Error(`${filePath}: invalid YAML frontmatter`);
  }
  return normalized.slice(end + 5).replace(/^\n/, '').trimEnd();
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveGsdRoots(gsdRoot) {
  validateGsdRoot(gsdRoot);
  let realRoot;
  try {
    realRoot = fs.realpathSync(gsdRoot);
  } catch (error) {
    throw new Error(`${gsdRoot}: cannot resolve GSD_ROOT (${error.message})`);
  }

  const skillsRoot = path.join(realRoot, 'skills');
  let skillsStat;
  try {
    skillsStat = fs.lstatSync(skillsRoot);
  } catch (error) {
    throw new Error(`${skillsRoot}: cannot resolve skills directory (${error.message})`);
  }
  if (skillsStat.isSymbolicLink()) {
    throw new Error(`${skillsRoot}: symlink skills directory rejected`);
  }
  if (!skillsStat.isDirectory()) {
    throw new Error(`${skillsRoot}: skills directory must be a directory`);
  }

  let realSkillsRoot;
  try {
    realSkillsRoot = fs.realpathSync(skillsRoot);
  } catch (error) {
    throw new Error(`${skillsRoot}: cannot resolve skills directory (${error.message})`);
  }
  if (!isInside(realRoot, realSkillsRoot)) {
    throw new Error(`${skillsRoot}: resolved outside GSD_ROOT ${realRoot}`);
  }
  return { realRoot, realSkillsRoot };
}

function discoverSkillCatalogAt(realSkillsRoot) {
  let entries;
  try {
    entries = readDirectoryEntriesBounded(realSkillsRoot, SKILL_ENTRY_LIMIT, realSkillsRoot);
  } catch (error) {
    throw new Error(`${realSkillsRoot}: ${error.message}`);
  }
  entries = entries
    .filter((entry) => entry.isDirectory() && /^gsd(?:-[a-z0-9]+)*$/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (!entries.some(({ name }) => name === 'gsd')) {
    throw new Error(`${path.join(realSkillsRoot, 'gsd', 'SKILL.md')}: missing master SKILL.md`);
  }

  const catalog = [];
  const seen = new Set();
  for (const entry of entries) {
    const skillFile = path.join(realSkillsRoot, entry.name, 'SKILL.md');
    let realSkillFile;
    try {
      realSkillFile = fs.realpathSync(skillFile);
    } catch (error) {
      throw new Error(`${skillFile}: missing SKILL.md (${error.message})`);
    }
    const skillContent = readBoundedRegularText(
      skillFile,
      SKILL_FILE_MAX_BYTES,
      skillFile,
      realSkillsRoot,
    );
    const metadata = parseSkillMetadata(skillContent, realSkillFile);
    if (seen.has(metadata.name)) throw new Error(`${realSkillFile}: duplicate skill name ${metadata.name}`);
    seen.add(metadata.name);
    if (metadata.name !== entry.name) {
      throw new Error(`${realSkillFile}: name ${metadata.name} must match directory ${entry.name}`);
    }
    if (!metadata.hidden) {
      catalog.push({ name: metadata.name, description: metadata.description, skillPath: realSkillFile });
    }
  }
  if (catalog.length === 0) throw new Error(`${realSkillsRoot}: visible GSD skill catalog is empty`);
  return catalog;
}

function discoverSkillCatalog(gsdRoot) {
  const { realSkillsRoot } = resolveGsdRoots(gsdRoot);
  return discoverSkillCatalogAt(realSkillsRoot);
}

function createBootstrap(gsdRoot) {
  const { realRoot, realSkillsRoot } = resolveGsdRoots(gsdRoot);
  const masterPath = path.join(realSkillsRoot, 'gsd', 'SKILL.md');
  const masterContent = readBoundedRegularText(
    masterPath,
    SKILL_FILE_MAX_BYTES,
    masterPath,
    realSkillsRoot,
  );
  const masterMetadata = parseSkillMetadata(masterContent, masterPath);
  if (masterMetadata.name !== 'gsd' || !masterMetadata.hidden) {
    throw new Error(`${masterPath}: master skill must be named gsd with hide: true`);
  }
  const catalog = discoverSkillCatalogAt(realSkillsRoot);
  const rows = catalog.map((row) => `- ${JSON.stringify(row)}`).join('\n');
  return `<GSD_BOOTSTRAP>
${BOOTSTRAP_MARKER}
GSD_ROOT: ${JSON.stringify(realRoot)}
The hidden gsd master bootstrap below is already loaded. Do not load it again.

${frontmatterBody(masterContent, masterPath)}

## Available GSD skills
${rows}
</GSD_BOOTSTRAP>`;
}

function messageText(message) {
  if (!message || typeof message !== 'object') return '';
  const parts = [];
  if (typeof message.content === 'string') parts.push(message.content);
  else if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block && typeof block.text === 'string') parts.push(block.text);
    }
  }
  if (typeof message.summary === 'string') parts.push(message.summary);
  return parts.join('\n');
}

function messageContainsBootstrap(message, expectedBootstrap) {
  const text = messageText(message);
  if (typeof expectedBootstrap === 'string') return text === expectedBootstrap;
  return (
    text.startsWith(`<GSD_BOOTSTRAP>\n${BOOTSTRAP_MARKER}\n`) &&
    text.endsWith('\n</GSD_BOOTSTRAP>')
  );
}

function firstNonCompactionSummaryIndex(messages) {
  let index = 0;
  while (index < messages.length && messages[index]?.role === 'compactionSummary') index += 1;
  return index;
}

function sanitizeBootstrapError(error) {
  const reason = String(error?.message ?? error).replace(/[\x00-\x1F\x7F]+/g, ' ').trim();
  return `${BOOTSTRAP_ERROR_PREFIX} ${reason}. Do not improvise a GSD workflow; continue with ordinary OMP behavior.`;
}

function gsdContextExtension(pi) {
  const extPath = fs.realpathSync(EXTENSION_FILE);
  const GSD_ROOT = path.dirname(path.dirname(extPath));
  let pendingCapsule = null;
  let capsuleQueuedForNextTurn = false;
  let bootstrap = null;
  let bootstrapError = null;
  let injectBootstrap = false;
  let lastLoggedBootstrapError = null;

  const rebuildBootstrap = () => {
    try {
      bootstrap = createBootstrap(GSD_ROOT);
      bootstrapError = null;
      lastLoggedBootstrapError = null;
    } catch (error) {
      bootstrap = null;
      bootstrapError = sanitizeBootstrapError(error);
      if (bootstrapError !== lastLoggedBootstrapError) {
        pi.logger?.error?.(bootstrapError);
        lastLoggedBootstrapError = bootstrapError;
      }
    }
    injectBootstrap = true;
  };

  // Explicit extensions may be registered after OMP's initial session_start.
  // Arm immediately; lifecycle events below refresh the per-session cache.
  rebuildBootstrap();

  for (const eventName of ['session_start', 'session_switch', 'session_branch', 'session_tree']) {
    pi.on(eventName, async () => {
      rebuildBootstrap();
      pendingCapsule = null;
      capsuleQueuedForNextTurn = false;
    });
  }

  // Context replacements are provider-request-local, so keep the cached payload
  // armed across agent turns and deduplicate against each outgoing message set.
  pi.on('agent_end', async () => {});

  pi.on('session_shutdown', async () => {
    bootstrap = null;
    bootstrapError = null;
    pendingCapsule = null;
    capsuleQueuedForNextTurn = false;
    injectBootstrap = false;
    lastLoggedBootstrapError = null;
  });

  pi.on('before_agent_start', async (event) => {
    // OMP drains its hidden nextTurn queue immediately before this event
    // (AgentSession prompt setup), so this is the actual consumption boundary.
    capsuleQueuedForNextTurn = false;
    if (!injectBootstrap || (!bootstrap && !bootstrapError)) return undefined;
    const systemPrompt = Array.isArray(event.systemPrompt) ? event.systemPrompt : [];
    if (systemPrompt.some((block) => typeof block === 'string' && block.includes(SYSTEM_POLICY_MARKER))) {
      return undefined;
    }
    return { systemPrompt: [...systemPrompt, SYSTEM_POLICY] };
  });

  pi.on('context', async (event) => {
    if (!injectBootstrap) return undefined;
    const payload = bootstrap ?? bootstrapError;
    if (!payload) return undefined;
    const alreadyPresent = event.messages.some((message) =>
      bootstrap
        ? messageContainsBootstrap(message, payload)
        : messageText(message) === payload,
    );
    if (alreadyPresent) return undefined;

    const messages = [...event.messages];
    messages.splice(firstNonCompactionSummaryIndex(messages), 0, {
      role: 'user',
      content: payload,
      timestamp: Date.now(),
    });
    return { messages };
  });

  pi.on('session.compacting', async (_event, ctx) => {
    pendingCapsule = null;
    const features = detectCandidates(ctx?.cwd || process.cwd());
    if (features.length === 0) {
      pendingCapsule = null;
      return {};
    }
    pendingCapsule = createCapsule(features, GSD_ROOT);
    return { context: [pendingCapsule] };
  });

  pi.on('session_compact', async () => {
    if (!bootstrap && !bootstrapError) rebuildBootstrap();
    else injectBootstrap = true;
    if (pendingCapsule) {
      const capsuleToSend = pendingCapsule;
      pendingCapsule = null;
      if (capsuleQueuedForNextTurn) return;
      capsuleQueuedForNextTurn = true;
      try {
        await pi.sendMessage(capsuleToSend, {
          deliverAs: 'nextTurn',
          triggerTurn: false,
        });
      } catch (error) {
        capsuleQueuedForNextTurn = false;
        throw error;
      }
    }
  });
}

export {
  ACTIVE_STATE_PHASES,
  CAPSULE_TEMPLATE,
  COMPLETED_STATE_PHASES,
  createBootstrap,
  createCapsule,
  detectCandidates,
  discoverSkillCatalog,
  firstNonCompactionSummaryIndex,
  messageContainsBootstrap,
  parseSkillMetadata,
  parseState,
  readStateFile,
  serializeState,
  validateState,
  writeStateAtomic,
};

export default gsdContextExtension;
