import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'vite';
import {PAGES, FRONTEND_FILES, STATIC_ASSETS, isStaticFile, BUNDLE} from './build-policy.mjs';
import {digest, listFiles, ownedDirectory, realDirectory, regularFile} from './safe-paths.mjs';

export const projectRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

async function copy(root, name, target, targetName = name) {
  const source = await regularFile(root, name);
  const dest = path.join(target, targetName);
  await fs.mkdir(path.dirname(dest), {recursive: true, mode: 0o700});
  await fs.writeFile(dest, source.data, {flag: 'wx', mode: 0o600});
  return {path: targetName, sha256: digest(source.data)};
}

export async function verifyOutput(directory, assetHashes) {
  const files = await listFiles(directory);
  if (files.length > 300 || files.some(name => !isStaticFile(name)) ||
      [...PAGES, ...STATIC_ASSETS].some(name => !files.includes(name)) ||
      !files.some(name => BUNDLE.test(name))) throw new Error('Saida MPA incompleta ou contem arquivo nao aprovado.');
  for (const {path: name, sha256} of assetHashes) {
    if (digest((await regularFile(directory, name)).data) !== sha256) throw new Error('Ativo mudou no build.');
  }
  // Every absolute static URL in generated HTML/CSS/JS must resolve. Dynamic
  // gallery references are covered by the concrete complete asset allowlist.
  for (const name of files.filter(name => /\.(?:html|css|js)$/.test(name))) {
    const text = (await regularFile(directory, name)).data.toString('utf8');
    for (const [url] of text.matchAll(/\/(?:images|fonts|licenses|assets)\/[A-Za-z0-9_./-]+\.(?:jpg|png|woff2|txt|js|css)/g)) {
      if (!files.includes(url.slice(1))) throw new Error('Referencia estatica nao resolvida: ' + url);
    }
  }
  await fs.writeFile(path.join(directory, 'fdl-static.json'), JSON.stringify({version: 1, files}) + '\n',
    {flag: 'wx', mode: 0o600});
  return files;
}

export async function buildStatic({sourceRoot = projectRoot, container = false} = {}) {
  const root = await realDirectory(sourceRoot);
  // Check all four real entries before allocating a generation; no fake HTML.
  for (const page of PAGES) {
    try { await regularFile(root, page); }
    catch { throw new Error(`Entrada ${page} ausente/insegura; aguarde o writer da UI e o freeze antes do build integrado.`); }
  }
  const workspace = await ownedDirectory(path.join(root, '.fdl-build'),
    {version: 1, kind: 'filtered-build', project: root});
  const generation = await fs.mkdtemp(path.join(workspace, 'build-'));
  const input = path.join(generation, 'input');
  await fs.mkdir(input, {mode: 0o700});
  const output = container ? path.join(workspace, 'export') : path.join(generation, 'site');
  // Exclusive creation: neither Vite nor this script erases a previous tree.
  await fs.mkdir(output, {mode: 0o700});
  await copy(root, 'package.json', input);
  for (const page of PAGES) await copy(root, page, input);
  for (const name of FRONTEND_FILES) {
    const stat = await fs.lstat(path.join(root, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (stat) await copy(root, name, input);
  }
  const assetHashes = [];
  for (const name of STATIC_ASSETS) assetHashes.push(await copy(root, 'public/' + name, input, 'public/' + name));
  const inputPages = Object.fromEntries(PAGES.map(name => [name.replace('.html', ''), path.join(input, name)]));
  await build({configFile: false, root: input, publicDir: path.join(input, 'public'), envDir: false,
    logLevel: 'warn', build: {outDir: output, emptyOutDir: false, sourcemap: false, rolldownOptions: {input: inputPages}}});
  const files = await verifyOutput(output, assetHashes.map(f => ({...f, path: f.path.slice('public/'.length)})));
  return {directory: output, files, generation};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--container') || args.length > 1) {
    console.error('Uso: node scripts/build.mjs [--container]'); process.exitCode = 1;
  } else buildStatic({container: args.includes('--container')}).then(result => {
    console.log('Build filtrado: ' + result.directory);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
