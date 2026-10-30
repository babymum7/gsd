import { expect, test } from "bun:test";
import { formatDuration } from "../src/duration.js";

test("formats hours and minutes", () => {
  expect(formatDuration(5_400_000)).toBe("1h 30m");
});

test("formats milliseconds alone", () => {
  expect(formatDuration(250)).toBe("250ms");
});

test("formats zero as seconds", () => {
  expect(formatDuration(0)).toBe("0s");
});

test("formats every unit, largest first", () => {
  expect(formatDuration(90_061_001)).toBe("1d 1h 1m 1s 1ms");
});

test("formats a negative duration with one leading sign", () => {
  expect(formatDuration(-90_000)).toBe("-1m 30s");
});

test("rejects a fractional millisecond count", () => {
  expect(() => formatDuration(1.5)).toThrow("not a whole number of milliseconds: 1.5");
});
