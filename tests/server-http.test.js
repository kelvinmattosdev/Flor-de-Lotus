import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createApp } from '../server/index.js';
import { openDatabase } from '../server/db.js';
import { createUser } from '../server/auth.js';

const API = '/api/v1';
const project = fileURLToPath(new URL('..', import.meta.url));
const authorizedTemp = process.env.FDL_TEST_TEMP ?? (process.platform === 'win32' && process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : tmpdir());
const PNG_MIME = 'image/png';
const JPEG_MIME = 'image/jpeg';
const statuses = ['PENDENTE', 'PROCESSANDO', 'ENVIADO', 'ENTREGUE'];
const cleanup = new WeakMap();
const fakeLogin = () => `demo-${randomUUID().slice(0, 12)}`;
const fakePassword = () => randomUUID();

async function fixtures(t) {
  const dir = await mkdtemp(join(authorizedTemp, 'server-http-fixture-'));
  const apps = [];
  cleanup.set(t, apps);
  t.after(async () => {
    await Promise.all(apps.map(app => app.close()));
    await rm(dir, {recursive:true, force:true});
  });
  const staticDir = join(dir, 'filtered');
  const dataDir = join(dir, 'private-demo');
  await mkdir(staticDir);
  await mkdir(join(staticDir, 'images', 'referencias'), {recursive:true});
  await mkdir(join(staticDir, 'images', 'artesanato'), {recursive:true});
  await mkdir(join(staticDir, 'assets'));
  const entries = {'index.html': 'home demo', 'produto.html': 'pdp demo', 'conta.html': 'account demo',
    'operador.html': 'operator demo', 'assets/test-A1a2A3a4.js': 'export {};', 'images/artesanato/brincos-morango-160.jpg': 'fake derivative'};
  for (const [path, value] of Object.entries(entries)) await writeFile(join(staticDir, path), value);
  // Harmless fixtures intentionally outside the manifest, not originals or credentials.
  await writeFile(join(staticDir, 'images', 'referencias', 'exemplo.jpg'), 'private fixture');
  await writeFile(join(staticDir, 'not-listed.txt'), 'private fixture');
  await writeFile(join(staticDir, 'fdl-static.json'), JSON.stringify({version:1, files:Object.keys(entries)}));
  return {dir, staticDir, dataDir};
}

async function start(t, options) {
  const app = createApp(options);
  try {
    const {port} = await app.listen({port:0});
    cleanup.get(t).push(app);
    return {app, port, shop:`http://127.0.0.1:${port}`, op:`http://localhost:${port}`};
  } catch (error) {
    await app.close();
    throw error;
  }
}

function jar() { return {cookie:undefined, csrf:undefined}; }

async function response(origin, path, {method='GET', state, body, type, headers={}, setCookie=true} = {}) {
  const allHeaders = {...headers};
  if (state?.cookie !== undefined && !Object.hasOwn(allHeaders, 'Cookie')) allHeaders.Cookie = state.cookie;
  if (!['GET', 'HEAD'].includes(method)) {
    if (!Object.hasOwn(headers, 'Origin')) allHeaders.Origin = origin;
    if (state?.csrf && !Object.hasOwn(headers, 'X-CSRF-Token')) allHeaders['X-CSRF-Token'] = state.csrf;
    allHeaders['Content-Type'] = type ?? 'application/json';
  }
  const res = await fetch(`${origin}${path}`, {method, headers:allHeaders,
    body: body === undefined ? undefined : type ? body : JSON.stringify(body),
    redirect:'error', signal:AbortSignal.timeout(8000)});
  const buffer = Buffer.from(await res.arrayBuffer());
  const data = res.headers.get('content-type')?.includes('application/json') && buffer.length
    ? JSON.parse(buffer.toString('utf8')) : undefined;
  const cookie = res.headers.getSetCookie()[0];
  if (state && setCookie) {
    if (cookie) state.cookie = cookie.split(';')[0];
    if (data?.csrfToken) state.csrf = data.csrfToken;
  }
  return {status:res.status, data, buffer, headers:res.headers, cookie};
}

function expect(result, status, code) {
  assert.equal(result.status, status, result.data?.error?.code);
  if (code) assert.equal(result.data?.error?.code, code);
  return result.data;
}

