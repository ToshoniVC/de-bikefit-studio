/**
 * Format a monetary value (stored as a decimal string in Postgres) for display.
 * Defaults to EUR with Belgian formatting, matching the shop's primary market.
 */
export function formatPrice(value: string | number, currency = 'EUR'): string {
  const amount = typeof value === 'string' ? Number(value) : value;
  return new Intl.NumberFormat('nl-BE', {
    style: 'currency',
    currency,
  }).format(amount);
}
