import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';

export const within = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
};
export const digest = data => createHash('sha256').update(data).digest('hex');
export const safeRelative = name => typeof name === 'string' && (['.fdl-owner.json', '.fdl-volume-id'].includes(name) ||
  (/^[A-Za-z0-9_-]+(?:[./-][A-Za-z0-9_-]+)*$/.test(name) &&
  !name.split('/').some(part => part.startsWith('.') || part === '..') && !name.includes('\\')));

// Inspect every existing component, not just the last file (junctions included).
export async function realDirectory(directory) {
  const full = path.resolve(directory), parsed = path.parse(full);
  let current = parsed.root;
  for (const part of full.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Diretorio nao real ou vinculado recusado.');
    }
    // Windows may supply a legitimate 8.3 alias via TEMP/LocalAppData.
    // Resolve it only AFTER checking this component is not a link/junction.
    current = await fs.realpath(current);
  }
  return current;
}

export async function regularFile(root, name, maxBytes = 16 * 1024 * 1024, headBytes) {
  if (!safeRelative(name)) throw new Error('Caminho relativo nao aprovado.');
  const file = path.resolve(root, ...name.split('/'));
  if (!within(root, file)) throw new Error('Caminho fora da raiz.');
  await realDirectory(path.dirname(file));
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maxBytes ||
      await fs.realpath(file) !== file) throw new Error('Arquivo nao regular ou vinculado recusado.');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (stat.ino !== before.ino || stat.dev !== before.dev || stat.size !== before.size) throw new Error('Arquivo mudou durante leitura.');
    let data;
    if (headBytes === undefined) data = await handle.readFile();
    else {
      const buffer = Buffer.alloc(Math.min(headBytes, stat.size));
      const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0);
      data = buffer.subarray(0, bytesRead);
    }
    return {file, stat, data};
  } finally { await handle.close(); }
}

export async function privateDirectory(directory) {
  const full = await realDirectory(directory);
  const stat = await fs.lstat(full);
  if (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid())) {
    throw new Error('Diretorio deve pertencer ao usuario atual e ter permissoes privadas.');
  }
  return full;
}

// Existing unknown directories are never adopted, cleared, chmod-ed or replaced.
export async function ownedDirectory(directory, identity) {
  const requested = path.resolve(directory), parent = await realDirectory(path.dirname(requested));
  const full = path.join(parent, path.basename(requested));
  let created = false;
  try { await fs.mkdir(full, {mode: 0o700}); created = true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateDirectory(full);
  const marker = '.fdl-owner.json';
  if (created) {
    await fs.writeFile(path.join(full, marker), JSON.stringify(identity) + '\n', {flag: 'wx', mode: 0o600});
  } else {
    const file = await regularFile(full, marker, 4096);
    if (JSON.stringify(JSON.parse(file.data)) !== JSON.stringify(identity)) throw new Error('Diretorio existente nao pertence a este runtime.');
  }
  return full;
}

export async function listFiles(root, rel = '') {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, rel), {withFileTypes: true})) {
    const name = path.posix.join(rel, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Link recusado na saida.');
    if (entry.isDirectory()) {
      await realDirectory(path.join(root, name));
      files.push(...await listFiles(root, name));
    } else {
      await regularFile(root, name, Infinity, 0);
      files.push(name);
    }
  }
  return files.sort();
}
