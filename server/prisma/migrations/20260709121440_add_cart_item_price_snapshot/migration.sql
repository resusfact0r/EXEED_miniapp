/*
  Warnings:

  - Added the required column `priceAtAdd` to the `CartItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CartItem" ADD COLUMN     "priceAtAdd" DECIMAL(10,2) NOT NULL;
