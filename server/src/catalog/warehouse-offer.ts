import type { Prisma } from '@prisma/client';
import { applyMarkup } from '../avtoliga/markup';
import { CENTRAL_LABEL, CENTRAL_WAREHOUSE, type CatalogOffer } from './offers';

export const activeWebProduct: Prisma.ProductWhereInput = {
  OR: [
    { isActive: true },
    { offers: { some: { isActive: true, warehouseCode: { not: CENTRAL_WAREHOUSE } } } },
  ],
};

type SupplierOffer = Prisma.WarehouseOfferGetPayload<{ include: { warehouse: true } }>;
type CentralOffer = { price: Prisma.Decimal; stockQty: number; packQty: number };

export function centralOffer(product: CentralOffer): CatalogOffer {
  return {
    warehouse: CENTRAL_WAREHOUSE,
    warehouseName: CENTRAL_LABEL,
    price: product.price.toString(),
    stockQty: product.stockQty,
    packQty: product.packQty,
  };
}

export function catalogOffer(offer: SupplierOffer): CatalogOffer {
  const warehouse = offer.warehouse;
  return {
    warehouse: warehouse.code,
    warehouseName: warehouse.name,
    price: warehouse.retail
      ? offer.price.toString()
      : applyMarkup(Number(offer.price), Number(warehouse.extraMarkup)).toFixed(2),
    stockQty: offer.stockQty,
    packQty: offer.packQty,
  };
}

export function productOffers(product: CentralOffer & { isActive: boolean; offers: SupplierOffer[] }) {
  const central = product.offers.find((offer) => offer.warehouseCode === CENTRAL_WAREHOUSE);
  const extras = product.offers
    .filter((offer) => offer.warehouseCode !== CENTRAL_WAREHOUSE)
    .map(catalogOffer);
  return product.isActive ? [central ? catalogOffer(central) : centralOffer(product), ...extras] : extras;
}
