import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadTypeScript } from '../scripts/load-typescript.mjs';

const { classifyProduct, filterWebProducts, webMetadata } = await loadTypeScript(new URL('../server/src/catalog/web-taxonomy.ts', import.meta.url));
const { shouldOpenMiniApp } = await loadTypeScript(new URL('../src/web/launch.ts', import.meta.url));
const product = (code, name, stockQty = 10, packQty = 1, price = '500') => ({ id: code, code, name, stockQty, packQty, price, ...classifyProduct({ code, name }) });

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

test('every added vehicle has a matching fetched numbered row and full article suffix', async () => {
  const raw = await readFile(new URL('../research/kitaiavto-2026-11-17/evidence.json', import.meta.url));
  const evidence = JSON.parse(raw);
  const registry = JSON.parse(await readFile(new URL('../server/src/catalog/article-applications.json', import.meta.url), 'utf8'));
  assert.equal(registry.sourceEvidenceSha256, createHash('sha256').update(raw).digest('hex'));
  const pages = new Map(evidence.documents.map((document) => [document.url, document]));
  const corroborated = new Set(evidence.corroboratedArticleUrls);
  const canonical = (value) => value.replace(/[-\s]/g, '').toUpperCase();
  assert.equal(Object.keys(registry.articles).length, 1536);
  for (const [code, references] of Object.entries(registry.articles)) {
    assert.ok(references.length > 0);
    for (const [profileIndex, position, sourceArticle] of references) {
      const profile = registry.profiles[profileIndex];
      assert.equal(canonical(code), sourceArticle);
      assert.ok(pages.get(profile.schemeUrl)?.rows.some((row) => row.position === position && canonical(row.article) === sourceArticle), code);
      assert.ok(corroborated.has(`${profile.schemeUrl}/${sourceArticle}`), code);
      if (profile.brand === 'EXEED' && profile.model === 'VX FL') assert.equal(profile.modelYearFrom, 2024);
    }
  }
});

test('catalog-backed model filters and searches preserve individual brand-model pairs', () => {
  const item = product('155000158AA', 'Выпускной клапан топливопровода');
  const apps = item.vehicleApplications;
  assert.ok(apps.some((app) => app.brand === 'OMODA' && app.model === 'C5' && app.configuration.includes('1.6')));
  assert.equal(filterWebProducts([item], { brand: 'OMODA', model: 'C5', query: 'клапан' }).total, 1);
  assert.equal(filterWebProducts([item], { query: 'клапан OMODA C5' }).total, 1);
  assert.equal(filterWebProducts([item], { query: 'EXEED S5 GT' }).total, 0);
  assert.equal(filterWebProducts([item], { brand: 'EXEED', model: 'C5' }).total, 0);
});

test('VX FL scope does not become generic VX, and unknown suffixes never inherit a mapping', () => {
  const item = product('302001286AA', 'Впускной патрубок EXEED VX');
  assert.ok(item.models.includes('EXEED:VX FL'));
  assert.ok(!item.models.includes('EXEED:VX'));
  assert.equal(filterWebProducts([item], { brand: 'EXEED', model: 'VX' }).total, 0);
  for (const code of ['302001286AAX', 'X302001286AA', '0302001286AA', '__proto__', 'constructor']) {
    assert.equal(classifyProduct({ code, name: 'Патрубок' }).vehicleApplications, undefined, code);
    assert.deepEqual(classifyProduct({ code, name: 'Патрубок' }).models, [], code);
  }
  const pipe = product('302000129AA', 'Патрубок');
  assert.ok(pipe.vehicleApplications.some((application) => application.brand === 'OMODA' && application.model === 'C5' && application.configuration.includes('1.6')));
  assert.ok(!pipe.models.includes('CHERY:Tiggo 7 Pro'));
  assert.ok(!pipe.vehicleApplications.some((application) => application.brand === 'OMODA' && application.model === 'C5' && application.configuration.includes('1.5')));
  assert.equal(classifyProduct({ code: '302001163AA-UNREVIEWED', name: 'Патрубок' }).vehicleApplications, undefined);
});

