-- CreateEnum
CREATE TYPE "PriceImportStatus" AS ENUM ('APPLIED', 'REJECTED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "PriceImport" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "messageUid" INTEGER,
    "messageId" TEXT,
    "receivedAt" TIMESTAMP(3),
    "fileName" TEXT,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "added" INTEGER NOT NULL DEFAULT 0,
    "hidden" INTEGER NOT NULL DEFAULT 0,
    "restored" INTEGER NOT NULL DEFAULT 0,
    "status" "PriceImportStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceImport_messageId_key" ON "PriceImport"("messageId");

-- CreateIndex
CREATE INDEX "PriceImport_messageUid_idx" ON "PriceImport"("messageUid");
