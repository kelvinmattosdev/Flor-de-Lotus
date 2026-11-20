import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {loadCart,STORAGE_KEY} from '../src/shop/cart.js';
const source=readFileSync(new URL('../src/ui/storefront.js',import.meta.url),'utf8');
const start=source.indexOf("window.addEventListener('storage', event => {");
const end=source.indexOf('\n});',start);
assert.ok(start>=0&&end>start,'Execute the actual storage handler, not a replacement implementation.');
const handlerSource=source.slice(start,end+4);
function fixture({success=false,cartOpen=false,checkoutOpen=true}={}) {
  const data=new Map(),calls={updates:[],cart:0,checkout:0,focus:0};
  const storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const title={focus(){calls.focus++;}};
  let handler;
  const context={
    window:{addEventListener(type,fn){assert.equal(type,'storage');handler=fn;}},
    document:{activeElement:{id:'checkout-title'},getElementById:()=>title},
    $:()=>title,STORAGE_KEY,storage,cart:[],loadCart,
    updateCart:persist=>calls.updates.push(persist),
    cartDialog:{open:cartOpen},checkoutDialog:{open:checkoutOpen,querySelector:()=>success?{}:null},
    renderCart:()=>{calls.cart++;},renderCheckout:()=>{calls.checkout++;}
    ,checkoutView:{invalidate:()=>{calls.checkout++;}}
  };
  runInNewContext(handlerSource,context,{timeout:1000});
  return {data,storage,calls,context,event:key=>handler({key,storageArea:storage})};
}
test('006: confirmed success remains untouched by Full→Auto motion storage event',()=>{
  const f=fixture({success:true});
  f.data.set('flor-de-lotus:motion:v1','auto');
  f.event('flor-de-lotus:motion:v1');
  assert.equal(f.calls.checkout,0);
  assert.equal(f.calls.cart,0);
  assert.deepEqual(f.calls.updates,[]);
});
test('006: unrelated local keys never reread/rerender basket or an open checkout',()=>{
  const f=fixture({cartOpen:true});
  f.data.set('unrelated-qa','preserve');
  f.event('unrelated-qa');
  assert.equal(f.calls.cart,0);assert.equal(f.calls.checkout,0);
  assert.equal(f.data.get('unrelated-qa'),'preserve');assert.deepEqual(f.calls.updates,[]);
});
test('006: genuine v2 cart updates/removal/clear synchronize, while completed success stays immutable',()=>{
  const f=fixture({cartOpen:true});
  f.data.set(STORAGE_KEY,JSON.stringify({version:2,items:[{id:'FDL-CRAFT-MORANGO',variant:'',quantity:3}]}));
  f.event(STORAGE_KEY);
  assert.equal(f.context.cart[0].quantity,3);
  assert.equal(f.calls.cart,1);assert.equal(f.calls.checkout,1);
  assert.deepEqual(f.calls.updates,[false],'Remote synchronization updates UI without writing storage back.');
  f.data.delete(STORAGE_KEY);f.event(STORAGE_KEY);
  assert.equal(f.context.cart.length,0);
  f.event(null);assert.equal(f.context.cart.length,0);assert.equal(f.calls.cart,3);
  const completed=fixture({success:true});
  completed.event(null);
  assert.equal(completed.calls.checkout,0,'A legitimate clear updates badge but never rerenders completed confirmation.');
  assert.deepEqual(completed.calls.updates,[false]);
});
