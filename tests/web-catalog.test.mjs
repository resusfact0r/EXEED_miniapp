import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadTypeScript } from '../scripts/load-typescript.mjs';

const { classifyProduct, filterWebProducts, webMetadata } = await loadTypeScript(new URL('../server/src/catalog/web-taxonomy.ts', import.meta.url));
const { shouldOpenMiniApp } = await loadTypeScript(new URL('../src/web/launch.ts', import.meta.url));
const product = (code, name, stockQty = 10, packQty = 1, price = '500') => ({ id: code, code, name, stockQty, packQty, price, ...classifyProduct({ name }) });

test('brand matching uses boundaries and keeps the most specific named model', () => {
  const item = classifyProduct({ name: 'Колодки CHERY TIGGO 7 PRO MAX' });
  assert.deepEqual(item.brands, ['CHERY']);
  assert.deepEqual(item.models, ['CHERY:Tiggo 7 Pro Max']);
  assert.ok(item.categories.includes('brakes'));
  assert.deepEqual(classifyProduct({ name: 'CHERYWOOD опора' }).brands, []);
  assert.deepEqual(classifyProduct({ name: 'Фильтр 300 мм' }).brands, []);
  assert.deepEqual(classifyProduct({ name: 'Диск TANK 300' }).models, ['TANK:300']);
});

test('unknown fitment stays unknown and every part remains accessible in the common catalog', () => {
  const products = [product('A1', 'ФИЛЬТР МАСЛЯНЫЙ'), product('A2', 'Коврики EXEED TXL')];
  assert.equal(webMetadata(products).unclassified, 1);
  assert.equal(filterWebProducts(products, {}).total, 2);
  assert.equal(filterWebProducts(products, { brand: 'EXEED' }).total, 1);
  assert.deepEqual(webMetadata(products).brands.map((brand) => brand.name), ['EXEED']);
});

test('search matches words in any order and normalized articles, with exact article first', () => {
  const products = [product('X481F3707010', 'Фильтр воздушный'), product('481F3707010', 'ФИЛЬТР МАСЛЯНЫЙ')];
  assert.equal(filterWebProducts(products, { query: 'масляный фильтр' }).items[0].code, '481F3707010');
  assert.equal(filterWebProducts(products, { query: '481F-3707010' }).items[0].code, '481F3707010');
});

test('brand, model, category and sellable stock filters compose; incomplete lots are excluded', () => {
  const products = [product('A1', 'Колодки EXEED TXL', 9, 20), product('A2', 'Колодки EXEED VX', 20, 20), product('A3', 'Колодки EXEED TXL', 40, 20), product('A4', 'Фара CHERY TIGGO 7', 10)];
  const result = filterWebProducts(products, { brand: 'EXEED', model: 'TXL', category: 'brakes', inStock: true });
  assert.deepEqual(result.items.map((item) => item.code), ['A3']);
});

test('pagination is stable, preserves total and supports numeric prices', () => {
  const products = Array.from({ length: 25 }, (_, i) => product(`P${i}`, `Деталь ${i}`, 1, 1, String(25 - i)));
  const page = filterWebProducts(products, { page: 2, pageSize: 12, sort: 'price-asc' });
  assert.equal(page.total, 25); assert.equal(page.items.length, 12); assert.equal(page.items[0].price, '13');
  assert.equal(filterWebProducts(products, { page: 3, pageSize: 12 }).items.length, 1);
});

test('ordinary browsers open the web store; Telegram launch data and native bridges open Mini App', () => {
  assert.equal(shouldOpenMiniApp('https://example.org/', {}), false);
  assert.equal(shouldOpenMiniApp('https://example.org/?brand=EXEED', {}), false);
  assert.equal(shouldOpenMiniApp('https://example.org/#tgWebAppData=abc&tgWebAppPlatform=ios', {}), true);
  assert.equal(shouldOpenMiniApp('https://example.org/', { TelegramWebviewProxy: {} }), true);
  assert.equal(shouldOpenMiniApp('https://example.org/?miniapp=1', {}), true);
  assert.equal(shouldOpenMiniApp('https://example.org/?web=1#tgWebAppData=abc', {}), false);
});

test('the production snapshot contains the full export and only finite retail prices and lot sizes', async () => {
  const { products, metadata } = JSON.parse(await readFile(new URL('../public/web-catalog.json', import.meta.url), 'utf8'));
  assert.equal(metadata.total, 21998); assert.equal(products.length, metadata.total);
  assert.equal(new Set(products.map((item) => item.code)).size, products.length);
  assert.ok(products.every((item) => Number.isFinite(Number(item.price)) && Number(item.price) >= 0 && item.packQty >= 1));
  assert.ok(metadata.brands.every((brand) => brand.count > 0));
  assert.equal(products.find((item) => item.code === '501014147AA').price, '380.55');
});
