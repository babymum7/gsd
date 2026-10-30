export const SLUG_MAX = 48;

const cut = (slug) => {
  if (slug.length <= SLUG_MAX) return slug;
  const at = slug.lastIndexOf("-", SLUG_MAX);
  return at > 0 ? slug.slice(0, at) : slug.slice(0, SLUG_MAX);
};

export const slugWords = (text) =>
  String(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);

export const toSlug = (text) => cut(slugWords(text).join("-"));

/** @deprecated Use toSlug; it stays until 2.0 for plugins written against 1.0. */
export const slugify = toSlug;
