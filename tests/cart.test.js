import test from 'node:test';
import assert from 'node:assert/strict';
import { products, shippingOptions, money } from '../src/data/catalog.js';
import { STORAGE_KEY, LEGACY_STORAGE_KEY, normalizeCart, addItem, setQuantity, removeItem, emptyCart, itemCount, subtotal, loadCart, saveCart, reviewCheckout, completeCheckout } from '../src/domain/cart.js';
const id = products[0].id;
const storage = initial => {
  const map = new Map(initial ? [[STORAGE_KEY, initial]] : []);
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
};
test('prices and delivery remain integer cents; BRL is formatted', () => {
  assert.ok(products.filter(product => product.mode === 'ready').every(product => Number.isInteger(product.price)));
  assert.ok(shippingOptions.every(option => Number.isInteger(option.price)));
  const cart = addItem([], id, '', 3);
  assert.equal(subtotal(cart), 8970);
  assert.match(money(2990), /29,90/);
});
test('requires an existing product, valid variant and ready delivery', () => {
  for (const [product, variant] of [[id, null], [id, 'inexistente'], ['fake', ''], [products[5].id, '']]) {
    assert.throws(() => addItem([], product, variant), RangeError);
  }
  assert.equal(addItem([], products[8].id)[0].quantity, 1);
});
test('same option merges, different options stay separate and input is immutable', () => {
  // Synthetic domain fixture only: do not invent selectable options in the actual catalogue.
  const original = products[0].variants;
  products[0].variants = ['opção A', 'opção B'];
  try {
    const first = addItem([], id, 'opção A');
    const second = addItem(first, id, 'opção A', 2);
    const third = addItem(second, id, 'opção B');
    assert.equal(first[0].quantity, 1);
    assert.equal(second[0].quantity, 3);
    assert.equal(third.length, 2);
    assert.equal(itemCount(third), 4);
    assert.throws(() => addItem([], id), RangeError);
  } finally { products[0].variants = original; }
});
test('invalid quantities fail, including zero, floats, strings, infinity and over limit', () => {
  for (const quantity of [0, -1, 1.5, '2', NaN, Infinity, 10, null]) {
    assert.throws(() => addItem([], id, '', quantity), RangeError);
    assert.throws(() => setQuantity(addItem([], id), id, '', quantity), RangeError);
  }
  assert.throws(() => addItem(addItem([], id, '', 9), id), RangeError);
});
test('quantity update, remove and empty do not mutate prior state', () => {
  const original = addItem([], id);
  const changed = setQuantity(original, id, '', 4);
  assert.equal(original[0].quantity, 1);
  assert.equal(subtotal(changed), 11960);
  assert.deepEqual(removeItem(changed, id, ''), []);
  assert.deepEqual(emptyCart(), []);
});
test('storage rejects malformed, wrong version, invalid product and poisoned prices', () => {
  for (const raw of ['oops', 'null', '{"version":3,"items":[]}', '{"version":2,"items":{}}', ' '.repeat(50001)]) assert.deepEqual(loadCart(storage(raw)), []);
  const saved = JSON.stringify({ version: 2, email: 'ignored@example.com', items: [
    { id, variant: '', quantity: 2, price: 1, personal: 'ignored' },
    { id: 'fake', variant: '', quantity: 1 },
    { id, variant: '', quantity: 0 },
    { id: products[5].id, variant: '', quantity: 1 }
  ] });
  const clean = loadCart(storage(saved));
  assert.deepEqual(clean, [{ id, variant: '', quantity: 2 }]);
  assert.equal(subtotal(clean), 5980);
});
test('duplicates from storage are normalized and capped', () => {
  assert.deepEqual(normalizeCart([{ id, variant: '', quantity: 8 }, { id, variant: '', quantity: 8 }]), [{ id, variant: '', quantity: 9 }]);
});
test('storage unavailable/throwing is non-fatal and only cart whitelist is persisted', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadCart(broken), []);
  assert.equal(saveCart(broken, addItem([], id)), false);
  assert.equal(saveCart(undefined, []), false);
  const store = storage();
  assert.equal(saveCart(store, [{ id, variant: '', quantity: 1, email: 'ignored@example.com' }]), true);
  assert.equal(store.getItem(STORAGE_KEY), JSON.stringify({ version: 2, items: [{ id, variant: '', quantity: 1 }] }));
  saveCart(store, []);
  assert.equal(store.getItem(STORAGE_KEY), null);
});
test('checkout refuses empty cart, invalid shipping and invalid payment', () => {
  assert.throws(() => reviewCheckout([]), RangeError);
  assert.throws(() => completeCheckout([]), RangeError);
  const cart = addItem([], id);
  assert.throws(() => reviewCheckout(cart, { shipping: 'fake' }), RangeError);
  assert.throws(() => reviewCheckout(cart, { payment: 'real' }), RangeError);
});
test('each simulated delivery/payment produces exact total and clears cart on completion', () => {
  const cart = addItem(addItem([], id, '', 2), products[8].id);
  for (const shipping of shippingOptions) for (const payment of ['pix', 'card']) {
    const result = completeCheckout(cart, { shipping: shipping.id, payment });
    assert.equal(result.status, 'simulated');
    assert.deepEqual(result.cart, []);
    assert.equal(result.summary.total, 8770 + shipping.price);
    assert.equal(result.summary.count, 3);
    assert.equal(cart.length, 2);
  }
});

test('CHANGE-002: migration removes only the obsolete app key and rejects old product identities', () => {
  const map = new Map([[LEGACY_STORAGE_KEY, '{"version":1,"items":[{"id":"DEMO-FL-001","variant":"P","quantity":2}]}'], ['unrelated', 'keep']]);
  const store = { getItem: key => map.get(key), removeItem: key => map.delete(key) };
  assert.deepEqual(loadCart(store), []);
  assert.equal(map.has(LEGACY_STORAGE_KEY), false);
  assert.equal(map.get('unrelated'), 'keep');
  map.set(STORAGE_KEY, JSON.stringify({ version: 2, items: [{ id: 'DEMO-FL-001', variant: '', quantity: 1 }, { id, variant: '', quantity: 1 }] }));
  assert.deepEqual(loadCart(store), [{ id, variant: '', quantity: 1 }]);
});
