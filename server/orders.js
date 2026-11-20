import { createHmac, randomUUID } from 'node:crypto';
import { shippingOptions } from '../src/data/catalog.js';
import { couponCode, calculateCoupons } from './coupons.js';
import { transaction } from './db.js';
import { catalogId, conflict, digest, humanText, integer, invalid, limited, missing, oneOf, pagination, same, shape, unavailable, uuid } from './http.js';

const STATES = ['PENDENTE', 'PROCESSANDO', 'ENVIADO', 'ENTREGUE'];
const PAYMENTS = ['PIX_SIMULADO', 'CARTAO_SIMULADO'];
const SHIPPING = new Map(shippingOptions.map(option => [option.id, option]));
const QUOTE_TTL = 10 * 60_000;
const EXPIRED_RETENTION = 24 * 60 * 60_000;
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function readRecipient(value) {
  const name = humanText(value, 'recipientFullName', 120);
  if (!/\p{L}/u.test(name) || !/^[\p{L}\p{M}\p{Zs}'’.‐‑-]+$/u.test(name)) {
    invalid('recipientFullName', 'Use letras, espaços, apóstrofos, hífens ou pontos em um nome fictício.');
  }
  return name;
}

function bindRecipient(sessionToken, quoteId, customerId, name) {
  return createHmac('sha256', sessionToken)
    .update(JSON.stringify(['flor-de-lotus:recipient-binding:v2', quoteId, customerId, name])).digest('hex');
}

function readQuoteInput(body) {
  const fields = ['items', 'shippingId', 'paymentMethod', 'couponCodes', 'recipientFullName'];
  shape(body, fields, fields);
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 40) invalid('items', 'Informe de uma a 40 linhas.');
  const items = body.items.map(row => {
    shape(row, ['productId', 'variant', 'quantity'], ['productId', 'variant', 'quantity']);
    if (typeof row.variant !== 'string' || row.variant.length > 60 || /[\x00-\x1f\x7f]/.test(row.variant)) invalid('variant');
    return {productId: catalogId(row.productId, 'productId'), variant: row.variant, quantity: integer(row.quantity, 'quantity', 1, 9)};
  }).sort((a, b) => cmp(a.productId, b.productId) || cmp(a.variant, b.variant));
  if (items.some((row, i) => i > 0 && row.productId === items[i - 1].productId && row.variant === items[i - 1].variant)) {
    invalid('items', 'Não repita a mesma linha de produto e variante.');
  }
  if (!Array.isArray(body.couponCodes) || body.couponCodes.length > 20) invalid('couponCodes', 'Informe até cinco códigos distintos.');
  const couponCodes = [...new Set(body.couponCodes.map(couponCode))].sort(cmp);
  if (couponCodes.length > 5) invalid('couponCodes', 'Informe até cinco códigos distintos.');
  const input = {
    items, couponCodes,
    shippingId: oneOf(body.shippingId, [...SHIPPING.keys()], 'shippingId'),
    paymentMethod: oneOf(body.paymentMethod, PAYMENTS, 'paymentMethod')
  };
  return {input, recipient: readRecipient(body.recipientFullName)};
}

const purchaseDto = r => ({id: r.id, createdAt: r.created_at, paymentMethod: r.payment_method, state: 'SIMULADO', demo: true});
const itemDto = r => ({productId: r.product_id, variant: r.variant, quantity: r.quantity, name: r.name,
  unitPriceCents: r.unit_price, subtotalCents: r.quantity * r.unit_price, discountCents: r.discount,
  totalCents: r.quantity * r.unit_price - r.discount});
const couponDto = r => ({code: r.code, merchDiscountCents: r.merch_discount, shippingDiscountCents: r.shipping_discount});

