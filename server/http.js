import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, message, fields, headers) {
    super(message);
    Object.assign(this, {status, code, fields, headers});
  }
}

export const fail = (status, code, message) => { throw new HttpError(status, code, message); };
export const invalid = (field, message = 'Valor inválido.') => {
  throw new HttpError(422, 'INVALID_INPUT', 'Verifique os campos informados.', {[field]: message});
};
export const missing = () => fail(404, 'NOT_FOUND', 'Recurso não encontrado.');
export const conflict = (code, message) => fail(409, code, message);
export const unavailable = () => fail(503, 'UNAVAILABLE', 'Serviço temporariamente indisponível.');
export const limited = (seconds) => {
  throw new HttpError(429, 'RATE_LIMITED', 'Muitas tentativas. Aguarde e tente novamente.', undefined, {'Retry-After': String(seconds)});
};

export function shape(value, allowed, required = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid('body', 'Informe um objeto JSON.');
  for (const name of Object.keys(value)) if (!allowed.includes(name)) invalid('body', 'Há um campo não aceito nesta operação.');
  for (const name of required) if (!Object.hasOwn(value, name)) invalid(name, 'Campo obrigatório.');
  return value;
}

export function text(value, field, max, {optional = false, multiline = false} = {}) {
  if (typeof value !== 'string' || value.length > max ||
      (multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value)) invalid(field);
  const result = value.trim();
  if (!optional && !result) invalid(field, 'Campo obrigatório.');
  return result;
}

export function humanText(value, field, max) {
  // Check before trimming so invisible formatting and controls at the edges
  // cannot disappear during validation. In Unicode mode \p{Cs} is a lone surrogate.
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u.test(value)) {
    invalid(field, 'Informe texto sem controles, caracteres invisíveis ou quebras de linha.');
  }
  const trimmed = value.trim();
  const size = [...trimmed].length;
  if (size < 2 || size > max) invalid(field, `Use de 2 a ${max} caracteres.`);
  return trimmed;
}

export const integer = (value, field, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid(field, `Use um inteiro entre ${min} e ${max}.`);
  return value;
};

export const boolean = (value, field) => {
  if (typeof value !== 'boolean') invalid(field);
  return value;
};

export const oneOf = (value, choices, field) => {
  if (!choices.includes(value)) invalid(field, 'Escolha uma opção válida.');
  return value;
};

export const catalogId = (value, field = 'id') => {
  if (typeof value !== 'string' || !/^[A-Z0-9-]{1,60}$/.test(value)) invalid(field);
  return value;
};

export const uuid = (value, field = 'id') => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value)) invalid(field);
  return value;
};

export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export const tokenSyntax = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const same = (left, right) => left.length === right.length && timingSafeEqual(left, right);

export function queryParams(url, allowed = []) {
  const values = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(values, key)) invalid('query', 'Parâmetro desconhecido ou repetido.');
    values[key] = value;
  }
  return values;
}

export function boolQuery(value, name, fallback = true) {
  if (value === undefined) return fallback;
  return oneOf(value, ['true', 'false'], name) === 'true';
}

export function pagination({limit, cursor}, context) {
  if (limit !== undefined && !/^[1-9]\d{0,2}$/.test(limit)) invalid('limit');
  const size = limit === undefined ? 30 : integer(Number(limit), 'limit', 1, 100);
  const fingerprint = digest(JSON.stringify(context)).slice(0, 16);
  let after = 0;
  if (cursor !== undefined) {
    if (!/^[A-Za-z0-9_-]{1,56}$/.test(cursor)) invalid('cursor');
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const match = /^([1-9]\d{0,15}):([a-f0-9]{16})$/.exec(decoded);
    if (!match || match[2] !== fingerprint || Buffer.from(decoded).toString('base64url') !== cursor) invalid('cursor');
    after = integer(Number(match[1]), 'cursor', 1, Number.MAX_SAFE_INTEGER);
  }
  return {size: size + 1, after, result(rows, map) {
    const items = rows.slice(0, size);
    return {items: items.map(map), nextCursor: rows.length > size
      ? Buffer.from(`${items.at(-1).seq}:${fingerprint}`).toString('base64url') : null};
  }};
}

export async function bytes(req, max, acceptable) {
  const contentType = req.headers['content-type'];
  if (!acceptable.includes(contentType) || req.headers['content-encoding']) {
    fail(415, 'UNSUPPORTED_MEDIA', 'Tipo de conteúdo não aceito.');
  }
  const advertised = req.headers['content-length'];
  const overflow = () => fail(413, 'BODY_TOO_LARGE', 'O conteúdo excede o limite permitido.');
  // Drain a narrowly oversized request without buffering its excess, so TCP
  // can return 413 instead of dropping the response on a still-writing client.
  // Never drain arbitrarily large or indefinite bodies.
  const drainLimit = max + 64 * 1024;
  if (advertised !== undefined && (!/^\d+$/.test(advertised) || Number(advertised) > drainLimit)) overflow();
  const iterator = req.iterator({destroyOnReturn: false});
  const chunks = [];
  let count = 0;
  for await (const chunk of iterator) {
    count += chunk.length;
    if (count > drainLimit) overflow();
    if (count > max) chunks.length = 0;
    else chunks.push(chunk);
  }
  if (count > max) overflow();
  return Buffer.concat(chunks, count);
}

export async function jsonBody(req) {
  const body = await bytes(req, 32 * 1024, ['application/json', 'application/json; charset=utf-8']);
  try {
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(body));
  } catch {
    fail(400, 'INVALID_JSON', 'O conteúdo deve ser JSON válido.');
  }
}

export function json(res, status, value) {
  res.statusCode = status;
  if (value === undefined) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}

// Fixed per-key windows with bounded state. No IP, username, or credentials are logged.
export function createLimiter(now) {
  const entries = new Map();
  return (scope, key, max, duration) => {
    const timestamp = now();
    const id = `${scope}:${digest(key)}`;
    let entry = entries.get(id);
    if (!entry || entry.until <= timestamp) {
      if (entries.size >= 4096) {
        for (const [old, item] of entries) if (item.until <= timestamp) entries.delete(old);
        if (entries.size >= 4096 && !entries.has(id)) limited(60);
      }
      entry = {until: timestamp + duration, count: 0};
      entries.set(id, entry);
    }
    if (entry.count >= max) limited(Math.max(1, Math.ceil((entry.until - timestamp) / 1000)));
    entry.count++;
  };
}
