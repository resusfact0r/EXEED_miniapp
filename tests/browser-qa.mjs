import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';
import { loadTypeScript } from '../scripts/load-typescript.mjs';

const dist = resolve('dist');
const require = createRequire(import.meta.url);
const axeScript = require.resolve('axe-core/axe.min.js');
const output = resolve(process.env.QA_OUTPUT_DIR ?? 'work/qa');
await mkdir(output, { recursive: true });
const snapshot = JSON.parse(await readFile(resolve(dist, 'web-catalog.json'), 'utf8'));
const { filterWebProducts } = await loadTypeScript(new URL('../server/src/catalog/web-taxonomy.ts', import.meta.url));
const { storageKey } = await loadTypeScript(new URL('../src/web/basket.ts', import.meta.url));
const candidates = [process.env.PUPPETEER_EXECUTABLE_PATH, process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
let executablePath;
for (const candidate of candidates) { if (await access(candidate).then(() => true, () => false)) { executablePath = candidate; break; } }
if (!executablePath) throw new Error('An installed Chrome or Chromium is required for browser QA');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://fixture.invalid');
    if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const path = resolve(dist, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!path.startsWith(dist + sep)) { response.writeHead(403).end(); return; }
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404).end('Not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(output, '.browser-'));
let browser;
const results = [];
const only = process.argv.find((arg) => arg.startsWith('--case='))?.slice(7);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function scenario(name, run) {
  if (only && !name.includes(only)) return;
  const start = Date.now();
  try { await run(); results.push({ name, status: 'passed', ms: Date.now() - start }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, status: 'failed', ms: Date.now() - start, error: error.stack ?? String(error) }); console.error(`FAIL ${name}: ${error.message}`); }
}

async function fixture(options, run) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const state = { mode: 'snapshot', snapshotAvailable: true, productFailure: false, badProducts: false, requests: [], errors: [], ...options };
  await page.setViewport({ width: options.width ?? 1440, height: options.height ?? 1000, deviceScaleFactor: 1, isMobile: Boolean(options.mobile), hasTouch: Boolean(options.mobile) });
  await page.evaluateOnNewDocument((key, saved, blocked) => {
    if (saved !== undefined) localStorage.setItem(key, saved);
    if (blocked) Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Unavailable', 'SecurityError'); } });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(text) { window.__qaCopied = text; } } });
  }, storageKey, options.saved, options.storageBlocked);
  page.on('pageerror', (error) => state.errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    try {
      const url = new URL(request.url());
      const json = (value, status = 200) => request.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(value) });
      if (state.blockChunk && /\/WebApp-.*\.js$/.test(url.pathname)) return request.respond({ status: 503, body: 'QA unavailable chunk' });
      if (url.pathname.startsWith('/api/web/')) {
        state.requests.push(url.pathname + url.search);
        if (state.mode === 'snapshot') return json({ message: 'Not found' }, 404);
        if (url.pathname === '/api/web/catalog') return json(state.mode === 'invalid-metadata' ? { total: 'bad', brands: [null] } : snapshot.metadata);
        if (url.pathname === '/api/web/products') {
          if (state.productFailure) return json({ message: 'Unavailable' }, 503);
          if (state.badProducts) return json({ items: [{ name: 'Broken' }], total: 1 });
          if (state.injectedProduct) return json({ items: [state.injectedProduct], total: 1, page: 1, pageSize: 12 });
          const params = url.searchParams;
          const filters = { query: params.get('query') ?? '', brand: params.get('brand') ?? '', model: params.get('model') ?? '', category: params.get('category') ?? '', page: Number(params.get('page') ?? 1), pageSize: Number(params.get('pageSize') ?? 12), sort: params.get('sort') ?? 'name', inStock: params.get('inStock') === 'true' };
          if (state.slowQuery === filters.query) await wait(500);
          return json(filterWebProducts(snapshot.products, filters));
        }
        const code = decodeURIComponent(url.pathname.split('/').at(-1));
        const product = snapshot.products.find((item) => item.code === code);
        return json(product ?? { message: 'Missing' }, product ? 200 : 404);
      }
      if (url.pathname.endsWith('/web-catalog.json') && !state.snapshotAvailable) return json({ message: 'Unavailable' }, 503);
      if (url.origin !== origin) return request.abort();
      await request.continue();
    } catch (error) { if (!page.isClosed()) state.errors.push(error.message); }
  });
  try {
    await page.goto(origin + (options.path ?? '/'), { waitUntil: 'networkidle0' });
    await run(page, state);
    assert.deepEqual(state.errors, [], 'No uncaught JavaScript errors are allowed');
  } catch (error) {
    if (!page.isClosed()) await page.screenshot({ path: resolve(output, `failure-${results.length + 1}.png`), fullPage: true }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

async function ready(page) { await page.waitForSelector('.product-card .product-name', { timeout: 15000 }); await page.evaluate(() => document.fonts.ready); }
async function settled(page) { await page.waitForFunction(() => !document.querySelector('.product-loading') && (document.querySelector('.product-card') || document.querySelector('.empty-state'))); }
async function search(page, value) {
  await page.focus('#parts-search'); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace');
  await page.type('#parts-search', value); await page.keyboard.press('Enter');
  await page.waitForFunction((query) => new URLSearchParams(location.search).get('q') === query, {}, value);
  await settled(page);
}
async function codes(page) { return page.$$eval('.product-card .article-code', (elements) => elements.map((element) => element.textContent.trim())); }
async function accessibility(page, filename) {
  await page.addScriptTag({ path: axeScript });
  const analysis = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] } }));
  await writeFile(resolve(output, filename), JSON.stringify({ violations: analysis.violations, incomplete: analysis.incomplete }, null, 2));
  assert.deepEqual(analysis.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.map((node) => node.target) })), [], 'Automated accessibility violations');
}

