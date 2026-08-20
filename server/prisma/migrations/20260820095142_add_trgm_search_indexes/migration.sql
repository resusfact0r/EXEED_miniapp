-- Enable trigram support for fast ILIKE '%...%' substring search on Product.code/name
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Speeds up CatalogService.search() (contains/insensitive on code and name), which previously
-- fell back to a full table scan since a plain btree index cannot accelerate a leading-wildcard
-- ILIKE pattern.
CREATE INDEX "product_code_trgm_idx" ON "Product" USING GIN ("code" gin_trgm_ops);
CREATE INDEX "product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);

-- Redundant with the unique constraint on "code" (which already creates a btree index for
-- equality lookups); the trigram index above now covers substring search instead.
DROP INDEX IF EXISTS "Product_code_idx";
