const NEEDS_QUOTES = /[",\r\n]/;

function quoteField(field) {
  const text = String(field);
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsvRow(fields) {
  return fields.map(quoteField).join(",");
}
