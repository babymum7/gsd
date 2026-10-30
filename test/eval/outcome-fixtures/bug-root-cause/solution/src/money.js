// Converts a dollar amount to whole cents.
export function toCents(amount) {
  return Math.round(amount * 100);
}

// Formats whole cents as dollars, for example 1250 as "$12.50".
export function formatCents(cents) {
  const dollars = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `$${dollars}.${rest}`;
}
