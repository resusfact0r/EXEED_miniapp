const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { WebCatalogController } = require('../dist/catalog/web-catalog.controller');
const { WebCatalogService } = require('../dist/catalog/web-catalog.service');
const { PrismaService } = require('../dist/prisma/prisma.service');

let app, origin, reads = 0;
before(async () => {
  const module = await Test.createTestingModule({ controllers: [WebCatalogController], providers: [WebCatalogService, {
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
