ALTER TABLE "Warehouse"
  ADD COLUMN "mailSubjects" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "mailAttachment" TEXT,
  ADD COLUMN "mailSheet" TEXT,
  ADD COLUMN "mailColumns" JSONB;

INSERT INTO "Warehouse" ("code", "name", "extraMarkup", "defaultPackQty", "retail")
VALUES ('geely-cs', 'Склад Geely ЦС', 0, 1, false)
ON CONFLICT ("code") DO NOTHING;
