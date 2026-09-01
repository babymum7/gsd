import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { withPinnedDirectoryChain } from "./gsd-fs.mjs";

const VAGUE = /^(?:tbd|todo|works correctly|run tests|valid|covered|success)\.?$/i;
const VALID_TASK_STATUSES = new Set(["pending", "in_progress", "done", "superseded"]);
const ENVIRONMENT_IO_ERRNOS = new Set(["EACCES", "EPERM", "EIO", "EROFS", "EMFILE", "ENFILE"]);

function fail(message, hint = null, line = null) {
  const error = new Error(`Markdown contract: ${message}`);
  if (hint) error.hint = hint;
  // `contractLine`, never `line`: some runtimes set their own `line` on every Error,
  // which would leak the library's throw site as a bogus plan location.
  if (Number.isInteger(line) && line > 0) error.contractLine = line;
  throw error;
}

// 1-based line of the Nth exact `## <heading>` line (duplicates point at the later,
// offending copy), or null when absent. Locations are advisory metadata: a wrong
// line must never change the rejection itself.
function lineOfHeading(content, heading, occurrence = 1) {
  const lines = content.split("\n");
  let seen = 0;
  for (let index = 0; index < lines.length; index++) {
    if (lines[index] === `## ${heading}` && ++seen === occurrence) return index + 1;
  }
  return null;
}

// Absolute 1-based line of a row inside the Tasks body: body row 0 sits directly
// under the `## Tasks` heading. Returns null when the heading is unexpectedly absent.
function tasksBodyLine(content, rowInBody) {
  return sectionBodyLine(content, "Tasks", rowInBody);
}

// Absolute 1-based line of body row N under the heading (row 0 = first line below
// the heading). Returns null when the heading is unexpectedly absent.
function sectionBodyLine(content, heading, rowInBody) {
  const headingLine = lineOfHeading(content, heading);
  return headingLine === null || rowInBody < 0 ? null : headingLine + 1 + rowInBody;
}

// An unreadable file is the environment failing, not the author writing bad authority.
// The tag travels on the error so the CLI classifies without matching message text.
function failIo(message) {
  const error = new Error(`Markdown contract: ${message}`);
  error.contractFailure = "io-error";
  throw error;
}

function requiredExact(value, label) {
  if (typeof value !== "string") {
    fail(`${label} is required`, `add the ${label} field with its exact value on one line`);
  }
  if (value !== value.trim()) {
    fail(`${label} must not have leading or trailing whitespace`, `remove leading and trailing whitespace from ${label}`);
  }
  if (!value) {
    fail(`${label} is required`, `add the ${label} field with its exact value on one line`);
  }
  return value;
}

function canonicalSource(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} is required`, `provide non-empty ${label} content`);
  if (value.includes("\r")) fail(`${label} must use LF line endings`, `convert CRLF line endings to LF in ${label}`);
  if (/^[ \t]*\n/.test(value) || /\n(?:[ \t]*\n|[ \t]+)$/.test(value)) fail(`${label} must not have leading or trailing blank lines`, `remove leading and trailing blank lines from ${label}`);
  return value;
}

function validateRepositoryPath(pathValue, fieldLabel) {
  if (pathValue !== pathValue.trim()) {
    fail(`${fieldLabel} path has leading or trailing whitespace: ${pathValue}`, "use one repository-relative path without backslashes, dot segments, .scratch, or .toon");
  }
  if (pathValue.includes("\\")) {
    fail(`${fieldLabel} contains backslash: ${pathValue}`, "use one repository-relative path without backslashes, dot segments, .scratch, or .toon");
  }
  if (pathValue.startsWith("/")) {
    fail(`${fieldLabel} must be repository-relative (cannot start with /): ${pathValue}`, "use one repository-relative path without backslashes, dot segments, .scratch, or .toon");
  }
  const segments = pathValue.split("/");
  for (const segment of segments) {
    if (segment === "") {
      fail(`${fieldLabel} contains empty segment: ${pathValue}`, "use one repository-relative path without backslashes, dot segments, .scratch, or .toon");
    }
    if (segment === "." || segment === "..") {
      fail(`${fieldLabel} contains dot/traversal: ${pathValue}`, "use one repository-relative path without backslashes, dot segments, .scratch, or .toon");
    }
    if (segment === ".scratch") {
      fail(`${fieldLabel} contains .scratch: ${pathValue}`, "use one repository-relative path without backslashes, dot segments, .scratch, or .toon");
    }
  }
  if (pathValue.endsWith(".toon")) {
    fail(`${fieldLabel} contains runtime TOON path: ${pathValue}`, "use one repository-relative path without backslashes, dot segments, .scratch, or .toon");
  }
  if (
    isDurableRecordScope(pathValue) &&
    /^\d/.test(pathValue.split("/").pop()) &&
    !isDurableRecordPath(pathValue)
  ) {
    fail(`${fieldLabel} durable record path must match docs/(decisions|design)/NNNN-slug.md: ${pathValue}`, "use docs/decisions/NNNN-slug.md or docs/design/NNNN-slug.md with a 4-digit zero-padded number");
  }
  return pathValue;
}

function validatePathsField(fieldValue, fieldLabel) {
  if (typeof fieldValue !== "string") {
    fail(`${fieldLabel} must be a string`, "format the field as comma-separated backticked repository-relative paths");
  }
  if (!/^`[^`]+`(\s*,\s*`[^`]+`)*$/.test(fieldValue)) {
    fail(`${fieldLabel} must be comma-separated backticked repository-relative paths with no trailing/unbackticked text`, "format the field as comma-separated backticked repository-relative paths");
  }
  return [...fieldValue.matchAll(/`([^`]+)`/g)]
    .map(([, pathValue]) => validateRepositoryPath(pathValue, fieldLabel));
}

function parseBacktickedCommand(value, label) {
  const exact = requiredExact(value, label);
  const isBackticked = exact.startsWith("`") && exact.endsWith("`") && !exact.slice(1, -1).includes("`");
  if (!isBackticked) {
    fail(`${label} must be one fully backticked nonempty command`, "enclose the command in backticks");
  }
  const command = exact.slice(1, -1);
  if (!command || command !== command.trim()) {
    fail(`${label} must be one fully backticked nonempty concrete command`, "provide a specific concrete command enclosed in backticks");
  }
  if (VAGUE.test(command)) fail(`${label} must not be vague`, "provide a specific concrete command");
  return command;
}


