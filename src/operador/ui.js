import {query} from './api.js';

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (['checked', 'disabled', 'hidden', 'required', 'readOnly'].includes(key)) node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const item of children.flat(Infinity)) {
    if (item != null && item !== false) node.append(item instanceof Node ? item : String(item));
  }
  return node;
}

export const text = (value, cls) => h('p', {class: cls}, value);
export const button = (label, onclick, cls = 'button secondary', attrs = {}) =>
  h('button', {type: 'button', class: cls, onclick, ...attrs}, label);
export const submit = (label, cls = 'button primary', value) =>
  h('button', {type: 'submit', class: cls, value}, label);
export const heading = (title, description, actions) => h('div', {class: 'view-head'},
  h('div', {}, h('h1', {tabindex: '-1'}, title), description && text(description, 'lead')),
  actions && h('div', {class: 'actions head-actions'}, actions));
export const band = (...body) => h('div', {class: 'band'}, body);
export const badge = (value, tone = '') => h('span', {class: `badge ${tone}`}, value);
export const empty = (title, description) => h('div', {class: 'empty'}, h('h2', {}, title), description && text(description));
export const dl = entries => h('dl', {class: 'facts'}, entries.map(([key, value]) =>
  h('div', {}, h('dt', {}, key), h('dd', {}, value))));
export const select = (name, options, current = '', attrs = {}) => {
  const control = h('select', {name, ...attrs}, options.map(([value, label, disabled]) =>
    h('option', {value, disabled}, label)));
  control.value = current;
  return control;
};
export function input(name, value, attrs = {}) {
  return h('input', {name, value, ...attrs});
}
export function textarea(name, value, attrs = {}) {
  const control = h('textarea', {name, ...attrs});
  control.value = value ?? '';
  return control;
}
export const check = (name, label, checked = false) =>
  h('label', {class: 'check'}, h('input', {type: 'checkbox', name, checked}), h('span', {}, label));

let uid = 0;
export function field(label, control, {hint, wide} = {}) {
  const id = `campo-${++uid}`;
  control.id = id;
  control.setAttribute('aria-describedby', `${id}-ajuda ${id}-erro`);
  return h('div', {class: `field${wide ? ' wide' : ''}`}, h('label', {for: id}, label), control,
    h('small', {class: 'hint', id: `${id}-ajuda`}, hint),
    h('small', {class: 'field-error', id: `${id}-erro`}));
}

export function alerts() {
  const info = h('p', {class: 'notice status', role: 'status', 'aria-atomic': 'true'});
  const error = h('p', {class: 'notice error', role: 'alert', 'aria-atomic': 'true', tabindex: '-1'});
  return {
    node: h('div', {class: 'alerts'}, info, error),
    say(message = '') { error.textContent = ''; info.textContent = message; },
    fail(message, focus = false) {
      info.textContent = '';
      error.textContent = message;
      if (focus) error.focus();
    }
  };
}

export function fieldErrors(form, entries = {}) {
  for (const item of form.querySelectorAll('[aria-invalid]')) item.removeAttribute('aria-invalid');
  for (const item of form.querySelectorAll('.field-error')) item.textContent = '';
  let first;
  for (const [name, message] of Object.entries(entries)) {
    const control = form.elements.namedItem(name);
    if (!control?.id || control.disabled) continue;
    control.setAttribute('aria-invalid', 'true');
    const detail = document.getElementById(`${control.id}-erro`);
    if (detail) detail.textContent = message;
    first ??= control;
  }
  first?.focus();
  return Boolean(first);
}

export const focusHeading = node => node.querySelector('h1')?.focus();

// Keep filters and prior results intact after a failed page. Cursor is committed
// only after a valid response; changing filters invalidates in-flight reads.
export function pager(ctx, {path, filters, area, row, emptyTitle, emptyCopy}) {
  const list = h('ul', {class: 'rows', 'aria-label': 'Resultados'});
  const result = h('div', {class: 'result'});
  const message = alerts();
  const more = button('Carregar mais', () => load(false));
  const count = text('', 'muted result-count');
  const controls = h('div', {class: 'page-controls'}, count, more);
  const node = h('div', {class: 'list-panel'}, message.node, result, controls);
  controls.hidden = true;
  let cursor = null;
  let countLoaded = 0;
  let generation = 0;

  async function load(reset = true) {
    const ticket = ++generation;
    const current = () => ctx.active() && ticket === generation;
    const fromMore = document.activeElement === more;
    message.say(reset ? 'Carregando registros…' : 'Carregando mais registros…');
    more.disabled = true;
    result.setAttribute('aria-busy', 'true');
    if (reset) {
      controls.hidden = true;
      result.replaceChildren();
      list.replaceChildren();
      cursor = null;
      countLoaded = 0;
    }
    try {
      const page = await ctx.api.request(path + query({...filters(), limit: 24, cursor}));
      if (!current()) return;
      if (!Array.isArray(page?.items) || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) {
        throw new Error('Página inválida');
      }
      const newRows = page.items.map(row);
      list.append(...newRows);
      cursor = page.nextCursor;
      countLoaded += page.items.length;
      message.say();
      result.replaceChildren(countLoaded ? list : empty(emptyTitle, emptyCopy));
      count.textContent = `${countLoaded} ${countLoaded === 1 ? 'registro exibido' : 'registros exibidos'}`;
      controls.hidden = !countLoaded;
      more.hidden = !cursor;
      if (fromMore && document.activeElement === document.body) newRows[0]?.querySelector('button, a')?.focus();
    } catch (error) {
      if (!current()) return;
      const copy = await ctx.issue(error, area);
      if (!current() || !copy) return;
      message.fail(copy);
      if (reset) result.replaceChildren(button('Tentar novamente', () => load()));
    } finally {
      if (current()) {
        result.removeAttribute('aria-busy');
        more.disabled = false;
        if (fromMore && !more.hidden && document.activeElement === document.body) more.focus();
      }
    }
  }

  return {node, load};
}

export function loadView(ctx, title, back, fetchData, render) {
  const messages = alerts();
  const contents = h('div');
  ctx.body.append(heading(title, null, back), messages.node, contents);
  async function load() {
    contents.replaceChildren();
    messages.say('Carregando dados…');
    try {
      const data = await fetchData();
      if (!ctx.active()) return;
      ctx.body.replaceChildren();
      render(data);
      if (!ctx.active()) return;
      if (document.activeElement === document.body || document.activeElement === ctx.main) focusHeading(ctx.body);
    } catch (error) {
      if (!ctx.active()) return;
      if (!messages.node.isConnected) ctx.body.replaceChildren(heading(title, null, back), messages.node, contents);
      const copy = await ctx.issue(error, ctx.area);
      if (!ctx.active() || !copy) return;
      messages.fail(copy);
      contents.replaceChildren(button('Tentar novamente', load));
    }
  }
  void load();
}
