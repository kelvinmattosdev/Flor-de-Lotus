import {createApi, errorCopy} from './api.js';
import {categoriesView, listingsView} from './catalog.js';
import {customersView, ordersView} from './commerce.js';
import {couponsView} from './coupons.js';
import {alerts, badge, button, field, focusHeading, h, heading, input, submit, text} from './ui.js';

const api = createApi();
const root = document.getElementById('operador');
const tabs = [
  ['pedidos', 'Pedidos', ordersView],
  ['clientes', 'Clientes', customersView],
  ['categorias', 'Categorias', categoriesView],
  ['anuncios', 'Anúncios', listingsView],
  ['cupons', 'Cupons', couponsView]
];
let sessionUser = null;
let shell;
let ctx;
let rechecking = null;
let state = {};

const brand = () => h('div', {class: 'brand'},
  h('span', {class: 'brand-mark', 'aria-hidden': 'true'}, h('span'), h('span'), h('span')),
  h('div', {}, h('strong', {}, 'Flor de Lotus'), h('span', {class: 'brand-label'}, 'Operação')));

function loginView(notice = '', focus = false, retry = false) {
  sessionUser = null;
  shell = null;
  ctx = null;
  state = {};
  api.clear();
  const messages = alerts();
  const login = input(null, '', {autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: 32, required: true});
  const password = input(null, '', {type: 'password', autocomplete: 'current-password', maxlength: 256, required: true});
  const submitButton = submit('Entrar no painel');
  const retryButton = retry ? button('Verificar a sessão novamente', () => { void start(true); }, 'button secondary login-retry') : null;
  const fields = h('fieldset', {class: 'login-fields'}, h('legend', {class: 'sr-only'}, 'Credenciais de operador'),
    field('Apelido de operador', login), field('Senha', password), submitButton);
  // No named credentials and no GET fallback; the only submission is the API POST.
  const form = h('form', {method: 'post'}, fields);
  const main = h('main', {class: 'login-main', id: 'principal', tabindex: '-1'},
    h('div', {class: 'login-copy'}, text('Área restrita · demonstração', 'eyebrow'),
      h('h1', {tabindex: '-1'}, 'Acesso do operador'),
      text('Gerencie a vitrine e acompanhe pedidos de teste da Flor de Lotus.', 'lead'),
      h('div', {class: 'provision'}, h('h2', {}, 'Conta de operador'),
        text('Peça à administração que provisione um operador pela CLI local, conforme a documentação. Não há cadastro online nem senha inicial.'))),
    h('div', {class: 'login-panel'}, h('h2', {}, 'Entrar'), messages.node, form, retryButton));
  root.replaceChildren(h('div', {class: 'login-layout'},
    h('header', {class: 'login-header'}, brand()), main, footer()));
  if (notice) messages.fail(notice);
  if (focus) focusHeading(main);

  let sending = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending) return;
    const name = login.value.trim();
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(name)) {
      messages.fail('Use o apelido provisionado: de 3 a 32 letras sem acento, números, hífens ou sublinhados.');
      login.focus();
      return;
    }
    let phrase = password.value;
    password.value = '';
    sending = true;
    fields.disabled = true;
    if (retryButton) retryButton.disabled = true;
    messages.say('Verificando o acesso…');
    try {
      await api.session();
      const user = await api.login(name, phrase);
      if (!main.isConnected) return;
      if (user?.role !== 'OPERATOR') {
        loginView('Esta conta não tem acesso ao painel de operação.', true);
        return;
      }
      dashboard(user);
    } catch (error) {
      if (!main.isConnected) return;
      messages.fail(errorCopy(error));
      fields.disabled = false;
      password.focus();
    } finally {
      phrase = '';
      fields.disabled = false;
      if (retryButton) retryButton.disabled = false;
      sending = false;
    }
  });
}

function footer() {
  return h('footer', {class: 'footer'}, h('span', {}, 'Flor de Lotus · Demonstração'),
    h('span', {}, 'Sem pagamentos ou entregas reais.'));
}

