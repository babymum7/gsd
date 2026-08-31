import fs from 'node:fs';
import path from 'node:path';
import { isInside, readBoundedRegularText, readDirectoryEntriesBounded } from './gsd-fs.mjs';

const BOOTSTRAP_MARKER = 'gsd:session-bootstrap:v2';
const BOOTSTRAP_ERROR_PREFIX = '[GSD bootstrap unavailable]';
const CAPSULE_TEMPLATE = `[GSD Recovery Capsule]
Active GSD features: <features>
The listed features are a workspace inventory only and do not indicate which feature the current session is working on.
<resume_instruction>
Compaction MUST preserve and continue the current user request. Only resume an active feature when the preserved request or a bare continue explicitly selects it.`;
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
// Capsule byte budget, enforced by the checks below and pinned by the extension tests.
// The capsule carries workspace inventory only; the current user request is sent as a
// separate context item by session.compacting, keeping the capsule bounded. Fixed template
// static text is ~328 UTF-8 bytes; each feature slug caps at 255 with at most 5 displayed,
// so <features> caps at 1283 (5 x 255 + 4 x ", ") in Normal mode and 1305 with the
// " (and N more)" suffix at max width (6 + 10 digits + 6 = 22 bytes). Resume instructions
// embed the master path (≤1024 bytes) and are ~320 bytes (Normal) and ~425 bytes
// (Bounded-Ambiguity with over-cap clause), giving worst cases of ~1931 and ~2058 bytes,
// both well under the 4000-byte complete cap.
// Over-cap output fails closed; never truncate a rendered capsule.
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

  const overCapClause = isOverCap
    ? ' Some features are omitted from this list — stop and select exactly one active feature before resuming.'
    : '';
  const resumeInstruction =
    `If resuming, follow the bootstrap routing in ${masterPath}: bare "continue" selects gsd-handoff; a prompt naming an active feature routes to that feature's owner skill.${overCapClause} Stop immediately on malformed or ambiguous state. Otherwise, continue ordinary routing for the current request.`;
  // Single-pass replacement: inserted values are never rescanned.
  const tokenMap = {
    '<features>': featuresStr,
    '<resume_instruction>': resumeInstruction,
  };
  const capsule = CAPSULE_TEMPLATE.replace(
    /<features>|<resume_instruction>/g,
    (token) => tokenMap[token],
  );

  const capsuleBytes = Buffer.byteLength(capsule, 'utf8');
  if (capsuleBytes > 4000) {
    throw new Error(`Complete capsule size (${capsuleBytes} bytes) exceeds limit of 4000 bytes`);
  }
  return capsule;
}
const SKILL_FILE_MAX_BYTES = 128 * 1024;
const SKILL_ENTRY_LIMIT = 128;
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
function discoverSkillsAt(realSkillsRoot) {
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
  const hidden = new Map();
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
    if (metadata.hidden) {
      hidden.set(metadata.name, realSkillFile);
    } else {
      catalog.push({ name: metadata.name, description: metadata.description, skillPath: realSkillFile });
    }
  }
  if (catalog.length === 0) throw new Error(`${realSkillsRoot}: visible GSD skill catalog is empty`);
  return { catalog, hidden };
}
function discoverSkillCatalogAt(realSkillsRoot) {
  return discoverSkillsAt(realSkillsRoot).catalog;
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
  const { catalog, hidden } = discoverSkillsAt(realSkillsRoot);
  const ponytailContextPath = hidden.get('gsd-ponytail');
  if (!ponytailContextPath) {
    throw new Error(`${path.join(realSkillsRoot, 'gsd-ponytail', 'SKILL.md')}: hidden Ponytail context is required`);
  }
  const rows = catalog.map((row) => `- ${JSON.stringify(row)}`).join('\n');
  return `<GSD_BOOTSTRAP>
${BOOTSTRAP_MARKER}
GSD_ROOT: ${JSON.stringify(realRoot)}
PONYTAIL_CONTEXT_PATH: ${JSON.stringify(ponytailContextPath)}
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
const CURRENT_REQUEST_MAX_BYTES = 500;
function extractLastUserRequest(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== 'user') continue;
    const text = messageText(msg);
    if (!text) continue;
    if (messageContainsBootstrap(msg)) continue;
    if (text.startsWith('[GSD Recovery Capsule]')) continue;
    if (text.startsWith('[GSD compaction')) continue;
    if (text.startsWith(BOOTSTRAP_ERROR_PREFIX)) continue;
    // Unwrap prior [GSD Current Request] to its payload for idempotence across compactions
    const isPriorRequest = text.startsWith('[GSD Current Request]\n');
    const requestText = isPriorRequest ? text.slice('[GSD Current Request]\n'.length) : text;
    if (!requestText) continue;
    const byteLen = Buffer.byteLength(requestText, 'utf8');
    if (byteLen <= CURRENT_REQUEST_MAX_BYTES) return requestText;
    let cutIndex = 0;
    let bytes = 0;
    for (const ch of requestText) {
      const chBytes = Buffer.byteLength(ch, 'utf8');
      if (bytes + chBytes > CURRENT_REQUEST_MAX_BYTES) break;
      bytes += chBytes;
      cutIndex += ch.length;
    }
    return requestText.slice(0, cutIndex);
  }
  return '';
}
function sanitizeBootstrapError(error) {
  const reason = String(error?.message ?? error).replace(/[\x00-\x1F\x7F]+/g, ' ').trim();
  return `${BOOTSTRAP_ERROR_PREFIX} ${reason}. Do not improvise a GSD workflow; continue with ordinary OMP behavior.`;
}

export {
  BOOTSTRAP_ERROR_PREFIX,
  BOOTSTRAP_MARKER,
  CAPSULE_TEMPLATE,
  createBootstrap,
  createCapsule,
  discoverSkillCatalog,
  extractLastUserRequest,
  firstNonCompactionSummaryIndex,
  messageContainsBootstrap,
  messageText,
  parseSkillMetadata,
  sanitizeBootstrapError,
};
