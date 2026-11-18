ALTER TABLE "Product" ADD COLUMN "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "PriceImport" ADD COLUMN "warehouseCode" TEXT NOT NULL DEFAULT 'cs';

CREATE TABLE "Warehouse" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "extraMarkup" DECIMAL(5,2) NOT NULL,
    "defaultPackQty" INTEGER NOT NULL DEFAULT 1,
    "retail" BOOLEAN NOT NULL DEFAULT false,
    "brandFilter" TEXT,
    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "Warehouse_defaultPackQty_check" CHECK ("defaultPackQty" > 0)
);

CREATE TABLE "WarehouseOffer" (
    "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "warehouseCode" TEXT NOT NULL REFERENCES "Warehouse"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
    "price" DECIMAL(10,2) NOT NULL,
    "stockQty" INTEGER NOT NULL,
    "packQty" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WarehouseOffer_pkey" PRIMARY KEY ("productId", "warehouseCode"),
    CONSTRAINT "WarehouseOffer_quantity_check" CHECK ("stockQty" >= 0 AND "packQty" > 0 AND "price" >= 0)
);

CREATE TABLE "OriginalArticle" (
    "originalCode" TEXT NOT NULL,
    "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OriginalArticle_pkey" PRIMARY KEY ("originalCode", "productId")
);

CREATE INDEX "WarehouseOffer_warehouseCode_isActive_idx" ON "WarehouseOffer"("warehouseCode", "isActive");
CREATE INDEX "OriginalArticle_productId_idx" ON "OriginalArticle"("productId");
CREATE INDEX "PriceImport_warehouseCode_status_receivedAt_idx" ON "PriceImport"("warehouseCode", "status", "receivedAt");
CREATE INDEX "Product_article_key_idx" ON "Product" (upper(btrim(code)));

INSERT INTO "Warehouse" ("code", "name", "extraMarkup", "defaultPackQty", "retail", "brandFilter")
VALUES
    ('cs', 'Склад ЦС', 0, 1, true, NULL),
    ('msk-opt-2', 'Склад 2 (Chery)', 2, 1, false, 'CHERY'),
    ('shop', 'Склад магазина', 0, 1, true, NULL);

INSERT INTO "WarehouseOffer" ("productId", "warehouseCode", "price", "stockQty", "packQty", "isActive", "updatedAt")
SELECT id, 'cs', greatest(price, 0), greatest("stockQty", 0), greatest("packQty", 1), true, "updatedAt"
FROM "Product" WHERE "isActive";
