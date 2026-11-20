import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {pathToFileURL} from 'node:url';
import * as schema from '../src/shop/schema.js';
import {createApi,errorMessage} from '../src/shop/api.js';
import {createCheckout,couponCodes} from '../src/shop/checkout.js';
import {escape} from '../src/ui/render.js';
import {money} from '../src/data/catalog.js';
const Q='00000000-0000-4000-8000-000000000001';
const quote=()=>({quoteId:Q,expiresAt:'2099-01-01T00:00:00Z',demo:true,items:[{productId:'ITEM',variant:'',quantity:1,name:'Peça',unitPriceCents:10,subtotalCents:10,discountCents:0,totalCents:10}],subtotalCents:10,merchDiscountCents:0,shippingId:'correios',shippingName:'Correios',shippingCents:0,shippingDiscountCents:0,totalCents:10,paymentMethod:'PIX_SIMULADO',appliedCoupons:[],rejectedCoupons:[]});
const receipt=()=>({orderId:Q,demo:true,status:'PENDENTE',totalCents:10,purchase:{id:Q,demo:true,state:'SIMULADO'}});
const pump=()=>new Promise(setImmediate);
const source=p=>readFileSync(process.env.FDL_UI010_SOURCE_ROOT?new URL(p.replace('../',''),pathToFileURL(process.env.FDL_UI010_SOURCE_ROOT.replaceAll('\\','/')+'/')):new URL(p,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,'');
test('010: Unicode validation matches frozen API; only login is lowercased',async()=>{
  assert.equal(typeof schema.nicknameValue,'function');assert.equal(typeof schema.recipientName,'function');
  assert.equal(schema.nicknameValue('  Lótus da LUA  '),'Lótus da LUA');
  assert.equal(schema.nicknameValue('𐐀'.repeat(60)),'𐐀'.repeat(60));
  assert.throws(()=>schema.nicknameValue('𐐀'.repeat(61)));
  for(const v of ['a','ab\u200b','\ufeffAb','A\nB','A\u034fB','A\u2028B','A\ud800B'])assert.throws(()=>schema.nicknameValue(v));
  assert.equal(schema.recipientName('  Áurea D’Exemplo‐Flor  '),'Áurea D’Exemplo‐Flor');
  assert.equal(schema.recipientName('𐐀'.repeat(120)),'𐐀'.repeat(120));
  for(const v of ['1a','--','A\u200bB','A\nB','A&B','A'.repeat(121)])assert.throws(()=>schema.recipientName(v));
});
test('010: register/login/profile payload separation, in-memory session propagation and field errors',async()=>{
  const calls=[];let nickname=null;
  const api=createApi(async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null;calls.push({url,method:options.method,body});
    if(url.endsWith('/perfil'))nickname=body.nickname;
    else if(url.endsWith('/register'))nickname=body.nickname;
    return new Response(JSON.stringify({user:{id:'fixture',login:'teste_a',role:'CUSTOMER',nickname},csrfToken:'fixture-token'}));
  });
  await api.auth('register','TeStE_A','fictitious-password-123','  Lótus da LUA  ');
  assert.deepEqual(calls.find(c=>c.url.endsWith('/register')).body,{login:'teste_a',password:'fictitious-password-123',nickname:'Lótus da LUA'});
  await api.auth('login','TeStE_A','fictitious-password-123','ignored');
  assert.deepEqual(calls.find(c=>c.url.endsWith('/login')).body,{login:'teste_a',password:'fictitious-password-123'});
  assert.equal(typeof api.updateProfile,'function');
  await api.updateProfile('  Flor de Exemplo  ');
  assert.equal((await api.getSession()).user.nickname,'Flor de Exemplo');
  assert.deepEqual(calls.find(c=>c.url.endsWith('/perfil')).body,{nickname:'Flor de Exemplo'});
  const bad=createApi(async()=>new Response(JSON.stringify({error:{code:'INVALID_INPUT',fields:{nickname:'Revise o apelido.'}}}),{status:422}));
  await assert.rejects(bad.request('/me/perfil'),e=>e.fields?.nickname==='Revise o apelido.');
});
test('010: exact name snapshot survives uncertainty, invalidation and newer basket inputs, then is erased',async()=>{
  const calls=[];let fail=true;
  const model=createCheckout({session:async()=>({user:{id:'fixture',role:'CUSTOMER'}}),random:()=> 'fixture-key',request:async(p,o)=>{
    if(p.endsWith('quote'))return quote();
    calls.push(o);if(fail){fail=false;throw Object.assign(Error('Incerta'),{status:503});}return receipt();
  }});
  await model.preview({recipientFullName:'  Áurea de Exemplo  '});
  await assert.rejects(model.confirm());
  assert.equal(model.state().attempt.recipientFullName,'Áurea de Exemplo');
  model.invalidate();await assert.rejects(model.preview({recipientFullName:'Outra Pessoa Fictícia'}),/pendente/);
  await model.confirm();assert.deepEqual(calls[0],calls[1]);
  assert.deepEqual(calls[0].body,{quoteId:Q,recipientFullName:'Áurea de Exemplo'});
  assert.equal(model.state().attempt,null);assert.equal(model.state().quote,null);
});
test('010: name edit during pending session or quote discards stale preview',async()=>{
  let finish,posts=0;
  const model=createCheckout({session:async()=>({user:{id:'a',role:'CUSTOMER'}}),request:()=>{posts++;return new Promise(r=>{finish=r;});}});
  const pending=model.preview({recipientFullName:'Exemplo Um'});await pump();model.invalidate();finish(quote());
  assert.equal(await pending,null);assert.equal(model.state().quote,null);assert.equal(posts,1);
  let finishSession;
  const early=createCheckout({session:()=>new Promise(r=>{finishSession=r;}),request:async()=>{throw Error('Must not submit obsolete input');}});
  const wait=early.preview({recipientFullName:'Exemplo Dois'});early.invalidate();finishSession({user:{id:'a',role:'CUSTOMER'}});
  assert.equal(await wait,null);
});
test('010: consumed/idempotency conflict require purchases check; stale/expired allow new review',async()=>{
  for(const code of ['QUOTE_STALE','QUOTE_EXPIRED','QUOTE_CONSUMED','IDEMPOTENCY_CONFLICT']){
    const model=createCheckout({session:async()=>({user:{id:'a',role:'CUSTOMER'}}),request:async p=>{if(p.endsWith('quote'))return quote();throw Object.assign(Error('Conflito'),{status:409,code});}});
    await model.preview({recipientFullName:'Nome Fictício'});await assert.rejects(model.confirm());
    assert.equal(model.state().attempt,null);assert.equal(model.state().quote,null);
    if(['QUOTE_CONSUMED','IDEMPOTENCY_CONFLICT'].includes(code)){
      assert.equal(model.state().recovery,'purchases');await assert.rejects(model.preview({recipientFullName:'Nome Fictício'}),/compras/i);
      model.acknowledgePurchases();await model.preview({recipientFullName:'Nome Fictício'});
    }else await model.preview({recipientFullName:'Nome Fictício'});
  }
});
function accountFixture({user=null,query=''}={}){
  const listeners=new Map(),nodes=new Map(),calls=[],focus=[];
  let pendingDetail;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',textContent:'',value:'',attrs:{},addEventListener(){},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},getAttribute(k){return this.attrs[k];},focus(){focus.push(id);document.activeElement=this;}});return nodes.get(id);};
  const document={body:{},documentElement:{dataset:{}},activeElement:null,addEventListener:(k,fn)=>listeners.set(k,fn),querySelectorAll:()=>[]};document.activeElement=document.body;
  const window={addEventListener:(k,fn)=>listeners.set('window:'+k,fn)};
  const order={id:Q,demo:true,status:'PENDENTE',recipientFullName:'Áurea de Exemplo',items:[],statusHistory:[],subtotalCents:10,merchDiscountCents:0,shippingCents:0,shippingDiscountCents:0,totalCents:10,shippingName:'Correios'};
  const api={getSession:async()=>({user}),request:async p=>p.includes('/me/pedidos/')?new Promise(r=>{pendingDetail=()=>r(order);}):{items:[],nextCursor:null},auth:async(...args)=>{calls.push(args);},updateProfile:async nickname=>({user:{...user,nickname},csrfToken:'fixture-token'})};
  const context={document,window,location:{search:query},history:{pushState(){}},URLSearchParams,TextEncoder,api,errorMessage,escape,money,...schema,$:s=>node(s.slice(1)),initShopNavigation(){},enterPage(){}};
  runInNewContext(source('../src/shop/account.js')+'\nthis.sessionHTML=sessionMarkup;',context);
  return{context,nodes,focus,calls,document,listeners,node,resolveDetail:()=>pendingDetail?.(),html:()=>context.sessionHTML()};
}
test('010: actual account markup separates registration nickname and legacy username; escapes greeting',async()=>{
  const f=accountFixture();await pump();
  assert.equal((f.html().match(/>Nome de usuário<\/label>/g)||[]).length,2);
  assert.equal((f.html().match(/name="nickname"/g)||[]).length,1);
  const legacy=accountFixture({user:{id:'a',login:'teste_a',nickname:null,role:'CUSTOMER'}});await pump();
  assert.match(legacy.html(),/Nome de usuário/);assert.doesNotMatch(legacy.html(),/Olá,\s*<strong>teste_a/);
  const named=accountFixture({user:{id:'a',login:'teste_a',nickname:'Flor <em>da LUA</em>',role:'CUSTOMER'}});await pump();
  assert.match(named.html(),/Flor &lt;em&gt;da LUA&lt;\/em&gt;/);assert.doesNotMatch(named.html(),/Flor <em>/);
});
test('010: actual account passive query never focuses; explicit detail cancels focus after new intent',async()=>{
  const f=accountFixture({user:{id:'a',login:'teste',role:'CUSTOMER'},query:'?pedido='+Q});await pump();f.resolveDetail();await pump();
  assert.deepEqual(f.focus,[]);assert.match(f.node('account-order-detail').innerHTML,/Nome completo/);
  const link={href:'/conta.html?pedido='+Q,dataset:{order:Q}};
  const explicit=f.listeners.get('click')({preventDefault(){},target:{closest:s=>s==='[data-order]'?link:null}});await pump();f.resolveDetail();await explicit;
  assert.equal(f.focus.at(-1),'order-detail-title');
  const count=f.focus.length;
  const later=f.listeners.get('click')({preventDefault(){},target:{closest:s=>s==='[data-order]'?link:null}});await pump();
  f.listeners.get('pointerdown')?.({});f.document.activeElement=f.node('other-control');f.resolveDetail();await later;
  assert.equal(f.focus.length,count);
});
test('010: actual profile submit updates only greeting/session, retains form, does not refresh orders or logout',async()=>{
  const f=accountFixture({user:{id:'a',login:'teste_a',nickname:null,role:'CUSTOMER'}});await pump();
  const input=f.node('profile-nickname');input.value='  Lótus da LUA  ';
  const error=f.node('profile-error'),button={disabled:false},form={elements:{nickname:input},setAttribute(){},querySelector:s=>s==='.detail-error'?error:button};
  await f.listeners.get('submit')({preventDefault(){},target:{closest:s=>s==='[data-profile]'?form:null}});
  assert.equal(input.value,'Lótus da LUA');assert.match(f.node('account-greeting').innerHTML,/Lótus da LUA/);assert.equal(button.disabled,false);
  assert.equal(f.node('profile-nickname'),input);assert.equal(f.calls.length,0);assert.match(f.html(),/Nome de usuário/);
});
test('010: load sources retain skip/focus-visible and do not focus hero/PDP automatically',()=>{
  const main=source('../src/main.js'),product=source('../src/product.js');
  assert.doesNotMatch(main,/\$\('#hero-title'\)\.focus/);
  assert.doesNotMatch(product,/\$\('#product-title'\)\?\.focus/);
  for(const p of ['../index.html','../conta.html','../produto.html'])assert.match(readFileSync(new URL(p,import.meta.url),'utf8'),/class="skip-link"/);
  assert.match(readFileSync(new URL('../src/styles.css',import.meta.url),'utf8'),/:focus-visible/);
});
