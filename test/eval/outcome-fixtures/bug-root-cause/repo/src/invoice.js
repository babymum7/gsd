import { formatCents, toCents } from "./money.js";

// A line is { description, unitPrice, quantity }, with the unit price in dollars.
function lineCents(line) {
  return toCents(line.unitPrice) * line.quantity;
}

// The invoice total in whole cents.
export function invoiceTotal(lines) {
  return lines.reduce((sum, line) => sum + lineCents(line), 0);
}

// One row per line, then the total.
export function renderInvoice(lines) {
  const rows = lines.map(
    (line) => `${line.description} x${line.quantity}: ${formatCents(lineCents(line))}`,
  );
  return [...rows, `Total: ${formatCents(invoiceTotal(lines))}`].join("\n");
}