test('all unapproved snapshot articles retain their previous text navigation', async () => {
  const { products } = JSON.parse(await readFile(new URL('../public/web-catalog.json', import.meta.url), 'utf8'));
  const base = JSON.parse(await readFile(new URL('../server/src/catalog/article-applications.json', import.meta.url), 'utf8'));
  const reviewed = JSON.parse(await readFile(new URL('../server/src/catalog/reviewed-applications.json', import.meta.url), 'utf8'));
  const platforms = JSON.parse(await readFile(new URL('../server/src/catalog/platform-applications.json', import.meta.url), 'utf8'));
  const approved = new Set([...Object.keys(base.articles), ...Object.keys(reviewed.articles), ...Object.keys(platforms.articles)]);
  let untouched = 0;
  for (const item of products) {
    const actual = classifyProduct(item);
    const previous = classifyProduct({ name: item.name, description: item.description });
    assert.deepEqual(actual.categories, previous.categories, item.code);
    if (!actual.vehicleApplications) { assert.deepEqual(actual, previous, item.code); untouched++; }
  }
  assert.equal(untouched, products.filter((item) => !approved.has(item.code)).length);
});

test('metadata includes explicit revisions and new makes only when products carry them', () => {
  const item = product('302001286AA', 'Патрубок');
  const metadata = webMetadata([item]);
  assert.ok(metadata.brands.find((brand) => brand.name === 'EXEED').models.includes('VX FL'));
  assert.ok(!metadata.brands.find((brand) => brand.name === 'EXEED').models.includes('VX'));
});

test('all public article details and the fallback catalog exclude competitor attribution and links', async () => {
  const registry = JSON.parse(await readFile(new URL('../server/src/catalog/article-applications.json', import.meta.url), 'utf8'));
  const reviewed = JSON.parse(await readFile(new URL('../server/src/catalog/reviewed-applications.json', import.meta.url), 'utf8'));
  const prohibited = /китайавто|xn--80aagvgd7a1ae|files\.chery\.ru|"(?:sourceUrl|schemeUrl|sourcePosition|sourceOrigin|sourceName|sourceEvidenceSha256|catalogApplications|privateProof|witnessHashes|reviewSha256)"/i;
  for (const [code, references] of Object.entries(registry.articles)) {
    const detail = classifyProduct({ code, name: 'Деталь' });
    assert.doesNotMatch(JSON.stringify(detail), prohibited, code);
    assert.equal(detail.vehicleApplications.length, references.length, code);
    for (const [index, application] of detail.vehicleApplications.entries()) {
      const expected = registry.profiles[references[index][0]];
      for (const key of ['brand', 'model', 'configuration', 'modelYearFrom']) assert.equal(application[key], expected[key], `${code}: ${key}`);
    }
  }
  for (const [code, references] of Object.entries(reviewed.articles)) {
    const detail = classifyProduct({ code, name: 'Деталь' });
    assert.doesNotMatch(JSON.stringify(detail), prohibited, code);
    assert.equal(detail.vehicleApplications.length, references.length, code);
    assert.deepEqual(detail.vehicleApplications, references.map((index) => ({ ...reviewed.profiles[index], checkedDate: reviewed.checkedDate })), code);
  }
  assert.doesNotMatch(await readFile(new URL('../public/web-catalog.json', import.meta.url), 'utf8'), prohibited);
});

test('the completed 9334-article review authorizes only exact, witnessed applications', async () => {
  const raw = await readFile(new URL('../research/article-review-2026-11-17/review.json', import.meta.url));
  const review = JSON.parse(raw);
  const registry = JSON.parse(await readFile(new URL('../server/src/catalog/reviewed-applications.json', import.meta.url), 'utf8'));
  const base = JSON.parse(await readFile(new URL('../server/src/catalog/article-applications.json', import.meta.url), 'utf8'));
  assert.equal(registry.reviewSha256, createHash('sha256').update(raw).digest('hex'));
  assert.equal(new Set(review.targetArticleCodes).size, 9334);
  assert.equal(review.summary.sourcePagesAttempted, 13702);
  assert.deepEqual(registry.profiles, review.profiles);
  assert.deepEqual(Object.keys(registry.articles), Object.keys(review.articles));
  const canonical = (value) => value.replace(/[-\s]/g, '').toUpperCase();
  let manufacturer = new Set();
  for (const [code, references] of Object.entries(review.articles)) {
    assert.ok(review.targetArticleCodes.includes(code), code);
    assert.ok(!Object.hasOwn(base.articles, code), 'Earlier approved mappings must remain unchanged');
    assert.deepEqual(registry.articles[code], references.map(([index]) => index).sort((a, b) => a - b), code);
    for (const [index, sourceArticle, kinds, hashes] of references) {
      assert.equal(canonical(code), canonical(sourceArticle), code);
      assert.ok(registry.profiles[index], code);
      assert.ok(kinds.length && kinds.every((kind) => ['manufacturer_table', 'catalog_scheme'].includes(kind)), code);
      assert.ok(hashes.length && hashes.every((hash) => /^[a-f0-9]{64}$/.test(hash)), code);
      if (kinds.includes('manufacturer_table')) manufacturer.add(code);
    }
  }
  assert.equal(manufacturer.size, review.summary.manufacturerArticles);
  assert.deepEqual(new Set([...Object.keys(registry.articles), ...review.heldArticleCodes]), new Set(review.targetArticleCodes));
  assert.equal(Object.keys(registry.articles).length + review.heldArticleCodes.length, 9334);
  for (const code of review.heldArticleCodes) assert.equal(classifyProduct({ code, name: 'Деталь' }).vehicleApplications, undefined, code);
});

