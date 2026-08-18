// Pure parser for the canonical durable record grammar (docs/decisions/ and docs/design/).
// Shared by tools/gsd-record.mjs (validation) and milestone/contract tooling so the record grammar
// has one executable definition.

export const RECORD_FILE_MAX_BYTES = 64 * 1024;
export const RECORD_KINDS = new Set(["decisions", "design"]);
export const RECORD_NUMBER_RE = /^\d+$/;
export const RECORD_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
