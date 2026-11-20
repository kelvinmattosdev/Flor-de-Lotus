import { createReadStream, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { appRoot, within } from './db.js';
import { missing } from './http.js';
import { isApprovedAsset } from './seed.js';

const pages = new Set(['index.html', 'produto.html', 'conta.html', 'operador.html']);
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
const bundled = /^assets\/[A-Za-z0-9_-]{1,100}-[A-Za-z0-9_-]{8,32}\.(?:js|css)$/;
const restrictedPhoto = /^\/images\/(?:artesanato|sebo)\//;
const privateRoots = ['public', 'dist', 'src', 'server', 'tests', 'docs', 'shots', '.agents', '.taste-skill', 'node_modules'];

function checkedFile(root, name) {
  const file = join(root, ...name.split('/'));
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(file) !== file) {
    throw new Error('Saída estática inválida.');
  }
  return {file, stat};
}

export function openStatic(directory) {
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('Informe FDL_STATIC_DIR de um build filtrado.');
  const absolute = resolve(directory), root = realpathSync(absolute);
  if (absolute !== root || !lstatSync(root).isDirectory() || within(root, appRoot) ||
      privateRoots.some(dir => within(join(appRoot, dir), root))) {
    throw new Error('O diretório estático deve ser uma saída filtrada dedicada.');
  }
  const manifest = checkedFile(root, 'fdl-static.json');
  if (manifest.stat.size > 64 * 1024) throw new Error('Manifesto estático excede o limite.');
  const data = JSON.parse(readFileSync(manifest.file, 'utf8'));
  if (data?.version !== 1 || !Array.isArray(data.files) || data.files.length > 300 ||
      new Set(data.files).size !== data.files.length || ![...pages].every(page => data.files.includes(page))) {
    throw new Error('Manifesto estático incompleto ou inválido.');
  }
  const known = new Set();
  for (const name of data.files) {
    if (typeof name !== 'string' || !(pages.has(name) || bundled.test(name) || isApprovedAsset(name))) {
      throw new Error('Manifesto inclui um caminho não aprovado.');
    }
    checkedFile(root, name);
    known.add(name);
  }
  return {root, async send(req, res, pathname, role, preview, availablePhoto) {
    const name = pathname === '/' ? (role === 'OPERATOR' ? 'operador.html' : 'index.html') : pathname.slice(1);
    if (!known.has(name) || (pages.has(name) && ((name === 'operador.html') !== (role === 'OPERATOR'))) ||
        (restrictedPhoto.test(pathname) && !(role === 'OPERATOR' ? preview : availablePhoto(pathname)))) missing();
    let entry;
    try { entry = checkedFile(root, name); }
    catch { missing(); }
    res.setHeader('Content-Type', mime[extname(name)]);
    res.setHeader('Content-Length', entry.stat.size);
    res.setHeader('Cache-Control', pages.has(name)
      ? (name === 'operador.html' || name === 'conta.html' ? 'no-store' : 'no-cache')
      : bundled.test(name) ? 'public, max-age=31536000, immutable'
      : restrictedPhoto.test(pathname) ? 'no-store' : 'public, max-age=3600, must-revalidate');
    if (name === 'operador.html') {
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'");
    } else if (pages.has(name)) {
      res.setHeader('Content-Security-Policy', "base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'");
    }
    if (req.method === 'HEAD') return res.end();
    await pipeline(createReadStream(entry.file), res);
  }};
}
