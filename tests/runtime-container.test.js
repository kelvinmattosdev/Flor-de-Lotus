import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {validateContainer} from '../scripts/container-guard.mjs';
import {checkHealth} from '../scripts/healthcheck.mjs';
import {fixture} from '../scripts/test-fixtures.mjs';

test('runtime009: fail-closed volume and HTTPS config guard (not Linux/Swarm execution)', async t => {
  const f = await fixture();
  await fs.mkdir(f.dataDir, {mode: 0o700});
  const env = {NODE_ENV: 'production', FDL_BIND_HOST: '0.0.0.0', FDL_PORT: '8080',
    FDL_DATA_DIR: f.dataDir, FDL_STATIC_DIR: path.join(f.root, 'static-output'),
    FDL_SHOP_ORIGIN: 'https://prototipo-flor-de-lotus-carlone.kelbyte.com.br',
    FDL_OPERATOR_ORIGIN: 'https://operator.example.invalid',
    FDL_DATA_VOLUME_ID: 'synthetic-volume-009-identifier'};
  await t.test('empty/wrong-node volume cannot initialize a replacement DB', async () => {
    await assert.rejects(validateContainer(env, f.root));
    await fs.writeFile(path.join(f.dataDir, '.fdl-volume-id'), env.FDL_DATA_VOLUME_ID, {mode: 0o600});
    await assert.rejects(validateContainer(env, f.root));
    await assert.rejects(fs.stat(path.join(f.dataDir, 'flor-de-lotus.sqlite')), {code: 'ENOENT'});
  });
  await t.test('correct structural header passes; this is not full SQLite validation', async () => {
    await fs.writeFile(path.join(f.dataDir, 'flor-de-lotus.sqlite'), Buffer.from('SQLite format 3\0SYNTHETIC HEADER FIXTURE'), {mode: 0o600});
    assert.equal(await validateContainer(env, f.root), f.dataDir);
  });
  await t.test('missing config, same hostname, credential URLs and mismatch sentinel fail', async () => {
    for (const key of Object.keys(env)) {
      if (key === 'FDL_STATIC_DIR') {
        await assert.rejects(validateContainer({...env, [key]: ''}, f.root)); continue;
      }
      await assert.rejects(validateContainer({...env, [key]: ''}, f.root), key);
    }
    await assert.rejects(validateContainer({...env, FDL_OPERATOR_ORIGIN: env.FDL_SHOP_ORIGIN}, f.root));
    await assert.rejects(validateContainer({...env, FDL_OPERATOR_ORIGIN: 'https://synthetic:fixture@operator.invalid'}, f.root));
    await assert.rejects(validateContainer({...env, FDL_DATA_VOLUME_ID: 'different-volume-009-id'}, f.root));
    await assert.rejects(validateContainer({...env, FDL_DATA_DIR: f.root}, f.root));
  });
  await t.test('hardlinked journal rejected; unknown volume content preserved', async () => {
    const linked = path.join(f.dataDir, 'flor-de-lotus.sqlite-journal');
    await fs.link(path.join(f.dataDir, 'flor-de-lotus.sqlite'), linked);
    await assert.rejects(validateContainer(env, f.root));
    await fs.unlink(linked);
    await fs.writeFile(path.join(f.dataDir, 'unknown.txt'), 'preserve');
    await assert.rejects(validateContainer(env, f.root));
    assert.equal(await fs.readFile(path.join(f.dataDir, 'unknown.txt'), 'utf8'), 'preserve');
  });
  await t.test('Node-only health probe accepts204, rejects503; no curl or data response needed', async () => {
    let status = 204;
    const server = http.createServer((req, res) => { res.writeHead(status); res.end(); });
    await new Promise(resolve => server.listen({host: '127.0.0.1', port: 0}, resolve));
    try {
      const {port} = server.address();
      assert.equal(await checkHealth(port), 0);
      status = 503;
      assert.equal(await checkHealth(port), 1);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});
