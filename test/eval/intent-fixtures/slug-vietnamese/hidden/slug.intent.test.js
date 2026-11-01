import { describe, expect, test } from "bun:test";
import { slugify } from "../src/slug.js";

describe("Vietnamese titles", () => {
  test("accents are stripped", () => expect(slugify("Tiếng Việt")).toBe("tieng-viet"));
  test("đ and Đ become d", () => expect(slugify("Đà Nẵng đẹp")).toBe("da-nang-dep"));
  test("stacked marks are stripped", () => expect(slugify("Phở bò ngon!")).toBe("pho-bo-ngon"));
  test("ASCII titles keep their slug", () => expect(slugify("Hello World")).toBe("hello-world"));
});
