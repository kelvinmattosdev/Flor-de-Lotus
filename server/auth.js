import { argon2, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { transaction } from './db.js';
import { conflict, digest, fail, humanText, invalid, limited, same, shape, token, tokenSyntax, unavailable } from './http.js';

const hash = promisify(argon2);
const PASSWORD_VERSION = 'argon2id:1';
const costs = {memory: 19 * 1024, passes: 2, parallelism: 1, tagLength: 32};
const ANON_TTL = 30 * 60_000;
const CUSTOMER_TTL = 8 * 60 * 60_000;
const OPERATOR_TTL = 2 * 60 * 60_000;
const DUMMY_SALT = Buffer.alloc(16);
const DUMMY_TAG = Buffer.alloc(32);
let running = 0;

export const normalizeLogin = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{3,32}$/.test(value)) invalid('login', 'Use 3–32 letras ASCII, dígitos, _ ou -.');
  return value.toLowerCase();
};

const userDto = ({id, login, role, nickname}) => ({
  id, login, role, ...(role === 'CUSTOMER' ? {nickname: nickname ?? null} : {})
});

function passwordInput(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 256 || [...value].length < 12 || value.includes('\0')) {
    invalid('password', 'Use uma senha fictícia de pelo menos 12 caracteres e até 256 bytes.');
  }
  return Buffer.from(value, 'utf8');
}

async function derive(message, nonce) {
  if (running >= 2) { message.fill(0); limited(2); }
  running++;
  try {
    return await hash('argon2id', {...costs, message, nonce});
  } finally {
    running--;
    message.fill(0);
  }
}

async function passwordHash(value) {
  const input = passwordInput(value);
  const salt = randomBytes(16);
  const tag = await derive(input, salt);
  return `${PASSWORD_VERSION}:${salt.toString('base64url')}:${tag.toString('base64url')}`;
}

async function verifyPassword(value, record) {
  const input = passwordInput(value);
  const match = /^argon2id:1:([A-Za-z0-9_-]{22}):([A-Za-z0-9_-]{43})$/.exec(record ?? '');
  const actual = await derive(input, match ? Buffer.from(match[1], 'base64url') : DUMMY_SALT);
  return same(actual, match ? Buffer.from(match[2], 'base64url') : DUMMY_TAG) && Boolean(match);
}

export async function createUser(db, loginInput, password, role, now, sessionGuard = () => {}, onCreate = user => user, nickname = null) {
  const login = normalizeLogin(loginInput);
  if (!['CUSTOMER', 'OPERATOR'].includes(role)) throw new Error('Papel interno inválido.');
  const storedHash = await passwordHash(password);
  return transaction(db, () => {
    sessionGuard();
    if (db.prepare('SELECT 1 FROM users WHERE login=?').get(login)) {
      conflict('ALREADY_EXISTS', role === 'CUSTOMER' ? 'Nome de usuário indisponível.' : 'Apelido indisponível.');
    }
    if (db.prepare('SELECT count(*) AS count FROM users').get().count >= 5000) unavailable();
    const id = randomUUID();
    db.prepare('INSERT INTO users(id,login,role,password_hash,created_at) VALUES(?,?,?,?,?)')
      .run(id, login, role, storedHash, new Date(now()).toISOString());
    if (role === 'CUSTOMER') db.prepare('INSERT INTO customers(id,user_id,nickname) VALUES(?,?,?)').run(randomUUID(), id, nickname);
    return onCreate(userDto({id, login, role, nickname}));
  });
}

function csrf(raw) {
  return createHmac('sha256', raw).update('flor-de-lotus:csrf:v1').digest('base64url');
}

function sessionCookie(req, name) {
  let found;
  for (const pair of (req.headers.cookie ?? '').split(';')) {
    const pos = pair.indexOf('=');
    if (pos < 0 || pair.slice(0, pos).trim() !== name) continue;
    if (found !== undefined) return undefined;
    found = pair.slice(pos + 1);
  }
  return tokenSyntax(found) ? found : undefined;
}

