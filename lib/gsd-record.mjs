// Pure parser for the canonical durable record grammar (docs/decisions/ and docs/design/).
// Used by tools/gsd-record.mjs (validation) so the record grammar has one executable definition.

export const RECORD_FILE_MAX_BYTES = 64 * 1024;
export const RECORD_KINDS = new Set(["decisions", "design"]);

export function parseRecordHeader(content, kind) {
  if (typeof content !== "string") {
    throw new Error("record content must be a string");
  }
  if (content.includes("\r")) {
    throw new Error("carriage return rejected");
  }
  if (typeof kind !== "string" || !RECORD_KINDS.has(kind)) {
    throw new Error(`unknown record kind: ${kind}`);
  }

  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) {
    throw new Error("record is empty");
  }

  // 1. First line: # NNNN — Title (U+2014 em-dash with single spaces)
  const firstLine = lines[0];
  const titleMatch = firstLine.match(/^# (\d+) \u2014 (.+)$/);
  if (!titleMatch || titleMatch[2].trim() === "") {
    throw new Error('first line must match "# <number> — <title>" with non-empty title');
  }
  const number = titleMatch[1];
  const title = titleMatch[2].trim();

  // 2. Exactly one Status line
  const statusLines = lines.filter((line) => line.startsWith("- **Status:**"));
  if (statusLines.length === 0) {
    throw new Error('record must contain a "- **Status:**" line');
  }
  if (statusLines.length > 1) {
    throw new Error('record must contain exactly one "- **Status:**" line');
  }
  const statusMatch = statusLines[0].match(/^- \*\*Status:\*\* (Accepted|Rejected|Superseded by \d+)$/);
  if (!statusMatch) {
    throw new Error("status must be 'Accepted', 'Rejected', or 'Superseded by <number>'");
  }
  const status = statusMatch[1];

  // 3. Exactly one Date line
  const dateLines = lines.filter((line) => line.startsWith("- **Date:**"));
  if (dateLines.length === 0) {
    throw new Error('record must contain a "- **Date:**" line');
  }
  if (dateLines.length > 1) {
    throw new Error('record must contain exactly one "- **Date:**" line');
  }
  const dateMatch = dateLines[0].match(/^- \*\*Date:\*\* (\d{4}-\d{2}-\d{2})$/);
  if (!dateMatch) {
    throw new Error("date must match YYYY-MM-DD");
  }
  const date = dateMatch[1];

  // 4. Exactly one ## Decision heading with non-blank body
  const decisionIndices = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === "## Decision") {
      decisionIndices.push(i);
    }
  }
  if (decisionIndices.length === 0) {
    throw new Error('record must contain a "## Decision" section');
  }
  if (decisionIndices.length > 1) {
    throw new Error('record must contain exactly one "## Decision" section');
  }

  const decisionIndex = decisionIndices[0];
  let nextSectionIndex = lines.length;
  for (let i = decisionIndex + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## ")) {
      nextSectionIndex = i;
      break;
    }
  }

  const decisionBody = lines.slice(decisionIndex + 1, nextSectionIndex);
  if (!decisionBody.some((line) => line.trim() !== "")) {
    throw new Error('"## Decision" section must contain non-blank content');
  }

  return { kind, number, title, status, date };
}

// A numbered record's basename: its leading number, then a slug. Only these files are records.
export const RECORD_NAME_RE = /^(\d+)-(.+)\.md$/;

// The added basenames among `names` (one record directory) whose number another record in it
// already holds. When every holder was added, the first in name order keeps its number.
export function takenRecordNames(names, added) {
  const addedSet = new Set(added);
  const groups = new Map();
  for (const name of [...names].sort()) {
    const match = name.match(RECORD_NAME_RE);
    if (!match) continue;
    const number = Number(match[1]);
    groups.set(number, [...(groups.get(number) ?? []), name]);
  }
  const taken = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const mine = group.filter((name) => addedSet.has(name));
    if (mine.length === 0) continue;
    taken.push(...(mine.length === group.length ? mine.slice(1) : mine));
  }
  return taken;
}

// The basename `name` takes when it moves past every number in its directory, keeping the
// width of its old number so the directory still sorts by name.
export function nextRecordName(names, name) {
  const match = name.match(RECORD_NAME_RE);
  if (!match) throw new Error(`${name} is not a numbered record name (NNNN-slug.md)`);
  const highest = names.reduce((max, other) => {
    const found = other.match(RECORD_NAME_RE);
    return found ? Math.max(max, Number(found[1])) : max;
  }, 0);
  return `${String(highest + 1).padStart(match[1].length, "0")}-${match[2]}.md`;
}

// Record content under a new number: the title line takes it, and every full old stem
// (`NNNN-slug`) becomes the new one. A bare number stays, since it may name another record.
export function renumberRecordContent(content, oldName, newName) {
  const oldStem = oldName.replace(/\.md$/, "");
  const newStem = newName.replace(/\.md$/, "");
  const number = newName.match(RECORD_NAME_RE)[1];
  return content.replace(/^# \d+ \u2014 /, `# ${number} \u2014 `).replaceAll(oldStem, newStem);
}
