export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

export function average(values) {
  return sum(values) / values.length;
}
