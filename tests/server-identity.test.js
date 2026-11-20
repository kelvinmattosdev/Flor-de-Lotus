import test from 'node:test';
import assert from 'node:assert/strict';
import {argon2, createHash, createHmac, randomBytes, randomUUID} from 'node:crypto';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {request} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Database} from 'node:sqlite';
import {promisify} from 'node:util';
import {createApp} from '../server/index.js';
import {openDatabase} from '../server/db.js';
import {createUser} from '../server/auth.js';
import {schemaV1} from '../server/schema.js';
import {seedV1} from '../server/seed.js';

const TEST_TEMP = process.env.FDL_TEST_TEMP ?? (process.platform === 'win32' && process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA,'Temp','opencode') : tmpdir());
const SHOP = 'https://loja.example.test', OPS = 'https://operador.example.test';
const APP_ID = 0x46444c20;
const PRODUCT = 'FDL-CRAFT-MORANGO';
const NAME = 'Árdea  d’Êxito-Modelo';
const OTHER_NAME = 'Íris da Simulação';
const NICK = 'Nína  <Sebo & Arte>';
const statuses = ['PENDENTE','PROCESSANDO','ENVIADO','ENTREGUE'];
const checkout = {
  items:[{productId:PRODUCT,variant:'',quantity:1}], shippingId:'correios', paymentMethod:'PIX_SIMULADO', couponCodes:[]
};
const sha = value => createHash('sha256').update(value).digest('hex');
const password = () => randomUUID(); // Only synthetic, never emitted by assertions or logs.
const file = dir => join(dir,'flor-de-lotus.sqlite');

async function fixture(t) {
  const root = await mkdtemp(join(TEST_TEMP,'identity-fixture-'));
  const apps = [];
  t.after(async () => {
    for (const app of apps) await app.close();
    await rm(root,{recursive:true,force:true});
  });
  const staticDir = join(root,'filtered');
  const dataDir = join(root,'data');
  await mkdir(staticDir);
  await mkdir(dataDir,{mode:0o700});
  const pages = ['index.html','produto.html','conta.html','operador.html'];
  for (const page of pages) await writeFile(join(staticDir,page),'fixture demonstração');
  await writeFile(join(staticDir,'fdl-static.json'),JSON.stringify({version:1,files:pages}));
  return {
    dataDir, root,
    async start(now) {
      const app = createApp({dataDir,staticDir,shopOrigin:SHOP,operatorOrigin:OPS,now});
      apps.push(app);
      const {port} = await app.listen({port:0});
      return {port,close:() => app.close()};
    }
  };
}

// Test the configured Host/origin over loopback, without external DNS or TLS.
function client(origin, state = {}) {
  const host = new URL(origin).host;
  return async (port, path, {method='GET', body, headers={}, key} = {}) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const response = await new Promise((resolve,reject) => {
      const req = request({host:'127.0.0.1',port,path:`/api/v1${path}`,method,signal:AbortSignal.timeout(6000),headers:{
        Host:host,
        ...(state.cookie ? {Cookie:state.cookie} : {}),
        ...(method !== 'GET' ? {Origin:origin,'X-CSRF-Token':state.csrf ?? '', 'Content-Type':'application/json'} : {}),
        ...(data !== undefined ? {'Content-Length':Buffer.byteLength(data)} : {}),
        ...(key ? {'Idempotency-Key':key} : {}),
        ...headers
      }},res => {
        const chunks = [];
        res.on('data',chunk => chunks.push(chunk));
        res.on('error',reject);
        res.on('end',() => {
          try {
            const raw = Buffer.concat(chunks);
            resolve({status:res.statusCode,headers:res.headers,body:raw.length ? JSON.parse(raw.toString('utf8')) : null});
          } catch (error) { reject(error); }
        });
      });
      req.on('error',reject);
      req.end(data);
    });
    if (response.headers['set-cookie']) state.cookie = response.headers['set-cookie'][0].split(';',1)[0];
    if (response.body?.csrfToken) state.csrf = response.body.csrfToken;
    return response;
  };
}

