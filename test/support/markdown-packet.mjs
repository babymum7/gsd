import { createHash } from "node:crypto";

const REQUIRED_PACKET_FILES = ["proposal.md", "spec.md", "plan.md"];
const VAGUE = /^(?:tbd|todo|works correctly|run tests|valid|covered|success)\.?$/i;

function fail(message) {
  throw new Error(`Markdown contract: ${message}`);
}

function required(value, label) {
  const normalized = value?.trim();
  if (!normalized) fail(`${label} is required`);
  return normalized;
}

function canonicalSource(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} is required`);
  if (value.includes("\r")) fail(`${label} must use LF line endings`);
  if (/^[ \t]*\n/.test(value) || /\n(?:[ \t]*\n|[ \t]+)$/.test(value)) fail(`${label} must not have leading or trailing blank lines`);
  return value;
}

function validateTitle(content, title) {
  const headings = [...content.matchAll(/^# (.+)$/gm)].map(([, heading]) => heading);
  if (headings.length !== 1 || headings[0] !== title || !content.startsWith(`# ${title}\n`)) {
    fail(`top-level heading must be exactly # ${title}`);
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
  return matches[0][1].trim();
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
  return Object.fromEntries(entries.map(([, label, value]) => [label, required(value, label)]));
}

function parseFeature(content) {
  const value = section(content, "Feature");
  const matches = [...value.matchAll(/^`([a-z0-9]+(?:-[a-z0-9]+)*)`$/gm)];
  if (matches.length !== 1) fail("Feature must contain exactly one backticked slug");
  return matches[0][1];
}