test('manufacturer scopes separate powertrains, hybrids and the VX 2024 revision', () => {
  const pipe = product('302001163AA', 'Патрубок');
  const txl = pipe.vehicleApplications.filter((app) => app.brand === 'EXEED' && app.model === 'TXL');
  assert.deepEqual(txl.map((app) => app.configuration), ['M32TFL · SQRF4J20 · 7DCT']);
  assert.equal(filterWebProducts([pipe], { brand: 'EXEED', model: 'TXL', query: 'SQRF4J20' }).total, 1);
  assert.equal(filterWebProducts([pipe], { brand: 'EXEED', model: 'TXL', query: 'SQRF4J16' }).total, 0);
  const hybrid = product('110100017AA', 'Деталь');
  assert.ok(hybrid.vehicleApplications.some((app) => app.brand === 'EXLANTIX' && app.model === 'ES REEV' && app.configuration.includes('1DHT')));
  assert.ok(hybrid.vehicleApplications.some((app) => app.brand === 'EXEED' && app.model === 'RX PHEV' && app.configuration.includes('3DHT165')));
  assert.ok(!hybrid.vehicleApplications.some((app) => app.brand === 'EXLANTIX' && ['ES', 'ES EV', 'ET', 'ET EV'].includes(app.model)));
  const vx = product('123000090AA', 'Деталь');
  const revision = vx.vehicleApplications.find((app) => app.brand === 'EXEED' && app.model === 'VX FL');
  assert.equal(revision.modelYearFrom, 2024);
  assert.match(revision.configuration, /M36TFL.*8AT/);
  for (const code of ['302001163AB-UNREVIEWED', 'X110100017AA', '123000090AA-UNREVIEWED']) {
    assert.equal(classifyProduct({ code, name: 'Деталь' }).vehicleApplications, undefined, code);
  }
});

test('platform review requires a witnessed full OEM number and keeps provenance outside the product', async () => {
  const records = JSON.parse(await readFile(new URL('../server/src/catalog/platform-applications.json', import.meta.url)));
  for (const [code, rows] of Object.entries(records.articles)) {
    const detail = classifyProduct({ code, name: 'Деталь' });
    assert.deepEqual(detail.vehicleApplications, rows.map(row => row.application));
    for (const row of rows) {
      assert.equal(row.article.replace(/[-\s]/g, '').toUpperCase(), code.replace(/[-\s]/g, '').toUpperCase());
      assert.match(row.witness, /^[a-f0-9]{64}$/);
      if (row.platform === 'M36TFL') assert.equal(row.application.modelYearFrom, 2024);
    }
    assert.equal(classifyProduct({ code: code + 'UNREVIEWED', name: 'Деталь' }).vehicleApplications, undefined);
  }
});

test('multiple selected sections include either part once and keep stock and vehicle filters', () => {
  const products = [
    product('E', 'Двигатель EXEED TXL'),
    product('M', 'Корпус зеркала EXEED TXL'),
    product('EM', 'Двигатель регулировки зеркала EXEED TXL'),
    product('B', 'Бампер EXEED TXL'),
    product('X', 'Зеркало CHERY TIGGO 4'),
    product('Z', 'Зеркало EXEED TXL', 0),
  ];
  const codes = (category) => filterWebProducts(products, { brand: 'EXEED', model: 'TXL', inStock: true, category }).items.map(({ code }) => code).sort();
  assert.deepEqual(codes('engine'), ['E', 'EM']);
  assert.deepEqual(codes('mirrors'), ['EM', 'M']);
  assert.deepEqual(codes('engine,mirrors,engine'), ['E', 'EM', 'M']);
});
