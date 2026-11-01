import { describe, expect, test } from "bun:test";
import { formatRelative } from "../src/time.js";

const now = new Date("2026-03-10T12:00:00Z");
const ago = (ms) => new Date(now.getTime() - ms);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelative", () => {
  test("under a minute is just now", () => expect(formatRelative(ago(30_000), now)).toBe("just now"));
  test("a future date is just now", () => expect(formatRelative(ago(-5 * MINUTE), now)).toBe("just now"));
  test("minutes", () => expect(formatRelative(ago(5 * MINUTE), now)).toBe("5 min ago"));
  test("minutes round down", () => expect(formatRelative(ago(HOUR - 1000), now)).toBe("59 min ago"));
  test("hours", () => expect(formatRelative(ago(3 * HOUR + 10 * MINUTE), now)).toBe("3 h ago"));
  test("days", () => expect(formatRelative(ago(2 * DAY + HOUR), now)).toBe("2 d ago"));
  test("a week or more falls back to the date", () => expect(formatRelative(ago(8 * DAY), now)).toBe("2026-03-02"));
});
