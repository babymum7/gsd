import { toSlug } from "../text/index.js";

const products = [];

export function resetProducts() {
  products.length = 0;
}

export function addProduct(title, priceCents) {
  const product = { id: products.length + 1, title, priceCents };
  products.push(product);
  return product;
}

export function listProducts() {
  return [...products];
}

// A product URL carries the id and a slug of the title (decision 0007). URLs were built with
// slugify until toSlug replaced it.
export function productUrl(product) {
  return `/p/${product.id}-${toSlug(product.title)}`;
}
