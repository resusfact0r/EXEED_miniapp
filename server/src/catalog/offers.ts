export const CENTRAL_WAREHOUSE = 'cs';
export const CENTRAL_LABEL = 'Склад ЦС';
export const CHERY_WAREHOUSE = 'msk-opt-2';
export const SHOP_WAREHOUSE = 'shop';
export const WAREHOUSE_CODE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_PRICE = 99_999_999.99;
export const MAX_STOCK = 2_147_483_647;

export type CatalogOffer = {
  warehouse: string;
  warehouseName: string;
  price: string;
  stockQty: number;
  packQty: number;
};

export function articleKey(code: string) {
  return code.trim().toUpperCase();
}

export function validArticle(code: string) {
  return code.length > 0 && code.length <= 100 && !/[\x00-\x1f\x7f]/.test(code);
}

export function inStock(offer: Pick<CatalogOffer, 'price' | 'stockQty' | 'packQty'>) {
  return Number(offer.price) > 0 && offer.stockQty >= offer.packQty;
}
