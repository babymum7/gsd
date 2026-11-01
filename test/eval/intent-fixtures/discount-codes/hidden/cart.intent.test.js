import { describe, expect, test } from "bun:test";
import { cartTotal } from "../src/cart.js";

const hundred = [{ price: 100, qty: 1 }];

describe("discount codes", () => {
  test("no code keeps the old total", () => expect(cartTotal(hundred)).toBe(110));
  test("SAVE10 takes 10% off before tax", () => expect(cartTotal(hundred, "SAVE10")).toBe(99));
  test("FLAT5 takes 5 off the subtotal before tax", () => expect(cartTotal(hundred, "FLAT5")).toBe(104.5));
  test("codes are case-insensitive", () => expect(cartTotal(hundred, "flat5")).toBe(104.5));
  test("a discount never takes the subtotal below 0", () => expect(cartTotal([{ price: 3, qty: 1 }], "FLAT5")).toBe(0));
  test("an unknown code throws with the code in the message", () =>
    expect(() => cartTotal(hundred, "NOPE")).toThrow("Unknown discount code: NOPE"));
});