function dashboard(user, focus = true) {
  sessionUser = user;
  const nav = h('nav', {class: 'nav', 'aria-label': 'Áreas do painel'});
  const tools = tabs.map(([area, label], index) => {
    const control = button(label, () => go(area), 'nav-button', {'data-area': area});
    control.prepend(h('span', {class: 'nav-index', 'aria-hidden': 'true'}, String(index + 1).padStart(2, '0')));
    nav.append(control);
    return control;
  });
  const sessionMessages = alerts();
  const exit = button('Sair', logout, 'button secondary');
  const main = h('main', {id: 'principal', tabindex: '-1', class: 'workspace'});
  shell = {tools, exit, main, sessionMessages, busy: false};
  const header = h('header', {class: 'topbar'}, h('div', {class: 'topbar-inner'}, brand(),
    h('div', {class: 'identity'}, badge('Sessão de operador', 'neutral'), h('span', {class: 'account'}, user.login), exit)));
  root.replaceChildren(header, h('div', {class: 'dashboard'},
    h('div', {class: 'sidebar'}, text('Área de trabalho', 'eyebrow nav-label'), nav),
    h('div', {class: 'work-column'}, sessionMessages.node, main, footer())));
  go('pedidos', ordersView, {force: true, focus});
}

function go(area, renderer = tabs.find(tab => tab[0] === area)?.[2], {force = false, focus = true} = {}) {
  if (!shell || shell.busy || rechecking || !renderer) return;
  if (!force && !confirmLeave()) return;
  const {tools, main, sessionMessages} = shell;
  sessionMessages.say();
  const body = h('div', {class: 'view'});
  main.replaceChildren(body);
  for (const tool of tools) {
    if (tool.dataset.area === area) tool.setAttribute('aria-current', 'page');
    else tool.removeAttribute('aria-current');
  }
  const local = {
    area, body, main, api, state, go,
    active: () => ctx === local && body.isConnected,
    busy: () => Boolean(shell?.busy) || Boolean(rechecking),
    setBusy(value) {
      if (!local.active()) return;
      shell.busy = value;
      for (const tool of [...shell.tools, shell.exit]) tool.disabled = value;
    },
    setDirty(handler) { local.dirty = handler; },
    async issue(error, source = area) {
      if (!local.active()) return null;
      if (error.code === 'AUTH_REQUIRED' || error.code === 'FORBIDDEN') {
        loginView(errorCopy(error, source), true);
        return null;
      }
      if (error.code === 'CSRF_INVALID') {
        const userId = sessionUser.id;
        try {
          rechecking ??= api.session().finally(() => { rechecking = null; });
          const current = await rechecking;
          if (!local.active()) return null;
          if (current?.role !== 'OPERATOR' || current.id !== userId) {
            loginView('A sessão terminou ou foi trocada em outra aba. Entre novamente para continuar.', true);
            return null;
          }
          return 'Sessão atualizada. Nenhum envio foi repetido. Confira os dados e tente novamente, se necessário.';
        } catch (failure) {
          return errorCopy(failure, source);
        }
      }
      return errorCopy(error, source);
    }
  };
  ctx = local;
  renderer(local);
  if (focus) focusHeading(body);
}

function confirmLeave() {
  return !ctx?.dirty?.() || window.confirm('Há alterações não salvas. Deseja sair deste formulário sem salvar?');
}

async function logout() {
  if (!ctx || ctx.busy() || !confirmLeave()) return;
  const current = ctx;
  const {sessionMessages, exit} = shell;
  ctx.setBusy(true);
  sessionMessages.say('Encerrando a sessão…');
  try {
    await api.logout();
    if (current.active()) loginView('', true);
  } catch (error) {
    if (!current.active()) return;
    const copy = await current.issue(error);
    if (current.active() && copy) sessionMessages.fail(copy, true);
    if (current.active() && !error.status) {
      try {
        const user = await api.session();
        if (current.active() && user?.role !== 'OPERATOR') loginView('', true);
      } catch { /* Keep the error visible and don't repeat logout automatically. */ }
    }
  } finally {
    if (current.active()) {
      current.setBusy(false);
      if (document.activeElement === document.body) exit.focus();
    }
  }
}

async function start(focus = false) {
  const main = h('main', {id: 'principal', tabindex: '-1', class: 'startup'},
    text('Flor de Lotus · Operação', 'eyebrow'), heading('Acesso do operador'),
    h('p', {role: 'status'}, 'Verificando a sessão…'));
  root.replaceChildren(main);
  try {
    const user = await api.session();
    if (!main.isConnected) return;
    if (user?.role === 'OPERATOR') dashboard(user, focus);
    else loginView(user ? 'Esta conta não tem acesso ao painel de operação.' : '', focus);
  } catch (error) {
    if (main.isConnected) loginView(errorCopy(error), focus, true);
  }
}

window.addEventListener('beforeunload', event => {
  if (ctx?.dirty?.() || ctx?.busy()) {
    event.preventDefault();
    event.returnValue = '';
  }
});
// A bfcache restore must not leave an old operator view after logout elsewhere.
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    sessionUser = null;
    shell = null;
    ctx = null;
    state = {};
    api.clear();
    void start();
  }
});

void start();
