import assert from 'node:assert/strict';
import {test} from 'node:test';
import {categoryGraph, couponLimit, decimal, diff, galleryFields, money, nextStatus, normalizedCode,
  percent, productLimit, safePhoto, unitsFromDecimal} from '../src/operador/domain.js';

test('BRL and percentage use two decimal digits and integer minor units', () => {
  assert.equal(unitsFromDecimal('100,01', {max: productLimit}), 10001);
  assert.equal(unitsFromDecimal('000,29', {max: productLimit}), 29);
  assert.equal(unitsFromDecimal(' 10.35 ', {max: 10000}), 1035);
  assert.equal(unitsFromDecimal('20,5', {max: 10000}), 2050);
  assert.equal(unitsFromDecimal('100', {max: 10000}), 10000);
  assert.equal(unitsFromDecimal('100,01', {max: 10000}), undefined);
  assert.equal(unitsFromDecimal('36000000,00', {max: couponLimit}), couponLimit);
  assert.equal(unitsFromDecimal('36000000,01', {max: couponLimit}), undefined);
  assert.equal(unitsFromDecimal('', {max: couponLimit, blank: 0}), 0);
  assert.equal(unitsFromDecimal('', {max: couponLimit, min: 1, blank: null}), null);
  for (const value of ['1.234,56', '1e2', 'NaN', '1,005', '-0,5', '2.', 'R$ 15,00']) {
    assert.equal(unitsFromDecimal(value, {max: couponLimit}), undefined);
  }
  assert.equal(decimal(5), '0,05');
  assert.equal(decimal(null), '');
  assert.match(money(7650), /^R\$\s76,50$/u);
  assert.equal(percent(2010), '20,1%');
});

test('partial PATCH diff preserves explicit clears, exact galleries and false', () => {
  const image = {id: 'a', alt: 'Flor', label: 'Frente', src: '/ignorar', width: 30};
  const next = galleryFields([{...image, label: 'Detalhe'}]);
  const previous = {name: 'Peça', active: true, compareAtPriceCents: 12000, images: galleryFields([image]), variants: ['A']};
  const values = {name: 'Peça', active: false, compareAtPriceCents: null, images: next, variants: []};
  assert.deepEqual(diff(previous, values),
    {active: false, compareAtPriceCents: null, images: [{id: 'a', alt: 'Flor', label: 'Detalhe'}], variants: []});
  assert.deepEqual(diff(values, {...values, images: [...next]}), {});
  assert.deepEqual(diff({images: next}, {images: []}), {images: []});
});

test('tree resolves labels, descendants, ancestors, and rejects broken ancestry', () => {
  const graph = categoryGraph([
    {id: 'a', parentId: null, name: 'Raiz', active: false},
    {id: 'b', parentId: 'a', name: 'Nicho', active: true},
    {id: 'c', parentId: 'b', name: 'Subnicho', active: true},
    {id: 'x', parentId: 'y', name: 'Ciclo', active: true},
    {id: 'y', parentId: 'x', name: 'Ciclo', active: true},
    {id: 'z', parentId: 'missing', name: 'Órfão', active: true}
  ]);
  assert.equal(graph.path('c'), 'Raiz › Nicho › Subnicho');
  assert.deepEqual(graph.descendantsOf('b'), new Set(['b', 'c']));
  assert.equal(graph.active('c'), false);
  assert.equal(graph.active('z'), false);
  assert.deepEqual(graph.chain('x'), []);
});

test('status and coupon-code mappings follow contract boundaries', () => {
  assert.equal(nextStatus('PENDENTE'), 'PROCESSANDO');
  assert.equal(nextStatus('PROCESSANDO'), 'ENVIADO');
  assert.equal(nextStatus('ENVIADO'), 'ENTREGUE');
  assert.equal(nextStatus('ENTREGUE'), undefined);
  assert.equal(nextStatus('INVALIDO'), undefined);
  assert.equal(normalizedCode(' fLoR-20 '), 'FLOR-20');
  for (const value of ['A', 'A/B', 'AJÚ', 'A B', 'ß-', 'X'.repeat(33)]) assert.equal(normalizedCode(value), undefined);
});

test('media sources use only matching private image IDs or server-curated static path family', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const own = `/api/v1/operador/imagens/${id}`;
  assert.equal(safePhoto({id, src: own}), own);
  assert.equal(safePhoto({id, src: '/images/sebo/contos-frente-160.jpg'}), '/images/sebo/contos-frente-160.jpg');
  for (const src of [`${own}?x`, `${own}\n`, own.replace('1', '2'), '/images/referencias/teste.jpg',
    '/images/sebo/../segredo.jpg', '/images/sebo/abc.svg', '/images/sebo/abc.jpg\n',
    'https://exemplo.invalid/x.jpg', '//exemplo.invalid/x.jpg', 'blob:abc', 'data:image/png,abc',
    'javascript:alert(1)', '/images/sebo/%2Fx.jpg', '/images/sebo/a.jpg#b']) {
    assert.equal(safePhoto({id, src}), null);
  }
  assert.equal(safePhoto({id: 'outro', src: own}), null);
});
