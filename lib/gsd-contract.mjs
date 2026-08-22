import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

const VAGUE = /^(?:tbd|todo|works correctly|run tests|valid|covered|success)\.?$/i;
const VALID_TASK_STATUSES = new Set(["pending", "in_progress", "done", "superseded"]);

function fail(message) {
  throw new Error(`Markdown contract: ${message}`);
}

// fd-anchored traversal: open each path component relative to the previous fd
// using /proc/self/fd/<dirfd>/<child>. This eliminates the TOCTOU window between
// pathname validation and file open by anchoring every step to an already-open fd.
// Requires Linux /proc/self/fd; fails closed on other platforms.
const DIR_FLAGS = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | (fs.constants.O_NOFOLLOW ?? 0);

// An unreadable file is the environment failing, not the author writing bad authority.
// The tag travels on the error so the CLI classifies without matching message text.
function failIo(message) {
  const error = new Error(`Markdown contract: ${message}`);
  error.contractFailure = "io-error";
  throw error;
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

function validateRepositoryPath(pathValue, fieldLabel) {
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
    if (segment === ".scratch") {
      fail(`${fieldLabel} contains .scratch: ${pathValue}`);
    }
  }
  if (pathValue.endsWith(".toon")) {
    fail(`${fieldLabel} contains runtime TOON path: ${pathValue}`);
  }
  if (isDurableRecordScope(pathValue) && !isDurableRecordPath(pathValue)) {
    fail(`${fieldLabel} durable record path must match docs/(decisions|design)/NNNN-slug.md: ${pathValue}`);
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

function parseBacktickedCommand(value, label) {
  const exact = requiredExact(value, label);
  const isBackticked = exact.startsWith("`") && exact.endsWith("`") && !exact.slice(1, -1).includes("`");
  if (!isBackticked) {
    fail(`${label} must be one fully backticked nonempty command`);
  }
  const command = exact.slice(1, -1);
  if (!command || command !== command.trim()) {
    fail(`${label} must be one fully backticked nonempty concrete command`);
  }
  if (VAGUE.test(command)) fail(`${label} must not be vague`);
  return command;
}


function validateTitle(content, title) {
  const headings = [...content.matchAll(/^# (.+)$/gm)].map(([, heading]) => heading);
  if (headings.length !== 1 || headings[0] !== title || !content.startsWith(`# ${title}\n`)) {
    fail(`top-level heading must be exactly # ${title}`);
  }
  // `validateSections` only inspects `## ` lines, so the region between the title and the
  // first section is unowned: without this, both grammars accept arbitrary preamble prose.
  if (!content.startsWith(`# ${title}\n## `)) {
    fail(`# ${title} must be followed directly by the first ## section`);
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

function section(content, heading, requiredSection = true) {
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

// A recorded base is interpolated into Git commands as the merge target, so its shape is a
// safety boundary rather than cosmetics. The allowlist already excludes whitespace, control
// bytes, and every character Git or a shell could reinterpret (`@{`, `~^:?*[\`, quotes, `$`,
// `;`), leaving only git-check-ref-format's structural rules to enforce below.
export const PLAN_BASE_RE = /^[A-Za-z0-9._/-]+$/;

export function isSafeBranchRef(value) {
  if (typeof value !== "string" || !PLAN_BASE_RE.test(value)) return false;
  if (Buffer.byteLength(value, "utf8") > 255) return false;
  // A leading dash reaches Git as an option and `..` is a range operator.
  if (value.startsWith("-") || value.includes("..") || value.endsWith(".")) return false;
  return value
    .split("/")
    .every((segment) => segment !== "" && !segment.startsWith(".") && !segment.endsWith(".lock"));
}

function parseBase(content, feature = null) {
  const value = section(content, "Base");
  const match = value.match(/^`([^`]+)`$/);
  if (!match) fail("Base must be exactly one complete backticked branch or reference line with no extra text");
  if (!isSafeBranchRef(match[1])) {
    fail(`Base must be a Git branch name able to receive the merge: ${match[1]}`);
  }
  // The WIP branch is cut from the base, so a self-referencing base leaves the packet
  // with no merge target: the terminal squash would target the branch being squashed.
  if (feature !== null && match[1] === `wip/${feature}`) {
    fail(`Base must name the branch the packet was cut from, never its own WIP branch wip/${feature}`);
  }
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

const DOMAIN_CLASSIFICATIONS = new Set([
  "none",
  "change-existing-context",
  "introduce-context",
  "change-context-boundary",
]);
const DOMAIN_DOCUMENTATION = new Set(["none", "update-existing", "bootstrap-feature-context"]);
const BROAD_BOOTSTRAP = new Set(["not-offered", "declined", "selected"]);

function parseDomainImpact(content) {
  const fields = orderedFields(section(content, "Domain Impact"), [
    "Classification",
    "Contexts",
    "Documentation",
    "Broad bootstrap",
    "Evidence",
  ]);
  const classification = fields.Classification;
  if (!DOMAIN_CLASSIFICATIONS.has(classification)) {
    fail("Domain Impact Classification is invalid");
  }

  const rawContexts = fields.Contexts;
  let contexts = [];
  if (rawContexts !== "none") {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:, [a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(rawContexts)) {
      fail("Domain Impact Contexts must be none or comma-space-separated lowercase slugs");
    }
    contexts = rawContexts.split(", ");
    if (new Set(contexts).size !== contexts.length) fail("Domain Impact Contexts must be unique");
    if (contexts.join("|") !== [...contexts].sort().join("|")) {
      fail("Domain Impact Contexts must be sorted");
    }
  }

  const documentation = fields.Documentation;
  if (!DOMAIN_DOCUMENTATION.has(documentation)) {
    fail("Domain Impact Documentation is invalid");
  }
  const broadBootstrap = fields["Broad bootstrap"];
  if (!BROAD_BOOTSTRAP.has(broadBootstrap)) {
    fail("Domain Impact Broad bootstrap is invalid");
  }
  const evidence = fields.Evidence;
  if (VAGUE.test(evidence)) fail("Domain Impact Evidence must be concrete");

  if (classification === "none") {
    if (contexts.length !== 0 || documentation !== "none") {
      fail("Domain Impact classification none requires Contexts and Documentation to be none");
    }
  } else {
    if (contexts.length === 0) fail("Domain-changing work requires at least one affected context");
    if (documentation === "none") fail("Domain-changing work requires domain documentation");
    if (classification === "introduce-context" && documentation !== "bootstrap-feature-context") {
      fail("introduce-context requires bootstrap-feature-context documentation");
    }
  }

  return { classification, contexts, documentation, broadBootstrap, evidence };
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

function parseTasks(content, criteria) {
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
  const known = new Set(criteria.map((criterion) => criterion.id));

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
    if (satisfies.length === 0 || satisfies.some((criterion) => !known.has(criterion))) {
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
    const test = parseBacktickedCommand(testMatch[1], `${id} Test`);
    const status = requiredExact(statusMatch[1], `${id} Status`);
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

    if (block[2] !== "- **Files:**") {
      fail("structured task fields must be exactly ordered: Satisfies, Files, Test, Status");
    }
    let cursor = 3;
    const fileIntents = [];
    const filePaths = new Set();
    while (cursor < block.length && !block[cursor].startsWith("- **Test:**")) {
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


    if (cursor + 2 !== block.length) {
      fail("structured task fields must be exactly ordered: Satisfies, Files, Test, Status");
    }
    const { test, status } = parseTestAndStatus(id, block[cursor], block[cursor + 1]);
    if (status !== "superseded" && identity.satisfies.some((criterion) => !active.has(criterion))) {
      fail(`${id} must satisfy an active criterion`);
    }
    tasks.push({
      ...identity,
      files: [...filePaths],
      fileIntents,
      test,
      status,
    });
  }

  return { tasks };
}

// A wave is a maximal contiguous run of non-superseded tasks in strict heading
// order where every pair is independent. Independence is file-disjoint,
// AC-disjoint, and check-disjoint: two tasks that write the same path, prove
// the same criterion, or run the same focused check cannot be dispatched
// concurrently because their green evidence would race. Every wave is
// dispatched, so wave size is the only distinction: one task goes to one
// sub-agent, several run concurrently.
export function analyzeWaves(tasks) {
  if (!Array.isArray(tasks)) {
    fail("tasks must be an array");
  }
  const active = tasks.filter((task) => task.status !== "superseded");
  const byId = new Map(active.map((task) => [task.id, task]));
  const waves = [];
  let current = null;
  for (const task of active) {
    if (current !== null && current.tasks.every((id) => tasksIndependent(task, byId.get(id)))) {
      current.tasks.push(task.id);
      continue;
    }
    current = { tasks: [task.id] };
    waves.push(current);
  }
  return waves;
}

function tasksIndependent(a, b) {
  if (a.files.some((path) => b.files.includes(path))) return false;
  const aSatisfies = Array.isArray(a.satisfies) ? a.satisfies : [];
  const bSatisfies = Array.isArray(b.satisfies) ? b.satisfies : [];
  if (aSatisfies.some((criterion) => bSatisfies.includes(criterion))) return false;
  // A shared real focused check would race in parallel; `none` means no check exists
  // to race, so two mechanical tasks stay independent on this axis.
  if (a.test !== "none" && a.test === b.test) return false;
  return true;
}

function parseQuickFixTasks(content) {
  const lines = section(content, "Tasks", true).split("\n");
  if (lines.some((line) => line.trim() === "")) {
    fail("Quick-fix Tasks must not contain blank or whitespace lines");
  }
  const starts = [];
  for (let index = 0; index < lines.length; index++) {
    if (/^### T[1-9]\d*: /.test(lines[index])) starts.push(index);
  }
  if (starts.length < 1 || starts.length > 2 || starts[0] !== 0) {
    fail("Quick-fix Tasks must contain one or two sequential task blocks");
  }

  const tasks = [];
  const ownedPaths = new Set();
  for (let blockIndex = 0; blockIndex < starts.length; blockIndex++) {
    const end = starts[blockIndex + 1] ?? lines.length;
    const block = lines.slice(starts[blockIndex], end);
    const heading = block[0]?.match(/^### (T([1-9]\d*)): (.+)$/);
    if (!heading || Number(heading[2]) !== blockIndex + 1) {
      fail("Quick-fix task IDs must be sequential");
    }
    const [, id, , rawTitle] = heading;
    const title = requiredExact(rawTitle, `${id} title`);
    if (block[1] !== "- **Files:**") {
      fail(`${id} fields must be exactly ordered: Files, Test`);
    }

    const fileIntents = [];
    let cursor = 2;
    while (cursor < block.length && !block[cursor].startsWith("- **Test:**")) {
      const entry = block[cursor].match(/^  - `([^`]+)` — (create|modify|delete): (.+)$/);
      if (!entry) {
        fail(`${id} Files entry must contain a backticked path, create|modify|delete operation, and intent`);
      }
      const [, rawPath, operation, rawIntent] = entry;
      const pathValue = validateRepositoryPath(rawPath, `${id} Files`);
      const intent = requiredExact(rawIntent, `${id} Files intent`);
      if (VAGUE.test(intent)) fail(`${id} Files intent must not be vague`);
      if (ownedPaths.has(pathValue)) fail(`Quick-fix Tasks contain duplicate path: ${pathValue}`);
      ownedPaths.add(pathValue);
      fileIntents.push({ path: pathValue, operation, intent });
      cursor++;
    }
    if (fileIntents.length === 0 || cursor + 1 !== block.length) {
      fail(`${id} fields must be exactly ordered: Files, Test`);
    }
    const testMatch = block[cursor].match(/^- \*\*Test:\*\* (.+)$/);
    if (!testMatch) fail(`${id} fields must be exactly ordered: Files, Test`);
    const test = parseBacktickedCommand(testMatch[1], `${id} Test`);
    if (test === "none") fail(`${id} Test must be a focused command`);
    tasks.push({ id, title, fileIntents, files: fileIntents.map(({ path }) => path), test });
  }
  return { tasks, ownedPaths };
}

// Only production sources carry semantics. Prose records behavior and tests only
// observe it (test/, tests/, __tests__/, spec/ directories, or *.test.* / *.spec.* filenames),
// so neither can be the change a domain shard is documenting.
const isProsePath = (path) => path.startsWith("docs/") || path === "AGENTS.md" || path.endsWith("/AGENTS.md");
const isTestPath = (path) =>
  path.startsWith("test/") ||
  path.startsWith("tests/") ||
  /(^|\/)(__tests__|spec)\//.test(path) ||
  /(^|\/)[^/]+\.(test|spec)\.[^/.]+$/.test(path);
const carriesSemanticCode = (task) => task.files.some((path) => !isProsePath(path) && !isTestPath(path));
const DURABLE_RECORD_PATH_RE = /^docs\/(decisions|design)\/\d+-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const isDurableRecordScope = (path) => path.startsWith("docs/decisions/") || path.startsWith("docs/design/");
const isDurableRecordPath = (path) => DURABLE_RECORD_PATH_RE.test(path);

export function parseQuickFixPlan(files) {
  if (typeof files !== "object" || files === null || Array.isArray(files) || Object.prototype.toString.call(files) !== "[object Object]") {
    fail("files must be a plain mapping");
  }
  const ownKeys = Reflect.ownKeys(files);
  if (ownKeys.length !== 1 || ownKeys[0] !== "plan.md") {
    fail("files mapping must contain exactly plan.md");
  }
  const plan = canonicalSource(files["plan.md"], "plan.md");
  validateTitle(plan, "Quick-fix Plan");
  validateSections(plan, ["Feature", "Base", "Domain Impact", "Tasks"]);
  const feature = parseFeature(plan);
  const base = parseBase(plan, feature);
  const domainImpact = parseDomainImpact(plan);
  if (domainImpact.broadBootstrap !== "not-offered") {
    fail("Quick-fix Domain Impact Broad bootstrap must be not-offered");
  }
  const { tasks } = parseQuickFixTasks(plan);
  if (domainImpact.classification !== "none") {
    const semanticTasks = tasks.flatMap((task, index) => (carriesSemanticCode(task) ? [index] : []));
    // Task paths are unique plan-wide and a shard maps to no single source file, so a
    // second semantic task would leave its own change undocumented at its checkpoint.
    if (semanticTasks.length !== 1) {
      fail("Quick-fix with domain impact must change semantic code in exactly one task");
    }
    for (const context of domainImpact.contexts) {
      const shard = `docs/domain/${context}.md`;
      // Task paths are unique plan-wide, so at most one task owns the shard, and it
      // must be the sole semantic task: documentation lands with the semantics it
      // describes, leaving no green checkpoint with drifted domain docs.
      const ownerIndex = tasks.findIndex(task => task.files.includes(shard));
      if (ownerIndex === -1) fail(`Quick-fix plan must own affected domain shard: ${shard}`);
      if (ownerIndex !== semanticTasks[0]) {
        fail(`Quick-fix must own affected domain shard ${shard} in the same task as the semantic code it documents`);
      }
    }
  }
  return { feature, base, domainImpact, tasks };
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

function parseMarkdownPacket(files) {
  if (typeof files !== "object" || files === null || Array.isArray(files) || Object.prototype.toString.call(files) !== "[object Object]") {
    fail("files must be a plain mapping");
  }
  const ownKeys = Reflect.ownKeys(files);
  if (ownKeys.some((key) => typeof key === "string" && ["proposal.md", "spec.md", "design.md"].includes(key))) {
    fail("legacy multi-file state is not allowed");
  }
  if (ownKeys.length !== 1 || ownKeys[0] !== "plan.md") {
    fail("files mapping must contain exactly plan.md");
  }
  const plan = canonicalSource(files["plan.md"], "plan.md");
  validateTitle(plan, "Plan");
  if (!/^## Domain Impact$/m.test(plan)) {
    fail("missing Domain Impact section");
  }
  validateSections(plan, [
    "Feature",
    "Base",
    "Summary",
    "Context",
    "Domain Impact",
    "Scope",
    "Acceptance Criteria",
    "Decisions",
    "Invariants",
    "Non-goals",
    "Interfaces",
    "Publication",
    "Tasks",
  ]);

  const feature = parseFeature(plan);
  const base = parseBase(plan, feature);
  parseSummary(plan);
  parseContext(plan);
  const domainImpact = parseDomainImpact(plan);
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

  const { tasks } = parseTasks(plan, criteria);

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
      if (task.status !== "superseded" && pubPath !== null && file === pubPath) {
        pubPathCount++;
      }
    }
  }

  if (pubPath !== null && pubPathCount !== 1) {
    fail(`non-null publication path must occur exactly once across non-superseded tasks, but found ${pubPathCount}`);
  }

  for (const task of tasks) {
    if (task.status !== "superseded" && task.satisfies.length > 1) {
      const firstAc = task.satisfies[0];
      const firstPin = interfaces.get(firstAc);
      for (let index = 1; index < task.satisfies.length; index++) {
        const currentAc = task.satisfies[index];
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
  if (active.some((criterion) => coverage.get(criterion) !== 1)) {
    fail("plan must cover every active criterion exactly once");
  }

  // Quick-fix enforced this from the start; a full plan carried the same non-`none`
  // Domain Impact with no shard task at all. Full plans differ in two ways: paths
  // deduplicate per task, so a shard is legitimately re-owned across checkpoints, and
  // `superseded` tasks never run, so ownership there documents nothing.
  if (domainImpact.classification !== "none") {
    const live = tasks.filter((task) => task.status !== "superseded");
    // Affected context shards are required; `index.md` and `AGENTS.md` are optional but,
    // when the plan owns either, that ownership must also carry semantic code.
    const paths = domainImpact.contexts.map((context) => `docs/domain/${context}.md`);
    for (const path of ["docs/domain/index.md", "AGENTS.md"]) {
      if (live.some((task) => task.files.includes(path))) paths.push(path);
    }
    for (const path of paths) {
      const owners = live.filter((task) => task.files.includes(path));
      if (owners.length === 0) fail(`plan must own affected domain shard: ${path}`);
      // Every live owner must carry the semantics it documents: a trailing
      // documentation-only task lands a green checkpoint that changes nothing it describes.
      const orphan = owners.find((task) => !carriesSemanticCode(task));
      if (orphan) {
        fail(`plan must own ${path} in a task that also changes the semantic code it documents, but ${orphan.id} does not`);
      }
    }
  }

  return {
    feature,
    base,
    domainImpact,
    criteria,
    interfaces,
    invariants,
    nonGoals,
    tasks,
    decisions,
  };
}

export { parseMarkdownPacket };

function sourceHashes(files) {
  if (typeof files !== "object" || files === null || Array.isArray(files) || Object.prototype.toString.call(files) !== "[object Object]") {
    fail("files must be a plain mapping");
  }
  const ownKeys = Reflect.ownKeys(files);
  if (ownKeys.length !== 1 || ownKeys[0] !== "plan.md" || typeof files["plan.md"] !== "string") {
    fail("files mapping must contain exactly plan.md");
  }
  return { "plan.md": sha256(files["plan.md"]) };
}

export function verifyApprovedSources(files, binding) {
  const current = sourceHashes(files);
  if (typeof binding !== "object" || binding === null || Array.isArray(binding)) {
    fail("binding must be a plain mapping");
  }
  const expectedNames = Object.keys(binding).sort();
  const currentNames = Object.keys(current).sort();
  if (expectedNames.join("|") !== currentNames.join("|")) fail("source set changed after approval");
  for (const name of expectedNames) {
    if (binding[name] !== current[name]) fail(`${name} hash mismatch after approval`);
  }
  parseMarkdownPacket(files);
  return current;
}

export const PLAN_FILE_MAX_BYTES = 1024 * 1024;

export const PLAN_FEATURE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PLAN_SHA256_RE = /^[a-f0-9]{64}$/;
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function resolvePlanLocation(planPath, cwd) {
  if (typeof planPath !== "string" || planPath === "") {
    fail("plan path is required");
  }
  if (typeof cwd !== "string" || cwd === "") {
    fail("workspace path is required");
  }

  let workspace;
  try {
    workspace = fs.realpathSync(path.resolve(cwd));
  } catch (error) {
    fail(`workspace cannot be resolved: ${error.message}`);
  }
  const absolute = path.resolve(workspace, planPath);
  const relative = path.relative(workspace, absolute);
  const segments = relative.split(path.sep);
  if (
    relative === "" ||
    path.isAbsolute(relative) ||
    segments.length !== 3 ||
    segments[0] !== ".scratch" ||
    !PLAN_FEATURE_RE.test(segments[1]) ||
    segments[2] !== "plan.md"
  ) {
    fail("plan path must be .scratch/<feature>/plan.md inside the current workspace");
  }

  const scratch = path.join(workspace, ".scratch");
  const featureDirectory = path.join(scratch, segments[1]);
  const expected = {};
  for (const [candidate, label] of [
    [workspace, "workspace root"],
    [scratch, ".scratch"],
    [featureDirectory, "feature directory"],
  ]) {
    let inspected;
    try {
      inspected = fs.lstatSync(candidate);
    } catch (error) {
      fail(`${label} cannot be inspected: ${error.message}`);
    }
    if (inspected.isSymbolicLink() || !inspected.isDirectory()) {
      fail(`${label} must be a real directory`);
    }
    if (candidate === workspace) { expected.rootDev = inspected.dev; expected.rootIno = inspected.ino; }
    else if (candidate === scratch) { expected.scratchDev = inspected.dev; expected.scratchIno = inspected.ino; }
    else { expected.featureDev = inspected.dev; expected.featureIno = inspected.ino; }
  }

  let realFeatureDirectory;
  try {
    realFeatureDirectory = fs.realpathSync(featureDirectory);
  } catch (error) {
    fail(`feature directory cannot be resolved: ${error.message}`);
  }
  if (realFeatureDirectory !== featureDirectory) {
    fail("feature directory must resolve without indirection");
  }
  return { absolute, feature: segments[1], expected };
}

export function readPlanFile(planPath, { cwd = process.cwd() } = {}) {
  const location = resolvePlanLocation(planPath, cwd);
  const { expected } = location;
  const workspaceRoot = path.resolve(location.absolute, '..', '..', '..');

  // fd-anchored traversal: pin workspace → .scratch → feature dir, all through
  // parent fds via /proc/self/fd. Compare each opened fd against the identities
  // captured during resolution to detect swaps between validation and pinning.
  let rootFd, scratchFd, featureFd, descriptor;
  try {
    rootFd = fs.openSync(workspaceRoot, DIR_FLAGS);
    const rootStat = fs.fstatSync(rootFd);
    if (!rootStat.isDirectory() || rootStat.dev !== expected.rootDev || rootStat.ino !== expected.rootIno) {
      fail('workspace root identity changed before open');
    }

    scratchFd = fs.openSync(`/proc/self/fd/${rootFd}/.scratch`, DIR_FLAGS);
    const scratchStat = fs.fstatSync(scratchFd);
    if (!scratchStat.isDirectory() || scratchStat.dev !== expected.scratchDev || scratchStat.ino !== expected.scratchIno) {
      fail('.scratch identity changed before open');
    }

    featureFd = fs.openSync(`/proc/self/fd/${scratchFd}/${location.feature}`, DIR_FLAGS);
    const featureStat = fs.fstatSync(featureFd);
    if (!featureStat.isDirectory() || featureStat.dev !== expected.featureDev || featureStat.ino !== expected.featureIno) {
      fail('feature directory identity changed before open');
    }

    // Open plan.md through the pinned feature fd.
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | fs.constants.O_NONBLOCK;
    try {
      descriptor = fs.openSync(`/proc/self/fd/${featureFd}/plan.md`, flags);
    } catch (error) {
      // ELOOP = symlink plan.md, ENOENT = missing plan.md — both are malformed authority.
      if (error.code === 'ELOOP' || error.code === 'ENOENT') {
        fail(`plan file ${error.code === 'ELOOP' ? 'is a symlink' : 'does not exist'}`);
      }
      throw error;
    }
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile()) fail('plan file must be a regular file');
    if (opened.size > PLAN_FILE_MAX_BYTES) fail(`plan file exceeds ${PLAN_FILE_MAX_BYTES} bytes`);

    const capacity = Math.min(PLAN_FILE_MAX_BYTES + 1, opened.size + 1);
    const buffer = Buffer.allocUnsafe(Math.max(1, capacity));
    let total = 0;
    while (total < buffer.length) {
      const read = fs.readSync(descriptor, buffer, total, buffer.length - total, null);
      if (read === 0) break;
      total += read;
    }
    if (total > PLAN_FILE_MAX_BYTES) fail(`plan file exceeds ${PLAN_FILE_MAX_BYTES} bytes`);

    const afterRead = fs.fstatSync(descriptor);
    if (
      afterRead.dev !== opened.dev || afterRead.ino !== opened.ino ||
      afterRead.size !== opened.size || afterRead.mtimeMs !== opened.mtimeMs ||
      afterRead.ctimeMs !== opened.ctimeMs
    ) fail('plan file changed during read');

    let content;
    try { content = FATAL_UTF8_DECODER.decode(buffer.subarray(0, total)); } catch { fail('plan file must be valid UTF-8'); }
    if (content.startsWith('\uFEFF')) fail('plan file must not start with a UTF-8 BOM');

    return {
      content,
      bytes: Buffer.from(buffer.subarray(0, total)),
      feature: location.feature,
      path: location.absolute,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Markdown contract:')) throw error;
    failIo(`plan file cannot be read: ${error.message}`);
  } finally {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* best effort */ }
    if (featureFd !== undefined) try { fs.closeSync(featureFd); } catch { /* best effort */ }
    if (scratchFd !== undefined) try { fs.closeSync(scratchFd); } catch { /* best effort */ }
    if (rootFd !== undefined) try { fs.closeSync(rootFd); } catch { /* best effort */ }
  }
}

export function validatePlanFile(
  planPath,
  { cwd = process.cwd(), kind = "plan", expectedSha256 = null, expectedBase = null } = {},
) {
  const source = readPlanFile(planPath, { cwd });
  const files = { "plan.md": source.content };
  const sourceSha256 = sha256(source.bytes);
  let parsed;

  if (kind === "plan") {
    if (expectedSha256 === null) {
      parsed = parseMarkdownPacket(files);
    } else {
      if (typeof expectedSha256 !== "string" || !PLAN_SHA256_RE.test(expectedSha256)) {
        fail("expected SHA-256 must be exactly 64 lowercase hexadecimal characters");
      }
      if (expectedSha256 !== sourceSha256) {
        fail("plan.md hash mismatch after approval");
      }
      // The exact-byte hash was compared above, so re-running verifyApprovedSources would only parse the packet a second time; that export stays for callers holding unverified bytes.
      parsed = parseMarkdownPacket(files);
    }
  } else if (kind === "quick-fix") {
    if (expectedSha256 !== null) {
      fail("Quick-fix validation does not accept an expected SHA-256");
    }
    parsed = parseQuickFixPlan(files);
  } else {
    fail(`unsupported plan kind: ${kind}`);
  }

  if (parsed.feature !== source.feature) {
    fail(`plan feature ${parsed.feature} does not match directory ${source.feature}`);
  }
  // `plan.md` § Base and `state.toon` `base_ref` are two records of one decision, and the
  // merge target is read from state. Without this equality a packet can be hash-bound to a
  // plan naming one base while verification and the squash target another.
  if (expectedBase !== null && parsed.base !== expectedBase) {
    fail(`plan base ${parsed.base} does not match recorded base_ref ${expectedBase}`);
  }
  return {
    kind,
    feature: parsed.feature,
    base: parsed.base,
    sha256: sourceSha256,
    tasks: parsed.tasks.length,
    parsed,
  };
}

