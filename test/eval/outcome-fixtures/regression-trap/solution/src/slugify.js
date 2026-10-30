// Builds the URL slug for an article title.
const SYMBOL_WORDS = {
  "&": "and",
  "+": "plus",
  "#": "sharp",
  "@": "at",
};

function transliterate(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d");
}

function spellOutSymbols(text) {
  return text.replace(/[&+#@]/g, (symbol) => ` ${SYMBOL_WORDS[symbol]} `);
}

function truncate(slug, maxLength) {
  return slug.slice(0, maxLength).replace(/-+$/, "");
}

export function slugify(text, { maxLength = 60 } = {}) {
  const slug = spellOutSymbols(transliterate(text))
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return truncate(slug, maxLength);
}
