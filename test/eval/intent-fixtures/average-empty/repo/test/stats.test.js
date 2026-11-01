import { expect, test } from "bun:test";
import { average, sum } from "../src/stats.js";

test("sum adds values", () => expect(sum([1, 2, 3])).toBe(6));
test("average divides the sum by the count", () => expect(average([2, 4])).toBe(3));
