/**
 * Shop price from a supplier price: + AVTOLIGA_MARKUP_PERCENT, rounded to kopecks. Shared by the
 * live checkout price (AvtoligaService) and the emailed price list (price-sync), so the catalog
 * and the order can never disagree on how the markup is applied.
 */
export function applyMarkup(supplierPrice: number, extraMarkup = 0): number {
  const markupPercent = Number(process.env.AVTOLIGA_MARKUP_PERCENT ?? '0') + extraMarkup;
  return Math.round(supplierPrice * (1 + markupPercent / 100) * 100) / 100;
}
