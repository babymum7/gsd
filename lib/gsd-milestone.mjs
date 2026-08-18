// Pure parser for the canonical milestone ledger grammar
// (skills/gsd/REFERENCE.md § Convergence Ledger publication contract). Shared by
// tools/gsd-milestone.mjs (validate/complete) and lib/gsd-state.mjs candidate discovery
// (milestone-ledger-only recovery), so the grammar has one executable definition.
export const MILESTONE_FILE_MAX_BYTES = 64 * 1024;
export const MILESTONE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MILESTONE_BRANCH_RE = /^[a-zA-Z0-9_./-]+$/;

export function parseMilestoneLedger(content) {
  if (typeof content !== "string") {
    throw new Error("ledger content must be a string");
  }
  if (content.includes("\r")) {
    throw new Error("carriage return rejected");
  }
  const lines = content.split("\n");
  // A trailing newline yields one empty final element; strip it before shape checks.
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) {
    throw new Error("ledger is empty");
  }

  const expect = (index, expected) => {
    const actual = lines[index];
    if (actual !== expected) {
      throw new Error(`line ${index + 1} must be ${JSON.stringify(expected)}`);
    }
  };
  const requireLine = (index, label) => {
    const actual = lines[index];
    if (actual === undefined || actual === "") {
      throw new Error(`missing ${label}`);
    }
    return actual;
  };

  expect(0, "# Milestones");
  expect(1, "");
  expect(2, "## Feature");
  expect(3, "");
  const featureLine = requireLine(4, "feature value");
  const featureMatch = featureLine.match(/^`([^`]+)`$/);
  if (!featureMatch || !MILESTONE_SLUG_RE.test(featureMatch[1])) {
    throw new Error("## Feature must be one backtick-quoted lowercase kebab-case slug");
  }
  expect(5, "");
  expect(6, "## Base");
  expect(7, "");
  const baseLine = requireLine(8, "base value");
  const baseMatch = baseLine.match(/^`([^`]+)`$/);
  if (!baseMatch || !MILESTONE_BRANCH_RE.test(baseMatch[1])) {
    throw new Error("## Base must be one backtick-quoted branch name");
  }
  expect(9, "");
  expect(10, "## Milestones");
  expect(11, "");
  expect(12, "| ID | Slug | Goal | Status |");
  expect(13, "| --- | --- | --- | --- |");

  const rows = [];
  const rowLines = [];
  let seenPending = false;
  for (let index = 14; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "") {
      throw new Error(`line ${index + 1} must not be blank`);
    }
    const match = line.match(/^\| (M[1-9]\d*) \| ([a-z0-9]+(?:-[a-z0-9]+)*) \| ([^|]+) \| (pending|done) \|$/);
    if (!match) {
      throw new Error(`line ${index + 1} is not a valid milestone row`);
    }
    const [, id, slug, goal, status] = match;
    if (id !== `M${rows.length + 1}`) {
      throw new Error(`milestone IDs must be sequential; expected M${rows.length + 1}, got ${id}`);
    }
    if (status === "pending") seenPending = true;
    if (status === "done" && seenPending) {
      throw new Error("done rows must form a prefix; a done row may not follow a pending row");
    }
    rows.push({ id, slug, goal, status });
    rowLines.push(index);
  }
  if (rows.length === 0) {
    throw new Error("## Milestones must contain at least one row");
  }
  if (rows.every((row) => row.status === "done")) {
    throw new Error("a ledger with no pending row is a stale lifecycle residual, not a completed canonical ledger");
  }
  const slugs = new Set(rows.map((row) => row.slug));
  if (slugs.size !== rows.length) {
    throw new Error("milestone slugs must be unique");
  }

  return { feature: featureMatch[1], base: baseMatch[1], rows, rowLines, lines };
}

export function firstPendingRow(ledger) {
  return ledger.rows.find((row) => row.status === "pending");
}
