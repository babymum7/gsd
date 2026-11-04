export function formatUsd(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatVnd(amount) {
  const rounded = Math.round(amount);
  const digits = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${rounded < 0 ? "-" : ""}${digits} ₫`;
}
