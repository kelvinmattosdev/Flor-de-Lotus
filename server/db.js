import { Database } from 'node:sqlite';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateV1ToV2, schemaV1 } from './schema.js';
import { seedV1 } from './seed.js';

export const appRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const APP_ID = 0x46444c20;
const SCHEMA_VERSION = 2;
const DB_NAME = 'flor-de-lotus.sqlite';

export function assertRuntime() {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  if (major !== 26 || minor < 13 || (minor === 13 && patch < 1) || typeof Database !== 'function') {
    throw new Error('Este runtime requer Node 26.13.1 ou posterior da linha 26, com node:sqlite.');
  }
}

export function within(parent, child) {
  const offset = relative(parent, child);
  return offset === '' || (!isAbsolute(offset) && offset !== '..' && !offset.startsWith(`..${sep}`));
}

// Resolve existing ancestors before allowing an explicit new private path.
function prospective(path) {
  let current = path;
  const tail = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) throw new Error('Diretório de dados inválido.');
    tail.unshift(relative(parent, current));
    current = parent;
  }
  return join(realpathSync(current), ...tail);
}

export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openDatabase({dataDir, staticDir, memory = false} = {}) {
  assertRuntime();
  let filename = ':memory:';
  let exists = false;
  if (!memory) {
    if (typeof dataDir !== 'string' || !dataDir.trim()) throw new Error('Informe FDL_DATA_DIR privado e dedicado.');
    const requested = resolve(dataDir);
    const directory = prospective(requested);
    if (relative(requested, directory) !== '') throw new Error('O diretório de dados não pode usar symlink.');
    if (within(appRoot, directory) || within(directory, appRoot) ||
        (staticDir && (within(staticDir, directory) || within(directory, staticDir)))) {
      throw new Error('O diretório de dados não pode se sobrepor à aplicação ou à saída estática.');
    }
    mkdirSync(directory, {recursive: true, mode: 0o700});
    const dir = lstatSync(directory);
    if (!dir.isDirectory() || dir.isSymbolicLink() || realpathSync(directory) !== directory ||
        (process.platform !== 'win32' && (dir.mode & 0o077) !== 0)) {
      throw new Error('O diretório de dados deve ser privado e não pode ser um link.');
    }
    filename = join(directory, DB_NAME);
    // Refuse linked files, including a dangling symlink, and non-regular files.
    const file = lstatSync(filename, {throwIfNoEntry: false});
    if (file && (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1)) throw new Error('Arquivo de dados inválido.');
    exists = Boolean(file);
  }
  const db = new Database(filename, {timeout: 750, enableForeignKeyConstraints: true, allowExtension: false});
  try {
    db.exec('PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
    transaction(db, () => {
      const id = db.prepare('PRAGMA application_id').get().application_id;
      const version = db.prepare('PRAGMA user_version').get().user_version;
      const fresh = !exists && id === 0 && version === 0;
      if (!fresh && (id !== APP_ID || version < 1 || version > SCHEMA_VERSION)) {
        throw new Error('Formato de dados não reconhecido; o protótipo não sobrescreverá o arquivo.');
      }
      if (fresh) {
        db.exec(schemaV1);
        seedV1(db);
        db.exec(`PRAGMA application_id=${APP_ID};`);
      }
      if (fresh || version === 1) {
        db.exec(migrateV1ToV2);
        db.exec(`PRAGMA user_version=${SCHEMA_VERSION};`);
      }
    });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
