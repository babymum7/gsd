export const TAX_RATE = 0.1;

function round2(value) {
  return Math.round(value * 100) / 100;
}

export function subtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function cartTotal(items) {
  return round2(subtotal(items) * (1 + TAX_RATE));
}
