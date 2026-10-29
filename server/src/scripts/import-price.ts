import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { describeImport, importPriceList } from '../price-sync/import-price-list';

/**
 * Applies a supplier price list (.xls/.xlsx) by hand - the same code path as the emailed one.
 * --force skips the safety checks, for a deliberately partial list.
 */
async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const filePath = args.find((arg) => !arg.startsWith('--'));
  if (!filePath) {
    console.error('Usage: npm run import:price -- <price.xls> [--force]');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const started = Date.now();
    const record = await importPriceList(
      prisma,
      readFileSync(filePath),
      { source: 'file', fileName: basename(filePath) },
      { force },
    );
    console.log(describeImport(record));
    console.log(`(${((Date.now() - started) / 1000).toFixed(1)} с)`);
    process.exitCode = record.status === 'APPLIED' ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
