const withKopecks = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const whole = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
});

/**
 * "49 581,41 ₽" / "1 200 ₽". Intl separates groups and the currency sign with non-breaking
 * spaces, so the sign can't wrap onto its own line in narrow cells - which is what a plain
 * `${price} ₽` did in the catalog.
 */
export function formatPrice(value: string | number): string {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) {
    return `${value} ₽`;
  }
  return (Number.isInteger(amount) ? whole : withKopecks).format(amount);
}
