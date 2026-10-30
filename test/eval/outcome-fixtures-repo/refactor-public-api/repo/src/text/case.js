var SMALL_WORDS = ["a", "an", "and", "of", "the"];

function _capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function titleCase(text) {
  var words = String(text).trim().split(/\s+/);
  var out = [];
  var i;
  var word;
  for (i = 0; i < words.length; i++) {
    word = words[i].toLowerCase();
    if (i > 0 && SMALL_WORDS.indexOf(word) !== -1) out.push(word);
    else out.push(word.charAt(0).toUpperCase() + word.slice(1));
  }
  return out.join(" ");
}

// The 0.x helper that titleCase replaced.
function _capitalizeWords(text) {
  var words = String(text).trim().split(/\s+/);
  var out = [];
  var i;
  for (i = 0; i < words.length; i++) out.push(_capitalize(words[i]));
  return out.join(" ");
}
