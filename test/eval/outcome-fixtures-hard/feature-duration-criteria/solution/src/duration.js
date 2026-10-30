const UNITS = [
  ["d", 86_400_000],
  ["h", 3_600_000],
  ["m", 60_000],
  ["s", 1000],
  ["ms", 1],
];

// Writes a whole number of milliseconds as its non-zero parts, largest first: 5400000 is `1h 30m`.
export function formatDuration(ms) {
  if (!Number.isInteger(ms)) throw new Error(`not a whole number of milliseconds: ${ms}`);
  if (ms === 0) return "0s";
  let rest = Math.abs(ms);
  const parts = [];
  for (const [unit, size] of UNITS) {
    const count = Math.floor(rest / size);
    if (count > 0) {
      parts.push(`${count}${unit}`);
      rest -= count * size;
    }
  }
  return (ms < 0 ? "-" : "") + parts.join(" ");
}

const PART = /(\d+(?:\.\d+)?)(ms|[dhms])( *)/iy;

// The exact value of `number` units of `size` milliseconds, rounded half up.
function scaled(number, size) {
  const [whole, fraction = ""] = number.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const exact = BigInt(whole + fraction) * BigInt(size);
  const quotient = exact / scale;
  return (exact % scale) * 2n >= scale ? quotient + 1n : quotient;
}

// Reads a duration such as `1h 30m` back into milliseconds.
export function parseDuration(text) {
  const invalid = new Error(`invalid duration: ${JSON.stringify(text)}`);
  if (typeof text !== "string") throw invalid;
  const negative = text.startsWith("-");
  let index = negative ? 1 : 0;
  let total = 0n;
  let lastUnit = -1;
  let fractional = false;
  let parts = 0;
  while (index < text.length) {
    PART.lastIndex = index;
    const match = PART.exec(text);
    if (!match || fractional) throw invalid;
    const [, number, rawUnit] = match;
    const unit = UNITS.findIndex(([name]) => name === rawUnit.toLowerCase());
    if (unit <= lastUnit) throw invalid;
    lastUnit = unit;
    fractional = number.includes(".");
    total += scaled(number, UNITS[unit][1]);
    parts += 1;
    index = PART.lastIndex;
  }
  if (parts === 0) throw invalid;
  return negative ? -Number(total) : Number(total);
}
