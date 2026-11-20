import './runtime-umask.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {buildStatic, projectRoot} from './build.mjs';
import {digest, listFiles, ownedDirectory, realDirectory, regularFile, within} from './safe-paths.mjs';

export function localConfig(env = process.env, root = projectRoot) {
  const value = env.FDL_PORT ?? '5173';
  if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65535) throw new Error('FDL_PORT deve estar entre 1 e 65535.');
  if (env.FDL_BIND_HOST && env.FDL_BIND_HOST !== '127.0.0.1') throw new Error('npm start e local: use bind 127.0.0.1; container usa server/index.js.');
  if (env.NODE_ENV === 'production') throw new Error('Producao usa o entrypoint de container, nao o builder local.');
  const port = Number(value), suffix = port === 80 ? '' : ':' + port;
  const shopOrigin = env.FDL_SHOP_ORIGIN ?? `http://127.0.0.1${suffix}`;
  const operatorOrigin = env.FDL_OPERATOR_ORIGIN ?? `http://localhost${suffix}`;
  if (shopOrigin !== `http://127.0.0.1${suffix}` || operatorOrigin !== `http://localhost${suffix}`) {
    throw new Error('Origens locais devem ser 127.0.0.1 (loja) e localhost (operador), na FDL_PORT.');
  }
  const parent = process.platform === 'win32' ? env.LOCALAPPDATA : os.homedir();
  if (!env.FDL_DATA_DIR && !parent) throw new Error('Configure FDL_DATA_DIR privado fora da aplicacao.');
  const dataDir = path.resolve(env.FDL_DATA_DIR || path.join(parent, '.fdl-data-flor-de-lotus-' + digest(root).slice(0, 12)));
  if (within(root, dataDir) || within(dataDir, root)) throw new Error('Dados devem ficar fora da aplicacao, sem sobreposicao.');
  return {port, host: '127.0.0.1', shopOrigin, operatorOrigin, dataDir};
}

async function checkPort(port, host) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen({port, host, exclusive: true}, resolve); });
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
}

export async function prepareData(dataDir, root, staticDir) {
  dataDir = path.join(await realDirectory(path.dirname(path.resolve(dataDir))), path.basename(dataDir));
  if (within(root, dataDir) || within(dataDir, root) || within(staticDir, dataDir) || within(dataDir, staticDir)) {
    throw new Error('Dados sobrepoem aplicacao/build.');
  }
  const directory = await ownedDirectory(dataDir, {version: 1, kind: 'private-data', project: root});
  const allowed = ['.fdl-owner.json', 'flor-de-lotus.sqlite', 'flor-de-lotus.sqlite-journal', 'fdl-runtime.lock'];
  const entries = await fs.readdir(directory, {withFileTypes: true});
  if (entries.some(entry => !entry.isFile() || !allowed.includes(entry.name))) throw new Error('Conteudo desconhecido no diretorio de dados; nada foi apagado.');
  if ((await listFiles(directory)).some(name => !allowed.includes(name))) throw new Error('Conteudo desconhecido no diretorio de dados; nada foi apagado.');
  const lockFile = path.join(directory, 'fdl-runtime.lock'), token = randomUUID();
  const handle = await fs.open(lockFile, 'wx', 0o600);
  await handle.writeFile(token);
  const original = await handle.stat();
  await handle.close();
  return {directory, async release() {
    const current = await regularFile(directory, 'fdl-runtime.lock', 128);
    if (current.stat.ino !== original.ino || current.data.toString() !== token) throw new Error('Lock privado mudou; nao sera removido.');
    await fs.unlink(lockFile);
  }};
}

// Local-only ::1 relay to the same in-process HTTP server. Preserves Host and
// cookies; no X-Forwarded trust, extra API, wildcard bind or existing listener.
async function ipv6Relay(port) {
  const sockets = new Set();
  const relay = net.createServer(client => {
    if (sockets.size >= 128) { client.destroy(); return; }
    const target = net.connect({host: '127.0.0.1', port});
    for (const socket of [client, target]) {
      sockets.add(socket); socket.setTimeout(15_000, () => socket.destroy());
      socket.on('error', () => { client.destroy(); target.destroy(); });
      socket.on('close', () => sockets.delete(socket));
    }
    client.pipe(target); target.pipe(client);
  });
  try {
    await new Promise((resolve, reject) => { relay.once('error', reject); relay.listen({host: '::1', port, ipv6Only: true, exclusive: true}, resolve); });
    return {enabled: true, async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => relay.close(error => error ? reject(error) : resolve()));
    }};
  } catch (error) {
    if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) return {enabled: false, async close() {}};
    throw error; // ::1 port in use: fail, do not reuse or terminate that listener.
  }
}

export async function startRuntime({root = projectRoot, env = process.env, log = console.log} = {}) {
  root = await realDirectory(root);
  const config = localConfig(env, root);
  // Occupied default fails before build/data writes. No killing/reusing servers.
  await checkPort(config.port, '127.0.0.1');
  try { await checkPort(config.port, '::1'); }
  catch (error) { if (!['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) throw error; }
  const built = await buildStatic({sourceRoot: root});
  const data = await prepareData(config.dataDir, root, built.directory);
  let app, relay, closed;
  const close = () => closed ??= (async () => {
    try { if (relay) await relay.close(); }
    finally { try { if (app) await app.close(); } finally { await data.release(); } }
  })();
  try {
    const {warmupImageDecoder} = await import(pathToFileURL(path.join(root, 'server/media.js')));
    await warmupImageDecoder();
    const {createApp} = await import(pathToFileURL(path.join(root, 'server/index.js')));
    app = createApp({staticDir: built.directory, dataDir: data.directory,
      shopOrigin: config.shopOrigin, operatorOrigin: config.operatorOrigin});
    await app.listen({port: config.port, host: config.host});
    relay = await ipv6Relay(config.port);
  } catch (error) { await close(); throw error; }
  log(`Flor de Lotus · demonstracao · Loja: ${config.shopOrigin}/ · Operador: ${config.operatorOrigin}/`);
  log(`Dados privados: ${data.directory}`);
  if (!relay.enabled) log('IPv6 loopback indisponivel. localhost precisa resolver para 127.0.0.1; nao edite hosts. Confira suporte de rede local.');
  return {app, ...built, dataDir: data.directory, ipv6: relay.enabled, config, close};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) { console.error('Uso: npm start (parametros via FDL_PORT/FDL_DATA_DIR).'); process.exitCode = 1; }
  else startRuntime().then(runtime => {
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => runtime.close().catch(() => { process.exitCode = 1; }));
  }).catch(error => {
    console.error(error.code === 'EADDRINUSE' ? 'Porta ocupada. Defina outra FDL_PORT para ambas as origens; nenhum processo foi encerrado.'
      : error.code === 'EEXIST' ? 'Diretorio/lock ja existente. Nao foi sobrescrito; confira propriedade e processos antes de usar outro FDL_DATA_DIR.'
      : error.message);
    process.exitCode = 1;
  });
}