function validateTitle(content, title) {
  const headings = [...content.matchAll(/^# (.+)$/gm)].map(([, heading]) => heading);
  if (headings.length !== 1 || headings[0] !== title || !content.startsWith(`# ${title}\n`)) {
    fail(`top-level heading must be exactly # ${title}`, `start the document with # ${title}`);
  }
  // `validateSections` only inspects `## ` lines, so the region between the title and the
  // first section is unowned: without this, both grammars accept arbitrary preamble prose.
  if (!content.startsWith(`# ${title}\n## `)) {
    fail(
      `# ${title} must be followed directly by the first ## section`,
      `place the first ## section directly after the # ${title} title`,
      content.split("\n").findIndex((row) => row !== `# ${title}`) + 1
    );
  }
}

export function validateSectionEdges(value, heading) {
  if (value.trim() === "") {
    fail(`${heading} section must not be empty or blank`, `add content under ## ${heading}`);
  }
  if (/^\s/.test(value)) {
    fail(`${heading} section must not have leading blank or whitespace-only lines`, `remove leading blank lines from ## ${heading}`);
  }
  if (/\s$/.test(value)) {
    fail(`${heading} section must not have trailing blank or whitespace-only lines`, `remove trailing blank lines from ## ${heading}`);
  }
}

function section(content, heading, requiredSection = true) {
  const expression = new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m");
  const matches = [...content.matchAll(new RegExp(expression.source, "gm"))];
  if (matches.length > 1) fail(`duplicate ${heading} section`, `remove duplicate ## ${heading} section`, lineOfHeading(content, heading, 2));
  if (matches.length === 0) {
    if (requiredSection) fail(`missing ${heading} section`, `add ## ${heading} section`, lineOfHeading(content, heading));
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
    const mismatchIndex = headings.findIndex((heading, index) => heading !== expected[index]);
    const unexpected = mismatchIndex === -1 ? headings[expected.length] : headings[mismatchIndex];
    const expectedHeading = mismatchIndex === -1 ? null : expected[mismatchIndex];
    // A canonical heading repeated later is a duplicate: the offending copy is the Nth
    // occurrence up to the mismatch, not the first one. A pure reorder names its own line.
    const occurrence = unexpected
      ? headings.slice(0, (mismatchIndex === -1 ? headings.length : mismatchIndex + 1)).filter((heading) => heading === unexpected).length
      : 0;
    const line = unexpected ? lineOfHeading(content, unexpected, occurrence) : null;
    fail(
      `sections must be exactly ordered: ${expected.join(", ")}`,
      "reorder sections to match the canonical order",
      // A spurious section names its own heading; a reordered canonical section names
      // where the expected heading should sit; extra sections name the surplus one.
      line ?? (expectedHeading ? lineOfHeading(content, expectedHeading) : null)
    );
  }
}

function orderedFields(block, labels, content = null, heading = null) {
  const entries = [...block.matchAll(/^- \*\*(.+?):\*\* (.+)$/gm)];
  if (entries.length !== labels.length || entries.some(([, label], index) => label !== labels[index])) {
    // Best-effort location: the first field row that breaks the expected sequence.
    let line = null;
    if (content && heading) {
      const headingLine = lineOfHeading(content, heading);
      if (headingLine !== null) {
        const mismatch = entries.findIndex(([, label], index) => label !== labels[index]);
        const entry = mismatch === -1 ? entries[labels.length] ?? entries[entries.length - 1] : entries[mismatch];
        if (entry) {
          const rowInBlock = block.slice(0, entry.index).split("\n").length;
          line = headingLine + rowInBlock;
        }
      }
    }
    fail(`fields must be exactly ordered: ${labels.join(", ")}`, "reorder fields to match the canonical order", line);
  }
  return Object.fromEntries(entries.map(([, label, value]) => [label, requiredExact(value, label)]));
}

function parseFeature(content) {
  const value = section(content, "Feature");
  const match = value.match(/^`([a-z0-9]+(?:-[a-z0-9]+)*)`$/);
  if (!match) fail("Feature must be exactly one complete backticked slug with no extra text", "provide a single backticked lowercase hyphenated slug under ## Feature");
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
  if (!match) fail("Base must be exactly one complete backticked branch or reference line with no extra text", "provide a single backticked branch name under ## Base");
  if (!isSafeBranchRef(match[1])) {
    fail(`Base must be a Git branch name able to receive the merge: ${match[1]}`, "use a valid Git branch name able to receive a merge");
  }
  // The WIP branch is cut from the base, so a self-referencing base leaves the packet
  // with no merge target: the terminal squash would target the branch being squashed.
  if (feature !== null && match[1] === `wip/${feature}`) {
    fail(`Base must name the branch the packet was cut from, never its own WIP branch wip/${feature}`, "name the base branch the packet was cut from, not the WIP branch");
  }
  return match[1];
}

function parseSummary(content) {
  const value = section(content, "Summary");
  const text = requiredExact(value, "Summary");
  if (VAGUE.test(text)) fail("Summary must not be vague", "describe the concrete goal of the plan");
  return text;
}

function parseContext(content) {
  const value = section(content, "Context");
  const text = requiredExact(value, "Context");
  if (VAGUE.test(text)) fail("Context must not be vague", "name the relevant subsystem or domain");
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
  ], content, "Domain Impact");
  const classification = fields.Classification;
  if (!DOMAIN_CLASSIFICATIONS.has(classification)) {
    fail("Domain Impact Classification is invalid", "set Classification to none, change-existing-context, introduce-context, or change-context-boundary");
  }

  const rawContexts = fields.Contexts;
  let contexts = [];
  if (rawContexts !== "none") {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:, [a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(rawContexts)) {
      fail("Domain Impact Contexts must be none or comma-space-separated lowercase slugs", "set Contexts to none or a comma-separated list of lowercase slugs");
    }
    contexts = rawContexts.split(", ");
    if (new Set(contexts).size !== contexts.length) fail("Domain Impact Contexts must be unique", "remove duplicate contexts from the Contexts field");
    if (contexts.join("|") !== [...contexts].sort().join("|")) {
      fail("Domain Impact Contexts must be sorted", "sort contexts alphabetically in ascending order");
    }
  }

  const documentation = fields.Documentation;
  if (!DOMAIN_DOCUMENTATION.has(documentation)) {
    fail("Domain Impact Documentation is invalid", "set Documentation to none, update-existing, or bootstrap-feature-context");
  }
  const broadBootstrap = fields["Broad bootstrap"];
  if (!BROAD_BOOTSTRAP.has(broadBootstrap)) {
    fail("Domain Impact Broad bootstrap is invalid", "set Broad bootstrap to not-offered, declined, or selected");
  }
  const evidence = fields.Evidence;
  if (VAGUE.test(evidence)) fail("Domain Impact Evidence must be concrete", "explain why domain docs are or are not affected");

  if (classification === "none") {
    if (contexts.length !== 0 || documentation !== "none") {
      fail("Domain Impact classification none requires Contexts and Documentation to be none", "set both Contexts and Documentation to none when Classification is none");
    }
  } else {
    if (contexts.length === 0) fail("Domain-changing work requires at least one affected context", "list the affected context slugs in Contexts");
    if (documentation === "none") fail("Domain-changing work requires domain documentation", "set Documentation to update-existing or bootstrap-feature-context");
    if (classification === "introduce-context" && documentation !== "bootstrap-feature-context") {
      fail("introduce-context requires bootstrap-feature-context documentation", "set Documentation to bootstrap-feature-context when introducing a context");
    }
  }

  return { classification, contexts, documentation, broadBootstrap, evidence };
}


function parseScope(content) {
  const value = section(content, "Scope");
  const lines = value.split("\n");
  if (lines.length === 0) fail("Scope section must not be empty", "add at least one scope bullet point starting with - ");
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("- ")) {
      fail(`Scope line ${i + 1} must be a bullet point starting with "- "`, "format each scope item as a bullet point starting with - ");
    }
    const text = line.slice(2);
    const normalized = requiredExact(text, `Scope item ${i + 1}`);
    if (VAGUE.test(normalized)) {
      fail(`Scope item ${i + 1} text must not be vague`, "describe a concrete deliverable");
    }
    items.push(normalized);
  }
  return items;
}

