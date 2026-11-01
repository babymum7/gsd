import { describe, expect, test } from "bun:test";
import { toCsvRow } from "../src/csv.js";

describe("toCsvRow quoting", () => {
  test("a comma is quoted", () => expect(toCsvRow(["a,b", "c"])).toBe('"a,b",c'));
  test("double quotes are doubled inside quotes", () => expect(toCsvRow(['say "hi"'])).toBe('"say ""hi"""'));
  test("a newline is quoted", () => expect(toCsvRow(["line\nbreak", "x"])).toBe('"line\nbreak",x'));
  test("a carriage return is quoted", () => expect(toCsvRow(["a\rb"])).toBe('"a\rb"'));
  test("non-string fields go through String()", () => expect(toCsvRow([1, true, null])).toBe("1,true,null"));
  test("plain fields stay unquoted", () => expect(toCsvRow(["plain", "text"])).toBe("plain,text"));
});
