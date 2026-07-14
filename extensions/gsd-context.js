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

function detectCandidates(cwd) {
  const scratchDir = path.join(cwd, '.scratch');
  if (!fs.existsSync(scratchDir)) return [];
  try {
    if (!fs.statSync(scratchDir).isDirectory()) return [];
  } catch {
    return [];
  }

  let entries;
  try {
    entries = fs.readdirSync(scratchDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (Buffer.byteLength(name, 'utf8') > 255 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) continue;

    let subEntries;
    try {
      subEntries = fs.readdirSync(path.join(scratchDir, name), { withFileTypes: true });
    } catch {
      continue;
    }

    let hasPlan = false;
    let hasResult = false;
    let hasHandoff = false;
    for (const subEntry of subEntries) {
      if (subEntry.name === 'plan.md' && subEntry.isFile()) hasPlan = true;
      else if (subEntry.name === 'result.toon') hasResult = true;
      else if (/^handoff-[1-9]\d*\.toon$/.test(subEntry.name) && subEntry.isFile()) hasHandoff = true;
    }
    if (hasPlan && !hasResult && hasHandoff) candidates.push(name);
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

function discoverSkillCatalog(gsdRoot) {
  validateGsdRoot(gsdRoot);
  let realRoot;
  try {
    realRoot = fs.realpathSync(gsdRoot);
  } catch (error) {
    throw new Error(`${gsdRoot}: cannot resolve GSD_ROOT (${error.message})`);
  }
  const skillsRoot = path.join(realRoot, 'skills');
  let realSkillsRoot;
  try {
    realSkillsRoot = fs.realpathSync(skillsRoot);
  } catch (error) {
    throw new Error(`${skillsRoot}: cannot resolve skills directory (${error.message})`);
  }

  let entries;
  try {
    entries = fs.readdirSync(realSkillsRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error(`${realSkillsRoot}: cannot enumerate skills (${error.message})`);
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
    let stat;
    try {
      stat = fs.lstatSync(skillFile);
    } catch (error) {
      throw new Error(`${skillFile}: missing SKILL.md (${error.message})`);
    }
    if (!stat.isFile()) throw new Error(`${skillFile}: expected a regular SKILL.md`);

    const realSkillFile = fs.realpathSync(skillFile);
    if (!isInside(realSkillsRoot, realSkillFile)) {
      throw new Error(`${skillFile}: resolved outside ${realSkillsRoot}`);
    }
    const metadata = parseSkillMetadata(fs.readFileSync(realSkillFile, 'utf8'), realSkillFile);
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

function createBootstrap(gsdRoot) {
  validateGsdRoot(gsdRoot);
  const realRoot = fs.realpathSync(gsdRoot);
  const masterPath = path.join(realRoot, 'skills', 'gsd', 'SKILL.md');
  let masterContent;
  try {
    masterContent = fs.readFileSync(masterPath, 'utf8');
  } catch (error) {
    throw new Error(`${masterPath}: cannot read master SKILL.md (${error.message})`);
  }
  const masterMetadata = parseSkillMetadata(masterContent, masterPath);
  if (masterMetadata.name !== 'gsd' || !masterMetadata.hidden) {
    throw new Error(`${masterPath}: master skill must be named gsd with hide: true`);
  }
  const catalog = discoverSkillCatalog(realRoot);
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

function messageContainsBootstrap(message) {
  return messageText(message).includes(BOOTSTRAP_MARKER);
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
    });
  }

  // Context replacements are provider-request-local, so keep the cached payload
  // armed across agent turns and deduplicate against each outgoing message set.
  pi.on('agent_end', async () => {});

  pi.on('session_shutdown', async () => {
    bootstrap = null;
    bootstrapError = null;
    injectBootstrap = false;
    lastLoggedBootstrapError = null;
  });

  pi.on('before_agent_start', async (event) => {
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
    const alreadyPresent = bootstrap
      ? event.messages.some(messageContainsBootstrap)
      : event.messages.some((message) => messageText(message).startsWith(BOOTSTRAP_ERROR_PREFIX));
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
      await pi.sendMessage(capsuleToSend, {
        deliverAs: 'nextTurn',
        triggerTurn: false,
      });
    }
  });
}

export {
  CAPSULE_TEMPLATE,
  createBootstrap,
  createCapsule,
  detectCandidates,
  discoverSkillCatalog,
  firstNonCompactionSummaryIndex,
  messageContainsBootstrap,
  parseSkillMetadata,
};

export default gsdContextExtension;
