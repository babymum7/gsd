// Unified diff of two texts, as `normalize-plan` prints a proposed rewrite of a plan.

// Lines of a file as unified diff sees them: an empty file has none, and a final line without a
// newline keeps its text but carries a key no real line can have, because that line is a
// different byte sequence from the same text followed by a newline.
function diffLines(content) {
  if (content === "") return { texts: [], keys: [], hasNewline: true };
  const hasNewline = content.endsWith("\n");
  const texts = (hasNewline ? content.slice(0, -1) : content).split("\n");
  const keys = hasNewline ? texts : texts.map((text, index) => (index === texts.length - 1 ? `${text}\n` : text));
  return { texts, keys, hasNewline };
}

// Cells of the line-alignment table the diff may allocate (16 MiB); beyond it the changed middle
// is replaced wholesale.
const LCS_CELL_LIMIT = 4_000_000;

export function generateUnifiedDiff(filePath, originalContent, fixedContent, context = 3) {
  if (originalContent === fixedContent) return "";

  const original = diffLines(originalContent);
  const fixed = diffLines(fixedContent);
  const a = original.keys;
  const b = fixed.keys;

  const m = a.length;
  const n = b.length;
  // Lines shared at either end need no alignment, which is nearly every line of a normalisation
  // diff. The shorter side is never overrun, so a pure append or truncation leaves no middle.
  let prefix = 0;
  while (prefix < m && prefix < n && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < m - prefix && suffix < n - prefix && a[m - 1 - suffix] === b[n - 1 - suffix]) suffix += 1;
  const innerM = m - prefix - suffix;
  const innerN = n - prefix - suffix;

  // `i` and `j` are 1-based line numbers in the whole file, so only the last line of a side can
  // carry the missing-newline marker.
  const commonOp = (i) => ({ type: "common", text: original.texts[i - 1], noNewline: i === m && !original.hasNewline });
  const deleteOp = (i) => ({ type: "delete", text: original.texts[i - 1], noNewline: i === m && !original.hasNewline });
  const insertOp = (j) => ({ type: "insert", text: fixed.texts[j - 1], noNewline: j === n && !fixed.hasNewline });

  const ops = [];
  for (let i = 1; i <= prefix; i += 1) ops.push(commonOp(i));
  if ((innerM + 1) * (innerN + 1) > LCS_CELL_LIMIT) {
    // Aligning the middle would need a table past the budget, so replace it wholesale: still a
    // correct patch, only less minimal.
    for (let i = prefix + 1; i <= m - suffix; i += 1) ops.push(deleteOp(i));
    for (let j = prefix + 1; j <= n - suffix; j += 1) ops.push(insertOp(j));
  } else {
    const width = innerN + 1;
    const dp = new Uint32Array((innerM + 1) * width);
    for (let i = 0; i < innerM; i += 1) {
      for (let j = 0; j < innerN; j += 1) {
        dp[(i + 1) * width + j + 1] =
          a[prefix + i] === b[prefix + j]
            ? dp[i * width + j] + 1
            : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
      }
    }
    let i = innerM;
    let j = innerN;
    const middle = [];
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[prefix + i - 1] === b[prefix + j - 1]) {
        middle.push(commonOp(prefix + i));
        i -= 1;
        j -= 1;
      } else if (j > 0 && (i === 0 || dp[i * width + j - 1] >= dp[(i - 1) * width + j])) {
        middle.push(insertOp(prefix + j));
        j -= 1;
      } else {
        middle.push(deleteOp(prefix + i));
        i -= 1;
      }
    }
    ops.push(...middle.reverse());
  }
  for (let i = m - suffix + 1; i <= m; i += 1) ops.push(commonOp(i));

  // oldBefore[k] and newBefore[k] count the lines ops[0..k-1] consumed from each side.
  const oldBefore = [0];
  const newBefore = [0];
  for (const op of ops) {
    oldBefore.push(oldBefore[oldBefore.length - 1] + (op.type === "insert" ? 0 : 1));
    newBefore.push(newBefore[newBefore.length - 1] + (op.type === "delete" ? 0 : 1));
  }

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
  const prefixes = { common: " ", delete: "-", insert: "+" };
  // A range that covers no lines names the line before it, so an empty side starts at 0.
  const range = (before, count) => (count === 1 ? `${before + 1}` : `${count === 0 ? before : before + 1},${count}`);

  for (const hunkChanges of hunks) {
    const startOp = Math.max(0, hunkChanges[0] - context);
    const endOp = Math.min(ops.length - 1, hunkChanges[hunkChanges.length - 1] + context);

    let oldCount = 0;
    let newCount = 0;
    const hunkLines = [];
    for (let k = startOp; k <= endOp; k += 1) {
      const op = ops[k];
      if (op.type !== "insert") oldCount += 1;
      if (op.type !== "delete") newCount += 1;
      hunkLines.push(`${prefixes[op.type]}${op.text}`);
      if (op.noNewline) hunkLines.push("\\ No newline at end of file");
    }

    lines.push(`@@ -${range(oldBefore[startOp], oldCount)} +${range(newBefore[startOp], newCount)} @@`);
    lines.push(...hunkLines);
  }

  return lines.join("\n") + "\n";
}
