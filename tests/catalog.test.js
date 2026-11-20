import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { products, matchesFilter } from '../src/data/catalog.js';
import { addItem, normalizeCart, loadCart, STORAGE_KEY } from '../src/domain/cart.js';

test('CHANGE-002: eight craft references, four books, no fabricated disc or duplicate SKU', () => {
  assert.equal(products.length, 12);
  assert.equal(products.filter(p => p.family === 'artesanato').length, 8);
  assert.equal(products.filter(p => p.family === 'sebo').length, 4);
  assert.equal(new Set(products.map(p => p.id)).size, 12);
  assert.ok(products.every(p => /^FDL-(CRAFT|SEBO)-/.test(p.id)));
  assert.ok(products.filter(p => p.family === 'sebo').every(p => p.category === 'livros'));
  assert.equal(products.filter(p => p.mode === 'custom').length, 2);
  assert.ok(products.every(p => p.variants.length === 0), 'Do not fabricate garment sizes or a fake single-option selector.');
  assert.ok(products.some(p => p.name === 'The Melting Classroom'));
});
test('CHANGE-002: every referenced image and srcset candidate exists with true non-upscaled dimensions', () => {
  for (const product of products) for (const image of product.gallery) {
    assert.ok(image.width > 0 && image.height > 0 && image.alt);
    assert.ok(existsSync(`public${image.src}`));
    for (const candidate of image.srcset.split(', ')) {
      const [file, width] = candidate.split(' ');
      assert.ok(existsSync(`public${file}`), file);
      assert.ok(Number(width.slice(0, -1)) <= image.width, 'No fabricated higher-resolution variant');
    }
  }
});
test('CHANGE-002: filters group books separately and craft subcategories completely', () => {
  for (const [filter, count] of [['all',12],['artesanato',8],['sebo',4],['brincos',2],['colares',2],['chaveiros',2],['bolsas',2]]) {
    assert.equal(products.filter(p => matchesFilter(p, filter)).length, count, filter);
  }
});
test('CHANGE-002: no option needed for a photographed item, no custom item sold as fixed-price', () => {
  const id = products[0].id;
  assert.deepEqual(addItem([], id), [{ id, variant: '', quantity: 1 }]);
  assert.throws(() => addItem([], id, 'M'), RangeError);
  for (const product of products.filter(p => p.mode === 'custom')) {
    assert.equal(product.price, null);
    assert.throws(() => addItem([], product.id), RangeError);
  }
  assert.deepEqual(normalizeCart([{id:'DEMO-FL-001',variant:'P',quantity:1}]), []);
  for (const raw of ['{', 'null', JSON.stringify({version:1,items:[]}), JSON.stringify({version:2,items:[null, {}, 'invalid']})]) {
    assert.deepEqual(loadCart({getItem:key=>key===STORAGE_KEY?raw:null,removeItem(){}}), []);
  }
});
test('CHANGE-002: published page metadata and UI describe craft and books, not clothing or stock photography', () => {
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const main=readFileSync(new URL('../src/ui/storefront.js',import.meta.url),'utf8');
  assert.match(html, /<title>Flor de Lotus — artesanato e sebo<\/title>/);
  assert.match(html, /Livros <em>e discos/);
  assert.doesNotMatch(html, /Moda feminina|Vestidos|Sob medida|images\/hero\.webp/);
  assert.doesNotMatch(main, /Escolha seu tamanho|Tamanho único|data-source="stand-in"/);
  assert.match(main, /checkoutDialog\.scrollTop = 0;\s+\$\('#checkout-title'\)\.focus\(\{ preventScroll: true \}\)/);
});
