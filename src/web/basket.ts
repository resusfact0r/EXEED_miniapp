import type { NavigationProduct } from './catalog';
import { CENTRAL_WAREHOUSE, inStock, WAREHOUSE_CODE, type CatalogOffer } from '../../server/src/catalog/offers';

export type BagItem = { product: NavigationProduct; quantity: number; warehouse?: string; warehouseName?: string };
export const storageKey = 'exeed-friends:web-bag:v1';

export function bagLineKey(code: string, warehouse?: string) {
  return JSON.stringify([code, warehouse ?? CENTRAL_WAREHOUSE]);
}

export function maxQuantity(product: Pick<NavigationProduct, 'stockQty' | 'packQty' | 'price'>) {
  if (!inStock(product)) return 0;
  return product.packQty > 1 ? product.packQty : Math.min(10, product.stockQty);
}

export function parseSavedBag(raw: string | null): BagItem[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const result = new Map<string, BagItem>();
    for (const line of parsed.slice(0, 100)) {
      const product = line?.product;
      if (!product || typeof product.code !== 'string' || !product.code || product.code.length > 100 || typeof product.name !== 'string' || product.name.length > 2000) continue;
      if (typeof product.price !== 'string' || !Number.isFinite(Number(product.price)) || Number(product.price) < 0 || Number(product.price) > 99999999.99) continue;
      if (!Number.isSafeInteger(product.stockQty) || product.stockQty < 0 || !Number.isSafeInteger(product.packQty) || product.packQty < 1) continue;
      if (!['categories', 'models', 'brands'].every((key) => Array.isArray(product[key]) && product[key].every((value: unknown) => typeof value === 'string'))) continue;
      if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) continue;
      const warehouse = line.warehouse;
      if (warehouse !== undefined && (typeof warehouse !== 'string' || !WAREHOUSE_CODE.test(warehouse))) continue;
      const warehouseName = typeof line.warehouseName === 'string' ? line.warehouseName.slice(0, 100) : undefined;
      const quantity = Math.min(maxQuantity(product), Math.floor(line.quantity / product.packQty) * product.packQty);
      if (!quantity) continue;
      const key = bagLineKey(product.code, warehouse);
      const existing = result.get(key);
      if (existing) existing.quantity = Math.min(maxQuantity(existing.product), existing.quantity + quantity);
      else result.set(key, { product, quantity, ...(warehouse ? { warehouse, warehouseName } : {}) });
    }
    return [...result.values()];
  } catch { return []; }
}

export function addToBag(bag: BagItem[], original: NavigationProduct, offer?: CatalogOffer) {
  const product = offer ? { ...original, price: offer.price, stockQty: offer.stockQty, packQty: offer.packQty } : original;
  const key = bagLineKey(product.code, offer?.warehouse);
  const maximum = maxQuantity(product);
  const existing = bag.find((item) => bagLineKey(item.product.code, item.warehouse) === key);
  if (!maximum) return { bag, message: 'Под заказ' };
  if (!existing && bag.length >= 100) return { bag, message: 'В корзине уже 100 строк' };
  const quantity = (existing?.quantity ?? 0) + product.packQty;
  if (quantity > maximum || quantity % product.packQty !== 0) return { bag, message: 'Проверьте количество в корзине' };

  const line = {
    product, quantity,
    ...(offer ? { warehouse: offer.warehouse, warehouseName: offer.warehouseName } : {}),
  };
  return {
    bag: existing ? bag.map((item) => item === existing ? line : item) : [...bag, line],
    message: 'Добавлено в корзину',
  };
}

export function changeBagQuantity(bag: BagItem[], code: string, step: number, warehouse?: string) {
  const key = bagLineKey(code, warehouse);
  return bag.map((item) => bagLineKey(item.product.code, item.warehouse) === key
    ? { ...item, quantity: Math.min(maxQuantity(item.product), item.quantity + step * item.product.packQty) }
    : item).filter((item) => item.quantity > 0);
}
