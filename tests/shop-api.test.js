import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi,allPages} from '../src/shop/api.js';
import {listing,categories,mediaURL,mediaSrcset} from '../src/shop/schema.js';
import {productCard} from '../src/ui/product-card.js';
import {products} from '../src/data/catalog.js';
import {couponForm} from '../src/shop/checkout-view.js';
test('009: CSRF rotates in memory, native Origin untouched, logout obtains anonymous token',async()=>{
  const calls=[];let token='fixture-anon';
  const api=createApi(async(url,options)=>{
    calls.push({url,options});
    const result=url.endsWith('/session')?{user:token==='fixture-login'?{id:'a',role:'CUSTOMER'}:null,csrfToken:token}:url.endsWith('/logout')?null:{user:{id:'a',role:'CUSTOMER'},csrfToken:(token='fixture-login')};
    if(url.endsWith('/logout'))token='fixture-logout';
    return new Response(result?JSON.stringify(result):null,{status:result?200:204,headers:{'Content-Type':'application/json'}});
  });
  await api.getSession();await api.auth('login','teste','password-fixture-123');
  await api.request('/checkout/quote',{method:'POST',body:{items:[]}});
  assert.equal(calls[1].options.headers['X-CSRF-Token'],'fixture-anon');assert.equal(calls[2].options.headers['X-CSRF-Token'],'fixture-login');
  assert.equal(calls[2].options.headers.Origin,undefined);assert.equal(calls[2].options.credentials,'same-origin');
  assert.equal((await api.logout()).csrfToken,'fixture-logout');
  await assert.rejects(api.request('//evil.example/path'),/inválida/);
});
test('009: all API pages requested with bounded limit; cycles and wrong envelopes reject',async()=>{
  const paths=[];const items=await allPages(async p=>{paths.push(p);return paths.length===1?{items:[1],nextCursor:'opaque a'}:{items:[2],nextCursor:null};},'/catalogo/categorias');
  assert.deepEqual(items,[1,2]);assert.match(paths[1],/limit=100&cursor=opaque%20a/);
  await assert.rejects(allPages(async()=>({items:[],nextCursor:'cycle'}),'/catalogo/categorias'),/repetida/);
  await assert.rejects(allPages(async()=>({items:null,nextCursor:null}),'/catalogo/categorias'),/inválida/);
});
test('009: operator text escaped, null optional values safe, remote/raw/media srcset blocked',()=>{
  const p=products[0],raw={...p,categoryId:'TEST-CATEGORY',categorySlug:'brincos',rootSlug:'artesanato',priceCents:p.price,compareAtPriceCents:null,demo:true,reviews:[],
    name:'"><img src=x onerror=alert(1)>',detail:'<script>bad()</script>'};
  const item=listing(raw),html=productCard(item);
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!/<img[^>]*\sonerror=/.test(html));assert.ok(!html.includes('De <s>'));
  for(const url of ['https://evil.example/a.jpg','//evil/a.jpg','/images/referencias/raw.jpg','/api/v1/operador/imagens/x','data:image/svg+xml,x','/images/sebo/../x.jpg'])assert.equal(mediaURL(url),'');
  assert.equal(mediaSrcset('/images/sebo/sakura-160.png 160w, https://evil/x 320w'),'');
  assert.equal(mediaSrcset(null),'');assert.throws(()=>listing({...raw,gallery:[{...p.gallery[0],src:'javascript:alert(1)'}]}));
});
test('009: category tree exposes hierarchy and rejects cycles/unknown parents',()=>{
  const rows=[{id:'A',parentId:null,slug:'a',name:'Artesanato'},{id:'B',parentId:'A',slug:'b',name:'Brincos'}];
  assert.equal(categories(rows)[1].path,'Artesanato › Brincos');
  assert.throws(()=>categories([{...rows[0],parentId:'B'},rows[1]]),/inválida/);
  assert.throws(()=>categories([{...rows[1],parentId:'MISSING'}]),/inválida/);
});
test('009: basket and checkout coupon labels reference distinct real input IDs',()=>{
  const cart=couponForm(),checkout=couponForm('checkout');
  const ids=[...cart.concat(checkout).matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  assert.match(cart,/for="cart-coupon-code"/);assert.match(cart,/id="cart-coupon-code"/);
  assert.match(checkout,/for="checkout-coupon-code"/);assert.match(checkout,/id="checkout-coupon-code"/);
});
