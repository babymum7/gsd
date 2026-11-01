import { expect, test } from "bun:test";
import { slugify } from "../src/slug.js";

test("slugify joins words with dashes", () => expect(slugify("Hello World")).toBe("hello-world"));
test("slugify collapses and trims separators", () => expect(slugify("  Many   spaces! ")).toBe("many-spaces"));
