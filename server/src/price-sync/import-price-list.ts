import { Prisma, type PriceImport, type PrismaClient } from '@prisma/client';
import { applyMarkup } from '../avtoliga/markup';
import { lockCatalogWrites } from '../catalog/catalog-write';
import {
  articleKey,
  CENTRAL_WAREHOUSE,
  CHERY_WAREHOUSE,
  MAX_PRICE,
  MAX_STOCK,
  validArticle,
} from '../catalog/offers';
import { parsePriceList, type PriceFormat, type PriceRow } from './excel-parser';

export interface PriceImportSource {
  source: 'email' | 'file';
  fileName?: string;
  messageUid?: number;
  messageId?: string;
  receivedAt?: Date;
}

export interface PriceImportOptions {
  warehouseCode?: string;
  snapshot?: boolean;
  format?: PriceFormat;
  mailRule?: {
    mailSubjects: string[];
    mailAttachment: string | null;
    mailSheet: string | null;
    mailColumns: Prisma.InputJsonValue | typeof Prisma.DbNull;
  };
  /** Overrides the shrinkage check for intentional snapshots loaded with the CLI. */
  force?: boolean;
}

const MIN_SHARE = 0.5;
const MAX_BAD_SHARE = 0.05;
class RejectedPriceList extends Error {}

