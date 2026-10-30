// Inventory summary for the warehouse screen.
const LOW_STOCK = 5;

// The values `summarize` reads, with its long-standing coercions: `parseInt` quantities, `+`
// prices, and a placeholder for an empty name. Null and undefined items are skipped.
export function normalizeItem(item) {
  if (item == null) return null;
  return {
    name: item.name || "(unnamed)",
    qty: Number.parseInt(item.qty, 10) || 0,
    price: item.price == null ? 0 : +item.price,
    sku: item.sku,
  };
}

export function formatLine({ name, qty, price }) {
  const flag = qty < LOW_STOCK ? " LOW" : "";
  return `${name}: ${qty} x ${price.toFixed(2)}${flag}`;
}

// SKUs sort as text, as `Array.prototype.sort` does by default, and a missing SKU joins as empty.
export function formatFooter(entries) {
  const skus = entries.map((entry) => entry.sku).sort();
  const total = entries.reduce((sum, { qty, price }) => sum + qty * price, 0);
  return `SKUs: ${skus.join(",")}\nTotal: ${total.toFixed(2)}`;
}

export function summarize(items) {
  const entries = items.map(normalizeItem).filter((entry) => entry !== null);
  return [...entries.map(formatLine), formatFooter(entries)].join("\n");
}
