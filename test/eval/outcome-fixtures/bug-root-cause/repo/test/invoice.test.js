import { describe, expect, test } from "bun:test";
import { invoiceTotal, renderInvoice } from "../src/invoice.js";
import { formatCents } from "../src/money.js";
import { refundAmount } from "../src/refund.js";

const notebook = { description: "Notebook", unitPrice: 2.5, quantity: 4 };
const pen = { description: "Pen", unitPrice: 0.25, quantity: 10 };
const stapler = { description: "Stapler", unitPrice: 10, quantity: 1 };
const mug = { description: "Mug", unitPrice: 3.75, quantity: 2 };

describe("invoiceTotal", () => {
  test("is zero without lines", () => {
    expect(invoiceTotal([])).toBe(0);
  });

  test("multiplies the unit price by the quantity", () => {
    expect(invoiceTotal([notebook])).toBe(1000);
  });

  test("adds up every line", () => {
    expect(invoiceTotal([notebook, pen, stapler, mug])).toBe(3000);
  });
});

describe("renderInvoice", () => {
  test("shows each line and the total", () => {
    expect(renderInvoice([pen, mug])).toBe("Pen x10: $2.50\nMug x2: $7.50\nTotal: $10.00");
  });

  test("shows a zero total without lines", () => {
    expect(renderInvoice([])).toBe("Total: $0.00");
  });
});

describe("formatCents", () => {
  test("pads the cents to two digits", () => {
    expect(formatCents(5)).toBe("$0.05");
  });

  test("shows whole dollars with two zero cents", () => {
    expect(formatCents(1200)).toBe("$12.00");
  });
});

describe("refundAmount", () => {
  test("refunds the returned units at the unit price", () => {
    expect(refundAmount(notebook, 3)).toBe(750);
  });

  test("refunds nothing when nothing comes back", () => {
    expect(refundAmount(mug, 0)).toBe(0);
  });
});