export async function importPriceList(
  prisma: PrismaClient,
  buffer: Buffer,
  meta: PriceImportSource,
  options: PriceImportOptions = {},
): Promise<PriceImport> {
  const warehouseCode = options.warehouseCode ?? CENTRAL_WAREHOUSE;
  const snapshot = options.snapshot ?? true;
  const audit = { ...meta, warehouseCode };
  let rows = 0;
  try {
    const central = warehouseCode === CENTRAL_WAREHOUSE;
    const warehouse = central
      ? null
      : await prisma.warehouse.findUniqueOrThrow({ where: { code: warehouseCode } });
    const parsed = parsePriceList(buffer, {
      envPrefix: central ? 'PRICE_' : warehouseCode === CHERY_WAREHOUSE ? 'PRICE_MSK_OPT2_' : undefined,
      brandFilter: warehouse?.brandFilter ?? undefined,
      format: options.format,
    });
    const parsedRows = parsed.rows.map((row) => ({
      ...row,
      code: articleKey(row.code),
      originalCode: row.originalCode ? articleKey(row.originalCode) : undefined,
    }));
    const unique = dedupe(parsedRows);
    rows = unique.length;
    validateRows(
      parsedRows,
      parsed.badPriceRows,
      warehouse?.retail ?? false,
      Number(warehouse?.extraMarkup ?? 0),
    );

    return await prisma.$transaction(
      async (tx) => {
        await lockCatalogWrites(tx);
        const previous = meta.messageId
          ? await tx.priceImport.findUnique({ where: { messageId: meta.messageId } })
          : null;
        if (previous && (!options.mailRule || previous.warehouseCode !== warehouseCode || previous.status === 'APPLIED')) {
          if (previous.status === 'APPLIED' && previous.warehouseCode === warehouseCode && options.mailRule) {
            await tx.warehouse.update({ where: { code: warehouseCode }, data: options.mailRule });
          }
          return previous;
        }
        if (meta.source === 'email' && meta.receivedAt) {
          const newer = await tx.priceImport.findFirst({
            where: {
              warehouseCode,
              status: 'APPLIED',
              source: 'email',
              receivedAt: { gte: meta.receivedAt },
            },
            select: { id: true },
          });
          if (newer) {
            const data = { ...audit, rows, status: 'SKIPPED' as const, error: 'У склада есть более свежий прайс' };
            return previous
              ? tx.priceImport.update({ where: { id: previous.id }, data })
              : tx.priceImport.create({ data });
          }
        }

        if (snapshot && !options.force) {
          const active = central
            ? await tx.product.count({ where: { isActive: true } })
            : await tx.warehouseOffer.count({ where: { warehouseCode, isActive: true } });
          if (rows < active * MIN_SHARE) {
            throw new RejectedPriceList(
              `В файле ${rows} позиций, на складе ${active}. Снимок скрыл бы больше половины позиций склада.`,
            );
          }
        }

        await stageRows(tx, unique, central);
        const stats = warehouse
          ? await applyWarehouse(tx, warehouseCode, warehouse.defaultPackQty, snapshot)
          : await applyCentral(tx, snapshot);
        const originals = parsedRows.filter((row) => row.originalCode);
        if (originals.length) {
          await tx.$executeRaw`
          INSERT INTO "OriginalArticle" ("productId", "originalCode")
          SELECT i.id, m.original FROM unnest(${originals.map((r) => r.code)}::text[], ${originals.map((r) => r.originalCode!)}::text[]) m(code, original)
          JOIN price_in i ON i.code = m.code
          ON CONFLICT DO NOTHING
        `;
        }
        if (options.mailRule) {
          await tx.warehouse.update({ where: { code: warehouseCode }, data: options.mailRule });
        }
        const data = { ...audit, rows, ...stats, error: null, status: 'APPLIED' as const };
        return previous
          ? tx.priceImport.update({ where: { id: previous.id }, data })
          : tx.priceImport.create({ data });
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (err) {
    const data = {
      ...audit,
      rows,
      status: err instanceof RejectedPriceList ? ('REJECTED' as const) : ('FAILED' as const),
      error: (err as Error).message.slice(0, 1000),
    };
    return meta.messageId
      ? prisma.priceImport.upsert({ where: { messageId: meta.messageId }, create: data, update: {} })
      : prisma.priceImport.create({ data });
  }
}

function validateRows(rows: PriceRow[], bad: number, retail: boolean, extraMarkup: number) {
  if (!rows.length) throw new RejectedPriceList('В файле нет строк с артикулом, ценой и подходящей маркой');
  if (bad / (rows.length + bad) > MAX_BAD_SHARE) {
    throw new RejectedPriceList(`В файле ${bad} строк с некорректной ценой`);
  }
  for (const r of rows) {
    if (
      !validArticle(r.code) ||
      (r.originalCode && (!validArticle(r.originalCode) || r.originalCode === r.code))
    ) {
      throw new RejectedPriceList('Проверьте артикул или связь с оригиналом для «' + r.code + '»');
    }
    const sellPrice = retail ? r.price : applyMarkup(r.price, extraMarkup);
    if (
      !(r.price >= 0.01 && r.price <= MAX_PRICE && sellPrice >= 0.01 && sellPrice <= MAX_PRICE) ||
      (r.pack ?? 1) > MAX_STOCK ||
      (r.stock ?? 0) > MAX_STOCK
    ) {
      throw new RejectedPriceList('Цена, остаток или партия вне диапазона для «' + r.code + '»');
    }
  }
}

function dedupe(rows: PriceRow[]) {
  const byCode = new Map<string, PriceRow>();
  for (const row of rows) {
    const previous = byCode.get(row.code);
    if (!previous || row.price < previous.price) byCode.set(row.code, row);
  }
  return [...byCode.values()];
}

async function stageRows(tx: Prisma.TransactionClient, rows: PriceRow[], central: boolean) {
  await tx.$executeRaw`
    CREATE TEMP TABLE price_in (
      id text NOT NULL DEFAULT gen_random_uuid()::text,
      code text PRIMARY KEY, name text, price numeric(10,2), stock int, pack int
    ) ON COMMIT DROP`;
  await tx.$executeRaw`
    INSERT INTO price_in (code, name, price, stock, pack)
    SELECT * FROM unnest(
      ${rows.map((r) => r.code)}::text[],
      ${rows.map((r) => (r.name ?? r.code).slice(0, 2000))}::text[],
      ${rows.map((r) => (central ? applyMarkup(r.price) : r.price))}::numeric[],
      ${rows.map((r) => r.stock ?? -1)}::int[],
      ${rows.map((r) => r.pack ?? 0)}::int[]
    )`;
  const duplicates = await tx.$queryRaw<{ code: string }[]>`
    SELECT i.code FROM price_in i JOIN "Product" p ON upper(btrim(p.code)) = i.code
    GROUP BY i.code HAVING count(*) > 1 LIMIT 1`;
  if (duplicates[0]) throw new RejectedPriceList('Неоднозначный артикул: ' + duplicates[0].code);
  await tx.$executeRaw`
    UPDATE price_in i SET id = p.id FROM "Product" p WHERE upper(btrim(p.code)) = i.code`;
}

async function applyCentral(tx: Prisma.TransactionClient, snapshot: boolean) {
  const [{ updated, restored }] = await tx.$queryRaw<[{ updated: number; restored: number }]>`
    SELECT count(*) FILTER (WHERE p.price <> i.price)::int AS updated,
           count(*) FILTER (WHERE NOT p."isActive")::int AS restored
    FROM "Product" p JOIN price_in i ON i.id = p.id`;

  await tx.$executeRaw`
    UPDATE "Product" p
    SET price = i.price,
        "stockQty" = CASE WHEN i.stock >= 0 THEN i.stock ELSE p."stockQty" END,
        "packQty" = CASE WHEN i.pack > 0 THEN i.pack ELSE p."packQty" END,
        "isActive" = true,
        "updatedAt" = now()
    FROM price_in i
    WHERE p.id = i.id
      AND (p.price <> i.price OR NOT p."isActive" OR (i.stock >= 0 AND p."stockQty" <> i.stock)
           OR (i.pack > 0 AND p."packQty" <> i.pack))`;

  const added = await tx.$executeRaw`
    INSERT INTO "Product" (id, code, name, price, "stockQty", "packQty", "isActive", "createdAt", "updatedAt")
    SELECT i.id, i.code, i.name, i.price, greatest(i.stock, 0), greatest(i.pack, 1), true, now(), now()
    FROM price_in i LEFT JOIN "Product" p ON p.id = i.id WHERE p.id IS NULL`;

  const hidden = snapshot
    ? await tx.$executeRaw`
    UPDATE "Product" p SET "isActive" = false, "updatedAt" = now()
    WHERE p."isActive" AND NOT EXISTS (SELECT 1 FROM price_in i WHERE i.id = p.id)`
    : 0;

  await applyWarehouse(tx, CENTRAL_WAREHOUSE, 1, snapshot, true);
  return { added, updated, hidden, restored };
}

async function applyWarehouse(
  tx: Prisma.TransactionClient,
  warehouseCode: string,
  defaultPack: number,
  snapshot: boolean,
  preserveMissing = false,
) {
  await tx.$executeRaw`
    INSERT INTO "Product" (id, code, name, price, "stockQty", "packQty", "isActive", "createdAt", "updatedAt")
    SELECT i.id, i.code, i.name, 0, 0, 1, false, now(), now()
    FROM price_in i LEFT JOIN "Product" p ON p.id = i.id WHERE p.id IS NULL`;

  const [{ added, updated, restored }] = await tx.$queryRaw<
    [{ added: number; updated: number; restored: number }]
  >`
    SELECT count(*) FILTER (WHERE o."productId" IS NULL)::int AS added,
           count(*) FILTER (WHERE o.price <> i.price)::int AS updated,
           count(*) FILTER (WHERE NOT o."isActive")::int AS restored
    FROM price_in i LEFT JOIN "WarehouseOffer" o ON o."productId" = i.id AND o."warehouseCode" = ${warehouseCode}`;

  await tx.$executeRaw`
    INSERT INTO "WarehouseOffer" ("productId", "warehouseCode", price, "stockQty", "packQty", "isActive", "updatedAt")
    SELECT i.id, ${warehouseCode}, i.price,
           CASE WHEN i.stock < 0 AND ${preserveMissing} THEN coalesce(previous."stockQty", 0) ELSE greatest(i.stock, 0) END,
           coalesce(nullif(i.pack, 0), CASE WHEN ${preserveMissing} THEN previous."packQty" END, ${defaultPack}::int),
           true, now()
    FROM price_in i LEFT JOIN "WarehouseOffer" previous ON previous."productId" = i.id AND previous."warehouseCode" = ${warehouseCode}
    ON CONFLICT ("productId", "warehouseCode") DO UPDATE
    SET price = excluded.price, "stockQty" = excluded."stockQty", "packQty" = excluded."packQty", "isActive" = true, "updatedAt" = now()`;

  const hidden = snapshot
    ? await tx.$executeRaw`
    UPDATE "WarehouseOffer" o SET "isActive" = false, "stockQty" = 0, "updatedAt" = now()
    WHERE o."warehouseCode" = ${warehouseCode} AND o."isActive" AND NOT EXISTS (SELECT 1 FROM price_in i WHERE i.id = o."productId")`
    : 0;

  return { added, updated, hidden, restored };
}

export function describeImport(record: PriceImport): string {
  const file = record.fileName ? ` (${record.fileName})` : '';
  const source = `${record.warehouseCode}${file}`;
  if (record.status === 'APPLIED') {
    return [
      `Прайс ${source} обновлён. Позиций: ${record.rows}.`,
      `Цена изменилась: ${record.updated}. Добавлено: ${record.added}.`,
      `Скрыто: ${record.hidden}. Вернулось в продажу: ${record.restored}.`,
    ].join('\n');
  }
  if (record.status === 'SKIPPED') return `Прайс ${source} пропущен. ${record.error ?? 'Есть более свежий.'}`;
  return `Прайс ${source} не применён. ${record.error ?? record.status}`;
}
