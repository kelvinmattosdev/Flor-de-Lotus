// Runtime tests only. Excluded from Docker context; never generates product HTML.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {PAGES, FRONTEND_FILES, STATIC_ASSETS} from './build-policy.mjs';
import {realDirectory, within} from './safe-paths.mjs';

const actualRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
export async function fixture({backend = false} = {}) {
  const approved = await realDirectory(path.join(await fs.realpath(os.tmpdir()), 'opencode'));
  const base = await realDirectory(process.env.FDL_RUNTIME_TEST_ROOT || approved);
  if (!within(approved, base)) throw new Error('Testes exigem Temp/opencode aprovado.');
  const directory = await fs.mkdtemp(path.join(base, 'TASK-FDL-RUNTIME-009-fixture-'));
  const root = path.join(directory, 'app');
  await fs.mkdir(root, {mode: 0o700});
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module","private":true}\n');
  for (const page of PAGES) {
    await fs.writeFile(path.join(root, page),
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><script type="module" src="/src/main.js"></script></head><body>runtime-fixture-${page}</body></html>`);
  }
  for (const file of FRONTEND_FILES) {
    await fs.mkdir(path.dirname(path.join(root, file)), {recursive: true});
    await fs.writeFile(path.join(root, file), file.endsWith('.css') ? 'body{color:#123}' : 'console.log("runtime-fixture-only");\n');
  }
  for (const name of STATIC_ASSETS) {
    const dest = path.join(root, 'public', name);
    await fs.mkdir(path.dirname(dest), {recursive: true});
    await fs.copyFile(path.join(actualRoot, 'public', name), dest);
  }
  // Negative fixtures must not be copied into staging/output.
  await fs.mkdir(path.join(root, 'public/images/referencias'), {recursive: true});
  await fs.writeFile(path.join(root, 'public/images/referencias/private-fixture.txt'), 'NONSECRET TEST FIXTURE');
  await fs.writeFile(path.join(root, 'public/local.sqlite'), 'NONSECRET TEST FIXTURE');
  await fs.writeFile(path.join(root, '.env'), 'VITE_PRIVATE_FIXTURE=DO_NOT_LOAD_TEST_FIXTURE');
  await fs.writeFile(path.join(root, 'src/private-fixture.js'), 'NONSECRET UNLISTED FIXTURE');
  if (backend) {
    await fs.cp(path.join(actualRoot, 'server'), path.join(root, 'server'), {recursive: true});
    await fs.copyFile(path.join(actualRoot, 'src/data/catalog.js'), path.join(root, 'src/data/catalog.js'));
    // Native Windows validation dependencies stay in a Temp sibling, not context.
    await fs.cp(path.join(actualRoot, 'node_modules'), path.join(directory, 'node_modules'), {recursive: true});
  }
  return {directory, root, dataDir: path.join(directory, 'private-data')};
}

export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({host: '127.0.0.1', port: 0}, resolve); });
  const {port} = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

export function request(port, pathname = '/', {host = '127.0.0.1', realm = `127.0.0.1:${port}`} = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({host, port, path: pathname, headers: {Host: realm}, timeout: 5000}, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
