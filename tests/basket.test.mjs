import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypeScript } from '../scripts/load-typescript.mjs';
const { parseSavedBag, addToBag, changeBagQuantity } = await loadTypeScript(new URL('../src/web/basket.ts', import.meta.url));
const product = { id: 'p', code: 'P001', name: 'Тестовая деталь', price: '100.50', stockQty: 100, packQty: 1, categories: ['engine'], brands: [], models: [] };

test('corrupt saved data, negative prices, missing arrays and unsafe quantities cannot break the basket', () => {
  assert.deepEqual(parseSavedBag('{broken'), []);
  assert.deepEqual(parseSavedBag(JSON.stringify([{ product: { ...product, price: '-100' }, quantity: 1 }, { product: { ...product, categories: null }, quantity: 1 }, { product, quantity: 1.5 } ])), []);
});
test('restored duplicates combine without exceeding stock or the ten-piece limit', () => {
  const bag = parseSavedBag(JSON.stringify([{ product, quantity: 8 }, { product, quantity: 8 }]));
  assert.equal(bag.length, 1); assert.equal(bag[0].quantity, 10);
});
test('whole supplier lots are enforced on add, restore and quantity changes', () => {
  const lot = { ...product, packQty: 20, stockQty: 30 };
  assert.equal(addToBag([], lot).bag[0].quantity, 20);
  assert.equal(addToBag(addToBag([], lot).bag, lot).bag[0].quantity, 20);
  assert.deepEqual(changeBagQuantity(addToBag([], lot).bag, lot.code, -1), []);
  assert.equal(parseSavedBag(JSON.stringify([{ product: lot, quantity: 31 }]))[0].quantity, 20);
  assert.deepEqual(addToBag([], { ...lot, stockQty: 19 }).bag, []);
});
test('a sequence of rapid add actions stays within the inventory limit', () => {
  let bag = [];
  for (let i = 0; i < 30; i++) bag = addToBag(bag, { ...product, stockQty: 3 }).bag;
  assert.equal(bag[0].quantity, 3);
  assert.deepEqual(changeBagQuantity([{ product, quantity: 1 }], product.code, -1), []);
});

test('one article can be selected as a central lot and singly from another warehouse', () => {
  const cs = { warehouse: 'cs', warehouseName: 'Склад ЦС', price: '100.00', stockQty: 40, packQty: 20 };
  const opt2 = { warehouse: 'msk-opt-2', warehouseName: 'Склад 2 (Chery)', price: '120.00', stockQty: 4, packQty: 1 };
  const bag = addToBag(addToBag([], product, cs).bag, product, opt2).bag;
  assert.deepEqual(bag.map(({ warehouse, quantity }) => [warehouse, quantity]), [['cs', 20], ['msk-opt-2', 1]]);
  const restored = parseSavedBag(JSON.stringify(bag));
  assert.equal(changeBagQuantity(restored, product.code, 1, opt2.warehouse)[1].quantity, 2);
  assert.equal(changeBagQuantity(restored, product.code, -1, cs.warehouse)[0].warehouse, opt2.warehouse);
});
