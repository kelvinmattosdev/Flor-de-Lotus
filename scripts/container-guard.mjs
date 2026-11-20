import './runtime-umask.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {privateDirectory, regularFile, within} from './safe-paths.mjs';

export async function validateContainer(env = process.env, appRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)))) {
  if (env.NODE_ENV !== 'production' || env.FDL_BIND_HOST !== '0.0.0.0' || env.FDL_PORT !== '8080') {
    throw new Error('Runtime de container exige production/0.0.0.0/8080.');
  }
  for (const key of ['FDL_DATA_DIR', 'FDL_STATIC_DIR', 'FDL_DATA_VOLUME_ID', 'FDL_SHOP_ORIGIN', 'FDL_OPERATOR_ORIGIN']) {
    if (!env[key]) throw new Error('Configuracao obrigatoria de container incompleta.');
  }
  if (![env.FDL_SHOP_ORIGIN, env.FDL_OPERATOR_ORIGIN].every(value => /^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/.test(value))) {
    throw new Error('Origens HTTPS invalidas; nao inclua credenciais ou caminhos.');
  }
  const shop = new URL(env.FDL_SHOP_ORIGIN), operator = new URL(env.FDL_OPERATOR_ORIGIN);
  if (shop.origin !== 'https://prototipo-flor-de-lotus-carlone.kelbyte.com.br' ||
      shop.origin !== env.FDL_SHOP_ORIGIN || operator.origin !== env.FDL_OPERATOR_ORIGIN ||
      operator.protocol !== 'https:' || operator.hostname === shop.hostname ||
      !/^[a-z0-9.-]+$/.test(operator.hostname) || !operator.hostname.includes('.')) {
    throw new Error('Origens HTTPS distintas e explicitas obrigatorias.');
  }
  const directory = await privateDirectory(env.FDL_DATA_DIR);
  const staticDir = path.resolve(env.FDL_STATIC_DIR), root = path.resolve(appRoot);
  if (within(root, directory) || within(directory, root) || within(directory, staticDir) || within(staticDir, directory)) {
    throw new Error('Volume privado sobrepoe aplicacao/build.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(env.FDL_DATA_VOLUME_ID)) throw new Error('Identificador de volume invalido.');
  const marker = await regularFile(directory, '.fdl-volume-id', 256);
  if (marker.data.toString('utf8').trim() !== env.FDL_DATA_VOLUME_ID) throw new Error('Volume diferente do provisionado; inicio recusado.');
  // Require offline provisioning/bootstrap. An empty or wrong-node volume must
  // never silently create a replacement production database.
  const db = await regularFile(directory, 'flor-de-lotus.sqlite', Infinity, 16);
  if (db.data.subarray(0, 16).toString('binary') !== 'SQLite format 3\u0000') throw new Error('Banco provisionado ausente/invalido.');
  for (const file of [marker, db]) {
    if (process.platform !== 'win32' && ((file.stat.mode & 0o077) || file.stat.uid !== process.getuid())) {
      throw new Error('Arquivos do volume devem pertencer ao runtime e ser privados.');
    }
  }
  const names = await fs.readdir(directory, {withFileTypes: true});
  if (names.some(entry => !entry.isFile() || !['.fdl-volume-id', 'flor-de-lotus.sqlite', 'flor-de-lotus.sqlite-journal'].includes(entry.name))) {
    throw new Error('Volume contem estado nao esperado.');
  }
  for (const entry of names) await regularFile(directory, entry.name, Infinity, 0);
  return directory;
}

// --import preload is used only for the production entrypoint. Tests import the
// function with no production environment and cannot open a product database.
const preloads = process.execArgv.flatMap((arg, i, args) => arg === '--import' ? [args[i + 1]] :
  arg.startsWith('--import=') ? [arg.slice(9)] : []).filter(Boolean);
if (preloads.some(arg => pathToFileURL(path.resolve(arg)).href === import.meta.url)) await validateContainer();
