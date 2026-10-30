import { describe, expect, test } from "bun:test";
import { formatFooter, formatLine, normalizeItem, summarize } from "../src/inventory.js";

describe("normalizeItem", () => {
  test("skips null and undefined items", () => {
    expect(normalizeItem(null)).toBeNull();
    expect(normalizeItem(undefined)).toBeNull();
  });
  test("reads every field of a full item", () => {
    expect(normalizeItem({ name: "Bolt", qty: "12 units", price: "0.5", sku: 7 })).toEqual({
      name: "Bolt",
      qty: 12,
      price: 0.5,
      sku: 7,
    });
  });
  test("cuts a fractional quantity to its whole part", () => {
    expect(normalizeItem({ name: "Bolt", qty: 3.9, price: 1, sku: 1 }).qty).toBe(3);
  });
  test("reads only the leading digits of a quantity in exponent notation", () => {
    expect(normalizeItem({ name: "Bolt", qty: "1e3", price: 1, sku: 1 }).qty).toBe(1);
  });
  test("reads a quantity without digits as zero", () => {
    expect(normalizeItem({ name: "Bolt", qty: "abc", price: 1, sku: 1 }).qty).toBe(0);
  });
  test("names an item with an empty name as unnamed", () => {
    expect(normalizeItem({ name: "", qty: 1, price: 1, sku: 1 }).name).toBe("(unnamed)");
  });
  test("prices a missing, null, or empty price as zero", () => {
    expect(normalizeItem({ name: "Bolt", qty: 1, sku: 1 }).price).toBe(0);
    expect(normalizeItem({ name: "Bolt", qty: 1, price: null, sku: 1 }).price).toBe(0);
    expect(normalizeItem({ name: "Bolt", qty: 1, price: "", sku: 1 }).price).toBe(0);
  });
});

describe("formatLine", () => {
  test("flags a quantity below five as low", () => {
    expect(formatLine({ name: "Nut", qty: 4, price: 0.1, sku: 1 })).toBe("Nut: 4 x 0.10 LOW");
  });
  test("does not flag a quantity of five", () => {
    expect(formatLine({ name: "Nut", qty: 5, price: 0.1, sku: 1 })).toBe("Nut: 5 x 0.10");
  });
});

describe("formatFooter", () => {
  test("sorts SKUs as text and totals in input order", () => {
    const entries = [
      { name: "A", qty: 1, price: 0.1, sku: 9 },
      { name: "B", qty: 2, price: 0.2, sku: 10 },
      { name: "C", qty: 3, price: 0.3, sku: 100 },
    ];
    expect(formatFooter(entries)).toBe("SKUs: 10,100,9\nTotal: 1.40");
  });
  test("writes an empty footer for no entries", () => {
    expect(formatFooter([])).toBe("SKUs: \nTotal: 0.00");
  });
});

describe("summarize keeps its output", () => {
  test("skips null and undefined items", () => {
    expect(summarize([null, { name: "Bolt", qty: 10, price: 1, sku: 1 }, undefined])).toBe(
      "Bolt: 10 x 1.00\nSKUs: 1\nTotal: 10.00",
    );
  });
  test("reads a quantity written as text", () => {
    expect(summarize([{ name: "Bolt", qty: "12 units", price: 0.5, sku: 1 }])).toBe(
      "Bolt: 12 x 0.50\nSKUs: 1\nTotal: 6.00",
    );
  });
  test("sorts SKUs of different lengths as text", () => {
    const items = [
      { name: "A", qty: 5, price: 1, sku: 9 },
      { name: "B", qty: 5, price: 1, sku: 10 },
      { name: "C", qty: 5, price: 1, sku: 100 },
    ];
    expect(summarize(items).split("\n")[3]).toBe("SKUs: 10,100,9");
  });
  test("leaves a trailing comma for a missing SKU", () => {
    const items = [
      { name: "A", qty: 5, price: 1 },
      { name: "B", qty: 5, price: 1, sku: 2 },
    ];
    expect(summarize(items).split("\n")[2]).toBe("SKUs: 2,");
  });
  test("names an item with an empty name as unnamed", () => {
    expect(summarize([{ name: "", qty: 5, price: 1, sku: 1 }]).split("\n")[0]).toBe("(unnamed): 5 x 1.00");
  });
  test("writes NaN for a price that is not a number", () => {
    expect(summarize([{ name: "Bolt", qty: 5, price: "abc", sku: 1 }])).toBe(
      "Bolt: 5 x NaN\nSKUs: 1\nTotal: NaN",
    );
  });
  test("equals its parts joined by newlines", () => {
    const items = [{ name: "Bolt", qty: "7", price: "0.3", sku: 3 }, null, { name: "", qty: 2, sku: 20 }];
    const entries = items.map(normalizeItem).filter((entry) => entry !== null);
    expect(summarize(items)).toBe([...entries.map(formatLine), formatFooter(entries)].join("\n"));
  });
});
