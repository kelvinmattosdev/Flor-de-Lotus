import { openDatabase } from './db.js';
import { createUser, normalizeLogin } from './auth.js';
import { HttpError } from './http.js';

async function run() {
  if (process.argv.length !== 3 || process.stdin.isTTY) {
    console.error('Uso: node server/bootstrap-operador.js <apelido>; forneça a senha por stdin protegido e FDL_DATA_DIR dedicado.');
    process.exitCode = 2;
    return;
  }
  const login = normalizeLogin(process.argv[2]);
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 258) throw new Error('Entrada maior que o limite.');
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks, length);
  const password = new TextDecoder('utf-8', {fatal: true}).decode(input).replace(/\r?\n$/, '');
  input.fill(0);
  for (const chunk of chunks) chunk.fill(0);
  const db = openDatabase({dataDir: process.env.FDL_DATA_DIR});
  try {
    await createUser(db, login, password, 'OPERATOR', Date.now);
    console.log('Operador de demonstração cadastrado.');
  } finally {
    db.close();
  }
}

run().catch(error => {
  console.error(error instanceof HttpError && error.code === 'ALREADY_EXISTS'
    ? 'Apelido indisponível; nenhum operador foi alterado.'
    : 'Não foi possível cadastrar; confira a entrada protegida, o runtime e o diretório de dados.');
  process.exitCode = 1;
});
