import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { readFileSync } from 'node:fs';

interface CsvRow {
  code: string;
  name: string;
  price: string;
  stockQty: string;
  description?: string;
  imageUrl?: string;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npm run import:catalog -- <path-to-csv>');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const raw = readFileSync(filePath, 'utf-8');
  const rows: CsvRow[] = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

  let upserted = 0;
  for (const row of rows) {
    if (!row.code || !row.name) {
      console.warn(`Skipping row with missing code/name: ${JSON.stringify(row)}`);
      continue;
    }
    await prisma.product.upsert({
      where: { code: row.code },
      update: {
        name: row.name,
        price: Number(row.price ?? 0),
        stockQty: Number(row.stockQty ?? 0),
        description: row.description || null,
        imageUrl: row.imageUrl || null,
      },
      create: {
        code: row.code,
        name: row.name,
        price: Number(row.price ?? 0),
        stockQty: Number(row.stockQty ?? 0),
        description: row.description || null,
        imageUrl: row.imageUrl || null,
      },
    });
    upserted += 1;
  }

  console.log(`Imported/updated ${upserted} products from ${filePath}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
