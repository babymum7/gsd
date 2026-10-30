export var SLUG_MAX = 48;

function _nonEmpty(word) {
  return word.length > 0;
}

function _cut(slug) {
  var at;
  if (slug.length <= SLUG_MAX) return slug;
  at = slug.lastIndexOf("-", SLUG_MAX);
  return at > 0 ? slug.slice(0, at) : slug.slice(0, SLUG_MAX);
}

// The normalizer from before toSlug existed.
function _legacyNormalize(text) {
  var out = "";
  var i;
  var c;
  for (i = 0; i < text.length; i++) {
    c = text.charAt(i).toLowerCase();
    if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9")) out = out + c;
    else out = out + "-";
  }
  return out;
}

export function toSlug(text) {
  var words = String(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(_nonEmpty);
  return _cut(words.join("-"));
}

/** @deprecated Use toSlug. */
export function slugify(text) {
  var words = String(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(_nonEmpty);
  return _cut(words.join("-"));
}
