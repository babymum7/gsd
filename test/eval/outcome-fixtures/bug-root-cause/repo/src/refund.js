import { toCents } from "./money.js";

// The refund in whole cents when returnedQuantity units of an invoice line come back.
export function refundAmount(line, returnedQuantity) {
  return toCents(line.unitPrice) * returnedQuantity;
}
