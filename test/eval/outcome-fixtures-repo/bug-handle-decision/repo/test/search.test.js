import { beforeEach, expect, test } from "bun:test";
import { addProduct, resetProducts } from "../src/catalog/products.js";
import { search } from "../src/catalog/search.js";

beforeEach(resetProducts);

test("search matches whole words of a title, ignoring case", () => {
  addProduct("Blue Mug", 1200);
  addProduct("Bluebell Vase", 3000);
  expect(search("blue").map((product) => product.title)).toEqual(["Blue Mug"]);
  expect(search("  MUG ").map((product) => product.title)).toEqual(["Blue Mug"]);
  expect(search("")).toEqual([]);
});
