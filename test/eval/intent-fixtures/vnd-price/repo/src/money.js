export function formatUsd(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