function parseCriteria(content) {
  const value = section(content, "Acceptance Criteria", true);
  const lines = value.split("\n");
  const bodyLine = (row) => sectionBodyLine(content, "Acceptance Criteria", row);
  if (lines.some(line => line.trim() === "")) {
    const blankRow = lines.findIndex(line => line.trim() === "");
    fail("Acceptance Criteria must not contain blank or whitespace lines", "remove blank or whitespace lines from Acceptance Criteria", bodyLine(blankRow));
  }
  if (lines.length === 0 || lines.length % 5 !== 0) {
    fail("Acceptance Criteria must consist of sequential AC blocks with no stray content", "format criteria as 5-line blocks: ### AC-N header followed by State, Outcome, Action, Expected", bodyLine(lines.length));
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
    if (!m1) fail(`Acceptance criterion block ${i + 1} heading is invalid or malformed`, "format heading as ### AC-N: Title", bodyLine(i * 5));
    const [, id, ordinalStr, title] = m1;
    const ordinal = Number(ordinalStr);

    const m2 = l2.match(/^- \*\*State:\*\* (.+)$/);
    const m3 = l3.match(/^- \*\*Outcome:\*\* (.+)$/);
    const m4 = l4.match(/^- \*\*Action:\*\* (.+)$/);
    const m5 = l5.match(/^- \*\*Expected:\*\* (.+)$/);
    if (!m2 || !m3 || !m4 || !m5) {
      const badOffset = [Boolean(m2), Boolean(m3), Boolean(m4), Boolean(m5)].indexOf(false);
      fail("fields must be exactly ordered: State, Outcome, Action, Expected", "reorder fields to match State, Outcome, Action, Expected", bodyLine(i * 5 + badOffset + 1));
    }
    const state = requiredExact(m2[1], `${id} State`);
    const outcome = requiredExact(m3[1], `${id} Outcome`);
    const action = requiredExact(m4[1], `${id} Action`);
    const expected = requiredExact(m5[1], `${id} Expected`);

    if (ordinal !== i + 1) fail("criterion IDs must be sequential", "number criterion IDs sequentially starting from AC-1", bodyLine(i * 5));
    if (ids.has(id)) fail(`duplicate criterion ${id}`, "ensure each criterion ID is unique and sequential", bodyLine(i * 5));
    ids.add(id);

    if (state !== "active" && state !== "superseded") fail(`${id} has invalid state`, "set State to active or superseded", bodyLine(i * 5 + 1));
    if (VAGUE.test(outcome) || VAGUE.test(action) || VAGUE.test(expected)) {
      const vagueRow = VAGUE.test(outcome) ? 2 : VAGUE.test(action) ? 3 : 4;
      fail(`${id} outcome, action, and expected must be concrete`, "describe specific observable behaviors and steps", bodyLine(i * 5 + vagueRow));
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
    fail(`${heading} must not be empty`, `add at least one item under ## ${heading}`);
  }
  const lines = trimmed.split("\n");
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const regex = new RegExp(`^- \\*\\*${prefix}-([1-9]\\d*):\\*\\* (.+)$`);
    const match = line.match(regex);
    if (!match) {
      fail(`${heading} line ${i + 1} does not match the canonical format`, `format line as - **${prefix}-N:** description`, sectionBodyLine(content, heading, i));
    }
    const [, idNumStr, text] = match;
    const ordinal = Number(idNumStr);
    if (ordinal !== i + 1) {
      fail(`${heading} IDs must equal ${prefix}-1 through ${prefix}-N in order`, `number ${heading} items sequentially from ${prefix}-1 to ${prefix}-N`, sectionBodyLine(content, heading, i));
    }
    const id = `${prefix}-${ordinal}`;
    const textVal = requiredExact(text, `${id} text`);
    if (VAGUE.test(textVal)) {
      fail(`${id} text must not be vague`, "describe a concrete constraint or boundary", sectionBodyLine(content, heading, i));
    }
    result.push({ id, text: textVal });
  }
  return result;
}

