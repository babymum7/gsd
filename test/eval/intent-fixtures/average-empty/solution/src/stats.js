export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

export function average(values) {
  return values.length === 0 ? 0 : sum(values) / values.length;
}
