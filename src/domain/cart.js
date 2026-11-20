import { findProduct, shippingOptions } from '../data/catalog.js';

export const STORAGE_KEY = 'flor-de-lotus:craft-sebo-cart:v2';
export const LEGACY_STORAGE_KEY = 'flor-de-lotus:demo-cart:v1';
export const MAX_QUANTITY = 9;
const validQuantity = value => Number.isInteger(value) && value >= 1 && value <= MAX_QUANTITY;
const purchasable = (id, variant) => {
  const product = findProduct(id);
  return product?.mode === 'ready' && (product.variants.length ? product.variants.includes(variant) : variant === '');
};
export const lineKey = (id, variant) => `${id}:${variant}`;

export function normalizeCart(value) {
  if (!Array.isArray(value)) return [];
  const clean = [];
  for (const line of value.slice(0, 40)) {
    if (!line || !purchasable(line.id, line.variant) || !validQuantity(line.quantity)) continue;
    const existing = clean.find(item => item.id === line.id && item.variant === line.variant);
    if (existing) existing.quantity = Math.min(MAX_QUANTITY, existing.quantity + line.quantity);
    else clean.push({ id: line.id, variant: line.variant, quantity: line.quantity });
  }
  return clean;
}

export function addItem(cart, id, variant = '', quantity = 1) {
  if (!purchasable(id, variant)) throw new RangeError('Escolha um item e uma opção válidos para a demonstração.');
  if (!validQuantity(quantity)) throw new RangeError('Use uma quantidade inteira entre 1 e 9.');
  const clean = normalizeCart(cart);
  const existing = clean.find(item => item.id === id && item.variant === variant);
  if (existing && existing.quantity + quantity > MAX_QUANTITY) throw new RangeError('O limite da demonstração é de 9 unidades por item e opção.');
  if (existing) existing.quantity += quantity;
  else clean.push({ id, variant, quantity });
  return clean;
}

export function setQuantity(cart, id, variant, quantity) {
  if (!validQuantity(quantity)) throw new RangeError('Use uma quantidade inteira entre 1 e 9.');
  return normalizeCart(cart).map(item => item.id === id && item.variant === variant ? { ...item, quantity } : item);
}
export const removeItem = (cart, id, variant) => normalizeCart(cart).filter(item => !(item.id === id && item.variant === variant));
export const emptyCart = () => [];
export const itemCount = cart => normalizeCart(cart).reduce((sum, item) => sum + item.quantity, 0);
export const subtotal = cart => normalizeCart(cart).reduce((sum, item) => sum + findProduct(item.id).price * item.quantity, 0);

export function loadCart(storage) {
  // Invalidate only this app's obsolete wardrobe basket; never touch another site's keys.
  // Separate try keeps a remove failure from blocking a readable current basket.
  try { storage?.removeItem(LEGACY_STORAGE_KEY); } catch { /* storage denied */ }
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw || raw.length > 50000) return [];
    const data = JSON.parse(raw);
    return data?.version === 2 ? normalizeCart(data.items) : [];
  } catch { return []; }
}
export function saveCart(storage, cart) {
  try {
    if (!storage) return false;
    const items = normalizeCart(cart);
    // Remove the key at completion; no order history or personal data is stored.
    if (!items.length) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, items }));
    return true;
  } catch { return false; }
}

export function reviewCheckout(cart, { shipping = 'correios', payment = 'pix' } = {}) {
  const items = normalizeCart(cart);
  if (!items.length) throw new RangeError('Sua sacola está vazia.');
  const delivery = shippingOptions.find(option => option.id === shipping);
  if (!delivery || !['pix', 'card'].includes(payment)) throw new RangeError('Escolha opções válidas para a simulação.');
  const merchandise = subtotal(items);
  return { items, shipping: delivery, payment, subtotal: merchandise, total: merchandise + delivery.price, count: itemCount(items) };
}
export function completeCheckout(cart, options) {
  return { status: 'simulated', summary: reviewCheckout(cart, options), cart: emptyCart() };
}