const api = (origin, path, opts) => response(origin, `${API}${path}`, opts);
const post = (origin, path, state, body, more) => api(origin, path, {method:'POST', state, body, ...more});
const patch = (origin, path, state, body) => api(origin, path, {method:'PATCH', state, body});
const put = (origin, path, state, body) => api(origin, path, {method:'PUT', state, body});
const authStart = (origin, state) => api(origin, '/session', {state});
async function signup(origin, credentials = {login:fakeLogin(), password:fakePassword()}) {
  const state = jar();
  await authStart(origin, state);
  expect(await post(origin, '/auth/register', state, {...credentials, nickname:'Apelido de Teste'}), 201);
  return {state, credentials};
}
async function login(origin, credentials) {
  const state = jar();
  await authStart(origin, state);
  expect(await post(origin, '/auth/login', state, credentials), 200);
  return state;
}

function provision(dataDir, credentials) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server/bootstrap-operador.js', credentials.login], {
      cwd:project, env:{FDL_DATA_DIR:dataDir, ...(process.env.SystemRoot ? {SystemRoot:process.env.SystemRoot} : {})},
      stdio:['pipe','pipe','pipe'], timeout:5000, windowsHide:true
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.stdin.on('error', reject);
    child.once('close', code => resolve({code, output}));
    child.stdin.end(`${credentials.password}\n`);
  });
}

