import { expect, test } from "bun:test";
import { shippingCents } from "../src/shipping/rates.js";

test("shipping is priced by weight band", () => {
  expect(shippingCents(500)).toBe(495);
  expect(shippingCents(501)).toBe(895);
  expect(shippingCents(10000)).toBe(1495);
  expect(() => shippingCents(10001)).toThrow("too heavy to ship");
});
