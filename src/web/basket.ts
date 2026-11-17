import type { NavigationProduct } from './catalog';

export type BagItem = { product: NavigationProduct; quantity: number };
export const storageKey = 'exeed-friends:web-bag:v1';

export function maxQuantity(product: NavigationProduct) {
  return product.packQty > 1 ? (product.stockQty >= product.packQty ? product.packQty : 0) : Math.min(10, product.stockQty);
}

export function parseSavedBag(raw: string | null): BagItem[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const result: BagItem[] = [];
    for (const line of parsed.slice(0, 100)) {
      const product = line?.product;
      if (!product || typeof product.code !== 'string' || !product.code || product.code.length > 100 || typeof product.name !== 'string' || product.name.length > 2000) continue;
      if (typeof product.price !== 'string' || !Number.isFinite(Number(product.price)) || Number(product.price) < 0 || Number(product.price) > 99999999.99) continue;
      if (!Number.isSafeInteger(product.stockQty) || product.stockQty < 0 || !Number.isSafeInteger(product.packQty) || product.packQty < 1) continue;
      if (!['categories', 'models', 'brands'].every((key) => Array.isArray(product[key]) && product[key].every((value: unknown) => typeof value === 'string'))) continue;
      if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) continue;
      const quantity = Math.min(maxQuantity(product), Math.floor(line.quantity / product.packQty) * product.packQty);
      if (!quantity) continue;
      const existing = result.find((item) => item.product.code === product.code);
      if (existing) existing.quantity = Math.min(maxQuantity(existing.product), existing.quantity + quantity);
      else result.push({ product, quantity });
    }
    return result;
  } catch { return []; }
}

export function addToBag(bag: BagItem[], product: NavigationProduct) {
  const maximum = maxQuantity(product);
  const existing = bag.find((item) => item.product.code === product.code);
  if (!maximum) return { bag, message: 'Нет в наличии' };
  if (!existing && bag.length >= 100) return { bag, message: 'В корзине уже 100 разных деталей' };
  if (existing && existing.quantity + product.packQty > maximum) return { bag, message: 'Достигнут лимит количества' };
  return {
    bag: existing
      ? bag.map((item) => item.product.code === product.code ? { product, quantity: item.quantity + product.packQty } : item)
      : [...bag, { product, quantity: product.packQty }],
    message: 'Добавлено в корзину',
  };
}

export function changeBagQuantity(bag: BagItem[], code: string, step: number) {
  return bag.map((item) => item.product.code === code
    ? { ...item, quantity: Math.min(maxQuantity(item.product), item.quantity + step * item.product.packQty) }
    : item).filter((item) => item.quantity > 0);
}
