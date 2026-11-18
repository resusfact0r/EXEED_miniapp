const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WebOrders } = require('../dist/web-checkout/service');
const { Bank, Shipping } = require('../dist/web-checkout/providers');
const key = 'ab'.repeat(32);
function fixture() {
  const records = new Map();
  let clock = 0;
  const matches = (o, w) => Object.entries(w).every(([k, v]) => o[k] === v);
  const find = async ({ where }) => [...records.values()].find((row) => matches(row, where)) ?? null;
  const db = {
    product: { findMany: async () => [{ code: 'SKU', name: 'Деталь', isActive: true, offers: [] }] },
    webOrder: {
      findUnique: find,
      findUniqueOrThrow: find,
      create: async ({ data }) => {
        const row = { ...data, number: 1, attempt: 1, updatedAt: ++clock };
        records.set(1, row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        const o = await find({ where });
        if (!o || !matches(records.get(1), where)) return { count: 0 };
        records.set(1, {
          ...o,
          ...data,
          attempt: data.attempt?.increment ? o.attempt + 1 : o.attempt,
          updatedAt: ++clock,
        });
        return { count: 1 };
      },
    },
  };
  const supply = {
    price: 123.45,
    getLivePrices: async () => new Map([['SKU', { price: supply.price, packQty: 1, stockQty: 2 }]]),
  };
  const payment = {
    id: '11111111-1111-4111-a111-111111111111',
    test: true,
    amount: { value: '123.45', currency: 'RUB' },
    metadata: { order: 'W1', attempt: '1' },
    paid: false,
    status: 'pending',
    confirmation: { confirmation_url: 'https://yoomoney.ru/test' },
  };
  const bank = new Bank();
  bank.ready = () => true;
  bank.create = async () => payment;
  bank.find = async () => payment;
  const ship = {
    pointsAvailable: () => true,
    cdek: { getAllPvzForCity: async () => [{ id: 'PVZ', address: 'Пункт 1' }] },
    configured: () => true,
    quote: async () => 40000,
    validateMode: () => {},
    calls: 0,
    create: async () => {
      ship.calls++;
      throw Error('connection lost after acceptance');
    },
    lookup: async () => ({
      uuid: 'abc',
      number: 'EXEED-W1',
      cdek_number: '123',
      statuses: [{ code: 'CREATED', date_time: '2026-11-17' }],
    }),
  };
  const service = new WebOrders(db, supply, bank, ship);
  const dto = {
    lines: [{ code: 'SKU', quantity: 1 }],
    name: 'Тест Тестов',
    phone: '+79990000000',
    exactArticle: true,
    method: 'pickup',
    consent: true,
  };
  return { service, dto, supply, payment, ship };
}
test('guest checkout freezes the quote, replays one order and verifies bank money before release', async () => {
  process.env.YOOKASSA_MODE = 'test';
  const { service: s, dto, supply, payment } = fixture();
  assert.equal((await s.create(key, dto)).number, 1);
  assert.equal((await s.create(key, dto)).number, 1);
  await assert.rejects(s.create(key, { ...dto, name: 'Другой человек' }));
  await assert.rejects(s.guest('ef'.repeat(32)));
  supply.price = 200;
  await assert.rejects(s.pay(key, 12345));
  assert.equal((await s.guest(key)).goodsCents, 20000);
  await assert.rejects(s.pay(key, 12345));
  payment.amount.value = '200.00';
  assert.equal((await s.pay(key, 20000)).state, 'PAYMENT');
  await s.payment(payment.id);
  assert.equal((await s.guest(key)).state, 'PAYMENT');
  payment.paid = true;
  payment.status = 'succeeded';
  payment.amount.value = '1.00';
  await s.payment(payment.id);
  assert.equal((await s.guest(key)).state, 'PAYMENT');
  payment.amount.value = '200.00';
  await s.payment(payment.id);
  await s.payment(payment.id);
  assert.equal((await s.packed(1)).state, 'PICKUP_READY');
  assert.equal((await s.complete(1)).state, 'DONE');
});
test('VIN and unknown packaging hold payment, carrier timeout is reconciled without creating a duplicate shipment', async () => {
  process.env.YOOKASSA_MODE = 'test';
  const { service: s, dto, payment, ship } = fixture();
  const order = await s.create(key, {
    ...dto,
    method: 'cdek',
    city: 44,
    point: 'PVZ',
    exactArticle: false,
    vin: 'X1234567890123456',
  });
  assert.equal(order.deliveryCents, null);
  assert.equal(order.state, 'REVIEW');
  await assert.rejects(s.pay(key, 12345));
  const parcel = { weight: 1500, length: 15, width: 20, height: 10, itemGrams: [1000] };
  await assert.rejects(s.approve(1, { confirmed: true, parcel: { ...parcel, weight: 500 } }));
  assert.equal((await s.approve(1, { confirmed: true, parcel })).deliveryCents, 40000);
  payment.amount.value = '523.45';
  await s.pay(key, 52345);
  payment.status = 'succeeded';
  payment.paid = true;
  await s.payment(payment.id);
  await assert.rejects(s.packed(1));
  await assert.rejects(s.packed(1));
  assert.equal(ship.calls, 1);
  await s.track(await s.byNumber(1));
  assert.equal((await s.guest(key)).tracking, '123');
});
test('carrier receives actual parcel dimensions and prepaid items; payment retries reuse one key', async () => {
  process.env.YOOKASSA_MODE = 'test';
  process.env.YOOKASSA_SHOP_ID = '123';
  process.env.YOOKASSA_SECRET_KEY = 'test_fixture';
  process.env.YOOKASSA_RECEIPTS = 'provider';
  process.env.YOOKASSA_VAT_CODE = '1';
  const original = global.fetch;
  const requests = [];
  global.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response('{}', { status: 200 });
  };
  const o = {
    number: 12,
    attempt: 2,
    phone: '+79990000000',
    goodsCents: 20000,
    deliveryCents: 34500,
    items: [{ code: 'SKU', name: 'Фара', quantity: 2, cents: 10000 }],
    point: 'MSK1',
    parcel: { weight: 1350, width: 20, length: 30, height: 10, itemGrams: [500] },
  };
  try {
    const bank = new Bank();
    await bank.create(o);
    await bank.create(o);
    assert.equal(requests[0].init.headers['Idempotence-Key'], requests[1].init.headers['Idempotence-Key']);
    const body = JSON.parse(requests[0].init.body);
    assert.equal(body.amount.value, '545.00');
    assert.equal(body.receipt.items.length, 2);
    let shipment;
    const shipping = new Shipping({
      carrier: async (path, init) => {
        shipment = JSON.parse(init.body);
        return new Response(JSON.stringify({ entity: { uuid: 'accepted' } }));
      },
    });
    await shipping.create(o);
    assert.equal(shipment.packages[0].weight, 1350);
    assert.equal(shipment.packages[0].items[0].weight, 500);
    assert.equal(shipment.packages[0].items[0].payment.value, 0);
  } finally {
    global.fetch = original;
  }
});

