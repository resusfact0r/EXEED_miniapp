import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { loadTypeScript } from './load-typescript.mjs';
const { classifyProduct, webMetadata } = await loadTypeScript(new URL('../server/src/catalog/web-taxonomy.ts', import.meta.url));

// RFC 4180: quoted commas, double quotes and newlines are valid in supplier names.
export function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if (c === '\n' && !quoted) { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (quoted) throw new Error('Unclosed CSV field');
  return rows;
}

const file = 'server/data/chery-catalog.csv';
const [headers, ...rows] = parseCsv((await readFile(new URL(`../${file}`, import.meta.url), 'utf8')).replace(/^\uFEFF/, ''));
const products = rows.filter((row) => row.length === headers.length).map((row) => {
  const record = Object.fromEntries(headers.map((key, i) => [key, row[i]]));
  const product = {
    id: `snapshot:${record.code}`, code: record.code, name: record.name,
    // Same default retail markup as the backend. This snapshot is never an order price.
    price: (Math.round(Number(record.price) * 1.14 * 100) / 100).toFixed(2),
    stockQty: Math.max(0, Number(record.stockQty) || 0),
    packQty: Math.max(1, Number(record.description.match(/Минимальная партия:\s*(\d+)/i)?.[1]) || 1),
    description: record.description || null, imageUrl: record.imageUrl || null,
  };
  return { ...product, ...classifyProduct(product) };
}).filter((product) => product.code && product.name && Number.isFinite(Number(product.price)));
const sourceDate = execFileSync('git', ['log', '-1', '--format=%cI', '--', file], { encoding: 'utf8' }).trim() || null;
const target = new URL('../public/web-catalog.json', import.meta.url);
await mkdir(new URL('../public/', import.meta.url), { recursive: true });
await writeFile(target, JSON.stringify({ source: 'snapshot', sourceDate, metadata: webMetadata(products), products }));
console.log(`Web snapshot: ${products.length} parts; brands: ${webMetadata(products).brands.map((brand) => brand.name).join(', ')}`);
