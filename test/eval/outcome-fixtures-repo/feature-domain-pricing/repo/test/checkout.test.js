import { describe, expect, test } from "bun:test";
import { checkout } from "../src/orders/checkout.js";
import { formatCents } from "../src/orders/money.js";

const cart = (...lines) => ({ lines: lines.map(([qty, unitCents]) => ({ name: "item", qty, unitCents })) });

describe("checkout", () => {
  test("adds up the lines", () => {
    expect(checkout(cart([2, 450], [1, 1099])).subtotal).toBe(1999);
  });
  test("charges 8% tax rounded to the cent", () => {
    const result = checkout(cart([2, 450], [1, 1099]));
    expect(result.tax).toBe(160);
    expect(result.total).toBe(2159);
  });
  test("an empty cart costs nothing", () => {
    expect(checkout(cart()).total).toBe(0);
  });
});

describe("formatCents", () => {
  test("writes dollars and cents", () => {
    expect(formatCents(1999)).toBe("$19.99");
    expect(formatCents(5)).toBe("$0.05");
  });
});
