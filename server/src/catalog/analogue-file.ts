import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { articleKey, validArticle } from './offers';

export type AnalogueLink = { originalCode: string; code: string };
const ORIGINAL_HEADERS = ['артикул оригинала', 'original_article'];
const ANALOGUE_HEADERS = ['артикул аналога', 'analogue_article', 'analog_article', 'артикул'];

export function readAnalogueLinks(file: Buffer): AnalogueLink[] {
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(file, { type: 'buffer', raw: true, codepage: 65001 });
  } catch {
    throw new BadRequestException('Не удалось прочитать таблицу.');
  }
  for (const name of book.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<string[]>(book.Sheets[name], { header: 1, raw: false, defval: '' });
    for (let i = 0; i < Math.min(grid.length, 30); i++) {
      const header = grid[i].map((value) => value.trim().toLowerCase());
      const original = header.findIndex((key) => ORIGINAL_HEADERS.includes(key));
      const analogue = header.findIndex((key) => ANALOGUE_HEADERS.includes(key));
      if (original < 0 || analogue < 0) continue;
      const rows: AnalogueLink[] = [];
      for (const [offset, row] of grid.slice(i + 1).entries()) {
        if (!row.some((value) => value.trim())) continue;
        const originalCode = articleKey(row[original] ?? '');
        const code = articleKey(row[analogue] ?? '');
        if (!validArticle(originalCode) || !validArticle(code) || originalCode === code) {
          throw new BadRequestException(`Проверьте артикулы в строке ${i + offset + 2}.`);
        }
        rows.push({ originalCode, code });
      }
      if (rows.length && rows.length <= 50_000) return rows;
      throw new BadRequestException('В файле должно быть от 1 до 50 000 связей.');
    }
  }
  throw new BadRequestException('Нужны колонки «Артикул оригинала» и «Артикул аналога».');
}

export function writeAnalogueLinks(links: AnalogueLink[]) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Артикул оригинала', 'Артикул аналога'],
    ...links.map(({ originalCode, code }) => [originalCode, code]),
  ]);
  XLSX.utils.book_append_sheet(book, sheet, 'Аналоговые зч');
  return XLSX.write(book, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}
