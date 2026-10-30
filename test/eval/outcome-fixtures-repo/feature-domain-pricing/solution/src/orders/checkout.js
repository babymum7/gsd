import { roundHalfEven } from "./money.js";

export const TAX_PERCENT = 8;

// Each code turns the subtotal into the discount it gives, before the cap at the subtotal.
const CODES = {
  SAVE10: (subtotal) => roundHalfEven((subtotal * 10) / 100),
  TAKE5: () => 500,
};

// A cart is { lines: [{ name, qty, unitCents }] }; every amount is in cents.
export function checkout(cart, code) {
  const subtotal = cart.lines.reduce((sum, line) => sum + line.qty * line.unitCents, 0);
  let discount = 0;
  if (code !== undefined) {
    const rule = CODES[String(code).trim().toUpperCase()];
    if (!rule) throw new Error(`unknown code: ${JSON.stringify(code)}`);
    discount = Math.min(rule(subtotal), subtotal);
  }
  const taxable = subtotal - discount;
  const tax = roundHalfEven((taxable * TAX_PERCENT) / 100);
  return { subtotal, discount, tax, total: taxable + tax };
}
