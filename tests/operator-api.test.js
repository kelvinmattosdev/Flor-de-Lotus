import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createApi, errorCopy, query, resource} from '../src/operador/api.js';

test('same-origin session, login rotation, binary CSRF upload, logout, and again', async () => {
  const calls = [];
  let sessions = 0;
  const responses = {
    '/api/v1/session': () => ({user: null, csrfToken: `anonymous-${++sessions}`}),
    '/api/v1/auth/login': () => ({user: {role: 'OPERATOR'}, csrfToken: `rotated-${sessions}`}),
    '/api/v1/operador/anuncios/A/imagens': () => ({version: 2}),
    '/api/v1/auth/logout': () => null
  };
  const api = createApi(async (path, options) => {
    calls.push({path, options});
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    const body = responses[path]();
    return body === null ? new Response(null, {status: 204}) : Response.json(body);
  });
  await api.session();
  assert.equal((await api.login('fixture', 'valor de teste fictício')).role, 'OPERATOR');
  const file = new File([Uint8Array.of(1, 2)], 'fixture.png', {type: 'image/png'});
  await api.request('/operador/anuncios/A/imagens', {method: 'POST', file});
  assert.equal(calls[0].options.headers['X-CSRF-Token'], undefined);
  assert.equal(calls[1].options.headers['X-CSRF-Token'], 'anonymous-1');
  assert.equal(calls[2].options.headers['X-CSRF-Token'], 'rotated-1');
  assert.equal(calls[2].options.headers['Content-Type'], 'image/png');
  assert.equal(calls[2].options.body, file);
  await api.logout();
  await assert.rejects(api.login('fixture', 'valor pendente'), {code: 'CSRF_INVALID'});
  await api.session();
  await api.login('fixture', 'valor de teste fictício');
  assert.equal(calls[5].options.headers['X-CSRF-Token'], 'anonymous-2');
  await assert.rejects(api.request('//fora.invalid'), {code: 'CONTRACT'});
  await assert.rejects(api.request('/auth/register', {method: 'POST'}), {code: 'CONTRACT'});
  assert.equal(calls.length, 6);
});

test('walks paginated targets and rejects duplicate cursors without looping', async () => {
  const requested = [];
  const path = resource('anuncios');
  const api = createApi(async url => {
    requested.push(url);
    return Response.json(requested.length === 1 ? {items: ['primeiro'], nextCursor: 'opaco-1'}
      : {items: ['segundo'], nextCursor: null});
  });
  assert.deepEqual(await api.all(path, {state: 'DRAFT'}), ['primeiro', 'segundo']);
  assert.deepEqual(requested, ['/api/v1/operador/anuncios?state=DRAFT&limit=100',
    '/api/v1/operador/anuncios?state=DRAFT&limit=100&cursor=opaco-1']);
  const stuck = createApi(async () => Response.json({items: [], nextCursor: 'idem'}));
  await assert.rejects(stuck.all(path), {code: 'CONTRACT'});
  assert.equal(query({customerId: '', status: 'ENVIADO', cursor: null}), '?status=ENVIADO');
});

test('preserves safe actionable status without exposing error bodies or retrying writes', async () => {
  let count = 0;
  const api = createApi(async path => {
    if (path.endsWith('/session')) return Response.json({user: null, csrfToken: 'fixture'});
    ++count;
    return Response.json({error: {code: 'RATE_LIMITED', message: 'payload não deve aparecer', fields: {percentBps: 'não mostrar'}}},
      {status: 429, headers: {'Retry-After': '17'}});
  });
  await api.session();
  await assert.rejects(api.request('/operador/cupons', {method: 'POST', data: {}}), error => {
    assert.equal(error.status, 429);
    assert.equal(error.field, 'percentBps');
    assert.match(errorCopy(error), /17 s/);
    assert.doesNotMatch(errorCopy(error), /payload/);
    return true;
  });
  assert.equal(count, 1);
});

test('only expected empty successes are accepted', async () => {
  const api = createApi(async path => path.endsWith('/session')
    ? Response.json({user: null, csrfToken: 'fixture'}) : new Response(null, {status: 204}));
  await api.session();
  await assert.rejects(api.request('/operador/anuncios/A', {method: 'PATCH', data: {version: 1}}), {code: 'CONTRACT'});
  assert.equal(await api.request('/operador/cupons/a-2/pares/b-2', {method: 'PUT', data: {rule: null}}), null);
  await api.logout();
});
