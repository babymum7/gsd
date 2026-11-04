import { describe, expect, test } from "bun:test";
import { formatVnd } from "../src/money.js";

describe("formatVnd", () => {
  test("groups thousands with a dot", () => expect(formatVnd(50000)).toBe("50.000 ₫"));
  test("groups millions", () => expect(formatVnd(1234567)).toBe("1.234.567 ₫"));
  test("under a thousand has no separator", () => expect(formatVnd(999)).toBe("999 ₫"));
  test("zero", () => expect(formatVnd(0)).toBe("0 ₫"));
  test("negative amounts start with a minus", () => expect(formatVnd(-50000)).toBe("-50.000 ₫"));
  test("rounds up to the nearest dong", () => expect(formatVnd(1999.6)).toBe("2.000 ₫"));
  test("rounds down below a half", () => expect(formatVnd(1234.4)).toBe("1.234 ₫"));
  test("the symbol follows a plain space, not a non-breaking one", () => {
    const text = formatVnd(1000);
    expect(text.includes(" ")).toBe(false);
    expect(text.charAt(text.length - 2)).toBe(" ");
  });
});
