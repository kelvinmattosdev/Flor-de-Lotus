import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {buildStatic} from '../scripts/build.mjs';
import {PAGES, STATIC_ASSETS, isStaticFile} from '../scripts/build-policy.mjs';
import {fixture} from '../scripts/test-fixtures.mjs';
import {digest, regularFile} from '../scripts/safe-paths.mjs';
import {isApprovedAsset} from '../server/seed.js';

test('runtime009: filtered four-entry build, ownership and no deletion of unknown state', async t => {
  const f = await fixture();
  await t.test('versioned asset policy matches backend and approved 53', () => {
    assert.equal(STATIC_ASSETS.length, 53);
    assert.equal(new Set(STATIC_ASSETS).size, 53);
    for (const file of STATIC_ASSETS) assert.equal(isApprovedAsset(file), true, file);
  });
  await t.test('exclusive four-page build + manifest + hashes; private input never staged', async () => {
    const result = await buildStatic({sourceRoot: f.root});
    const manifest = JSON.parse(await fs.readFile(path.join(result.directory, 'fdl-static.json')));
    assert.equal(manifest.version, 1);
    assert.deepEqual(manifest.files, result.files);
    for (const file of [...PAGES, ...STATIC_ASSETS]) assert.ok(manifest.files.includes(file));
    assert.ok(manifest.files.every(isStaticFile));
    for (const file of STATIC_ASSETS) assert.equal(
      digest((await regularFile(result.directory, file)).data), digest((await regularFile(f.root, 'public/' + file)).data));
    for (const file of ['.env', 'public/local.sqlite', 'public/images/referencias/private-fixture.txt', 'src/private-fixture.js']) {
      await assert.rejects(fs.stat(path.join(result.generation, 'input', file)), {code: 'ENOENT'});
    }
    for (const file of manifest.files.filter(file => file.endsWith('.js'))) {
      assert.ok(!(await fs.readFile(path.join(result.directory, file), 'utf8')).includes('DO_NOT_LOAD_TEST_FIXTURE'));
    }
    await fs.writeFile(path.join(result.directory, 'keep-evidence.txt'), 'owned prior generation');
    const next = await buildStatic({sourceRoot: f.root});
    assert.notEqual(next.directory, result.directory);
    assert.equal(await fs.readFile(path.join(result.directory, 'keep-evidence.txt'), 'utf8'), 'owned prior generation');
  });
  await t.test('container export is exclusive and cannot overwrite a previous tree', async () => {
    const result = await buildStatic({sourceRoot: f.root, container: true});
    await assert.rejects(buildStatic({sourceRoot: f.root, container: true}), {code: 'EEXIST'});
    assert.ok((await fs.stat(path.join(result.directory, 'fdl-static.json'))).isFile());
  });
  await t.test('missing real entry fails instead of generating product dummy HTML', async () => {
    const missing = path.join(f.root, 'conta.html');
    await fs.rename(missing, missing + '.test-backup');
    await assert.rejects(buildStatic({sourceRoot: f.root}), /Entrada conta.html/);
    await fs.rename(missing + '.test-backup', missing);
  });
  await t.test('hardlinked approved asset is rejected before copy', async () => {
    const name = STATIC_ASSETS[0], file = path.join(f.root, 'public', name);
    const link = path.join(f.directory, 'hardlink-fixture');
    await fs.link(file, link);
    await assert.rejects(buildStatic({sourceRoot: f.root}), /vinculado/);
    await fs.unlink(link); // Only this test-created link, not any asset.
  });
  await t.test('linked parent directory/junction is rejected, not followed', async () => {
    const fonts = path.join(f.root, 'public/fonts'), backup = path.join(f.root, 'public/fonts-test-backup');
    await fs.rename(fonts, backup);
    let linked = false;
    try {
      await fs.symlink(backup, fonts, process.platform === 'win32' ? 'junction' : 'dir'); linked = true;
      await assert.rejects(buildStatic({sourceRoot: f.root}), /vinculado/);
    } finally {
      if (linked) await fs.unlink(fonts);
      await fs.rename(backup, fonts);
    }
  });
  await t.test('unknown preexisting workspace remains untouched', async () => {
    const other = await fixture();
    await fs.mkdir(path.join(other.root, '.fdl-build'));
    await fs.writeFile(path.join(other.root, '.fdl-build', 'user.txt'), 'never delete');
    await assert.rejects(buildStatic({sourceRoot: other.root}));
    assert.equal(await fs.readFile(path.join(other.root, '.fdl-build/user.txt'), 'utf8'), 'never delete');
  });
});