test('HTTP E2E: bootstrap, catálogo → imagem → cupom 7650c → compra → quatro estados → restart', {timeout:30000}, async t => {
  const {dataDir, staticDir} = await fixtures(t);
  const staff = {login:fakeLogin(), password:fakePassword()};
  const bootstrap = await provision(dataDir, staff);
  assert.equal(bootstrap.code, 0, bootstrap.output);
  assert.ok(!bootstrap.output.includes(staff.password) && !bootstrap.output.includes(staff.login));
  assert.equal((await provision(dataDir, staff)).code, 1);
  let at = Date.now();
  const {app, shop, op} = await start(t, {dataDir, staticDir, now:() => at});
  const operator = await login(op, staff);
  const a = await signup(shop);
  const b = await signup(shop);
  const first = a.state, second = b.state;
  assert.equal(expect(await authStart(shop, first), 200).user.role, 'CUSTOMER');
  expect(await authStart(op, operator), 200);
  expect(await api(shop, '/operador/clientes', {state:first}), 403, 'FORBIDDEN');
  expect(await api(op, '/me/pedidos', {state:operator}), 403, 'FORBIDDEN');
  expect(await api(op, '/operador/clientes', {state:first}), 401, 'AUTH_REQUIRED');
  expect(await post(op, '/auth/register', operator, {login:fakeLogin(), password:fakePassword()}), 403, 'FORBIDDEN');

  const seed = expect(await api(shop, '/catalogo/anuncios'), 200).items;
  assert.equal(seed.length, 12);
  assert.equal(seed.filter(item => item.mode === 'ready').length, 10);
  const bubu = seed.find(item => item.id === 'FDL-CRAFT-BUBU');
  assert.equal(bubu.mode, 'custom');
  assert.equal(bubu.priceCents, null);
  assert.ok(seed.every(item => item.gallery.length && item.reviews.every(review => review.demo)));
  const categories = expect(await api(shop, '/catalogo/categorias'), 200).items;
  const art = categories.find(item => item.slug === 'artesanato');
  const firstPage = expect(await api(shop, `/catalogo/anuncios?categoryId=${art.id}&limit=2`), 200);
  assert.equal(firstPage.items.length, 2);
  assert.ok(firstPage.nextCursor);
  expect(await api(shop, `/catalogo/anuncios?cursor=${firstPage.nextCursor}`), 422, 'INVALID_INPUT');
  const nextPage = expect(await api(shop, `/catalogo/anuncios?categoryId=${art.id}&limit=2&cursor=${firstPage.nextCursor}`), 200);
  assert.ok(nextPage.items.every(item => !firstPage.items.some(previous => previous.id === item.id)));

  const root = expect(await post(op, '/operador/categorias', operator, {parentId:null, name:'Nicho de teste', slug:'nicho-demo'}), 201);
  const leaf = expect(await post(op, '/operador/categorias', operator, {parentId:root.id, name:'Subnicho de teste', slug:'subnicho-demo'}), 201);
  expect(await patch(op, `/operador/categorias/${root.id}`, operator, {version:root.version, parentId:leaf.id}), 422, 'INVALID_INPUT');
  expect(await patch(op, `/operador/categorias/${root.id}`, operator, {version:root.version, active:false}), 409, 'STATE_CONFLICT');
  const draft = expect(await post(op, '/operador/anuncios', operator, {
    categoryId:leaf.id, name:'Peça fictícia', detail:'Detalhe demonstrativo', description:'Exemplo local sem venda real.',
    mode:'ready', priceCents:10000, compareAtPriceCents:12000
  }), 201);
  assert.equal(draft.state, 'DRAFT');
  expect(await api(shop, `/catalogo/anuncios/${draft.id}`), 404, 'NOT_FOUND');
  expect(await patch(op, `/operador/anuncios/${draft.id}`, operator, {version:draft.version, state:'PUBLISHED'}), 422, 'INVALID_INPUT');

  const input = await sharp({create:{width:4,height:3,channels:3,background:'#d96f91'}})
    .withMetadata({orientation:6}).png().toBuffer();
  assert.equal((await sharp(input).metadata()).orientation, 6);
  const uploadPath = `/operador/anuncios/${draft.id}/imagens`;
  const uploaded = expect(await post(op, uploadPath, operator, input, {type:PNG_MIME}), 201);
  const publicPath = `${API}/catalogo/imagens/${uploaded.image.id}`;
  expect(await response(shop, publicPath), 404, 'NOT_FOUND');
  assert.equal((await response(op, uploaded.image.src, {state:operator})).headers.get('content-type'), PNG_MIME);
  expect(await response(op, uploaded.image.src), 401, 'AUTH_REQUIRED');
  const listing = expect(await patch(op, `/operador/anuncios/${draft.id}`, operator, {
    version:uploaded.version, state:'PUBLISHED', images:[{id:uploaded.image.id,alt:'Peça de teste',label:'Frente'}]
  }), 200);
  const viewed = await response(shop, publicPath);
  assert.equal(viewed.status, 200);
  assert.equal(viewed.headers.get('x-content-type-options'), 'nosniff');
  const meta = await sharp(viewed.buffer).metadata();
  assert.deepEqual([meta.width,meta.height,meta.orientation,Boolean(meta.exif)], [3,4,undefined,false]);
  const included = expect(await api(shop, `/catalogo/anuncios?categoryId=${root.id}`), 200);
  assert.equal(included.items[0].gallery[0].src, publicPath);
  assert.equal(included.items[0].rootSlug, root.slug);
  assert.deepEqual(expect(await api(shop, `/catalogo/anuncios?categoryId=${root.id}&includeDescendants=false`), 200).items, []);
  assert.deepEqual(expect(await api(shop, `/catalogo/anuncios?ids=${listing.id},FDL-CRAFT-MORANGO,NOT-FOUND`), 200)
    .items.map(row => row.id), [listing.id, 'FDL-CRAFT-MORANGO']);
  expect(await patch(op, `/operador/anuncios/${listing.id}`, operator, {version:1, name:'Conflito'}), 409, 'VERSION_CONFLICT');

  const productCoupon = expect(await post(op, '/operador/cupons', operator, {code:'PECAVINTE', scope:'PRODUCT',
    scopeId:listing.id, percentBps:2000, maxDiscountCents:1500, stackable:true}), 201);
  const categoryCoupon = expect(await post(op, '/operador/cupons', operator, {code:'NICHO10', scope:'CATEGORY',
    scopeId:root.id, percentBps:1000, minSubtotalCents:10000, stackable:true}), 201);
  const shippingCoupon = expect(await post(op, '/operador/cupons', operator, {code:'FRETE', scope:'GLOBAL',
    freeShipping:true, stackable:true}), 201);
  for (const [left,right] of [[productCoupon,categoryCoupon],[categoryCoupon,shippingCoupon],[shippingCoupon,productCoupon]]) {
    expect(await put(op, `/operador/cupons/${left.id}/pares/${right.id}`, operator, {rule:'ALLOW'}), 200);
  }
  const pairs = expect(await api(op, `/operador/cupons/${categoryCoupon.id}/pares`, {state:operator}), 200).items;
  assert.ok(pairs.some(entry => entry.otherCouponId === productCoupon.id && entry.rule === 'ALLOW'));
  const quoteBody = {items:[{productId:listing.id,variant:'',quantity:1}], shippingId:'correios',
    paymentMethod:'PIX_SIMULADO', couponCodes:['nicHO10','pecavinte','frete'], recipientFullName:'Ágata da Simulação'};
  expect(await post(shop, '/checkout/quote', first, {...quoteBody, totalCents:1}), 422, 'INVALID_INPUT');
  expect(await post(shop, '/checkout/quote', first, {...quoteBody, couponCodes:['AA','BB','CC','DD','EE','FF']}), 422, 'INVALID_INPUT');
  const quoteResult = expect(await post(shop, '/checkout/quote', first, quoteBody), 200);
  assert.equal(Date.parse(quoteResult.expiresAt) - at, 600000);
  assert.deepEqual([quoteResult.subtotalCents, quoteResult.merchDiscountCents, quoteResult.shippingCents,
    quoteResult.shippingDiscountCents, quoteResult.totalCents], [10000,2350,1890,1890,7650]);
  assert.deepEqual(quoteResult.appliedCoupons.map(coupon => [coupon.code, coupon.merchDiscountCents, coupon.shippingDiscountCents]),
    [['PECAVINTE',1500,0],['NICHO10',850,0],['FRETE',0,1890]]);

  const confirmation = {quoteId:quoteResult.quoteId, recipientFullName:quoteBody.recipientFullName};
  const key = randomUUID();
  const commit = (state, payload, idem) => post(shop, '/pedidos', state, payload, {headers:{'Idempotency-Key':idem}});
  expect(await commit(second, confirmation, randomUUID()), 404, 'NOT_FOUND');
  const racing = await Promise.all([commit(first, confirmation, key), commit(first, confirmation, key)]);
  assert.deepEqual(racing.map(result => result.status).sort(), [200,201]);
  assert.deepEqual(racing[0].data, racing[1].data);
  const receipt = racing[0].data;
  assert.deepEqual([receipt.status,receipt.totalCents,receipt.purchase.paymentMethod,receipt.purchase.state],
    ['PENDENTE',7650,'PIX_SIMULADO','SIMULADO']);
  expect(await commit(first, confirmation, randomUUID()), 409, 'QUOTE_CONSUMED');
  expect(await api(shop, `/me/pedidos/${receipt.orderId}`, {state:second}), 404, 'NOT_FOUND');
  assert.deepEqual(expect(await api(shop, '/me/pedidos', {state:second}), 200).items, []);
  assert.equal(expect(await api(shop, '/me/pedidos', {state:first}), 200).items.length, 1);
  const clientList = expect(await api(op, '/operador/clientes', {state:operator}), 200).items;
  assert.deepEqual(clientList.map(row => row.login), [a.credentials.login,b.credentials.login]);
  assert.deepEqual(Object.keys(clientList[0]).sort(), ['createdAt','id','login','nickname']);
  const orderPath = `/operador/pedidos/${receipt.orderId}/status`;
  expect(await patch(op, orderPath, operator, {expectedStatus:'PENDENTE',to:'ENVIADO'}), 409, 'STATE_CONFLICT');
  for (let n=1; n<statuses.length; n++) {
    at += 5;
    const request = {expectedStatus:statuses[n-1],to:statuses[n]};
    const updated = expect(await patch(op, orderPath, operator, request), 200);
    assert.deepEqual(updated.statusHistory.map(event => event.status), statuses.slice(0,n+1));
    assert.deepEqual(expect(await patch(op, orderPath, operator, request), 200), updated);
    assert.equal(expect(await api(shop, `/me/pedidos/${receipt.orderId}`, {state:first}), 200).status, statuses[n]);
  }
  expect(await patch(op, orderPath, operator, {expectedStatus:'ENTREGUE',to:'ENVIADO'}), 409, 'STATE_CONFLICT');

  const unconsumed = expect(await post(shop, '/checkout/quote', first, quoteBody), 200);
  expect(await commit(first, {...confirmation,quoteId:unconsumed.quoteId}, key), 409, 'IDEMPOTENCY_CONFLICT');
  expect(await patch(op, `/operador/cupons/${productCoupon.id}`, operator, {version:productCoupon.version,active:false}), 200);
  const edited = expect(await patch(op, `/operador/anuncios/${listing.id}`, operator,
    {version:listing.version, name:'Peça fictícia editada',priceCents:10500}), 200);
  expect(await commit(first, {...confirmation,quoteId:unconsumed.quoteId}, randomUUID()), 409, 'QUOTE_STALE');
  const expires = expect(await post(shop, '/checkout/quote', first, quoteBody), 200);
  at += 600001;
  expect(await post(shop, '/checkout/quote', first, quoteBody), 200);
  expect(await commit(first, {...confirmation,quoteId:expires.quoteId}, randomUUID()), 409, 'QUOTE_EXPIRED');
  assert.deepEqual(expect(await commit(first, confirmation, key), 200), receipt);

  const seedToDisable = expect(await api(op, '/operador/anuncios/FDL-CRAFT-MORANGO', {state:operator}), 200);
  expect(await patch(op, '/operador/anuncios/FDL-CRAFT-MORANGO', operator, {version:seedToDisable.version,state:'INACTIVE'}), 200);
  expect(await response(shop, '/images/artesanato/brincos-morango-160.jpg'), 404, 'NOT_FOUND');
  await app.close();
  const restarted = await start(t, {dataDir,staticDir,now:() => at});
  const current = await login(restarted.shop, a.credentials);
  const persisted = expect(await api(restarted.shop, `/me/pedidos/${receipt.orderId}`, {state:current}), 200);
  assert.deepEqual(persisted.statusHistory.map(event => event.status), statuses);
  assert.equal(persisted.totalCents, 7650);
  assert.equal(persisted.items[0].name, 'Peça fictícia');
  assert.equal(persisted.items[0].unitPriceCents, 10000);
  assert.deepEqual(persisted.purchase, receipt.purchase);
  assert.deepEqual(persisted.appliedCoupons, quoteResult.appliedCoupons);
  assert.deepEqual(expect(await post(restarted.shop, '/pedidos', current, confirmation, {headers:{'Idempotency-Key':key}}), 200), receipt);
  expect(await api(restarted.shop, '/catalogo/anuncios/FDL-CRAFT-MORANGO'), 404, 'NOT_FOUND');
  assert.equal(expect(await api(restarted.shop, `/catalogo/anuncios/${listing.id}`), 200).version, undefined);
  assert.equal(expect(await api(restarted.shop, `/catalogo/anuncios/${listing.id}`), 200).name, edited.name);
  const persistedImage = await response(restarted.shop, publicPath);
  assert.equal(persistedImage.status, 200);
  assert.ok(persistedImage.buffer.equals(viewed.buffer));
  const currentStaff = await login(restarted.op, staff);
  const history = expect(await api(restarted.op, '/operador/pedidos?status=ENTREGUE', {state:currentStaff}), 200).items;
  assert.equal(history.length, 1);
  assert.equal(history[0].customer.login, a.credentials.login);
  t.diagnostic('E2E sintético: 10000 − 1500 − 850 + (1890 − 1890) = 7650c; uma compra PIX_SIMULADO e quatro eventos após restart.');
});

