import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {products, money, shippingOptions} from '../src/data/catalog.js';
import {discountPercent, ratingSummary, productFromSearch, relatedProducts, selectedQuantity} from '../src/domain/offer.js';
import {formatCEP, validCEP, quoteShipping, createQuoteTask} from '../src/domain/shipping.js';
import {addItem, subtotal, reviewCheckout, saveCart, loadCart, STORAGE_KEY} from '../src/domain/cart.js';

test('003: all twelve stable IDs route exactly; missing/duplicate/malformed/injection never select a fallback',()=>{
  for(const p of products)assert.equal(productFromSearch(`?id=${p.id}`),p);
  for(const query of ['', '?id=', '?id=nope', '?id=FDL-CRAFT-MORANGO&id=FDL-CRAFT-MORANGO','?id=%3Cscript%3Ealert(1)%3C/script%3E','?id=__proto__','?id=FDL-CRAFT-MORANGO%00'])assert.equal(productFromSearch(query),undefined);
  assert.equal(productFromSearch('?id=FDL-CRAFT-MORANGO&x=%3Cscript%3E'),products[0]);
});
test('003: ten offers use integer cents and unchanged payable prices, custom pieces have no compare-price',()=>{
  assert.deepEqual(products.map(p=>p.price),[2990,3490,5990,4990,null,null,6990,7490,2790,2490,1890,3290]);
  assert.equal(products.filter(p=>p.mode==='ready').length,10);
  for(const p of products) {
    if(p.mode==='custom'){assert.equal(p.compareAtPrice,null);continue;}
    assert.ok(Number.isSafeInteger(p.compareAtPrice)&&p.compareAtPrice>p.price);
    assert.equal(discountPercent(p.price,p.compareAtPrice),Math.round(100*(p.compareAtPrice-p.price)/p.compareAtPrice));
    assert.ok(discountPercent(p.price,p.compareAtPrice)>0);
  }
  for(const args of [[100,100],[100,90],[-1,100],[1.5,100],[100,null]])assert.equal(discountPercent(...args),0);
});
test('003: reviews explicitly demo, generic example authors, same aggregate and related links exclude self',()=>{
  for(const p of products) {
    assert.equal(p.reviews.length,2);
    assert.ok(p.reviews.every(r=>r.demo===true&&/exemplo/.test(r.author)&&/fictício/.test(r.text)));
    assert.deepEqual(ratingSummary(p.reviews),{count:2,average:4.5});
    const related=relatedProducts(p);
    assert.equal(related.length,3);assert.ok(related.every(r=>r.id!==p.id));
    assert.equal(new Set(related.map(r=>r.id)).size,3);
  }
  assert.deepEqual(ratingSummary([{rating:5},{demo:true,rating:8}]),{count:0,average:0});
});
test('003: strict quantities, additive buying preserves basket and over-limit throws without mutation',()=>{
  for(const q of ['1',1,'9',9])assert.equal(selectedQuantity(q),Number(q));
  for(const q of ['',0,10,-1,'1.2','1e0','01',' 2 ',NaN,Infinity])assert.throws(()=>selectedQuantity(q),RangeError);
  const cart=addItem([],products[8].id,'',2);
  const added=addItem(cart,products[0].id,'',3);
  assert.equal(added.length,2);assert.equal(subtotal(added),14550);
  assert.equal(cart.length,1);
  const nine=addItem(added,products[0].id,'',6);
  assert.throws(()=>addItem(nine,products[0].id,'',1),/limite/);
  assert.equal(nine[1].quantity,9);assert.equal(added[1].quantity,3);
});
test('003: CEP validates format only, masks eight digits, quotes equal checkout and retain no address',()=>{
  assert.equal(formatCEP('12345678'),'12345-678');
  assert.equal(formatCEP('12a345--67890'),'12345-678');
  for(const value of ['12345678','12345-678','00000-000']) {
    assert.equal(validCEP(value),true);
    const quotes=quoteShipping(value);
    assert.deepEqual(quotes,shippingOptions.map(q=>({...q,demo:true})));
    for(const q of quotes)assert.equal(reviewCheckout(addItem([],products[0].id),{shipping:q.id}).shipping.price,q.price);
    assert.ok(quotes.every(q=>!('cep' in q)&&!('address' in q)));
  }
  for(const value of ['','1234567','123456789','a12345678',' 12345678','1234-5678']){assert.equal(validCEP(value),false);assert.throws(()=>quoteShipping(value),RangeError);}
});
test('003: latest quote wins after rapid edit/recalculate, canceled/unmounted response cannot publish',()=>{
  const jobs=[],publishes=[];
  const task=createQuoteTask({schedule:fn=>{jobs.push(fn);return jobs.length;},cancel:()=>{}});
  task.run('12345678',q=>publishes.push(q));
  task.run('87654321',q=>publishes.push(q));
  jobs[0]();assert.equal(publishes.length,0);
  jobs[1]();assert.equal(publishes.length,1);
  task.run('12345678',q=>publishes.push(q));task.cancel();jobs[2]();
  assert.equal(publishes.length,1);
});
test('003: cart serialization still whitelists v2 items only; offer/reviews/CEP never persisted',()=>{
  const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  saveCart(storage,[{id:products[0].id,variant:'',quantity:2,cep:'12345678',compareAtPrice:1,reviews:[]}]);
  assert.equal(map.get(STORAGE_KEY),JSON.stringify({version:2,items:[{id:products[0].id,variant:'',quantity:2}]}));
  assert.deepEqual(loadCart(storage),[{id:products[0].id,variant:'',quantity:2}]);
});
test('003: home and PDP use shared store, native anchors, real MPA input without importing home into PDP',()=>{
  const product=readFileSync(new URL('../src/product.js',import.meta.url),'utf8');
  const home=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  const config=readFileSync(new URL('../vite.config.js',import.meta.url),'utf8');
  const card=readFileSync(new URL('../src/ui/product-card.js',import.meta.url),'utf8');
  assert.match(home,/ui\/storefront/);assert.match(product,/ui\/storefront/);
  assert.doesNotMatch(product,/import.*main\.js/);
  assert.match(config,/produto\.html/);assert.match(config,/index\.html/);
  assert.match(card,/<a class="product-media/);
  assert.doesNotMatch(product,/innerHTML\s*=\s*(?:location|.*searchParams)/);
  assert.doesNotMatch(product,/localStorage|sessionStorage|fetch\(|XMLHttpRequest|console\./);
});
