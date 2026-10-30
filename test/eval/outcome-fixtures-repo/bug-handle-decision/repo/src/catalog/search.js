import { listProducts } from "./products.js";

// A term matches whole words of a product title, ignoring case and surrounding spaces (decision 0003).
export function search(term) {
  const wanted = term.trim().toLowerCase();
  if (!wanted) return [];
  return listProducts().filter((product) => product.title.toLowerCase().split(/\W+/).includes(wanted));
}
