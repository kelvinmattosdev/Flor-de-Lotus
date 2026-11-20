import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {settleCart} from '../src/shop/cart.js';
// U20: success is no longer the old local completeCheckout click handler. Exercise
// the ACTUAL receipt renderer; keep the zero-before-focus/visible-success checks.
// Receipt acceptance, errors, retry and delayed cart clearing are expanded in
// shop-checkout.test.js and shop integration, not replaced with fake completion.
const source=readFileSync(new URL('../src/shop/checkout-view.js',import.meta.url),'utf8');
const start=source.indexOf('export function renderReceipt('),end=source.indexOf('\nexport function createCheckoutView',start);
assert.ok(start>=0&&end>start);
const handler=source.slice(start,end).replace('export ','');
function confirmFrom(scrollTop,changed=false){
  const focusCalls=[],dialog={scrollTop},content={innerHTML:''},toast={hidden:false};
  const receipt={orderId:'00000000-0000-4000-8000-000000000001',totalCents:26880};
  const cart=[{id:'FDL-CRAFT-MORANGO',variant:'',quantity:1}];
  const settled=settleCart(changed?[{...cart[0],quantity:2}]:cart,cart);
  const context={money:String,escape:s=>String(s).replaceAll('<','&lt;'),closeButton:()=>'',icon:()=>''};
  runInNewContext(handler+'\nthis.renderReceipt=renderReceipt;',context);
  context.renderReceipt({receipt,changed:settled.changed,checkoutDialog:dialog,content,title:()=>({focus:options=>focusCalls.push({scrollTop:dialog.scrollTop,preventScroll:options.preventScroll})}),hideToast:()=>{toast.hidden=true;}});
  return{dialog,content,toast,focusCalls,cart:settled.items};
}
test('QA-FDL-001: scrolled checkout resets to its start before focusing the server receipt title',()=>{
  const r=confirmFrom(326);
  assert.equal(r.dialog.scrollTop,0);
  assert.deepEqual(r.focusCalls,[{scrollTop:0,preventScroll:true}]);
  assert.deepEqual(r.cart,[]);assert.equal(r.toast.hidden,true);assert.match(r.content.innerHTML,/success-view/);assert.match(r.content.innerHTML,/PENDENTE/);assert.match(r.content.innerHTML,/Consultar minha compra/);
});
test('QA-FDL-001: receipt already at start stays zero, with newer remote basket preserved',()=>{
  const r=confirmFrom(0,true);assert.equal(r.dialog.scrollTop,0);assert.deepEqual(r.focusCalls,[{scrollTop:0,preventScroll:true}]);
  assert.equal(r.cart[0].quantity,2);assert.match(r.content.innerHTML,/preservada por inteiro/);
});