const send = (call,port,path,body,options={}) => call(port,path,{method:'POST',body,...options});
const patch = (call,port,path,body,options={}) => call(port,path,{method:'PATCH',body,...options});
function expect(result,status,code,field) {
  assert.equal(result.status,status,result.body?.error?.code);
  if (code) assert.equal(result.body?.error?.code,code);
  if (field) assert.ok(Object.hasOwn(result.body.error.fields,field),'Campo inválido precisa ser apontado sem ecoar seu valor.');
  return result.body;
}
function noName(result) {
  const json = JSON.stringify(result);
  assert.ok(!json.includes('recipientFullName') && !json.includes(NAME) && !json.includes(OTHER_NAME),
    'Resposta fora do detalhe autorizado não deve ter o nome.');
}
async function signIn(call,port,credentials) {
  expect(await call(port,'/session'),200);
  return expect(await send(call,port,'/auth/login',credentials),200).user;
}
async function register(call,port,credentials,nickname=NICK) {
  expect(await call(port,'/session'),200);
  return expect(await send(call,port,'/auth/register',{...credentials,nickname}),201).user;
}

const v1Tables = ['users','customers','sessions','categories','listings','listing_images','coupons','coupon_pairs',
  'quotes','orders','order_items','order_coupon_snapshots','order_status_events','purchases'];
const oldColumns = db => v1Tables.map(table => [table,db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name)]);
const oldRows = (db,columns) => JSON.stringify(columns.map(([table,cols]) =>
  db.prepare(`SELECT ${cols.join(',')} FROM ${table} ORDER BY rowid`).all()));

async function fixtureHash(phrase) {
  const nonce = randomBytes(16);
  const tag = await promisify(argon2)('argon2id',{message:phrase,nonce,memory:19*1024,passes:2,parallelism:1,tagLength:32});
  return `argon2id:1:${nonce.toString('base64url')}:${tag.toString('base64url')}`;
}

