import type { PriceImport, PrismaClient } from '@prisma/client';

import { applyMarkup } from '../avtoliga/markup';
import { parsePriceList, type PriceRow } from './excel-parser';

export interface PriceImportSource {
  /** "email" or "file" - where the price list came from, for the history table. */
  source: string;
  fileName?: string;
  messageUid?: number;
  messageId?: string;
  receivedAt?: Date;
}

export interface PriceImportOptions {
  /** Skip the safety checks - for loading a deliberately partial list by hand. */
  force?: boolean;
}

// A price list is a full snapshot: whatever isn't in it gets hidden. These limits stop a truncated
// or garbled file from wiping the catalog.
const MIN_SHARE_OF_ACTIVE_CATALOG = 0.5;
const MAX_BAD_PRICE_SHARE = 0.05;

class RejectedPriceList extends Error {}

/**
 * Parses a supplier price list and applies it to the catalog in one transaction: prices (with our
 * markup) and stock for known codes, new codes added, codes missing from the file hidden, hidden
 * codes that reappear shown again. Always leaves a PriceImport row behind, whatever the outcome.
 */
export async function importPriceList(
  prisma: PrismaClient,
  buffer: Buffer,
  meta: PriceImportSource,
  options: PriceImportOptions = {},
): Promise<PriceImport> {
  let rows = 0;
  try {
    const parsed = parsePriceList(buffer);
    const unique = dedupe(parsed.rows);
    rows = unique.length;

    if (!options.force) {
      const activeProducts = await prisma.product.count({ where: { isActive: true } });
      checkSanity(unique.length, parsed.badPriceRows, activeProducts);
    }

    const stats = await apply(prisma, unique);
    return await prisma.priceImport.create({ data: { ...meta, rows, ...stats, status: 'APPLIED' } });
  } catch (err) {
    const status = err instanceof RejectedPriceList ? 'REJECTED' : 'FAILED';
    return prisma.priceImport.create({
      data: { ...meta, rows, status, error: (err as Error).message.slice(0, 2000) },
    });
  }
}

function checkSanity(validRows: number, badPriceRows: number, activeProducts: number): void {
  if (validRows === 0) {
    throw new RejectedPriceList('В файле нет ни одной строки с артикулом и ценой');
  }
  const badShare = badPriceRows / (validRows + badPriceRows);
  if (badShare > MAX_BAD_PRICE_SHARE) {
    throw new RejectedPriceList(
      `${badPriceRows} строк без цены или с нулевой ценой (${Math.round(badShare * 100)}%) — похоже, файл повреждён`,
    );
  }
  if (validRows < activeProducts * MIN_SHARE_OF_ACTIVE_CATALOG) {
    throw new RejectedPriceList(
      `В файле ${validRows} позиций, а в каталоге ${activeProducts} — применение скрыло бы больше половины каталога`,
    );
  }
}

/** The supplier's export sometimes repeats a row verbatim; keep the cheapest copy of each code. */
function dedupe(rows: PriceRow[]): PriceRow[] {
  const byCode = new Map<string, PriceRow>();
  for (const row of rows) {
    const existing = byCode.get(row.code);
    if (!existing || row.price < existing.price) {
      byCode.set(row.code, row);
    }
  }
  return [...byCode.values()];
}

async function apply(prisma: PrismaClient, rows: PriceRow[]) {
  const codes = rows.map((r) => r.code);
  const names = rows.map((r) => r.name ?? r.code);
  const prices = rows.map((r) => applyMarkup(r.price));
  // -1 stands for "stock unknown" (the file said "есть" rather than a number): keep what we had.
  const stocks = rows.map((r) => r.stock ?? -1);
  // Same convention for the minimum lot: 0 = the file doesn't say.
  const packs = rows.map((r) => r.pack ?? 0);

  // Bulk SQL instead of ~22k upserts: the whole file applies in a couple of seconds, and a
  // half-applied price list is impossible.
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        CREATE TEMP TABLE price_in (code text PRIMARY KEY, name text, price numeric(10,2), stock int, pack int) ON COMMIT DROP`;
      await tx.$executeRaw`
        INSERT INTO price_in (code, name, price, stock, pack)
        SELECT * FROM unnest(${codes}::text[], ${names}::text[], ${prices}::numeric[], ${stocks}::int[], ${packs}::int[])`;

      const [{ restored }] = await tx.$queryRaw<[{ restored: number }]>`
        SELECT count(*)::int AS restored FROM "Product" p JOIN price_in i ON i.code = p.code WHERE NOT p."isActive"`;
      const [{ repriced }] = await tx.$queryRaw<[{ repriced: number }]>`
        SELECT count(*)::int AS repriced FROM "Product" p JOIN price_in i ON i.code = p.code WHERE p.price <> i.price`;

      // Names are left alone on purpose: they may have been tidied up by hand.
      await tx.$executeRaw`
        UPDATE "Product" p
        SET price = i.price,
            "stockQty" = CASE WHEN i.stock >= 0 THEN i.stock ELSE p."stockQty" END,
            "packQty" = CASE WHEN i.pack > 0 THEN i.pack ELSE p."packQty" END,
            "isActive" = true,
            "updatedAt" = now()
        FROM price_in i
        WHERE p.code = i.code
          AND (p.price <> i.price OR NOT p."isActive" OR (i.stock >= 0 AND p."stockQty" <> i.stock)
               OR (i.pack > 0 AND p."packQty" <> i.pack))`;

      const added = await tx.$executeRaw`
        INSERT INTO "Product" (id, code, name, price, "stockQty", "packQty", "isActive", "createdAt", "updatedAt")
        SELECT gen_random_uuid()::text, i.code, i.name, i.price, greatest(i.stock, 0), greatest(i.pack, 1), true, now(), now()
        FROM price_in i
        WHERE NOT EXISTS (SELECT 1 FROM "Product" p WHERE p.code = i.code)`;

      const hidden = await tx.$executeRaw`
        UPDATE "Product" p SET "isActive" = false, "updatedAt" = now()
        WHERE p."isActive" AND NOT EXISTS (SELECT 1 FROM price_in i WHERE i.code = p.code)`;

      return { updated: repriced, added, hidden, restored };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

/** One-line human summary for the Telegram report and the CLI. */
export function describeImport(record: PriceImport): string {
  const file = record.fileName ? ` (${record.fileName})` : '';
  if (record.status === 'APPLIED') {
    return [
      `✅ Прайс обновлён${file}: ${record.rows} позиций.`,
      `Цена изменилась: ${record.updated}`,
      `Добавлено новых: ${record.added}`,
      `Скрыто (нет в прайсе): ${record.hidden}`,
      `Вернулось в продажу: ${record.restored}`,
    ].join('\n');
  }
  if (record.status === 'REJECTED') {
    return `⚠️ Прайс${file} не применён: ${record.error}\nКаталог остался без изменений.`;
  }
  if (record.status === 'SKIPPED') {
    return `Прайс${file} пропущен — есть более свежий.`;
  }
  return `❌ Ошибка обработки прайса${file}: ${record.error}\nКаталог остался без изменений.`;
}
