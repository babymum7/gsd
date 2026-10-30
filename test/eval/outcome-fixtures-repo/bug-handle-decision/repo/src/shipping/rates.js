// Shipping is priced by weight band (decision 0006); every amount is in cents.
export const RATE_BANDS = [
  { upToGrams: 500, cents: 495 },
  { upToGrams: 2000, cents: 895 },
  { upToGrams: 10000, cents: 1495 },
];

export function shippingCents(grams) {
  const band = RATE_BANDS.find((entry) => grams <= entry.upToGrams);
  if (!band) throw new Error(`too heavy to ship: ${grams} g`);
  return band.cents;
}