async function buildV1(dir,at) {
  const credentials = {login:'legado-da-demo',password:password()};
  const staff = {login:'operador-da-demo',password:password()};
  const hashed = [await fixtureHash(credentials.password),await fixtureHash(staff.password)];
  const [userId,staffId,customerId,orderId,purchaseId,soldQuote,key,couponId,couponOther] = Array.from({length:9},() => randomUUID());
  const [rawCustomer,rawOperator] = Array.from({length:2},() => randomBytes(32).toString('base64url'));
  const customerState = {cookie:`__Host-fdl_customer=${rawCustomer}`};
  const staffState = {cookie:`__Host-fdl_operator=${rawOperator}`};
  const db = new Database(file(dir),{enableForeignKeyConstraints:true});
  try {
    db.exec('BEGIN');
    db.exec(schemaV1);
    seedV1(db);
    db.exec(`PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;`);
    const createdAt = new Date(at-1000).toISOString();
    const users = db.prepare('INSERT INTO users(id,login,role,password_hash,created_at) VALUES(?,?,?,?,?)');
    users.run(userId,credentials.login,'CUSTOMER',hashed[0],createdAt);
    users.run(staffId,staff.login,'OPERATOR',hashed[1],createdAt);
    db.prepare('INSERT INTO customers(id,user_id) VALUES(?,?)').run(customerId,userId);
    const session = db.prepare('INSERT INTO sessions(token_hash,user_id,origin,expires_at) VALUES(?,?,?,?)');
    session.run(sha(rawCustomer),userId,SHOP,at+8*60*60_000);
    session.run(sha(rawOperator),staffId,OPS,at+2*60*60_000);
    db.prepare('UPDATE listings SET name=?,version=2 WHERE id=?').run('Peça alterada na demo v1',PRODUCT);
    const coupon = db.prepare(`INSERT INTO coupons(id,code,scope,descendants,minimum,percent,free_shipping,stackable,active)
      VALUES(?,?,'GLOBAL',0,0,?,0,1,1)`);
    coupon.run(couponId,'DEMO-V1',1000);
    coupon.run(couponOther,'DEMO-V1-DOIS',500);
    db.prepare("INSERT INTO coupon_pairs(first,second,rule) VALUES(?,?,'ALLOW')").run(...[couponId,couponOther].sort());
    const {name,price} = db.prepare('SELECT name,price FROM listings WHERE id=?').get(PRODUCT);
    const discount = Math.floor(price/10), shipping = 1890, total = price-discount+shipping;
    db.prepare(`INSERT INTO orders(id,customer_id,quote_id,idem_key,created_at,status,subtotal,discount,shipping_id,
      shipping_name,shipping,shipping_discount,total) VALUES(?,?,?,?,?,'ENVIADO',?,?,'correios','Correios',?,0,?)`)
      .run(orderId,customerId,soldQuote,key,createdAt,price,discount,shipping,total);
    db.prepare("INSERT INTO order_items(order_id,product_id,variant,quantity,name,unit_price,discount) VALUES(?,?,'',1,?,?,?)")
      .run(orderId,PRODUCT,name,price,discount);
    db.prepare("INSERT INTO order_coupon_snapshots VALUES(? ,0,'DEMO-V1',?,0)").run(orderId,discount);
    db.prepare("INSERT INTO purchases(id,order_id,created_at,payment_method) VALUES(?,?,?,'PIX_SIMULADO')")
      .run(purchaseId,orderId,createdAt);
    const event = db.prepare('INSERT INTO order_status_events(order_id,status,ordinal,created_at) VALUES(?,?,?,?)');
    for (let i=0;i<3;i++) event.run(orderId,statuses[i],i,new Date(at-1000+i).toISOString());
    const quote = db.prepare('INSERT INTO quotes(id,customer_id,input,fingerprint,expires_at) VALUES(?,?,?,?,?)');
    const payload = JSON.stringify(checkout), fingerprint = sha(payload);
    let activeQuote, expiredQuote;
    // Fill both old quotas using 40 active rows and 9,960 expired, retained rows.
    for (let i=0;i<10000;i++) {
      const id = randomUUID();
      if (i===0) activeQuote = id;
      if (i===40) expiredQuote = id;
      quote.run(id,customerId,payload,fingerprint,i<40 ? at+60000 : at-1000);
    }
    db.exec('COMMIT');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);
    const columns = oldColumns(db);
    const baseline = oldRows(db,columns);
    const receipt = {orderId,createdAt,demo:true,status:'PENDENTE',totalCents:total,
      purchase:{id:purchaseId,createdAt,paymentMethod:'PIX_SIMULADO',state:'SIMULADO',demo:true}};
    return {credentials,staff,userId,staffId,customerState,staffState,activeQuote,expiredQuote,soldQuote,key,orderId,receipt,columns,baseline};
  } finally { db.close(); }
}

