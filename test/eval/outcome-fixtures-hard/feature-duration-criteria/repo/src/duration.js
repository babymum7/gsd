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
