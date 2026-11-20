export class ApiError extends Error {
  constructor(status, code, retryAfter = null, field = null) {
    super('Falha na API do painel');
    Object.assign(this, {status, code, retryAfter, field});
  }
}

export function query(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== '' && value != null) search.set(key, value);
  }
  return search.size ? `?${search}` : '';
}

export const resource = (area, id) => `/operador/${area}${id ? `/${encodeURIComponent(id)}` : ''}`;

export function createApi(fetcher = globalThis.fetch.bind(globalThis)) {
  let csrf = null;

  async function request(path, {method = 'GET', data, file} = {}) {
    if (!/^\/(?:session|auth\/(?:login|logout)|operador\/[A-Za-z0-9/-]+)(?:\?[^#]*)?$/.test(path) ||
        path.split('?')[0].includes('//')) throw new ApiError(0, 'CONTRACT');
    const headers = {Accept: 'application/json'};
    if (method !== 'GET') {
      if (!csrf) throw new ApiError(403, 'CSRF_INVALID');
      headers['X-CSRF-Token'] = csrf;
      headers['Content-Type'] = file ? file.type : 'application/json';
    }
    let response;
    try {
      response = await fetcher(`/api/v1${path}`, {
        method, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(18_000),
        body: file ?? (data === undefined ? undefined : JSON.stringify(data))
      });
    } catch {
      throw new ApiError(0, 'NETWORK');
    }
    if (response.status === 204) {
      if (path === '/auth/logout' && method === 'POST' ||
          /^\/operador\/cupons\/[a-f0-9-]+\/pares\/[a-f0-9-]+$/.test(path) && method === 'PUT') return null;
      throw new ApiError(0, 'CONTRACT');
    }
    let body;
    try {
      body = await response.json();
    } catch {
      if (response.ok) throw new ApiError(0, 'CONTRACT');
    }
    if (!response.ok) {
      const retry = response.headers.get('Retry-After');
      const field = Object.keys(body?.error?.fields ?? {})[0];
      throw new ApiError(response.status, body?.error?.code, /^\d{1,8}$/.test(retry ?? '') ? Number(retry) : null, field);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(0, 'CONTRACT');
    return body;
  }

  function keepSession(value) {
    if (typeof value?.csrfToken !== 'string' || !value.csrfToken || !Object.hasOwn(value, 'user')) {
      csrf = null;
      throw new ApiError(0, 'CONTRACT');
    }
    csrf = value.csrfToken;
    return value.user;
  }

  return {
    request,
    async session() { return keepSession(await request('/session')); },
    async login(login, password) {
      return keepSession(await request('/auth/login', {method: 'POST', data: {login, password}}));
    },
    async logout() {
      await request('/auth/logout', {method: 'POST', data: {}});
      csrf = null;
    },
    clear() { csrf = null; },
    async all(path, filters = {}, pageSize = 100) {
      const rows = [];
      const seen = new Set();
      let cursor = null;
      do {
        const page = await request(path + query({...filters, limit: pageSize, cursor}));
        if (!Array.isArray(page?.items) ||
            (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !page.nextCursor || seen.has(page.nextCursor)))) {
          throw new ApiError(0, 'CONTRACT');
        }
        rows.push(...page.items);
        cursor = page.nextCursor;
        seen.add(cursor);
      } while (cursor !== null);
      return rows;
    }
  };
}

export function errorCopy(error, area = '') {
  switch (error.code) {
    case 'NETWORK': return 'Não foi possível conectar ao painel. Confira a conexão e consulte o servidor antes de repetir uma alteração.';
    case 'CONTRACT': return 'O serviço não devolveu a resposta esperada. Confira a versão do painel e do servidor.';
    case 'AUTH_REQUIRED': return 'A sessão terminou. Entre novamente para continuar.';
    case 'INVALID_CREDENTIALS': return 'Apelido ou senha não conferem. Use uma conta de operador provisionada para esta origem.';
    case 'FORBIDDEN': return 'Esta conta não tem acesso ao painel de operação.';
    case 'ORIGIN_DENIED': return 'Esta origem não está autorizada. Confira o endereço configurado para o operador.';
    case 'CSRF_INVALID': return 'A sessão mudou em outra aba ou expirou. Confira a sessão antes de repetir a ação.';
    case 'NOT_FOUND': return 'O registro não está disponível. Volte à lista e atualize.';
    case 'VERSION_CONFLICT': return 'O registro mudou no servidor. Seus campos ainda estão aqui; consulte a versão atual antes de editar novamente.';
    case 'STATE_CONFLICT':
      if (area === 'categorias') return 'A categoria não pôde ser inativada. Inative antes os filhos ativos e retire os anúncios publicados vinculados a ela.';
      if (area === 'anuncios') return 'O anúncio pode ter mudado. Consulte a versão atual; anúncios publicados não recebem fotos novas.';
      return 'O pedido mudou. Atualize o detalhe para verificar o próximo passo permitido.';
    case 'ALREADY_EXISTS': return area === 'cupons' ? 'Esse código já existe. Use um código diferente.' : 'Esse slug já existe. Escolha outro.';
    case 'BODY_TOO_LARGE': return area === 'anuncios' ? 'A foto não pode passar de 3 MiB.' : 'Os dados ultrapassaram o tamanho aceito.';
    case 'UNSUPPORTED_MEDIA': return 'Selecione um arquivo JPEG ou PNG estático válido.';
    case 'RATE_LIMITED': return `Muitas tentativas. ${error.retryAfter > 0 ? `Aguarde ${error.retryAfter} s antes de tentar novamente.` : 'Aguarde um momento antes de tentar novamente.'}`;
    case 'UNAVAILABLE': return 'O serviço está temporariamente indisponível ou atingiu um limite. Nenhuma alteração foi confirmada nesta tela.';
    case 'INVALID_INPUT': return 'Confira os campos indicados. Nenhuma alteração foi confirmada.';
    default: return error.status === 421
      ? 'O painel precisa ser aberto no endereço configurado para o operador.'
      : 'Não foi possível confirmar a operação. Confira o registro antes de tentar novamente.';
  }
}
