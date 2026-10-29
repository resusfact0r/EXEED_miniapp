export const MAX_QTY_PER_LINE = 10;

/**
 * Largest quantity one cart line may hold - same rule as the backend (server/src/cart/line-quantity.ts):
 * 10 pieces, or one whole supplier lot if the lot is bigger, always whole lots, never above stock.
 * 0 means it can't be bought right now.
 */
export function maxLineQty(packQty: number, stockQty: number): number {
  const pack = Math.max(1, packQty);
  const limit = Math.max(pack, Math.floor(MAX_QTY_PER_LINE / pack) * pack);
  return Math.min(limit, Math.floor(Math.max(0, stockQty) / pack) * pack);
}