function parseInterfaces(content, criteria) {
  const value = section(content, "Interfaces", true);
  const lines = value.split("\n");
  if (lines.length < 3) fail("Interfaces table is required", "provide an Interfaces table with header, separator, and criterion rows");
  if (lines[0] !== "| Criterion | Seam | Path | Lower-seam reason |") fail("Interfaces header is invalid", "use header | Criterion | Seam | Path | Lower-seam reason |");
  if (lines[1] !== "| --- | --- | --- | --- |") fail("Interfaces separator is invalid", "use separator | --- | --- | --- | --- |");
  const parseRow = (line, lineIndex) => {
    if (!line.startsWith("| ") || !line.endsWith(" |")) {
      fail(`Interfaces row at line ${lineIndex + 1} must start and end with '| ' and ' |'`, "start each table row with '| ' and end with ' |'");
    }
    const pipeCount = (line.match(/\|/g) || []).length;
    if (pipeCount !== 5) {
      fail(`Interfaces row at line ${lineIndex + 1} must have exactly 4 columns`, "include exactly 4 columns separated by | in each row");
    }
    const parts = line.split("|");
    
    const getCellContent = (part, columnName) => {
      if (!part.startsWith(" ") || !part.endsWith(" ") || part === " " || part.startsWith("  ") || part.endsWith("  ")) {
        fail(`Interfaces row cell for ${columnName} at line ${lineIndex + 1} must start and end with a single space`, "pad table cells with a single leading and trailing space");
      }
      const content = part.slice(1, -1);
      if (content !== content.trim()) {
        fail(`Interfaces row cell for ${columnName} at line ${lineIndex + 1} must not have leading or trailing whitespace`, "remove extra whitespace inside the table cell");
      }
      if (content === "") {
        fail(`Interfaces row cell for ${columnName} at line ${lineIndex + 1} must not be empty`, `provide a value for ${columnName}`);
      }
      return content;
    };

    const extractCapture = (content, columnName) => {
      if (content.startsWith("`") || content.endsWith("`")) {
        if (!content.startsWith("`") || !content.endsWith("`")) {
          fail(`Interfaces row cell for ${columnName} at line ${lineIndex + 1} has mismatched backticks`, "enclose the cell value in matching backticks");
        }
        const inner = content.slice(1, -1);
        if (inner.includes("`")) {
          fail(`Interfaces row cell for ${columnName} at line ${lineIndex + 1} has multiple backticks`, "use a single pair of enclosing backticks");
        }
        if (inner !== inner.trim()) {
          fail(`Interfaces row cell for ${columnName} at line ${lineIndex + 1} capture must not have leading or trailing whitespace`, "remove whitespace inside the backticks");
        }
        if (inner === "") {
          fail(`Interfaces row cell for ${columnName} at line ${lineIndex + 1} capture must not be empty`, `provide a non-empty backticked value for ${columnName}`);
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
      fail(`stray prose or empty line in Interfaces at line ${i + 1}`, "remove stray text or blank lines from the Interfaces table");
    }
    const [criterion, seam, pathValue, lowerReason] = parseRow(row, i);
    if (!active.has(criterion) || pins.has(criterion)) fail(`invalid interface pin ${criterion}`, "pin each active criterion exactly once");
    if (!seam || !pathValue || !lowerReason) fail(`incomplete interface pin ${criterion}`, "fill all four columns for each interface row");
    validatePathsField(pathValue, `Interface pin ${criterion} Path`);
    pins.set(criterion, { seam, path: pathValue, lowerReason });
  }
  if (pins.size !== active.size) fail("every active criterion needs exactly one interface pin", "add an interface row for every active acceptance criterion");
  return pins;
}

function parseTasks(content, criteria) {
  const value = section(content, "Tasks", true);
  const lines = value.split("\n");
  if (lines.some(line => line.trim() === "")) {
    fail("Tasks must not contain blank or whitespace lines", "remove blank or whitespace lines from the Tasks section");
  }

  const starts = [];
  for (let index = 0; index < lines.length; index++) {
    if (/^### T[1-9]\d*: /.test(lines[index])) starts.push(index);
  }
  if (starts.length === 0 || starts[0] !== 0) {
    fail("Tasks must consist of sequential T blocks with no stray content", "format tasks as sequential ### T-N blocks with no extra content");
  }

  const tasks = [];
  const ids = new Set();
  const active = new Set(criteria.filter((criterion) => criterion.state === "active").map((criterion) => criterion.id));
  const known = new Set(criteria.map((criterion) => criterion.id));

  const parseIdentity = (block, blockIndex) => {
    const heading = block[0]?.match(/^### (T([1-9]\d*)): (.+)$/);
    if (!heading) fail(`Task block ${blockIndex + 1} heading is invalid or malformed`, "format task heading as ### T-N: Title");
    const [, id, ordinalStr, title] = heading;
    const ordinal = Number(ordinalStr);
    if (ordinal !== blockIndex + 1) fail("task IDs must be sequential", "number task IDs sequentially starting from T1");
    if (ids.has(id)) fail(`duplicate task ${id}`, "ensure each task ID is unique and sequential");
    ids.add(id);

    const satisfiesMatch = block[1]?.match(/^- \*\*Satisfies:\*\* (.+)$/);
    if (!satisfiesMatch) fail("fields must begin with Satisfies", "start task fields with - **Satisfies:**", tasksBodyLine(content, starts[blockIndex] + 1));
    const satisfiesValue = requiredExact(satisfiesMatch[1], `${id} Satisfies`);
    const satisfies = satisfiesValue.split(",").map((criterion) => criterion.trim());
    if (satisfies.length === 0 || satisfies.some((criterion) => !known.has(criterion))) {
      const unknownCriterion = satisfies.find((criterion) => !known.has(criterion));
      fail(`${id} has unknown criterion${unknownCriterion ? `: ${unknownCriterion}` : ""}`, "reference an existing active criterion from Acceptance Criteria", tasksBodyLine(content, starts[blockIndex] + 1));
    }
    return {
      id,
      ordinal,
      title: requiredExact(title, `${id} title`),
      satisfies,
    };
  };

  const parseTestAndStatus = (id, testLine, statusLine, line = null, statusLineNo = null) => {
    const testMatch = testLine?.match(/^- \*\*Test:\*\* (.+)$/);
    const statusMatch = statusLine?.match(/^- \*\*Status:\*\* (.+)$/);
    if (!testMatch || !statusMatch) {
      fail("fields must end with Test, Status", "end task fields with - **Test:** followed by - **Status:**", line);
    }
    const test = parseBacktickedCommand(testMatch[1], `${id} Test`);
    const status = requiredExact(statusMatch[1], `${id} Status`);
    if (!VALID_TASK_STATUSES.has(status)) {
      fail(`${id} has invalid status`, "set Status to pending, in_progress, done, or superseded", statusLineNo ?? line);
    }
    return { test, status };
  };

  for (let blockIndex = 0; blockIndex < starts.length; blockIndex++) {
    const end = starts[blockIndex + 1] ?? lines.length;
    const block = lines.slice(starts[blockIndex], end);
    const identity = parseIdentity(block, blockIndex);
    const { id } = identity;

    if (block[2] !== "- **Files:**") {
      fail("structured task fields must be exactly ordered: Satisfies, Files, Test, Status", "reorder fields to match the canonical order", tasksBodyLine(content, starts[blockIndex] + 2));
    }
    let cursor = 3;
    const fileIntents = [];
    const filePaths = new Set();
    while (cursor < block.length && !block[cursor].startsWith("- **Test:**")) {
      const entry = block[cursor].match(/^  - `([^`]+)` — (create|modify|delete): (.+)$/);
      if (!entry) fail(`${id} Files entry must contain a backticked path, create|modify|delete operation, and intent`, "format files entries as:   - `path` — create|modify|delete: intent", tasksBodyLine(content, starts[blockIndex] + cursor));
      const [, rawPath, operation, rawIntent] = entry;
      const pathValue = validateRepositoryPath(rawPath, `${id} Files`);
      const intent = requiredExact(rawIntent, `${id} Files intent`);
      if (VAGUE.test(intent)) fail(`${id} Files intent must not be vague`, `specify what changes in ${pathValue}`, tasksBodyLine(content, starts[blockIndex] + cursor));
      if (filePaths.has(pathValue)) fail(`${id} Files contains duplicate path: ${pathValue}`, "list each path at most once per task", tasksBodyLine(content, starts[blockIndex] + cursor));
      filePaths.add(pathValue);
      fileIntents.push({ path: pathValue, operation, intent });
      cursor++;
    }
    if (fileIntents.length === 0) fail(`${id} needs at least one structured file intent`, `list at least one file under - **Files:** for ${id}`);


    if (cursor + 2 !== block.length) {
      fail("structured task fields must be exactly ordered: Satisfies, Files, Test, Status", "reorder fields to match the canonical order", tasksBodyLine(content, starts[blockIndex] + cursor));
    }
    const { test, status } = parseTestAndStatus(id, block[cursor], block[cursor + 1], tasksBodyLine(content, starts[blockIndex] + cursor), tasksBodyLine(content, starts[blockIndex] + cursor + 1));
    if (status !== "superseded" && identity.satisfies.some((criterion) => !active.has(criterion))) {
      fail(`${id} must satisfy an active criterion`, "reference at least one active criterion in Satisfies");
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
    fail("tasks must be an array", "pass an array of task objects to analyzeWaves");
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
    fail("Quick-fix Tasks must not contain blank or whitespace lines", "remove blank or whitespace lines from the Tasks section");
  }
  const starts = [];
  for (let index = 0; index < lines.length; index++) {
    if (/^### T[1-9]\d*: /.test(lines[index])) starts.push(index);
  }
  if (starts.length < 1 || starts.length > 2 || starts[0] !== 0) {
    fail("Quick-fix Tasks must contain one or two sequential task blocks", "provide one or two sequential task blocks starting with ### T1");
  }

  const tasks = [];
  const ownedPaths = new Set();
  for (let blockIndex = 0; blockIndex < starts.length; blockIndex++) {
    const end = starts[blockIndex + 1] ?? lines.length;
    const block = lines.slice(starts[blockIndex], end);
    const heading = block[0]?.match(/^### (T([1-9]\d*)): (.+)$/);
    if (!heading || Number(heading[2]) !== blockIndex + 1) {
      fail("Quick-fix task IDs must be sequential", "number task IDs sequentially starting from T1");
    }
    const [, id, , rawTitle] = heading;
    const title = requiredExact(rawTitle, `${id} title`);
    if (block[1] !== "- **Files:**") {
      fail(`${id} fields must be exactly ordered: Files, Test`, "reorder fields to match Files, Test", tasksBodyLine(content, starts[blockIndex] + 1));
    }

    const fileIntents = [];
    let cursor = 2;
    while (cursor < block.length && !block[cursor].startsWith("- **Test:**")) {
      const entry = block[cursor].match(/^  - `([^`]+)` — (create|modify|delete): (.+)$/);
      if (!entry) {
        fail(`${id} Files entry must contain a backticked path, create|modify|delete operation, and intent`, "format files entries as:   - `path` — create|modify|delete: intent", tasksBodyLine(content, starts[blockIndex] + cursor));
      }
      const [, rawPath, operation, rawIntent] = entry;
      const pathValue = validateRepositoryPath(rawPath, `${id} Files`);
      const intent = requiredExact(rawIntent, `${id} Files intent`);
      if (VAGUE.test(intent)) fail(`${id} Files intent must not be vague`, `specify what changes in ${pathValue}`, tasksBodyLine(content, starts[blockIndex] + cursor));
      if (ownedPaths.has(pathValue)) fail(`Quick-fix Tasks contain duplicate path: ${pathValue}`, "list each path at most once across tasks", tasksBodyLine(content, starts[blockIndex] + cursor));
      ownedPaths.add(pathValue);
      fileIntents.push({ path: pathValue, operation, intent });
      cursor++;
    }
    if (fileIntents.length === 0 || cursor + 1 !== block.length) {
      fail(`${id} fields must be exactly ordered: Files, Test`, "reorder fields to match Files, Test", tasksBodyLine(content, starts[blockIndex] + cursor));
    }
    const testMatch = block[cursor].match(/^- \*\*Test:\*\* (.+)$/);
    if (!testMatch) fail(`${id} fields must be exactly ordered: Files, Test`, "reorder fields to match Files, Test", tasksBodyLine(content, starts[blockIndex] + cursor));
    const test = parseBacktickedCommand(testMatch[1], `${id} Test`);
    if (test === "none") fail(`${id} Test must be a focused command`, "provide a specific test command instead of none");
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
    fail("files must be a plain mapping", "pass an object mapping plan.md to its content");
  }
  const ownKeys = Reflect.ownKeys(files);
  if (ownKeys.length !== 1 || ownKeys[0] !== "plan.md") {
    fail("files mapping must contain exactly plan.md", "include exactly the plan.md key in files");
  }
  const plan = canonicalSource(files["plan.md"], "plan.md");
  validateTitle(plan, "Quick-fix Plan");
  validateSections(plan, ["Feature", "Base", "Domain Impact", "Tasks"]);
  const feature = parseFeature(plan);
  const base = parseBase(plan, feature);
  const domainImpact = parseDomainImpact(plan);
  if (domainImpact.broadBootstrap !== "not-offered") {
    fail("Quick-fix Domain Impact Broad bootstrap must be not-offered", "set Broad bootstrap to not-offered for Quick-fix plans");
  }
  const { tasks } = parseQuickFixTasks(plan);
  if (domainImpact.classification !== "none") {
    const semanticTasks = tasks.flatMap((task, index) => (carriesSemanticCode(task) ? [index] : []));
    // Task paths are unique plan-wide and a shard maps to no single source file, so a
    // second semantic task would leave its own change undocumented at its checkpoint.
    if (semanticTasks.length !== 1) {
      fail("Quick-fix with domain impact must change semantic code in exactly one task", "ensure exactly one task modifies semantic code when domain impact is present");
    }
    for (const context of domainImpact.contexts) {
      const shard = `docs/domain/${context}.md`;
      // Task paths are unique plan-wide, so at most one task owns the shard, and it
      // must be the sole semantic task: documentation lands with the semantics it
      // describes, leaving no green checkpoint with drifted domain docs.
      const ownerIndex = tasks.findIndex(task => task.files.includes(shard));
      if (ownerIndex === -1) fail(`Quick-fix plan must own affected domain shard: ${shard}`, `add ${shard} to the Files list of the semantic task`);
      if (ownerIndex !== semanticTasks[0]) {
        fail(`Quick-fix must own affected domain shard ${shard} in the same task as the semantic code it documents`, `move ${shard} to the task that modifies semantic code`);
      }
    }
  }
  return { feature, base, domainImpact, tasks };
}

function parseDecisions(content) {
  const value = section(content, "Decisions", true);
  if (value === "None.") return [];

  const lines = value.split("\n");
  const bodyLine = (row) => sectionBodyLine(content, "Decisions", row);
  if (lines.some(line => line.trim() === "")) {
    const blankRow = lines.findIndex(line => line.trim() === "");
    fail("Decisions must not contain blank or whitespace lines", "remove blank or whitespace lines from the Decisions section", bodyLine(blankRow));
  }
  if (lines.length === 0 || lines.length % 3 !== 0) {
    fail("Decisions must be None. or sequential D blocks with no stray content", "set Decisions to None. or sequential 3-line ### D-N blocks", bodyLine(lines.length));
  }
  const decisions = [];
  const ids = new Set();
  const numBlocks = lines.length / 3;

  for (let i = 0; i < numBlocks; i++) {
    const l1 = lines[i * 3];
    const l2 = lines[i * 3 + 1];
    const l3 = lines[i * 3 + 2];

    const m1 = l1.match(/^### (D-([1-9]\d*)): (.+)$/);
    if (!m1) fail(`Decision block ${i + 1} heading is invalid or malformed`, "format heading as ### D-N: Title", bodyLine(i * 3));
    const [, id, ordinalStr, title] = m1;
    const ordinal = Number(ordinalStr);

    const m2 = l2.match(/^- \*\*Decision:\*\* (.+)$/);
    const m3 = l3.match(/^- \*\*Rationale:\*\* (.+)$/);
    if (!m2 || !m3) {
      fail("fields must be exactly ordered: Decision, Rationale", "reorder fields to match Decision, Rationale", bodyLine(m2 ? i * 3 + 2 : i * 3 + 1));
    }
    const decision = requiredExact(m2[1], `${id} Decision`);
    const rationale = requiredExact(m3[1], `${id} Rationale`);
    if (VAGUE.test(decision) || VAGUE.test(rationale)) {
      fail(`${id} decision and rationale must be concrete`, "provide a clear decision and rationale", bodyLine(VAGUE.test(decision) ? i * 3 + 1 : i * 3 + 2));
    }
    if (ordinal !== i + 1) fail("decision IDs must be sequential", "number decision IDs sequentially starting from D-1", bodyLine(i * 3));
    if (ids.has(id)) fail(`duplicate decision ${id}`, "ensure each decision ID is unique and sequential", bodyLine(i * 3));
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
    fail("files must be a plain mapping", "pass an object mapping plan.md to its content");
  }
  const ownKeys = Reflect.ownKeys(files);
  if (ownKeys.some((key) => typeof key === "string" && ["proposal.md", "spec.md", "design.md"].includes(key))) {
    fail("legacy multi-file state is not allowed", "remove legacy proposal.md, spec.md, or design.md files and use a single plan.md");
  }
  if (ownKeys.length !== 1 || ownKeys[0] !== "plan.md") {
    fail("files mapping must contain exactly plan.md", "include exactly the plan.md key in files");
  }
  const plan = canonicalSource(files["plan.md"], "plan.md");
  validateTitle(plan, "Plan");
  if (!/^## Domain Impact$/m.test(plan)) {
    fail("missing Domain Impact section", "add ## Domain Impact section");
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
    fail("Publication must be null or the canonical Markdown ledger path whose slug exactly equals Feature", `set Publication to null or \`docs/gsd/${feature}/milestones.md\``);
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
          fail(`unowned or mismatched milestone ledger path is not allowed: ${file}`, "match the milestone ledger path with the Publication section");
        }
      }
      if (task.status !== "superseded" && pubPath !== null && file === pubPath) {
        pubPathCount++;
      }
    }
  }

  if (pubPath !== null && pubPathCount !== 1) {
    fail(`non-null publication path must occur exactly once across non-superseded tasks, but found ${pubPathCount}`, "list the milestone ledger path in exactly one active task");
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
          fail(`Task ${task.id} satisfies multiple ACs but their interface pins (seam, path, lower-seam reason) are not identical: ${firstAc} and ${currentAc} conflict`, "make the interface rows identical or split the task into two tasks");
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
    fail("plan must cover every active criterion exactly once", "ensure each active criterion is satisfied by exactly one active task");
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
      if (owners.length === 0) fail(`plan must own affected domain shard: ${path}`, `add ${path} to the Files list of an active task that changes semantic code`);
      // Every live owner must carry the semantics it documents: a trailing
      // documentation-only task lands a green checkpoint that changes nothing it describes.
      const orphan = owners.find((task) => !carriesSemanticCode(task));
      if (orphan) {
        fail(`plan must own ${path} in a task that also changes the semantic code it documents, but ${orphan.id} does not`, `move ${path} to a task that modifies semantic code or add semantic code changes to ${orphan.id}`);
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
    fail("files must be a plain mapping", "pass an object mapping plan.md to its content");
  }
  const ownKeys = Reflect.ownKeys(files);
  if (ownKeys.length !== 1 || ownKeys[0] !== "plan.md" || typeof files["plan.md"] !== "string") {
    fail("files mapping must contain exactly plan.md", "include exactly the plan.md key in files");
  }
  return { "plan.md": sha256(files["plan.md"]) };
}

export function verifyApprovedSources(files, binding) {
  const current = sourceHashes(files);
  if (typeof binding !== "object" || binding === null || Array.isArray(binding)) {
    fail("binding must be a plain mapping", "pass an object mapping file names to expected hashes");
  }
  const expectedNames = Object.keys(binding).sort();
  const currentNames = Object.keys(current).sort();
  if (expectedNames.join("|") !== currentNames.join("|")) fail("source set changed after approval", "revalidate unbound and rebind through the amendment flow, never silently overwrite");
  for (const name of expectedNames) {
    if (binding[name] !== current[name]) fail(`${name} hash mismatch after approval`, "revalidate unbound and rebind through the amendment flow, never silently overwrite");
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
    fail("plan path is required", "provide a valid plan path");
  }
  if (typeof cwd !== "string" || cwd === "") {
    fail("workspace path is required", "provide a valid workspace root path");
  }

  let workspace;
  try {
    workspace = fs.realpathSync(path.resolve(cwd));
  } catch (error) {
    if (error && ENVIRONMENT_IO_ERRNOS.has(error.code)) {
      failIo(`workspace cannot be resolved: ${error.message}`);
    }
    fail(`workspace cannot be resolved: ${error.message}`, "ensure the workspace directory exists and is accessible");
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
    fail("plan path must be .scratch/<feature>/plan.md inside the current workspace", "specify a plan path formatted as .scratch/<feature>/plan.md");
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
      if (error && ENVIRONMENT_IO_ERRNOS.has(error.code)) {
        failIo(`${label} cannot be inspected: ${error.message}`);
      }
      fail(`${label} cannot be inspected: ${error.message}`, `ensure ${label} exists and is accessible`);
    }
    if (inspected.isSymbolicLink() || !inspected.isDirectory()) {
      fail(`${label} must be a real directory`, `ensure ${label} is a directory and not a symlink`);
    }
    if (candidate === workspace) { expected.rootDev = inspected.dev; expected.rootIno = inspected.ino; }
    else if (candidate === scratch) { expected.scratchDev = inspected.dev; expected.scratchIno = inspected.ino; }
    else { expected.featureDev = inspected.dev; expected.featureIno = inspected.ino; }
  }

  let realFeatureDirectory;
  try {
    realFeatureDirectory = fs.realpathSync(featureDirectory);
  } catch (error) {
    if (error && ENVIRONMENT_IO_ERRNOS.has(error.code)) {
      failIo(`feature directory cannot be resolved: ${error.message}`);
    }
    fail(`feature directory cannot be resolved: ${error.message}`, "ensure the feature directory exists and is accessible");
  }
  if (realFeatureDirectory !== featureDirectory) {
    fail("feature directory must resolve without indirection", "ensure the feature directory contains no symlinks or indirection");
  }
  return { absolute, feature: segments[1], expected };
}
export function readPlanFile(planPath, { cwd = process.cwd() } = {}) {
  const location = resolvePlanLocation(planPath, cwd);
  const { expected } = location;
  const workspaceRoot = path.resolve(location.absolute, '..', '..', '..');

  const hops = [
    { name: workspaceRoot, identity: { dev: expected.rootDev, ino: expected.rootIno } },
    { name: '.scratch', identity: { dev: expected.scratchDev, ino: expected.scratchIno } },
    { name: location.feature, identity: { dev: expected.featureDev, ino: expected.featureIno } },
  ];

  try {
    return withPinnedDirectoryChain(hops, () => {
      let descriptor;
      try {
        const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | fs.constants.O_NONBLOCK;
        try {
          descriptor = fs.openSync('plan.md', flags);
        } catch (error) {
          // ELOOP = symlink plan.md, ENOENT = missing plan.md — both are malformed authority.
          if (error.code === 'ELOOP' || error.code === 'ENOENT') {
            fail(`plan file ${error.code === 'ELOOP' ? 'is a symlink' : 'does not exist'}`, error.code === 'ELOOP' ? "replace the symlink with a regular file" : "create the plan file at .scratch/<feature>/plan.md");
          }
          throw error;
        }
        const opened = fs.fstatSync(descriptor);
        if (!opened.isFile()) fail('plan file must be a regular file', "ensure plan.md is a regular file and not a directory or device");
        if (opened.size > PLAN_FILE_MAX_BYTES) fail(`plan file exceeds ${PLAN_FILE_MAX_BYTES} bytes`, `reduce plan file size below ${PLAN_FILE_MAX_BYTES} bytes`);
        const capacity = Math.min(PLAN_FILE_MAX_BYTES + 1, opened.size + 1);
        const buffer = Buffer.allocUnsafe(Math.max(1, capacity));
        let total = 0;
        while (total < buffer.length) {
          const read = fs.readSync(descriptor, buffer, total, buffer.length - total, null);
          if (read === 0) break;
          total += read;
        }
        if (total > PLAN_FILE_MAX_BYTES) fail(`plan file exceeds ${PLAN_FILE_MAX_BYTES} bytes`, `reduce plan file size below ${PLAN_FILE_MAX_BYTES} bytes`);

        const afterRead = fs.fstatSync(descriptor);
        if (
          afterRead.dev !== opened.dev || afterRead.ino !== opened.ino ||
          afterRead.size !== opened.size || afterRead.mtimeMs !== opened.mtimeMs ||
          afterRead.ctimeMs !== opened.ctimeMs
        ) fail('plan file changed during read', "ensure plan.md is not modified concurrently during validation");

        let content;
        try { content = FATAL_UTF8_DECODER.decode(buffer.subarray(0, total)); } catch { fail('plan file must be valid UTF-8', "encode plan.md using UTF-8 without invalid byte sequences"); }
        if (content.startsWith('\uFEFF')) fail('plan file must not start with a UTF-8 BOM', "remove the UTF-8 BOM from the start of plan.md");
        return {
          content,
          bytes: Buffer.from(buffer.subarray(0, total)),
          feature: location.feature,
          path: location.absolute,
        };
      } finally {
        if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* best effort */ }
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Markdown contract:')) throw error;
    failIo(`plan file cannot be read: ${error.message}`);
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
        fail("expected SHA-256 must be exactly 64 lowercase hexadecimal characters", "provide a 64-character lowercase hex SHA-256 hash");
      }
      if (expectedSha256 !== sourceSha256) {
        fail("plan.md hash mismatch after approval", "revalidate unbound and rebind through the amendment flow, never silently overwrite");
      }
      // The exact-byte hash was compared above, so re-running verifyApprovedSources would only parse the packet a second time; that export stays for callers holding unverified bytes.
      parsed = parseMarkdownPacket(files);
    }
  } else if (kind === "quick-fix") {
    if (expectedSha256 !== null) {
      fail("Quick-fix validation does not accept an expected SHA-256", "omit --expected-sha256 when validating a Quick-fix plan");
    }
    parsed = parseQuickFixPlan(files);
  } else {
    fail(`unsupported plan kind: ${kind}`, "specify plan or quick-fix for kind");
  }

  if (parsed.feature !== source.feature) {
    fail(`plan feature ${parsed.feature} does not match directory ${source.feature}`, "match the ## Feature slug with the .scratch/<feature> directory name");
  }
  // `plan.md` § Base and `state.toon` `base_ref` are two records of one decision, and the
  // merge target is read from state. Without this equality a packet can be hash-bound to a
  // plan naming one base while verification and the squash target another.
  if (expectedBase !== null && parsed.base !== expectedBase) {
    fail(`plan base ${parsed.base} does not match recorded base_ref ${expectedBase}`, "align --expected-base with plan § Base");
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

export function generateUnifiedDiff(filePath, originalContent, fixedContent, context = 3) {
  if (originalContent === fixedContent) return "";

  const origHasNewline = originalContent.endsWith("\n");
  const fixedHasNewline = fixedContent.endsWith("\n");

  const a = origHasNewline ? originalContent.slice(0, -1).split("\n") : originalContent.split("\n");
  const b = fixedHasNewline ? fixedContent.slice(0, -1).split("\n") : fixedContent.split("\n");

  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = 0; i < m; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (a[i] === b[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  let i = m;
  let j = n;
  const ops = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      if (i === m && j === n && origHasNewline !== fixedHasNewline) {
        ops.push({ type: "insert", text: b[j - 1], newLine: j, noNewline: !fixedHasNewline });
        ops.push({ type: "delete", text: a[i - 1], oldLine: i, noNewline: !origHasNewline });
      } else {
        ops.push({ type: "common", text: a[i - 1], oldLine: i, newLine: j });
      }
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: "insert", text: b[j - 1], newLine: j, noNewline: j === n && !fixedHasNewline });
      j -= 1;
    } else {
      ops.push({ type: "delete", text: a[i - 1], oldLine: i, noNewline: i === m && !origHasNewline });
      i -= 1;
    }
  }
  ops.reverse();

  const changes = [];
  for (let k = 0; k < ops.length; k += 1) {
    if (ops[k].type !== "common") {
      changes.push(k);
    }
  }
  if (changes.length === 0) return "";

  const hunks = [];
  let currentHunk = [changes[0]];
  for (let k = 1; k < changes.length; k += 1) {
    const prev = changes[k - 1];
    const curr = changes[k];
    if (curr - prev - 1 <= 2 * context) {
      currentHunk.push(curr);
    } else {
      hunks.push(currentHunk);
      currentHunk = [curr];
    }
  }
  hunks.push(currentHunk);

  const lines = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
  ];

  for (const hunkChanges of hunks) {
    const firstChange = hunkChanges[0];
    const lastChange = hunkChanges[hunkChanges.length - 1];

    const startOp = Math.max(0, firstChange - context);
    const endOp = Math.min(ops.length - 1, lastChange + context);

    let oldStart = null;
    let newStart = null;
    let oldCount = 0;
    let newCount = 0;

    const hunkLines = [];
    for (let k = startOp; k <= endOp; k += 1) {
      const op = ops[k];
      if (op.type === "common") {
        if (oldStart === null) oldStart = op.oldLine;
        if (newStart === null) newStart = op.newLine;
        oldCount += 1;
        newCount += 1;
        hunkLines.push(` ${op.text}`);
      } else if (op.type === "delete") {
        if (oldStart === null) oldStart = op.oldLine;
        oldCount += 1;
        hunkLines.push(`-${op.text}`);
        if (op.noNewline) {
          hunkLines.push("\\ No newline at end of file");
        }
      } else if (op.type === "insert") {
        if (newStart === null) newStart = op.newLine;
        newCount += 1;
        hunkLines.push(`+${op.text}`);
        if (op.noNewline) {
          hunkLines.push("\\ No newline at end of file");
        }
      }
    }

    if (oldStart === null) oldStart = 1;
    if (newStart === null) newStart = 1;

    const oldRange = oldCount === 1 ? `${oldStart}` : `${oldStart},${oldCount}`;
    const newRange = newCount === 1 ? `${newStart}` : `${newStart},${newCount}`;
    lines.push(`@@ -${oldRange} +${newRange} @@`);
    lines.push(...hunkLines);
  }

  return lines.join("\n") + "\n";
}

export const CANONICAL_PLAN_SECTIONS = [
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
];

export function normalizePlan(content) {
  if (typeof content !== "string") {
    fail("plan content must be a string", "pass a string containing plan content");
  }
  const rawLines = content.split("\n");
  const fixes = [];
  const lines = [];

  for (let i = 0; i < rawLines.length; i += 1) {
    const rawLine = rawLines[i];
    const stripped = rawLine.replace(/[ \t]+$/, "");
    if (stripped !== rawLine) {
      fixes.push({
        type: "trailing-whitespace",
        line: i + 1,
        from: rawLine,
        to: stripped,
      });
    }
    lines.push(stripped);
  }

  // Wrap unwrapped scalar values of ## Feature and ## Base
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === "## Feature" || line === "## Base") {
      const heading = line.slice(3);
      if (i + 1 < lines.length) {
        const valLine = lines[i + 1];
        if (valLine.length > 0 && !valLine.startsWith("#")) {
          const isWrapped = valLine.startsWith("`") && valLine.endsWith("`") && valLine.length >= 2;
          if (!isWrapped) {
            const wrapped = `\`${valLine}\``;
            fixes.push({
              type: "wrap-scalar",
              line: i + 2,
              heading,
              from: valLine,
              to: wrapped,
            });
            lines[i + 1] = wrapped;
          }
        }
      }
    }
  }

  // Strip trailing empty lines before section extraction so terminal newline doesn't pollute the last section
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  // Reorder canonical top-level sections if full plan has all 13 canonical sections exactly once out of order
  if (lines.length > 0 && lines[0] === "# Plan") {
    // Only proceed if there is no preamble between # Plan and the first ## section
    if (lines.length > 1 && lines[1].startsWith("## ")) {
      const sections = [];
      let currentSection = null;
      for (let i = 1; i < lines.length; i += 1) {
        if (lines[i].startsWith("## ")) {
          if (currentSection !== null) {
            currentSection.lines = lines.slice(currentSection.startLine, i);
            sections.push(currentSection);
          }
          currentSection = { heading: lines[i].slice(3), startLine: i };
        }
      }
      if (currentSection !== null) {
        currentSection.lines = lines.slice(currentSection.startLine, lines.length);
        sections.push(currentSection);
      }

      const foundHeadings = sections.map((s) => s.heading);
      const headingSet = new Set(foundHeadings);
      const hasExactCanonicalSet =
        foundHeadings.length === CANONICAL_PLAN_SECTIONS.length &&
        headingSet.size === CANONICAL_PLAN_SECTIONS.length &&
        CANONICAL_PLAN_SECTIONS.every((h) => headingSet.has(h));

      if (hasExactCanonicalSet) {
        const isOutOfOrder = CANONICAL_PLAN_SECTIONS.some((h, index) => foundHeadings[index] !== h);
        if (isOutOfOrder) {
          const sectionMap = new Map(sections.map((s) => [s.heading, s.lines]));
          const newLines = [lines[0]];
          for (const heading of CANONICAL_PLAN_SECTIONS) {
            newLines.push(...sectionMap.get(heading));
          }
          lines.length = 0;
          lines.push(...newLines);
          fixes.push({
            type: "reorder-sections",
            line: 2,
            from: foundHeadings,
            to: [...CANONICAL_PLAN_SECTIONS],
          });
        }
      }
    }
  }

  // Ensure exactly one terminal newline
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const normalized = lines.length > 0 ? lines.join("\n") + "\n" : "\n";
  if (normalized !== content && !fixes.some((f) => f.type === "terminal-newline" || f.type === "trailing-newlines")) {
    if (!content.endsWith("\n")) {
      fixes.push({
        type: "terminal-newline",
        line: lines.length,
        from: "",
        to: "\\n",
      });
    } else if (content.endsWith("\n\n")) {
      fixes.push({
        type: "trailing-newlines",
        line: lines.length + 1,
        from: "\\n\\n",
        to: "\\n",
      });
    }
  }

  return {
    content: normalized,
    fixes,
  };
}

