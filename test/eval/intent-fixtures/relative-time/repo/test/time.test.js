import { expect, test } from "bun:test";
import { formatTimestamp } from "../src/time.js";

test("formatTimestamp shows the UTC date", () =>
  expect(formatTimestamp(new Date("2026-03-04T10:00:00Z"))).toBe("2026-03-04"));
