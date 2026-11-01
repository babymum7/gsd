import { expect, test } from "bun:test";
import { toCsvRow } from "../src/csv.js";

test("toCsvRow joins plain fields with commas", () => expect(toCsvRow(["a", "b", "c"])).toBe("a,b,c"));
