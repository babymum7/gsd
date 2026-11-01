import { expect, test } from "bun:test";
import { cartTotal, subtotal } from "../src/cart.js";

const items = [
  { price: 10, qty: 2 },
  { price: 5, qty: 1 },
];

test("subtotal adds price times quantity", () => expect(subtotal(items)).toBe(25));
test("cartTotal adds tax to the subtotal", () => expect(cartTotal(items)).toBe(27.5));
