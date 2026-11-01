import { describe, expect, test } from "bun:test";
import { average } from "../src/stats.js";

describe("average", () => {
  test("an empty array averages to 0", () => expect(average([])).toBe(0));
  test("one value is its own average", () => expect(average([5])).toBe(5));
  test("fractions are kept", () => expect(average([1, 2])).toBe(1.5));
});
