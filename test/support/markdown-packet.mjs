import { createHash } from "node:crypto";

const REQUIRED_PACKET_FILES = ["plan.md"];
const VAGUE = /^(?:tbd|todo|works correctly|run tests|valid|covered|success)\.?$/i;
const VALID_TASK_STATUSES = new Set(["pending", "in_progress", "done", "superseded"]);

function fail(message) {
  throw new Error(`Markdown contract: ${message}`);
}

function required(value, label) {
  const normalized = value?.trim();
  if (!normalized) fail(`${label} is required`);
  return normalized;
}

function requiredExact(value, label) {
  if (typeof value !== "string") {
    fail(`${label} is required`);
  }
  if (value !== value.trim()) {
    fail(`${label} must not have leading or trailing whitespace`);
  }
  if (!value) {
    fail(`${label} is required`);
  }
  return value;
}

function canonicalSource(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} is required`);
  if (value.includes("\r")) fail(`${label} must use LF line endings`);
  if (/^[ \t]*\n/.test(value) || /\n(?:[ \t]*\n|[ \t]+)$/.test(value)) fail(`${label} must not have leading or trailing blank lines`);
  return value;
}

function validateRepositoryPath(pathValue, fieldLabel, { allowScratch = false } = {}) {
  if (pathValue !== pathValue.trim()) {
    fail(`${fieldLabel} path has leading or trailing whitespace: ${pathValue}`);
  }
  if (pathValue.includes("\\")) {
    fail(`${fieldLabel} contains backslash: ${pathValue}`);
  }
  if (pathValue.startsWith("/")) {
    fail(`${fieldLabel} must be repository-relative (cannot start with /): ${pathValue}`);
  }
  const segments = pathValue.split("/");
  for (const segment of segments) {
    if (segment === "") {
      fail(`${fieldLabel} contains empty segment: ${pathValue}`);
    }
    if (segment === "." || segment === "..") {
      fail(`${fieldLabel} contains dot/traversal: ${pathValue}`);
    }
    if (!allowScratch && segment === ".scratch") {
      fail(`${fieldLabel} contains .scratch: ${pathValue}`);
    }
  }
  if (pathValue.endsWith(".toon")) {
    fail(`${fieldLabel} contains runtime TOON path: ${pathValue}`);
  }
  return pathValue;
}

function validatePathsField(fieldValue, fieldLabel) {
  if (typeof fieldValue !== "string") {
    fail(`${fieldLabel} must be a string`);
  }
  if (!/^`[^`]+`(\s*,\s*`[^`]+`)*$/.test(fieldValue)) {
    fail(`${fieldLabel} must be comma-separated backticked repository-relative paths with no trailing/unbackticked text`);
  }
  return [...fieldValue.matchAll(/`([^`]+)`/g)]
    .map(([, pathValue]) => validateRepositoryPath(pathValue, fieldLabel));
}

function validateArtifactPath(pathValue, feature, fieldLabel) {
  validateRepositoryPath(pathValue, fieldLabel, { allowScratch: true });
  const prefix = `.scratch/${feature}/prototype/`;
  if (!pathValue.startsWith(prefix) || pathValue.length === prefix.length) {
    fail(`${fieldLabel} must stay under ${prefix}`);
  }
  return pathValue;
}

