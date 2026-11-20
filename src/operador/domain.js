export const statuses = ['PENDENTE', 'PROCESSANDO', 'ENVIADO', 'ENTREGUE'];
export const statusNames = {PENDENTE: 'Pendente', PROCESSANDO: 'Processando', ENVIADO: 'Enviado', ENTREGUE: 'Entregue'};
export const listingStates = {DRAFT: 'Rascunho', PUBLISHED: 'Publicado', INACTIVE: 'Inativo'};
export const scopes = {GLOBAL: 'Toda a loja', CATEGORY: 'Categoria', PRODUCT: 'Anúncio'};
export const productLimit = 10_000_000;
export const couponLimit = 3_600_000_000;
export const maxPhotoBytes = 3 * 1024 * 1024;

const brl = new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'});
const time = new Intl.DateTimeFormat('pt-BR', {dateStyle: 'short', timeStyle: 'short'});
export const money = cents => Number.isSafeInteger(cents) ? brl.format(cents / 100) : '—';
export const date = stamp => Number.isFinite(Date.parse(stamp)) ? time.format(new Date(stamp)) : '—';
export const decimal = units => units == null ? '' : `${Math.floor(units / 100)},${String(units % 100).padStart(2, '0')}`;
export const percent = bps => `${decimal(bps).replace(/,00$/, '').replace(/(,\d)0$/, '$1')}%`;
export const nextStatus = status => statuses.includes(status) ? statuses[statuses.indexOf(status) + 1] : undefined;

// Convert components, not a floating point value × 100. Dot is accepted as a
// decimal keyboard alternative; thousands separators are deliberately not parsed.
export function unitsFromDecimal(value, {min = 0, max, blank} = {}) {
  const input = value.trim();
  if (!input && blank !== undefined) return blank;
  const parts = /^(\d{1,9})(?:[,.](\d{1,2}))?$/.exec(input);
  if (!parts) return undefined;
  const total = Number(parts[1]) * 100 + Number((parts[2] ?? '').padEnd(2, '0'));
  return total >= min && total <= max ? total : undefined;
}

export function normalizedCode(value) {
  const code = value.trim();
  return /^[A-Za-z0-9-]{2,32}$/.test(code) ? code.toUpperCase() : undefined;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const diff = (base, changes) =>
  Object.fromEntries(Object.entries(changes).filter(([key, value]) => !same(base[key], value)));
export const galleryFields = images => images.map(({id, alt, label}) => ({id, alt, label}));

export function categoryGraph(items) {
  const byId = new Map(items.map(item => [item.id, item]));
  const chain = id => {
    const result = [];
    const visited = new Set();
    while (id != null) {
      const node = byId.get(id);
      if (!node || visited.has(id)) return [];
      result.unshift(node);
      visited.add(id);
      id = node.parentId;
    }
    return result;
  };
  return {
    chain,
    path: id => chain(id).map(node => node.name).join(' › ') || 'Categoria não encontrada',
    active: id => chain(id).length > 0 && chain(id).every(node => node.active),
    descendantsOf: id => new Set(items.filter(item => chain(item.id).some(node => node.id === id)).map(item => item.id))
  };
}

export function safePhoto(image) {
  const source = image?.src;
  if (typeof source !== 'string') return null;
  const privatePath = /^\/api\/v1\/operador\/imagens\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.exec(source);
  if (privatePath?.[1] && privatePath[1] === image.id && privatePath[0] === source) return source;
  // Same strict path family as the seed and additionally enforced by the
  // server's exact asset manifest. No basename, URL or srcset from forms.
  const seedPath = /^\/images\/(?:artesanato|sebo)\/[a-z0-9-]+\.(?:jpg|png)$/.exec(source);
  return seedPath?.[0] === source ? source : null;
}
