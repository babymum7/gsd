import { describe, expect, test } from "bun:test";
import { slugify } from "../src/slugify.js";

describe("slugify", () => {
  test("lowercases and joins words with a dash", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  test("spells out the ampersand as and", () => {
    expect(slugify("Tom & Jerry")).toBe("tom-and-jerry");
  });

  test("spells out the plus sign as plus", () => {
    expect(slugify("C++")).toBe("c-plus-plus");
  });

  test("spells out the hash sign as sharp", () => {
    expect(slugify("C# basics")).toBe("c-sharp-basics");
  });

  test("spells out the at sign as at", () => {
    expect(slugify("me@home")).toBe("me-at-home");
  });

  test("spells out several symbols in one title", () => {
    expect(slugify("C++ & C#")).toBe("c-plus-plus-and-c-sharp");
  });
});
