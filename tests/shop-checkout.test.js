import test from 'node:test';
import assert from 'node:assert/strict';
import {createCheckout,couponCodes} from '../src/shop/checkout.js';
import {loadCart,saveCart,addItem,reconcile,settleCart,fingerprint} from '../src/shop/cart.js';
const Q='00000000-0000-4000-8000-000000000001';
const quote=()=>({quoteId:Q,expiresAt:'2099-01-01T00:00:00Z',demo:true,items:[{productId:'NEW-ITEM',variant:'',quantity:1,name:'Novo',unitPriceCents:10000,subtotalCents:10000,discountCents:2350,totalCents:7650}],subtotalCents:10000,merchDiscountCents:2350,shippingId:'correios',shippingName:'Correios',shippingCents:1890,shippingDiscountCents:1890,totalCents:7650,paymentMethod:'PIX_SIMULADO',appliedCoupons:[],rejectedCoupons:[]});
const receipt=()=>({orderId:Q,createdAt:'2026-11-18T00:00:00Z',demo:true,status:'PENDENTE',totalCents:7650,purchase:{id:Q,demo:true,state:'SIMULADO'}});
const customer={user:{id:'customer-a',role:'CUSTOMER'}};
const input=()=>({recipientFullName:'Nome de Exemplo'});
test('009: quote invalidation discards late response and never confirms stale totals',async()=>{
  let finish;const model=createCheckout({request:()=>new Promise(r=>{finish=r;}),session:async()=>customer});
  const pending=model.preview(input());await Promise.resolve();model.invalidate();finish(quote());assert.equal(await pending,null);await assert.rejects(model.confirm(),/expirou/);
});
test('009: same quote/key reused after uncertain network; double clicks do not duplicate calls',async()=>{
  let posts=0,rejectFirst=true;const calls=[];
  const model=createCheckout({session:async()=>customer,random:()=> 'test-idempotency-key',request:async(path,opts)=>{
    if(path.endsWith('quote'))return quote();
    posts++;calls.push(opts);
    if(rejectFirst){rejectFirst=false;throw Object.assign(new Error('Rede incerta'),{status:0});}
    return receipt();
  }});
  await model.preview(input());
  await assert.rejects(model.confirm(),/incerta/);
  assert.equal(model.state().attempt.quoteId,Q);await assert.rejects(model.preview({}),/pendente/);
  const retry=model.confirm(),double=model.confirm();assert.equal(await double,null);assert.equal((await retry).orderId,Q);
  assert.equal(posts,2);assert.deepEqual(calls[0],calls[1]);assert.equal(model.state().attempt,null);
});
test('009: invalid receipt preserves attempt, 409 releases quote, retry cannot change account',async()=>{
  let account=customer,mode='bad';
  const model=createCheckout({session:async()=>account,random:()=> 'key-unchanged',request:async path=>{
    if(path.endsWith('quote'))return quote();
    if(mode==='bad')return {...receipt(),totalCents:1};
    throw Object.assign(new Error('Precisa nova prévia'),{status:409});
  }});
  await model.preview(input());await assert.rejects(model.confirm(),/Recibo/);assert.equal(model.state().attempt.key,'key-unchanged');
  account={user:{id:'customer-b',role:'CUSTOMER'}};await assert.rejects(model.confirm(),/outra conta/);assert.equal(model.state().attempt.key,'key-unchanged');
  account=customer;mode='conflict';await assert.rejects(model.confirm(),/prévia/);assert.equal(model.state().attempt,null);assert.equal(model.state().quote,null);
});
test('009: expired quote and anonymous session cannot submit, coupon normalization max5',async()=>{
  let posts=0;const model=createCheckout({session:async()=>customer,now:()=>Date.parse('2100-01-01'),request:async path=>{if(path.endsWith('quote'))return quote();posts++;}});
  await model.preview(input());await assert.rejects(model.confirm(),/expirou/);assert.equal(posts,0);
  const anon=createCheckout({session:async()=>({user:null}),request:async()=>{throw Error('Should not call');}});
  await assert.rejects(anon.preview(input()),/conta/);
  assert.deepEqual(couponCodes([' teste ','TESTE','outro-1']),['TESTE','OUTRO-1']);assert.throws(()=>couponCodes(['AA','BB','CC','DD','EE','FF']));assert.throws(()=>couponCodes(['<bad>']));
});
test('009: v2 retains new IDs offline; official reconciliation only removes unavailable lines',()=>{
  const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const items=[{id:'NEW-ITEM',variant:'azul',quantity:2},{id:'FDL-CRAFT-MORANGO',variant:'',quantity:1}];
  saveCart(storage,items);const serialized=data.get('flor-de-lotus:craft-sebo-cart:v2');
  assert.deepEqual(loadCart(storage),items);assert.equal(data.get('flor-de-lotus:craft-sebo-cart:v2'),serialized);
  const official=[{id:'NEW-ITEM',mode:'ready',variants:['azul'],price:12345}];
  const result=reconcile(items,official);assert.deepEqual(result.items,[items[0]]);assert.deepEqual(result.removed,[items[1]]);
  assert.throws(()=>addItem(items,official[0],'azul',8));assert.equal(addItem([],official[0],'azul',3)[0].quantity,3);
  assert.equal(settleCart(items,items).items.length,0);const newer=[...items,{id:'NEW-SECOND',variant:'',quantity:1}];
  assert.deepEqual(settleCart(newer,items),{items:newer,changed:true});assert.equal(fingerprint(loadCart(storage)),fingerprint(items));
});