function parseCriteria(content) {
  const value = section(content, "Acceptance Criteria");
  const entries = [...value.matchAll(/^### (AC-([1-9]\d*)): (.+)\n([\s\S]*?)(?=^### |(?![\s\S]))/gm)];
  if (entries.length === 0) fail("at least one acceptance criterion is required");
  const ids = new Set();
  return entries.map(([, id, ordinal, title, block], index) => {
    if (Number(ordinal) !== index + 1) fail("criterion IDs must be sequential");
    if (ids.has(id)) fail(`duplicate criterion ${id}`);
    ids.add(id);
    const { State: state, Outcome: outcome, Action: action, Expected: expected } = orderedFields(
      block,
      ["State", "Outcome", "Action", "Expected"],
    );
    if (state !== "active" && state !== "superseded") fail(`${id} has invalid state`);
    if (VAGUE.test(outcome) || VAGUE.test(action) || VAGUE.test(expected)) fail(`${id} outcome, action, and expected must be concrete`);
    return { id, ordinal: Number(ordinal), title: required(title, `${id} title`), state, outcome, action, expected };
  });
}

function parseIdentifierList(content, heading, prefix) {
  const value = section(content, heading);
  const entries = [...value.matchAll(new RegExp(`^- \\*\\*(${prefix}-[1-9]\\d*):\\*\\* (.+)$`, "gm"))];
  if (entries.length === 0) fail(`${heading} must not be empty`);
  const ids = new Set();
  return entries.map(([, id, text]) => {
    if (ids.has(id)) fail(`duplicate ${id}`);
    ids.add(id);
    return { id, text: required(text, id) };
  });
}

function parseInterfaces(content, criteria) {
  const value = section(content, "Interfaces");
  const rows = value.split("\n").filter((line) => line.startsWith("|"));
  if (rows.length < 3) fail("Interfaces table is required");
  const parseRow = (line) => line.split("|").slice(1, -1).map((cell) => cell.trim().replace(/^`|`$/g, ""));
  const header = parseRow(rows[0]);
  if (header.join("|") !== "Criterion|Seam|Path|Lower-seam reason") fail("Interfaces header is invalid");
  const active = new Set(criteria.filter((criterion) => criterion.state === "active").map((criterion) => criterion.id));
  const pins = new Map();
  for (const row of rows.slice(2)) {
    const [criterion, seam, path, lowerReason] = parseRow(row);
    if (!active.has(criterion) || pins.has(criterion)) fail(`invalid interface pin ${criterion}`);
    if (!seam || !path || !lowerReason) fail(`incomplete interface pin ${criterion}`);
    pins.set(criterion, { seam, path, lowerReason });
  }
  if (pins.size !== active.size) fail("every active criterion needs exactly one interface pin");
  return pins;
}

function parseTasks(content, criteria) {
  const value = section(content, "Tasks");
  const entries = [...value.matchAll(/^### (T([1-9]\d*)): (.+)\n([\s\S]*?)(?=^### |(?![\s\S]))/gm)];
  if (entries.length === 0) fail("at least one task is required");
  const active = new Set(criteria.filter((criterion) => criterion.state === "active").map((criterion) => criterion.id));
  return entries.map(([, id, ordinal, title, block], index) => {
    if (Number(ordinal) !== index + 1) fail("task IDs must be sequential");
    const { Satisfies: satisfiesValue, Files: filesValue, Test: testValue, Status: status } = orderedFields(
      block,
      ["Satisfies", "Files", "Test", "Status"],
    );
    const satisfies = satisfiesValue.split(",").map((value) => value.trim());
    if (satisfies.length === 0 || satisfies.some((criterion) => !active.has(criterion))) fail(`${id} has unknown criterion`);
    const files = [...filesValue.matchAll(/`([^`]+)`/g)].map(([, path]) => path);
    if (files.length === 0) fail(`${id} needs at least one file`);
    const test = testValue.replace(/^`|`$/g, "");
    if (!test) fail(`${id} needs a focused test or none`);
    if (!new Set(["pending", "in_progress", "done", "superseded"]).has(status)) fail(`${id} has invalid status`);
    return { id, title: required(title, `${id} title`), satisfies, files, test, status };
  });
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseMarkdownPacket(files) {
  const proposal = canonicalSource(files["proposal.md"], "proposal.md");
  const spec = canonicalSource(files["spec.md"], "spec.md");
  const plan = canonicalSource(files["plan.md"], "plan.md");
  validateTitle(proposal, "Proposal");
  validateTitle(spec, "Specification");
  validateTitle(plan, "Plan");
  validateSections(proposal, ["Feature", "Summary", "Why", "Scope", "Impact", "Questions"]);
  validateSections(spec, ["Feature", "Context", "Acceptance Criteria", "Invariants", "Non-goals", "Interfaces", "Publication"], ["Publication"]);
  validateSections(plan, ["Feature", "Base", "Self-host bootstrap", "Tasks"], ["Self-host bootstrap"]);
  for (const heading of ["Summary", "Why", "Scope", "Impact", "Questions"]) required(section(proposal, heading), heading);
  required(section(spec, "Context"), "Context");
  const feature = parseFeature(proposal);
  if (parseFeature(spec) !== feature || parseFeature(plan) !== feature) fail("feature mismatch");
  required(section(plan, "Base"), "Base");
  const bootstrap = section(plan, "Self-host bootstrap", false);
  if (bootstrap !== null && feature !== "markdown-canonical-contracts") fail("Self-host bootstrap is reserved for the Markdown cutover");
  if (bootstrap !== null) required(bootstrap, "Self-host bootstrap");
  const publication = section(spec, "Publication", false);
  if (publication !== null && !/^(null|`docs\/gsd\/[a-z0-9]+(?:-[a-z0-9]+)*\/milestones\.md`)$/.test(publication)) fail("Publication must be null or the canonical Markdown ledger path");
  const criteria = parseCriteria(spec);
  const interfaces = parseInterfaces(spec, criteria);
  const invariants = parseIdentifierList(spec, "Invariants", "I");
  const tasks = parseTasks(plan, criteria);
  const nonGoals = parseIdentifierList(spec, "Non-goals", "NG");
  const coverage = new Map();
  for (const criterion of tasks.flatMap((task) => task.satisfies)) {
    coverage.set(criterion, (coverage.get(criterion) ?? 0) + 1);
  }
  const active = criteria.filter((criterion) => criterion.state === "active").map((criterion) => criterion.id);
  if (active.some((criterion) => coverage.get(criterion) !== 1)) fail("plan must cover every active criterion exactly once");
  if (Object.hasOwn(files, "design.md")) {
    const design = canonicalSource(files["design.md"], "design.md");
    validateTitle(design, "Design");
    validateSections(design, ["Feature", "Decisions", "Alternatives rejected", "Risks and mitigations"]);
    for (const heading of ["Decisions", "Alternatives rejected", "Risks and mitigations"]) required(section(design, heading), heading);
    if (parseFeature(design) !== feature) fail("feature mismatch");
  }
  return { feature, criteria, interfaces, invariants, nonGoals, tasks };
}

export function bindApprovedSources(files) {
  parseMarkdownPacket(files);
  return Object.fromEntries(Object.entries(files)
    .filter(([name]) => REQUIRED_PACKET_FILES.includes(name) || name === "design.md")
    .map(([name, content]) => [name, sha256(content)]));
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
