import { describe, expect, test } from "bun:test";
import { checkout } from "../src/orders/checkout.js";

const cart = (...cents) => ({ lines: cents.map((unitCents) => ({ name: "item", qty: 1, unitCents })) });

describe("discount codes", () => {
  test("without a code the discount is 0 and the totals stay as before", () => {
    expect(checkout(cart(1999))).toMatchObject({ subtotal: 1999, discount: 0, tax: 160, total: 2159 });
  });
  test("SAVE10 rounds an exact half cent to the even cent", () => {
    expect(checkout(cart(1005), "SAVE10")).toMatchObject({ subtotal: 1005, discount: 100, tax: 72, total: 977 });
    expect(checkout(cart(1025), "SAVE10")).toMatchObject({ subtotal: 1025, discount: 102, tax: 74, total: 997 });
  });
  test("SAVE10 keeps every amount a whole number of cents", () => {
    const result = checkout(cart(1234), "SAVE10");
    expect(result).toMatchObject({ subtotal: 1234, discount: 123, tax: 89, total: 1200 });
    for (const key of ["subtotal", "discount", "tax", "total"]) expect(Number.isInteger(result[key])).toBe(true);
  });
  test("TAKE5 takes 500 cents off before tax", () => {
    expect(checkout(cart(1999), "TAKE5")).toMatchObject({ subtotal: 1999, discount: 500, tax: 120, total: 1619 });
  });
  test("TAKE5 never takes an order below zero", () => {
    expect(checkout(cart(300), "TAKE5")).toMatchObject({ subtotal: 300, discount: 300, tax: 0, total: 0 });
  });
  test("codes match regardless of letter case", () => {
    expect(checkout(cart(1005), "save10").discount).toBe(100);
    expect(checkout(cart(1999), "Take5").discount).toBe(500);
  });
  test("codes match with surrounding spaces", () => {
    expect(checkout(cart(1999), "  TAKE5 ").total).toBe(1619);
  });
  test("an unknown code throws with the code as typed", () => {
    expect(() => checkout(cart(1999), "FREE")).toThrow('unknown code: "FREE"');
  });
});
