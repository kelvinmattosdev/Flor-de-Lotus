import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns/promises';
import {startRuntime, localConfig, prepareData} from '../scripts/start.mjs';
import {fixture, freePort, request} from '../scripts/test-fixtures.mjs';

test('runtime009: actual Node API and isolated disk SQLite, no legacy server or product build', async t => {
  const f = await fixture({backend: true}), port = await freePort();
  const env = {FDL_PORT: String(port), FDL_DATA_DIR: f.dataDir};
  const logs = [];
  let runtime;
  await t.test('private paths/origins/config are validated before startup', () => {
    assert.throws(() => localConfig({...env, FDL_DATA_DIR: path.join(f.root, '.fdl-data')}, f.root), /fora/);
    assert.throws(() => localConfig({...env, FDL_BIND_HOST: '0.0.0.0'}, f.root), /local/);
    assert.throws(() => localConfig({...env, FDL_OPERATOR_ORIGIN: `http://127.0.0.1:${port}`}, f.root), /Origens/);
    assert.throws(() => localConfig({...env, FDL_PORT: '0'}, f.root), /FDL_PORT/);
    const def = localConfig({LOCALAPPDATA: f.directory}, f.root);
    assert.ok(!def.dataDir.startsWith(f.root + path.sep));
  });
  await t.test('start builds only fixture, health204, API200, role-specific pages and IPv6 relay', async () => {
    runtime = await startRuntime({root: f.root, env, log: value => logs.push(value)});
    t.after(() => runtime?.close());
    assert.equal((await request(port, '/healthz')).status, 204);
    const shop = await request(port);
    assert.equal(shop.status, 200); assert.match(shop.body, /runtime-fixture-index/);
    const operator = await request(port, '/', {realm: `localhost:${port}`});
    assert.equal(operator.status, 200); assert.match(operator.body, /runtime-fixture-operador/);
    assert.equal((await request(port, '/api/v1/session')).status, 200);
    assert.equal((await request(port, '/api/v1/session', {realm: `localhost:${port}`})).status, 200);
    assert.equal((await request(port, '/operador.html')).status, 404);
    assert.equal((await request(port, '/conta.html', {realm: `localhost:${port}`})).status, 404);
    assert.equal((await request(port, '/', {realm: `unknown.invalid:${port}`})).status, 421);
    const localhost = await fetch(`http://localhost:${port}/`);
    assert.equal(localhost.status, 200);
    assert.match(await localhost.text(), /runtime-fixture-operador/);
    const addresses = await dns.lookup('localhost', {all: true});
    logs.push('localhost Node DNS: ' + addresses.map(a => a.address).join(', '));
    if (runtime.ipv6) assert.equal((await request(port, '/', {host: '::1', realm: `localhost:${port}`})).status, 200);
    assert.ok(logs[0].includes(`127.0.0.1:${port}`) && logs[0].includes(`localhost:${port}`));
  });
  await t.test('private404/traversal/no manifest exposure; genuine missing asset404', async () => {
    for (const name of ['/fdl-static.json', '/.env', '/server/index.js', '/src/data/catalog.js', '/package.json',
      '/flor-de-lotus.sqlite', '/docs/ai/PROJECT_STATE.md', '/images/referencias/private-fixture.txt',
      '/images/unknown.jpg', '/../package.json', '/%2e%2e/package.json', '//server/index.js']) {
      assert.equal((await request(port, name)).status, 404, name);
    }
  });
  await t.test('occupied port leaves current owned server/data alone and suggests FDL_PORT', async () => {
    await assert.rejects(startRuntime({root: f.root, env, log() {}}), {code: 'EADDRINUSE'});
    assert.equal((await request(port, '/healthz')).status, 204);
  });
  await t.test('close/restart keeps disk database and seed without reset', async () => {
    await runtime.close();
    runtime = undefined;
    const db = await fs.stat(path.join(f.dataDir, 'flor-de-lotus.sqlite'));
    assert.ok(db.size > 0);
    await assert.rejects(fs.stat(path.join(f.dataDir, 'fdl-runtime.lock')), {code: 'ENOENT'});
    runtime = await startRuntime({root: f.root, env, log() {}});
    const response = await request(port, '/api/v1/catalogo/anuncios');
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).items.length, 12);
    await runtime.close(); runtime = undefined;
  });
  await t.test('unknown data directory and stale lock are not adopted or deleted', async () => {
    const data = path.join(f.directory, 'not-owned');
    await fs.mkdir(data);
    await fs.writeFile(path.join(data, 'user.txt'), 'preserve');
    await assert.rejects(prepareData(data, f.root, path.join(f.root, 'safe-output')));
    assert.equal(await fs.readFile(path.join(data, 'user.txt'), 'utf8'), 'preserve');
    await fs.writeFile(path.join(f.dataDir, 'fdl-runtime.lock'), 'stale-synthetic-test');
    await assert.rejects(prepareData(f.dataDir, f.root, path.join(f.root, 'safe-output')), {code: 'EEXIST'});
    assert.equal(await fs.readFile(path.join(f.dataDir, 'fdl-runtime.lock'), 'utf8'), 'stale-synthetic-test');
  });
});
