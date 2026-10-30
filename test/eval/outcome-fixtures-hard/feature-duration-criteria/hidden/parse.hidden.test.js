import { describe, expect, test } from "bun:test";
import { formatDuration, parseDuration } from "../src/duration.js";

function failure(text) {
  try {
    parseDuration(text);
  } catch (error) {
    return error;
  }
  return null;
}

function expectInvalid(text) {
  const error = failure(text);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe(`invalid duration: ${JSON.stringify(text)}`);
}

describe("units in any letter case", () => {
  test("reads seconds", () => {
    expect(parseDuration("90s")).toBe(90_000);
  });
  test("reads milliseconds, not minutes followed by seconds", () => {
    expect(parseDuration("250ms")).toBe(250);
  });
  test("reads an upper-case hour", () => {
    expect(parseDuration("2H")).toBe(7_200_000);
  });
  test("reads days", () => {
    expect(parseDuration("3d")).toBe(259_200_000);
  });
  test("reads an upper-case minute as minutes", () => {
    expect(parseDuration("1M")).toBe(60_000);
  });
  test("reads mixed-case milliseconds", () => {
    expect(parseDuration("5Ms")).toBe(5);
  });
});

describe("several parts", () => {
  test("adds hours and minutes", () => {
    expect(parseDuration("1h30m")).toBe(5_400_000);
  });
  test("adds every unit", () => {
    expect(parseDuration("1d2h3m4s5ms")).toBe(93_784_005);
  });
  test("adds milliseconds after seconds", () => {
    expect(parseDuration("1s1ms")).toBe(1001);
  });
  test("rejects a smaller unit before a larger one", () => {
    expectInvalid("30m1h");
  });
  test("rejects milliseconds before seconds", () => {
    expectInvalid("1ms1s");
  });
  test("rejects a repeated unit", () => {
    expectInvalid("1h1h");
  });
});

describe("spaces", () => {
  test("allows a space between parts", () => {
    expect(parseDuration("1h 30m")).toBe(5_400_000);
  });
  test("rejects a space between a number and its unit", () => {
    expectInvalid("1 h");
  });
  test("rejects a space inside a later part", () => {
    expectInvalid("1h 30 m");
  });
});

describe("decimal fractions", () => {
  test("reads a fraction on a single part", () => {
    expect(parseDuration("1.5h")).toBe(5_400_000);
  });
  test("reads a fraction on the last part", () => {
    expect(parseDuration("1h0.5m")).toBe(3_630_000);
  });
  test("rejects a fraction before the last part", () => {
    expectInvalid("1.5h30m");
  });
});

describe("rounding half up from the exact decimal", () => {
  test("rounds an exact half of a millisecond up", () => {
    expect(parseDuration("2.0005s")).toBe(2001);
  });
  test("rounds another exact half up although its float product falls below it", () => {
    expect(parseDuration("1.0005s")).toBe(1001);
  });
  test("rounds less than a half down", () => {
    expect(parseDuration("0.0004s")).toBe(0);
  });
  test("rounds half a millisecond up", () => {
    expect(parseDuration("1.5ms")).toBe(2);
  });
});

describe("sign", () => {
  test("negates the whole duration", () => {
    expect(parseDuration("-1h30m")).toBe(-5_400_000);
  });
  test("negates a single part", () => {
    expect(parseDuration("-90s")).toBe(-90_000);
  });
  test("rejects a sign between parts", () => {
    expectInvalid("1h-30m");
  });
  test("rejects a doubled sign", () => {
    expectInvalid("--1h");
  });
  test("rejects a sign on its own", () => {
    expectInvalid("-");
  });
});

describe("invalid input", () => {
  test("rejects an empty string with the exact message", () => {
    expectInvalid("");
  });
  test("rejects a blank string with the exact message", () => {
    expectInvalid("   ");
  });
  test("rejects text with the exact message", () => {
    expectInvalid("abc");
  });
  test("quotes the input as JSON.stringify does", () => {
    expectInvalid('say "hi"');
  });
});

test("reads back what formatDuration writes", () => {
  expect(parseDuration(formatDuration(93_784_005))).toBe(93_784_005);
  expect(parseDuration(formatDuration(-90_000))).toBe(-90_000);
});
