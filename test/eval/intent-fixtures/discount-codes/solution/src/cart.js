export const TAX_RATE = 0.1;

const DISCOUNTS = {
  SAVE10: (amount) => amount * 0.9,
  FLAT5: (amount) => amount - 5,
};

function round2(value) {
  return Math.round(value * 100) / 100;
}

export function subtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function cartTotal(items, code) {
  let amount = subtotal(items);
  if (code !== undefined) {
    const apply = DISCOUNTS[String(code).toUpperCase()];
    if (!apply) throw new Error(`Unknown discount code: ${code}`);
    amount = Math.max(0, apply(amount));
  }
  return round2(amount * (1 + TAX_RATE));
}