function localGet(port, path, host) {
  return new Promise((resolve, reject) => {
    get({host:'127.0.0.1', port, path, headers:{Host:host}, timeout:3000}, res => {
      res.resume();
      res.once('end', () => resolve({status:res.statusCode, headers:res.headers}));
    }).on('error',reject);
  });
}

test('HTTP defensive: hosts, forbidden paths, cookie realms, CSRF, role escalation, logout, expiration and rate limit', {timeout:20000}, async t => {
  const fixture = await fixtures(t);
  let now = Date.now();
  const {shop,op,port} = await start(t, {...fixture,memory:true,now:() => now});
  assert.equal((await response(shop, '/')).buffer.toString(), 'home demo');
  assert.equal((await response(op, '/')).buffer.toString(), 'operator demo');
  assert.equal((await response(shop,'/operador.html')).status, 404);
  assert.equal((await response(op,'/index.html')).status, 404);
  assert.equal((await response(shop,'/not-listed.txt')).status, 404);
  assert.equal((await response(shop,'/images/referencias/exemplo.jpg')).status, 404);
  assert.equal((await response(shop,'/fdl-static.json')).status, 404);
  assert.equal((await response(shop,'/flor-de-lotus.sqlite')).status, 404);
  assert.equal((await localGet(port,'/%2e%2e/not-listed.txt',new URL(shop).host)).status, 404);
  assert.equal((await localGet(port,'/','invalid.example.test')).status, 421);
  const health = await response(shop, '/healthz');
  assert.equal(health.status,204);
  assert.equal(health.buffer.length,0);
  assert.match((await response(op,'/')).headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match((await response(shop,'/assets/test-A1a2A3a4.js',{method:'HEAD'})).headers.get('cache-control'), /immutable/);
  assert.throws(() => createApp({...fixture, staticDir:undefined, memory:true}), /FDL_STATIC_DIR/);
  assert.throws(() => createApp({...fixture, staticDir:join(project,'public'), memory:true}), /filtrada/);
  assert.throws(() => createApp({...fixture, dataDir:fixture.staticDir}), /sobrepor/);

  const state = jar();
  const anon = await authStart(shop,state);
  assert.equal(expect(anon,200).user,null);
  assert.match(anon.cookie, /HttpOnly; SameSite=Lax/);
  assert.ok(!anon.cookie.includes('Domain=') && !anon.cookie.includes('; Secure'));
  assert.equal(anon.headers.get('cache-control'),'no-store');
  const original = {...state};
  const credentials = {login:fakeLogin(),password:fakePassword()};
  const registration = {...credentials,nickname:'Apelido de Teste'};
  expect(await post(shop,'/auth/register',state,registration,{headers:{Origin:op}}),403,'ORIGIN_DENIED');
  expect(await post(shop,'/auth/register',state,registration,{headers:{'X-CSRF-Token':fakePassword()}}),403,'CSRF_INVALID');
  expect(await post(shop,'/auth/register',state,{...registration,role:'OPERATOR'}),422,'INVALID_INPUT');
  expect(await post(shop,'/auth/register',state,registration),201);
  assert.ok(original.cookie !== state.cookie && original.csrf !== state.csrf);
  expect(await api(shop,'/me/pedidos',{state:original}),401,'AUTH_REQUIRED');
  expect(await post(shop,'/auth/logout',state,{}, {headers:{'X-CSRF-Token':original.csrf}}),403,'CSRF_INVALID');
  const revoked = {...state};
  expect(await post(shop,'/auth/logout',state,{}),204);
  expect(await api(shop,'/me/pedidos',{state:revoked}),401,'AUTH_REQUIRED');

  const unauth = jar();
  await authStart(shop,unauth);
  const wrong = {...credentials,password:fakePassword()};
  for (let attempt=0; attempt<5; attempt++) expect(await post(shop,'/auth/login',unauth,wrong),401,'INVALID_CREDENTIALS');
  const rate = await post(shop,'/auth/login',unauth,credentials);
  expect(rate,429,'RATE_LIMITED');
  assert.ok(Number(rate.headers.get('retry-after'))>0);
  now += 15*60_000+1;
  expect(await post(shop,'/auth/login',unauth,credentials),200);
  now += 8*60*60_000+1;
  expect(await api(shop,'/me/pedidos',{state:unauth}),401,'AUTH_REQUIRED');

  const https = await start(t, {...fixture,memory:true,shopOrigin:'https://shop.example.test',operatorOrigin:'https://staff.example.test'});
  const tlsCookie = await localGet(https.port,`${API}/session`,'staff.example.test');
  assert.equal(tlsCookie.status,200);
  assert.match(tlsCookie.headers['set-cookie'][0], /^__Host-fdl_operator=.*HttpOnly; SameSite=Lax; Secure$/);
  assert.equal(tlsCookie.headers['access-control-allow-origin'],undefined);
});

test('HTTP limits: valid JPEG, invalid image, limits 3MiB/4MP/five, tree depth and quote quota', {timeout:30000}, async t => {
  const fixture = await fixtures(t);
  const credentials = {login:fakeLogin(),password:fakePassword()};
  const db = openDatabase(fixture);
  try { await createUser(db,credentials.login,credentials.password,'OPERATOR',Date.now); }
  finally { db.close(); }
  const {shop,op} = await start(t, fixture);
  const operator = await login(op,credentials);
  const art = expect(await api(shop, '/catalogo/categorias'),200).items.find(row => row.slug === 'artesanato');
  const sample = expect(await post(op,'/operador/anuncios',operator,{
    categoryId:art.id,name:'Imagem de teste',description:'Fixture sintetizada e não publicada',mode:'ready',priceCents:2100
  }),201);
  const path = `/operador/anuncios/${sample.id}/imagens`;
  const text = Buffer.from('não é raster');
  expect(await post(op,path,operator,text,{type:'image/svg+xml'}),415,'UNSUPPORTED_MEDIA');
  expect(await post(op,path,operator,text,{type:PNG_MIME}),415,'UNSUPPORTED_MEDIA');
  expect(await post(op,path,operator,Buffer.from([255,216,255,0]),{type:JPEG_MIME}),422,'INVALID_INPUT');
  expect(await post(op,path,operator,Buffer.alloc(3*1024*1024+1),{type:PNG_MIME}),413,'BODY_TOO_LARGE');
  const oversizedImage = await sharp({create:{width:2001,height:2000,channels:3,background:'#845050'}}).jpeg().toBuffer();
  expect(await post(op,path,operator,oversizedImage,{type:JPEG_MIME}),422,'INVALID_INPUT');
  const photo = await sharp({create:{width:12,height:9,channels:3,background:'#ed6179'}}).jpeg().toBuffer();
  for (let number=1; number<=5; number++) {
    const uploaded = expect(await post(op,path,operator,photo,{type:JPEG_MIME}),201);
    assert.equal(uploaded.version, 1+number);
  }
  expect(await post(op,path,operator,photo,{type:JPEG_MIME}),422,'INVALID_INPUT');
  let parentId = art.id;
  for (let depth=2; depth<=6; depth++) {
    parentId=expect(await post(op,'/operador/categorias',operator,{
      parentId,name:`Nível fictício ${depth}`,slug:`nivel-demo-${depth}`
    }),201).id;
  }
  expect(await post(op,'/operador/categorias',operator,{parentId,name:'Invalida',slug:'nivel-demo-7'}),422,'INVALID_INPUT');
  const customer = (await signup(shop)).state;
  const request = {items:[{productId:'FDL-CRAFT-MORANGO',variant:'',quantity:1}], shippingId:'loggi',
    paymentMethod:'CARTAO_SIMULADO',couponCodes:[],recipientFullName:'Ágata da Simulação'};
  expect(await post(shop,'/checkout/quote',customer,{...request,items:[{...request.items[0],quantity:10}]}),422,'INVALID_INPUT');
  expect(await post(shop,'/checkout/quote',customer,{...request,items:[{...request.items[0],productId:'FDL-CRAFT-BUBU'}]}),422,'INVALID_INPUT');
  for (let n=0; n<40; n++) expect(await post(shop,'/checkout/quote',customer,request),200);
  const quota = await post(shop,'/checkout/quote',customer,request);
  expect(quota,429,'RATE_LIMITED');
  assert.ok(Number(quota.headers.get('retry-after'))>0);
});

test('SQLite: observe a single file writer and refuse to reset an unrelated file', {timeout:10000}, async t => {
  const fixture = await fixtures(t);
  const db = openDatabase(fixture);
  db.close();
  const reopened = openDatabase(fixture);
  try {
    assert.throws(() => {
      const contender = openDatabase(fixture);
      contender.close();
    }, error => [5,6].includes(error.errcode));
    assert.equal(reopened.prepare('SELECT count(*) AS count FROM listings').get().count, 12);
  } finally {
    reopened.close();
  }
  const unrelated = join(fixture.dir,'unrelated-test');
  await mkdir(unrelated,{mode:0o700});
  const original = Buffer.from('fixture sem formato SQLite');
  const path = join(unrelated,'flor-de-lotus.sqlite');
  await writeFile(path,original);
  assert.throws(() => {
    const opened = openDatabase({dataDir:unrelated});
    opened.close();
  });
  assert.deepEqual(await readFile(path),original);
});
