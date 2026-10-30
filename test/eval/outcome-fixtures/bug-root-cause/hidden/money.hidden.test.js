import { describe, expect, test } from "bun:test";
import { invoiceTotal, renderInvoice } from "../src/invoice.js";
import { toCents } from "../src/money.js";
import { refundAmount } from "../src/refund.js";

const notebook = { description: "Notebook", unitPrice: 4.35, quantity: 1 };

describe("toCents", () => {
  test("converts 4.35 dollars to 435 cents", () => {
    expect(toCents(4.35)).toBe(435);
  });

  test("converts 1.15 dollars to 115 cents", () => {
    expect(toCents(1.15)).toBe(115);
  });

  test("converts 0.29 dollars to 29 cents", () => {
    expect(toCents(0.29)).toBe(29);
  });

  test("converts 19.99 dollars to 1999 cents", () => {
    expect(toCents(19.99)).toBe(1999);
  });
});

describe("refundAmount", () => {
  test("refunds one returned unit priced 4.35", () => {
    expect(refundAmount({ ...notebook, quantity: 3 }, 1)).toBe(435);
  });

  test("refunds three returned units priced 1.15", () => {
    expect(refundAmount({ description: "Pen", unitPrice: 1.15, quantity: 5 }, 3)).toBe(345);
  });

  test("refunds two returned units priced 19.99", () => {
    expect(refundAmount({ description: "Lamp", unitPrice: 19.99, quantity: 2 }, 2)).toBe(3998);
  });
});

describe("invoiceTotal", () => {
  test("totals the reported single-line invoice at 435 cents", () => {
    expect(invoiceTotal([notebook])).toBe(435);
  });

  test("totals three units priced 4.35 at 1305 cents", () => {
    expect(invoiceTotal([{ ...notebook, quantity: 3 }])).toBe(1305);
  });
});

describe("renderInvoice", () => {
  test("shows 4.35 dollars as the total of the reported invoice", () => {
    expect(renderInvoice([notebook])).toContain("Total: $4.35");
  });
});
