import { expect, test } from "bun:test";
import * as legacy from "../src/text/legacy.js";

test("slugifyTitle keeps its 0.x slugs", () => {
  expect(legacy.slugifyTitle("  Hello World  ")).toBe("hello-world");
  expect(legacy.slugifyTitle("Crème Brûlée")).toBe("crème-brûlée");
  expect(legacy.slugifyTitle("Rock & Roll")).toBe("rock-&-roll");
});

test("capitalizeWords keeps its 0.x output", () => {
  expect(legacy.capitalizeWords("hELLO   big world")).toBe("Hello Big World");
  expect(legacy.capitalizeWords("a tale of two cities")).toBe("A Tale Of Two Cities");
});
