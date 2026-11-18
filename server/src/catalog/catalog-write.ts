import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

// The mail, file and editor writers share article identity. Serialize these writes before
// matching by article so opening two uploads at once doesn't produce duplicate cards.
export async function lockCatalogWrites(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(1874506296)`;
}

export async function findArticleIds(tx: Prisma.TransactionClient, keys: string[]) {
  if (!keys.length) return new Map<string, string>();
  const rows = await tx.$queryRaw<{ id: string; key: string }[]>`
    SELECT id, upper(btrim(code)) AS key FROM "Product" WHERE upper(btrim(code)) = ANY(${keys}::text[])`;
  const ids = new Map<string, string>();
  for (const row of rows) {
    if (ids.has(row.key)) throw new ConflictException('В каталоге несколько карточек с артикулом ' + row.key);
    ids.set(row.key, row.id);
  }
  return ids;
}
