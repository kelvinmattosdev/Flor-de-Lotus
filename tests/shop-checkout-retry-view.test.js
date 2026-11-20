import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {createCheckout,couponCodes} from '../src/shop/checkout.js';
import {loadCart,saveCart,settleCart} from '../src/shop/cart.js';
import {money,shippingOptions} from '../src/data/catalog.js';
import {escape,closeButton,icon} from '../src/ui/render.js';
import {errorMessage} from '../src/shop/api.js';
import {recipientName} from '../src/shop/schema.js';

// Execute the WHOLE actual view module and the unchanged real model. Only DOM
// primitives and transport/session are deterministic labelled test fixtures.
// No replacement render(), no source-pattern assertions, no raw retry keys logged.
const source=readFileSync(new URL('../src/shop/checkout-view.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,'');
const digest=s=>createHash('sha256').update(String(s)).digest('hex');
const Q='00000000-0000-4000-8000-000000000001';
const quote=()=>({quoteId:Q,expiresAt:'2099-01-01T00:00:00Z',demo:true,
  items:[{productId:'FDL-CRAFT-MORANGO',variant:'',quantity:1,name:'Peça de teste',unitPriceCents:2990,subtotalCents:2990,discountCents:0,totalCents:2990}],
  subtotalCents:2990,merchDiscountCents:0,shippingId:'correios',shippingName:'Correios',shippingCents:1890,shippingDiscountCents:0,totalCents:4880,paymentMethod:'PIX_SIMULADO',appliedCoupons:[],rejectedCoupons:[]});
const receipt=()=>({orderId:Q,createdAt:'2026-11-18T00:00:00Z',demo:true,status:'PENDENTE',totalCents:4880,purchase:{id:Q,demo:true,state:'SIMULADO'}});
const pump=()=>new Promise(setImmediate);
async function until(predicate){for(let i=0;i<30;i++){if(predicate())return;await pump();}assert.ok(predicate(),'Fixture did not reach the requested state.');}
function events(object={}){
  const listeners=new Map();
  return Object.assign(object,{
    addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
    removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
    emit(type,event={}){for(const fn of [...(listeners.get(type)||[])])fn(event);}
  });
}
function fixture({expired=false,holdQuote=false}={}){
  const document=events({body:{id:'body'}});document.activeElement=document.body;
  const dialog=events({id:'checkout-dialog',open:true,isConnected:true,scrollTop:600});
  const focusCalls=[],nodes=new Map(),renders=[],posts=[],stored=new Map(),quotes=[];
  let liveCart=[{id:'FDL-CRAFT-MORANGO',variant:'',quantity:1}],model,clock=Date.now(),sessionListener;
  const storage={getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
  saveCart(storage,liveCart);
  const content={};
  const node=(id,attrs={},textContent='')=>({
    id,isConnected:true,disabled:Object.hasOwn(attrs,'disabled'),textContent,value:attrs.value??'',
    removeAttribute(name){delete attrs[name];},
    setAttribute(name,value){attrs[name]=String(value);},getAttribute:name=>attrs[name]??null,
    focus(options){document.activeElement=this;focusCalls.push({id,scrollTop:dialog.scrollTop,preventScroll:options?.preventScroll});dialog.emit('focusin',{target:this});}
  });
  let html='';
  Object.defineProperty(content,'innerHTML',{get:()=>html,set(value){
    renders.push(value);html=value;
    for(const old of nodes.values()){old.isConnected=false;if(document.activeElement===old)document.activeElement=document.body;}
    nodes.clear();
    // Minimal DOM adapter builds controls FROM the real emitted markup. Neither
    // labels nor disabled/busy state are supplied by the fixture.
    install(value);
    if(value.includes('id="checkout-summary"')){
      const summary=node('checkout-summary');let previous=[];
      Object.defineProperty(summary,'innerHTML',{set(markup){for(const id of previous){const old=nodes.get(id);if(old){old.isConnected=false;if(document.activeElement===old)document.activeElement=document.body;}nodes.delete(id);}previous=install(markup);}});
      nodes.set('checkout-summary',summary);
    }
  }});
  function install(value){
    const ids=[];
    for(const match of value.matchAll(/<(button|h2|p)\b([^>]*\bid="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/g)){
      const attrs=Object.fromEntries([...match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(a=>[a[1],a[2]??'']));
      nodes.set(match[3],node(match[3],attrs,match[4].replace(/<[^>]*>/g,'')));
      ids.push(match[3]);
    }
    for(const match of value.matchAll(/<input\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
      const attrs=Object.fromEntries([...match[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(a=>[a[1],a[2]??'']));
      nodes.set(match[2],node(match[2],attrs));ids.push(match[2]);
    }
    return ids;
  }
  dialog.querySelector=selector=>selector==='.success-view'?(html.includes('class="success-view"')?content:null):selector.startsWith('#')?nodes.get(selector.slice(1))||null:null;
  const toast={hidden:false};
  const $=selector=>selector==='#checkout-dialog'?dialog:selector==='#checkout-content'?content:selector==='#toast'?toast:nodes.get(selector.slice(1))||null;
  const api={
    onSessionChange:fn=>{sessionListener=fn;},
    getSession:async()=>({user:{id:'fixture-account',role:'CUSTOMER'}}),
    request:async(path,options)=>{
      if(path==='/checkout/quote')return new Promise(resolve=>{quotes.push({nameHash:digest(options.body.recipientFullName),resolve});if(!holdQuote)resolve(quote());});
      assert.equal(path,'/pedidos');
      return new Promise((resolve,reject)=>{posts.push({
        keyHash:digest(options.headers['Idempotency-Key']),quoteHash:digest(options.body.quoteId),
        nameHash:digest(options.body.recipientFullName),
        accountHash:digest(model.state().attempt.accountId),resolve,reject
      });});
    }
  };
  const context={document,window:document,$,api,errorMessage,money,shippingOptions,escape,closeButton,icon,loadCart,saveCart,settleCart,couponCodes,recipientName,
    createCheckout:deps=>(model=createCheckout({...deps,now:()=>clock}))};
  runInNewContext(source+'\nthis.createView=createCheckoutView;',context,{timeout:1000});
  const view=context.createView({storage,getCart:()=>liveCart,readCart:()=>loadCart(storage),setCart:items=>{liveCart=items;},updateCart:()=>{},validateCart:async()=>liveCart.map(i=>({...i})),announce:()=>{}});
  const click=id=>{
    const button=$(id);assert.ok(button,'Actual rendered action missing');
    document.activeElement=button;
    dialog.emit('click',{target:{closest:selector=>selector===id?button:null}});
  };
  const typeName=value=>{const input=$('#checkout-recipient');input.value=value;dialog.emit('input',{target:input});return input;};
  const prepare=async()=>{view.show();typeName('Áurea de Exemplo');click('#review-order');await until(()=>$('#confirm-simulation'));if(expired)clock=Date.parse('2100-01-01');};
  return{view,prepare,click,typeName,$,document,dialog,content,renders,focusCalls,posts,quotes,storage,model:()=>model,sessionChange:id=>sessionListener?.({user:{id,role:'CUSTOMER'}}),
    cart:()=>loadCart(storage),newerCart:()=>{const newer=[{id:'FDL-CRAFT-MORANGO',variant:'',quantity:2}];saveCart(storage,newer);return newer;},
    external:node('user-chosen-other-control')};
}
const signature=p=>({keyHash:p.keyHash,quoteHash:p.quoteHash,accountHash:p.accountHash,nameHash:p.nameHash});
for(const failure of ['lost-response','server-5xx','invalid-receipt']){
  test(`QA009-01 real view/model: ${failure} offers enabled, named retry with same key/quote/account`,async()=>{
    const f=fixture();await f.prepare();const originalCart=f.cart();
    f.click('#confirm-simulation');await until(()=>f.posts.length===1);
    const identity=signature(f.posts[0]);
    if(failure==='lost-response')f.posts[0].reject(Object.assign(new Error('Resposta interrompida; sacola mantida.'),{status:0}));
    else if(failure==='server-5xx')f.posts[0].reject(Object.assign(new Error('Servidor temporariamente indisponível.'),{status:503}));
    else f.posts[0].resolve({...receipt(),totalCents:1});
    await until(()=>!f.model().state().busy);await pump();
    const retry=f.$('#confirm-simulation');
    assert.equal(retry.textContent,'Retentar mesma confirmação');
    assert.equal(retry.disabled,false);assert.equal(retry.getAttribute('aria-busy'),'false');
    assert.equal(retry.getAttribute('aria-describedby'),'checkout-status');
    assert.ok(f.$('#checkout-status').textContent.length>0);
    assert.deepEqual(f.cart(),originalCart);assert.ok(f.model().state().attempt);
    f.click('#confirm-simulation');await until(()=>f.posts.length===2);
    assert.deepEqual(signature(f.posts[1]),identity);
    f.posts[1].resolve(receipt());await until(()=>f.content.innerHTML.includes('success-view'));
    assert.equal(f.cart().length,0);
  });
}
test('QA009-01 pending POST stays busy/Confirmando, duplicate click does not post twice',async()=>{
  const f=fixture();await f.prepare();f.click('#confirm-simulation');await until(()=>f.posts.length===1);
  const button=f.$('#confirm-simulation');assert.equal(button.disabled,true);assert.equal(button.textContent,'Confirmando…');assert.equal(button.getAttribute('aria-busy'),'true');
  f.click('#confirm-simulation');await pump();assert.equal(f.posts.length,1);
  f.posts[0].resolve(receipt());await until(()=>f.content.innerHTML.includes('success-view'));const count=f.renders.length;
  await pump();assert.equal(f.renders.length,count,'Finally must not render over the receipt.');
  assert.equal(f.$('#confirm-simulation'),null);assert.equal(f.dialog.scrollTop,0);
  assert.deepEqual(f.focusCalls.at(-1),{id:'checkout-title',scrollTop:0,preventScroll:true});
});
for(const closed of [false,true]){
  test(`QA009-01 no late focus theft after ${closed?'dialog closed':'user chose another control'}`,async()=>{
    const f=fixture();await f.prepare();f.click('#confirm-simulation');await until(()=>f.posts.length===1);
    if(closed){f.dialog.open=false;f.document.activeElement=f.external;}
    else{f.document.emit('pointerdown',{target:f.external});f.external.focus({preventScroll:true});}
    const count=f.focusCalls.length;
    f.posts[0].reject(new Error('Resposta incerta'));await until(()=>!f.model().state().busy);await pump();
    assert.equal(f.document.activeElement,f.external);assert.equal(f.focusCalls.length,count);
  });
}
test('QA009-01 focused submit action is restored once, only after failure exits busy',async()=>{
  const f=fixture();await f.prepare();f.click('#confirm-simulation');await until(()=>f.posts.length===1);
  f.posts[0].reject(new Error('Resposta incerta'));await until(()=>!f.model().state().busy);await pump();
  assert.equal(f.document.activeElement,f.$('#confirm-simulation'));assert.equal(f.focusCalls.length,1);
  assert.equal(f.$('#confirm-simulation').disabled,false);await pump();assert.equal(f.focusCalls.length,1);
});
test('QA009-01 409 and expired quote offer new review, not an uncertain retry',async()=>{
  for(const expired of [false,true]){
    const f=fixture({expired});await f.prepare();f.click('#confirm-simulation');
    if(!expired){await until(()=>f.posts.length===1);f.posts[0].reject(Object.assign(new Error('Prévia desatualizada'),{status:409}));}
    await pump();await pump();
    assert.equal(f.model().state().attempt,null);assert.equal(f.$('#confirm-simulation'),null);
    assert.equal(f.$('#review-order').disabled,false);assert.ok(f.$('#checkout-status').textContent.length);
    assert.equal(f.cart()[0].quantity,1);if(expired)assert.equal(f.posts.length,0);
  }
});
test('QA009-01 uncertain retry preserves newer remote basket and stable success scroll/focus',async()=>{
  const f=fixture();await f.prepare();f.click('#confirm-simulation');await until(()=>f.posts.length===1);
  f.posts[0].reject(new Error('201 response lost (transport fixture)'));await until(()=>!f.model().state().busy);await pump();
  const newer=f.newerCart();f.view.invalidate();f.click('#confirm-simulation');await until(()=>f.posts.length===2);
  assert.deepEqual(signature(f.posts[0]),signature(f.posts[1]));
  f.dialog.scrollTop=600;f.posts[1].resolve(receipt());await until(()=>f.content.innerHTML.includes('success-view'));
  assert.deepEqual(f.cart(),newer);assert.match(f.content.innerHTML,/preservada por inteiro/);assert.equal(f.dialog.scrollTop,0);
  assert.equal(f.document.activeElement.id,'checkout-title');const count=f.renders.length;await pump();assert.equal(f.renders.length,count);
});
test('010: actual input stays connected through typing; edit invalidates reviewed name',async()=>{
  const f=fixture();f.view.show();const input=f.typeName('Áurea de Exemplo');f.document.activeElement=input;
  f.typeName('Áurea de Exemplo Dois');assert.equal(f.$('#checkout-recipient'),input);assert.equal(input.isConnected,true);assert.equal(f.document.activeElement,input);
  f.click('#review-order');await until(()=>f.$('#confirm-simulation'));
  assert.equal(f.model().state().quote.recipientFullName,'Áurea de Exemplo Dois');
  f.typeName('Outro Nome Fictício');assert.equal(f.model().state().quote,null);assert.equal(f.$('#confirm-simulation'),null);
});
test('010: Escape/reopen keeps exact uncertain name; success clears draft; account change does not reuse it',async()=>{
  const f=fixture();await f.prepare();f.click('#confirm-simulation');await until(()=>f.posts.length===1);
  f.dialog.open=false;f.posts[0].reject(Error('Resposta incerta'));await pump();await pump();
  f.dialog.open=true;f.view.show();assert.equal(f.$('#checkout-recipient').value,'Áurea de Exemplo');
  f.typeName('Alteração programática ignorada');assert.equal(f.model().state().attempt.recipientFullName,'Áurea de Exemplo');
  f.click('#confirm-simulation');await until(()=>f.posts.length===2);assert.deepEqual(signature(f.posts[0]),signature(f.posts[1]));
  f.posts[1].resolve(receipt());await until(()=>f.content.innerHTML.includes('success-view'));
  f.view.show();assert.equal(f.$('#checkout-recipient').value,'');
  f.sessionChange('fixture-account');f.typeName('Outro Nome Fictício');f.sessionChange('another-account');
  assert.equal(f.$('#checkout-recipient').value,'');
});
test('010: name edit during real renderer quote request keeps typing and rejects late response',async()=>{
  const f=fixture({holdQuote:true});f.view.show();f.typeName('Primeiro Nome Fictício');f.click('#review-order');await until(()=>f.quotes.length===1);
  const input=f.typeName('Segundo Nome Fictício');f.document.activeElement=input;f.quotes[0].resolve(quote());await pump();await pump();
  assert.equal(f.$('#checkout-recipient'),input);assert.equal(f.document.activeElement,input);assert.equal(f.model().state().quote,null);assert.equal(f.$('#confirm-simulation'),null);
  f.click('#review-order');await until(()=>f.quotes.length===2);f.quotes[1].resolve(quote());await until(()=>f.$('#confirm-simulation'));
  assert.equal(f.model().state().quote.recipientFullName,'Segundo Nome Fictício');
});
test('010: definitive consumed conflict points to purchases and requires acknowledgement, basket intact',async()=>{
  for(const code of ['QUOTE_CONSUMED','IDEMPOTENCY_CONFLICT']){
    const f=fixture();await f.prepare();f.click('#confirm-simulation');await until(()=>f.posts.length===1);
    f.posts[0].reject(Object.assign(Error('Conflito'),{status:409,code}));await pump();await pump();
    assert.equal(f.$('#review-order'),null);assert.equal(f.$('#confirm-simulation'),null);assert.ok(f.$('#acknowledge-purchases'));
    assert.match(f.$('#checkout-status').textContent,/pode já ter sido registrada/);assert.equal(f.cart()[0].quantity,1);
    f.click('#acknowledge-purchases');assert.ok(f.$('#review-order'));assert.equal(f.model().state().recovery,null);
  }
});
