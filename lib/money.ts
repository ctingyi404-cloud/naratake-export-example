export function money(cents: number): string {
  // whole-dollar amounts drop the cents: $75.00 → $75
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Half-up tax rounding on basis points, matching the server quote. */
export function taxOn(subtotalCents: number, taxRateBp: number): number {
  return Math.round((subtotalCents * taxRateBp) / 10000);
}
