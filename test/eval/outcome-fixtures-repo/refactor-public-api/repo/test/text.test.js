import { describe, expect, test } from "bun:test";
import { titleCase, toSlug } from "../src/text/index.js";

describe("toSlug", () => {
  test("joins lower-case words with dashes", () => {
    expect(toSlug("Hello World")).toBe("hello-world");
  });
  test("drops punctuation", () => {
    expect(toSlug("Rock & Roll!")).toBe("rock-roll");
  });
});

describe("titleCase", () => {
  test("capitalizes each word", () => {
    expect(titleCase("hello big world")).toBe("Hello Big World");
  });
  test("keeps small words lower case after the first word", () => {
    expect(titleCase("the lord of the rings")).toBe("The Lord of the Rings");
  });
});