export function createOrders(db, catalog, coupons, now) {
  const findOrder = db.prepare('SELECT * FROM orders WHERE id=?');
  const ownOrder = db.prepare('SELECT * FROM orders WHERE id=? AND customer_id=?');
  const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY product_id,variant');
  const orderCoupons = db.prepare('SELECT * FROM order_coupon_snapshots WHERE order_id=? ORDER BY position');
  const eventRows = db.prepare('SELECT * FROM order_status_events WHERE order_id=? ORDER BY ordinal');
  const addEvent = db.prepare('INSERT INTO order_status_events(order_id,status,ordinal,created_at) VALUES(?,?,?,?)');
  const purchase = db.prepare('SELECT * FROM purchases WHERE order_id=?');
  const customer = db.prepare(`SELECT c.id,c.nickname,u.login FROM customers c JOIN users u ON u.id=c.user_id WHERE c.id=?`);
  const findReplay = db.prepare('SELECT * FROM orders WHERE customer_id=? AND idem_key=?');
  const customerIdentity = r => ({id: r.id, login: r.login, nickname: r.nickname});
  const customerDto = r => ({...customerIdentity(r), createdAt: r.created_at});

  const receipt = row => ({
    orderId: row.id, createdAt: row.created_at, demo: true, status: 'PENDENTE', totalCents: row.total,
    purchase: purchaseDto(purchase.get(row.id))
  });
  const orderDto = (row, operator, detail = false) => {
    const dto = {
      id: row.id, createdAt: row.created_at, demo: true, status: row.status,
      items: orderItems.all(row.id).map(itemDto), subtotalCents: row.subtotal, merchDiscountCents: row.discount,
      shippingId: row.shipping_id, shippingName: row.shipping_name, shippingCents: row.shipping,
      shippingDiscountCents: row.shipping_discount, totalCents: row.total, appliedCoupons: orderCoupons.all(row.id).map(couponDto),
      purchase: purchaseDto(purchase.get(row.id)),
      statusHistory: eventRows.all(row.id).map(event => ({status: event.status, createdAt: event.created_at}))
    };
    if (operator) dto.customer = customerIdentity(customer.get(row.customer_id));
    if (detail) dto.recipientFullName = row.recipient_full_name;
    return dto;
  };

  const price = input => {
    const hierarchy = catalog.tree();
    const lines = input.items.map(row => {
      const listing = catalog.listing(row.productId);
      if (!catalog.publicListing(listing, hierarchy) || listing.mode !== 'ready') invalid('items', 'Uma peça não está disponível para compra simulada.');
      const variants = JSON.parse(listing.variants);
      if (variants.length ? !variants.includes(row.variant) : row.variant !== '') invalid('variant', 'Uma variante já não está disponível.');
      return {...row, name: listing.name, unitPriceCents: listing.price, subtotalCents: row.quantity * listing.price,
        categoryId: listing.category_id, ancestorIds: hierarchy.ancestry(listing.category_id).map(node => node.id),
        listingVersion: listing.version};
    });
    const rules = coupons.rules(input.couponCodes);
    const delivery = SHIPPING.get(input.shippingId);
    const {lineDiscounts, ...discounts} = calculateCoupons(lines, delivery.price, input.couponCodes, rules);
    const subtotal = lines.reduce((sum, line) => sum + line.subtotalCents, 0);
    const summary = {
      demo: true,
      items: lines.map(({categoryId, ancestorIds, listingVersion, ...line}, i) =>
        ({...line, discountCents: lineDiscounts[i], totalCents: line.subtotalCents - lineDiscounts[i]})),
      subtotalCents: subtotal, merchDiscountCents: discounts.merchDiscountCents,
      shippingId: delivery.id, shippingName: delivery.name, shippingCents: delivery.price,
      shippingDiscountCents: discounts.shippingDiscountCents,
      totalCents: subtotal - discounts.merchDiscountCents + delivery.price - discounts.shippingDiscountCents,
      paymentMethod: input.paymentMethod, appliedCoupons: discounts.appliedCoupons, rejectedCoupons: discounts.rejectedCoupons
    };
    const fingerprint = digest(JSON.stringify([input, summary, lines, rules.records.map(rule => rule && [rule.id, rule.version]),
      [...rules.pairs]]));
    return {summary, fingerprint};
  };

  return {
    quote(customerId, body, sessionToken) {
      const {input, recipient} = readQuoteInput(body);
      return transaction(db, () => {
        const timestamp = now();
        db.prepare('DELETE FROM quotes WHERE expires_at<=?').run(timestamp - EXPIRED_RETENTION);
        const active = db.prepare(`SELECT count(*) AS count, min(expires_at) AS first FROM quotes
          WHERE customer_id=? AND expires_at>? AND recipient_binding IS NOT NULL`)
          .get(customerId, timestamp);
        if (active.count >= 40) limited(Math.max(1, Math.ceil((active.first - timestamp) / 1000)));
        if (db.prepare('SELECT count(*) AS count FROM quotes WHERE recipient_binding IS NOT NULL').get().count >= 10000) unavailable();
        const {summary, fingerprint} = price(input);
        const quoteId = randomUUID(), expires = timestamp + QUOTE_TTL;
        db.prepare('INSERT INTO quotes(id,customer_id,input,fingerprint,expires_at,recipient_binding) VALUES(?,?,?,?,?,?)')
          .run(quoteId, customerId, JSON.stringify(input), fingerprint, expires, bindRecipient(sessionToken, quoteId, customerId, recipient));
        return {quoteId, expiresAt: new Date(expires).toISOString(), ...summary};
      });
    },
    place(customerId, key, body, sessionToken, limitNew) {
      // The envelope permits omission only to look up an already committed v1 replay.
      shape(body, ['quoteId', 'recipientFullName'], ['quoteId']);
      const quoteId = uuid(body.quoteId, 'quoteId');
      if (typeof key !== 'string' || !/^[A-Za-z0-9._-]{8,100}$/.test(key)) invalid('Idempotency-Key');
      return transaction(db, () => {
        const existing = findReplay.get(customerId, key);
        if (existing) {
          if (existing.quote_id !== quoteId) conflict('IDEMPOTENCY_CONFLICT', 'A chave de confirmação já foi usada com outra revisão.');
          const recipient = existing.recipient_full_name === null && !Object.hasOwn(body, 'recipientFullName')
            ? null : readRecipient(body.recipientFullName);
          if (recipient !== existing.recipient_full_name) {
            conflict('IDEMPOTENCY_CONFLICT', 'A chave de confirmação já foi usada com outro nome.');
          }
          return {status: 200, receipt: receipt(existing)};
        }
        if (db.prepare('SELECT 1 FROM orders WHERE quote_id=? AND customer_id=?').get(quoteId, customerId)) {
          conflict('QUOTE_CONSUMED', 'A revisão já gerou um pedido demonstrativo.');
        }
        const quote = db.prepare('SELECT * FROM quotes WHERE id=? AND customer_id=?').get(quoteId, customerId);
        if (!quote) missing();
        const timestamp = now();
        if (quote.expires_at <= timestamp) conflict('QUOTE_EXPIRED', 'Esta revisão expirou. Atualize a simulação.');
        if (quote.recipient_binding === null) conflict('QUOTE_STALE', 'Solicite uma nova revisão com o nome completo fictício.');
        const recipient = readRecipient(body.recipientFullName);
        const binding = bindRecipient(sessionToken, quoteId, customerId, recipient);
        if (!same(Buffer.from(binding, 'hex'), Buffer.from(quote.recipient_binding, 'hex'))) {
          conflict('QUOTE_STALE', 'A sessão ou o nome mudou. Solicite uma nova revisão.');
        }
        limitNew();
        let calculated;
        try {
          calculated = price(JSON.parse(quote.input));
        } catch (error) {
          if (error.code !== 'INVALID_INPUT') throw error;
          conflict('QUOTE_STALE', 'A disponibilidade mudou. Revise a sacola.');
        }
        if (calculated.fingerprint !== quote.fingerprint) {
          conflict('QUOTE_STALE', 'O resumo mudou. Revise preços, opções e cupons antes de confirmar.');
        }
        if (db.prepare('SELECT count(*) AS count FROM orders').get().count >= 50000) unavailable();
        const {summary} = calculated;
        const id = randomUUID(), createdAt = new Date(timestamp).toISOString();
        db.prepare(`INSERT INTO orders(id,customer_id,quote_id,idem_key,created_at,status,subtotal,discount,shipping_id,
          shipping_name,shipping,shipping_discount,total,recipient_full_name) VALUES(?,?,?,?,?,'PENDENTE',?,?,?,?,?,?,?,?)`)
          .run(id, customerId, quoteId, key, createdAt, summary.subtotalCents, summary.merchDiscountCents,
            summary.shippingId, summary.shippingName, summary.shippingCents, summary.shippingDiscountCents, summary.totalCents, recipient);
        const line = db.prepare('INSERT INTO order_items(order_id,product_id,variant,quantity,name,unit_price,discount) VALUES(?,?,?,?,?,?,?)');
        for (const row of summary.items) line.run(id, row.productId, row.variant, row.quantity, row.name, row.unitPriceCents, row.discountCents);
        const save = db.prepare(`INSERT INTO order_coupon_snapshots(order_id,position,code,merch_discount,shipping_discount)
          VALUES(?,?,?,?,?)`);
        summary.appliedCoupons.forEach((row, index) => save.run(id, index, row.code, row.merchDiscountCents, row.shippingDiscountCents));
        db.prepare('INSERT INTO purchases(id,order_id,created_at,payment_method) VALUES(?,?,?,?)')
          .run(randomUUID(), id, createdAt, summary.paymentMethod);
        addEvent.run(id, 'PENDENTE', 0, createdAt);
        db.prepare('DELETE FROM quotes WHERE id=?').run(quoteId);
        return {status: 201, receipt: receipt(findOrder.get(id))};
      });
    },
    info(id, customerId = null) {
      uuid(id);
      const row = customerId ? ownOrder.get(id, customerId) : findOrder.get(id);
      if (!row) missing();
      return orderDto(row, !customerId, true);
    },
    list(params, customerId = null) {
      const filterCustomer = customerId ?? (params.customerId === undefined ? null : uuid(params.customerId, 'customerId'));
      const byStatus = params.status === undefined ? null : oneOf(params.status, STATES, 'status');
      const page = pagination(params, ['orders', Boolean(customerId), filterCustomer, byStatus]);
      const where = ['seq>?'], args = [page.after];
      if (filterCustomer) { where.push('customer_id=?'); args.push(filterCustomer); }
      if (byStatus) { where.push('status=?'); args.push(byStatus); }
      const rows = db.prepare(`SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY seq LIMIT ?`).all(...args, page.size);
      return page.result(rows, row => orderDto(row, !customerId));
    },
    customers(params) {
      const page = pagination(params, ['customers']);
      const rows = db.prepare(`SELECT c.id,c.seq,c.nickname,u.login,u.created_at FROM customers c JOIN users u ON u.id=c.user_id
        WHERE c.seq>? ORDER BY c.seq LIMIT ?`).all(page.after, page.size);
      return page.result(rows, customerDto);
    },
    status(id, body) {
      uuid(id);
      shape(body, ['expectedStatus', 'to'], ['expectedStatus', 'to']);
      const expected = oneOf(body.expectedStatus, STATES, 'expectedStatus'), to = oneOf(body.to, STATES, 'to');
      const ordinal = STATES.indexOf(to);
      return transaction(db, () => {
        const row = findOrder.get(id);
        if (!row) missing();
        if (ordinal !== STATES.indexOf(expected) + 1 || ![expected, to].includes(row.status)) {
          conflict('STATE_CONFLICT', 'Só é permitido avançar ao próximo status; atualize o pedido.');
        }
        if (row.status === to) return orderDto(row, true, true);
        const changed = db.prepare('UPDATE orders SET status=? WHERE id=? AND status=?').run(to, id, expected);
        if (changed.changes !== 1) conflict('STATE_CONFLICT', 'Atualize o pedido.');
        addEvent.run(id, to, ordinal, new Date(now()).toISOString());
        return orderDto(findOrder.get(id), true, true);
      });
    }
  };
}