test('mail routing reserves МСК ОПТ-2 even while its reader is disabled', () => {
  const { mailRoutes, routeMail } = require('../dist/price-sync/mail-routing');
  const rules = mailRoutes({ PRICE_MAIL_FROM: 'parts@example.invalid', PRICE_MAIL_SUBJECT: 'прайс' });
  const second = routeMail(['parts@EXAMPLE.INVALID'], 'Прайс · МСК  ОПТ — 2', rules);
  assert.equal(second.warehouseCode, 'msk-opt-2');
  assert.equal(second.enabled, false);
  assert.equal(routeMail(['parts@example.invalid'], 'Прайс ЦС', rules).warehouseCode, 'cs');
  assert.equal(routeMail(['parts@example.invalid.evil.invalid'], 'Прайс ЦС', rules), undefined);
});

test('the chosen central store is verified by StoreId before considering price or stock', async (t) => {
  const { AvtoligaService } = require('../dist/avtoliga/avtoliga.service');
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  globalThis.fetch = async () => ({
    json: async () => ({ Status: 1, SpareParts: [{
      Articul: 'PART', Vendor: 'CHERY', Prices: [
        { StoreId: 'central-warehouse', Count: 40, InPackage: 20, Price: 50 },
        { StoreId: 'supplier-warehouse', Count: 80, InPackage: 1, Price: 25 },
      ],
    }] }),
  });
  const service = new AvtoligaService();
  const result = await service.getLivePrices(['PART'], { PART: 20 }, 'central-warehouse');
  assert.equal(result.get('PART').stockQty, 40);
  assert.equal(result.get('PART').packQty, 20);
  assert.equal((await service.getLivePrices(['PART'], { PART: 1 }, 'unknown')).size, 0);
});