try {
  browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: profile, args: ['--disable-dev-shm-usage'], env: { ...process.env, XDG_CONFIG_HOME: resolve(output, '.config'), XDG_CACHE_HOME: resolve(output, '.cache') } });

  for (const width of [320, 360, 390, 768, 1024, 1440]) {
    await scenario(`layout-${width}: no overflow, aligned wheels, working targets`, () => fixture({ width, height: width < 700 ? 844 : 1000, mobile: width < 700 }, async (page) => {
      await ready(page);
      const metrics = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth, pins: [...document.querySelectorAll('.map-pin')].map((element) => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }), image: document.querySelector('.vehicle').complete && document.querySelector('.vehicle').naturalWidth > 0 }));
      assert.ok(metrics.page <= metrics.viewport + 1, JSON.stringify(metrics));
      assert.ok(metrics.image); assert.equal(metrics.pins.length, 6);
      assert.ok(metrics.pins.every((pin) => pin.width >= 44 && pin.height >= 44 && pin.x >= 0 && pin.x + pin.width <= width));
      for (let i = 0; i < metrics.pins.length; i++) for (let j = i + 1; j < metrics.pins.length; j++) {
        const a = metrics.pins[i], b = metrics.pins[j];
        const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        assert.ok(overlap < 2, `Touch targets ${i + 1} and ${j + 1} overlap at ${width}px`);
      }
      if ([390, 768, 1440].includes(width)) await page.screenshot({ path: resolve(output, `layout-${width}.png`), fullPage: true });
      if (width === 1440) await page.$('.car-map').then((element) => element.screenshot({ path: resolve(output, 'car-map.png') }));
      if ([390, 1440].includes(width)) await accessibility(page, `accessibility-${width}.json`);
    }));
  }

  await scenario('all six map nodes and all catalog sections select the intended products', () => fixture({}, async (page) => {
    await ready(page);
    const nodes = await page.$$eval('.map-pin', (buttons) => buttons.map((button) => button.getAttribute('aria-label')));
    for (const label of nodes) { await page.click(`button[aria-label="${label}"]`); await settled(page); assert.equal(await page.$eval(`button[aria-label="${label}"]`, (element) => element.getAttribute('aria-pressed')), 'true'); }
    assert.equal(await page.$eval('.assembly-map', (element) => element.getAttribute('aria-label')), 'Детали раздела: Трансмиссия');
    for (const category of snapshot.metadata.categories) {
      await page.$$eval('.categories button', (buttons, name) => buttons.find((button) => button.textContent === name).click(), category.name);
      await settled(page);
      const expected = filterWebProducts(snapshot.products, { category: category.id, pageSize: 12 }).items.map((product) => product.code);
      assert.deepEqual(await codes(page), expected);
    }
  }));

  await scenario('brand and model selection, model reset when changing brand', () => fixture({ mode: 'live' }, async (page) => {
    await ready(page); await page.select('#vehicle-brand', 'EXEED'); await page.select('#vehicle-model', 'TXL');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('model') === 'TXL'); await settled(page);
    assert.deepEqual(await codes(page), filterWebProducts(snapshot.products, { brand: 'EXEED', model: 'TXL', pageSize: 12 }).items.map((product) => product.code));
    await page.select('#vehicle-brand', 'CHERY'); await settled(page); assert.equal(await page.$eval('#vehicle-model', (element) => element.value), '');
  }));

  await scenario('exact article, punctuation normalization, name search and empty state', () => fixture({}, async (page) => {
    await ready(page); await search(page, '501014147AA'); assert.equal((await codes(page))[0], '501014147AA');
    const normalized = snapshot.products.find((product) => /\d/.test(product.code) && product.code.length > 8 && !product.code.includes('-'));
    const query = normalized.code.slice(0, 4) + '-' + normalized.code.slice(4);
    await search(page, query); assert.equal((await codes(page))[0], normalized.code);
    await search(page, 'масляный фильтр'); assert.ok((await codes(page)).length > 0);
    await search(page, 'несуществующаядетальXYZ987654321'); assert.match(await page.$eval('.empty-state', (element) => element.textContent), /Детали не найдены/);
    await page.click('.empty-state button'); await ready(page); assert.equal(new URL(page.url()).searchParams.get('q'), null);
  }));

  await scenario('price sorting, stock filtering, pagination and URL persistence', () => fixture({ mode: 'live' }, async (page) => {
    await ready(page); await page.select('[aria-label="Сортировка деталей"]', 'price-asc'); await page.click('.stock-checkbox input'); await settled(page);
    await page.click('[aria-label="Следующая страница"]'); await page.waitForFunction(() => new URLSearchParams(location.search).get('page') === '2'); await settled(page);
    const expected = filterWebProducts(snapshot.products, { sort: 'price-asc', inStock: true, page: 2, pageSize: 12 }).items.map((product) => product.code);
    assert.deepEqual(await codes(page), expected);
    await page.reload({ waitUntil: 'networkidle0' }); await ready(page); assert.deepEqual(await codes(page), expected);
    assert.equal(await page.$eval('.stock-checkbox input', (element) => element.checked), true);
    await page.click('.reset-button'); await settled(page); assert.equal(new URL(page.url()).searchParams.get('page'), null);
  }));

  await scenario('invalid URL filters and out-of-range pages recover to a usable catalog', () => fixture({ path: '/?brand=UNKNOWN&model=ghost&category=invalid&page=99999&sort=invalid' }, async (page) => {
    await ready(page); assert.equal(await page.$eval('#vehicle-brand', (element) => element.value), ''); assert.equal(await page.$eval('#vehicle-model', (element) => element.value), '');
    assert.equal(new URL(page.url()).searchParams.get('category'), null);
    await page.goto(origin + '/?page=999999', { waitUntil: 'networkidle0' }); await ready(page); assert.equal(new URL(page.url()).searchParams.get('page'), null);
  }));

  await scenario('slow prior search responses cannot overwrite a newer search', () => fixture({ mode: 'live', slowQuery: 'фильтр' }, async (page) => {
    await ready(page); await page.focus('#parts-search'); await page.type('#parts-search', 'фильтр'); await page.keyboard.press('Enter');
    await search(page, 'фара'); await wait(700);
    assert.deepEqual(await codes(page), filterWebProducts(snapshot.products, { query: 'фара', pageSize: 12 }).items.map((product) => product.code));
  }));

  await scenario('cart rapid clicks, maximum quantity, persistence, deletion and total', () => fixture({}, async (page) => {
    await ready(page); const product = snapshot.products.find((item) => item.packQty === 1 && item.stockQty > 10);
    await search(page, product.code); await page.$eval('.product-card .add-button', (button) => { for (let i = 0; i < 20; i++) button.click(); });
    await page.waitForFunction(() => document.querySelector('.basket-button b').textContent === '10');
    await page.reload({ waitUntil: 'networkidle0' }); await ready(page); assert.equal(await page.$eval('.basket-button b', (element) => element.textContent), '10');
    await page.click('.basket-button'); await page.waitForSelector('dialog[open] .bag-line');
    assert.equal(await page.$eval('.quantity-stepper > span', (element) => element.textContent), '10');
    const expectedTotal = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(product.price) * 10);
    assert.equal(await page.$eval('.bag-total strong', (element) => element.textContent), expectedTotal);
    await page.click('[aria-label^="Уменьшить количество"]'); assert.equal(await page.$eval('.quantity-stepper > span', (element) => element.textContent), '9');
    await page.click('[aria-label^="Удалить "]'); await page.waitForSelector('dialog .empty-state'); assert.equal(await page.$eval('.basket-button b', (element) => element.textContent), '0');
  }));

  await scenario('supplier lots and insufficient stock cannot be added incorrectly', () => fixture({}, async (page) => {
    await ready(page); const lot = snapshot.products.find((item) => item.packQty > 1 && item.stockQty >= item.packQty);
    await search(page, lot.code); await page.click('.product-card .add-button'); await page.click('.basket-button'); await page.waitForSelector('dialog[open] .bag-line');
    assert.equal(await page.$eval('.quantity-stepper > span', (element) => element.textContent), String(lot.packQty));
    assert.equal(await page.$eval('[aria-label^="Увеличить количество"]', (element) => element.disabled), true);
    await page.keyboard.press('Escape');
    const unavailable = snapshot.products.find((item) => item.stockQty < item.packQty); await search(page, unavailable.code);
    assert.equal(await page.$eval('.product-card .add-button', (element) => element.disabled), true);
  }));

  await scenario('corrupt local storage and disabled storage do not crash browsing', async () => {
    await fixture({ saved: '{broken' }, async (page) => { await ready(page); assert.equal(await page.$eval('.basket-button b', (element) => element.textContent), '0'); });
    await fixture({ storageBlocked: true }, async (page) => { await ready(page); await page.click('.product-card .add-button:not([disabled])'); await page.waitForFunction(() => Number(document.querySelector('.basket-button b').textContent) > 0); });
  });

  await scenario('reviewed article detail retains configurations and VX FL year with no competitor links', () => fixture({ width: 390, mobile: true, path: '/?part=302001286AA' }, async (page) => {
    await page.waitForSelector('dialog[open] .catalog-applications');
    await page.click('.catalog-applications summary');
    const applications = await page.$$eval('.catalog-applications li', (rows) => rows.map((row) => row.textContent));
    assert.ok(applications.some((text) => /EXEED VX FL/.test(text) && /8AT/.test(text) && /2024/.test(text)));
    assert.equal(await page.$('.catalog-applications a'), null);
    assert.doesNotMatch(await page.$eval('body', (element) => element.textContent), /китайавто|xn--80aagvgd7a1ae/i);
    assert.deepEqual(await page.$$eval('a[href]', (nodes) => nodes.map((node) => node.href).filter((href) => /xn--80aagvgd7a1ae|китайавто/i.test(href))), []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await accessibility(page, 'accessibility-article-source.json');
    await page.screenshot({ path: resolve(output, 'article-source-mobile.png'), fullPage: true });
  }));

  await scenario('reviewed model labels drive live and fallback catalog search', () => fixture({ mode: 'live', path: '/?brand=EXEED&model=VX%20FL&q=302001286AA' }, async (page) => {
    await ready(page);
    assert.equal(await page.$eval('#vehicle-model', (element) => element.value), 'VX FL');
    assert.deepEqual(await codes(page), ['302001286AA']);
    await page.select('#vehicle-brand', 'OMODA'); await settled(page);
    await page.select('#vehicle-model', 'C5'); await settled(page);
    await search(page, '155000158AA');
    assert.deepEqual(await codes(page), ['155000158AA']);
  }));

  for (const mode of ['live', 'snapshot']) {
    await scenario(`manufacturer-reviewed TXL powertrain search and detail in ${mode} mode`, () => fixture({ mode, width: 390, mobile: true, path: '/?brand=EXEED&model=TXL&q=202001630AA&part=202001630AA' }, async (page) => {
      await ready(page);
      assert.deepEqual(await codes(page), ['202001630AA']);
      await page.waitForSelector('dialog[open] .catalog-applications');
      await page.click('.catalog-applications summary');
      const applications = await page.$$eval('.catalog-applications li', (rows) => rows.map((row) => row.textContent));
      assert.ok(applications.some((text) => /EXEED TXL/.test(text) && /M32TFL/.test(text) && /SQRF4J20/.test(text) && /7DCT/.test(text)));
      assert.ok(!applications.some((text) => /EXEED TXL/.test(text) && /SQRF4J16/.test(text)));
      assert.equal(await page.$('.catalog-applications a'), null);
      assert.doesNotMatch(await page.$eval('body', (element) => element.textContent), /китайавто|xn--80aagvgd7a1ae|files\.chery\.ru/i);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.keyboard.press('Escape');
      await search(page, 'SQRF4J20 202001630AA');
      assert.deepEqual(await codes(page), ['202001630AA']);
      await search(page, 'SQRF4J16 202001630AA');
      assert.deepEqual(await codes(page), []);
    }));
  }

  await scenario('detail deep links, sharing, escape and focus restoration', () => fixture({ path: '/?part=501014147AA' }, async (page) => {
    await page.waitForSelector('dialog[open] .detail-code'); assert.equal(await page.$eval('.detail-code', (element) => element.textContent.trim()), '501014147AA');
    await page.click('.web-dialog .button-secondary'); await page.waitForFunction(() => Boolean(window.__qaCopied));
    assert.equal(new URL(await page.evaluate(() => window.__qaCopied)).searchParams.get('part'), '501014147AA');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog')); assert.equal(new URL(page.url()).searchParams.get('part'), null);
    await ready(page); await page.click('.basket-button'); await page.waitForSelector('dialog[open]'); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'basket-button');
    await page.keyboard.press('Enter'); await page.waitForSelector('dialog[open]');
  }));

  await scenario('cart mobile layout, clipboard list, draft link and accessibility', () => fixture({ width: 390, height: 844, mobile: true }, async (page) => {
    await ready(page); await page.tap('.product-card .add-button:not([disabled])'); await page.tap('.basket-button'); await page.waitForSelector('dialog[open] .bag-line');
    await page.click('.web-dialog .button-secondary'); await page.waitForFunction(() => Boolean(window.__qaCopied));
    assert.match(await page.evaluate(() => window.__qaCopied), /Автомобиль \/ VIN/);
    const link = await page.$eval('.web-dialog a.button', (element) => element.href); assert.equal(new URL(link).hostname, 't.me'); assert.ok(new URL(link).searchParams.get('text').length <= 1800);
    assert.ok(await page.$eval('.web-dialog', (element) => element.scrollWidth <= element.clientWidth + 1));
    await page.screenshot({ path: resolve(output, 'cart-mobile.png'), fullPage: true }); await accessibility(page, 'accessibility-cart.json');
  }));

  await scenario('live catalog outage stays visible and retry recovers without stale prices', () => fixture({ mode: 'live' }, async (page, state) => {
    await ready(page); assert.equal(await page.$('.snapshot-notice'), null);
    state.productFailure = true; await search(page, 'фильтр'); await page.waitForSelector('[role="alert"]'); assert.equal(await page.$('.snapshot-notice'), null);
    state.productFailure = false; await page.click('[role="alert"] button'); await ready(page); assert.equal(await page.$('.snapshot-notice'), null);
  }));

  await scenario('missing snapshot has an actionable retry and recovers', () => fixture({ snapshotAvailable: false }, async (page, state) => {
    await page.waitForSelector('[role="alert"]'); state.snapshotAvailable = true; await page.click('[role="alert"] button'); await ready(page);
  }));

  await scenario('malformed metadata falls back; malformed product payload is an error, never NaN', async () => {
    await fixture({ mode: 'invalid-metadata' }, async (page) => { await ready(page); assert.ok(await page.$('.snapshot-notice')); });
    await fixture({ mode: 'live', badProducts: true }, async (page) => { await page.waitForSelector('[role="alert"]'); assert.equal(await page.$('.product-card'), null); assert.doesNotMatch(await page.$eval('body', (element) => element.textContent), /NaN/); });
  });

  await scenario('an unavailable application chunk shows recovery instead of a blank page', () => fixture({ blockChunk: true }, async (page) => {
    await page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('Не удалось открыть каталог'));
    assert.ok(await page.$('button')); assert.match(await page.$eval('body', (element) => element.textContent), /Обновить страницу/);
  }));

  await scenario('help and delivery dialogs work with the keyboard', () => fixture({}, async (page) => {
    await ready(page); await page.click('.help-link'); await page.waitForSelector('dialog[open]'); assert.match(await page.$eval('dialog', (element) => element.textContent), /год, двигатель и комплектацию/); await page.keyboard.press('Escape');
    await page.$eval('.site-footer button', (element) => element.click()); await page.waitForSelector('dialog[open]'); assert.match(await page.$eval('dialog', (element) => element.textContent), /СДЭК/); await page.keyboard.press('Escape');
  }));

  await scenario('mobile map touch and the compact assembly selector stay in sync', () => fixture({ width: 360, height: 800, mobile: true }, async (page) => {
    await ready(page); await page.tap('[aria-label="Показать раздел: Двигатель"]'); await settled(page);
    assert.equal(await page.$eval('.mobile-category select', (element) => element.value), 'engine');
    await page.select('.mobile-category select', 'cooling'); await settled(page);
    assert.match(await page.$eval('#catalog-title', (element) => element.textContent), /Охлаждение и климат/);
    assert.equal(await page.$eval('#parts-search', (element) => getComputedStyle(element).fontSize), '16px');
  }));

  await scenario('a large saved basket keeps a usable draft link and does not overflow', () => {
    const lines = snapshot.products.filter((item) => item.packQty === 1 && item.stockQty >= 1).slice(0, 100).map((product) => ({ product: { ...product, name: `${product.name} ${'Длинное описание детали '.repeat(8)}`, price: '99999999.99' }, quantity: 1 }));
    return fixture({ width: 320, height: 800, mobile: true, saved: JSON.stringify(lines) }, async (page) => {
      await ready(page); await page.click('.basket-button'); await page.waitForSelector('dialog[open]');
      assert.ok(await page.$eval('.web-dialog', (element) => element.scrollWidth <= element.clientWidth + 1));
      const link = await page.$eval('.web-dialog a.button', (element) => element.href); assert.ok(link.length < 1800);
      assert.match(await page.$eval('.web-dialog .button-secondary', (element) => element.textContent), /Скачать список/);
    });
  });

  await scenario('catalog text is escaped and executable image URLs are rejected', () => fixture({ mode: 'live', injectedProduct: { ...snapshot.products[0], name: '<img src=x onerror="window.__unsafe=true">', imageUrl: 'javascript:window.__unsafe=true' } }, async (page) => {
    await ready(page); assert.match(await page.$eval('.product-name', (element) => element.textContent), /<img/);
    await page.click('.product-name'); await page.waitForSelector('dialog[open]');
    assert.equal(await page.$('.detail-image'), null); assert.equal(await page.evaluate(() => window.__unsafe), undefined);
  }));
} finally {
  const report = { generatedAt: new Date().toISOString(), browser: browser ? await browser.version() : executablePath, entrySha256: createHash('sha256').update(await readFile(resolve(dist, 'index.html'))).digest('hex'), passed: results.filter((item) => item.status === 'passed').length, failed: results.filter((item) => item.status === 'failed').length, results };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
  await rm(profile, { recursive: true, force: true });
  console.log(`Browser QA: ${report.passed} passed, ${report.failed} failed. ${resolve(output, 'report.json')}`);
  if (report.failed) process.exitCode = 1;
}
