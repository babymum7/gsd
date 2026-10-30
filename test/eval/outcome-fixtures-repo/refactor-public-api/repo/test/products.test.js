import { beforeEach, expect, test } from "bun:test";
import { addProduct, listProducts, productUrl, resetProducts } from "../src/catalog/products.js";

beforeEach(resetProducts);

test("products get sequential ids", () => {
  expect(addProduct("Mug", 1200).id).toBe(1);
  expect(addProduct("Plate", 900).id).toBe(2);
  expect(listProducts().map((product) => product.title)).toEqual(["Mug", "Plate"]);
});

test("a product URL holds the id and a slug of the title", () => {
  expect(productUrl(addProduct("Blue Mug, Large", 1500))).toBe("/p/1-blue-mug-large");
});
