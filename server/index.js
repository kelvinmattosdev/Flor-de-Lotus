import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAuth } from './auth.js';
import { createCatalog } from './catalog.js';
import { createCoupons } from './coupons.js';
import { assertRuntime, openDatabase } from './db.js';
import { createLimiter, fail, HttpError, json, jsonBody, missing, queryParams } from './http.js';
import { readImage, sendMedia, warmupImageDecoder } from './media.js';
import { createOrders } from './orders.js';
import { openStatic } from './static.js';

const API = '/api/v1';
const READ = ['GET', 'HEAD'];
const PAGE = ['limit', 'cursor'];
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const socketConfig = {maxHeaderSize: 8192, requestTimeout: 12_000, headersTimeout: 5_000,
  connectionsCheckingInterval: 1000, keepAliveTimeout: 2500};

function realmFor(origin, role) {
  const url = new URL(origin);
  const secure = url.protocol === 'https:';
  if (url.origin !== origin || (!secure && (url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost'].includes(url.hostname)))) {
    throw new Error('As origens devem ser explícitas, sem caminho/credenciais, e HTTPS fora do loopback.');
  }
  return {origin, host: url.host, hostname: url.hostname, secure, role};
}

function requestUrl(req) {
  const url = req.url ?? '';
  if (!url.startsWith('/') || url.startsWith('//') || url.length > 8192 || /[\x00-\x20\x7f#]/.test(url)) missing();
  const rawPath = url.split('?', 1)[0];
  if (!/^\/[A-Za-z0-9._/-]*$/.test(rawPath) || (rawPath !== '/' &&
      rawPath.slice(1).split('/').some(segment => !segment || segment.startsWith('.')))) missing();
  return new URL(url, 'http://request.invalid');
}

export function createApp({staticDir, dataDir, shopOrigin, operatorOrigin, now = Date.now, memory = false, imageDecoder} = {}) {
  assertRuntime();
  if (Boolean(shopOrigin) !== Boolean(operatorOrigin)) throw new Error('Configure as duas origens ou nenhuma.');
  let realms = shopOrigin ? [realmFor(shopOrigin, 'CUSTOMER'), realmFor(operatorOrigin, 'OPERATOR')] : null;
  if (realms && realms[0].hostname === realms[1].hostname) throw new Error('Loja e operador precisam de hosts distintos.');
  if (realms && realms[0].secure !== realms[1].secure) throw new Error('Configure ambas as origens com o mesmo esquema.');
  const files = openStatic(staticDir);
  const db = openDatabase({dataDir, staticDir: files.root, memory});
  const rate = createLimiter(now);
  const auth = createAuth(db, now, rate);
  const catalog = createCatalog(db);
  const coupons = createCoupons(db, catalog);
  const orders = createOrders(db, catalog, coupons, now);
  const health = db.prepare('SELECT 1 AS ready');
  let ending;

  const server = createServer(socketConfig, (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    handle(req, res).catch(error => {
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      if (!req.readableEnded && !READ.includes(req.method)) {
        // On early rejection, do not keep a connection with an unconsumed upload.
        res.setHeader('Connection', 'close');
      }
      if (error instanceof HttpError) {
        for (const [name, value] of Object.entries(error.headers ?? {})) res.setHeader(name, value);
        return json(res, error.status, {error: {code: error.code, message: error.message, fields: error.fields}});
      }
      if (error.errcode === 5 || error.errcode === 6) {
        return json(res, 503, {error: {code: 'UNAVAILABLE', message: 'Serviço temporariamente indisponível.'}});
      }
      return json(res, 500, {error: {code: 'INTERNAL_ERROR', message: 'Não foi possível concluir a operação.'}});
    });
  });
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 120;
  server.setTimeout(15_000, socket => socket.destroy());

  async function handle(req, res) {
    const url = requestUrl(req), path = url.pathname;
    const ip = req.socket.remoteAddress ?? 'local';
    const host = req.headersDistinct.host;
    const realm = host?.length === 1 ? realms?.find(entry => entry.host === host[0].toLowerCase()) : undefined;
    if (path === '/healthz' && READ.includes(req.method) && (realm || loopback.has(ip))) {
      let ready = false;
      try { ready = !ending && health.get().ready === 1; } catch { /* No database detail is exposed. */ }
      return json(res, ready ? 204 : 503);
    }
    if (!realm) fail(421, 'HOST_DENIED', 'Host não permitido.');
    if (path !== API && !path.startsWith(`${API}/`)) {
      if (!READ.includes(req.method)) missing();
      const preview = realm.role === 'OPERATOR' && path.startsWith('/images/') && Boolean(auth.existing(req, realm)?.user);
      return files.send(req, res, path, realm.role, preview, catalog.hasPublishedStaticImage);
    }
    rate('api-ip', ip, 1200, 60_000);
    const parts = path.slice(API.length + 1).split('/');
    const [area, name, id, sub, other] = parts;
    const method = req.method;
    const read = method === 'GET';
    const session = auth.existing(req, realm);
    const query = (allowed = []) => queryParams(url, allowed);
    const write = () => {
      auth.checkWrite(req, realm, session);
      query();
    };
    const body = async () => {
      const input = await jsonBody(req);
      auth.assertCurrent(session, realm);
      return input;
    };
    const guard = role => {
      auth.requireRole(session, role);
      if (realm.role !== role) fail(403, 'FORBIDDEN', 'Recurso indisponível nesta origem.');
    };

    if (area === 'session' && parts.length === 1 && read) {
      query();
      return json(res, 200, auth.session(req, res, realm, session));
    }
    if (area === 'auth' && parts.length === 2 && method === 'POST') {
      if (!['register', 'login', 'logout'].includes(name)) missing();
      write();
      const input = await body();
      if (name === 'register') return json(res, 201, await auth.register(req, res, realm, session, input));
      if (name === 'login') return json(res, 200, await auth.login(req, res, realm, session, input));
      auth.logout(res, realm, session, input);
      return json(res, 204);
    }
    if (area === 'catalogo' && realm.role === 'CUSTOMER') {
      if (read && name === 'categorias' && parts.length === 2) {
        return json(res, 200, catalog.categories(query(PAGE), false));
      }
      if (name === 'anuncios' && read) {
        if (parts.length === 2) return json(res, 200, catalog.listings(query([...PAGE, 'ids', 'categoryId', 'includeDescendants']), false));
        if (parts.length === 3) { query(); return json(res, 200, catalog.getListing(id, false)); }
      }
      if (name === 'imagens' && parts.length === 3 && READ.includes(method)) {
        query();
        return sendMedia(req, res, catalog.media(id, false));
      }
      missing();
    }
    if (area === 'operador') {
      guard('OPERATOR');
      if (!READ.includes(method)) {
        write();
        rate('operator-mutation', session.user.id, 120, 60_000);
      }
      if (name === 'categorias') {
        if (parts.length === 2 && read) return json(res, 200, catalog.categories(query(PAGE), true));
        if (parts.length === 2 && method === 'POST') return json(res, 201, catalog.saveCategory(null, await body()));
        if (parts.length === 3 && read) { query(); return json(res, 200, catalog.category(id)); }
        if (parts.length === 3 && method === 'PATCH') return json(res, 200, catalog.saveCategory(id, await body()));
      }
      if (name === 'anuncios') {
        if (parts.length === 2 && read) return json(res, 200, catalog.listings(query([...PAGE, 'state']), true));
        if (parts.length === 2 && method === 'POST') return json(res, 201, catalog.saveListing(null, await body()));
        if (parts.length === 3 && read) { query(); return json(res, 200, catalog.getListing(id, true)); }
        if (parts.length === 3 && method === 'PATCH') return json(res, 200, catalog.saveListing(id, await body()));
        if (parts.length === 4 && sub === 'imagens' && method === 'POST') {
          rate('operator-upload', session.user.id, 20, 60_000);
          catalog.assertUpload(id);
          const image = await readImage(req, imageDecoder);
          auth.assertCurrent(session, realm);
          return json(res, 201, catalog.addImage(id, image));
        }
      }
      if (name === 'imagens' && parts.length === 3 && READ.includes(method)) {
        query();
        return sendMedia(req, res, catalog.media(id, true));
      }
      if (name === 'cupons') {
        if (parts.length === 2 && read) return json(res, 200, coupons.list(query(PAGE)));
        if (parts.length === 2 && method === 'POST') return json(res, 201, coupons.save(null, await body()));
        if (parts.length === 3 && read) { query(); return json(res, 200, coupons.get(id)); }
        if (parts.length === 3 && method === 'PATCH') return json(res, 200, coupons.save(id, await body()));
        if (parts.length === 4 && sub === 'pares' && read) return json(res, 200, coupons.pairs(id, query(PAGE)));
        if (parts.length === 5 && sub === 'pares' && method === 'PUT') {
          const result = coupons.savePair(id, other, await body());
          return result ? json(res, 200, result) : json(res, 204);
        }
      }
      if (name === 'clientes' && parts.length === 2 && read) return json(res, 200, orders.customers(query(PAGE)));
      if (name === 'pedidos') {
        if (parts.length === 2 && read) return json(res, 200, orders.list(query([...PAGE, 'status', 'customerId'])));
        if (parts.length === 3 && read) { query(); return json(res, 200, orders.info(id)); }
        if (parts.length === 4 && sub === 'status' && method === 'PATCH') return json(res, 200, orders.status(id, await body()));
      }
      missing();
    }
    if (area === 'me' && name === 'pedidos' && read && [2, 3].includes(parts.length)) {
      guard('CUSTOMER');
      if (id) { query(); return json(res, 200, orders.info(id, session.row.customer_id)); }
      return json(res, 200, orders.list(query(PAGE), session.row.customer_id));
    }
    if (area === 'me' && name === 'perfil' && method === 'PATCH' && parts.length === 2) {
      guard('CUSTOMER');
      write();
      rate('customer-profile', session.user.id, 12, 60_000);
      return json(res, 200, auth.updateProfile(session, await body()));
    }
    if (method === 'POST' && ((area === 'checkout' && name === 'quote' && parts.length === 2) ||
        (area === 'pedidos' && parts.length === 1))) {
      guard('CUSTOMER');
      write();
      const limitCheckout = () => rate('customer-checkout', session.user.id, 45, 60_000);
      if (area === 'checkout') limitCheckout();
      const input = await body();
      if (area === 'checkout') return json(res, 200, orders.quote(session.row.customer_id, input, session.raw));
      const result = orders.place(session.row.customer_id, req.headers['idempotency-key'], input, session.raw, limitCheckout);
      return json(res, result.status, result.receipt);
    }
    missing();
  }

  return {
    server,
    listen({port = 5173, host = '127.0.0.1'} = {}) {
      if (ending || server.listening) throw new Error('Servidor indisponível para nova escuta.');
      if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Porta inválida.');
      if (!loopback.has(host) && !realms?.every(realm => realm.secure)) {
        throw new Error('Escuta não-loopback exige as duas origens HTTPS.');
      }
      if (realms && !realms[0].secure && !realms[1].secure &&
          (!port || realms.some(realm => Number(new URL(realm.origin).port || 80) !== port))) {
        throw new Error('Origens locais HTTP precisam corresponder à porta da escuta.');
      }
      return new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen({port, host}, () => {
          server.removeListener('error', reject);
          const address = server.address();
          if (!realms) {
            const suffix = address.port === 80 ? '' : `:${address.port}`;
            realms = [realmFor(`http://127.0.0.1${suffix}`, 'CUSTOMER'), realmFor(`http://localhost${suffix}`, 'OPERATOR')];
          }
          resolveListen(address);
        });
      });
    },
    close() {
      return ending ??= new Promise((resolveClose, reject) => {
        const finish = () => {
          try { db.close(); resolveClose(); }
          catch (error) { reject(error); }
        };
        if (server.listening) server.close(finish);
        else finish();
      });
    }
  };
}

async function main() {
  const value = process.env.FDL_PORT ?? '5173';
  if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65535) throw new Error('Informe FDL_PORT entre 1 e 65535.');
  const port = Number(value);
  await warmupImageDecoder();
  const app = createApp({staticDir: process.env.FDL_STATIC_DIR, dataDir: process.env.FDL_DATA_DIR,
    shopOrigin: process.env.FDL_SHOP_ORIGIN, operatorOrigin: process.env.FDL_OPERATOR_ORIGIN});
  try {
    await app.listen({port, host: process.env.FDL_BIND_HOST ?? '127.0.0.1'});
  } catch (error) {
    await app.close();
    throw error;
  }
  console.log(`Flor de Lotus · demonstração · porta ${port}.`);
  if (!process.env.FDL_SHOP_ORIGIN) {
    const suffix = port === 80 ? '' : `:${port}`;
    console.log(`Loja: http://127.0.0.1${suffix}/ · Operador: http://localhost${suffix}/`);
  }
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    app.close().catch(() => { process.exitCode = 1; });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.code === 'EADDRINUSE' ? 'Porta ocupada. Configure FDL_PORT e origens locais compatíveis.'
      : 'Não foi possível iniciar: confira o runtime, Sharp, a saída filtrada, as origens e o diretório de dados privado.');
    process.exitCode = 1;
  });
}