export function createAuth(db, now, rate) {
  const get = db.prepare(`
    SELECT s.token_hash,s.user_id,s.expires_at,u.login,u.role,c.id AS customer_id,c.nickname
    FROM sessions s LEFT JOIN users u ON s.user_id=u.id LEFT JOIN customers c ON c.user_id=u.id
    WHERE s.token_hash=? AND s.origin=? AND s.expires_at>?`);
  const revoke = db.prepare('DELETE FROM sessions WHERE token_hash=? AND origin=?');
  const insert = db.prepare('INSERT INTO sessions(token_hash,user_id,origin,expires_at) VALUES(?,?,?,?)');
  const purge = db.prepare('DELETE FROM sessions WHERE expires_at<=?');
  const find = db.prepare(`SELECT u.id,u.login,u.role,u.password_hash,c.nickname FROM users u
    LEFT JOIN customers c ON c.user_id=u.id WHERE u.login=? AND u.role=?`);
  const updateNickname = db.prepare('UPDATE customers SET nickname=? WHERE user_id=? AND id=?');
  const name = realm => `${realm.secure ? '__Host-' : ''}fdl_${realm.role.toLowerCase()}`;
  const cookie = (res, realm, raw, ttl) => res.setHeader('Set-Cookie',
    `${name(realm)}=${raw}; Path=/; Max-Age=${ttl / 1000}; HttpOnly; SameSite=Lax${realm.secure ? '; Secure' : ''}`);

  function existing(req, realm) {
    const raw = sessionCookie(req, name(realm));
    if (!raw) return null;
    const row = get.get(digest(raw), realm.origin, now());
    if (!row || (row.role && row.role !== realm.role)) return null;
    return {raw, row, user: row.user_id ? userDto({...row, id: row.user_id}) : null};
  }

  function issueRow(realm, user, previous) {
    const raw = token();
    const ttl = !user ? ANON_TTL : realm.role === 'OPERATOR' ? OPERATOR_TTL : CUSTOMER_TTL;
    purge.run(now());
    if (previous) {
      if (revoke.run(previous.row.token_hash, realm.origin).changes !== 1) {
        fail(403, 'CSRF_INVALID', 'Atualize a sessão antes de tentar novamente.');
      }
    }
    if (db.prepare('SELECT count(*) AS count FROM sessions').get().count >= 5000) unavailable();
    insert.run(digest(raw), user?.id ?? null, realm.origin, now() + ttl);
    return {raw, ttl, user};
  }

  function sessionResponse(res, realm, {raw, ttl, user}) {
    cookie(res, realm, raw, ttl);
    return {user, csrfToken: csrf(raw)};
  }

  function checkWrite(req, realm, session) {
    if (req.headers.origin !== realm.origin) fail(403, 'ORIGIN_DENIED', 'Origem não permitida.');
    const supplied = req.headers['x-csrf-token'];
    if (!session || !tokenSyntax(supplied) || !same(Buffer.from(supplied), Buffer.from(csrf(session.raw)))) {
      fail(403, 'CSRF_INVALID', 'Atualize a sessão antes de tentar novamente.');
    }
  }

  function requireRole(session, role) {
    if (!session?.user) fail(401, 'AUTH_REQUIRED', 'Entre para continuar.');
    if (session.user.role !== role) fail(403, 'FORBIDDEN', 'Esta conta não pode acessar este recurso.');
  }

  function assertCurrent(session, realm) {
    if (!session || !get.get(session.row.token_hash, realm.origin, now())) {
      fail(403, 'CSRF_INVALID', 'Atualize a sessão antes de tentar novamente.');
    }
  }

  const ip = req => req.socket.remoteAddress ?? 'local';
  return {
    existing, checkWrite, requireRole, assertCurrent,
    session(req, res, realm, session) {
      if (session) return {user: session.user, csrfToken: csrf(session.raw)};
      rate('session-ip', ip(req), 150, ANON_TTL);
      return sessionResponse(res, realm, transaction(db, () => issueRow(realm, null, null)));
    },
    async register(req, res, realm, session, body) {
      if (realm.role !== 'CUSTOMER') fail(403, 'FORBIDDEN', 'Cadastro disponível somente na loja.');
      shape(body, ['login', 'password', 'nickname'], ['login', 'password', 'nickname']);
      rate('register-ip', ip(req), 20, ANON_TTL);
      const nickname = humanText(body.nickname, 'nickname', 60);
      const result = await createUser(db, body.login, body.password, 'CUSTOMER', now,
        () => assertCurrent(session, realm), user => issueRow(realm, user, session), nickname);
      return sessionResponse(res, realm, result);
    },
    async login(req, res, realm, session, body) {
      shape(body, ['login', 'password'], ['login', 'password']);
      const login = normalizeLogin(body.login);
      rate(`login-ip:${realm.role}`, ip(req), 35, 15 * 60_000);
      rate(`login-target:${realm.role}`, `${ip(req)}:${login}`, 5, 15 * 60_000);
      const row = find.get(login, realm.role);
      if (!await verifyPassword(body.password, row?.password_hash)) {
        fail(401, 'INVALID_CREDENTIALS', realm.role === 'CUSTOMER' ? 'Nome de usuário ou senha inválidos.' : 'Apelido ou senha inválidos.');
      }
      const user = userDto(row);
      assertCurrent(session, realm);
      return sessionResponse(res, realm, transaction(db, () => issueRow(realm, user, session)));
    },
    updateProfile(session, body) {
      shape(body, ['nickname'], ['nickname']);
      const nickname = humanText(body.nickname, 'nickname', 60);
      if (updateNickname.run(nickname, session.user.id, session.row.customer_id).changes !== 1) unavailable();
      return {user: userDto({...session.user, nickname}), csrfToken: csrf(session.raw)};
    },
    logout(res, realm, session, body) {
      shape(body, []);
      assertCurrent(session, realm);
      revoke.run(session.row.token_hash, realm.origin);
      cookie(res, realm, '', 0);
    }
  };
}
