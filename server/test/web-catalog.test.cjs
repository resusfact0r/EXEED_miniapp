const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { WebCatalogController } = require('../dist/catalog/web-catalog.controller');
const { WebCatalogService } = require('../dist/catalog/web-catalog.service');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { CatalogController } = require('../dist/catalog/catalog.controller');
const { AdminCatalogController } = require('../dist/catalog/admin-catalog.controller');
const { CartController } = require('../dist/cart/cart.controller');
const { OrdersController } = require('../dist/orders/orders.controller');
const { CatalogService } = require('../dist/catalog/catalog.service');
const { CartService } = require('../dist/cart/cart.service');
const { OrdersService } = require('../dist/orders/orders.service');
const { TelegramAuthGuard } = require('../dist/common/guards/telegram-auth.guard');
const { AdminAuthGuard } = require('../dist/common/guards/admin-auth.guard');

let app, origin, reads = 0;
before(async () => {
  const module = await Test.createTestingModule({ controllers: [WebCatalogController, CatalogController, AdminCatalogController, CartController, OrdersController], providers: [WebCatalogService, TelegramAuthGuard, AdminAuthGuard,
    { provide: CatalogService, useValue: {} }, { provide: CartService, useValue: {} }, { provide: OrdersService, useValue: {} }, {
    provide: PrismaService, useValue: { product: { findMany: async (args) => {
      reads++;
      assert.equal(args.where.isActive, true);
      assert.equal(args.select.id, true);
      return [
        { id: 'a', code: 'A001', name: 'Колодки EXEED TXL', price: { toString: () => '500.00' }, stockQty: 3, packQty: 1 },
        { id: 'b', code: 'B002', name: 'Фильтр CHERY TIGGO 7 PRO', price: { toString: () => '600.00' }, stockQty: 20, packQty: 20 },
      ];
    } } },
  }] }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();
});

test('public browsing does not grant access to private cart, orders, admin or Telegram catalog routes', async () => {
  for (const path of ['/api/cart', '/api/orders', '/api/admin/products', '/api/catalog/search']) {
    assert.equal((await fetch(origin + path)).status, 401, path);
  }
  for (const path of ['/api/cart/items', '/api/orders', '/api/admin/products']) {
    assert.equal((await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401, path);
  }
  assert.equal((await fetch(`${origin}/api/admin/products`, { headers: { 'x-admin-token': 'invalid' } })).status, 401);
});

test('malformed paging and search input cannot bypass validation', async () => {
  for (const query of ['page=1.5', 'pageSize=0', 'page=NaN', 'query=' + 'a'.repeat(201), 'brand=' + 'b'.repeat(51)]) {
    assert.equal((await fetch(`${origin}/api/web/products?${query}`)).status, 400, query);
  }
  const response = await fetch(`${origin}/api/web/products?page=2&pageSize=1&sort=price-desc`);
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.total, 2); assert.equal(body.items[0].code, 'A001');
});
after(async () => { await app?.close(); });

test('anonymous catalog exposes only active products and text-derived navigation', async () => {
  const response = await fetch(`${origin}/api/web/catalog`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.total, 2);
  assert.deepEqual(data.brands.map((brand) => brand.name), ['EXEED', 'CHERY']);
});

test('public search validates parameters, composes filters and never returns private account data', async () => {
  const response = await fetch(`${origin}/api/web/products?brand=EXEED&model=TXL&category=brakes&inStock=true&pageSize=12`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.total, 1); assert.equal(data.items[0].code, 'A001');
  for (const suffix of ['pageSize=101', 'page=-1', 'inStock=yes', 'sort=sql', 'unknown=field']) {
    assert.equal((await fetch(`${origin}/api/web/products?${suffix}`)).status, 400);
  }
  assert.equal((await fetch(`${origin}/api/web/products/missing`)).status, 404);
  assert.equal((await fetch(`${origin}/api/web/products/A001`)).status, 200);
  assert.equal((await fetch(`${origin}/api/web/orders`)).status, 404);
  assert.equal(reads, 1, 'repeated requests share a one-minute catalog cache');
});