export function normalizePlanFile(planPath, { cwd = process.cwd(), write = false } = {}) {
  const source = readPlanFile(planPath, { cwd });
  const normalized = normalizePlan(source.content);
  const diff = generateUnifiedDiff(planPath, source.content, normalized.content);

  if (write && normalized.fixes.length > 0) {
    const location = resolvePlanLocation(planPath, cwd);
    const { expected } = location;
    const workspaceRoot = path.resolve(location.absolute, "..", "..", "..");
    const hops = [
      { name: workspaceRoot, identity: { dev: expected.rootDev, ino: expected.rootIno } },
      { name: ".scratch", identity: { dev: expected.scratchDev, ino: expected.scratchIno } },
      { name: location.feature, identity: { dev: expected.featureDev, ino: expected.featureIno } },
    ];

    try {
      withPinnedDirectoryChain(hops, () => {
        const temp = `.plan.md.${process.pid}.${Date.now()}.tmp`;
        let fd;
        let ownsTemp = false;
        let tempIdentity = null;
        try {
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
            fs.writeSync(fd, normalized.content, 0, "utf8");
            fs.fsyncSync(fd);
          } finally {
            if (fd !== undefined) {
              try {
                fs.closeSync(fd);
              } catch {
                /* ignore */
              }
            }
          }

          fs.renameSync(temp, "plan.md");
          ownsTemp = false;
          tempIdentity = null;

          let dirFd;
          try {
            const dirFlags =
              fs.constants.O_RDONLY |
              (fs.constants.O_DIRECTORY ?? 0) |
              (fs.constants.O_NOFOLLOW ?? 0);
            dirFd = fs.openSync(".", dirFlags);
            fs.fsyncSync(dirFd);
          } catch {
            // Directory fsync is best-effort where unsupported.
          } finally {
            if (dirFd !== undefined) {
              try {
                fs.closeSync(dirFd);
              } catch {
                /* ignore */
              }
            }
          }
        } catch (error) {
          if (ownsTemp && tempIdentity && temp) {
            try {
              const current = fs.lstatSync(temp);
              if (
                current.isFile() &&
                current.dev === tempIdentity.dev &&
                current.ino === tempIdentity.ino
              ) {
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
      failIo(`cannot write normalized plan file: ${error.message}`);
    }
  }

  return {
    fixed: normalized.fixes.length > 0,
    fixes: normalized.fixes,
    diff,
    content: normalized.content,
    path: source.path,
  };
}

export function initPlanFile(planPath, { base, cwd = process.cwd() } = {}) {
  if (typeof planPath !== "string" || planPath === "") {
    fail("plan path is required", "provide a valid plan path");
  }
  if (typeof cwd !== "string" || cwd === "") {
    fail("workspace path is required", "provide a valid workspace root path");
  }
  if (typeof base !== "string" || base === "") {
    fail("base branch is required", "specify a base branch with --base");
  }
  if (!isSafeBranchRef(base)) {
    fail("base branch must be one Git branch name able to receive a merge", "specify a safe branch name for --base");
  }

  let workspace;
  try {
    workspace = fs.realpathSync(path.resolve(cwd));
  } catch (error) {
    if (error && ENVIRONMENT_IO_ERRNOS.has(error.code)) {
      failIo(`workspace cannot be resolved: ${error.message}`);
    }
    fail(`workspace cannot be resolved: ${error.message}`, "ensure the workspace directory exists and is accessible");
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
    fail("plan path must be .scratch/<feature>/plan.md inside the current workspace", "specify a plan path formatted as .scratch/<feature>/plan.md");
  }

  const feature = segments[1];
  const scratch = path.join(workspace, ".scratch");
  const featureDirectory = path.join(scratch, feature);

  let scratchInspected = null;
  try {
    scratchInspected = fs.lstatSync(scratch);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      if (ENVIRONMENT_IO_ERRNOS.has(error.code)) {
        failIo(".scratch cannot be inspected: " + error.message);
      }
      fail(".scratch cannot be inspected: " + error.message, "ensure .scratch is accessible");
    }
  }
  if (scratchInspected && (scratchInspected.isSymbolicLink() || !scratchInspected.isDirectory())) {
    fail(".scratch must be a real directory", "ensure .scratch is a directory and not a symlink");
  }

  try {
    fs.mkdirSync(featureDirectory, { recursive: true });
  } catch (error) {
    if (error && ENVIRONMENT_IO_ERRNOS.has(error.code)) {
      failIo(`feature directory cannot be created: ${error.message}`);
    }
    fail(`feature directory cannot be created: ${error.message}`, "ensure the feature directory can be created");
  }

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
      if (error && ENVIRONMENT_IO_ERRNOS.has(error.code)) {
        failIo(`${label} cannot be inspected: ${error.message}`);
      }
      fail(`${label} cannot be inspected: ${error.message}`, `ensure ${label} exists and is accessible`);
    }
    if (inspected.isSymbolicLink() || !inspected.isDirectory()) {
      fail(`${label} must be a real directory`, `ensure ${label} is a directory and not a symlink`);
    }
    if (candidate === workspace) { expected.rootDev = inspected.dev; expected.rootIno = inspected.ino; }
    else if (candidate === scratch) { expected.scratchDev = inspected.dev; expected.scratchIno = inspected.ino; }
    else { expected.featureDev = inspected.dev; expected.featureIno = inspected.ino; }
  }

  let realFeatureDirectory;
  try {
    realFeatureDirectory = fs.realpathSync(featureDirectory);
  } catch (error) {
    if (error && ENVIRONMENT_IO_ERRNOS.has(error.code)) {
      failIo(`feature directory cannot be resolved: ${error.message}`);
    }
    fail(`feature directory cannot be resolved: ${error.message}`, "ensure the feature directory exists and is accessible");
  }
  if (realFeatureDirectory !== featureDirectory) {
    fail("feature directory must resolve without indirection", "ensure the feature directory contains no symlinks or indirection");
  }

  const hops = [
    { name: workspace, identity: { dev: expected.rootDev, ino: expected.rootIno } },
    { name: ".scratch", identity: { dev: expected.scratchDev, ino: expected.scratchIno } },
    { name: feature, identity: { dev: expected.featureDev, ino: expected.featureIno } },
  ];

  const content = [
    "# Plan",
    "## Feature",
    `\`${feature}\``,
    "## Base",
    `\`${base}\``,
    "## Summary",
    "<one concrete outcome>",
    "## Context",
    "<bounded context>",
    "## Domain Impact",
    "- **Classification:** none",
    "- **Contexts:** none",
    "- **Documentation:** none",
    "- **Broad bootstrap:** not-offered",
    "- **Evidence:** <concrete code/schema/contract evidence>",
    "## Scope",
    "- <included behavior>",
    "## Acceptance Criteria",
    "### AC-1: <title>",
    "- **State:** active",
    "- **Outcome:** <concrete behavior>",
    "- **Action:** <concrete operation>",
    "- **Expected:** <observable result>",
    "## Decisions",
    "None.",
    "## Invariants",
    "- **I-1:** <must remain true>",
    "## Non-goals",
    "- **NG-1:** <explicit exclusion>",
    "## Interfaces",
    "| Criterion | Seam | Path | Lower-seam reason |",
    "| --- | --- | --- | --- |",
    "| AC-1 | <public seam> | `<repository-relative path>` | none |",
    "## Publication",
    "null",
    "## Tasks",
    "### T1: <short task>",
    "- **Satisfies:** AC-1",
    "- **Files:**",
    "  - `placeholder/path` \u2014 create: placeholder intent text",
    "- **Test:** `bun test placeholder.test.js`",
    "- **Status:** pending",
    "",
  ].join("\n");

  try {
    withPinnedDirectoryChain(hops, () => {
      let stat;
      try {
        stat = fs.lstatSync("plan.md");
      } catch (error) {
        if (error.code !== "ENOENT") {
          if (ENVIRONMENT_IO_ERRNOS.has(error.code)) {
            failIo(`plan file cannot be inspected: ${error.message}`);
          }
          fail(`plan file cannot be inspected: ${error.message}`);
        }
      }
      if (stat) {
        if (stat.isSymbolicLink()) {
          fail("plan file is a symlink", "replace the symlink with a regular file");
        }
        const existsErr = new Error("Markdown contract: plan file already exists");
        existsErr.contractCode = "plan-exists";
        existsErr.contractFailure = "plan-exists";
        existsErr.code = "plan-exists";
        existsErr.hint = "do not overwrite existing plan files; choose another feature name or edit the existing plan";
        throw existsErr;
      }

      const flags =
        fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW ?? 0);
      let fd;
      try {
        try {
          fd = fs.openSync("plan.md", flags, 0o644);
        } catch (error) {
          if (error.code === "ELOOP") {
            fail("plan file is a symlink", "replace the symlink with a regular file");
          }
          if (error.code === "EEXIST") {
            let existingStat;
            try {
              existingStat = fs.lstatSync("plan.md");
            } catch {
              /* ignore */
            }
            if (existingStat && existingStat.isSymbolicLink()) {
              fail("plan file is a symlink", "replace the symlink with a regular file");
            }
            const existsErr = new Error("Markdown contract: plan file already exists");
            existsErr.contractCode = "plan-exists";
            existsErr.contractFailure = "plan-exists";
            existsErr.code = "plan-exists";
            existsErr.hint = "do not overwrite existing plan files; choose another feature name or edit the existing plan";
            throw existsErr;
          }
          if (ENVIRONMENT_IO_ERRNOS.has(error.code)) {
            failIo(`cannot create plan file: ${error.message}`);
          }
          fail(`cannot create plan file: ${error.message}`);
        }

        try {
          fs.writeSync(fd, content, 0, "utf8");
          fs.fsyncSync(fd);
        } finally {
          try {
            fs.closeSync(fd);
          } catch {
            /* ignore */
          }
        }

        let dirFd;
        try {
          const dirFlags =
            fs.constants.O_RDONLY |
            (fs.constants.O_DIRECTORY ?? 0) |
            (fs.constants.O_NOFOLLOW ?? 0);
          dirFd = fs.openSync(".", dirFlags);
          fs.fsyncSync(dirFd);
        } catch {
          // Directory fsync is best-effort where unsupported.
        } finally {
          if (dirFd !== undefined) {
            try {
              fs.closeSync(dirFd);
            } catch {
              /* ignore */
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Markdown contract:")) {
          throw error;
        }
        if (error && ENVIRONMENT_IO_ERRNOS.has(error.code)) {
          failIo(`cannot write plan file: ${error.message}`);
        }
        fail(`cannot write plan file: ${error.message}`);
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Markdown contract:")) throw error;
    failIo(`cannot create plan file: ${error.message}`);
  }

  return {
    feature,
    base,
    path: absolute,
    content,
    bytes: Buffer.from(content, "utf8"),
  };
}

