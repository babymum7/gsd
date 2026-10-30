// The 0.x text helpers.
export function slugifyTitle(title) {
  var words = String(title).trim().toLowerCase().split(/\s+/);
  return words.join("-");
}

export function capitalizeWords(text) {
  var words = String(text).trim().split(/\s+/);
  var out = [];
  var i;
  for (i = 0; i < words.length; i++) {
    out.push(words[i].charAt(0).toUpperCase() + words[i].slice(1).toLowerCase());
  }
  return out.join(" ");
}