function validateTitle(content, title) {
  const headings = [...content.matchAll(/^# (.+)$/gm)].map(([, heading]) => heading);
  if (headings.length !== 1 || headings[0] !== title || !content.startsWith(`# ${title}\n`)) {
    fail(`top-level heading must be exactly # ${title}`);
  }
}

export function validateSectionEdges(value, heading) {
  if (value.trim() === "") {
    fail(`${heading} section must not be empty or blank`);
  }
  if (/^\s/.test(value)) {
    fail(`${heading} section must not have leading blank or whitespace-only lines`);
  }
  if (/\s$/.test(value)) {
    fail(`${heading} section must not have trailing blank or whitespace-only lines`);
  }
}

function section(content, heading, requiredSection = true, trim = true) {
  const expression = new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m");
  const matches = [...content.matchAll(new RegExp(expression.source, "gm"))];
  if (matches.length > 1) fail(`duplicate ${heading} section`);
  if (matches.length === 0) {
    if (requiredSection) fail(`missing ${heading} section`);
    return null;
  }
  const raw = matches[0][1];
  const body = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  validateSectionEdges(body, heading);
  return body;
}

function validateSections(content, allowed, optional = []) {
  const headings = [...content.matchAll(/^## (.+)$/gm)].map(([, heading]) => heading);
  const expected = allowed.filter((heading) => !optional.includes(heading) || headings.includes(heading));
  if (headings.length !== expected.length || headings.some((heading, index) => heading !== expected[index])) {
    fail(`sections must be exactly ordered: ${expected.join(", ")}`);
  }
}

function orderedFields(block, labels) {
  const entries = [...block.matchAll(/^- \*\*(.+?):\*\* (.+)$/gm)];
  if (entries.length !== labels.length || entries.some(([, label], index) => label !== labels[index])) {
    fail(`fields must be exactly ordered: ${labels.join(", ")}`);
  }
  return Object.fromEntries(entries.map(([, label, value]) => [label, requiredExact(value, label)]));
}

function parseFeature(content) {
  const value = section(content, "Feature");
  const match = value.match(/^`([a-z0-9]+(?:-[a-z0-9]+)*)`$/);
  if (!match) fail("Feature must be exactly one complete backticked slug with no extra text");
  return match[1];
}

function parseBase(content) {
  const value = section(content, "Base");
  const match = value.match(/^`([a-zA-Z0-9_./-]+)`$/);
  if (!match) fail("Base must be exactly one complete backticked branch or reference line with no extra text");
  return match[1];
}

function parseSummary(content) {
  const value = section(content, "Summary");
  const text = requiredExact(value, "Summary");
  if (VAGUE.test(text)) fail("Summary must not be vague");
  return text;
}

function parseContext(content) {
  const value = section(content, "Context");
  const text = requiredExact(value, "Context");
  if (VAGUE.test(text)) fail("Context must not be vague");
  return text;
}

function parseScope(content) {
  const value = section(content, "Scope");
  const lines = value.split("\n");
  if (lines.length === 0) fail("Scope section must not be empty");
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("- ")) {
      fail(`Scope line ${i + 1} must be a bullet point starting with "- "`);
    }
    const text = line.slice(2);
    const normalized = requiredExact(text, `Scope item ${i + 1}`);
    if (VAGUE.test(normalized)) {
      fail(`Scope item ${i + 1} text must not be vague`);
    }
    items.push(normalized);
  }
  return items;
}

function parseCriteria(content) {
  const value = section(content, "Acceptance Criteria", true);
  const lines = value.split("\n");
  if (lines.some(line => line.trim() === "")) {
    fail("Acceptance Criteria must not contain blank or whitespace lines");
  }
  if (lines.length === 0 || lines.length % 5 !== 0) {
    fail("Acceptance Criteria must consist of sequential AC blocks with no stray content");
  }

  const criteria = [];
  const ids = new Set();
  const numBlocks = lines.length / 5;

  for (let i = 0; i < numBlocks; i++) {
    const l1 = lines[i * 5];
    const l2 = lines[i * 5 + 1];
    const l3 = lines[i * 5 + 2];
    const l4 = lines[i * 5 + 3];
    const l5 = lines[i * 5 + 4];

    const m1 = l1.match(/^### (AC-([1-9]\d*)): (.+)$/);
    if (!m1) fail(`Acceptance criterion block ${i + 1} heading is invalid or malformed`);
    const [, id, ordinalStr, title] = m1;
    const ordinal = Number(ordinalStr);

    const m2 = l2.match(/^- \*\*State:\*\* (.+)$/);
    const m3 = l3.match(/^- \*\*Outcome:\*\* (.+)$/);
    const m4 = l4.match(/^- \*\*Action:\*\* (.+)$/);
    const m5 = l5.match(/^- \*\*Expected:\*\* (.+)$/);
    if (!m2 || !m3 || !m4 || !m5) {
      fail("fields must be exactly ordered: State, Outcome, Action, Expected");
    }
    const state = requiredExact(m2[1], `${id} State`);
    const outcome = requiredExact(m3[1], `${id} Outcome`);
    const action = requiredExact(m4[1], `${id} Action`);
    const expected = requiredExact(m5[1], `${id} Expected`);

    if (ordinal !== i + 1) fail("criterion IDs must be sequential");
    if (ids.has(id)) fail(`duplicate criterion ${id}`);
    ids.add(id);

    if (state !== "active" && state !== "superseded") fail(`${id} has invalid state`);
    if (VAGUE.test(outcome) || VAGUE.test(action) || VAGUE.test(expected)) {
      fail(`${id} outcome, action, and expected must be concrete`);
    }

    criteria.push({
      id,
      ordinal,
      title: requiredExact(title, `${id} title`),
      state,
      outcome,
      action,
      expected
    });
  }

  return criteria;
}

function parseIdentifierList(content, heading, prefix) {
  const trimmed = section(content, heading, true);
  if (trimmed === "") {
    fail(`${heading} must not be empty`);
  }
  const lines = trimmed.split("\n");
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const regex = new RegExp(`^- \\*\\*${prefix}-([1-9]\\d*):\\*\\* (.+)$`);
    const match = line.match(regex);
    if (!match) {
      fail(`${heading} line ${i + 1} does not match the canonical format`);
    }
    const [, idNumStr, text] = match;
    const ordinal = Number(idNumStr);
    if (ordinal !== i + 1) {
      fail(`${heading} IDs must equal ${prefix}-1 through ${prefix}-N in order`);
    }
    const id = `${prefix}-${ordinal}`;
    const textVal = requiredExact(text, `${id} text`);
    if (VAGUE.test(textVal)) {
      fail(`${id} text must not be vague`);
    }
    result.push({ id, text: textVal });
  }
  return result;
}

function parseInterfaces(content, criteria) {
  const value = section(content, "Interfaces", true);
  const lines = value.split("\n");
  if (lines.length < 3) fail("Interfaces table is required");
  if (lines[0] !== "| Criterion | Seam | Path | Lower-seam reason |") fail("Interfaces header is invalid");
  if (lines[1] !== "| --- | --- | --- | --- |") fail("Interfaces separator is invalid");

  const parseRow = (line, lineIndex) => {
    if (!line.startsWith("| ") || !line.endsWith(" |")) {
      fail(`Interfaces row at line ${lineIndex + 1} must start and end with '| ' and ' |'`);
    }
    const pipeCount = (line.match(/\|/g) || []).length;
    if (pipeCount !== 5) {
      fail(`Interfaces row at line ${lineIndex + 1} must have exactly 4 columns`);
    }
    const parts = line.split("|");
    
    const getCellContent = (part, columnName) => {
      if (!part.startsWith(" ") || !part.endsWith(" ") || part === " " || part.startsWith("  ") || part.endsWith("  ")) {
        fail(`Interfaces row cell for ${columnName} at line ${lineIndex + 1} must start and end with a single space`);
      }
      const content = part.slice(1, -1);
      if (content !== content.trim()) {
        fail(`Interfaces row cell for ${columnName} at line ${lineIndex + 1} must not have leading or trailing whitespace`);
      }
      if (content === "") {
        fail(`Interfaces row cell for ${columnName} at line ${lineIndex + 1} must not be empty`);
      }
      return content;
    };

    const extractCapture = (content, columnName) => {
      if (content.startsWith("`") || content.endsWith("`")) {
        if (!content.startsWith("`") || !content.endsWith("`")) {
          fail(`Interfaces row cell for ${columnName} at line ${lineIndex + 1} has mismatched backticks`);
        }
        const inner = content.slice(1, -1);
        if (inner.includes("`")) {
          fail(`Interfaces row cell for ${columnName} at line ${lineIndex + 1} has multiple backticks`);
        }
        if (inner !== inner.trim()) {
          fail(`Interfaces row cell for ${columnName} at line ${lineIndex + 1} capture must not have leading or trailing whitespace`);
        }
        if (inner === "") {
          fail(`Interfaces row cell for ${columnName} at line ${lineIndex + 1} capture must not be empty`);
        }
        return inner;
      }
      return content;
    };

    const rawCriterion = getCellContent(parts[1], "Criterion");
    const rawSeam = getCellContent(parts[2], "Seam");
    const rawPathValue = getCellContent(parts[3], "Path");
    const rawLowerReason = getCellContent(parts[4], "Lower-seam reason");

    const criterion = extractCapture(rawCriterion, "Criterion");
    const seam = extractCapture(rawSeam, "Seam");
    const lowerReason = extractCapture(rawLowerReason, "Lower-seam reason");

    return [criterion, seam, rawPathValue, lowerReason];
  };

  const active = new Set(criteria.filter((criterion) => criterion.state === "active").map((criterion) => criterion.id));
  const pins = new Map();

  for (let i = 2; i < lines.length; i++) {
    const row = lines[i];
    if (row === "") {
      fail(`stray prose or empty line in Interfaces at line ${i + 1}`);
    }
    const [criterion, seam, pathValue, lowerReason] = parseRow(row, i);
    if (!active.has(criterion) || pins.has(criterion)) fail(`invalid interface pin ${criterion}`);
    if (!seam || !pathValue || !lowerReason) fail(`incomplete interface pin ${criterion}`);
    validatePathsField(pathValue, `Interface pin ${criterion} Path`);
    pins.set(criterion, { seam, path: pathValue, lowerReason });
  }
  if (pins.size !== active.size) fail("every active criterion needs exactly one interface pin");
  return pins;
}

function parseTasks(content, criteria, feature) {
  const value = section(content, "Tasks", true);
  const lines = value.split("\n");
  if (lines.some(line => line.trim() === "")) {
    fail("Tasks must not contain blank or whitespace lines");
  }

  const starts = [];
  for (let index = 0; index < lines.length; index++) {
    if (/^### T[1-9]\d*: /.test(lines[index])) starts.push(index);
  }
  if (starts.length === 0 || starts[0] !== 0) {
    fail("Tasks must consist of sequential T blocks with no stray content");
  }

  const tasks = [];
  const ids = new Set();
  const active = new Set(criteria.filter((criterion) => criterion.state === "active").map((criterion) => criterion.id));

  const parseIdentity = (block, blockIndex) => {
    const heading = block[0]?.match(/^### (T([1-9]\d*)): (.+)$/);
    if (!heading) fail(`Task block ${blockIndex + 1} heading is invalid or malformed`);
    const [, id, ordinalStr, title] = heading;
    const ordinal = Number(ordinalStr);
    if (ordinal !== blockIndex + 1) fail("task IDs must be sequential");
    if (ids.has(id)) fail(`duplicate task ${id}`);
    ids.add(id);

    const satisfiesMatch = block[1]?.match(/^- \*\*Satisfies:\*\* (.+)$/);
    if (!satisfiesMatch) fail("fields must begin with Satisfies");
    const satisfiesValue = requiredExact(satisfiesMatch[1], `${id} Satisfies`);
    const satisfies = satisfiesValue.split(",").map((criterion) => criterion.trim());
    if (satisfies.length === 0 || satisfies.some((criterion) => !active.has(criterion))) {
      fail(`${id} has unknown criterion`);
    }
    return {
      id,
      ordinal,
      title: requiredExact(title, `${id} title`),
      satisfies,
    };
  };

  const parseTestAndStatus = (id, testLine, statusLine) => {
    const testMatch = testLine?.match(/^- \*\*Test:\*\* (.+)$/);
    const statusMatch = statusLine?.match(/^- \*\*Status:\*\* (.+)$/);
    if (!testMatch || !statusMatch) {
      fail("fields must end with Test, Status");
    }
    const testValue = requiredExact(testMatch[1], `${id} Test`);
    const status = requiredExact(statusMatch[1], `${id} Status`);
    const isBackticked = testValue.startsWith("`") && testValue.endsWith("`") && !testValue.slice(1, -1).includes("`");
    if (!isBackticked) {
      fail(`${id} Test must be one fully backticked nonempty command or none`);
    }
    const test = testValue.slice(1, -1);
    if (!test || test !== test.trim()) {
      fail(`${id} Test must be one fully backticked nonempty command or none`);
    }
    if (VAGUE.test(test)) {
      fail(`${id} Test must not be vague`);
    }
    if (!VALID_TASK_STATUSES.has(status)) {
      fail(`${id} has invalid status`);
    }
    return { test, status };
  };

  for (let blockIndex = 0; blockIndex < starts.length; blockIndex++) {
    const end = starts[blockIndex + 1] ?? lines.length;
    const block = lines.slice(starts[blockIndex], end);
    const identity = parseIdentity(block, blockIndex);
    const { id } = identity;

    const legacyFilesMatch = block[2]?.match(/^- \*\*Files:\*\* (.+)$/);
    if (legacyFilesMatch) {
      if (block.length !== 5) {
        fail("legacy task fields must be exactly ordered: Satisfies, Files, Test, Status");
      }
      const filesValue = requiredExact(legacyFilesMatch[1], `${id} Files`);
      const files = validatePathsField(filesValue, `${id} Files`);
      if (files.length === 0) fail(`${id} needs at least one file`);
      const { test, status } = parseTestAndStatus(id, block[3], block[4]);
      tasks.push({
        ...identity,
        files,
        fileIntents: null,
        artifacts: [],
        test,
        status,
        format: "legacy",
      });
      continue;
    }

    if (block[2] !== "- **Files:**") {
      fail("structured task fields must be exactly ordered: Satisfies, Files, Artifacts, Test, Status");
    }
    let cursor = 3;
    const fileIntents = [];
    const filePaths = new Set();
    while (cursor < block.length && block[cursor] !== "- **Artifacts:**" && block[cursor] !== "- **Artifacts:** none") {
      const entry = block[cursor].match(/^  - `([^`]+)` — (create|modify|delete): (.+)$/);
      if (!entry) fail(`${id} Files entry must contain a backticked path, create|modify|delete operation, and intent`);
      const [, rawPath, operation, rawIntent] = entry;
      const pathValue = validateRepositoryPath(rawPath, `${id} Files`);
      const intent = requiredExact(rawIntent, `${id} Files intent`);
      if (VAGUE.test(intent)) fail(`${id} Files intent must not be vague`);
      if (filePaths.has(pathValue)) fail(`${id} Files contains duplicate path: ${pathValue}`);
      filePaths.add(pathValue);
      fileIntents.push({ path: pathValue, operation, intent });
      cursor++;
    }
    if (fileIntents.length === 0) fail(`${id} needs at least one structured file intent`);

    const artifacts = [];
    const artifactPaths = new Set();
    if (block[cursor] === "- **Artifacts:** none") {
      cursor++;
    } else if (block[cursor] === "- **Artifacts:**") {
      cursor++;
      while (cursor < block.length && !block[cursor].startsWith("- **Test:**")) {
        const entry = block[cursor].match(/^  - `([^`]+)` — reference: (.+); fidelity: (.+)$/);
        if (!entry) fail(`${id} Artifacts entry must contain path, reference role, and fidelity requirements`);
        const [, rawPath, rawRole, rawFidelity] = entry;
        const pathValue = validateArtifactPath(rawPath, feature, `${id} Artifacts`);
        const role = requiredExact(rawRole, `${id} Artifacts role`);
        const fidelity = requiredExact(rawFidelity, `${id} Artifacts fidelity`);
        if (VAGUE.test(role)) fail(`${id} Artifacts role must not be vague`);
        if (VAGUE.test(fidelity)) fail(`${id} Artifacts fidelity must not be vague`);
        if (artifactPaths.has(pathValue)) fail(`${id} Artifacts contains duplicate path: ${pathValue}`);
        artifactPaths.add(pathValue);
        artifacts.push({ path: pathValue, role, fidelity });
        cursor++;
      }
      if (artifacts.length === 0) fail(`${id} Artifacts must be none or contain at least one reference`);
    } else {
      fail(`${id} Artifacts must be none or an ordered reference list`);
    }

    if (cursor + 2 !== block.length) {
      fail("structured task fields must be exactly ordered: Satisfies, Files, Artifacts, Test, Status");
    }
    const { test, status } = parseTestAndStatus(id, block[cursor], block[cursor + 1]);
    tasks.push({
      ...identity,
      files: [...filePaths],
      fileIntents,
      artifacts,
      test,
      status,
      format: "structured",
    });
  }

  const formats = new Set(tasks.map((task) => task.format));
  if (formats.size !== 1) fail("Tasks must use one task grammar consistently");
  return { tasks, taskFormat: tasks[0].format };
}

function parseDecisions(content) {
  const value = section(content, "Decisions", true);
  if (value === "None.") return [];

  const lines = value.split("\n");
  if (lines.some(line => line.trim() === "")) {
    fail("Decisions must not contain blank or whitespace lines");
  }
  if (lines.length === 0 || lines.length % 3 !== 0) {
    fail("Decisions must be None. or sequential D blocks with no stray content");
  }
  const decisions = [];
  const ids = new Set();
  const numBlocks = lines.length / 3;

  for (let i = 0; i < numBlocks; i++) {
    const l1 = lines[i * 3];
    const l2 = lines[i * 3 + 1];
    const l3 = lines[i * 3 + 2];

    const m1 = l1.match(/^### (D-([1-9]\d*)): (.+)$/);
    if (!m1) fail(`Decision block ${i + 1} heading is invalid or malformed`);
    const [, id, ordinalStr, title] = m1;
    const ordinal = Number(ordinalStr);

    const m2 = l2.match(/^- \*\*Decision:\*\* (.+)$/);
    const m3 = l3.match(/^- \*\*Rationale:\*\* (.+)$/);
    if (!m2 || !m3) {
      fail("fields must be exactly ordered: Decision, Rationale");
    }
    const decision = requiredExact(m2[1], `${id} Decision`);
    const rationale = requiredExact(m3[1], `${id} Rationale`);
    if (VAGUE.test(decision) || VAGUE.test(rationale)) {
      fail(`${id} decision and rationale must be concrete`);
    }
    if (ordinal !== i + 1) fail("decision IDs must be sequential");
    if (ids.has(id)) fail(`duplicate decision ${id}`);
    ids.add(id);

    decisions.push({
      id,
      ordinal,
      title: requiredExact(title, `${id} title`),
      decision,
      rationale
    });
  }

  return decisions;
}


export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseMarkdownPacket(files) {
  if (typeof files !== "object" || files === null || Array.isArray(files) || Object.prototype.toString.call(files) !== "[object Object]") {
    fail("files must be a plain mapping");
  }
  const ownKeys = Reflect.ownKeys(files);
  if (ownKeys.some((k) => typeof k === "string" && ["proposal.md", "spec.md", "design.md"].includes(k))) {
    fail("legacy multi-file state is not allowed");
  }
  if (ownKeys.length !== 1 || ownKeys[0] !== "plan.md") {
    fail("files mapping must contain exactly plan.md");
  }
  const plan = canonicalSource(files["plan.md"], "plan.md");
  validateTitle(plan, "Plan");
  validateSections(plan, [
    "Feature",
    "Base",
    "Summary",
    "Context",
    "Scope",
    "Acceptance Criteria",
    "Decisions",
    "Invariants",
    "Non-goals",
    "Interfaces",
    "Publication",
    "Tasks"
  ]);

  const feature = parseFeature(plan);
  parseBase(plan);
  parseSummary(plan);
  parseContext(plan);
  parseScope(plan);

  const criteria = parseCriteria(plan);
  const decisions = parseDecisions(plan);
  const invariants = parseIdentifierList(plan, "Invariants", "I");
  const nonGoals = parseIdentifierList(plan, "Non-goals", "NG");
  const interfaces = parseInterfaces(plan, criteria);

  const publication = section(plan, "Publication", true);
  if (publication !== "null" && publication !== `\`docs/gsd/${feature}/milestones.md\``) {
    fail("Publication must be null or the canonical Markdown ledger path whose slug exactly equals Feature");
  }

  const { tasks, taskFormat } = parseTasks(plan, criteria, feature);

  let pubPath = null;
  if (publication !== "null") {
    pubPath = publication.replace(/^`|`$/g, "");
  }

  let pubPathCount = 0;
  for (const task of tasks) {
    for (const file of task.files) {
      const isMilestone = /^docs\/gsd\/[^/]+\/milestones\.md$/.test(file);
      if (isMilestone) {
        if (pubPath === null || file !== pubPath) {
          fail(`unowned or mismatched milestone ledger path is not allowed: ${file}`);
        }
      }
      if (task.status !== "superseded") {
        if (pubPath !== null && file === pubPath) {
          pubPathCount++;
        }
      }
    }
  }

  if (pubPath !== null && pubPathCount !== 1) {
    fail(`non-null publication path must occur exactly once across non-superseded tasks, but found ${pubPathCount}`);
  }

  // For each non-superseded task satisfying multiple ACs, require all pinned seam/path/lower-reason triples identical
  for (const task of tasks) {
    if (task.status !== "superseded" && task.satisfies.length > 1) {
      const firstAc = task.satisfies[0];
      const firstPin = interfaces.get(firstAc);
      for (let i = 1; i < task.satisfies.length; i++) {
        const currentAc = task.satisfies[i];
        const currentPin = interfaces.get(currentAc);
        if (
          firstPin.seam !== currentPin.seam ||
          firstPin.path !== currentPin.path ||
          firstPin.lowerReason !== currentPin.lowerReason
        ) {
          fail(`Task ${task.id} satisfies multiple ACs but their interface pins (seam, path, lower-seam reason) are not identical`);
        }
      }
    }
  }
  const coverage = new Map();
  for (const task of tasks) {
    if (task.status !== "superseded") {
      for (const criterion of task.satisfies) {
        coverage.set(criterion, (coverage.get(criterion) ?? 0) + 1);
      }
    }
  }
  const active = criteria.filter((criterion) => criterion.state === "active").map((criterion) => criterion.id);
  if (active.some((criterion) => coverage.get(criterion) !== 1)) fail("plan must cover every active criterion exactly once");

  return { feature, criteria, interfaces, invariants, nonGoals, tasks, taskFormat, decisions };
}

export function bindApprovedSources(files) {
  parseMarkdownPacket(files);
  return { "plan.md": sha256(files["plan.md"]) };
}

export function verifyApprovedSources(files, binding) {
  const current = bindApprovedSources(files);
  const expectedNames = Object.keys(binding).sort();
  const currentNames = Object.keys(current).sort();
  if (expectedNames.join("|") !== currentNames.join("|")) fail("source set changed after approval");
  for (const name of expectedNames) {
    if (binding[name] !== current[name]) fail(`${name} hash mismatch after approval`);
  }
  return current;
}

export function rejectLegacyPreapprovalFiles(names) {
  const legacy = names.filter((name) => /^(proposal|spec|design|plan)\.toon$/.test(name));
  if (legacy.length > 0) fail(`legacy pre-approval TOON is not authoritative: ${legacy.join(", ")}`);
}
