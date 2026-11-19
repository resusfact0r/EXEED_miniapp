const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { PriceSyncModule } = require('../dist/price-sync/price-sync.module');
const { PriceSyncService } = require('../dist/price-sync/price-sync.service');
const { CatalogModule } = require('../dist/catalog/catalog.module');
const { WebCatalogService } = require('../dist/catalog/web-catalog.service');
const { importPriceList } = require('../dist/price-sync/import-price-list');
const XLSX = require('xlsx');
const { WebCheckoutModule } = require('../dist/web-checkout/module');
const { WebOrders } = require('../dist/web-checkout/service');
const { PrismaModule } = require('../dist/prisma/prisma.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { AvtoligaService } = require('../dist/avtoliga/avtoliga.service');

// Isolated PostgreSQL cluster. Never run migrations or fixtures against an existing DATABASE_URL.
test('HTTP guest orders, owner isolation and idempotency against a migrated PostgreSQL database', async (t) => {
  let bin;
  try {
    bin =
      process.env.CHECKOUT_TEST_PG_BIN ||
      execFileSync('pg_config', ['--bindir'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    fs.accessSync(path.join(bin, 'initdb'));
  } catch {
    if (process.env.GITHUB_ACTIONS) throw Error('PostgreSQL is required for checkout CI');
    t.skip('PostgreSQL server tools unavailable');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exeed-checkout-'));
  let started = false,
    app;
  const port = 40000 + Math.floor(Math.random() * 14000);
  const dbUrl = 'postgresql://tester@localhost:' + port + '/postgres?host=' + encodeURIComponent(dir);
  try {
    execFileSync(
      path.join(bin, 'initdb'),
      ['-D', path.join(dir, 'data'), '-U', 'tester', '-A', 'trust', '--no-locale', '--encoding=UTF8'],
      { stdio: 'pipe' },
    );
    execFileSync(
      path.join(bin, 'pg_ctl'),
      [
        '-D',
        path.join(dir, 'data'),
        '-l',
        path.join(dir, 'log'),
        '-o',
        "-c listen_addresses='' -k " + dir + ' -p ' + port,
        '-w',
        'start',
      ],
      { stdio: 'pipe' },
    );
    started = true;
    process.env.DATABASE_URL = dbUrl;
    delete process.env.ORDER_NOTIFY_CHAT_IDS;
    delete process.env.AVTOLIGA_CS_STORE_ID;
    process.env.ADMIN_API_TOKEN = 'test-admin';
    process.env.PRICE_SYNC_ENABLED = 'false';
    process.env.AVTOLIGA_MARKUP_PERCENT = '14';
    const prisma = path.resolve('node_modules/.bin/prisma');
    const beforeUpgrade = path.join(dir, 'before-upgrade');
    fs.cpSync(path.resolve('prisma'), beforeUpgrade, {
      recursive: true,
      filter: (name) => {
        const entry = path.basename(name);
        return !/^\d{14}_/.test(entry) || entry < '20261118000200';
      },
    });
    const oldSchema = path.join(beforeUpgrade, 'schema.prisma');
    execFileSync(prisma, ['migrate', 'deploy', '--schema', oldSchema], { stdio: 'pipe' });
    execFileSync(prisma, ['db', 'execute', '--schema', oldSchema, '--stdin'], {
      stdio: 'pipe',
      input: `INSERT INTO "Product" (id, code, name, price, "stockQty", "packQty", "updatedAt")
              VALUES ('before-upgrade', 'WARE-LEGACY', 'Позиция до миграции', 123.45, 40, 20, NOW());`,
    });
    execFileSync(prisma, ['migrate', 'deploy'], { stdio: 'pipe' });
    const module = await Test.createTestingModule({ imports: [WebCheckoutModule, CatalogModule, PriceSyncModule, PrismaModule] })
      .overrideProvider(AvtoligaService)
      .useValue({
        getLivePrices: async () => new Map([['WEBTEST', { price: 399, stockQty: 2, packQty: 1 }]]),
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const db = app.get(PrismaService);
    const previousOffer = await db.warehouseOffer.findUnique({ where: {
      productId_warehouseCode: { productId: 'before-upgrade', warehouseCode: 'cs' },
    } });
    assert.equal(previousOffer.price.toString(), '123.45');
    assert.equal(previousOffer.stockQty, 40);
    assert.equal(previousOffer.packQty, 20);
    await db.product.create({ data: { code: 'WEBTEST', name: 'Тестовая деталь', price: 399, stockQty: 2 } });
    const key = randomBytes(32).toString('hex'),
      headers = { 'x-order-key': key, 'Content-Type': 'application/json' };
    const dto = {
      name: 'Тест Покупатель',
      phone: '+79990001122',
      exactArticle: true,
      method: 'pickup',
      consent: true,
      lines: [{ code: 'WEBTEST', quantity: 1 }],
    };
    const post = (body) =>
      fetch(origin + '/web/checkout/orders', { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal((await post({ ...dto, price: 1 })).status, 400);
    const replies = await Promise.all([post(dto), post(dto)]);
    for (const r of replies) assert.equal(r.status, 201);
    assert.equal(await db.webOrder.count(), 1);
    const order = await replies[0].json();
    assert.equal(order.goodsCents, 39900);
    assert.equal(order.state, 'QUOTED');
    assert.ok(!('accessHash' in order));
    assert.ok(!('phone' in order));
    assert.equal((await fetch(origin + '/web/checkout/order', { headers })).status, 200);
    assert.equal(
      (
        await fetch(origin + '/web/checkout/order', {
          headers: { 'x-order-key': randomBytes(32).toString('hex') },
        })
      ).status,
      404,
    );
    assert.equal((await fetch(origin + '/admin/web-orders')).status, 401);
    await app.get(WebOrders).sync();
    await t.test('supplier price snapshots, exact analogue links and the chosen warehouse survive into the order', () =>
      exerciseCatalog({ app, origin, db, dto }),
    );
    await t.test('mail attachment preview and confirmation link a distinct warehouse and preserve the central feed', () =>
      exerciseMail({ app, origin, db }),
    );
  } finally {
    if (app) await app.close();
    if (started)
      execFileSync(
        path.join(bin, 'pg_ctl'),
        ['-D', path.join(dir, 'data'), '-m', 'immediate', '-w', 'stop'],
        { stdio: 'pipe' },
      );
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function exerciseCatalog({ app, origin, db, dto }) {
  const token = { 'x-admin-token': 'test-admin' };
  const json = { ...token, 'Content-Type': 'application/json' };
  const catalog = app.get(WebCatalogService);
  const orders = app.get(WebOrders);
  const spreadsheet = (rows) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Прайс');
    return XLSX.write(book, { bookType: 'xlsx', type: 'buffer' });
  };
  const head = ['Артикул', 'Наименование', 'Цена', 'Остаток', 'Минимальная партия', 'Бренд'];
  const central = spreadsheet([head, ['WARE-001AA', 'Фильтр', 100, 40, 20, 'CHERY']]);
  const msks = spreadsheet([head,
    ['ware-001aa', 'Имя из прайса склада 2', 150, 4, 1, 'CHERY'],
    ['G-01', 'Позиция другого бренда', 111, 1, 1, 'GEELY'],
  ]);
  const mail = (messageId, receivedAt) => ({ source: 'email', messageId, receivedAt: new Date(receivedAt) });
  assert.equal((await importPriceList(db, central, mail('cs-latest', '2026-11-18T12:00:00Z'), { snapshot: false })).status, 'APPLIED');
  assert.equal((await importPriceList(db, msks, mail('second-feed', '2026-11-18T11:00:00Z'), { warehouseCode: 'msk-opt-2' })).status, 'APPLIED');
  assert.equal((await importPriceList(db, central, mail('cs-delayed', '2026-11-18T11:00:00Z'))).status, 'SKIPPED');
  assert.equal((await importPriceList(db, msks, mail('second-feed', '2026-11-18T11:00:00Z'), { warehouseCode: 'msk-opt-2' })).status, 'APPLIED');
  assert.equal(await db.priceImport.count({ where: { messageId: 'second-feed' } }), 1);
  assert.equal(await db.product.count({ where: { code: 'G-01' } }), 0);
  assert.equal(await db.product.count({ where: { code: { equals: 'ware-001aa', mode: 'insensitive' } } }), 1);

  const readProduct = async (code) => {
    const response = await fetch(origin + '/web/products/' + code);
    assert.equal(response.status, 200);
    return response.json();
  };
  const updateLegacy = { price: 222, stockQty: 5, packQty: 1 };
  await db.product.update({ where: { code: 'WARE-001AA' }, data: updateLegacy });
  catalog.invalidate();
  const product = await readProduct('WARE-001AA');
  assert.equal(product.name, 'Фильтр');
  assert.deepEqual(product.offers.map((o) => [o.warehouse, +o.price, o.stockQty, o.packQty]), [
    ['cs', 114, 40, 20], ['msk-opt-2', 174, 4, 1],
  ]);
  assert.ok(product.offers.every((o) => !('cost' in o) && !('extraMarkup' in o)));
  await assert.rejects(orders.price([{ code: 'WARE-001AA', warehouse: 'cs', quantity: 1 }]), { status: 409 });
  await assert.rejects(orders.price([{ code: 'WARE-001AA', warehouse: 'another-stock', quantity: 1 }]), { status: 409 });
  const key = randomBytes(32).toString('hex');
  const purchase = {
    ...dto, lines: [
      { code: 'WARE-001AA', warehouse: 'cs', quantity: 20 },
      { code: 'WARE-001AA', warehouse: 'msk-opt-2', quantity: 1 },
    ],
  };
  const placed = await fetch(origin + '/web/checkout/orders', {
    method: 'POST', headers: { 'x-order-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(purchase),
  });
  assert.equal(placed.status, 201, placed.status === 201 ? '' : await placed.text());
  const newOrder = await placed.json();
  assert.equal(newOrder.state, 'REVIEW');
  assert.deepEqual(newOrder.items.map((i) => [i.warehouse, i.quantity, i.cents]), [['cs', 20, 11400], ['msk-opt-2', 1, 17400]]);
  const approve = await fetch(origin + '/admin/web-orders/' + newOrder.number + '/approve', {
    method: 'POST', headers: json, body: '{"confirmed":true}',
  });
  assert.equal(approve.status, 201);
  assert.equal((await approve.json()).goodsCents, 245400);

  assert.equal((await fetch(origin + '/admin/catalog/cards')).status, 401);
  const cardBody = {
    code: 'ALT-01', name: 'Аналог фильтра', description: 'Описание',
    originalArticles: ['ware-001aa'],
    images: ['https://example.invalid/alt-1.webp', 'https://example.invalid/alt-2.webp'],
    storeOffer: { price: 75, stockQty: 0 },
  };
  const createCard = await fetch(origin + '/admin/catalog/cards', {
    method: 'POST', headers: json, body: JSON.stringify(cardBody),
  });
  assert.equal(createCard.status, 201, createCard.status === 201 ? '' : await createCard.text());
  const manual = await createCard.json();
  assert.equal(manual.images.length, 2);
  const hiddenStock = await readProduct('ALT-01');
  assert.equal(hiddenStock.stockQty, 0);
  assert.deepEqual(hiddenStock.originalArticles, ['WARE-001AA']);
  assert.equal((await fetch(origin + '/admin/catalog/cards/' + manual.id, {
    method: 'PUT', headers: json, body: JSON.stringify({
      name: 'Аналог фильтра (готово)', description: 'Обновили', originalArticles: manual.originalArticles,
      images: manual.images, storeOffer: { price: 85, stockQty: 5 }, version: manual.updatedAt,
    }),
  })).status, 200);
  assert.equal((await readProduct('ALT-01')).stockQty, 5);

  const addWarehouse = await fetch(origin + '/admin/catalog/warehouses', {
    method: 'POST', headers: json, body: JSON.stringify({ code: 'other', name: 'Другой склад', extraMarkup: 5, defaultPackQty: 1 }),
  });
  assert.equal(addWarehouse.status, 201);
  const upload = (route, bytes, name) => {
    const data = new FormData();
    data.set('file', new Blob([bytes]), name);
    return fetch(origin + '/admin/catalog/' + route, { method: 'POST', headers: token, body: data });
  };
  const stock = 'Артикул;Наименование;Цена;Остаток;Артикул оригинала\n00789;Новая деталь;250;2;OEM-2';
  const stockImport = await upload('warehouses/other/import', stock, 'prices.csv');
  assert.equal(stockImport.status, 201, stockImport.status === 201 ? '' : await stockImport.text());
  assert.equal((await readProduct('00789')).offers[0].price, '297.50');
  assert.deepEqual((await readProduct('00789')).originalArticles, ['OEM-2']);
  const analogsImport = await upload('analogues/import', 'Артикул оригинала;Артикул аналога\nOEM-3;ALT-01\nOEM-4;ALT-01', 'links.csv');
  assert.equal(analogsImport.status, 201);
  assert.deepEqual((await readProduct('ALT-01')).originalArticles, ['OEM-3', 'OEM-4', 'WARE-001AA']);
  assert.equal((await catalog.search({ query: 'oem-3' })).items[0].code, 'ALT-01');
  assert.equal((await catalog.search({ query: 'oem-30' })).total, 0);
  assert.deepEqual((await catalog.search({ query: 'ware-001aa' })).items.map((item) => item.code), ['WARE-001AA', 'ALT-01']);
  const xlsx = await fetch(origin + '/admin/catalog/analogues.xlsx', { headers: token });
  assert.equal(xlsx.status, 200);
  const exported = XLSX.read(Buffer.from(await xlsx.arrayBuffer()));
  assert.equal(XLSX.utils.sheet_to_json(exported.Sheets[exported.SheetNames[0]]).length, 4);

  const replacement = spreadsheet([head, ['WARE-002AA', 'Деталь', 100, 1, 1, 'CHERY']]);
  assert.equal((await importPriceList(db, replacement, { source: 'file' }, { warehouseCode: 'msk-opt-2' })).hidden, 1);
  catalog.invalidate();
  assert.deepEqual((await readProduct('WARE-001AA')).offers.map((o) => o.warehouse), ['cs']);
  await assert.rejects(orders.price([{ code: 'WARE-001AA', warehouse: 'msk-opt-2', quantity: 1 }]), { status: 409 });
}

async function exerciseMail({ app, origin, db }) {
  const headers = { 'x-admin-token': 'test-admin', 'Content-Type': 'application/json' };
  const service = app.get(PriceSyncService);
  process.env.PRICE_IMAP_USER = 'store@example.invalid';
  process.env.PRICE_IMAP_PASSWORD = 'fixture';
  process.env.PRICE_MAIL_FROM = 'vendor@example.invalid';
  process.env.PRICE_MAIL_SUBJECT = 'прайс';
  process.env.PRICE_SYNC_ENABLED = 'true';
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Артикул', 'Наименование', 'Цена', 'Склад Geely ЦС'],
    ['GE-008', 'Запчасть Geely', 125, 8],
  ]), 'Товары');
  const encoded = XLSX.write(book, { bookType: 'xlsx', type: 'base64' });
  const source = Buffer.from([
    'From: vendor@example.invalid',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="check"',
    '',
    '--check',
    'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="geely.xlsx"',
    'Content-Disposition: attachment; filename="geely.xlsx"',
    'Content-Transfer-Encoding: base64',
    '',
    encoded,
    '--check--',
  ].join('\r\n'));
  const messageDate = new Date('2026-11-19T11:30:01.000Z');
  service.createClient = () => ({
    connect: async () => {},
    list: async () => [],
    mailboxOpen: async (_folder, options) => assert.equal(options.readOnly, true),
    search: async (options) => { assert.equal(options.from, 'vendor@example.invalid'); return [7]; },
    fetch: async function* () {
      yield { uid: 7, internalDate: messageDate, envelope: {
        messageId: '<geely-fixture@vendor.example.invalid>',
        from: [{ address: 'vendor@example.invalid' }], subject: 'Прайс. Склад Geely ЦС от 19.11.2026',
      }};
    },
    fetchOne: async () => ({ source }),
    logout: async () => {},
  });
  const post = (endpoint, payload) => fetch(origin + '/admin/catalog/mail/' + endpoint, {
    method: 'POST', headers, body: JSON.stringify(payload),
  });
  const rules = { warehouseCode: 'geely-cs', subjects: ['Склад Geely ЦС'], columns: { stock: 'Склад Geely ЦС' } };
  assert.equal((await fetch(origin + '/admin/catalog/mail')).status, 401);
  await service.runOnce();
  assert.equal(await db.product.count({ where: { code: 'GE-008' } }), 0, 'central fallback must never import the Geely file');
  const inspected = await post('preview', rules);
  assert.equal(inspected.status, 201, inspected.status === 201 ? '' : await inspected.text());
  const preview = await inspected.json();
  assert.equal(preview.fileName, 'geely.xlsx');
  assert.equal(preview.parsed.articles, 1);
  assert.equal(preview.parsed.available, 1);
  assert.equal(await db.product.count({ where: { code: 'GE-008' } }), 0, 'preview only reads the file');
  assert.equal((await post('connect', { ...rules, previewId: 'a'.repeat(64) })).status, 409);
  const connected = await post('connect', { ...rules, previewId: preview.previewId });
  assert.equal(connected.status, 201, connected.status === 201 ? '' : await connected.text());
  assert.equal((await connected.json()).status, 'APPLIED');
  assert.equal((await db.warehouse.findUnique({ where: { code: 'geely-cs' } })).mailSubjects[0], 'склад geely цс');
  const log = await fetch(origin + '/admin/catalog/imports?warehouse=geely-cs', { headers }).then((res) => res.json());
  assert.deepEqual(log.map((row) => [row.fileName, row.warehouseCode]), [['geely.xlsx', 'geely-cs']]);
  assert.equal((await db.warehouseOffer.findMany({ where: { warehouseCode: 'geely-cs' } }))[0].stockQty, 8);
}