test('identidade: v1 genuíno migra sem reset; sessões, FK, histórico, replay e cotações legadas', {timeout:30000}, async t => {
  const f = await fixture(t);
  const at = Date.now();
  const old = await buildV1(f.dataDir,at);
  const migrated = openDatabase({dataDir:f.dataDir});
  try {
    assert.equal(migrated.prepare('PRAGMA application_id').get().application_id,APP_ID);
    assert.equal(migrated.prepare('PRAGMA user_version').get().user_version,2);
    assert.equal(migrated.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
    assert.equal(migrated.prepare('PRAGMA foreign_key_check').all().length,0);
    assert.ok(oldRows(migrated,old.columns) === old.baseline,'Bytes lógicos de todas as tabelas v1 preservados.');
    for (const [table,column] of [['customers','nickname'],['orders','recipient_full_name'],['quotes','recipient_binding']]) {
      assert.equal(migrated.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} IS NOT NULL`).get().n,0);
    }
  } finally { migrated.close(); }

  const owner = client(SHOP,old.customerState), staff = client(OPS,old.staffState);
  const app = await f.start(() => at);
  const port = app.port;
  const previous = expect(await owner(port,'/session'),200);
  assert.deepEqual(previous.user,{id:old.userId,login:old.credentials.login,role:'CUSTOMER',nickname:null});
  assert.deepEqual(expect(await staff(port,'/session'),200).user,{id:old.staffId,login:old.staff.login,role:'OPERATOR'});
  const known = expect(await owner(port,`/me/pedidos/${old.orderId}`),200);
  assert.equal(known.recipientFullName,null);
  assert.deepEqual(known.statusHistory.map(event => event.status),statuses.slice(0,3));
  assert.deepEqual(expect(await send(owner,port,'/pedidos',{quoteId:old.soldQuote},{key:old.key}),200),old.receipt);
  expect(await send(owner,port,'/pedidos',{quoteId:old.soldQuote,recipientFullName:NAME},{key:old.key}),409,'IDEMPOTENCY_CONFLICT');
  expect(await send(owner,port,'/pedidos',{quoteId:old.soldQuote},{key:randomUUID()}),409,'QUOTE_CONSUMED');
  expect(await send(owner,port,'/pedidos',{quoteId:old.activeQuote,recipientFullName:NAME},{key:randomUUID()}),409,'QUOTE_STALE');
  expect(await send(owner,port,'/pedidos',{quoteId:old.expiredQuote,recipientFullName:NAME},{key:randomUUID()}),409,'QUOTE_EXPIRED');
  expect(await send(owner,port,'/checkout/quote',{...checkout,recipientFullName:NAME}),200);
  const saved = await patch(owner,port,'/me/perfil',{nickname:'  Nóva  Alcunha  '});
  const profile = expect(saved,200);
  assert.ok(profile.csrfToken === previous.csrfToken && !saved.headers['set-cookie'],'Perfil não gira sessão nem CSRF.');
  assert.deepEqual(profile.user,{...previous.user,nickname:'Nóva  Alcunha'});
  const status = expect(await patch(staff,port,`/operador/pedidos/${old.orderId}/status`,
    {expectedStatus:'ENVIADO',to:'ENTREGUE'}),200);
  assert.equal(status.recipientFullName,null);
  assert.deepEqual(status.statusHistory.slice(0,3),known.statusHistory);
  await app.close();

  const reopened = await f.start(() => at);
  assert.deepEqual(expect(await owner(reopened.port,'/session'),200).user,profile.user);
  assert.deepEqual(await signIn(owner,reopened.port,{...old.credentials,login:old.credentials.login.toUpperCase()}),profile.user);
  assert.deepEqual(await signIn(staff,reopened.port,old.staff),{id:old.staffId,login:old.staff.login,role:'OPERATOR'});
  assert.deepEqual(expect(await send(owner,reopened.port,'/pedidos',{quoteId:old.soldQuote},{key:old.key}),200),old.receipt);
  assert.deepEqual(expect(await owner(reopened.port,`/me/pedidos/${old.orderId}`),200).statusHistory.map(row => row.status),statuses);
});

test('identidade: perfil Unicode independente, strict body, Origin/CSRF, papéis e limite', {timeout:15000}, async t => {
  const f = await fixture(t);
  const db = openDatabase({dataDir:f.dataDir});
  const staffCredentials = {login:'operador-fixture',password:password()};
  try { await createUser(db,staffCredentials.login,staffCredentials.password,'OPERATOR',Date.now); }
  finally { db.close(); }
  const {port} = await f.start(Date.now);
  const first = client(SHOP), second = client(SHOP), operator = client(OPS);
  const a = {login:'Flor_DEMO',password:password()}, b = {login:'Outra_DEMO',password:password()};
  expect(await first(port,'/session'),200);
  expect(await send(first,port,'/auth/register',a),422,'INVALID_INPUT','nickname');
  for (const nickname of ['a','🍀'.repeat(61),'ab\u2028cd','ab\u202ecd','\ufeffab','a\u034fb','ab\ud800','ab\tcd']) {
    expect(await send(first,port,'/auth/register',{...a,nickname}),422,'INVALID_INPUT','nickname');
  }
  const u1 = await register(first,port,a,`  ${NICK}   `);
  const u2 = await register(second,port,b,NICK);
  assert.equal(u1.login,'flor_demo');
  assert.equal(u1.nickname,NICK);
  assert.equal(u2.nickname,NICK);
  const op = await signIn(operator,port,staffCredentials);
  assert.ok(!Object.hasOwn(op,'nickname'));
  expect(await patch(operator,port,'/me/perfil',{nickname:'Proibido'}),403,'FORBIDDEN');
  expect(await patch(client(SHOP),port,'/me/perfil',{nickname:'Proibido'}),401,'AUTH_REQUIRED');
  expect(await patch(first,port,'/me/perfil',{nickname:'Proibido'},{headers:{Origin:OPS}}),403,'ORIGIN_DENIED');
  expect(await patch(first,port,'/me/perfil',{nickname:'Proibido'},{headers:{'X-CSRF-Token':'invalido'}}),403,'CSRF_INVALID');
  for (const field of ['login','id','password','recipientFullName','role']) {
    expect(await patch(first,port,'/me/perfil',{nickname:'Proibido',[field]:'fictício'}),422,'INVALID_INPUT');
  }
  const changed = expect(await patch(first,port,'/me/perfil',{nickname:'  '+'🍀'.repeat(60)+'  '}),200).user;
  assert.deepEqual(changed,{...u1,nickname:'🍀'.repeat(60)});
  assert.deepEqual(expect(await second(port,'/session'),200).user,u2);
  const customerList = expect(await operator(port,'/operador/clientes'),200);
  assert.deepEqual(customerList.items.map(row => [row.login,row.nickname]),[[u1.login,changed.nickname],[u2.login,u2.nickname]]);
  assert.deepEqual(await signIn(first,port,a),changed);
  for (let i=0;i<12;i++) expect(await patch(second,port,'/me/perfil',{nickname:`Demo ${i}`}),200);
  const cap = await patch(second,port,'/me/perfil',{nickname:'Outro apelido'});
  expect(cap,429,'RATE_LIMITED');
  assert.ok(Number(cap.headers['retry-after'])>0);
});

test('identidade: vínculo HMAC sem nome na prévia, snapshot privado e replay após troca de sessão, restart e expiração', {timeout:30000}, async t => {
  const f = await fixture(t);
  const staffCredentials = {login:'operador-fixture',password:password()};
  const db = openDatabase({dataDir:f.dataDir});
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM listings').get().n,12);
    await createUser(db,staffCredentials.login,staffCredentials.password,'OPERATOR',Date.now);
  } finally { db.close(); }
  let at = Date.now();
  const a = {login:'cliente-fixture',password:password()}, b = {login:'outro-fixture',password:password()};
  const state = {};
  const first = client(SHOP,state), second = client(SHOP), operator = client(OPS);
  const app = await f.start(() => at);
  const ownerUser = await register(first,app.port,a);
  await register(second,app.port,b,'Outra pessoa de teste');
  for (const recipientFullName of [undefined,'x','...','Nome 2','<Nome>','Nome\nDemo','Nome\u200d','Nome\ud800','Á'.repeat(121)]) {
    const error = expect(await send(first,app.port,'/checkout/quote',{...checkout,recipientFullName}),422,'INVALID_INPUT','recipientFullName');
    if (typeof recipientFullName === 'string' && recipientFullName.length >= 3) {
      assert.ok(!JSON.stringify(error).includes(recipientFullName),'Uma recusa não deve devolver o valor digitado.');
    }
  }
  expect(await send(first,app.port,'/checkout/quote',{...checkout,recipientFullName:NAME,email:'fixture@example.test'}),422,'INVALID_INPUT');
  const reviewed = expect(await send(first,app.port,'/checkout/quote',{...checkout,recipientFullName:`  ${NAME}  `}),200);
  const pending = expect(await send(first,app.port,'/checkout/quote',{...checkout,recipientFullName:NAME}),200);
  noName(reviewed);
  await app.close();
  const before = openDatabase({dataDir:f.dataDir});
  try {
    const quote = before.prepare('SELECT * FROM quotes WHERE id=?').get(reviewed.quoteId);
    const other = before.prepare('SELECT * FROM quotes WHERE id=?').get(pending.quoteId);
    const raw = state.cookie.slice(state.cookie.indexOf('=')+1);
    assert.deepEqual(JSON.parse(quote.input),checkout);
    assert.ok(!JSON.stringify(quote).includes(NAME) && !JSON.stringify(quote).includes(raw));
    assert.ok(/^[a-f0-9]{64}$/.test(quote.recipient_binding),'Vínculo usa digest hexadecimal de 256 bits.');
    const expected = createHmac('sha256',raw)
      .update(JSON.stringify(['flor-de-lotus:recipient-binding:v2',reviewed.quoteId,quote.customer_id,NAME])).digest('hex');
    assert.ok(quote.recipient_binding === expected && quote.recipient_binding !== other.recipient_binding);
    assert.ok(quote.fingerprint === other.fingerprint,'Fingerprint de preços não depende do vínculo nominal.');
    assert.equal(before.prepare('SELECT count(*) AS n FROM orders').get().n,0);
    assert.equal(before.prepare('SELECT count(*) AS n FROM sessions WHERE token_hash=?').get(raw).n,0);
    assert.equal(before.prepare('SELECT count(*) AS n FROM sessions WHERE token_hash=?').get(sha(raw)).n,1);
  } finally { before.close(); }

  const restarted = await f.start(() => at);
  const port = restarted.port;
  const key = randomUUID(), input = {quoteId:reviewed.quoteId,recipientFullName:NAME};
  const confirm = (call,body,requestKey=key) => send(call,port,'/pedidos',body,{key:requestKey});
  expect(await confirm(second,input),404,'NOT_FOUND');
  expect(await confirm(first,{quoteId:reviewed.quoteId}),422,'INVALID_INPUT','recipientFullName');
  expect(await confirm(first,{...input,recipientFullName:OTHER_NAME}),409,'QUOTE_STALE');
  const commits = await Promise.all([confirm(first,input),confirm(first,{...input,recipientFullName:` ${NAME} `})]);
  assert.deepEqual(commits.map(row => row.status).sort(),[200,201]);
  const receipt = commits[0].body;
  assert.deepEqual(commits[1].body,receipt);
  noName(receipt);
  expect(await confirm(first,input,randomUUID()),409,'QUOTE_CONSUMED');
  expect(await confirm(first,{...input,quoteId:pending.quoteId}),409,'IDEMPOTENCY_CONFLICT');
  expect(await confirm(first,{...input,recipientFullName:OTHER_NAME}),409,'IDEMPOTENCY_CONFLICT');
  expect(await confirm(first,{...input,recipientFullName:'...'}),422,'INVALID_INPUT','recipientFullName');
  expect(await confirm(first,{quoteId:reviewed.quoteId}),422,'INVALID_INPUT','recipientFullName');
  assert.deepEqual(await signIn(first,port,a),ownerUser);
  expect(await confirm(first,{...input,quoteId:pending.quoteId},randomUUID()),409,'QUOTE_STALE');

  await signIn(operator,port,staffCredentials);
  const path = `/me/pedidos/${receipt.orderId}`;
  const opPath = `/operador/pedidos/${receipt.orderId}`;
  const mine = expect(await first(port,path),200);
  assert.equal(mine.recipientFullName,NAME);
  assert.equal(expect(await operator(port,opPath),200).recipientFullName,NAME);
  expect(await second(port,path),404,'NOT_FOUND');
  expect(await first(port,opPath),403,'FORBIDDEN');
  expect(await operator(port,path),403,'FORBIDDEN');
  noName(expect(await first(port,'/session'),200));
  noName(expect(await operator(port,'/operador/clientes'),200));
  noName(expect(await operator(port,'/operador/pedidos'),200));
  noName(expect(await first(port,'/catalogo/anuncios'),200));
  const list = expect(await first(port,'/me/pedidos'),200);
  noName(list);
  assert.equal(list.items.length,1);
  expect(await patch(first,port,'/me/perfil',{nickname:'Novo apelido de teste'}),200);
  for (let i=1;i<statuses.length;i++) {
    const result = expect(await patch(operator,port,`${opPath}/status`,{expectedStatus:statuses[i-1],to:statuses[i]}),200);
    assert.equal(result.recipientFullName,NAME);
    assert.deepEqual(result.statusHistory.map(event => event.status),statuses.slice(0,i+1));
  }
  await restarted.close();
  at += 600_001;
  const last = await f.start(() => at);
  const p = last.port;
  expect(await send(first,p,'/pedidos',{...input,quoteId:pending.quoteId},{key:randomUUID()}),409,'QUOTE_EXPIRED');
  assert.deepEqual(expect(await send(first,p,'/pedidos',input,{key}),200),receipt);
  for (let i=0;i<45;i++) {
    const status = i<40 ? 200 : 429;
    expect(await send(first,p,'/checkout/quote',{...checkout,recipientFullName:NAME}),status);
  }
  assert.deepEqual(expect(await send(first,p,'/pedidos',input,{key}),200),receipt);
  const stillMine = expect(await first(p,path),200);
  assert.equal(stillMine.recipientFullName,NAME);
  assert.equal(stillMine.status,'ENTREGUE');
  assert.deepEqual(stillMine.purchase,mine.purchase);
  assert.equal(expect(await first(p,'/me/pedidos'),200).items.length,1);
});

test('identidade: ALTER intermediário falha sem migration parcial; marca errada e versão desconhecida não reinicializam', {timeout:12000}, async t => {
  const f = await fixture(t);
  for (const [name,id,version,alter] of [
    ['alter-interrompido',APP_ID,1,true],['versao-desconhecida',APP_ID,9,false],['marca-errada',0x41424344,1,false]
  ]) {
    const dir = join(f.root,name);
    await mkdir(dir,{mode:0o700});
    const db = new Database(file(dir));
    try {
      db.exec(schemaV1);
      db.exec(`PRAGMA application_id=${id}; PRAGMA user_version=${version};`);
      if (alter) db.exec('ALTER TABLE orders ADD COLUMN recipient_full_name TEXT;');
    } finally { db.close(); }
    assert.throws(() => {
      const unexpected = openDatabase({dataDir:dir});
      unexpected.close();
    }, alter ? /duplicate column/i : /Formato de dados não reconhecido/);
    const inspect = new Database(file(dir),{readOnly:true});
    try {
      assert.equal(inspect.prepare('PRAGMA application_id').get().application_id,id);
      assert.equal(inspect.prepare('PRAGMA user_version').get().user_version,version);
      assert.ok(!inspect.prepare('PRAGMA table_info(customers)').all().some(row => row.name==='nickname'));
      assert.ok(!inspect.prepare('PRAGMA table_info(quotes)').all().some(row => row.name==='recipient_binding'));
    } finally { inspect.close(); }
  }
});
