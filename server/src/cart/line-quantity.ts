export const MAX_QTY_PER_LINE = 10;

/**
 * Largest quantity one cart line may hold: 10 pieces - or one whole supplier lot when the lot is
 * bigger (spark plugs come 20 to a lot; capping at 10 would make them unbuyable) - always a whole
 * number of lots, and never more than the stock we know of. 0 means "can't be bought right now".
 * Mirrored in the Mini App (src/helpers/lineQuantity.ts) so the stepper offers the same steps.
 */
export function maxLineQty(packQty: number, stockQty: number): number {
  const pack = Math.max(1, packQty);
  const limit = Math.max(pack, Math.floor(MAX_QTY_PER_LINE / pack) * pack);
  return Math.min(limit, Math.floor(Math.max(0, stockQty) / pack) * pack);
}

/** A requested quantity rounded up to whole lots, then held within maxLineQty. */
export function normalizeLineQty(requested: number, packQty: number, stockQty: number): number {
  const pack = Math.max(1, packQty);
  return Math.min(Math.ceil(requested / pack) * pack, maxLineQty(pack, stockQty));
}
