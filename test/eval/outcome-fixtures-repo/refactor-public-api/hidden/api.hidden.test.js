import { describe, expect, test } from "bun:test";
import * as textkit from "../src/text/index.js";
import * as slug from "../src/text/slug.js";

const long = "The quick brown fox jumps over the lazy dog and keeps on running far away";

describe("public API", () => {
  test("slugify is still exported and returns the same slug as toSlug", () => {
    expect(typeof textkit.slugify).toBe("function");
    for (const text of ["Hello World", "Crème Brûlée", long, "  --  "]) {
      expect(textkit.slugify(text)).toBe(textkit.toSlug(text));
    }
  });
  test("SLUG_MAX is still exported as 48", () => {
    expect(textkit.SLUG_MAX).toBe(48);
  });
  test("slugify cuts a long slug like toSlug", () => {
    expect(textkit.slugify(long)).toBe("the-quick-brown-fox-jumps-over-the-lazy-dog-and");
  });
});

describe("slugWords", () => {
  test("returns the lower-case ASCII words in order", () => {
    expect(slug.slugWords("Top 10 Tips")).toEqual(["top", "10", "tips"]);
    expect(slug.slugWords("  Hello,   World!!  ")).toEqual(["hello", "world"]);
  });
  test("drops accents", () => {
    expect(slug.slugWords("Crème Brûlée")).toEqual(["creme", "brulee"]);
  });
  test("returns no words for text without letters or digits", () => {
    expect(slug.slugWords("  --  ")).toEqual([]);
  });
});

describe("toSlug behavior", () => {
  test("drops accents", () => {
    expect(textkit.toSlug("Crème Brûlée")).toBe("creme-brulee");
  });
  test("collapses runs of other characters into one dash", () => {
    expect(textkit.toSlug("  Hello,   World!!  ")).toBe("hello-world");
  });
  test("cuts a slug longer than 48 characters back to its last whole word", () => {
    const slug = textkit.toSlug(long);
    expect(slug).toBe("the-quick-brown-fox-jumps-over-the-lazy-dog-and");
    expect(slug.length).toBeLessThanOrEqual(48);
  });
  test("cuts a single word longer than 48 characters at 48", () => {
    expect(textkit.toSlug("a".repeat(60))).toBe("a".repeat(48));
  });
  test("keeps digits", () => {
    expect(textkit.toSlug("Top 10 Tips")).toBe("top-10-tips");
  });
  test("returns an empty slug for text without letters or digits", () => {
    expect(textkit.toSlug("  --  ")).toBe("");
  });
});

describe("titleCase behavior", () => {
  test("capitalizes a small word that comes first", () => {
    expect(textkit.titleCase("a tale of two cities")).toBe("A Tale of Two Cities");
  });
  test("lower-cases the rest of each word", () => {
    expect(textkit.titleCase("hELLO wORLD")).toBe("Hello World");
  });
  test("collapses runs of spaces", () => {
    expect(textkit.titleCase("  the   end  ")).toBe("The End");
  });
});
