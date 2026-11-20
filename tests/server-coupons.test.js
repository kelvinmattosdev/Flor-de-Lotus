import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCoupons } from '../server/coupons.js';

const row = (productId, subtotalCents, categoryId = 'CHILD') =>
  ({productId, variant: '', subtotalCents, categoryId, ancestorIds: [categoryId, 'ROOT']});
const rule = (code, more = {}) => ({id: code, code, scope: 'GLOBAL', minimum: 0, percent: 0, ceiling: null,
  free_shipping: 0, stackable: 1, active: 1, ...more});
const run = (lines, coupons, pairs = {}, shipping = 1890) =>
  calculateCoupons(lines, shipping, coupons.map(entry => entry.code), {records: coupons, pairs: new Map(Object.entries(pairs))});

test('coupons: scoped pre-coupon minimum, explicit pairs and one shipping tariff', () => {
  const product = rule('PRODUCT', {scope: 'PRODUCT', listing_id: 'PIECE', percent: 2000, ceiling: 1500});
  const category = rule('CATEGORY', {scope: 'CATEGORY', category_id: 'ROOT', descendants: 1, minimum: 10000, percent: 1000});
  const delivery = rule('SHIP', {free_shipping: 1});
  const duplicate = rule('ZSHIP', {free_shipping: 1});
  const closedPair = rule('BLOCK', {percent: 300});
  const pairs = {'CATEGORY:PRODUCT': 'ALLOW', 'PRODUCT:SHIP': 'ALLOW', 'CATEGORY:SHIP': 'ALLOW',
    'PRODUCT:ZSHIP': 'ALLOW', 'CATEGORY:ZSHIP': 'ALLOW', 'SHIP:ZSHIP': 'ALLOW',
    'BLOCK:PRODUCT': 'DENY', 'BLOCK:CATEGORY': 'ALLOW', 'BLOCK:SHIP': 'ALLOW'};
  const actual = run([row('PIECE', 10000)], [duplicate, closedPair, delivery, product, category], pairs);
  assert.deepEqual(actual.appliedCoupons, [
    {code: 'PRODUCT', merchDiscountCents: 1500, shippingDiscountCents: 0},
    {code: 'CATEGORY', merchDiscountCents: 850, shippingDiscountCents: 0},
    {code: 'SHIP', merchDiscountCents: 0, shippingDiscountCents: 1890}
  ]);
  assert.equal(10000 - actual.merchDiscountCents + 1890 - actual.shippingDiscountCents, 7650);
  assert.deepEqual(actual.rejectedCoupons, [{code: 'ZSHIP', reason: 'NOT_SELECTED'}, {code: 'BLOCK', reason: 'INCOMPATIBLE'}]);
});

test('coupons: category can be exact, minimum ignores unrelated goods and freight, inclusive cap', () => {
  const items = [row('PIECE', 2000), row('OTHER', 5500, 'OTHER')];
  const exact = rule('EXACT', {scope: 'CATEGORY', category_id: 'ROOT', descendants: 0, percent: 5000});
  const scoped = rule('ELIGIBLE', {scope: 'PRODUCT', listing_id: 'PIECE', minimum: 2001, free_shipping: 1});
  const invalid = run(items, [exact, scoped, rule('OFF', {active: 0})]);
  assert.deepEqual(invalid.rejectedCoupons, [{code:'EXACT', reason:'SCOPE_MISMATCH'},
    {code:'ELIGIBLE', reason:'MINIMUM_NOT_MET'}, {code:'OFF', reason:'UNAVAILABLE'}]);
  const pass = run(items, [{...scoped, minimum: 2000, percent: 10000, ceiling: 700}]);
  assert.deepEqual(pass.lineDiscounts, [700, 0]);
  assert.equal(pass.shippingDiscountCents, 1890);
});

test('coupons: same saving prefers fewer codes and ASCII; absent pair and exclusive win over ALLOW', () => {
  const five = rule('ABCDE', {percent: 500});
  const first = rule('AONLY', {percent: 900, stackable: 0});
  const second = rule('ZONLY', {percent: 900, stackable: 0});
  const other = rule('SECOND', {percent: 500});
  assert.deepEqual(run([row('PIECE', 100)], [five, second, first, other], {
    'ABCDE:SECOND': 'ALLOW', 'AONLY:SECOND': 'ALLOW'
  }).appliedCoupons.map(entry => entry.code), ['AONLY']);
  const biggest = rule('BIG', {percent: 900});
  assert.deepEqual(run([row('PIECE', 1000)], [biggest, other]).appliedCoupons.map(entry => entry.code), ['BIG']);
});

test('coupons: integer floor, largest remainder and allocation at maximum basket size', () => {
  const half = rule('HALF', {percent: 5000});
  const fractional = run([row('B', 1), row('A', 1), row('C', 1)], [half], {}, 0);
  assert.deepEqual(fractional.lineDiscounts, [0, 1, 0]);
  assert.equal(fractional.merchDiscountCents, 1);
  const large = Array.from({length: 40}, (_, i) => row(`X${i}`, 90_000_000));
  const full = run(large, [rule('FULL', {percent: 10000}), half], {'FULL:HALF': 'ALLOW'}, 0);
  assert.equal(full.merchDiscountCents, 3_600_000_000);
  assert.ok(full.lineDiscounts.every(amount => amount === 90_000_000));
  assert.deepEqual(full.appliedCoupons.map(entry => entry.code), ['FULL']);
});
