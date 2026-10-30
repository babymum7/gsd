import { roundHalfEven } from "./money.js";

export const TAX_PERCENT = 8;

// A cart is { lines: [{ name, qty, unitCents }] }; every amount is in cents.
export function checkout(cart) {
  const subtotal = cart.lines.reduce((sum, line) => sum + line.qty * line.unitCents, 0);
  const tax = roundHalfEven((subtotal * TAX_PERCENT) / 100);
  return { subtotal, tax, total: subtotal + tax };
}
