const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function formatTimestamp(date) {
  return date.toISOString().slice(0, 10);
}

export function formatRelative(date, now) {
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)} d ago`;
  return formatTimestamp(date);
}
