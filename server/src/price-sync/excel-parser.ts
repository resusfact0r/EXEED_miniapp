import * as XLSX from 'xlsx';

export interface PriceRow {
  code: string;
  name?: string;
  /** Supplier price, before markup. */
  price: number;
  /** null when the file doesn't say (no stock column, or "есть"/"под заказ" instead of a number). */
  stock: number | null;
  /** Minimum lot / multiplicity; null when the file has no such column. */
  pack: number | null;
  brand?: string;
  originalCode?: string;
}

export interface ParsedPriceList {
  rows: PriceRow[];
  /** Data rows that had a code but no usable price - counted so junk files can be rejected. */
  badPriceRows: number;
  sheet: string;
  columns: Record<string, string>;
}

type Field = 'code' | 'name' | 'price' | 'stock' | 'pack' | 'brand' | 'originalCode';

// Header names seen in supplier price lists. Matched after lowercasing and folding ё/е. Order
// within a field matters: the first pattern that matches some column wins, so exact names come
// before loose ones ("цена" before anything merely containing "цена", like "цена закупки").
const HEADER_PATTERNS: Record<Field, RegExp[]> = {
  code: [/^артикул$/, /^арт\.?$/, /^код товара$/, /^код$/, /^каталожный номер$/, /^номер детали$/, /^oem$/, /^part ?number$/, /^sku$/, /^code$/, /артикул/],
  name: [/^наименование$/, /^название$/, /^номенклатура$/, /^наименование товара$/, /^товар$/, /^описание$/, /^name$/, /наименование/, /название/, /номенклатура/],
  price: [/^цена$/, /^цена,? руб\.?$/, /^цена \(руб\.?\)$/, /^стоимость$/, /^price$/, /^цена/, /цена/],
  stock: [/^остаток$/, /^наличие$/, /^количество$/, /^кол-?во$/, /^склад$/, /^stock$/, /^qty$/, /остат/, /наличи/, /кол-?во/],
  pack: [/^минимальная партия$/, /^мин\.? партия$/, /^мин\.? кол-?во$/, /^мин\.? количество$/, /^кратность$/, /^в упаковке$/, /^упаковка$/, /кратност/, /минимальн/],
  brand: [/^бренд$/, /^производитель$/, /^марка$/, /^brand$/, /^vendor$/, /^производ/],
  originalCode: [/^артикул оригинала$/, /^артикул оригинальной з\/ч$/, /^original_article$/, /^original_code$/, /^oem_original$/],
};
// Env overrides, set once the real file's headers are known: PRICE_COL_CODE="Артикул" etc.
const ENV_OVERRIDES: Record<Field, string> = {
  code: 'COL_CODE',
  name: 'COL_NAME',
  price: 'COL_PRICE',
  stock: 'COL_STOCK',
  pack: 'COL_PACK',
  brand: 'COL_BRAND',
  originalCode: 'COL_ORIGINAL',
};
const HEADER_SEARCH_ROWS = 30;

const fold = (v: unknown) => String(v ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const brandKey = (value?: string) => fold(value) === 'чери' ? 'chery' : fold(value);

/**
 * A number as suppliers write it: "1 234,56", "1234.56 р.", "18,636.32" (Excel's en-US display),
 * "1.234,56", "19.00". When both a comma and a dot appear, the last one is the decimal point and
 * the other groups thousands; a lone comma is decimal unless it splits groups of three digits
 * ("1,234,567"); several dots only as groups of three ("1.234.567"). Anything else -> NaN, so a
 * garbled cell is rejected rather than read as a wildly wrong price.
 */
export function parseNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  let s = String(value ?? '')
    .replace(/[\s\u00A0\u202F]/g, '')
    .replace(/(руб|р|₽)\.?$/i, '');
  if (s === '') {
    return NaN;
  }
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (comma >= 0) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/** "15", "15 шт", ">10", "10+", "1,019.00" -> number; "есть", "под заказ", "" -> null (unknown, not zero). */
export function parseStock(value: unknown): number | null {
  if (typeof value === 'number') {
    return Math.max(0, Math.floor(value));
  }
  const match = String(value ?? '').replace(/[\s\u00A0\u202F]/g, '').match(/^[><=~]*(\d[\d.,]*)/);
  if (!match) {
    return null;
  }
  const n = parseNumber(match[1].replace(/[.,]$/, ''));
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

function findColumns(header: unknown[], envPrefix?: string): Partial<Record<Field, number>> {
  const cells = header.map(fold);
  const found: Partial<Record<Field, number>> = {};
  for (const field of Object.keys(HEADER_PATTERNS) as Field[]) {
    const override = envPrefix && process.env[envPrefix + ENV_OVERRIDES[field]];
    if (override) {
      const at = cells.indexOf(fold(override));
      if (at >= 0) found[field] = at;
      continue;
    }
    for (const pattern of HEADER_PATTERNS[field]) {
      const at = cells.findIndex((cell, i) => pattern.test(cell) && !Object.values(found).includes(i) && (field !== 'code' || !HEADER_PATTERNS.originalCode.some((p) => p.test(cell))));
      if (at >= 0) {
        found[field] = at;
        break;
      }
    }
  }
  return found;
}

/**
 * Reads .xls or .xlsx. Takes the first sheet that has a recognisable header (code + price) in its
 * first rows - price lists often open with a company banner and a date above the table.
 */
export function parsePriceList(
  buffer: Buffer,
  options: { envPrefix?: string; brandFilter?: string } = { envPrefix: 'PRICE_' },
): ParsedPriceList {
  // raw: false keeps cells as displayed text, so long article numbers don't turn into 1.23E+11.
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: true, codepage: 65001 });

  for (const sheetName of workbook.SheetNames) {
    const selectedSheet = options.envPrefix && process.env[options.envPrefix + 'SHEET'];
    if (selectedSheet && fold(sheetName) !== fold(selectedSheet)) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    });

    for (let h = 0; h < Math.min(grid.length, HEADER_SEARCH_ROWS); h++) {
      const cols = findColumns(grid[h], options.envPrefix);
      if (cols.code === undefined || cols.price === undefined) {
        continue;
      }

      if (options.brandFilter && cols.brand === undefined) continue;
      const rows: PriceRow[] = [];
      let badPriceRows = 0;
      for (const line of grid.slice(h + 1)) {
        const code = String(line[cols.code] ?? '').trim();
        if (!code) {
          continue;
        }
        const brand = cols.brand !== undefined ? String(line[cols.brand] ?? '').trim() || undefined : undefined;
        if (options.brandFilter && brandKey(brand) !== brandKey(options.brandFilter)) continue;
        const price = parseNumber(line[cols.price]);
        if (!Number.isFinite(price) || price <= 0) {
          badPriceRows++;
          continue;
        }
        rows.push({
          code,
          name: cols.name !== undefined ? String(line[cols.name] ?? '').trim() || undefined : undefined,
          price,
          stock: cols.stock !== undefined ? parseStock(line[cols.stock]) : null,
          pack: cols.pack !== undefined ? parseStock(line[cols.pack]) || null : null,
          brand,
          originalCode: cols.originalCode === undefined ? undefined : String(line[cols.originalCode] ?? '').trim() || undefined,
        });
      }

      const columns = Object.fromEntries(
        Object.entries(cols).map(([field, index]) => [field, String(grid[h][index as number])]),
      );
      return { rows, badPriceRows, sheet: sheetName, columns };
    }
  }

  throw new Error('Не найдена таблица с колонками «артикул», «цена»' + (options.brandFilter ? ', «бренд»' : ''));
}
