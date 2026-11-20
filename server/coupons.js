import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { boolean, catalogId, conflict, integer, invalid, missing, oneOf, pagination, shape, unavailable, uuid } from './http.js';

const SCOPES = ['GLOBAL', 'CATEGORY', 'PRODUCT'];
const FIELDS = ['code', 'scope', 'scopeId', 'includeDescendants', 'minSubtotalCents', 'maxDiscountCents',
  'percentBps', 'freeShipping', 'stackable', 'active'];
const MAX_MERCH = 40 * 9 * 10000000;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const pair = (a, b) => compare(a, b) < 0 ? [a, b] : [b, a];
const pairKey = (a, b) => pair(a, b).join(':');

export function couponCode(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^[A-Za-z0-9-]{2,32}$/.test(value.trim())) invalid('code');
  return value.trim().toUpperCase();
}

const dto = row => ({
  id: row.id, code: row.code, scope: row.scope, scopeId: row.category_id ?? row.listing_id,
  includeDescendants: Boolean(row.descendants), minSubtotalCents: row.minimum, maxDiscountCents: row.ceiling,
  percentBps: row.percent, freeShipping: Boolean(row.free_shipping), stackable: Boolean(row.stackable),
  active: Boolean(row.active), version: row.version
});

export function createCoupons(db, catalog) {
  const find = db.prepare('SELECT * FROM coupons WHERE id=?');
  const lookup = db.prepare('SELECT * FROM coupons WHERE code=?');
  const getPair = db.prepare('SELECT rule FROM coupon_pairs WHERE first=? AND second=?');
  const byId = id => {
    const row = find.get(uuid(id));
    if (!row) missing();
    return row;
  };
  return {
    get: id => dto(byId(id)),
    list(params) {
      const page = pagination(params, ['coupons']);
      return page.result(db.prepare('SELECT * FROM coupons WHERE seq>? ORDER BY seq LIMIT ?')
        .all(page.after, page.size), dto);
    },
    save(id, body) {
      return transaction(db, () => {
        const row = id ? byId(id) : null;
        shape(body, row ? [...FIELDS.slice(1), 'version'] : FIELDS, row ? ['version'] : ['code', 'scope']);
        if (row && integer(body.version, 'version', 1, Number.MAX_SAFE_INTEGER) !== row.version) {
          conflict('VERSION_CONFLICT', 'O cupom mudou. Recarregue antes de editar.');
        }
        const value = (key, fallback) => Object.hasOwn(body, key) ? body[key] : fallback;
        const code = row?.code ?? couponCode(body.code);
        if (!row && lookup.get(code)) conflict('ALREADY_EXISTS', 'Código de cupom indisponível.');
        if (!row && db.prepare('SELECT count(*) AS count FROM coupons').get().count >= 1500) unavailable();
        const scope = oneOf(value('scope', row?.scope), SCOPES, 'scope');
        const scopeId = value('scopeId', row?.scope === scope ? row.category_id ?? row.listing_id : null);
        if (scope === 'GLOBAL' && scopeId !== null) invalid('scopeId', 'Escopo global não tem vínculo.');
        if (scope !== 'GLOBAL') catalogId(scopeId, 'scopeId');
        if (scope === 'PRODUCT' && !catalog.listing(scopeId)) invalid('scopeId', 'Anúncio não encontrado.');
        if (scope === 'CATEGORY' && !catalog.tree().byId.has(scopeId)) invalid('scopeId', 'Categoria não encontrada.');
        const descendants = boolean(value('includeDescendants', scope === 'CATEGORY'
          && (row?.scope === scope ? Boolean(row.descendants) : true)), 'includeDescendants');
        if (descendants && scope !== 'CATEGORY') invalid('includeDescendants', 'Somente categorias têm descendentes.');
        const minimum = integer(value('minSubtotalCents', row?.minimum ?? 0), 'minSubtotalCents', 0, MAX_MERCH);
        const percent = integer(value('percentBps', row?.percent ?? 0), 'percentBps', 0, 10000);
        const ceiling = value('maxDiscountCents', row?.ceiling ?? null);
        if (ceiling !== null) {
          if (!percent) invalid('maxDiscountCents', 'O teto exige desconto percentual.');
          integer(ceiling, 'maxDiscountCents', 1, MAX_MERCH);
        }
        const free = boolean(value('freeShipping', Boolean(row?.free_shipping)), 'freeShipping');
        if (!percent && !free) invalid('percentBps', 'Defina percentual ou frete grátis.');
        const stackable = boolean(value('stackable', Boolean(row?.stackable)), 'stackable');
        const active = boolean(value('active', row ? Boolean(row.active) : true), 'active');
        const couponId = row?.id ?? randomUUID();
        const fields = [scope, scope === 'CATEGORY' ? scopeId : null, scope === 'PRODUCT' ? scopeId : null,
          Number(descendants), minimum, ceiling, percent, Number(free), Number(stackable), Number(active)];
        if (row) db.prepare(`UPDATE coupons SET scope=?,category_id=?,listing_id=?,descendants=?,minimum=?,ceiling=?,percent=?,
          free_shipping=?,stackable=?,active=?,version=version+1 WHERE id=?`).run(...fields, couponId);
        else db.prepare(`INSERT INTO coupons(scope,category_id,listing_id,descendants,minimum,ceiling,percent,
          free_shipping,stackable,active,id,code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(...fields, couponId, code);
        return dto(find.get(couponId));
      });
    },
    pairs(id, params) {
      byId(id);
      const page = pagination(params, ['coupon-pairs', id]);
      return page.result(db.prepare('SELECT * FROM coupon_pairs WHERE (first=? OR second=?) AND seq>? ORDER BY seq LIMIT ?')
        .all(id, id, page.after, page.size), row => ({couponId: id, otherCouponId: row.first === id ? row.second : row.first, rule: row.rule}));
    },
    savePair(id, other, body) {
      return transaction(db, () => {
        byId(id);
        byId(other);
        if (id === other) invalid('otherCouponId', 'Escolha outro cupom.');
        shape(body, ['rule'], ['rule']);
        const order = pair(id, other);
        if (body.rule === null) {
          db.prepare('DELETE FROM coupon_pairs WHERE first=? AND second=?').run(...order);
          return null;
        }
        const rule = oneOf(body.rule, ['ALLOW', 'DENY'], 'rule');
        if (!getPair.get(...order) && db.prepare('SELECT count(*) AS count FROM coupon_pairs').get().count >= 10000) unavailable();
        db.prepare('INSERT INTO coupon_pairs(first,second,rule) VALUES(?,?,?) ON CONFLICT(first,second) DO UPDATE SET rule=excluded.rule')
          .run(...order, rule);
        return {couponId: id, otherCouponId: other, rule};
      });
    },
    rules(codes) {
      const records = codes.map(code => lookup.get(code) ?? null);
      const pairs = new Map();
      for (let i = 0; i < records.length; i++) for (let j = i + 1; j < records.length; j++) {
        if (!records[i] || !records[j]) continue;
        const ids = pair(records[i].id, records[j].id);
        pairs.set(ids.join(':'), getPair.get(...ids)?.rule ?? null);
      }
      return {records, pairs};
    }
  };
}

// Limits make prices safe JS integers; proportional numerators are BigInt because
// a capped basket multiplied by a line balance can exceed JS safe precision.
function distribute(discount, balances, indexes, lines) {
  if (!discount) return;
  const sum = indexes.reduce((acc, index) => acc + balances[index], 0);
  const denominator = BigInt(sum);
  const shares = indexes.filter(index => balances[index] > 0).map(index => {
    const numerator = BigInt(discount) * BigInt(balances[index]);
    return {index, part: Number(numerator / denominator), remainder: numerator % denominator};
  });
  let extra = discount - shares.reduce((acc, share) => acc + share.part, 0);
  shares.sort((a, b) => compare(b.remainder, a.remainder) || compare(lines[a.index].productId, lines[b.index].productId)
    || compare(lines[a.index].variant, lines[b.index].variant));
  for (const share of shares) {
    balances[share.index] -= share.part + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
  }
}

export function calculateCoupons(lines, shippingCents, codes, {records, pairs}) {
  const initial = lines.map(line => line.subtotalCents);
  const eligible = [];
  const rejected = new Map();
  codes.forEach((code, index) => {
    const rule = records[index];
    if (!rule?.active) { rejected.set(code, 'UNAVAILABLE'); return; }
    const indexes = lines.flatMap((line, i) => {
      const qualifies = rule.scope === 'GLOBAL' || (rule.scope === 'PRODUCT' && line.productId === rule.listing_id)
        || (rule.scope === 'CATEGORY' && (line.categoryId === rule.category_id ||
          (rule.descendants && line.ancestorIds.includes(rule.category_id))));
      return qualifies ? [i] : [];
    });
    if (!indexes.length) { rejected.set(code, 'SCOPE_MISMATCH'); return; }
    if (indexes.reduce((sum, i) => sum + initial[i], 0) < rule.minimum) {
      rejected.set(code, 'MINIMUM_NOT_MET');
      return;
    }
    eligible.push({...rule, indexes});
  });
  const compatible = (a, b) => a.stackable && b.stackable && pairs.get(pairKey(a.id, b.id)) === 'ALLOW';
  const evaluate = selected => {
    const balances = [...initial];
    const ordered = selected.toSorted((a, b) => SCOPES.indexOf(b.scope) - SCOPES.indexOf(a.scope) || compare(a.code, b.code));
    const applied = ordered.map(rule => {
      const base = rule.indexes.reduce((sum, i) => sum + balances[i], 0);
      const amount = Math.min(base, Math.floor(base * rule.percent / 10000), rule.ceiling ?? Infinity);
      distribute(amount, balances, rule.indexes, lines);
      return {code: rule.code, merchDiscountCents: amount, shippingDiscountCents: 0};
    });
    const free = ordered.findIndex(rule => rule.free_shipping);
    if (free !== -1) applied[free].shippingDiscountCents = shippingCents;
    const merchandise = applied.reduce((sum, entry) => sum + entry.merchDiscountCents, 0);
    const shipping = free === -1 ? 0 : shippingCents;
    return {selected, ordered, balances, applied, merchandise, shipping,
      score: merchandise + shipping, key: selected.map(rule => rule.code).sort(compare).join(' ')};
  };
  let best = evaluate([]);
  for (let mask = 1; mask < 2 ** eligible.length; mask++) {
    const list = eligible.filter((_, index) => mask & (1 << index));
    if (list.some((rule, index) => list.slice(0, index).some(other => !compatible(rule, other)))) continue;
    const attempt = evaluate(list);
    if (attempt.score > best.score || (attempt.score === best.score && (list.length < best.selected.length ||
        (list.length === best.selected.length && compare(attempt.key, best.key) < 0)))) best = attempt;
  }
  const appliedIds = new Set(best.selected.map(rule => rule.code));
  for (const rule of eligible) {
    if (appliedIds.has(rule.code)) continue;
    rejected.set(rule.code, evaluate([rule]).score === 0 ? 'NO_BENEFIT'
      : best.selected.some(other => !compatible(rule, other)) ? 'INCOMPATIBLE' : 'NOT_SELECTED');
  }
  return {
    lineDiscounts: initial.map((value, index) => value - best.balances[index]),
    merchDiscountCents: best.merchandise, shippingDiscountCents: best.shipping, appliedCoupons: best.applied,
    rejectedCoupons: codes.filter(code => rejected.has(code)).map(code => ({code, reason: rejected.get(code)}))
  };
}
