const SMALL_WORDS = new Set(["a", "an", "and", "of", "the"]);

const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

export function titleCase(text) {
  return String(text)
    .trim()
    .split(/\s+/)
    .map((word, index) =>
      index > 0 && SMALL_WORDS.has(word.toLowerCase()) ? word.toLowerCase() : capitalize(word),
    )
    .join(" ");
}
