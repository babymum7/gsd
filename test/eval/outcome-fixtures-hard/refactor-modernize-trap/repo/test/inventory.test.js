import { expect, test } from "bun:test";
import { summarize } from "../src/inventory.js";

test("summarizes stocked items", () => {
  const items = [
    { name: "Bolt", qty: 120, price: 0.25, sku: 101 },
    { name: "Nut", qty: 3, price: 0.1, sku: 102 },
  ];
  expect(summarize(items)).toBe("Bolt: 120 x 0.25\nNut: 3 x 0.10 LOW\nSKUs: 101,102\nTotal: 30.30");
});

test("summarizes an empty list", () => {
  expect(summarize([])).toBe("SKUs: \nTotal: 0.00");
});
