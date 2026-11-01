export function formatTimestamp(date) {
  return date.toISOString().slice(0, 10);
}
